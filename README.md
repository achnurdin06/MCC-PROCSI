# 🚀 Migration Command Center (MCC-PROCSI)
### Dashboard Audit, Orkestrasi & Rekonsiliasi Migrasi Data Multi-Database ➔ PostgreSQL

Aplikasi web enterprise berbasis **Node.js / Express** untuk mengelola, mengeksekusi, memantau secara real-time, dan merekonsiliasi proses migrasi data dari **Database Asal** melalui **PostgreSQL ** hingga ke tabel **Staging ** dan **Target**.

---

## 🏗️ Arsitektur Aliran Data 3-Tier

```
┌─────────────────────────────────┐
│   Source Database (SQL Server)  │  antam_scm.dbo (v_migration_vendor, dll)
└────────────────┬────────────────┘
                 │
                 ▼  [Flow 1: Ingestion & Staging]
┌─────────────────────────────────┐
│  Staging Database (PostgreSQL)  │  <db_aplikasi>.stg_antam (stg_user_src, dll)
└────────────────┬────────────────┘
                 │
                 ▼  [Flow 2: Transformation & Target Loading]
┌─────────────────────────────────┐
│   Target Database (PostgreSQL)  │  <db_aplikasi>.vendor (tabel operasional final)
└─────────────────────────────────┘
```

Seluruh metadata, konfigurasi pemetaan, log riwayat proses, dan kredensial terenkripsi dikelola langsung di dalam skema kontrol **`mc_center`** pada database aplikasi PostgreSQL.

---

## 🌟 Modul & Fitur Utama

### 0. 🔐 Autentikasi & RBAC Multi-User Dinamis
- **Proteksi Akses Berlapis**: Otentikasi berbasis token JWT (algoritma HS256) dengan masa aktif 8 jam dan hash password berbasis **PBKDF2-SHA512 (210.000 iterasi)**.
- **Proteksi Brute-Force & Bot**: Captcha visual pada login/registrasi, sliding-window rate limiter per kombinasi IP + username, dan mitigasi timing-attack (*timingSafeEqual*).
- **Peran Pengguna (RBAC)**:
  - `SUPERADMIN`: Akses penuh terhadap manajemen pengguna, matriks izin peran, CRUD koneksi database, inisialisasi wizard, dan ekspor/impor konfigurasi.
  - `OPERATOR`: Hak eksekusi alur orkestrasi (Flows), pembatalan batch run (*cancel / force stop*), dan modifikasi konfigurasi pemetaan.
  - `VIEWER / AUDITOR`: Akses baca (*read-only*) untuk pemantauan dasbor, audit data rekonsiliasi, dan pencetakan Berita Acara.
- **Validasi Status Sesi Real-Time**: Pemeriksaan status aktif akun (`is_active`) dan penyegaran hak akses peran langsung ke database pada setiap *request*.

### 1. 🏢 Multi-Client & Multi-Environment Manager
- **Manajemen Multi-Tenant**: Pengelompokan koneksi dan konfigurasi berdasarkan Master Client (misal: PT Antam Tbk) dan Master Environment (`DEVELOPMENT`, `STAGING`, `PRODUCTION`).
- **Master Connection Terenkripsi**: Penyimpanan kredensial database (PostgreSQL, MSSQL) dan SSH Tunnel yang dienkripsi menggunakan standar militer **AES-256-GCM** (`ENC:v1:...`). Masking otomatis (`••••••••`) pada antarmuka pengguna dan API.
- **Sinkronisasi Apache Hop**: Pembuatan otomatis file konfigurasi Apache Hop JSON (`<client>_<env>-config.json`) dengan permission file restriktif (`0600`).
- **Managed SSH Bastion Tunnel**: Port forwarding otomatis via SSH tunnel (`ssh2`) untuk mengakses SQL Server di balik jaringan privat/VPN secara aman.

### 2. 🌐 Modul 1: Source Data (SQL Server `dbo`)
- Menampilkan seluruh **VIEW** pada schema `dbo` SQL Server (`v_migration_vendor`, `v_vendor_address`, `v_vendor_bank`, dll.) beserta total baris (*row count*) real-time.
- **Data Inspector**: Meninjau data aktual langsung dari SQL Server dengan paginasi dan metadata tipe kolom.
- **Safe View Management & DDL**: Antarmuka pembuatan, penyuntingan (*alter*), pengujian query, dan sinkronisasi view dengan validasi *read-only* ketat.

