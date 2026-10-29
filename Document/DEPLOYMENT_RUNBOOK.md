# Runbook Deployment & Operasional MCC-PROCSI

> Terakhir diperbarui: 29 Oktober 2026
> Instalasi langkah demi langkah (Node, PostgreSQL, PM2, Nginx, firewall) ada di [README.md](../README.md#-panduan-instalasi-ke-server-on-premise-production). Dokumen ini fokus pada **rilis, operasi harian, backup, dan penanganan insiden**.

## 1. Lingkungan & Branch

| Lingkungan | Branch git | File env | Database aplikasi |
|---|---|---|---|
| Lokal / Dev | `dev` (atau feature) | `.env.development` | `db_procsi` dev |
| Produksi on-prem | `main` | `.env.production` | DB produksi |

Remote: `origin` (GitHub `achnurdin06/mig-antam`) dan `sisi` (GitLab workstation). Detail resolusi env: [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md).

## 2. Prasyarat Server

- Node.js minimal v26.12.2 (versi terbaru, LTS "Lithium"), PM2, Nginx, akses jaringan ke PostgreSQL dan SQL Server source (atau SSH bastion).
- File `.env.production` berpermission `600`, berisi `JWT_SECRET` dan `ENCRYPTION_MASTER_KEY` ≥ 32 karakter.
- PM2 **`instances: 1`**, `exec_mode: fork` — kunci eksekusi, SSE, dan captcha tersimpan in-memory ([ARCHITECTURE.md](./ARCHITECTURE.md#6-keadaan-in-memory-penting-untuk-deployment)).
- Nginx: `proxy_buffering off` pada `location ~* ^/api/flows/stream/` (SSE), `proxy_read_timeout` panjang, header `X-Forwarded-For`/`X-Forwarded-Proto`; set `TRUST_PROXY` yang sesuai.

## 3. Prosedur Rilis (dev → produksi)

1. **Dev**: kerjakan di branch `dev`, uji lokal (`npm run dev`), jalankan `npm audit --omit=dev` (target 0 kerentanan).
2. Update [CHANGELOG.md](./CHANGELOG.md) dan dokumen terkait.
3. Merge `dev` → `main` (PR direkomendasikan), push ke `origin` dan `sisi`.
4. **Cek jendela rilis**: pastikan tidak ada run berstatus `RUNNING` (menu *Proses Migrasi* atau `GET /api/etl/runs`). Restart memutus run aktif.
5. Di server:
   ```bash
   cd /var/www/mcc-procsi
   git fetch origin main && git pull origin main
   npm ci --omit=dev
   pm2 restart mcc-procsi --update-env     # instance tunggal: restart singkat (beberapa detik)
   pm2 logs mcc-procsi --lines 30          # pastikan log: mode production + .env.production
   ```
6. Jika rilis mengubah DB (tabel/fungsi `mc_center`), terapkan skrip SQL **sebelum** restart, setelah backup (bagian 5).
7. Smoke test (bagian 4).

> Catatan: `pm2 reload` pada satu instance tidak benar-benar zero-downtime. Jadwalkan di luar jam migrasi.

## 4. Smoke Test Pasca-Rilis

```bash
curl -s http://127.0.0.1:3000/api/health          # bothConnected: true
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3000/api/etl/runs   # harus 401 tanpa token
```
Lalu di browser: halaman login + captcha tampil → login → menu sesuai role → refresh halaman (sesi harus tetap login) → Source Data memuat daftar view.

## 5. Backup & Pemulihan

| Objek | Cara | Frekuensi |
|---|---|---|
| Skema `mc_center` | `pg_dump -h <host> -p <port> -U <user> -n mc_center -Fc db_procsi > mc_center_$(date +%F).dump` | Harian + sebelum rilis |
| Skema `stg_antam` | idem dengan `-n stg_antam` | Sebelum Flow 4 (purge) |
| Target `vendor`/`public` | Snapshot DB sebelum Flow 2 produksi pertama | Sebelum cut-over |
| `.env.production` | Salin terenkripsi ke vault terpisah | Saat berubah |
| `ENCRYPTION_MASTER_KEY` | Vault terpisah — **tanpa kunci ini kredensial `master_connection` tidak bisa didekripsi** | Saat dibuat |

Pemulihan: `pg_restore -c -n mc_center -d db_procsi mc_center_<tanggal>.dump`, lalu restart aplikasi.

## 6. Operasi Harian

- **Log**: `pm2 logs mcc-procsi`; log error server memuat *correlation ID* yang sama dengan yang dilihat user.
- **Run macet**: UI → *Proses Migrasi* → **Cancel**; jika tidak merespons → **Force Stop** (role SUPERADMIN/OPERATOR). Run `RUNNING` tanpa aktivitas > 10 menit ditandai basi otomatis (`is_stale`) dan dipulihkan sweeper.
- **Akun**: pendaftar mandiri berstatus nonaktif — aktifkan lewat *System Administration → Users*.
- **Rotasi `JWT_SECRET`**: ubah di `.env.production`, `pm2 restart --update-env` (semua user login ulang).
- **Update dependensi**: `npm audit`, `npm update` di dev, uji, rilis lewat prosedur bagian 3.

## 7. Penanganan Insiden

| Gejala | Diagnosa | Tindakan |
|---|---|---|
| `/api/health` → `sqlserver.connected=false` | SSH tunnel/VPN putus, kredensial berubah | Uji koneksi di *Master Connection*; cek `ssh` manual ke bastion; restart app jika tunnel macet |
| `/api/health` → `postgres.connected=false` | DB down / firewall | `psql` dari server; cek `pg_hba.conf`, `APP_DB_*` |
| Log SSE tidak muncul real-time di browser | Buffering Nginx | Pastikan blok `location ~* ^/api/flows/stream/` aktif; `nginx -t && systemctl reload nginx` |
| User sah mendapat 429 | Rate limit login (10/mnt/IP+user) atau `TRUST_PROXY` salah | Tunggu 1 menit; periksa `TRUST_PROXY` |
| Semua user terlempar ke login | `JWT_SECRET` berubah / token kedaluwarsa (8 jam) | Wajar setelah rotasi; login ulang |
| Halaman login muncul sesaat saat refresh | Pemulihan sesi (`initAuth`) | Normal ≤ beberapa detik; bila menetap, cek `/api/auth/me` di Network tab dan log server |
| Error `ENOENT … public/index.html` | Aplikasi dijalankan dari path lama | Jalankan dari root repo (`src/public` ada di dalam proyek); cek `pm2 describe` → `exec cwd` |
| Flow 2 sukses tapi 0 baris | Config tidak punya `migration_target_config` (mis. config 20) | Tambah target config, lalu ulangi — lihat [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md) |

## 8. Rollback Aplikasi

```bash
git log --oneline -5
git checkout <commit_sebelumnya>        # atau: git revert <commit_rilis>
npm ci --omit=dev && pm2 restart mcc-procsi --update-env
```
Rollback **data** dilakukan melalui Flow 3 (per run) — bukan dengan git. Lihat [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md#4-flow-3--rollback).

## 9. Checklist Go-Live

- [ ] `.env.production` lengkap, berpermission 600, secret unik prod
- [ ] Branch server = `main`; log boot menyebut `production`
- [ ] HTTPS aktif, HSTS otomatis, `CORS_ALLOWED_ORIGINS` diisi
- [ ] PM2 `instances: 1`, `pm2 save` + `pm2 startup`
- [ ] Nginx SSE diuji (log Flow tampil live)
- [ ] Backup `mc_center` terjadwal dan pernah diuji restore
- [ ] Akun default/seed diganti passwordnya; akun tak terpakai dinonaktifkan
- [ ] `npm audit --omit=dev` = 0
- [ ] Firewall: hanya 80/443/SSH dari jaringan yang diizinkan; port 3000 hanya loopback
