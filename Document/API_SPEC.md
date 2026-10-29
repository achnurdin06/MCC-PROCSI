# Spesifikasi REST API MCC-PROCSI

> Terakhir diperbarui: 29 Oktober 2026 · Sumber kebenaran: [`src/routes/api.js`](../src/routes/api.js) (88 route, prefix `/api`)

## 1. Konvensi

- **Autentikasi**: header `Authorization: Bearer <JWT>`. Pengecualian: `GET /api/flows/stream/:runId` (SSE) boleh memakai `?token=<JWT>` karena `EventSource` tidak mendukung header; endpoint lain menolak `?token=` (401).
- **Content-Type**: `application/json`, maksimum body 10 MB.
- **Format respons sukses**: `{ "success": true, "data": ..., "message": "..." }`
- **Format respons gagal**: `{ "success": false, "error": "pesan", "message": "pesan" }`
- **Kode status**: `200` OK, `201` dibuat, `400` input salah/ditolak guard, `401` token tidak ada/invalid/akun nonaktif, `403` peran tidak cukup, `429` rate limit, `500` error server.
- **Peran** (kolom *Akses*):
  - `Auth` = semua pengguna login (SUPERADMIN, OPERATOR, VIEWER)
  - `OPS` = `OPERATIONS` → SUPERADMIN + OPERATOR
  - `ADMIN` = SUPERADMIN saja
  - `Publik` = tanpa token

## 2. Autentikasi & Manajemen Pengguna (`/api/auth`)

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| GET | `/auth/captcha` | Publik (30 req/mnt) | Mengembalikan `{captchaId, svg}` |
| POST | `/auth/login` | Publik (10 req/mnt per IP+user) | Body: `username, password, captchaId, captchaAnswer` |
| POST | `/auth/register` | Publik (rate limit sama) | Akun dibuat **nonaktif** role `VIEWER`, menunggu persetujuan admin |
| POST | `/auth/forgot-password` | Publik | Respons selalu generik (anti-enumerasi) |
| POST | `/auth/logout` | Auth | Stateless; klien menghapus token |
| GET | `/auth/me` | Auth | Profil + role + izin |
| GET/POST | `/auth/users` | ADMIN | Daftar / buat user |
| PUT/DELETE | `/auth/users/:id` | ADMIN | Ubah / hapus user |
| POST/PUT | `/auth/users/:id/reset-password` | ADMIN | Reset password |
| GET/POST | `/auth/roles` | ADMIN | Daftar / buat role |
| PUT/DELETE | `/auth/roles/:id` | ADMIN | Ubah / hapus role |
| GET | `/auth/menus` | Auth | Daftar menu |
| POST | `/auth/menus` | ADMIN | Tambah menu |
| PUT/DELETE | `/auth/menus/:id` | ADMIN | Ubah / hapus menu |
| GET | `/auth/role-menus/:roleId` | Auth | Matriks izin menu per role |
| POST/PUT | `/auth/role-menus/:roleId` | ADMIN | Simpan matriks izin (`can_view/create/update/delete`) |

Contoh login:

```http
POST /api/auth/login
Content-Type: application/json

{ "username": "admin", "password": "••••", "captchaId": "…", "captchaAnswer": "7" }
```
```json
{ "success": true,
  "data": { "token": "<JWT>", "user": { "userId": 1, "username": "admin", "fullName": "…", "roleCode": "SUPERADMIN" } },
  "message": "Selamat datang kembali, …!" }
```

Field `username/captchaId/captchaAnswer/full_name/email` melewati `sqlInjectionGuard` (harus string ≤255 karakter, pola SQLi ditolak dengan 400).

## 3. Health & Konteks (`/api/health`, `/api/context`, `/api/settings`)

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| GET | `/health` | Publik | Status koneksi SQL Server & PostgreSQL + latensi |
| GET | `/context/status` | Publik/opsional token | Apakah wizard inisialisasi diperlukan |
| POST | `/context/init-wizard` | ADMIN | Inisialisasi client + environment + koneksi |
| GET | `/context/clients` | Auth | |
| POST/PUT/DELETE | `/context/clients[/:id]` | ADMIN | |
| GET | `/context/environments` | Auth | |
| GET | `/context/environments/:id/details` | Auth | Detail + koneksi (password dimasking) |
| GET | `/context/environments/:id/health` | Auth | |
| POST | `/context/environments/save-with-connections` | ADMIN | Simpan env + koneksi sekaligus |
| POST/PUT/DELETE | `/context/environments[/:id]` | ADMIN | |
| POST | `/context/environments/:id/sync-hop` · `/settings/environments/:id/sync-hop` | ADMIN | Tulis file config Apache Hop |
| GET | `/context/connections` | Auth | Kredensial **tidak pernah** dikembalikan plaintext |
| POST/PUT/DELETE | `/context/connections[/:id]` | ADMIN | Password dienkripsi `ENC:v1:` |
| POST | `/context/connections/test` | ADMIN | Uji koneksi (dengan proteksi SSRF) |

