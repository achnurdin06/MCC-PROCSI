# Changelog MCC-PROCSI

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/). Tanggal dalam format `YYYY-MM-DD`. Setiap rilis ke `main` wajib menambah entri di sini.

## [Belum dirilis] — branch `dev`

### Diubah (penyamaran nilai dev, versi Node, cakupan multi-database)
- **Node.js minimum `> v26.12.1`**: `engines.node` di `package.json` menjadi `>=26.12.2`; README, ARCHITECTURE, DEPLOYMENT_RUNBOOK, security diselaraskan.
- **Nilai dev tidak lagi di-hardcode di `src/`**: IP, user SSH, port dan nama database dev di `tunnel.js`, `dag-engine.service.js`, `etl.service.js`, `pipeline.service.js`, `source.service.js`, `error-formatter.js`, `app.js`, `index.html` dan `public/js/app.js` diganti nilai dari `process.env` atau placeholder generik. Port default wizard menjadi 5432.
- **Cakupan aplikasi**: dideskripsikan sebagai platform migrasi **multi-database → PostgreSQL** (README, AGENTS, ARCHITECTURE, USER_GUIDE, `<title>`, `package.json`). Driver yang aktif saat ini: SQL Server dan PostgreSQL.

### Diperbaiki
- **Role / Menu / Matrix Menu tidak berpengaruh**: API mengirim profil user dalam camelCase (`roleCode`, `roleId`, ...) sedangkan UI membaca snake_case (`role_code`, `role_id`), sehingga `applyMenuPermissions` salah mengenali role dan hak akses tidak diterapkan. Kini profil dinormalisasi (`normalizeAuthUser`).
- Perubahan matriks kini ikut berlaku pada sesi yang sedang aktif tanpa login ulang: `refreshUserPermissions()` dipanggil setelah simpan matriks, saat tab browser kembali aktif, dan setiap 60 detik.
- Guard navigasi `isTabAllowedForUser()` di `switchMainTab` agar tab yang tidak diizinkan tidak bisa dibuka lewat state tersimpan (`antam_active_main_tab`).
- **Menu user (mis. OPERATOR) tidak sinkron dengan konfigurasi**: tombol *6. Userguide* dipaksa tampil untuk semua role dan `TAB_USERGUIDE` tidak dicek oleh `isTabAllowedForUser`/`applyMenuPermissions`, sehingga matriks menu diabaikan. Kini Userguide mengikuti `can_view` matriks seperti menu lain (SUPERADMIN tetap melihat semua).
- Backend (`login` dan `getProfile`) kini hanya mengirim menu yang `can_view` **dan** `is_active`, sehingga menu yang dinonaktifkan di Maintain Menu tidak lagi sampai ke role non-superadmin.
- `app.js` naik ke `?v=5.4` untuk menghindari cache lama.
- **Master data Migration Config belum menampilkan semua kolom**: tabel *Migration Config* kini menampilkan `business_keys` dan `error_policy`. Kolom Client/Env hanya ditampilkan di *Migration Config*; tabel turunan (Convert Rules, Target Config, Master Lookup) tidak menampilkannya.
- Form entri/edit melengkapi field yang kurang: `business_keys`, `error_policy` (`FAIL_ALL`/`ALLOW_PARTIAL`, default `FAIL_ALL`) pada Migration Config, serta tampilan Client/Environment pada Migration Config (terkunci, otomatis mengikuti Client/Env di header saat tambah data; saat edit nilai record dipertahankan). Form tabel turunan tidak lagi menampilkan Client/Environment; nilainya mengikuti Client/Env yang sedang dipilih saat data dibuat.

