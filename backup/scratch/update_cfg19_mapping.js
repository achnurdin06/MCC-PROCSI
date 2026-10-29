const { queryPostgres } = require('../src/config/postgres');

async function run() {
  const newMappingSql = `INSERT into public.users (
  id, uuid, name, username, email, password, is_developer, status, created_by, updated_by, created_at, updated_at, verification_at, purchasing_org_id, work_unit_id, general_planner_id, specific_planner_id, company_id, division_id, evaluator_id, jabatan, file_ttd, atasan_uuid, ad_id, departement_id, director_id, sort_key, salesperson, gr_based_inv_verification, srv_based_inv_verification, check_in_double_invoice, title, recc_account, planning_group, payment_terms, bank_keys, "grouping", nik, is_default_password, is_catalogue, employee_id, sso_provider, sso_id, work_location, position_title, is_plh, position_id, last_login_at, current_token, work_location_code, business_area, bureau_abbr, bureau_text, division_abbr, division_text
)
select 
  id, uuid, name, username, email, password, is_developer, status, created_by, updated_by, created_at, updated_at, verification_at, purchasing_org_id, work_unit_id, general_planner_id, specific_planner_id, company_id, division_id, evaluator_id, jabatan, file_ttd, atasan_uuid, ad_id, departement_id, director_id, sort_key, salesperson, gr_based_inv_verification, srv_based_inv_verification, check_in_double_invoice, title, recc_account, planning_group, payment_terms, bank_keys, "grouping", nik, is_default_password, is_catalogue, employee_id, sso_provider, sso_id, work_location, position_title, is_plh, position_id, last_login_at, current_token, work_location_code, business_area, bureau_abbr, bureau_text, division_abbr, division_text
from stg_antam.stg_user_src s
where not exists (
  select 1 from public.users t 
  where (t.id = s.id or t.username = s.username or (s.uuid is not null and t.uuid = s.uuid))
)`;

  const r1 = await queryPostgres(
    'UPDATE mc_center.migration_target_config SET mapping_sql = $1 WHERE config_id = 19',
    [newMappingSql]
  );
  const r2 = await queryPostgres(
    'UPDATE etl_antam.migration_target_config SET mapping_sql = $1 WHERE config_id = 19',
    [newMappingSql]
  );

  console.log('Updated mc_center:', r1.rowCount, 'etl_antam:', r2.rowCount);
}

run().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
