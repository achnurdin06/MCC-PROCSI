# Skema Database MCC-PROCSI

> Terakhir diperbarui: 29 Oktober 2026 · Sumber: introspeksi langsung PostgreSQL 17 (host dev `<HOST_DEV>:<PORT>`)

Database aplikasi memiliki tiga skema yang relevan:

| Skema | Fungsi |
|---|---|
| `mc_center` | Kontrol: master data, konfigurasi migrasi, log run, user/RBAC, fungsi & prosedur ETL |
| `stg_antam` | Staging: salinan data source + riwayat delta |
| `vendor` (± `public`) | Target: ±300 tabel operasional aplikasi Procsi (`slave_*` dan tabel final) |

> Catatan: skema `mc_center` **tidak memakai FOREIGN KEY formal**; relasi dijaga oleh aplikasi dan fungsi `fn_*`. Jangan menghapus baris induk tanpa memeriksa relasi di bawah.

## 1. ERD Logis `mc_center`

```
master_client 1─* master_environment 1─* master_connection
      │                  │
      │                  └──< master_source_view (client_id, env_id, connection_id)
      │
      ├──< migration_config 1─* migration_target_config
      │          │  └────* migration_convert_rule ──(lookup_name)──> migration_lookup
      │          │
      │          └──(config_id)──< migration_run? (config_id bertipe TEXT, daftar "1,2,3")
      │
      migration_run 1─* migration_step_log
                    1─* migration_error_log

sys_roles 1─* sys_users ─< sys_user_clients >─ master_client
                       └─< sys_user_environments >─ master_environment
sys_roles ─< sys_role_menus >─ sys_menus
```

## 2. Tabel Master

| Tabel | Kolom kunci | Keterangan |
|---|---|---|
| `master_client` | `client_id`, `client_code`, `client_name`, `is_active` | Tenant (mis. PT Antam) |
| `master_environment` | `env_id`, `client_id`, `env_code`, `env_name` | DEVELOPMENT / STAGING / PRODUCTION |
| `master_connection` | `connection_id`, `env_id`, `connection_name`, `db_type`, `db_role`, `host`, `port`, `database_name`, `db_schema`, `username`, `password`, `use_ssh_tunnel`, `ssh_host/port/user/password` | Password & SSH password tersimpan `ENC:v1:<iv>:<tag>:<cipher>` (AES-256-GCM). `db_role` membedakan source/target |
| `master_source_view` | `view_id`, `client_id`, `env_id`, `connection_id`, `schema_name`, `view_name`, `query_sql`, `is_active`, `is_synced`, `last_synced_at` | Katalog view SQL Server |

## 3. Konfigurasi Migrasi

| Tabel | Kolom penting | Keterangan |
|---|---|---|
| `migration_config` | `config_id`, `name_config`, `exec_order`, `src_schema`, `src_view`, `stg_table`, `tgt_schema`, `tgt_table`, `pk_columns`, `business_keys`, `compare_columns`, `id_column`, `id_width`, `id_seed`, `src_precheck_sql`, `error_policy`, `is_active`, `client_id`, `env_id` | Satu baris = satu entitas yang dimigrasikan |
| `migration_target_config` | `target_config_id`, `config_id`, `exec_order`, `tgt_schema`, `tgt_table`, `pk_columns`, `mapping_sql`, `precheck_sql`, `postcheck_sql`, `rollback_sql`, `is_active` | Satu config → N tabel target (urut `exec_order`). `mapping_sql` dibangun otomatis oleh trigger `trg_fn_auto_mapping_target_config` |
| `migration_convert_rule` | `rule_id`, `config_id`, `column_name`, `source_column`, `lookup_name`, `master_*`, `on_unmapped`, `default_value`, `normalize`, `is_active` | Aturan konversi kolom staging (lookup, default, normalisasi) |
| `migration_lookup` | `lookup_name`, `master_schema`, `master_table`, `master_src_col`, `master_tgt_col`, `master_filter`, `on_unmapped`, `default_value`, `normalize` | Kamus referensi |
| `vw_convert_rule` | — | View gabungan rule + lookup |

### Config aktif saat ini (8)

| ID | Nama | View sumber | Staging (`stg_antam`) | Target |
|---|---|---|---|---|
| 1 | Vendor | `v_migration_vendor` | `stg_vendors_src` | `slave_vendors`, `vendors` |
| 2 | Akta Perusahaan | `v_vendor_akta` | `stg_akta_src` | `slave_akta_perusahaan`, `akta_perusahaan` |
| 15 | Vendor Address | `v_vendor_address` | `stg_address_src` | `slave_vendor_address`, `vendor_address` |
| 19 | Vendor User | `v_vendor_user` | `stg_user_src` | `public.users` |
| 20 | Vendor Siujk | `v_vendor_siujk` | `stg_siujk_src` | `slave_surat_izin_siujk` (**belum ada `migration_target_config`** → Flow 2 tidak memuat apa pun) |
| 21 | Vendor Siup | `v_vendor_siup` | `stg_siup_src` | `slave_surat_izin_siup`, `surat_izin_siup` |
| 22 | Vendor Tdp | `v_vendor_tdp` | `stg_tdp_src` | `slave_surat_izin_tdp`, `surat_izin_tdp` |
| 23 | Vendor Bank | `v_vendor_bank` | `stg_bank_src` | `slave_rekening_bank`, `rekening_bank` |