## 4. Source Data (`/api/source`)

| Method | Path | Akses |
|---|---|---|
| GET | `/source/views`, `/source/view-data`, `/source/view-definition` | Auth |
| POST | `/source/save-view-definition`, `/source/create-view`, `/source/validate-query`, `/source/sync-all-views` | ADMIN |
| DELETE | `/source/drop-view/:viewName` | ADMIN |

Query view divalidasi `assertReadOnlySelect` (hanya `SELECT/WITH`, tanpa DDL/DML, tanpa tabel `mc_center` sensitif).

## 5. ETL Config, Run & Log (`/api/etl`)

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| GET | `/etl/configs` | Auth | Semua tabel config (query `table`, filter client/env) |
| GET | `/etl/configs/export` | Auth | Ekspor JSON |
| POST | `/etl/configs/import` | ADMIN | Impor JSON (identifier divalidasi) |
| POST | `/etl/configs/test-precheck` | ADMIN | Uji `src_precheck_sql` (read-only) |
| GET/POST | `/etl/configs/migration_config/defaults` | Auth / OPS | Nilai default form |
| GET/POST | `/etl/configs/migration_target_config/defaults` | Auth / OPS | |
| POST | `/etl/configs/:table` | OPS | Insert (tabel dalam allowlist) |
| PUT/DELETE | `/etl/configs/:table/:id` | OPS | Update / hapus |
| GET | `/etl/overview` | Auth | Ringkasan dasbor |
| GET | `/etl/runs` | Auth | Riwayat `migration_run` (+ `is_stale`) |
| POST | `/etl/runs/:runId/cancel` | OPS | Batalkan run |
| POST | `/etl/runs/:runId/force-stop` | OPS | Paksa hentikan run macet |
| GET | `/etl/step-logs`, `/etl/error-logs` | Auth | Query `runId`, `configId` |

## 6. Rekonsiliasi (`/api/reconciliation`) — semua `Auth`

`GET` : `/pipeline`, `/config-details`, `/stage-data`, `/compare`, `/berita-acara`, `/staging-history`, `/staging-history/runs`.

## 7. Flow Orchestrator (`/api/flows`)

| Method | Path | Akses | Keterangan |
|---|---|---|---|
| GET | `/flows/presets` | Auth | Template graf flow 1–4 |
| POST | `/flows/execute` | OPS | Jalankan flow async → `{runId}` |
| POST | `/flows/flow-1-staging` · `flow-2-post` · `flow-3-rollback` · `flow-4-purge` | OPS | Jalur langsung per flow |
| POST | `/flows/flow-4-purge-preview` | OPS | Pratinjau purge tanpa menghapus |
| GET | `/flows/stream/:runId` | Auth (`?token=` diizinkan) | SSE log live |
| GET | `/flows/error-diagnostic/:runId` | Auth | Diagnosa akar masalah |

Contoh eksekusi:

```http
POST /api/flows/execute
{ "flowId": "flow_1_staging", "configIds": [1,2], "clientId": 1, "envId": 1, "params": {} }
```
`configIds` menerima array, string `"1,2"`, angka tunggal, atau `"ALL"`. Untuk Flow 2/3 sertakan `runId`/`runIds` (run Flow 1 yang akan diposting/di-rollback). Respons segera berisi `runId`; buka `/api/flows/stream/<runId>?token=<JWT>`.

Event SSE: `data: {"type":"CONNECTED",...}` lalu event node (mulai/selesai/log/error) hingga status akhir.

## 8. Legacy

| Method | Path | Akses |
|---|---|---|
| GET | `/tables`, `/summary` | Auth |
| GET | `/data` | ADMIN |

Browse tabel `sys_users`, `sys_roles`, `master_connection` diblokir di `migration.service.js`.

## 9. Rate Limit

| Limiter | Endpoint | Batas |
|---|---|---|
| `captchaRateLimiter` | `/auth/captcha` | 30 / menit / IP |
| `loginRateLimiter` | login, register, forgot-password | 10 / menit / (IP + username) |

Jendela *sliding* 1 menit, disimpan in-memory; melebihi batas → `429`.
