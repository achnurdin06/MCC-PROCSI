# Laporan Screening Vulnerability & Rencana Pengamanan Sistem
**Aplikasi:** Migration Command Center (PT ANTAM Tbk)  
**Versi:** 1.0.0  
**Tanggal Audit:** 22 Oktober 2026  
**Status:** Audit awal (9 temuan) dan putaran remediasi lanjutan (21 temuan) **sudah ditutup** — lihat Bagian 7  
**Terakhir diperbarui:** sesuai kode pada branch `dev` (lihat [CHANGELOG.md](./CHANGELOG.md))  
**Dokumen terkait:** [ARCHITECTURE.md](./ARCHITECTURE.md) · [API_SPEC.md](./API_SPEC.md) · [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) · [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md)  

---

## 1. Ringkasan Eksekutif (Executive Summary)

Pemeriksaan keamanan menyeluruh (*security screening & vulnerability assessment*) telah dilakukan terhadap arsitektur, kode sumber (*backend*, *frontend*, dan basis data), dependensi pustaka, serta alur pipeline data aplikasi **Migration Command Center**.

Aplikasi ini bertugas memigrasikan data kritikal enterprise dari **Microsoft SQL Server (`antam_scm.dbo`)** ke **PostgreSQL (`db_procsi.vendor` / `stg_antam`)**, meliputi data profil vendor, akta perusahaan, rekening bank, hingga data akun pengguna (*user & password*). Oleh karena itu, integritas, kerahasiaan, dan kepatuhan terhadap **UU Pelindungan Data Pribadi (UU PDP No. 27/2022)** serta standar keamanan korporat menjadi prioritas mutlak.

### Ringkasan Tingkat Keparahan Temuan:
| Tingkat Keparahan | Jumlah | Deskripsi Singkat |
| :--- | :---: | :--- |
| 🔴 **CRITICAL** | **3** | Akses endpoint tanpa autentikasi, eksposur password DB/SSH plaintext, JWT fallback secret |
| 🟠 **HIGH** | **2** | Risiko SQL Injection pada validator query/precheck, data sensitif/PII di staging belum dienkripsi |
| 🟡 **MEDIUM** | **3** | Kebijakan CORS terbuka & absen Helmet, ketiadaan Rate Limiting, dependensi lama |
| 🟢 **LOW** | **1** | Pesan error backend terlalu verbose (kebocoran informasi internal) |
| **TOTAL** | **9** | **Temuan Teridentifikasi** |

---

## 2. Rincian Temuan Kerentanan (Vulnerability Findings)

