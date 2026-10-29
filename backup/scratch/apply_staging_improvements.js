require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { queryPostgres } = require('../src/config/postgres');

async function main() {
  console.log('--- 1. Menambahkan kolom business_keys ke migration_config ---');
  await queryPostgres(`
    ALTER TABLE mc_center.migration_config ADD COLUMN IF NOT EXISTS business_keys text;
    ALTER TABLE etl_antam.migration_config ADD COLUMN IF NOT EXISTS business_keys text;

    UPDATE mc_center.migration_config SET business_keys = 'vendor_reference_id' WHERE config_id = 1;
    UPDATE mc_center.migration_config SET business_keys = 'vendor_id,number' WHERE config_id = 2;
    UPDATE mc_center.migration_config SET business_keys = 'vendor_id,address' WHERE config_id = 15;
    UPDATE mc_center.migration_config SET business_keys = 'username' WHERE config_id = 19;
    UPDATE mc_center.migration_config SET business_keys = 'vendor_id,number' WHERE config_id = 20;
    UPDATE mc_center.migration_config SET business_keys = 'vendor_id,number' WHERE config_id = 21;
    UPDATE mc_center.migration_config SET business_keys = 'vendor_id,nomor' WHERE config_id = 22;
    UPDATE mc_center.migration_config SET business_keys = 'vendor_id,nomor_rekening' WHERE config_id = 23;

    UPDATE etl_antam.migration_config SET business_keys = 'vendor_reference_id' WHERE config_id = 1;
    UPDATE etl_antam.migration_config SET business_keys = 'vendor_id,number' WHERE config_id = 2;
    UPDATE etl_antam.migration_config SET business_keys = 'vendor_id,address' WHERE config_id = 15;
    UPDATE etl_antam.migration_config SET business_keys = 'username' WHERE config_id = 19;
    UPDATE etl_antam.migration_config SET business_keys = 'vendor_id,number' WHERE config_id = 20;
    UPDATE etl_antam.migration_config SET business_keys = 'vendor_id,number' WHERE config_id = 21;
    UPDATE etl_antam.migration_config SET business_keys = 'vendor_id,nomor' WHERE config_id = 22;
    UPDATE etl_antam.migration_config SET business_keys = 'vendor_id,nomor_rekening' WHERE config_id = 23;
  `);
  console.log('✓ Kolom business_keys dan nilai awal berhasil diterapkan.');

  console.log('--- 2. Membuat tabel stg_antam.staging_data_history ---');
  await queryPostgres(`
    CREATE TABLE IF NOT EXISTS stg_antam.staging_data_history (
        history_id BIGSERIAL PRIMARY KEY,
        run_id BIGINT NOT NULL,
        config_id INT NOT NULL,
        table_name VARCHAR(100) NOT NULL,
        business_key_columns VARCHAR(150) NOT NULL,
        business_key_value TEXT NOT NULL,
        delta_status VARCHAR(30) NOT NULL, -- 'NEW_DELTA', 'ALREADY_IN_TARGET', 'DUPLICATE_SOURCE'
        payload JSONB NOT NULL,
        staged_at TIMESTAMP WITH TIME ZONE DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS idx_stg_hist_cfg_key ON stg_antam.staging_data_history (config_id, business_key_value);
    CREATE INDEX IF NOT EXISTS idx_stg_hist_run ON stg_antam.staging_data_history (run_id, config_id);
    CREATE INDEX IF NOT EXISTS idx_stg_hist_delta ON stg_antam.staging_data_history (delta_status);
  `);
  console.log('✓ Tabel stg_antam.staging_data_history berhasil dibuat.');

  console.log('--- 3. Mengupdate fungsi fn_check_delta di mc_center dan etl_antam ---');
  const fnCheckDeltaSql = (schema) => `
CREATE OR REPLACE FUNCTION ${schema}.fn_check_delta(p_run bigint, p_cfg integer)
RETURNS integer
LANGUAGE plpgsql
AS $function$
declare
  c ${schema}.migration_config%ROWTYPE;
  v_stg_tbl text;
  v_bk_cols text[];
  v_bk_str text;
  v_dup_cnt bigint := 0;
  v_dup_samples text;
  v_new bigint := 0;
  v_exist bigint := 0;
  v_join text;
  v_where_not_null text;
  v_bk_concat text;
  v_bk_concat_s text;
  v_det text;
  r record;
begin
  call ${schema}.pr_log_step(p_run, p_cfg, 'DELTA', 'START', 'hitung data delta baru vs eksisting dan validasi duplikasi');

  select * into c from ${schema}.migration_config where config_id = p_cfg;

  v_stg_tbl := case when c.stg_table like '%_src' then c.stg_table else c.stg_table || '_src' end;

  -- Tentukan business key columns (kunci bisnis unik)
  v_bk_str := coalesce(nullif(btrim(c.business_keys), ''), nullif(btrim(c.pk_columns), ''), 'id');
  v_bk_cols := string_to_array(v_bk_str, ',');

  -- Susun ekspresi concat business key untuk display & grouping
  select string_agg(format('coalesce(%I::text, ''NULL'')', btrim(k)), ' || ''|'' || ')
    into v_bk_concat
    from unnest(v_bk_cols) k;

  -- Susun kondisi NOT NULL untuk business key
  select string_agg(format('%I is not null', btrim(k)), ' AND ')
    into v_where_not_null
    from unnest(v_bk_cols) k;

  -- =========================================================================
  -- GATE 1: CEK DUPLIKASI INTERNAL DI STAGING TABLE (FAIL-FAST)
  -- =========================================================================
  execute format($q$
    with dup_agg as (
      select %1$s as bk_val, count(*) as cnt
      from stg_antam.%2$I
      where %3$s
      group by %4$s
      having count(*) > 1
    )
    select count(*), string_agg(bk_val, ', ')
    from (select bk_val from dup_agg limit 20) s
  $q$, v_bk_concat, v_stg_tbl, coalesce(v_where_not_null, '1=1'), v_bk_str)
  into v_dup_cnt, v_dup_samples;

  if v_dup_cnt > 0 then
    -- Log sampel baris data duplikat ke migration_error_log dan staging_data_history (maks 20 baris)
    for r in execute format($q$
      select %1$s as bk_val, to_jsonb(t) as row_payload
      from stg_antam.%2$I t
      where (%1$s) in (
        select %1$s
        from stg_antam.%2$I
        where %3$s
        group by %4$s
        having count(*) > 1
        limit 20
      )
      limit 20
    $q$, v_bk_concat, v_stg_tbl, coalesce(v_where_not_null, '1=1'), v_bk_str) loop
      insert into ${schema}.migration_error_log (
        run_id, config_id, step_name, pipeline_name, transform_name,
        error_code, error_message, row_data, error_time
      ) values (
        p_run, p_cfg, 'DELTA', 'staging_duplicate_check', 'fn_check_delta',
        'DUPLICATE_SOURCE_KEY',
        format('Duplikasi data pada staging stg_antam.%s untuk kunci [%s]: %s', v_stg_tbl, v_bk_str, r.bk_val),
        r.row_payload::text, now()
      );

      insert into stg_antam.staging_data_history (
        run_id, config_id, table_name, business_key_columns, business_key_value,
        delta_status, payload, staged_at
      ) values (
        p_run, p_cfg, v_stg_tbl, v_bk_str, r.bk_val,
        'DUPLICATE_SOURCE', r.row_payload, now()
      );
    end loop;

    -- Gagalkan sesi seketika (FAIL-FAST)
    call ${schema}.pr_fail(p_run, p_cfg, 'DELTA', 'DUPLICATE_SOURCE_KEY',
      format('GAGAL: Ditemukan %s grup data duplikat pada staging [%s] untuk kunci [%s]: %s',
             v_dup_cnt, v_stg_tbl, v_bk_str, v_dup_samples));
    return 1;
  end if;

  -- =========================================================================
  -- GATE 2: CEK DELTA TERHADAP TARGET DENGAN BUSINESS KEY
  -- =========================================================================
  select string_agg(format('s.%1$I = t.%1$I', btrim(k)), ' AND ')
    into v_join
    from unnest(v_bk_cols) k;

  execute format($q$
    select count(*) filter (where t.%1$I is null),
           count(*) filter (where t.%1$I is not null)
      from stg_antam.%2$I s
      left join %3$I.%4$I t on %5$s
  $q$, btrim(v_bk_cols[1]), v_stg_tbl, c.tgt_schema, c.tgt_table, v_join)
  into v_new, v_exist;

  -- Simpan seluruh baris staging ke stg_antam.staging_data_history dengan status delta akurat
  execute format($q$
    insert into stg_antam.staging_data_history (
      run_id, config_id, table_name, business_key_columns, business_key_value,
      delta_status, payload, staged_at
    )
    select 
      %1$s as run_id,
      %2$s as config_id,
      %3$L as table_name,
      %4$L as business_key_columns,
      %5$s as business_key_value,
      case when t.%6$I is null then 'NEW_DELTA' else 'ALREADY_IN_TARGET' end as delta_status,
      to_jsonb(s) as payload,
      now() as staged_at
    from stg_antam.%7$I s
    left join %8$I.%9$I t on %10$s
  $q$, p_run, p_cfg, v_stg_tbl, v_bk_str, v_bk_concat_s,
       btrim(v_bk_cols[1]), v_stg_tbl, c.tgt_schema, c.tgt_table, v_join);

  -- Update rows_new di migration_run agar tercatat presisi
  update ${schema}.migration_run
     set rows_new = v_new
   where run_id = p_run;

  call ${schema}.pr_log_step(p_run, p_cfg, 'DELTA', 'OK',
    format('delta dihitung (kunci: %s): %s baris baru (delta), %s baris sudah ada di target',
           v_bk_str, v_new, v_exist),
    null, null, v_new, 0, 0);

  return 0;

exception
  when others then
    get STACKED diagnostics v_det = PG_EXCEPTION_DETAIL;
    call ${schema}.pr_fail(p_run, p_cfg, 'DELTA', 'SQL_ERROR', sqlstate || ' ' || sqlerrm, v_det);
    return 1;
end $function$;
  `;

  await queryPostgres(fnCheckDeltaSql('mc_center'));
  await queryPostgres(fnCheckDeltaSql('etl_antam'));
  console.log('✓ Fungsi fn_check_delta di mc_center dan etl_antam berhasil diupdate.');

  console.log('--- Seluruh migrasi database selesai dengan sukses! ---');
  process.exit(0);
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