### 3. ⚙️ Modul 2: Monitoring Config & Jalannya Proses ETL
- **Master Config Tables**:
  - `migration_config`: Konfigurasi mapping sumber `src_view` ➔ staging `stg_table` ➔ target `tgt_table`, kunci PK, seed ID, query precheck, dan auto-detection metadata.
  - `migration_convert_rule`: Aturan konversi tipe data, pemetaan kamus lookup, normalisasi string, dan nilai default.
  - `migration_lookup`: Master kamus lookup nilai referensi.
  - `migration_target_config`: Target mapping SQL, query precheck, postcheck, dan rollback SQL.
- **Zero-Trust SQL Precheck Guard**: Validasi query precheck hanya mengizinkan sintaks `SELECT`/`WITH` tanpa akses ke tabel internal sistem `mc_center`.
- **Ekspor & Impor Konfigurasi**: Portabilitas konfigurasi antar lingkungan melalui format JSON dengan validasi nama identifier tabel/kolom yang aman.

### 4. 📊 Modul 3: Proses Migrasi (Execution & Logs)
- **Batch Monitoring**: Riwayat eksekusi batch migrasi (`migration_run`) dengan status real-time (`PENDING`, `RUNNING`, `SUCCESS`, `FAILED`).
- **Throughput Step Logs**: Metrik performa setiap tahapan (`rows_src`, `rows_stg`, `rows_new`, `rows_changed`, `rows_deleted`).
- **Error Diagnostic**: Pencatatan log kesalahan transformasi (`migration_error_log`) beserta sampel JSON baris data yang bermasalah.
- **Run Cancellation & Sweeper**: Tombol *Cancel* dan *Force Stop* untuk memutus run yang hang, serta pemulihan otomatis (*stale run sweeper*) saat server atau jaringan terputus.

### 5. 🎯 Modul 4: Hasil Migrasi (Pipeline 3-Tier Reconciliation & Berita Acara)
- **Visualisasi Aliran Data 3 Titik**:
  $$\mathbf{Source\ (dbo.src\_view)} \longrightarrow \mathbf{Staging\ (stg\_antam.stg\_table)} \longrightarrow \mathbf{Final\ Target\ (vendor.tgt\_table)}$$
- Perbandingan jumlah baris di ketiga titik secara berdampingan lengkap dengan kalkulasi selisih (*delta*) dan status sinkronisasi (*Match*, *Partial*, *Overflow*).
- **Interactive 3-Stage Data Viewer**: Meninjau isi record aktual pada masing-masing tahapan untuk membuktikan akurasi transformasi data.
- **Cetak Berita Acara Validasi Data**:
  - Format resmi standar korporat (Kop Surat ANTAM, Nomor Dokumen, Tanggal, Parameter Config, Tabel Uji Rekonsiliasi, dan Lembar Pengesahan Tanda Tangan).
  - **Lampiran Data Staging**: Rekapitulasi seluruh baris data aktual yang dimigrasikan ke `stg_antam.[stg_table]`.
  - Tombol **"Cetak / Simpan PDF"** (`window.print()`) dan **"Ekspor CSV Staging"**.

### 6. 🔀 Modul 5: Visual Workflow Canvas & Orchestrator
- **Preset Alur Eksekusi**:
  - **Flow 1 (Staging)**: Ingestion dari SQL Server ke Staging PostgreSQL.
  - **Flow 2 (Post-Staging / Target)**: Transformasi dan pemuatan data staging ke tabel target final.
  - **Flow 3 (Rollback)**: Eksekusi rollback terarah ke data target jika ditemukan anomali.
  - **Flow 4 (Purge & Preview)**: Pembersihan data sementara dan riwayat staging dengan proteksi preview sebelum eksekusi.
- **Real-Time Streaming**: Streaming log eksekusi langsung ke browser menggunakan **Server-Sent Events (SSE)**.
- **Diagnostik Error Visual**: Analisis akar masalah kegagalan eksekusi secara interaktif.

---

## 🛡️ Keamanan & Hardening Sistem

