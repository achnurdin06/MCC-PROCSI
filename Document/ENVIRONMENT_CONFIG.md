# Konfigurasi Environment MCC-PROCSI

> Terakhir diperbarui: 29 Oktober 2026 · Sumber: [`src/config/env.js`](../src/config/env.js), [`.env.example`](../.env.example)

## 1. Aturan Pemilihan File Env (otomatis)

| Kondisi | File dimuat | `NODE_ENV` | `APP_ENV` (default) |
|---|---|---|---|
| `NODE_ENV=production` / `prod` (eksplisit) | `.env.production` | production | `PROD` |
| `NODE_ENV=development` / `dev` (eksplisit) | `.env.development` | development | `DEV` |
| Tanpa `NODE_ENV`, branch git `main`, `master`, `production`, `workstation-main` | `.env.production` | production | `PROD` |
| Tanpa `NODE_ENV`, branch lain (mis. `dev`, `feature/*`) atau lokal tanpa `.git` | `.env.development` | development | `DEV` |

Prioritas: **`NODE_ENV` eksplisit > `GIT_BRANCH` (env var) > isi `.git/HEAD` > default development**.
File `.env` umum bersifat opsional (cadangan; nilai dari file target tidak ditimpa) dan **sudah dihapus** dari proyek — gunakan hanya `.env.development` / `.env.production`. `process.env.NODE_ENV` dan `APP_ENV` selalu diisi konsisten.

Saat start, log menampilkan branch, mode, dan file env yang dipakai. Perintah:

```bash
npm start            # ikut aturan otomatis
npm run dev          # nodemon (development)
npm run start:dev    # paksa development
npm run start:prod   # paksa production
```

Folder server produksi **harus** berisi checkout branch `main` + `.env.production`; laptop/dev memakai `.env.development`. Kedua file ada di `.gitignore` — jangan pernah di-commit.

## 2. Daftar Variabel

### Runtime
| Variabel | Wajib | Keterangan |
|---|---|---|
| `NODE_ENV` | Tidak | `development` / `production` |
| `APP_ENV` | Tidak | Label `DEV` / `PROD` |
| `PORT` | Tidak | Default `3000` |

### Database Aplikasi (control + staging + target)
| Variabel | Wajib | Keterangan |
|---|---|---|
| `APP_DB_HOST`, `APP_DB_PORT`, `APP_DB_USER`, `APP_DB_PASSWORD`, `APP_DB_NAME` | Ya | Koneksi PostgreSQL database aplikasi |
| `APP_DB_SCHEMA` | Tidak | Default `mc_center` |
| `APP_DB_MAX_POOL` | Tidak | Ukuran pool (default 10) |
| `PG_HOST/PORT/USER/PASSWORD/DATABASE` | Tidak | Alias kompatibilitas mundur untuk koneksi PostgreSQL |
| `PG_CONNECTION_TIMEOUT_MILLIS` | Tidak | Timeout koneksi (ms) |
| `PG_SSL`, `PG_SSL_REJECT_UNAUTHORIZED` | Tidak | TLS ke PostgreSQL |

### Database sumber SQL Server
Koneksi SQL Server **tidak dikonfigurasi melalui `.env`**. Atur koneksi pada menu **Master Connection** untuk setiap client dan environment: host, port, database, username/password, serta detail SSH tunnel bila diperlukan. Untuk eksekusi ETL, gunakan tepat satu koneksi SOURCE SQL Server aktif per environment; konfigurasi migration tidak menyimpan pemetaan koneksi sumber per tabel. Kredensial disimpan terenkripsi menggunakan `ENCRYPTION_MASTER_KEY`. Pastikan user layanan dapat menjangkau SQL Server secara langsung atau dapat menjangkau bastion SSH.

