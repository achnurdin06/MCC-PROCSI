# Arsitektur Sistem MCC-PROCSI

> Terakhir diperbarui: 29 Oktober 2026 · Sumber kebenaran: kode di folder [`src/`](../src)

## 1. Ringkasan

MCC-PROCSI (*Migration Command Center*) adalah aplikasi web monolit **Node.js v26.12.2+ (versi terbaru) / Express 5** dengan frontend **vanilla JS** (tanpa framework build). Aplikasi mengorkestrasi migrasi data **multi-database → PostgreSQL** (semua database sumber menuju PostgreSQL sebagai target tunggal) dalam 3 tier, memantau prosesnya secara real-time, dan merekonsiliasi hasilnya.


**Dukungan database sumber:** arsitektur dirancang untuk menerima *semua* jenis database sumber dan memindahkannya ke PostgreSQL. Tipe koneksi didefinisikan di `master_connection.db_type`. Driver yang **sudah aktif** di backend saat ini: SQL Server (`mssql`) dan PostgreSQL (`pg`). Opsi MySQL sudah ada di UI tetapi drivernya belum dipasang. Untuk tipe lain (Oracle, dsb.), driver perlu ditambahkan dahulu di `ingestion.service.js` / `source.service.js`.

```
Browser (SPA vanilla JS)
   │  HTTPS + JWT (Authorization: Bearer) ; SSE untuk log live
   ▼
[Nginx reverse proxy]  (proxy_buffering off untuk SSE)
   ▼
Express app (src/app.js)  ── Helmet CSP, CORS allowlist, JSON 10 MB
   │
   ├─ routes/api.js ── middleware: rate-limiter → input-guard → requireAuth → requireRole
   ├─ controllers/*  ── adaptor HTTP (validasi ringan, format respons)
   └─ services/*     ── logika bisnis + akses DB
          │
          ├─ config/postgres.js  → PostgreSQL (db_procsi: mc_center, stg_antam, vendor)
          ├─ config/sqlserver.js → SQL Server (antam_scm.dbo) [opsional via config/tunnel.js SSH]
          └─ Apache Hop config JSON (config/hop-configs/)
```

## 2. Aliran Data 3-Tier

| Tier | Lokasi | Isi |
|---|---|---|
| Source | SQL Server `antam_scm.dbo` | View `v_migration_vendor`, `v_vendor_*` |
| Staging | PostgreSQL `stg_antam` | `stg_*_src` + `staging_data_history` |
| Target | PostgreSQL `vendor` / `public` | `slave_*` dan tabel operasional |

Metadata, konfigurasi, log, user, dan kredensial terenkripsi berada di skema kontrol **`mc_center`** (lihat [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md)).

## 3. Struktur Folder

```
src/
├─ app.js                      bootstrap Express, Helmet, CORS, static, error handler
├─ config/
│  ├─ env.js                   resolusi .env (branch git → .env.development / .env.production)
│  ├─ postgres.js              pool pg + queryPostgres(sql, params)
│  ├─ sqlserver.js             pool mssql + dukungan tunnel
│  └─ tunnel.js                SSH tunnel ssh2 (keepalive 10 dtk)
├─ routes/api.js               seluruh route /api/* + guard peran (ADMIN, OPERATIONS)
├─ middleware/
│  ├─ auth.middleware.js       requireAuth, optionalAuth, requireRole
│  ├─ input-guard.middleware.js sqlInjectionGuard(fields)
│  └─ rate-limiter.middleware.js captchaRateLimiter, loginRateLimiter
├─ controllers/                auth, etl, flow-canvas, migration, pipeline, source
├─ services/
│  ├─ auth.service.js          login, register, user/role/menu CRUD
│  ├─ dag-engine.service.js    preset flow 1-4, eksekusi DAG, event SSE
│  ├─ db-dispatcher.service.js pemilihan koneksi per client/env
│  ├─ etl.service.js           config CRUD, run/step/error log, sweeper run basi
│  ├─ ingestion.service.js     database sumber → staging (streaming/batch)
│  ├─ migration.service.js     browse tabel (tabel sensitif diblokir)
│  ├─ pipeline.service.js      rekonsiliasi 3-tier, berita acara
│  ├─ purge-precheck.service.js preview Flow 4
│  └─ source.service.js        view SQL Server (DDL aman)
├─ utils/                      captcha, encryption (AES-GCM), jwt (+PBKDF2), sql-guard, error-formatter
└─ public/                     index.html, js/app.js, js/flow-canvas.js, css/*
```