Aplikasi ini telah diaudit dan diperkuat sesuai standar keamanan industri:
1. **Zero-Trust SQL Injection Protection**: Utilitas `assertReadOnlySelect` dan `assertSafeIdentifier` memblokir injeksi SQL majemuk, komentar, DDL/DML terlarang, dan akses ke tabel kredensial.
2. **Kriptografi Kuat**: Enkripsi password data connection menggunakan AES-256-GCM, signing token JWT HS256, serta hashing PBKDF2 210.000 iterasi.
3. **HTTP Security Headers (Helmet)**: Implementasi ketat `Content-Security-Policy` (CSP), `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, dan HSTS.
4. **Anti-SSRF Guard**: Pengujian koneksi (`testConnection`) menolak resolusi ke alamat loopback, cloud metadata (`169.254.169.254`), dan multicast IP.
5. **CORS & Rate Limiting**: Batasan origin berbasis konfigurasi domain dan pembatasan frekuensi request login/captcha untuk mencegah serangan denial of service / brute force.
6. **Masking & Sanitasi Data**: Password selalu di-mask sebelum dikirim ke API; seluruh pesan error dan nama identifier di-escape dengan `escapeHtml()` dan `escapeJsArg()` untuk mencegah DOM XSS.

---

## ⚙️ Konvensi Lingkungan Otomatis (Environment Resolution)

Aplikasi memiliki sistem deteksi otomatis lingkungan (*Dynamic Environment Loader* di `src/config/env.js`):

| Kondisi / Lokasi | Git Branch Aktif | File Konfigurasi | Mode Runtime | Keterangan |
| :--- | :--- | :--- | :--- | :--- |
| **Lokal / Staging Server** | `dev` / branch fitur | `.env.development` | `development` (`DEV`) | SSH Tunnel SQL Server aktif (`MSSQL_USE_SSH_TUNNEL=true`) |
| **Server On-Premise / Prod** | `main` / `master` / `workstation-main` | `.env.production` | `production` (`PROD`) | Koneksi langsung intranet (`MSSQL_USE_SSH_TUNNEL=false`), CSP & HSTS aktif |

> **Catatan Overriding Manual:**
> Anda dapat mengesampingkan deteksi branch dengan menyetel variabel `NODE_ENV` secara eksplisit, misalnya:
> - `npm run dev` atau `npm run start:dev` ➔ Memuat `.env.development`
> - `npm run start:prod` ➔ Memuat `.env.production`
> - `npm start` ➔ Menentukan file berdasarkan git branch yang sedang di-*checkout*.

---

## 🔌 Dokumentasi REST API

### Autentikasi & RBAC
| Method | Endpoint | Hak Akses | Deskripsi |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/auth/captcha` | Publik | Mendapatkan captcha visual & token captcha |
| `POST` | `/api/auth/login` | Publik | Otentikasi username & password |
| `POST` | `/api/auth/forgot-password` | Publik | Pengajuan reset password ke administrator |
| `GET` | `/api/auth/me` | Authenticated | Profil user yang sedang login |
| `GET` | `/api/auth/users` | SUPERADMIN | Daftar seluruh user sistem |
| `POST` | `/api/auth/users` | SUPERADMIN | Menambah user baru |
| `PUT` | `/api/auth/users/:id` | SUPERADMIN | Mengubah data user & status aktif |
| `PUT` | `/api/auth/users/:id/reset-password` | SUPERADMIN | Reset password user oleh administrator |
| `GET` | `/api/auth/roles` | SUPERADMIN | Daftar master role (SUPERADMIN, OPERATOR, VIEWER) |
| `GET` | `/api/auth/role-menus/:roleId` | SUPERADMIN | Matriks izin menu per role |
| `POST` | `/api/auth/role-menus/:roleId` | SUPERADMIN | Menyimpan matriks izin menu |

### Global Context & Master Connection
| Method | Endpoint | Hak Akses | Deskripsi |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/health` | Publik | Status koneksi database PostgreSQL & SQL Server |
| `GET` | `/api/context/status` | Publik | Status inisialisasi master data sistem |
| `POST` | `/api/context/init-wizard` | SUPERADMIN | Wizard inisialisasi client & environment pertama |
| `GET` | `/api/context/clients` | Authenticated | Daftar master client |
| `POST` | `/api/context/clients` | SUPERADMIN | Menambah client baru |
| `GET` | `/api/context/environments` | Authenticated | Daftar environment per client |
| `GET` | `/api/context/environments/:id/health` | Authenticated | Health check koneksi per environment |
| `POST` | `/api/context/environments/save-with-connections` | SUPERADMIN | Menyimpan environment beserta koneksi DB |
| `POST` | `/api/context/environments/:id/sync-hop` | SUPERADMIN | Sinkronisasi file konfigurasi Apache Hop |
| `POST` | `/api/context/connections/test` | SUPERADMIN | Uji konektivitas database (Anti-SSRF guard) |

### Modul 1: Source Data (SQL Server `dbo`)
| Method | Endpoint | Hak Akses | Deskripsi |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/source/views` | Authenticated | Daftar view SQL Server beserta row count |
| `GET` | `/api/source/view-data?view=...` | Authenticated | Paginasi data aktual view SQL Server |
| `GET` | `/api/source/view-definition?view=...` | Authenticated | Definisi DDL view SQL Server |
| `POST` | `/api/source/create-view` | SUPERADMIN | Membuat atau mengupdate view SQL Server |
| `POST` | `/api/source/validate-query` | SUPERADMIN | Validasi query DDL view (Safe SQL guard) |
| `DELETE` | `/api/source/drop-view/:viewName` | SUPERADMIN | Menghapus view SQL Server |
| `POST` | `/api/source/sync-all-views` | SUPERADMIN | Sinkronisasi skema seluruh view sumber |