Saat request memilih `connection_id`, `env_id`, `config_id`, atau `run_id`, aplikasi menentukan koneksi SOURCE aktif dari `master_connection`. SSH tunnel memakai port lokal dinamis per koneksi; tidak perlu menetapkan `LOCAL_TUNNEL_PORT`.
Health check `/api/health` hanya menguji PostgreSQL database kontrol aplikasi (`APP_DB_*`). Koneksi SOURCE dan TARGET ditampilkan serta diuji berdasarkan role koneksi pada environment terpilih melalui `/api/context/environments/:id/health`.

### Keamanan (WAJIB)
| Variabel | Syarat | Dampak bila salah |
|---|---|---|
| `JWT_SECRET` | ≥ 32 karakter, **tanpa fallback** | Login / verifikasi token gagal dengan error `JWT_SECRET wajib diisi minimal 32 karakter` |
| `ENCRYPTION_MASTER_KEY` | ≥ 32 karakter, **tanpa fallback** | Enkripsi/dekripsi koneksi gagal (error dilempar saat dipakai); mengganti kunci membuat password `master_connection` lama tidak terbaca |

Generate: `openssl rand -hex 32`. **Gunakan nilai berbeda untuk dev dan prod.** Simpan cadangan `ENCRYPTION_MASTER_KEY` di tempat aman terpisah dari server.

### Jaringan
| Variabel | Keterangan |
|---|---|
| `CORS_ALLOWED_ORIGINS` | Daftar origin dipisah koma. Kosong → same-origin; di non-production `localhost` diizinkan |
| `TRUST_PROXY` | Default `loopback`. Set sesuai topologi Nginx/LB agar rate limiter membaca IP klien yang benar |

## 3. Template per Lingkungan

| Hal | `.env.development` | `.env.production` |
|---|---|---|
| `NODE_ENV` / `APP_ENV` | development / DEV | production / PROD |
| DB aplikasi | `<NAMA_DB_DEV>` (`<HOST_DEV>:<PORT>`) | DB prod on-prem |
| Koneksi SQL Server SOURCE | Master Connection pada environment DEV | Master Connection pada environment PROD |
| `JWT_SECRET`, `ENCRYPTION_MASTER_KEY` | unik dev | unik prod |
| `CORS_ALLOWED_ORIGINS` | kosong | domain resmi HTTPS |
| `TRUST_PROXY` | `loopback` | sesuai Nginx |
| HSTS & `upgrade-insecure-requests` | nonaktif | aktif (otomatis saat production) |

## 4. Aturan Keamanan Berkas Env

- `chmod 600 .env.production` dan pemilik = user layanan aplikasi.
- Jangan menaruh nilai rahasia di README, dokumen, issue, atau log.
- Rotasi `JWT_SECRET` memaksa semua user login ulang (aman). Rotasi `ENCRYPTION_MASTER_KEY` memerlukan re-enkripsi `master_connection`.

## 5. Troubleshooting

| Gejala | Penyebab | Solusi |
|---|---|---|
| Error `JWT_SECRET wajib diisi…` / `ENCRYPTION_MASTER_KEY wajib diisi…` saat login atau simpan koneksi | Variabel kosong / < 32 karakter | Isi dengan `openssl rand -hex 32` |
| Lokal memakai DB produksi | Branch lokal `main` | Checkout `dev` atau jalankan `npm run start:dev` |
| Server prod memuat env dev | Branch bukan `main`, atau `NODE_ENV` tidak diset | Checkout `main` atau `npm run start:prod` / `NODE_ENV=production` di PM2 |
| Rate limit memblokir semua user | `TRUST_PROXY` salah → semua request terlihat dari IP proxy | Setel `TRUST_PROXY` sesuai jumlah hop proxy |
| Koneksi SOURCE tidak ditemukan | Environment belum memiliki koneksi SOURCE SQL Server aktif | Atur dan uji koneksi di menu Master Connection untuk environment yang dipilih |
| SSH tunnel atau koneksi SOURCE gagal | Host/port SQL Server tidak terjangkau, atau detail bastion salah | Uji host/port SQL Server dari bastion; periksa host, port, user, dan password SSH pada Master Connection |
