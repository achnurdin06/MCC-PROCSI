const { queryPostgres } = require('../src/config/postgres');

function getSql(schema) {
  return `
CREATE OR REPLACE FUNCTION ${schema}.fn_convert_staging(p_run bigint, p_cfg integer)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
declare
  c mc_center.migration_config%ROWTYPE;
  r record;
  v_src text;
  v_ms text;
  v_ss text;
  v_ss2 text;
  v_mf text;
  v_from text;
  v_stg_tbl text;
  v_cnt bigint;
  v_fail boolean := false;
  v_n int := 0;
  v_type text;
  v_cast text;
  v_fb text;
  v_extra text;
  v_notnull boolean;
  v_det text;
  v_master_tbl text;
begin
  call mc_center.pr_log_step(p_run, p_cfg, 'CONVERT', 'START');

  select * into c from mc_center.migration_config where config_id = p_cfg;
  v_stg_tbl := case
    when c.stg_table like '%_src' then c.stg_table
    else c.stg_table || '_src'
  end;

  for r in select * from mc_center.vw_convert_rule where config_id = p_cfg order by rule_id loop
    v_src := coalesce(nullif(btrim(r.source_column), ''), r.column_name);
    v_ms := case
      when r.normalize then format('upper(btrim(m.%I::text))', r.master_src_col)
      else format('m.%I::text', r.master_src_col)
    end;
    v_ss := case
      when r.normalize then format('upper(btrim(s.%I::text))', v_src)
      else format('s.%I::text', v_src)
    end;
    v_mf := case
      when r.master_filter is not null and btrim(r.master_filter) <> '' then ' AND (' || r.master_filter || ')'
      else ''
    end;

    v_master_tbl := case
      when r.master_schema = 'vendor' and r.master_table in ('vendors', 'slave_vendors') and to_regclass('stg_antam.stg_vendors_src') is not null then
        format('(SELECT id, vendor_reference_id, status FROM %I.%I UNION ALL SELECT id, vendor_reference_id, ''y''::varchar as status FROM stg_antam.stg_vendors_src WHERE id IS NOT NULL AND vendor_reference_id IS NOT NULL)', r.master_schema, r.master_table)
      else
        format('%I.%I', r.master_schema, r.master_table)
    end;

    if r.on_unmapped = 'FAIL' then
      v_from := format('stg_antam.%I s LEFT JOIN %s m ON %s = %s%s WHERE s.%I IS NOT NULL AND m.%I IS NULL',
                       v_stg_tbl, v_master_tbl, v_ms, v_ss, v_mf, v_src, r.master_src_col);
      execute 'SELECT count(*) FROM ' || v_from into v_cnt;
      if v_cnt > 0 then
        v_fail := true;
        execute format($q$
          insert into mc_center.migration_error_log
            (run_id, config_id, step_name, error_code, error_message, error_field, row_data)
          select %L, %L, 'CONVERT', 'UNMAPPED_CODE', %L, %L, s.%I::text || ' (' || count(*) || ' baris)'
            from %s group by s.%I order by count(*) desc limit 100
        $q$, p_run, p_cfg,
             format('kode tidak ada di master %s.%s', r.master_schema, r.master_table),
             v_src, v_src, v_from, v_src);
      end if;
    end if;
  end loop;

  if v_fail then
    call mc_center.pr_fail(p_run, p_cfg, 'CONVERT', 'UNMAPPED_CODE',
         'ada kode sumber yang tidak ditemukan di master; lihat baris UNMAPPED_CODE di migration_error_log');
    return 1;
  end if;

  for r in select * from mc_center.vw_convert_rule where config_id = p_cfg order by rule_id loop
    v_src := coalesce(nullif(btrim(r.source_column), ''), r.column_name);
    v_ms := case
      when r.normalize then format('upper(btrim(m.%I::text))', r.master_src_col)
      else format('m.%I::text', r.master_src_col)
    end;
    v_ss2 := case
      when r.normalize then format('upper(btrim(s2.%I::text))', v_src)
      else format('s2.%I::text', v_src)
    end;
    v_mf := case
      when r.master_filter is not null and btrim(r.master_filter) <> '' then ' AND (' || r.master_filter || ')'
      else ''
    end;
    v_fb := case
      when r.on_unmapped = 'DEFAULT' then quote_nullable(r.default_value)
      else 'NULL'
    end;

    v_master_tbl := case
      when r.master_schema = 'vendor' and r.master_table in ('vendors', 'slave_vendors') and to_regclass('stg_antam.stg_vendors_src') is not null then
        format('(SELECT id, vendor_reference_id, status FROM %I.%I UNION ALL SELECT id, vendor_reference_id, ''y''::varchar as status FROM stg_antam.stg_vendors_src WHERE id IS NOT NULL AND vendor_reference_id IS NOT NULL)', r.master_schema, r.master_table)
      else
        format('%I.%I', r.master_schema, r.master_table)
    end;

    if v_src = r.column_name then
      v_cast := '';
      v_extra := format('AND s.%I IS NOT NULL', v_src);
    else
      select format_type(a.atttypid, a.atttypmod) into v_type
      from pg_attribute a
      where a.attrelid = to_regclass(format('%I.%I', c.tgt_schema, c.tgt_table))
        and a.attname = r.column_name and not a.attisdropped;
      v_cast := '::' || v_type;
      v_extra := '';
    end if;

    execute format($q$
      update stg_antam.%1$I s set %2$I = coalesce(x.v, %3$s)%4$s
        from (select distinct on (s2.ctid) s2.ctid as rid, m.%5$I::text as v
                from stg_antam.%1$I s2
                left join %6$s m on %7$s = %8$s%9$s
               order by s2.ctid) x
       where s.ctid = x.rid %10$s
    $q$, v_stg_tbl, r.column_name, v_fb, v_cast, r.master_tgt_col,
         v_master_tbl, v_ms, v_ss2, v_mf, v_extra);

    v_n := v_n + 1;

    if v_src = r.column_name then
      select format_type(a.atttypid, a.atttypmod) into v_type
      from pg_attribute a
      where a.attrelid = to_regclass(format('%I.%I', c.tgt_schema, c.tgt_table))
        and a.attname = r.column_name and not a.attisdropped;

      execute format('ALTER TABLE stg_antam.%1$I ALTER COLUMN %2$I TYPE %3$s USING %2$I::%3$s',
                     v_stg_tbl, r.column_name, v_type);
    end if;

    select a.attnotnull into v_notnull
    from pg_attribute a
    where a.attrelid = to_regclass(format('%I.%I', c.tgt_schema, c.tgt_table))
      and a.attname = r.column_name and not a.attisdropped;

    if v_notnull then
      execute format('SELECT count(*) FROM stg_antam.%I WHERE %I IS NULL', v_stg_tbl, r.column_name) into v_cnt;
      if v_cnt > 0 then
        v_fail := true;
        execute format($q$
          insert into mc_center.migration_error_log
            (run_id, config_id, step_name, error_code, error_message, error_field, row_data)
          select %L, %L, 'CONVERT', 'NULL_AFTER_CONVERT', %L, %L,
                 coalesce(%I::text, '(NULL)') || ' (' || count(*) || ' baris)'
            from stg_antam.%I where %I is null group by %I order by count(*) desc limit 100
        $q$, p_run, p_cfg, 'kolom target NOT NULL tetapi hasil konversi kosong', r.column_name,
             v_src, v_stg_tbl, r.column_name, v_src);
      end if;
    end if;
  end loop;

  for r in select distinct source_column as col from mc_center.vw_convert_rule
           where config_id = p_cfg and source_column is not null and source_column <> column_name loop
    if not exists (
      select 1 from information_schema.columns ic
      where ic.table_schema = c.tgt_schema and ic.table_name = c.tgt_table and ic.column_name = r.col
    ) then
      execute format('ALTER TABLE stg_antam.%I DROP COLUMN IF EXISTS %I', v_stg_tbl, r.col);
    end if;
  end loop;

  if v_fail then
    call mc_center.pr_fail(p_run, p_cfg, 'CONVERT', 'NULL_AFTER_CONVERT',
         'ada kolom target NOT NULL yang kosong setelah konversi; lihat migration_error_log');
    return 1;
  end if;

  call mc_center.pr_log_step(p_run, p_cfg, 'CONVERT', 'OK', format('%s aturan konversi diterapkan', v_n));
  return 0;

exception
  when others then
    get STACKED diagnostics v_det = PG_EXCEPTION_DETAIL;
    call mc_center.pr_fail(p_run, p_cfg, 'CONVERT', 'SQL_ERROR', sqlstate || ' ' || sqlerrm, v_det);
    return 1;
end $function$;
`;
}

async function apply() {
  console.log('Updating mc_center.fn_convert_staging...');
  await queryPostgres(getSql('mc_center'));
  console.log('Updating etl_antam.fn_convert_staging...');
  await queryPostgres(getSql('etl_antam'));
  console.log('fn_convert_staging updated successfully in both schemas.');
  process.exit(0);
}

apply().catch(e => { console.error('Error applying fn_convert_staging:', e); process.exit(1); });
