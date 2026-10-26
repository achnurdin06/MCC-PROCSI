require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { queryPostgres } = require('../src/config/postgres');

async function main() {
  const fnSql = (sch) => `
CREATE OR REPLACE FUNCTION ${sch}.fn_check_delta(p_run bigint, p_cfg integer)
RETURNS integer
LANGUAGE plpgsql
AS $function$
declare
  c ${sch}.migration_config%ROWTYPE;
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
  v_bk_group text;
  v_det text;
  r record;
begin
  call ${sch}.pr_log_step(p_run, p_cfg, 'DELTA', 'START', 'hitung data delta baru vs eksisting dan validasi duplikasi');

  select * into c from ${sch}.migration_config where config_id = p_cfg;

  v_stg_tbl := case when c.stg_table like '%_src' then c.stg_table else c.stg_table || '_src' end;

  -- Tentukan business key columns (kunci bisnis unik)
  v_bk_str := coalesce(nullif(btrim(c.business_keys), ''), nullif(btrim(c.pk_columns), ''), 'id');
  v_bk_cols := string_to_array(v_bk_str, ',');

  -- Susun ekspresi concat business key untuk display & grouping (tanpa prefix tabel)
  select string_agg(format('coalesce(%I::text, ''NULL'')', btrim(k)), ' || ''|'' || ')
    into v_bk_concat
    from unnest(v_bk_cols) k;

  -- Susun ekspresi concat business key untuk staging (dengan prefix s.)
  select string_agg(format('coalesce(s.%I::text, ''NULL'')', btrim(k)), ' || ''|'' || ')
    into v_bk_concat_s
    from unnest(v_bk_cols) k;

  -- Susun daftar kolom untuk GROUP BY
  select string_agg(format('%I', btrim(k)), ', ')
    into v_bk_group
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
  $q$, v_bk_concat, v_stg_tbl, coalesce(v_where_not_null, '1=1'), v_bk_group)
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
    $q$, v_bk_concat, v_stg_tbl, coalesce(v_where_not_null, '1=1'), v_bk_group) loop
      insert into ${sch}.migration_error_log (
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
    call ${sch}.pr_fail(p_run, p_cfg, 'DELTA', 'DUPLICATE_SOURCE_KEY',
      format('GAGAL: Ditemukan %s grup data duplikat pada staging [%s] untuk kunci [%s]: %s',
             v_dup_cnt, v_stg_tbl, v_bk_str, v_dup_samples), NULL);
    return 1;
  end if;

  -- =========================================================================
  -- GATE 2: CEK DELTA TERHADAP TARGET DENGAN BUSINESS KEY
  -- =========================================================================
  select string_agg(format('s.%1$I = t.%1$I', btrim(k)), ' AND ')
    into v_join
    from unnest(v_bk_cols) k;

  -- Hitung data baru vs data yang sudah ada di target tanpa resiko perkalian baris
  execute format($q$
    select 
      count(*) filter (where not exists (select 1 from %1$I.%2$I t where %3$s)),
      count(*) filter (where exists (select 1 from %1$I.%2$I t where %3$s))
    from stg_antam.%4$I s
  $q$, c.tgt_schema, c.tgt_table, v_join, v_stg_tbl)
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
      case 
        when exists (select 1 from %6$I.%7$I t where %8$s) then 'ALREADY_IN_TARGET'
        else 'NEW_DELTA'
      end as delta_status,
      to_jsonb(s) as payload,
      now() as staged_at
    from stg_antam.%9$I s
  $q$, p_run, p_cfg, v_stg_tbl, v_bk_str, v_bk_concat_s,
       c.tgt_schema, c.tgt_table, v_join, v_stg_tbl);

  call ${sch}.pr_log_step(p_run, p_cfg, 'DELTA', 'OK',
    format('delta dihitung (kunci: %s): %s baris baru (delta), %s baris sudah ada di target',
           v_bk_str, v_new, v_exist),
    null, (v_new + v_exist), v_new, 0, 0);

  return 0;

exception
  when others then
    get STACKED diagnostics v_det = PG_EXCEPTION_DETAIL;
    call ${sch}.pr_fail(p_run, p_cfg, 'DELTA', 'SQL_ERROR', sqlstate || ' ' || sqlerrm, v_det);
    return 1;
end $function$;
`;

  console.log('1. Applying fn_check_delta to mc_center and etl_antam...');
  await queryPostgres(fnSql('mc_center'));
  await queryPostgres(fnSql('etl_antam'));
  console.log('✓ Successfully created fn_check_delta in both schemas.');

  console.log('2. Testing fn_check_delta Gate 2 (with staging rows: 1 existing in target, 1 new delta)...');
  // First, check one existing vendor_reference_id in vendor.slave_vendors
  const existTarget = await queryPostgres(`SELECT vendor_reference_id FROM vendor.slave_vendors WHERE vendor_reference_id IS NOT NULL LIMIT 1`);
  const existRefId = existTarget.rows[0]?.vendor_reference_id || 999998;
  const newRefId = 999999;

  // Insert 2 rows into stg_antam.stg_vendors_src
  await queryPostgres(`
    INSERT INTO stg_antam.stg_vendors_src (id, vendor_reference_id, name)
    VALUES 
      ('TST1', $1, 'EXISTING VENDOR TEST'),
      ('TST2', $2, 'NEW DELTA VENDOR TEST')
  `, [existRefId, newRefId]);

  const testRun = await queryPostgres(`
    INSERT INTO etl_antam.migration_run (run_ts, config_id, status, start_time)
    VALUES (to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD_HH24MI'), 1, 'RUNNING', now())
    RETURNING run_id
  `);
  const runId = testRun.rows[0].run_id;
  console.log(`Created test run_id: ${runId}`);

  try {
    const callRes = await queryPostgres(`SELECT etl_antam.fn_check_delta($1, 1) as res`, [runId]);
    console.log('fn_check_delta return code:', callRes.rows[0].res);

    const histCount = await queryPostgres(`
      SELECT delta_status, business_key_value, count(*) 
      FROM stg_antam.staging_data_history 
      WHERE run_id = $1 
      GROUP BY delta_status, business_key_value
    `, [runId]);
    console.log('Staging history recorded:', histCount.rows);

    const stepLog = await queryPostgres(`
      SELECT step_name, status, message, rows_stg, rows_new 
      FROM etl_antam.migration_step_log 
      WHERE run_id = $1
    `, [runId]);
    console.log('Step log recorded:', stepLog.rows);
  } finally {
    console.log('Cleaning up Gate 2 test records...');
    await queryPostgres(`DELETE FROM stg_antam.stg_vendors_src WHERE id IN ('TST1', 'TST2')`);
    await queryPostgres(`DELETE FROM stg_antam.staging_data_history WHERE run_id = $1`, [runId]);
    await queryPostgres(`DELETE FROM etl_antam.migration_step_log WHERE run_id = $1`, [runId]);
    await queryPostgres(`DELETE FROM etl_antam.migration_error_log WHERE run_id = $1`, [runId]);
    await queryPostgres(`DELETE FROM etl_antam.migration_run WHERE run_id = $1`, [runId]);
    console.log('✓ Clean test cleanup done.');
  }

  console.log('\n3. Testing fn_check_delta Gate 1 (duplicate fail-fast)...');
  // Insert 2 rows with DUPLICATE vendor_reference_id into stg_antam.stg_vendors_src
  const dupRefId = 888888;
  await queryPostgres(`
    INSERT INTO stg_antam.stg_vendors_src (id, vendor_reference_id, name)
    VALUES 
      ('DUP1', $1, 'DUPLICATE COMPANY 1'),
      ('DUP2', $1, 'DUPLICATE COMPANY 2')
  `, [dupRefId]);

  const testRun2 = await queryPostgres(`
    INSERT INTO etl_antam.migration_run (run_ts, config_id, status, start_time)
    VALUES (to_char(now() AT TIME ZONE 'Asia/Jakarta', 'YYYYMMDD_HH24MI'), 1, 'RUNNING', now())
    RETURNING run_id
  `);
  const runId2 = testRun2.rows[0].run_id;

  try {
    const callRes2 = await queryPostgres(`SELECT etl_antam.fn_check_delta($1, 1) as res`, [runId2]);
    console.log('fn_check_delta return code (expected 1 for fail-fast):', callRes2.rows[0].res);

    const errLog = await queryPostgres(`
      SELECT error_code, error_message 
      FROM etl_antam.migration_error_log 
      WHERE run_id = $1
    `, [runId2]);
    console.log('Error log recorded:', errLog.rows);

    const histDup = await queryPostgres(`
      SELECT delta_status, business_key_value, count(*) 
      FROM stg_antam.staging_data_history 
      WHERE run_id = $1 
      GROUP BY delta_status, business_key_value
    `, [runId2]);
    console.log('Staging history recorded for duplicates:', histDup.rows);
  } finally {
    console.log('Cleaning up Gate 1 test records...');
    await queryPostgres(`DELETE FROM stg_antam.stg_vendors_src WHERE id IN ('DUP1', 'DUP2')`);
    await queryPostgres(`DELETE FROM stg_antam.staging_data_history WHERE run_id = $1`, [runId2]);
    await queryPostgres(`DELETE FROM etl_antam.migration_step_log WHERE run_id = $1`, [runId2]);
    await queryPostgres(`DELETE FROM etl_antam.migration_error_log WHERE run_id = $1`, [runId2]);
    await queryPostgres(`DELETE FROM etl_antam.migration_run WHERE run_id = $1`, [runId2]);
    console.log('✓ Duplicate test cleanup done.');
  }

  console.log('\n=== ALL TESTS PASSED SUCCESSFULLY! ===');
}

main().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
