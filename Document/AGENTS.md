# AGENTS.md — Panduan untuk AI Coding Assistant

> Baca berkas ini pertama kali. Salinan penunjuk ada di [`/AGENTS.md`](../AGENTS.md) (root) agar terdeteksi otomatis oleh tool AI.

## 1. Proyek dalam 5 Kalimat

MCC-PROCSI adalah dashboard Node.js/Express 5 (frontend vanilla JS) untuk mengorkestrasi migrasi data **multi-database → PostgreSQL** (PT Antam; driver aktif saat ini: SQL Server & PostgreSQL) dalam 3 tier: Source → Staging (`stg_antam`) → Target (`vendor`). Semua metadata, log, user, dan fungsi ETL ada di skema `mc_center`. Ada 4 flow: Staging, Post, Rollback, Purge, dijalankan DAG engine dengan log live via SSE. Akses dikendalikan JWT + RBAC (SUPERADMIN, OPERATOR, VIEWER). Bahasa UI, pesan error, dan dokumentasi: **Indonesia**.

## 2. Peta Dokumen (baca sesuai tugas)

| Tugas | Baca |
|---|---|
| Memahami struktur & alur | [ARCHITECTURE.md](./ARCHITECTURE.md) |
| Menambah/ubah endpoint | [API_SPEC.md](./API_SPEC.md), [security.md](./security.md) |
| Menyentuh tabel/fungsi SQL | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) |
| Logika Flow 1–4, menambah entitas migrasi | [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md) |
| Env, secret, start | [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) |
| Rilis/server | [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) |
| Alasan desain | [DECISION_LOG.md](./DECISION_LOG.md) |
| Konvensi & PR | [CONTRIBUTING.md](./CONTRIBUTING.md) |
| Hasil uji & kelemahan | [TESTING_REPORT.md](./TESTING_REPORT.md), [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md#8-kelemahan-yang-diketahui-status-mitigasi--roadmap) |
| Panduan pengguna akhir | [USER_GUIDE.md](./USER_GUIDE.md) |

## 3. Perintah

```bash
npm ci                 # pasang dependensi
npm run dev            # nodemon, development (port 3000)
npm run start:dev      # paksa .env.development
npm run start:prod     # paksa .env.production  (JANGAN dari laptop)
npm audit --omit=dev   # harus 0 kerentanan
curl localhost:3000/api/health
```
Tidak ada test runner otomatis; verifikasi dengan curl/browser (lihat [CONTRIBUTING.md](./CONTRIBUTING.md#5-pengujian)).

## 4. Peta Kode

- Route + guard: [`src/routes/api.js`](../src/routes/api.js) → controller di `src/controllers/` → service di `src/services/`.
- DB: `queryPostgres(sql, params)` dari [`src/config/postgres.js`](../src/config/postgres.js) (**bukan** `.query`). SQL Server: `src/config/sqlserver.js` (+ `tunnel.js`).
- Auth: [`auth.middleware.js`](../src/middleware/auth.middleware.js) (`requireAuth`, `optionalAuth`, `requireRole`), [`jwt.js`](../src/utils/jwt.js), [`encryption.js`](../src/utils/encryption.js), [`sql-guard.js`](../src/utils/sql-guard.js).
- DAG & flow: [`dag-engine.service.js`](../src/services/dag-engine.service.js) (preset `flow_1_staging`…`flow_4_purge`).
- Frontend: [`src/public/js/app.js`](../src/public/js/app.js) (SPA; `authFetch`, `initAuth`), [`flow-canvas.js`](../src/public/js/flow-canvas.js).

## 5. ATURAN WAJIB (Do)

1. SQL **selalu terparameter**. Nama tabel/kolom dinamis → `assertSafeIdentifier`; SQL dari user → `assertReadOnlySelect`.
2. Route baru: `requireAuth` + `ADMIN`/`OPERATIONS` untuk tulis; update [API_SPEC.md](./API_SPEC.md).
3. Respons JSON `{ success, data|error, message }`; pesan error berbahasa Indonesia, tanpa stack trace.
4. Frontend memanggil API **hanya via `authFetch()`**.
5. Setiap variabel env baru → `.env.example` + [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md).
6. Perubahan DB/fungsi → catat di [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) dan [CHANGELOG.md](./CHANGELOG.md); uji di DB **dev** dulu.
7. Perubahan kecil dan terarah; jangan refactor tak terkait.
8. Jaga dokumen tetap sinkron dengan kode pada perubahan yang sama.

## 6. LARANGAN (Don't)

1. Jangan commit/menampilkan `.env*`, password, token, `ENCRYPTION_MASTER_KEY`, `JWT_SECRET`.
2. Jangan menambahkan fallback hardcoded untuk secret.
3. Jangan menjalankan Flow 2/3/4 atau DDL ke **database produksi** tanpa instruksi eksplisit.
4. Jangan menjalankan lebih dari 1 instance proses (state in-memory) — lihat [DL-05](./DECISION_LOG.md).
5. Jangan menerima `?token=` di endpoint selain `/api/flows/stream/:runId`.
6. Jangan menghapus guard `ALREADY_POSTED`/`ALREADY_ROLLED_BACK` atau mengutak-atik flag `is_posted`/`is_rolled_back` manual.
7. Jangan mengekspos tabel `sys_users`, `sys_roles`, `master_connection` lewat browse/API generik.
8. Jangan `git push` / merge ke `main` tanpa diminta; branch kerja default `dev`.
9. Jangan mengembalikan kredensial plaintext di respons API.

## 7. Jebakan yang Pernah Terjadi (Gotchas)

| Gejala | Penyebab | Solusi/lokasi |
|---|---|---|
| Insert/update menu gagal | Body string tanpa `Content-Type` → `express.json` tidak parse | `authFetch` kini set otomatis; jangan bypass dengan `fetch` langsung |
| Refresh → tampil login | `initAuth` menghapus token pada error sementara | Retry 3×, hapus token hanya saat 401/403; kelas `auth-pending` |
| `ENOENT …/src/public/index.html` | Server jalan dari folder lama | Jalankan dari root repo `MCC-PROCSI` |
| Lokal memakai DB prod | Branch `main` di laptop | Pakai `dev`; lihat [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) |
| `migration_run.config_id` string | Kolom TEXT berisi `"1,2,3"` | Pecah dengan `string_to_array`; hati-hati koma pada Flow 2 multi-config |
| Log SSE tertahan | Buffering Nginx | `proxy_buffering off` |
| Config 20 (Siujk) Flow 2 tidak memuat | Belum ada `migration_target_config` | Tambahkan target config |
| Rate limiter memblokir semua orang | `TRUST_PROXY` salah | Sesuaikan jumlah hop proxy |

## 8. Role & Guard Cepat

| Konstanta di `api.js` | Peran yang lolos |
|---|---|
| `ADMIN` | `SUPERADMIN` |
| `OPERATIONS` | `SUPERADMIN`, `OPERATOR` |
| (hanya `requireAuth`) | semua user login, termasuk `VIEWER` (baca) |

## 9. Definisi Selesai (Definition of Done)

- Berjalan lokal tanpa error di console server/browser, `/api/health` OK.
- Kasus 401 (tanpa token) dan 403 (role kurang) diuji pada endpoint terkait.
- Refresh halaman mempertahankan sesi.
- `npm audit --omit=dev` = 0.
- Dokumen terkait + CHANGELOG diperbarui. Tidak ada rahasia di diff.

## 10. Bila Ragu

Tanyakan dulu sebelum: mengubah skema DB, menyentuh logika posting/rollback/purge, mengubah model keamanan, atau menambah dependensi besar.