### Modul 2, 3 & 4: ETL Config, Execution & Reconciliation
| Method | Endpoint | Hak Akses | Deskripsi |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/etl/overview` | Authenticated | Ringkasan metrik eksekusi ETL (runs, success, error) |
| `GET` | `/api/etl/configs` | Authenticated | Daftar master konfigurasi migrasi |
| `GET` | `/api/etl/configs/export` | Authenticated | Ekspor konfigurasi migrasi ke file JSON |
| `POST` | `/api/etl/configs/import` | SUPERADMIN | Impor konfigurasi migrasi dari JSON |
| `POST` | `/api/etl/configs/test-precheck` | SUPERADMIN | Uji coba query precheck SQL (Safe SQL guard) |
| `POST` | `/api/etl/configs/:table` | OPERATOR | Menambah data konfigurasi migrasi |
| `PUT` | `/api/etl/configs/:table/:id` | OPERATOR | Mengupdate data konfigurasi migrasi |
| `DELETE` | `/api/etl/configs/:table/:id` | OPERATOR | Menghapus konfigurasi migrasi |
| `GET` | `/api/etl/runs?limit=50` | Authenticated | Riwayat batch eksekusi migrasi |
| `POST` | `/api/etl/runs/:runId/cancel` | OPERATOR | Membatalkan eksekusi run yang sedang berjalan |
| `POST` | `/api/etl/runs/:runId/force-stop` | OPERATOR | Menghentikan paksa run yang mengalami hang |
| `GET` | `/api/etl/step-logs?runId=...` | Authenticated | Log throughput per tahapan migrasi |
| `GET` | `/api/etl/error-logs?runId=...` | Authenticated | Log error transformasi data & sampel JSON |
| `GET` | `/api/reconciliation/pipeline` | Authenticated | Rekonsiliasi 3-tahap Source ➔ Staging ➔ Target |
| `GET` | `/api/reconciliation/stage-data` | Authenticated | Inspeksi data per tahapan pipeline |
| `GET` | `/api/reconciliation/berita-acara` | Authenticated | Data dokumen Berita Acara & rekapitulasi staging |

### Modul 5: Workflow Canvas & Orkestrator
| Method | Endpoint | Hak Akses | Deskripsi |
| :--- | :--- | :--- | :--- |
| `GET` | `/api/flows/presets` | Authenticated | Daftar preset alur migrasi terdaftar |
| `POST` | `/api/flows/flow-1-staging` | OPERATOR | Eksekusi Flow 1 (Database Sumber ➔ Staging PG) |
| `POST` | `/api/flows/flow-2-post` | OPERATOR | Eksekusi Flow 2 (Staging PG ➔ Target PG) |
| `POST` | `/api/flows/flow-3-rollback` | OPERATOR | Eksekusi Flow 3 (Rollback target) |
| `POST` | `/api/flows/flow-4-purge` | OPERATOR | Eksekusi Flow 4 (Pembersihan staging & riwayat) |
| `POST` | `/api/flows/flow-4-purge-preview` | OPERATOR | Meninjau jumlah baris yang akan dibersihkan |
| `GET` | `/api/flows/stream/:runId?token=...` | Authenticated | Real-time Server-Sent Events (SSE) log stream |
| `GET` | `/api/flows/error-diagnostic/:runId` | Authenticated | Diagnostik mendalam penyebab error alur |

---

## 💻 Panduan Menjalankan di Lokal (Development)

1. Pastikan Node.js versi terbaru (**minimal v26.12.2**, lihat `engines` di `package.json`) dan npm sudah terinstal.
2. Pastikan file `.env.development` sudah dikonfigurasi (lihat panduan variabel lingkungan di bawah).
3. Jalankan aplikasi:
   ```bash
   npm run dev
   ```
4. Buka di browser: **http://localhost:3000**
5. Login default awal sistem:
   - **Username:** `admin`
   - **Password:** Hubungi administrator sistem

---

## 🏢 Panduan Instalasi ke Server On-Premise (Development / Dev Environment)

Panduan berikut ditujukan untuk instalasi pada server Linux fisik (*Bare Metal*) atau Virtual Machine (*VM / On-Premise*) lingkungan **Development / Pengujian** berbasis **Ubuntu 20.04/22.04 LTS** atau **RHEL / Rocky Linux 8/9** menggunakan branch **`dev`** dan konfigurasi **`.env.development`**.

> 💡 **Info:** Sistem MCC-PROCSI dilengkapi deteksi otomatis ([`src/config/env.js`](./src/config/env.js)). Ketika berada di branch `dev`, sistem otomatis mengaktifkan mode **Development** dan membaca `.env.development`. Untuk deployment ke server produksi (`main`), lihat panduan perbedaannya di [catatan produksi di bawah](#perbedaan-dengan-server-production).

### 1. Kebutuhan Sistem & Spesifikasi Minimum
- **Sistem Operasi**: Linux Ubuntu 20.04/22.04 LTS / Debian 11/12 / RHEL 8/9
- **Processor**: Minimum 2 Core vCPU (Rekomendasi 4 Core vCPU)
- **RAM**: Minimum 4 GB (Rekomendasi 8 GB jika memproses dataset besar)
- **Disk Storage**: Minimum 20 GB free space (SSD disarankan)
- **Software Dependencies**:
  - Node.js **versi terbaru (minimal v26.12.2, LTS "Lithium")** — wajib, bukan versi lama
  - npm versi bawaan Node.js 26 (11.x+)
  - PostgreSQL versi 14+ (sebagai database aplikasi & target)
  - Nginx (sebagai reverse proxy & SSL termination)
  - PM2 (sebagai process manager latar belakang)

---

### 2. Persiapan Database PostgreSQL On-Premise Dev

Pastikan PostgreSQL sudah berjalan dan dapat diakses dari server aplikasi dev:

```bash
# Masuk ke prompt PostgreSQL
sudo -u postgres psql

