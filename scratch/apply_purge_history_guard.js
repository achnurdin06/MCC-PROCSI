require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { queryPostgres } = require('../src/config/postgres');

const FN_SQL = `
CREATE OR REPLACE FUNCTION mc_center.fn_purge_target_data(p_run bigint, p_cfg integer, p_ids text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  r record;
  v_del_cnt bigint := 0;
  v_n int := 0;
  v_pk_col text;
  v_id_arr text[];
  v_canon_arr text[];
  v_has_mig_col boolean := false;
  v_non_mig_ids text;
  v_det text;
  v_match text;
  v_evidence text;
  v_flag text := 'lower(t.migration::text) IN (''1'', ''y'', ''t'', ''true'')';
  c mc_center.migration_config%ROWTYPE;
BEGIN
  SELECT * INTO c FROM mc_center.migration_config WHERE config_id = p_cfg;
  IF NOT FOUND THEN
    CALL mc_center.pr_fail(p_run, p_cfg, 'PURGE_TARGET', 'INVALID_CONFIG',
      format('Config ID %s tidak ditemukan di migration_config', p_cfg));
    RETURN 1;
  END IF;

  CALL mc_center.pr_log_step(p_run, p_cfg, 'PURGE_TARGET', 'START',
    format('mulai hapus data target migrasi (IDs: %s)', coalesce(nullif(btrim(p_ids), ''), 'ALL')));

  IF p_ids IS NOT NULL AND btrim(p_ids) <> '' THEN
    SELECT array_agg(btrim(x)) INTO v_id_arr
    FROM unnest(string_to_array(p_ids, ',')) x
    WHERE btrim(x) <> '';

    SELECT array_agg(coalesce(nullif(ltrim(x, '0'), ''), '0')) INTO v_canon_arr
    FROM unnest(v_id_arr) x
    WHERE x ~ '^[0-9]+$';
  END IF;

  FOR r IN
    SELECT target_config_id, tgt_schema, tgt_table, pk_columns, rollback_sql
    FROM mc_center.migration_target_config
    WHERE config_id = p_cfg AND is_active
    ORDER BY exec_order DESC, target_config_id DESC
  LOOP
    BEGIN
      v_pk_col := coalesce(nullif(r.pk_columns, ''), 'id');

      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = r.tgt_schema AND table_name = r.tgt_table AND column_name = 'migration'
      ) INTO v_has_mig_col;

      -- Bukti sah pernah migrasi: tercatat di payload staging_data_history pada field ID target
      v_evidence := format(
        'EXISTS (SELECT 1 FROM stg_antam.staging_data_history h WHERE h.config_id = %L AND ('
        || 'CASE WHEN (h.payload ->> %L) ~ ''^[0-9]+$'' AND (t.%I::text) ~ ''^[0-9]+$'' '
        || '     THEN coalesce(nullif(ltrim(h.payload ->> %L, ''0''), ''''), ''0'') = coalesce(nullif(ltrim(t.%I::text, ''0''), ''''), ''0'') '
        || '     ELSE (h.payload ->> %L) = (t.%I::text) END'
        || '))',
        p_cfg, v_pk_col, v_pk_col, v_pk_col, v_pk_col, v_pk_col, v_pk_col);

      IF v_id_arr IS NOT NULL AND array_length(v_id_arr, 1) > 0 THEN
        v_match := format(
          '(CASE WHEN t.%I::text ~ ''^[0-9]+$'' '
          || '   THEN coalesce(nullif(ltrim(t.%I::text, ''0''), ''''), ''0'') = ANY(%L::text[]) '
          || '   ELSE t.%I::text = ANY(%L::text[]) END)',
          v_pk_col, v_pk_col, coalesce(v_canon_arr, ARRAY[]::text[]), v_pk_col, v_id_arr);

        -- Guard STRICT: batalkan bila ada ID target yang BUKAN data migrasi (tidak ber-flag dan tidak di history)
        EXECUTE format(
          'SELECT string_agg(t.%I::text, %L) FROM %I.%I t WHERE %s AND NOT (%s%s)',
          v_pk_col, ', ', r.tgt_schema, r.tgt_table, v_match,
          CASE WHEN v_has_mig_col THEN v_flag || ' OR ' ELSE '' END, v_evidence)
        INTO v_non_mig_ids;

        IF v_non_mig_ids IS NOT NULL THEN
          CALL mc_center.pr_fail(p_run, p_cfg, 'PURGE_TARGET', 'NOT_MIGRATION_DATA',
            format('Penghapusan dibatalkan untuk ID (%s): Data di %s.%s bukan berasal dari migrasi (flag migration bukan 1/Y dan tidak tercatat di riwayat staging_data_history). Data non-migrasi tidak dapat dihapus.',
                   v_non_mig_ids, r.tgt_schema, r.tgt_table));
          RETURN 1;
        END IF;

        EXECUTE format('DELETE FROM %I.%I t WHERE %s AND (%s%s)',
          r.tgt_schema, r.tgt_table, v_match,
          CASE WHEN v_has_mig_col THEN v_flag || ' OR ' ELSE '' END, v_evidence);
        GET DIAGNOSTICS v_del_cnt = ROW_COUNT;

        IF v_del_cnt = 0 THEN
          CALL mc_center.pr_log_error(p_run, p_cfg, 'PURGE_TARGET', 'ID_NOT_FOUND',
            format('Data dengan ID (%s) tidak ditemukan pada tabel target %s.%s', p_ids, r.tgt_schema, r.tgt_table));
        END IF;
      ELSE
        -- Mode ALL data migrasi
        IF v_has_mig_col THEN
          EXECUTE format('DELETE FROM %I.%I t WHERE %s', r.tgt_schema, r.tgt_table, v_flag);
        ELSIF r.rollback_sql IS NOT NULL AND btrim(r.rollback_sql) <> '' THEN
          EXECUTE r.rollback_sql;
        ELSE
          EXECUTE format('DELETE FROM %I.%I t WHERE %s', r.tgt_schema, r.tgt_table, v_evidence);
        END IF;
        GET DIAGNOSTICS v_del_cnt = ROW_COUNT;
      END IF;

      CALL mc_center.pr_log_step(p_run, p_cfg, 'PURGE_TARGET', 'OK',
        format('tabel target %s.%s: %s baris data migrasi dihapus', r.tgt_schema, r.tgt_table, v_del_cnt),
        NULL, NULL, NULL, NULL, v_del_cnt);

      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
      CALL mc_center.pr_fail(p_run, p_cfg, 'PURGE_TARGET', 'DELETE_ERROR',
        format('gagal hapus data dari %s.%s: %s', r.tgt_schema, r.tgt_table, sqlerrm), v_det);
      RETURN 1;
    END;
  END LOOP;

  IF v_n = 0 THEN
    CALL mc_center.pr_fail(p_run, p_cfg, 'PURGE_TARGET', 'NO_TARGET_CONFIG',
      format('Tidak ada tabel target aktif di migration_target_config untuk config_id %s', p_cfg));
    RETURN 1;
  END IF;

  RETURN 0;
EXCEPTION WHEN OTHERS THEN
  GET STACKED DIAGNOSTICS v_det = PG_EXCEPTION_DETAIL;
  CALL mc_center.pr_fail(p_run, p_cfg, 'PURGE_TARGET', 'SQL_ERROR', sqlstate || ' ' || sqlerrm, v_det);
  RETURN 1;
END $function$;
`;

async function main() {
  await queryPostgres(FN_SQL);
  console.log('Fungsi mc_center.fn_purge_target_data berhasil diperbarui');
  process.exit(0);
}

main().catch(e => { console.error(e.message); process.exit(1); });