### Ditambahkan
- **Fitur Tour Interaktif (Product Tour)**: dialog otomatis setelah login untuk mengajak pengguna mengikuti tur pengenalan aplikasi langkah demi langkah (Source Data ➔ Migration Config ➔ Workflow Canvas Studio ➔ Hasil Migrasi & Berita Acara ➔ System Administration / Pengaturan).
  - Bersifat murni *read-only* (hanya berpindah menu dan menyorot elemen, tidak menekan tombol aksi atau mengeksekusi migrasi).
  - Filter akses cerdas: langkah untuk menu yang tidak diizinkan oleh hak akses pengguna (mis. menu System Administration bagi non-admin) dilewati secara otomatis.
  - Dialog ajakan muncul setiap login sampai pengguna mencentang "Jangan tampilkan lagi saat login" (tersimpan per pengguna di `localStorage`).
  - Penjelasan tujuan masing-masing dari 4 master konfigurasi (Migration Config, Convert Rules, Target Config, Master Lookup), satu langkah per tab; tour berpindah sub-tab hanya untuk menyorot.
  - Penjelasan rinci Workflow Canvas Studio: fungsi dan tujuan Flow 1 (Staging), Flow 2 (Post), Flow 3 (Rollback), Flow 4 (Purge), serta 4 tab panel bawah (Live Terminal Console, Riwayat Eksekusi, Log Langkah, Log Error). Tour berpindah antar tab panel bawah hanya untuk menyorot, tanpa menjalankan alur.
  - Tombol **🧭 Tour** permanen di header agar tur dapat diulang kapan saja.
  - Integrasi dengan Chatbot Helpdesk: entri `tour` dan tombol pintasan *"Buka Tour Sekarang"* untuk memulai tur langsung dari jendela chat.
  - Berkas: [`src/public/js/product-tour.js`](../src/public/js/product-tour.js), gaya pada [`src/public/css/style.css`](../src/public/css/style.css).
- **Chatbot Helpdesk** (pojok kanan bawah): asisten berbasis aturan (tanpa API eksternal) untuk kendala operasional — koneksi/timeout, login & RBAC, Flow 1–4, konfigurasi, canvas, rekonsiliasi & Berita Acara. Fitur: chip saran, tombol pintasan ke tab terkait, dan diagnosa langsung via `/api/health`. Berkas: `src/public/js/helpdesk-bot.js`; widget disembunyikan di layar login dan saat cetak.
- **Materi chatbot role Operator**: basis pengetahuan dan chip saran otomatis menyesuaikan saat `role_code` pengguna adalah `OPERATOR`/`SUPERADMIN` — SOP end-to-end, hak & batas operator, troubleshooting Flow 1 (`DUPLICATE_SOURCE_KEY`, `MISSING_BUSINESS_KEYS`), Flow 2 (`ALREADY_POSTED`, `ALREADY_ROLLED_BACK`, FK/`exec_order`), Flow 3 Rollback, Flow 4 Purge (Dual-Guard), run macet (cancel/force-stop), dan panduan eskalasi. Materi ini disembunyikan untuk role `VIEWER`.
- Perbaikan deskripsi flow pada entri `flow` bot: Flow 3 = **Rollback** (sebelumnya salah tertulis Compare/rekonsiliasi) dan Flow 4 = **Purge** (sebelumnya tertulis Purge/rollback), sesuai [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md).
- Resolusi environment otomatis berdasarkan branch git: `main`/`master`/`production`/`workstation-main` → `.env.production`, selain itu → `.env.development` ([`src/config/env.js`](../src/config/env.js)); `NODE_ENV` eksplisit tetap diutamakan. Skrip `start:dev` dan `start:prod`.
- [`src/utils/sql-guard.js`](../src/utils/sql-guard.js) (`assertReadOnlySelect`, `assertSafeIdentifier`) dan [`input-guard.middleware.js`](../src/middleware/input-guard.middleware.js) untuk endpoint auth.
- Panduan instalasi server on-premise lengkap (PostgreSQL, Node, PM2, Nginx+SSE, firewall, smoke test) di README.
- Struktur dokumentasi di `Document/`: ARCHITECTURE, API_SPEC, DATABASE_SCHEMA, ENVIRONMENT_CONFIG, DEPLOYMENT_RUNBOOK, MIGRATION_FLOWS, DECISION_LOG, CONTRIBUTING, AGENTS, CHANGELOG.
- Folder `backup/` untuk berkas tidak terpakai (`backup/scratch/*`).