# Buat user dan database aplikasi dev (sesuaikan nama & password)
CREATE USER <USER_DB_DEV> WITH PASSWORD '<PASSWORD_DB_DEV>';
CREATE DATABASE <NAMA_DATABASE_DEV> OWNER <USER_DB_DEV>;
GRANT ALL PRIVILEGES ON DATABASE <NAMA_DATABASE_DEV> TO <USER_DB_DEV>;

# Hubungkan ke database aplikasi dev
\c <NAMA_DATABASE_DEV>

# Buat schema kontrol mc_center
CREATE SCHEMA IF NOT EXISTS mc_center AUTHORIZATION <USER_DB_DEV>;
GRANT ALL ON SCHEMA mc_center TO <USER_DB_DEV>;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA mc_center TO <USER_DB_DEV>;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA mc_center TO <USER_DB_DEV>;

# Keluar dari PostgreSQL
\q
```

> **Catatan:** Seluruh tabel master (`sys_users`, `sys_roles`, `master_client`, `master_environment`, `master_connection`, `migration_config`, dll.) akan dibuat dan dimigrasikan secara **otomatis** oleh aplikasi saat pertama kali dijalankan (*auto-initialization*).

---

### 3. Instalasi Node.js & Tooling pada Server

#### Pada Ubuntu / Debian:
```bash
# Update repository
sudo apt-get update && sudo apt-get install -y curl git build-essential

# Install Node.js versi terbaru (26.x, minimal v26.12.2) via NodeSource
curl -fsSL https://deb.nodesource.com/setup_26.x | sudo -E bash -
sudo apt-get install -y nodejs

# Verifikasi versi
node -v # Harap pastikan minimal v26.12.2 (versi terbaru)
npm -v

# Install PM2 secara global
sudo npm install -g pm2
```

#### Pada RHEL / Rocky Linux / AlmaLinux:
```bash
sudo dnf update -y
sudo dnf groupinstall "Development Tools" -y
curl -fsSL https://rpm.nodesource.com/setup_26.x | sudo bash -
sudo dnf install -y nodejs
sudo npm install -g pm2
```

---

### 4. Clone Repository & Checkout Branch `dev`

Aplikasi diatur agar otomatis menggunakan mode **Development** ketika berada di branch `dev`:

```bash
# Buat direktori aplikasi untuk server dev
sudo mkdir -p /var/www/mcc-procsi-dev
sudo chown -R $USER:$USER /var/www/mcc-procsi-dev

