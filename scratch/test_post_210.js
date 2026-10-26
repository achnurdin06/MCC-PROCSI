const { queryPostgres } = require('../src/config/postgres');

async function test() {
  console.log('Testing mc_center.fn_post_all_targets for Config 15...');
  const res15 = await queryPostgres('SELECT mc_center.fn_post_all_targets($1::bigint, $2::int, 1000, $3::text) as res', [210, 15, 'DIRECT']);
  console.log('Result Config 15:', res15.rows[0]);

  console.log('Testing mc_center.fn_post_all_targets for Config 19...');
  const res19 = await queryPostgres('SELECT mc_center.fn_post_all_targets($1::bigint, $2::int, 1000, $3::text) as res', [210, 19, 'DIRECT']);
  console.log('Result Config 19:', res19.rows[0]);
}

test().then(() => process.exit(0)).catch(e => { console.error('Error during test:', e); process.exit(1); });