## 4. Eksekusi & Log

| Tabel | Kolom penting |
|---|---|
| `migration_run` | `run_id`, `run_ts`, `start_time`, `end_time`, `status` (`RUNNING`, `SUCCESS`, `FAILED`, dst.), `config_id` (**TEXT**), `main_workflow`, `hop_host`, `note`, `is_posted`, `posted_at`, `post_type`, `is_rolled_back`, `rolled_back_at`, `client_id`, `env_id` |
| `migration_step_log` | `log_id`, `run_id`, `config_id`, `step_name`, `status`, `rows_src`, `rows_stg`, `rows_new`, `rows_changed`, `rows_deleted`, `rows_before`, `rows_after`, `start_time`, `end_time`, `message` |
| `migration_error_log` | `error_id`, `run_id`, `config_id`, `step_name`, `pipeline_name`, `transform_name`, `error_time`, `error_code`, `error_message`, `error_detail`, `error_field`, `row_data` (JSON sampel baris) |

## 5. Pengguna & RBAC

| Tabel | Keterangan |
|---|---|
| `sys_roles` | `role_id`, `role_code`, `role_name`, `is_active`. Seed: `SUPERADMIN`, `OPERATOR`, `VIEWER` |
| `sys_users` | `user_id`, `username`, `password_hash` (`pbkdf2:210000:<salt>:<hash>`), `full_name`, `email`, `role_id`, `is_active`, `last_login_at`, `client_id`, `env_id` |
| `sys_user_clients`, `sys_user_environments` | Pembatasan akses data per client/env |
| `sys_menus` | `menu_id`, `menu_code`, `menu_name`, `menu_icon`, `menu_order`, `route_tab`, `sub_title`, `content_html`, `is_custom`, `is_active` |
| `sys_role_menus` | `role_id`, `menu_id`, `can_view/create/update/delete` |

Menu bawaan: `TAB_SOURCE`, `TAB_CONFIG`, `TAB_PROCESS` (Workflow Canvas), `TAB_PIPELINE`, `TAB_SYSTEM`, `TAB_USERGUIDE`; menu kustom: `MENU_SOP` (`is_custom = true`, konten HTML).

## 6. Fungsi & Prosedur ETL (`mc_center`)

| Kelompok | Objek |
|---|---|
| Staging | `fn_prepare_staging`, `fn_check_staging`, `fn_check_delta`, `fn_convert_staging`, `fn_check_convert_config` |
| Enkripsi staging | `fn_encrypt_staging`, `fn_decrypt_staging` |
| Posting | `fn_validate_post_run`, `fn_precheck_target`, `fn_post_target_dispatch`, `fn_post_all_targets` |
| Rollback | `fn_validate_rollback_run`, `fn_validate_rollback_trigger`, `fn_rollback_target_dispatch`, `fn_rollback_all_targets` |
| Purge | `fn_purge_target_data` |
| Mapping | `fn_build_target_mapping_sql`, `fn_refresh_target_mapping_sql`, `trg_fn_auto_mapping_target_config` |
| Validasi | `fn_validate_config_selection`, `fn_int8_to_bool` |
| Logging | `pr_log_step`, `pr_log_error`, `pr_finish_run`, `pr_finish_rollback_run`, `pr_fail` |

## 7. Skema `stg_antam`

Tabel: `stg_vendors_src`, `stg_akta_src`, `stg_address_src`, `stg_user_src`, `stg_siujk_src`, `stg_siup_src`, `stg_tdp_src`, `stg_bank_src`, serta **`staging_data_history`**:

`history_id, run_id, config_id, table_name, business_key_columns, business_key_value, delta_status, payload (JSON), staged_at` — menyimpan riwayat baris per run untuk deteksi delta (`NEW_DELTA` = belum ada di target, `ALREADY_IN_TARGET` = sudah ada) dan acuan rollback/purge.

## 8. Perubahan Skema

Skrip DDL historis ada di [`backup/scratch/`](../backup/scratch) (mis. `update_pr_finish_run*.js`, `apply_staging_improvements.js`). Tidak ada tool migrasi otomatis; setiap perubahan fungsi/tabel harus:
1. dicoba di database **dev** (`.env.development`),
2. didokumentasikan di [CHANGELOG.md](./CHANGELOG.md),
3. diterapkan manual ke produksi saat rilis.