# Clone source code dari GitLab Workstation SISI (atau GitHub)
git clone https://workstation.sisi.id/product-development/procsi/antam-new-scm/migrasi-dashboard-antam.git /var/www/mcc-procsi-dev
cd /var/www/mcc-procsi-dev

# Pastikan berada di branch dev
git checkout dev
git pull origin dev

# Install dependensi
npm install
```

---

### 5. Konfigurasi Environment Development (`.env.development`)

Sistem secara otomatis membaca berkas `.env.development` saat mendeteksi branch `dev`:

```bash
cp .env.example .env.development
nano .env.development
```

#### Contoh Konfigurasi `.env.development` Lengkap:

```ini
# ==============================================================================
# ENVIRONMENT UTAMA DEVELOPMENT
# ==============================================================================
NODE_ENV=development
APP_ENV=DEV
PORT=3000

# ==============================================================================
# 1. DATABASE APLIKASI (PostgreSQL Dev)
# ==============================================================================
APP_DB_HOST=<HOST_DEV_POSTGRESQL>
APP_DB_PORT=<PORT_POSTGRESQL>
APP_DB_USER=<USER_DB_DEV>
APP_DB_PASSWORD=<PASSWORD_DB_DEV>
APP_DB_NAME=<NAMA_DATABASE_DEV>
APP_DB_SCHEMA=mc_center
APP_DB_MAX_POOL=10

# Alias backward compatibility
PG_HOST=<HOST_DEV_POSTGRESQL>
PG_PORT=<PORT_POSTGRESQL>
PG_USER=<USER_DB_DEV>
PG_PASSWORD=<PASSWORD_DB_DEV>
PG_DATABASE=<NAMA_DATABASE_DEV>
PG_CONNECTION_TIMEOUT_MILLIS=15000

# Opsional: Jika PostgreSQL menggunakan SSL
PG_SSL=false
PG_SSL_REJECT_UNAUTHORIZED=false

# ==============================================================================
# 2. DATABASE SUMBER & SSH TUNNEL BASTION (Dev)
# Pada server dev/testing, koneksi ke sumber umumnya melalui SSH Bastion
# ==============================================================================
MSSQL_SERVER=127.0.0.1
MSSQL_PORT=11433
MSSQL_USER=<USER_SQLSERVER_DEV>
MSSQL_PASSWORD=<PASSWORD_SQLSERVER_DEV>
MSSQL_DATABASE=<NAMA_DATABASE_SUMBER>
MSSQL_ENCRYPT=false
MSSQL_TRUST_SERVER_CERTIFICATE=true
MSSQL_CONNECTION_TIMEOUT=15000

# Aktifkan SSH Tunnel untuk server development
MSSQL_USE_SSH_TUNNEL=true
MSSQL_SSH_HOST=<HOST_SSH_BASTION>
MSSQL_SSH_PORT=22
MSSQL_SSH_USER=<USER_SSH_BASTION>
MSSQL_SSH_PASSWORD=<PASSWORD_SSH_BASTION>
LOCAL_TUNNEL_PORT=11433

# ==============================================================================
# 3. KUNCI KRIPTOGRAFI WAJIB (KEAMANAN TINGGI)
# Generate kunci 64-karakter dengan: openssl rand -hex 32
# ==============================================================================
# Kunci signing JWT session token
JWT_SECRET=<HASIL_OPENSSL_RAND_HEX_32>

# Kunci master enkripsi kredensial koneksi (AES-256-GCM)
ENCRYPTION_MASTER_KEY=<HASIL_OPENSSL_RAND_HEX_32>