### Diubah
- Dokumen `.md` selain README dipindah ke `Document/`; `security.md` dan `TESTING_REPORT.md` diperbarui.
- Konsolidasi dokumen yang tumpang tindih: materi `analisis.md` digabungkan ke [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md#8-kelemahan-yang-diketahui-status-mitigasi--roadmap), materi panduan operator `konten.md` disempurnakan menjadi [USER_GUIDE.md](./USER_GUIDE.md); berkas asli dihapus agar tidak saling bertentangan.

- Node.js wajib versi terbaru (v26.x LTS): `engines.node >=26.0.0` di `package.json`, panduan NodeSource `setup_26.x` di README, dan dokumen terkait diselaraskan.
- File `.env` umum (redundan, hasil muat identik) dihapus; hanya `.env.development`, `.env.production`, dan template `.env.example` yang dipakai.
- README, `.env.example`, dan dokumen disamarkan: host, user, password, dan nama database diganti placeholder `<...>`.

### Keamanan (remediasi 21 temuan — lihat [security.md](./security.md))
- `JWT_SECRET` dan `ENCRYPTION_MASTER_KEY` wajib ≥ 32 karakter, tanpa fallback hardcoded; JWT hanya HS256, masa berlaku 8 jam; query `?token=` hanya untuk `/api/flows/stream/:runId`.
- PBKDF2-SHA512 dinaikkan ke 210.000 iterasi (hash lama tetap diverifikasi sesuai iterasi tersimpan).
- RBAC server-side: `ADMIN` (SUPERADMIN) dan `OPERATIONS` (SUPERADMIN+OPERATOR) pada 55+ endpoint; status aktif & role dicek ulang ke DB di setiap request.
- Helmet CSP, HSTS (production), CORS allowlist (`CORS_ALLOWED_ORIGINS`), `trust proxy` terkonfigurasi.
- Rate limiter login/register/forgot-password per IP+username, captcha, respons forgot-password anti-enumerasi, `timingSafeEqual`.
- Proteksi SSRF pada uji koneksi; kredensial dimasking di respons; tabel sensitif diblokir dari browse.
- Error handler dengan correlation ID; `npm audit` = 0 kerentanan (override `@azure/msal-node`).

### Diperbaiki
- Server lokal: `ENOENT … src/public/index.html` akibat path lama; aplikasi kini dijalankan dari root repo ini.
- **Maintain Menu & Navigasi**: tambah/ubah/hapus menu gagal karena `authFetch` tidak mengirim `Content-Type: application/json` pada body — kini dikirim otomatis; POST/PUT/DELETE `/api/auth/menus` menghasilkan 200.
- **Refresh halaman menampilkan login** walau sudah login: `initAuth()` kini retry 3× sebelum menyerah dan kelas `auth-pending` menyembunyikan layar login selama sesi diperiksa; token tidak dihapus pada error jaringan sementara.

## 2026-10-29
- `c267b24` Perjelas warna tautan login, input captcha hitam, hapus nama perusahaan dari footer.
- `300bc02` Login: ikon mata, lupa password, pendaftaran, proteksi captcha.
- `a10b76e` Latar belakang login baru.

## 2026-10-26
- Rekonsiliasi: status `STAGING ONLY`, `ROLLED_BACK` dengan `sumBefore/sumAfter`, `No Posted` untuk posting +0 baris; Flow 1 setelah rollback kembali `STAGING ONLY`.
- Orchestrator: guard Flow 1 dibuka untuk mode incremental delta berulang; sesi `flow_4_purge` mengosongkan status posting/rollback.

## 2026-10-25
- Staging: fail-fast duplicate guard + `staging_data_history` (audit ledger).
- Riwayat kronologi sesi, aksi batalkan run gagal.

## 2026-10-23
- Penutupan kerentanan kritis, enkripsi data sensitif di staging + auto-decrypt; sanitasi kunci config dinamis.

## 2026-10-22
- Resume workflow in-place, perbaikan multi-config loop (Flow 2), tombol *Lanjutkan*/*Run Ulang*, userguide full-width, audit keamanan awal.

## 2026-10-20 – 2026-10-21
- Compare 3-tier (source/staging/target), canvas studio dengan koneksi environment dinamis, userguide.
