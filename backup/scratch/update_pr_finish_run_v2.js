require('dotenv').config({ path: '.env.development' });
require('dotenv').config({ path: '.env' });
const { queryPostgres } = require('../src/config/postgres');

// RES-01: hanya hasil percobaan (attempt) terakhir per config yang menentukan status run.
// Attempt dimulai dari PRECHECK OK terakhir milik config tsb; log lama tetap tersimpan untuk audit.
const OLD_BLOCK = `    select count(distinct config_id), count(distinct config_id) filter (where status = 'FAILED')
      into v_total, v_fail
      from mc_center.migration_step_log
     where run_id = p_run and step_name not like 'POST%' and step_name not like 'ROLLBACK%';

    select count(*)
      into v_err
      from mc_center.migration_error_log
     where run_id = p_run and step_name not like 'POST%' and step_name not like 'ROLLBACK%';
`;

const NEW_BLOCK = `    select count(distinct s.config_id),
           count(distinct s.config_id) filter (
             where s.status = 'FAILED'
               and s.log_id > coalesce((
                     select max(a.log_id) from mc_center.migration_step_log a
                      where a.run_id = s.run_id and a.config_id = s.config_id
                        and a.step_name = 'PRECHECK' and a.status = 'OK'), 0)
           )
      into v_total, v_fail
      from mc_center.migration_step_log s
     where s.run_id = p_run and s.step_name not like 'POST%' and s.step_name not like 'ROLLBACK%';

    select count(*)
      into v_err
      from mc_center.migration_error_log e
     where e.run_id = p_run and e.step_name not like 'POST%' and e.step_name not like 'ROLLBACK%'
       and not exists (
             select 1 from mc_center.migration_step_log a
              where a.run_id = e.run_id and a.config_id = e.config_id
                and a.step_name = 'PRECHECK' and a.status = 'OK'
                and a.end_time > e.error_time);
`;

async function main() {
  const r = await queryPostgres(`select pg_get_functiondef(p.oid) d from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='mc_center' and p.proname='pr_finish_run'`);
  const def = r.rows[0].d;
  if (def.includes('a.step_name = \'PRECHECK\'')) { console.log('Sudah versi baru, dilewati'); process.exit(0); }
  if (!def.includes(OLD_BLOCK)) throw new Error('Blok lama tidak ditemukan');
  await queryPostgres(def.replace(OLD_BLOCK, NEW_BLOCK));
  console.log('pr_finish_run diperbarui');
  process.exit(0);
}
main().catch(e => { console.error(e.message); process.exit(1); });