# ==============================================================================
# 4. KEAMANAN JARINGAN & REVERSE PROXY
# ==============================================================================
# Diisi domain atau IP Server dev yang diizinkan mengakses API (dipisahkan koma)
CORS_ALLOWED_ORIGINS=http://localhost:3000,http://<IP_ATAU_DOMAIN_DEV>
TRUST_PROXY=loopback
```

> ⚠️ **PENTING - Generate Kunci Kriptografi Mandiri:**
> Jalankan perintah berikut di terminal server untuk mendapatkan kunci acak berkekuatan tinggi:
> ```bash
> # Generate untuk JWT_SECRET
> openssl rand -hex 32
>
> # Generate untuk ENCRYPTION_MASTER_KEY
> openssl rand -hex 32
> ```
> Pastikan kedua kunci tersebut disimpan di tempat aman dan tidak dibagikan ke pihak ketiga.

Lindungi hak akses file konfigurasi:
```bash
chmod 600 .env.development
```

---

### 6. Pengaturan Process Manager dengan PM2 (Dev Mode)

Gunakan **PM2** agar aplikasi berjalan terus-menerus di latar belakang (*daemonized*), otomatis restart saat terjadi error tak terduga, dan otomatis hidup kembali saat server reboot:

Buat file `ecosystem.config.js` di direktori proyek:
```bash
cat << 'EOF' > ecosystem.config.js
module.exports = {
  apps: [
    {
      name: 'mcc-procsi-dev',
      script: 'src/app.js',
      instances: 1, // Eksekusi single instance untuk menjamin koordinasi in-memory lock
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env_development: {
        NODE_ENV: 'development',
        APP_ENV: 'DEV',
        PORT: 3000,
      },
    },
  ],
};
EOF
```

Jalankan aplikasi via PM2:
```bash
# Jalankan menggunakan konfigurasi development
pm2 start ecosystem.config.js --env development

# Periksa status
pm2 status

# Periksa log aplikasi (pastikan muncul tanda: '🚀 Migration Command Center [DEV] Mode berjalan!')
pm2 logs mcc-procsi-dev --lines 50

# Simpan state PM2 agar otomatis berjalan saat reboot
pm2 save
sudo env PATH=$PATH:/usr/bin pm2 startup systemd -u $USER --hp $HOME
```

---

### 7. Konfigurasi Reverse Proxy Nginx & Server-Sent Events (SSE)

Nginx berfungsi sebagai pintu gerbang utama (port 80 / 443), menangani kompresi gzip, terminasi SSL/TLS, dan meneruskan trafik ke backend Node.js (port 3000). 

> ⚠️ **PENTING UNTUK SSE:** Fitur streaming alur orkestrasi menggunakan Server-Sent Events (`/api/flows/stream/`). Nginx wajib menonaktifkan *buffering* (`proxy_buffering off;`) agar event log terkirim secara instan ke browser tanpa tertahan.

Buat file konfigurasi Nginx:
```bash
sudo nano /etc/nginx/sites-available/mcc-procsi-dev
```

Isi konfigurasi berikut:
```nginx
server {
    listen 80;
    server_name mcc-dev.antam.com; # Ganti dengan domain dev atau IP Server On-Premise Dev

    # Ukuran maksimum body untuk upload konfigurasi JSON & file besar
    client_max_body_size 50M;

    # Gzip Compression
    gzip on;
    gzip_types text/plain text/css application/json application/javascript text/xml application/xml application/xml+rss text/javascript;

    # Konfigurasi SSE (Server-Sent Events) untuk Streaming Log Alur Eksekusi
    location ~* ^/api/flows/stream/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Nonaktifkan buffering untuk streaming real-time
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400s;
        proxy_send_timeout 86400s;
        chunked_transfer_encoding off;
    }

    # Konfigurasi Rute Aplikasi & API Umum
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        proxy_connect_timeout 60s;
        proxy_send_timeout 120s;
        proxy_read_timeout 120s;
    }
}
```

Aktifkan konfigurasi Nginx dan muat ulang:
```bash
# Aktifkan site dev
sudo ln -s /etc/nginx/sites-available/mcc-procsi-dev /etc/nginx/sites-enabled/

# Uji sintaks konfigurasi
sudo nginx -t

# Muat ulang Nginx
sudo systemctl reload nginx
```

*(Opsional tapi Direkomendasikan)* Pasang SSL Certificate via Let's Encrypt atau sertifikat korporat internal:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d mcc-dev.antam.com
```

---

### 8. Konfigurasi Firewall Server

Buka port hanya untuk layanan yang diperlukan:

#### Menggunakan UFW (Ubuntu/Debian):
```bash
sudo ufw allow OpenSSH
sudo ufw allow 'Nginx Full' # Port 80 & 443
sudo ufw enable
sudo ufw status
```

#### Menggunakan Firewalld (RHEL/CentOS):
```bash
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=ssh
sudo firewall-cmd --reload
```

---

### 9. Verifikasi Pasca-Instalasi (Smoke Test)