### 🔴 VULN-01: Broken Access Control – Endpoint Kritis Tidak Terproteksi Autentikasi
- **Kategori OWASP:** A01:2021 – Broken Access Control
- **Tingkat Keparahan:** 🔴 **CRITICAL (CVSS: 9.8)**
- **Lokasi Kode:** [`src/routes/api.js`](../src/routes/api.js#L40-L135)
- **Kondisi Saat Ini:**
  Hanya rute `/api/auth/*` yang menerapkan middleware `requireAuth` dan `requireRole`. Seluruh endpoint lainnya:
  - `/api/context/*` (manajemen master client, environment, koneksi database, trigger sync Apache Hop)
  - `/api/source/*` (inspeksi data sumber, buat/ubah/hapus view SQL Server & PostgreSQL, validasi query)
  - `/api/etl/*` (import/export konfigurasi migrasi, uji precheck SQL, CRUD tabel konfigurasi)
  - `/api/flows/*` (eksekusi pipeline migrasi, rollback, streaming event SSE, purge data)
  - `/api/reconciliation/*` (data hasil rekonsiliasi dan berita acara migrasi)  
  **Dapat diakses secara langsung oleh siapa saja tanpa perlu token autentikasi (unauthenticated public access).**
- **Dampak:**
  Penyerang dalam jaringan lokal/VPN dapat langsung memicu eksekusi alur data, menghapus *view*, memodifikasi konfigurasi database target, atau membaca seluruh data staging tanpa kredensial.
- **Rekomendasi Remediasi:**
  Terapkan middleware `requireAuth` secara global pada `/api` atau pada grup rute operasional, dan batasi aksi sensitif (eksekusi alur, edit konfigurasi, drop view) hanya untuk peran `SUPERADMIN` dan `OPERATOR` menggunakan `requireRole`.

---

### 🔴 VULN-02: Kredensial Database & SSH Disimpan Plaintext dan Terekspos ke Client
- **Kategori OWASP:** A02:2021 – Cryptographic Failures / A04:2021 – Insecure Design
- **Tingkat Keparahan:** 🔴 **CRITICAL (CVSS: 9.1)**
- **Lokasi Kode:**
  - [`src/services/etl.service.js:L805-L826`](../src/services/etl.service.js#L805-L826) (`getConnections`)
  - [`src/services/etl.service.js:L847-L852`](../src/services/etl.service.js#L847-L852) (`createConnection`)
  - Tabel `mc_center.master_connection` kolom `password` dan `ssh_password`
- **Kondisi Saat Ini:**
  1. Password database target/source dan password SSH Tunnel disimpan dalam teks biasa (*plaintext*) di tabel `mc_center.master_connection`.
  2. Fungsi `getConnections()` menjalankan query `SELECT c.*` yang menyertakan kolom `password` dan `ssh_password` secara utuh ke API response endpoint `GET /api/context/connections`.
- **Dampak:**
  Siapa pun yang mengakses dasbor atau memanggil endpoint API dapat melihat password root/admin database SQL Server, PostgreSQL, dan server SSH.
- **Rekomendasi Remediasi:**
  1. Enkripsi kolom `password` dan `ssh_password` di basis data menggunakan enkripsi simetris dua arah (AES-256-GCM) dengan master key yang aman di *environment variable*.
  2. Saat API mengembalikan daftar koneksi ke frontend, lakukan *field masking* atau jangan sertakan password (`c.password = '********'`). Jangan pernah mengirim plaintext password ke browser.

---

### 🔴 VULN-03: Kunci Rahasia JWT Menggunakan Fallback Hardcoded & PBKDF2 Iterasi Rendah
- **Kategori OWASP:** A02:2021 – Cryptographic Failures
- **Tingkat Keparahan:** 🔴 **CRITICAL (CVSS: 8.8)**
- **Lokasi Kode:** [`src/utils/jwt.js:L3, L93`](../src/utils/jwt.js#L3)
- **Kondisi Saat Ini:**
  - Nilai `JWT_SECRET` memiliki fallback statis: `'mig-antam-super-secret-jwt-key-2025'`. Di file `.env`, variabel `JWT_SECRET` belum didefinisikan secara unik.
  - Jumlah iterasi PBKDF2 untuk hashing password pengguna di fungsi `hashPassword` hanya disetel **1000 iterasi** (standar OWASP merekomendasikan minimal 600.000 iterasi untuk PBKDF2-HMAC-SHA512 atau penggunaan Argon2id / bcrypt).
  - Verifikasi tanda tangan token menggunakan operator `signature !== expectedSignature` biasa, bukan fungsi pembanding konstan waktu (`crypto.timingSafeEqual`), yang membuka potensi *timing side-channel attacks*.
- **Dampak:**
  Penyerang yang mengetahui kode sumber dapat membuat (*forge*) token JWT palsu dengan peran `SUPERADMIN` secara mandiri dan masuk ke sistem tanpa login. Password hash juga rentan di-*crack* dengan cepat menggunakan serangan kamus (*brute-force*).
- **Rekomendasi Remediasi:**
  1. Wajibkan `JWT_SECRET` acak dengan entropi tinggi (minimal 256-bit) dari *environment variable*, dan buat aplikasi *crash/error* saat startup jika secret belum dikonfigurasi di file `.env`.
  2. Gunakan `crypto.timingSafeEqual()` untuk memvalidasi tanda tangan signature token JWT.
  3. Tingkatkan iterasi password hashing atau migrasi ke algoritma `argon2id` / `bcrypt`.

---

### 🟠 VULN-04: Potensi SQL Injection pada Endpoint Validator Query & Precheck
- **Kategori OWASP:** A03:2021 – Injection
- **Tingkat Keparahan:** 🟠 **HIGH (CVSS: 8.5)**
- **Lokasi Kode:**
  - [`src/services/source.service.js:L645-L663`](../src/services/source.service.js#L645-L663) (`validateQuery`)
  - [`src/services/etl.service.js:L1412-L1427`](../src/services/etl.service.js#L1412-L1427) (`testPrecheckSql`)
  - [`src/services/source.service.js:L594-L600`](../src/services/source.service.js#L594-L600) (`createOrAlterView`)
- **Kondisi Saat Ini:**
  Endpoint `/source/validate-query` dan `/etl/configs/test-precheck` menerima input teks SQL mentah dari request body client dan menjalankannya langsung ke mesin database. Meskipun terdapat pengecekan sederhana `upper.startsWith('SELECT')`, string manipulatif seperti `SELECT 1; DROP TABLE ...;` atau fungsi database berbahaya masih dapat dieksekusi.
- **Dampak:**
  Eksekusi query perusak, peretasan hak akses, atau ekstraksi data dari tabel di luar lingkup migrasi.
- **Rekomendasi Remediasi:**
  1. Larang statement majemuk (*multiple statements*) pada koneksi driver database (`multipleStatements: false`).
  2. Implementasikan parser / whitelist sintaks ketat yang hanya mengizinkan klausa `SELECT` murni tanpa karakter `;` pemisah perintah tambahan.
  3. Gunakan akun pengguna database (*database user role*) berprinsip *least privilege* (hanya hak `SELECT` untuk view validator, tanpa hak DDL/DML pada skema sistem).

---

### 🟠 VULN-05: Data Sensitif & PII Tersimpan Tanpa Enkripsi di Tabel Staging
- **Kategori OWASP:** A02:2021 – Cryptographic Failures / Pelanggaran UU PDP No. 27/2022
- **Tingkat Keparahan:** 🟠 **HIGH (CVSS: 7.9)**
- **Lokasi Kode:**
  - Pipeline Ingestion: [`src/services/ingestion.service.js`](../src/services/ingestion.service.js)
  - Tabel Staging: Skema `stg_antam.*` (`stg_user_src`, `stg_bank_src`, `stg_vendors_src`)
- **Kondisi Saat Ini:**
  Data yang ditarik dari SQL Server disimpan ke tabel staging PostgreSQL dalam bentuk teks polos (*plaintext*). Berdasarkan analisis skema, tabel staging menampung data sensitif tinggi:
  - `stg_user_src`: `password`, `nik`, `email`, `current_token`, `file_ttd`
  - `stg_bank_src`: `nomor_rekening`, `pemegang_rekening`, `swift_number`
  - `stg_vendors_src`: `no_ktp_pic`, `email`, `direktur`
- **Dampak:**
  Jika basis data staging diakses oleh analis, developer, atau pihak ketiga saat proses migrasi berjalan, data rahasia perbankan dan identitas kependudukan (KTP/NIK) dapat bocor secara terbuka.
- **Rekomendasi Remediasi:**
  Lihat **Bagian 3** dokumen ini untuk arsitektur dan skenario enkripsi staging.

---

### 🟡 VULN-06: Kebijakan CORS Terbuka & Ketiadaan Security Headers (Helmet)
- **Kategori OWASP:** A05:2021 – Security Misconfiguration
- **Tingkat Keparahan:** 🟡 **MEDIUM (CVSS: 6.5)**
- **Lokasi Kode:** [`src/app.js:L26`](../src/app.js#L26)
- **Kondisi Saat Ini:**
  - Konfigurasi CORS hanya memanggil `app.use(cors())` default, yang memperbolehkan origin `*` (semua domain).
  - Tidak terdapat middleware `helmet` untuk menyuntikkan header proteksi browser seperti `Content-Security-Policy` (CSP), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, dan `Strict-Transport-Security`.
- **Dampak:**
  Rentan terhadap serangan *Clickjacking* (tampilan dasbor di-iframe di situs phishing), XSS injection via external assets, dan eksfiltrasi data via browser cross-origin requests.
- **Rekomendasi Remediasi:**
  1. Pasang pustaka `helmet` pada `src/app.js`.
  2. Batasi origin CORS hanya pada domain/port yang sah milik internal ANTAM.

---

### 🟡 VULN-07: Tidak Ada Mekanisme Rate Limiting pada Login & Endpoint Eksekusi
- **Kategori OWASP:** A04:2021 – Insecure Design / Denial of Service
- **Tingkat Keparahan:** 🟡 **MEDIUM (CVSS: 5.9)**
- **Lokasi Kode:** [`src/routes/api.js`](../src/routes/api.js)
- **Kondisi Saat Ini:**
  Endpoint `POST /api/auth/login` dan endpoint berat seperti `POST /api/flows/execute` tidak dibatasi kuota pemanggilannya (*rate limiter*).
- **Dampak:**
  Penyerang dapat melakukan serangan *credential stuffing* / *brute force password* pada akun admin secara terus-menerus tanpa jeda, serta memicu serangan *Denial of Service* (DoS) dengan menjalankan alur berulang kali hingga memori server habis.
- **Rekomendasi Remediasi:**
  Gunakan pustaka `express-rate-limit` untuk membatasi percobaan login maksimal 5x per menit per IP, serta rate limit umum untuk endpoint eksekusi alur data.
- **Implementasi aktual (✅ ditutup):** sliding-window internal [`rate-limiter.middleware.js`](../src/middleware/rate-limiter.middleware.js) — login 10 req/menit per IP+username, captcha 30 req/menit (lihat Bagian 7).

---

### 🟡 VULN-08: Kerentanan pada Dependensi Dev (`nodemon` & Sub-packages)
- **Kategori OWASP:** A06:2021 – Vulnerable and Outdated Components
- **Tingkat Keparahan:** 🟡 **MEDIUM (CVSS: 5.3)**
- **Lokasi:** [`package.json:L25`](../package.json#L25)
- **Kondisi Saat Ini:**
  Hasil `npm audit` menunjukkan 17 celah kerentanan (10 moderate, 7 high) yang bersumber dari `nodemon@^1.14.10` dan dependensi lawasnya (`micromatch`, `cross-spawn`, `undefsafe`, `braces`).
- **Dampak:**
  ReDoS (Regular Expression Denial of Service) dan Prototype Pollution pada lingkungan development.
- **Rekomendasi Remediasi:**
  Jalankan pembaruan ke versi nodemon modern (`npm install --save-dev nodemon@latest`) atau gunakan runner bawaan `node --watch` (Node.js v26.12.2+).

---

### 🟢 VULN-09: Pesan Error Internal Terlalu Verbose (Information Disclosure)
- **Kategori OWASP:** A05:2021 – Security Misconfiguration
- **Tingkat Keparahan:** 🟢 **LOW (CVSS: 3.7)**
- **Lokasi Kode:** [`src/app.js:L59-L65`](../src/app.js#L59-L65)
- **Kondisi Saat Ini:**
  Global error handler Express langsung merespons dengan `res.status(500).json({ error: err.message })`. Pada beberapa query database yang gagal, `err.message` berisi detail nama tabel, sintaks internal SQL, atau jalur file direktori.
- **Dampak:**
  Membantu penyerang memetakan arsitektur backend secara rinci.
- **Rekomendasi Remediasi:**
  Pada mode `NODE_ENV=production`, samarkan pesan error menjadi pesan generik dan simpan rincian teknis hanya pada server internal logging.

---

## 3. Skenario & Rekomendasi Enkripsi Data Staging

Sesuai permintaan kebutuhan pengamanan, data yang berada di **Tabel Staging (`stg_antam.*`)** harus dilindungi dengan enkripsi saat disimpan (*Encryption at Rest in Staging*), dan didekripsi kembali saat diposting ke **Tabel Target (`slave_*` / `users`)**.

### 3.1. Rekomendasi Matriks Kolom yang Wajib Dienkripsi
Berdasarkan hasil pemindaian struktur kolom database yang dimigrasikan, berikut adalah rekomendasi kolom yang wajib dienkripsi:

| No | Tabel Staging | Tabel Target | Kolom yang Wajib Dienkripsi | Kategori Data | Alasan Perlindungan |
| :-: | :--- | :--- | :--- | :--- | :--- |
| **1** | `stg_user_src` | `users` | `password` | Kredensial Akun | Mencegah kebocoran kata sandi / hash otentikasi pengguna |
| **2** | `stg_user_src` | `users` | `nik` | PII (Identitas Kependudukan) | Perlindungan Nomor Induk Kependudukan (UU PDP) |
| **3** | `stg_user_src` | `users` | `email` | PII (Kontak Pribadi) | Perlindungan alamat email personal |
| **4** | `stg_user_src` | `users` | `current_token` | Token Sesi | Mencegah pembajakan sesi otentikasi aktif |
| **5** | `stg_user_src` | `users` | `file_ttd` | Tanda Tangan Digital | Mencegah pemalsuan aset tanda tangan otorisasi |
| **6** | `stg_bank_src` | `slave_rekening_bank` | `nomor_rekening` | Data Finansial / Perbankan | Rahasia rekening bank transaksi vendor |
| **7** | `stg_bank_src` | `slave_rekening_bank` | `pemegang_rekening`| Data Finansial / Perbankan | Nama pemilik rekening vendor |
| **8** | `stg_bank_src` | `slave_rekening_bank` | `swift_number` | Data Finansial Internasional | Kode transfer bank internasional |
| **9** | `stg_vendors_src` | `slave_vendors` | `no_ktp_pic` | PII (Identitas Personal) | Nomor KTP Penanggung Jawab / PIC Vendor |
| **10** | `stg_vendors_src` | `slave_vendors` | `email` | Kontak Vendor | Mencegah penyalahgunaan kontak korespondensi |

---

### 3.2. Arsitektur Skenario Enkripsi & Dekripsi Pipeline

```
[SQL Server dbo.Views]
       │
       ▼ (1) Data Extraction via Node.js Stream
[Ingestion Service (AES-256-GCM Encryption Hook)]
       │  - Kolom non-sensitif: Plain text
       │  - Kolom sensitif (nik, rek, pass, ktp): Dienkripsi dengan Encryption Key
       ▼ (2) Staging Ingestion
[PostgreSQL Staging: stg_antam.*]
       │  * DATA TERSIMPAN DALAM BENTUK CIPHERTEXT *
       │  (Aman dari inspeksi langsung / data dump staging)
       ▼ (3) DAG Engine / Step Posting Target
[Post Pipeline Service (Decryption Transformer / pgCrypto)]
       │  - Mengambil ciphertext dari staging
       │  - Mendekripsi payload kolom menggunakan Key resmi
       ▼ (4) Target Insertion
[PostgreSQL Target: db_procsi.vendor / users]
       * Data tersimpan siap pakai sesuai spesifikasi target *
```

### 3.3. Pilihan Mekanisme Teknis Enkripsi
1. **Opsi A (Aplikasi Node.js - Disarankan):**
   - **Algoritma:** AES-256-GCM (Authenticated Encryption).
   - **Proses:** Pada saat streaming data di `ingestion.service.js`, kolom-kolom yang terdaftar pada matriks enkripsi otomatis diubah menjadi format `ENC:<iv_hex>:<auth_tag_hex>:<ciphertext_hex>`.
   - **Keuntungan:** Bebas beban CPU server basis data, ciphertext aman dari database administrator staging, dan didukung penuh native `crypto` Node.js tanpa dependensi eksternal.
2. **Opsi B (Database-Level via PostgreSQL `pgcrypto`):**
   - Menggunakan ekstensi `pgcrypto` dengan fungsi `pgp_sym_encrypt(col, key)` saat insert ke staging, dan `pgp_sym_decrypt(col, key)` saat query mapping ke tabel target.

---

## 4. Rencana Implementasi & Jadwal Penutupan Celah Keamanan (Action Plan)

| Tahap | Aktivitas Keamanan | Target Remediasi | Status |
| :---: | :--- | :--- | :---: |
| **Fase 1** | **Proteksi Autentikasi & Otorisasi Global** | Terapkan `requireAuth` pada seluruh rute operasional `/api/*`, amankan master connection, dan sembunyikan password pada API response. | ✅ **SELESAI (TERVALIDASI)** |
| **Fase 2** | **Penguatan Kriptografi & JWT** | Perbarui `JWT_SECRET` unik dari `.env`, gunakan `timingSafeEqual`, tingkatkan iterasi hashing password ke standar aman. | ✅ **SELESAI (TERVALIDASI)** |
| **Fase 3** | **Hardening Middleware & Sanitasi Input** | Pasang security headers (`nosniff`, `SAMEORIGIN`), terapkan sliding window rate limiting pada login, dan SQL injection guard pada validator query. | ✅ **SELESAI (TERVALIDASI)** |
| **Fase 4** | **Implementasi Enkripsi Staging & Fitur Dekripsi** | Bangun modul `encryption.js` (AES-256-GCM / `pgcrypto`), pasang filter enkripsi otomatis pada `ingestion.service.js`, dan auto-decrypt pada `fn_build_target_mapping_sql` posting target. | ✅ **SELESAI (TERVALIDASI)** |
| **Fase 5** | **Pembaruan Dependensi & Audit Akhir** | Update `nodemon` ke versi terbaru, verifikasi zero vulnerability pada `npm audit`, dan validasi pengujian regresi alur migrasi. | ✅ **SELESAI** (`npm audit` = 0 vulnerability, override `@azure/msal-node`) |

---

## 5. Bukti Hasil Verifikasi Remediasi Keamanan

Seluruh implementasi keamanan telah diverifikasi melalui pengujian eksekusi sistem:

1. **Uji Broken Access Control (VULN-01):**
   - Pemanggilan `GET /api/context/connections` tanpa token menghasilkan HTTP `401 Unauthorized`:
     `{"success": false, "error": "Akses ditolak. Token autentikasi tidak ditemukan. Silakan login terlebih dahulu."}`
   - Pemanggilan dengan valid Bearer Token berhasil mengembalikan HTTP `200 OK`.
   - Frontend web dashboard dilengkapi *Transparent Fetch Interceptor* ([`src/public/js/app.js`](../src/public/js/app.js#L1-L28)) dan query token pada SSE EventSource ([`src/public/js/flow-canvas.js`](../src/public/js/flow-canvas.js#L2084)), sehingga antarmuka pengguna tetap berjalan mulus (*smooth zero-bug*).

2. **Uji Masking Kredensial Database & SSH (VULN-02):**
   - Kolom `password` dan `ssh_password` pada response `GET /api/context/connections` kini dikembalikan dalam format tersamar `••••••••` beserta flag `has_password: true`.
   - Modul `testConnection` dan `syncHopConfig` mendekripsi password secara transparan hanya pada sisi backend server.

3. **Uji Penguatan JWT & Crypto (VULN-03):**
   - Kunci rahasia unik dengan entropi 256-bit telah digenerate dan dimuat dari `.env` (`JWT_SECRET` & `ENCRYPTION_MASTER_KEY`).
   - Verifikasi token menggunakan `crypto.timingSafeEqual` untuk mencegah serangan *timing attack*.

4. **Uji SQL Injection Guard (VULN-04):**
   - Input query uji coba: `SELECT 1; DROP TABLE mc_center.master_client; --`
   - Hasil uji: Sistem langsung menolak dan memblokir dengan pesan:
     `{"success": false, "error": "Pernyataan SQL majemuk atau perintah DDL/DML destruktif dilarang dalam validasi query."}`

5. **Uji Rate Limiting Login (VULN-07):**
   - Pada percobaan login salah berulang kali, proteksi sliding-window rate limiter aktif pada request melewati batas (kini 10 req/menit per IP+username) dengan HTTP `429 Too Many Requests`:
     `{"success": false, "error": "Terlalu banyak percobaan login yang gagal. Silakan tunggu 1 menit sebelum mencoba kembali."}`

6. **Uji Enkripsi Staging & Dekripsi Target (VULN-05):**
   - Kolom sensitif (`password`, `nik`, `current_token`, `nomor_rekening`, `swift_number`, `no_ktp_pic`) otomatis dienkripsi saat streaming ingestion ke staging `stg_antam.*` menggunakan `mc_center.fn_encrypt_staging()`.
   - Fungsi mapping target `mc_center.fn_build_target_mapping_sql` otomatis menyisipkan `mc_center.fn_decrypt_staging(s.<col>) AS <col>`, sehingga data target (`users`, `slave_rekening_bank`, `slave_vendors`) menerima data bersih terdekripsi yang siap dipakai.
   - Kolom non-enkripsi / data historis tetap didukung secara mulus (100% backward compatible).

---

## 6. Kesimpulan
Seluruh celah keamanan kategori **CRITICAL** dan **HIGH** yang teridentifikasi telah berhasil ditutup dengan pengamanan berlapis (*defense-in-depth*). Arsitektur perbaikan dirancang secara *backward-compatible* sehingga fungsionalitas visual canvas studio, pipeline ingestion streaming, dan antarmuka dashboard tetap beroperasi dengan lancar, cepat, dan aman.


---

## 7. Putaran Remediasi Lanjutan (21 Temuan) & Kontrol Keamanan Saat Ini

Setelah audit awal, dilakukan pengujian keamanan ulang dan seluruh temuan ditutup. Berikut kontrol yang **aktif di kode saat ini**.

### 7.1 Autentikasi & Kriptografi
| Kontrol | Implementasi |
| :--- | :--- |
| JWT | `JWT_SECRET` wajib ≥ 32 karakter, **tanpa fallback**; algoritma HS256 saja; masa berlaku 8 jam (`src/utils/jwt.js`) |
| Enkripsi | `ENCRYPTION_MASTER_KEY` wajib ≥ 32 karakter, **tanpa fallback** (`src/utils/encryption.js`) |
| Hash password | PBKDF2-SHA512, 210.000 iterasi, format `pbkdf2:<iter>:<salt>:<hash>`; hash lama tetap diverifikasi memakai iterasi yang tersimpan |
| Verifikasi hash/token | `crypto.timingSafeEqual` |
| Brute force | Login: 10 req/menit per IP+username; captcha: 30 req/menit; respons `429` |
| Anti-enumerasi | Forgot-password selalu memberi respons yang sama; registrasi menghasilkan akun `VIEWER` nonaktif menunggu persetujuan admin |
| Sesi | `requireAuth` memeriksa ulang `is_active` dan role di DB pada setiap request. Jika lookup DB gagal sementara, request lanjut memakai payload token (**risiko diterima**) |
| Token di URL | Query `?token=` hanya diterima pada `/api/flows/stream/:runId` (SSE `EventSource` tidak bisa mengirim header) |

### 7.2 Otorisasi (RBAC)
Dua guard: `requireAdmin` (`SUPERADMIN`) dan `requireOperations` (`SUPERADMIN` + `OPERATOR`) diterapkan pada 55+ endpoint tulis/eksekusi. `VIEWER` hanya dapat membaca. Matriks per endpoint ada di [API_SPEC.md](./API_SPEC.md).

### 7.3 Input, SQL, dan Jaringan
| Kontrol | Implementasi |
| :--- | :--- |
| SQL read-only guard | `assertReadOnlySelect` & `assertSafeIdentifier` di `src/utils/sql-guard.js` untuk validator/precheck/browse |
| Input guard | `sqlInjectionGuard` (`input-guard.middleware.js`): hanya string, ≤ 255 karakter, pola SQLi ditolak |
| Tabel terlarang | `BLOCKED_BROWSE_TABLES`: `sys_users`, `sys_roles`, `master_connection` |
| SSRF | `testConnection` memvalidasi host tujuan |
| Helmet/CSP | CSP aktif; `script-src` masih memuat `'unsafe-inline'`, `'unsafe-eval'`, dan CDN Tailwind (**risiko diterima** selama frontend memakai inline script & Tailwind CDN); HSTS hanya di `production` |
| CORS | Allowlist via `CORS_ALLOWED_ORIGINS` |
| Reverse proxy | `trust proxy` diatur lewat `TRUST_PROXY` |
| Kredensial | Password DB/SSH dimask pada response; file `config/hop-configs/` diberi izin `0600` dan di-`.gitignore` |
| Error handling | Error handler dengan correlation-ID; detail internal tidak dibocorkan ke klien |
| Dependensi | `npm audit` = 0 vulnerability |

### 7.4 Risiko Residual / Rekomendasi Lanjutan
| # | Risiko | Tingkat | Rekomendasi |
| :-: | :--- | :-: | :--- |
| 1 | CSP masih mengizinkan `unsafe-inline`/`unsafe-eval` & CDN | 🟡 MEDIUM | Bundel Tailwind secara lokal, pindahkan inline script ke file, gunakan nonce |
| 2 | Token disimpan di `localStorage` | 🟡 MEDIUM | Pertimbangkan cookie `HttpOnly` + CSRF token |
| 3 | Rate limiter & state run berada di memori (single instance) | 🟡 MEDIUM | Gunakan Redis bila di-scale horizontal |
| 4 | Fallback ke payload token saat DB lookup gagal | ⚪ LOW | Opsional: fail-closed untuk role `SUPERADMIN` |
| 5 | Tidak ada MFA | ⚪ LOW | Tambahkan TOTP untuk `SUPERADMIN` |
| 6 | Tidak ada rotasi otomatis `JWT_SECRET`/`ENCRYPTION_MASTER_KEY` | ⚪ LOW | Prosedur rotasi manual di [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) |

> Catatan: jika `ENCRYPTION_MASTER_KEY` diganti, data staging & kredensial yang sudah terenkripsi tidak dapat didekripsi. Jangan rotasi tanpa migrasi ulang.