## 4. Alur Request

1. `express.static` menyajikan SPA (header `no-store`).
2. Request `/api/*` → rate limiter (khusus auth) → `sqlInjectionGuard` (khusus auth) → `requireAuth`.
3. `requireAuth` memverifikasi JWT (HS256), lalu **query DB** untuk memastikan `is_active` dan `role_code` terbaru (akun yang dinonaktifkan langsung terputus).
4. `requireRole(['SUPERADMIN'])` (= `ADMIN`) atau `requireRole(['SUPERADMIN','OPERATOR'])` (= `OPERATIONS`).
5. Controller → service → `queryPostgres` / pool MSSQL (selalu query terparameter).
6. Error ditangani handler global dengan *correlation ID*; detail internal tidak bocor ke klien.

## 5. DAG Engine & Flow

`dag-engine.service.js` mendefinisikan graf node + edge per preset. Eksekusi **asynchronous**: `POST /api/flows/execute` mengembalikan `runId` segera; klien membuka `GET /api/flows/stream/:runId` (SSE) untuk menerima event JSON (`data: {...}\n\n`, tipe awal `CONNECTED`).

| Flow | Urutan node |
|---|---|
| `flow_1_staging` | CHECK_DB_PREREQ → INIT_AND_GET_CONFIG → LOOP_CONTROLLER → PRECHECK_SOURCE → PREPARE_STAGING → DATA_STREAM → CHECK_STAGING → DELTA_CHECK → CONVERT_LOOKUP |
| `flow_2_post` | VALIDATE_POST_GUARD → LOOP_CONTROLLER → PRECHECK_TARGET → POST_TARGETS → RECONCILIATION_AUDIT |
| `flow_3_rollback` | VALIDATE_ROLLBACK_GUARD → LOOP_CONTROLLER_RB → PRECHECK_ROLLBACK → ROLLBACK_TARGETS → AUDIT_ROLLBACK_RECORD |
| `flow_4_purge` | INIT_PURGE_SESSION → LOOP_CONTROLLER_PURGE → DUAL_GUARD_PURGE → PURGE_TARGET → RECONCILIATION_PURGE |

Detail bisnis tiap flow: [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md).

## 6. Keadaan In-Memory (penting untuk deployment)

Kunci eksekusi, status run aktif, buffer SSE, dan captcha disimpan **di memori proses**. Konsekuensi:
- Jalankan **satu instance saja** (PM2 `instances: 1`, mode `fork`).
- Restart server memutus run yang berjalan; *stale-run sweeper* (`STALE_RUN_MINUTES = 10` di `etl.service.js`) menandai run `RUNNING` tanpa aktivitas sebagai gagal/terinterupsi.

## 7. Konektivitas Eksternal

- **PostgreSQL** (kontrol + staging + target): satu pool, `APP_DB_*`.
- **SQL Server** (source): per koneksi di `mc_center.master_connection`; bisa lewat **SSH bastion tunnel** (`use_ssh_tunnel`), keepalive 10 dtk × 3.
- **Apache Hop**: file `config/hop-configs/<client>_<env>-config.json` dibuat otomatis (permission `0600`).

## 8. Frontend

SPA satu halaman ([index.html](../src/public/index.html), [app.js](../src/public/js/app.js)). Fakta penting:
- Token JWT di `localStorage` kunci `antam_token`; tab aktif di `antam_active_main_tab`.
- Semua panggilan API lewat `authFetch()` (menambah `Authorization`, dan `Content-Type: application/json` bila ada body).
- `initAuth()` memulihkan sesi saat refresh dengan retry 3×; kelas CSS `auth-pending` menyembunyikan layar login selama pemeriksaan sesi.
- Menu navigasi dinamis dari `mc_center.sys_menus` + matriks `sys_role_menus`.
- Kanvas workflow: [flow-canvas.js](../src/public/js/flow-canvas.js).

## 9. Dokumen Terkait

[API_SPEC.md](./API_SPEC.md) · [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) · [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) · [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) · [security.md](./security.md) · [DECISION_LOG.md](./DECISION_LOG.md)
