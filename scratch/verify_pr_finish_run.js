require('dotenv').config({ path: '.env' });
const { queryPostgres } = require('../src/config/postgres');

async function scenario(name, logs) {
  const r = await queryPostgres(`INSERT INTO mc_center.migration_run (start_time,status,note,main_workflow) VALUES (now(),'RUNNING','test','__verify__') RETURNING run_id`);
  const runId = r.rows[0].run_id;
  for (const l of logs) {
    if (l[2] === 'ERR') {
      await queryPostgres(`CALL mc_center.pr_log_error($1::bigint,$2::int,$3::text,$4::text,$5::text,null)`, [runId, l[0], l[1], 'TEST_CODE', 'test err']);
    } else {
      await queryPostgres(`CALL mc_center.pr_log_step($1::bigint,$2::int,$3::text,$4::text,$5::text)`, [runId, l[0], l[1], l[2], name]);
    }
    await new Promise(r => setTimeout(r, 5));
  }
  await queryPostgres(`CALL mc_center.pr_finish_run($1::bigint,null,null)`, [runId]);
  const out = await queryPostgres(`SELECT status, note FROM mc_center.migration_run WHERE run_id=$1`, [runId]);
  console.log(`${name.padEnd(34)} -> ${out.rows[0].status}  | ${out.rows[0].note}`);
  await queryPostgres(`DELETE FROM mc_center.migration_error_log WHERE run_id=$1`, [runId]);
  await queryPostgres(`DELETE FROM mc_center.migration_step_log WHERE run_id=$1`, [runId]);
  await queryPostgres(`DELETE FROM mc_center.migration_run WHERE run_id=$1`, [runId]);
  return out.rows[0].status;
}

async function main() {
  const res = {};
  res.a = await scenario('A sukses bersih', [[2,'PRECHECK','OK'],[2,'STAGING','OK'],[2,'DELTA','OK']]);
  res.b = await scenario('B resume setelah interrupt', [[2,'RUN_INTERRUPTED','FAILED'],[2,'PRECHECK','OK'],[2,'STAGING','OK'],[2,'DELTA','OK']]);
  res.c = await scenario('C gagal nyata attempt terakhir', [[2,'PRECHECK','OK'],[2,'STAGING','FAILED']]);
  res.d = await scenario('D resume gagal lagi', [[2,'RUN_INTERRUPTED','FAILED'],[2,'PRECHECK','OK'],[2,'DELTA','FAILED']]);
  res.e = await scenario('E error_log attempt lama', [[2,'PRECHECK','OK'],[2,'STAGING','ERR'],[2,'STAGING','FAILED'],[2,'PRECHECK','OK'],[2,'STAGING','OK']]);
  res.f = await scenario('F error_log attempt baru', [[2,'PRECHECK','OK'],[2,'STAGING','ERR'],[2,'STAGING','OK']]);
  res.g = await scenario('G multi-config satu gagal', [[2,'PRECHECK','OK'],[2,'DELTA','OK'],[19,'PRECHECK','OK'],[19,'STAGING','FAILED']]);
  res.h = await scenario('H gagal sebelum precheck ok', [[2,'PRECHECK','FAILED']]);

  const expect = { a:'SUCCESS', b:'SUCCESS', c:'FAILED', d:'FAILED', e:'SUCCESS', f:'FAILED', g:'FAILED', h:'FAILED' };
  let ok = true;
  for (const k of Object.keys(expect)) {
    if (res[k] !== expect[k]) { ok = false; console.log(`MISMATCH ${k}: got ${res[k]} expected ${expect[k]}`); }
  }
  console.log(ok ? '\nSEMUA SKENARIO SESUAI' : '\nADA MISMATCH');
  process.exit(ok ? 0 : 1);
}
main().catch(e => { console.error(e.message); process.exit(1); });
