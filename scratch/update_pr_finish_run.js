require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { queryPostgres } = require('../src/config/postgres');

async function main() {
  const sql = `
CREATE OR REPLACE PROCEDURE mc_center.pr_finish_run(IN p_run bigint, IN p_note text DEFAULT NULL::text, IN p_post_type text DEFAULT NULL::text)
LANGUAGE plpgsql
AS $procedure$
declare 
  v_total int;
  v_fail int;
  v_err int;
  v_status text;
  v_total_posted bigint := 0;
  v_summary_det text;
begin
  if p_post_type is not null then
    select count(distinct config_id), count(distinct config_id) filter (where status = 'FAILED')
      into v_total, v_fail
      from mc_center.migration_step_log
     where run_id = p_run and step_name like 'POST%';

    select count(*)
      into v_err
      from mc_center.migration_error_log
     where run_id = p_run and step_name like 'POST%';

    select coalesce(sum(rows_new), 0)
      into v_total_posted
      from mc_center.migration_step_log
     where run_id = p_run and step_name = 'POST_TARGET' and status = 'OK' and rows_before is not null;

    select string_agg(format('%s (+%s)', regexp_replace(message, '.*selesai post ke ([^ ]+).*', '\\1'), rows_new), ', ')
      into v_summary_det
      from mc_center.migration_step_log
     where run_id = p_run and step_name = 'POST_TARGET' and status = 'OK' and rows_before is not null;

    if (v_fail > 0 or v_err > 0) then
      v_status := 'FAILED';
    else
      v_status := 'SUCCESS';
    end if;

    update mc_center.migration_run
       set end_time = now(),
           status = v_status,
           is_posted = (v_status = 'SUCCESS' and v_total_posted > 0),
           posted_at = case when v_status = 'SUCCESS' and v_total_posted > 0 then now() else null end,
           post_type = case when v_status = 'SUCCESS' and v_total_posted > 0 then p_post_type else null end,
           note = coalesce(
             case when v_status = 'SUCCESS' and v_summary_det is not null 
                  then format('wf_post selesai (mode %s): total +%s baris diposting [%s]', p_post_type, v_total_posted, v_summary_det)
                  else p_note end,
             format('Posting selesai (mode %s): %s baris diposting', p_post_type, v_total_posted)
           )
     where run_id = p_run;
  else
    select count(distinct config_id), count(distinct config_id) filter (where status = 'FAILED')
      into v_total, v_fail
      from mc_center.migration_step_log
     where run_id = p_run and step_name not like 'POST%' and step_name not like 'ROLLBACK%';

    select count(*)
      into v_err
      from mc_center.migration_error_log
     where run_id = p_run and step_name not like 'POST%' and step_name not like 'ROLLBACK%';

    if (v_fail > 0 or v_err > 0) then
      v_status := 'FAILED';
    else
      v_status := 'SUCCESS';
    end if;

    update mc_center.migration_run
       set end_time = now(),
           status = v_status,
           note = coalesce(p_note, format('%s tabel diproses, %s gagal', coalesce(v_total, 0), coalesce(v_fail, 0) + case when v_err > 0 and v_fail = 0 then 1 else 0 end))
     where run_id = p_run;
  end if;
end $procedure$;
  `;
  await queryPostgres(sql);
  await queryPostgres("UPDATE mc_center.migration_run SET is_posted = false, posted_at = null WHERE run_id = 217");
  console.log('Updated pr_finish_run and Run 217 is_posted = false successfully.');
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