Jalankan pengujian kesehatan dari terminal server:

1. **Uji Health Check API:**
   ```bash
   curl -i http://127.0.0.1:3000/api/health
   ```
   *Respon sukses:*
   ```json
   {
     "success": true,
     "data": {
       "sqlserver": { "connected": true, ... },
       "postgres": { "connected": true, ... },
       "bothConnected": true
     }
   }
   ```

2. **Uji Akses Browser:**
   Buka alamat domain atau IP Server: `http://mcc-dev.antam.com`
   - Pastikan halaman Login muncul lengkap dengan logo dan Captcha.
   - Login menggunakan akun `admin`.
   - Buka menu **Context Settings** dan **Dashboard** untuk memverifikasi data.

---

### 10. Prosedur Update Versi Aplikasi (Maintenance di Dev)

Ketika terdapat pembaruan kode baru dari tim pengembang di branch `dev`:

```bash
cd /var/www/mcc-procsi-dev

# 1. Ambil kode terbaru dari remote dev
git fetch origin dev
git pull origin dev

# 2. Pasang dependensi terbaru
npm install

# 3. Reload aplikasi PM2 tanpa downtime
pm2 reload mcc-procsi-dev

# 4. Pantau log apakah boot sukses
pm2 logs mcc-procsi-dev --lines 30
```

---

### Perbedaan dengan Server Production

Jika sewaktu-waktu Anda mengonfigurasi **Server Production On-Premise**:
1. Gunakan branch **`main`** (`git checkout main`).
2. Gunakan berkas konfigurasi **`.env.production`** (dengan `NODE_ENV=production`, `APP_ENV=PROD`).
3. Jalankan instalasi dependensi produksi murni: `npm ci --omit=dev`.
4. Jalankan PM2 dengan profil produksi: `pm2 start ecosystem.config.js --env production`.
5. Pada jaringan produksi intranet direct, biasanya SSH tunnel tidak diperlukan (`MSSQL_USE_SSH_TUNNEL=false`).
Panduan lengkap operasional produksi tersedia di [Document/DEPLOYMENT_RUNBOOK.md](./Document/DEPLOYMENT_RUNBOOK.md).

---

## 📚 Dokumentasi

Seluruh dokumentasi teknis berada di folder [Document/](./Document/README.md). Mulai dari [Document/README.md](./Document/README.md) untuk indeks dan jalur baca per peran.

| Dokumen | Isi |
| :--- | :--- |
| [AGENTS.md](./AGENTS.md) · [Document/AGENTS.md](./Document/AGENTS.md) | Panduan konteks untuk AI coding assistant |
| [ARCHITECTURE.md](./Document/ARCHITECTURE.md) | Arsitektur, struktur folder, alur request, DAG |
| [API_SPEC.md](./Document/API_SPEC.md) | Spesifikasi seluruh endpoint API beserta level akses |
| [DATABASE_SCHEMA.md](./Document/DATABASE_SCHEMA.md) | Skema database `mc_center` dan `stg_antam` |
| [ENVIRONMENT_CONFIG.md](./Document/ENVIRONMENT_CONFIG.md) | Resolusi environment dev/prod dan daftar variabel |
| [DEPLOYMENT_RUNBOOK.md](./Document/DEPLOYMENT_RUNBOOK.md) | Rilis, smoke test, backup, rollback, penanganan insiden |
| [MIGRATION_FLOWS.md](./Document/MIGRATION_FLOWS.md) | Detail Flow 1–4, guard, cara menambah entitas migrasi |
| [security.md](./Document/security.md) | Laporan keamanan dan kontrol yang aktif |
| [TESTING_REPORT.md](./Document/TESTING_REPORT.md) | Laporan pengujian fungsional dan regresi |
| [USER_GUIDE.md](./Document/USER_GUIDE.md) | Buku panduan pengguna |
| [DECISION_LOG.md](./Document/DECISION_LOG.md) | Catatan keputusan arsitektur |
| [CONTRIBUTING.md](./Document/CONTRIBUTING.md) | Panduan kontribusi dan konvensi |
| [CHANGELOG.md](./Document/CHANGELOG.md) | Riwayat perubahan |

---

## 📄 Lisensi & Hak Cipta
Aplikasi ini dikembangkan untuk keperluan audit, migrasi data, dan rekonsiliasi sistem **PT Antam Tbk** bekerjasama dengan tim **SISI (PT Sinergi Informatika Semen Indonesia)**. Seluruh hak cipta dilindungi undang-undang.

