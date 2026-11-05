# Changelog MCC-PROCSI

Format mengikuti [Keep a Changelog](https://keepachangelog.com/id-ID/1.1.0/). Tanggal dalam format `YYYY-MM-DD`. Setiap rilis ke `main` wajib menambah entri di sini.

## [Belum dirilis] — branch `dev`

### Diubah (penyamaran nilai dev, versi Node, cakupan multi-database)
- **Konfigurasi SQL Server dipindah sepenuhnya ke Master Connection**: `.env.development`, `.env.example`, dan panduan tidak lagi memuat kredensial MSSQL; query sumber memilih koneksi aktif sesuai environment dan SSH tunnel memakai port lokal dinamis per koneksi.
- **Node.js minimum `> v26.12.1`**: `engines.node` di `package.json` menjadi `>=26.12.2`; README, ARCHITECTURE, DEPLOYMENT_RUNBOOK, security diselaraskan.
- **Nilai dev tidak lagi di-hardcode di `src/`**: IP, user SSH, port dan nama database dev di `tunnel.js`, `dag-engine.service.js`, `etl.service.js`, `pipeline.service.js`, `source.service.js`, `error-formatter.js`, `app.js`, `index.html` dan `public/js/app.js` diganti nilai dari `process.env` atau placeholder generik. Port default wizard menjadi 5432.
- **Cakupan aplikasi**: dideskripsikan sebagai platform migrasi **multi-database → PostgreSQL** (README, AGENTS, ARCHITECTURE, USER_GUIDE, `<title>`, `package.json`). Driver yang aktif saat ini: SQL Server dan PostgreSQL.

### Diperbaiki
- **Lampiran Berita Acara sesuai Master Target Config**: lampiran kini dirender per target yang didefinisikan pada `mc_center.migration_target_config` (khusus yang berstatus POSTED). Struktur kolom dan data diambil langsung dari masing-masing tabel target yang dimigrasi, bukan hanya target utama/staging tunggal. Cache JS diperbarui ke `v5.33`.
- **Total baris di "Pilihan Config Hasil Migrasi Dicetak"**: jumlah baris per konfigurasi kini adalah baris yang benar-benar dimigrasi (selisih baris target sesudah − sebelum posting, hanya target berstatus POSTED), bukan total isi tabel target. Cache JS diperbarui ke `v5.32`.
- **Filter Berita Acara hanya untuk konfigurasi berstatus POSTED**: daftar "Pilihan Config Hasil Migrasi Dicetak" kini hanya menampilkan konfigurasi yang memiliki minimal satu target berstatus action `POSTED`. Konfigurasi yang belum diposting tidak lagi muncul dalam pilihan, tombol "Pilih Semua" dan "Reset" hanya memilih konfigurasi POSTED, dan tabel lampiran hanya menampilkan data yang benar-benar telah dimigrasi (tidak lagi memakai data contoh/fallback). Cache JS diperbarui ke `v5.31`.
- **Halaman pertama kosong pada Cetak Lampiran**: dokumen cetak lampiran kini hanya berisi lembar landscape tanpa pembungkus modal BA dan tanpa pemisah halaman awal, sehingga lampiran langsung dimulai di halaman pertama. Cache CSS/JS diperbarui ke `v5.21`/`v5.30`.
- **Cetak BA dan Lampiran dipisah**: dialog Print Chrome memakai satu orientasi untuk seluruh dokumen sehingga lampiran landscape tampak seperti portrait. Tombol **Cetak BA** kini mencetak halaman 1–2 (A4 portrait) dan tombol baru **Cetak Lampiran** mencetak lampiran (A4 landscape) sebagai cetakan terpisah, masing-masing dengan `@page` sesuai orientasinya. Cache CSS/JS diperbarui ke `v5.20`/`v5.29`.
- **PDF Berita Acara kosong atau berbeda dari preview**: pencetakan iframe kini menunggu dokumen BA (bukan dokumen awal iframe yang kosong), font, dan gambar selesai dimuat sebelum membuka dialog cetak; lembar portrait dan lampiran landscape tetap terisolasi dari layout aplikasi. Cache JS diperbarui ke `v5.28`.
- **Lebar lampiran PDF tetap menyempit setelah halaman dibuat landscape**: lampiran kini dipindahkan sementara dari wadah pratinjau yang berbagi halaman portrait ke wadah cetak mandiri selebar A4 landscape; setelah dialog cetak ditutup, DOM dipulihkan ke posisi semula. Cache CSS/JS diperbarui ke `v5.18`/`v5.26`.
- **Konteks halaman cetak campuran BA**: konteks dasar print kini landscape untuk menghindari lampiran mewarisi alur portrait; lembar-lembar utama BA ditetapkan eksplisit ke A4 portrait dan lampiran ke A4 landscape. Cache CSS diperbarui ke `v5.17`.
- **Konteks landscape lampiran saat cetak BA**: pembungkus seluruh halaman lampiran kini juga ditetapkan ke named page A4 landscape, bukan hanya lembar-lembar di dalamnya, agar layout cetak tidak mewarisi konteks portrait dari halaman sebelumnya. Cache CSS diperbarui ke `v5.16`.
- **Lebar lampiran PDF tidak konsisten dengan kertas**: aturan cetak kini mengesampingkan ukuran pembungkus dan transform zoom pratinjau, sehingga wrapper mengikuti lebar A4 landscape (297 mm) sementara area isi tabel/footer tetap 253 mm. Cache CSS diperbarui ke `v5.15`.
- **Ukuran dan margin halaman lampiran PDF**: orientasi halaman lampiran kini memakai ukuran A4 landscape eksplisit (297×210 mm), dengan padding lembar sebagai margin isi; tabel dan footer berada di dalam margin halaman. Cache CSS diperbarui ke `v5.14`.
- **Footer dan lebar tabel lampiran pada PDF**: pembungkus tabel kini mengisi sisa tinggi halaman (bukan flex-basis 253 mm) sehingga footer tidak terdorong keluar kertas; tabel tetap memakai lebar isi landscape 253 mm. Paginasi menyisakan jarak aman tambahan agar baris tidak menimpa footer saat dicetak. Cache CSS/JS diperbarui ke `v5.13`/`v5.25`.
- **Lebar tabel lampiran saat cetak PDF**: pembungkus, setiap bagian tabel, dan tabel lampiran kini dipaksa memakai seluruh lebar area isi landscape (253 mm), agar tidak menyusut dan kolom tidak terpotong. Cache CSS diperbarui ke `v5.12`.
- **Paginasi isi Berita Acara**: ringkasan dan lampiran kini membagi baris berdasarkan ruang nyata di atas footer, bukan kuota baris tetap, sehingga baris panjang tidak menimpa footer pada preview maupun PDF. Lebar kolom ringkasan disesuaikan dengan halaman A4 portrait agar tabel tidak berantakan; baris tabel dijaga tetap utuh di PDF. Cache CSS/JS diperbarui ke `v5.11`/`v5.23`.
- **Preview landscape Berita Acara**: lembar A4 horizontal kini otomatis diskalakan agar muat di area preview desktop maupun mobile, termasuk tinggi pembungkus seluruh halaman lampiran; halaman dipusatkan saat muat dan diratakan ke kiri saat diperkecil. Tabel lampiran dipaksa mengikuti lebar lembar; judul kolom dan nilai panjang membungkus tanpa tumpang tindih maupun scroll horizontal. Cache CSS/JS diperbarui ke `v5.9`/`v5.20`.
- **Lebar konten lampiran landscape saat cetak BA**: halaman landscape kini menetapkan ukuran kertas 297×210 mm dan lebar area isi 253 mm secara eksplisit, sehingga tabel tidak dibatasi ke lebar portrait dan logo kanan tetap berada di dalam halaman.
- **Tata letak dan logo Berita Acara saat cetak PDF**: gaya cetak halaman kini mengikuti padding/line-height preview dialog, tabel lampiran memakai lebar halaman landscape dengan teks terbungkus (tidak terpotong ke kanan), dan logo SVG mempertahankan gradient saat lembar lanjutan dikloning. Cache CSS/JS dinaikkan ke `5.1`/`5.14`.
- **Preview dan cetak PDF Berita Acara untuk ringkasan migrasi berukuran besar**: pembagian ringkasan kini mengikuti tinggi baris pada lembar A4 sebenarnya, dan batas tinggi kontainer modal tidak lagi memotong halaman PDF. Cache `app.js` dinaikkan ke `?v=5.13`.
- **Respons Audit Trail bukan JSON**: frontend kini mengenali respons HTML/non-JSON dan menampilkan pesan yang menyarankan restart server bila endpoint belum dimuat; API yang tidak dikenal kini selalu mengembalikan JSON `404` alih-alih halaman HTML bawaan Express.
- **Status database Source/Target mengikuti environment**: badge header hanya menampilkan koneksi ber-role SOURCE/TARGET yang aktif pada environment terpilih. `/api/health` kini melaporkan PostgreSQL database kontrol aplikasi secara terpisah dan tidak lagi menyebutnya sebagai database TARGET.
- **Role / Menu / Matrix Menu tidak berpengaruh**: API mengirim profil user dalam camelCase (`roleCode`, `roleId`, ...) sedangkan UI membaca snake_case (`role_code`, `role_id`), sehingga `applyMenuPermissions` salah mengenali role dan hak akses tidak diterapkan. Kini profil dinormalisasi (`normalizeAuthUser`).
- Perubahan matriks kini ikut berlaku pada sesi yang sedang aktif tanpa login ulang: `refreshUserPermissions()` dipanggil setelah simpan matriks, saat tab browser kembali aktif, dan setiap 60 detik.
- Guard navigasi `isTabAllowedForUser()` di `switchMainTab` agar tab yang tidak diizinkan tidak bisa dibuka lewat state tersimpan (`antam_active_main_tab`).
- **Menu user (mis. OPERATOR) tidak sinkron dengan konfigurasi**: tombol *6. Userguide* dipaksa tampil untuk semua role dan `TAB_USERGUIDE` tidak dicek oleh `isTabAllowedForUser`/`applyMenuPermissions`, sehingga matriks menu diabaikan. Kini Userguide mengikuti `can_view` matriks seperti menu lain (SUPERADMIN tetap melihat semua).
- Backend (`login` dan `getProfile`) kini hanya mengirim menu yang `can_view` **dan** `is_active`, sehingga menu yang dinonaktifkan di Maintain Menu tidak lagi sampai ke role non-superadmin.
- `app.js` naik ke `?v=5.4` untuk menghindari cache lama.
- **Master data Migration Config belum menampilkan semua kolom**: tabel *Migration Config* kini menampilkan `business_keys` dan `error_policy`. Kolom Client/Env hanya ditampilkan di *Migration Config*; tabel turunan (Convert Rules, Target Config, Master Lookup) tidak menampilkannya.
- Form entri/edit melengkapi field yang kurang: `business_keys`, `error_policy` (`FAIL_ALL`/`ALLOW_PARTIAL`, default `FAIL_ALL`) pada Migration Config, serta tampilan Client/Environment pada Migration Config (terkunci, otomatis mengikuti Client/Env di header saat tambah data; saat edit nilai record dipertahankan). Form tabel turunan tidak lagi menampilkan Client/Environment; nilainya mengikuti Client/Env yang sedang dipilih saat data dibuat.

### Ditambahkan
- **Audit Trail**: menu baca untuk `VIEWER` dan `SUPERADMIN` mencatat aktivitas API pengguna termasuk login berhasil/gagal; data request sensitif (body, query string, token, password, kredensial) tidak disimpan. VIEWER dibatasi berdasarkan assignment client/environment atau aktivitas sendiri.
- **Konteks menu dan paginasi Audit Trail**: aktivitas API kini memuat nama/kode menu yang sedang dibuka, perpindahan menu dicatat sebagai `MENU_OPEN`, pencarian turut mencakup menu, serta tabel menyediakan ukuran halaman 25/50/100, nomor halaman, dan navigasi pertama/terakhir.
- **Proteksi kredensial Master Connection**: jalur wizard dan penyimpanan environment kini mengenkripsi password database serta SSH menggunakan AES-256-GCM `ENC:v1:`. Password lama pada update dipertahankan (dan plaintext lama dimigrasikan ke ciphertext saat disentuh); respons hasil simpan tetap dimasking.
- **Tombol Tour**: ukuran ikon disamakan dengan Settings (48×48 px desktop dan sama-sama memenuhi layout responsif mobile).
- **Duplikasi master konfigurasi**: tombol Duplikat (📋) pada Migration Config, Convert Rules, Target Config, dan Master Lookup membuka form tambah yang terisi dari baris sumber. Primary key otomatis dibuat ulang; nama staging table dan `lookup_name` mendapat akhiran unik agar duplikasi berulang tidak bentrok. `app.js` naik ke `?v=5.12`.
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
