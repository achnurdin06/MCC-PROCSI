# Buku Panduan Operasional Sistem (User Guide)
# ETL Migration Command Center
### Multi-Database Enterprise Platform (SQL Server ➔ PostgreSQL)

---

## Daftar Isi
1. [Pengenalan & Arsitektur Sistem](#1-pengenalan--arsitektur-sistem)
   - 1.1 Latar Belakang & Tujuan
   - 1.2 Arsitektur 3-Tier (Source ➔ Staging ➔ Target)
   - 1.3 Prinsip Keamanan Data: Dual-Guard Protection
   - 1.4 Konektivitas & Auto-Healing SSH Tunnel
2. [Navigasi Global & Kontrol Header](#2-navigasi-global--kontrol-header)
   - 2.1 Pemilih Tenant (Client & Environment)
   - 2.2 Status Indikator Database Real-Time
   - 2.3 Master System Settings (Client, Environment, Connection)
   - 2.4 Manajemen Sesi & Logout
3. [Menu 0: Selamat Datang (Portal Inisialisasi)](#3-menu-0-selamat-datang-portal-inisialisasi)
   - 3.1 Setup Gate untuk Instalasi Baru
   - 3.2 Ringkasan Dashboard Sambutan
4. [Menu 1: Source Data (Katalog View SQL Server)](#4-menu-1-source-data-katalog-view-sql-server)
   - 4.1 Eksplorasi View & Tabel Sumber
   - 4.2 Filter Status & Pencarian View
   - 4.3 Data Inspector & Preview Skema DDL
   - 4.4 Editor Objek & Query View (Fitur Salin Query di Footer)
5. [Menu 2: Migration Config (Master Pemetaan & Konfigurasi ETL)](#5-menu-2-migration-config-master-pemetaan--konfigurasi-etl)
   - 5.1 Struktur Konfigurasi & Foreign Key Ordering (`exec_order`)
   - 5.2 Empat Sub-Tabel Master (`config`, `convert_rule`, `target_config`, `lookup`)
   - 5.3 Operasi CRUD, Clone Konfigurasi, dan Uji Coba Query
6. [Menu 3: Workflow Canvas Studio (Dynamic Visual DAG Orchestrator)](#6-menu-3-workflow-canvas-studio-dynamic-visual-dag-orchestrator)
   - 6.1 Kanvas Grafis Interaktif (DAG Workflow)
   - 6.2 Panduan Lengkap Eksekusi 4 Alur Utama (The 4 Flows)
     - Flow 1: Staging Landing & Convert Lookup Engine
     - Flow 2: Multi-Target Post Engine (Batch Chunking)
     - Flow 3: Safe Rollback Engine (Transactional Undo)
     - Flow 4: Target Purge Engine (Dual-Guard & Looping Multi-Table)
   - 6.3 Dialog Parameter Eksekusi Cerdas
   - 6.4 Panel Konsol Resizable & Streaming Log Real-Time (SSE)
   - 6.5 Riwayat Eksekusi, Per-Step Inspection, & Log Galat
7. [Menu 4: Hasil Migrasi (Pipeline Monitor 3-Tier & Berita Acara)](#7-menu-4-hasil-migrasi-pipeline-monitor-3-tier--berita-acara)
   - 7.1 Tabel Rekonsiliasi Data 3-Tahap
   - 7.2 Indikator Status Rekonsiliasi & Status Aksi
   - 7.3 Fitur Komparasi Data Kolom 3-Tier (⚖️ Compare)
   - 7.4 Formulir Berita Acara Migrasi (Poin 1 s/d 4) & Ekspor PDF
8. [Menu 5: System Administration & Access Control (RBAC)](#8-menu-5-system-administration--access-control-rbac)
   - 8.1 Manajemen Pengguna (Master Users) & Penugasan Tenant
   - 8.2 Manajemen Peran (Master Roles)
   - 8.3 Matriks Hak Akses Menu & Perizinan (Menu & Permission Matrix)
9. [Menu 6: Userguide Terintegrasi](#9-menu-6-userguide-terintegrasi)
   - 9.1 Fitur Pencarian Tutorial & Filter Kategori
   - 9.2 Navigasi Cepat & Cetak Panduan
10. [Standar Operasional Prosedur (SOP) & Troubleshooting (FAQ)](#10-standar-operasional-prosedur-sop--troubleshooting-faq)
    - 10.1 SOP Alur Kerja Migrasi End-to-End
    - 10.2 Pertanyaan Sering Diajukan (FAQ) & Penyelesaian Kendala

---

## 1. Pengenalan & Arsitektur Sistem

### 1.1 Latar Belakang & Tujuan
**ETL Migration Command Center** adalah platform enterprise yang dirancang khusus untuk memfasilitasi, mengotomasi, dan mengaudit proses migrasi data dari sistem lawas (*legacy*) **Microsoft SQL Server (`antam_scm`)** ke basis data modern **PostgreSQL (`db_procsi`)**.

Platform ini menggabungkan eksekusi *Extract-Transform-Load (ETL)* berbasis pipeline berkinerja tinggi dengan antarmuka web interaktif, kanvas visual *Directed Acyclic Graph (DAG)*, rekonsiliasi data otomatis, serta pembuatan dokumen formal **Berita Acara Migrasi**.

### 1.2 Arsitektur 3-Tier (Source ➔ Staging ➔ Target)
Proses migrasi mengadopsi model pemisahan tiga lapisan (*3-Tier Architecture*) untuk menjamin isolasi risiko dan kemudahan verifikasi:

```
+---------------------------+       Flow 1        +---------------------------+       Flow 2        +---------------------------+
|    TIER 1: SOURCE DB      |  ================>  |    TIER 2: STAGING DB     |  ================>  |    TIER 3: TARGET PROD    |
|   Microsoft SQL Server    |  Ekstraksi Mentah   |        PostgreSQL         |   Posting Valid     |        PostgreSQL         |
|   Database: antam_scm     |   & Transformasi    |    Database: db_procsi    |   & Sinkronisasi    |    Database: db_procsi    |
|   Schema: dbo             |    Lookup Awal      |    Schema: stg_antam      |     Sequence        |    Schema: vendor / core  |
|   View: v_migration_*     |                     |    Tabel: stg_*_src       |                     |    Flag: migration = '1'  |
+---------------------------+                     +---------------------------+                     +---------------------------+
                                                               ^                                                 |
                                                               |================= Flow 3 / Flow 4 ===============|
                                                                        Rollback & Purge (Reversible Undo)
```

1. **Tier 1 (Source Database - SQL Server)**:
   - Sumber data operasional awal pada database `antam_scm.dbo`.
   - Data dibaca secara non-invasif melalui objek SQL View (`v_migration_*`) yang telah dioptimasi dengan query pengelompokan dan alias kolom standar.
2. **Tier 2 (Staging Database - PostgreSQL)**:
   - Area penampungan sementara pada skema `stg_antam`.
   - Mengisolasi data mentah, membersihkan karakter string ilegal, serta menjalankan *stored procedure* konversi kode kamus (*lookup mapping engine*).
3. **Tier 3 (Target Database - PostgreSQL Production)**:
   - Skema target akhir (seperti `vendor`, `contract`, `procurement`).
   - Setiap baris hasil migrasi ditandai secara ketat dengan atribut identitas sistem: `migration = '1'` dan `migration_run_id`.

### 1.3 Prinsip Keamanan Data: Dual-Guard Protection
Untuk menjamin agar data operasional asli yang dibuat langsung oleh aplikasi di lingkungan PostgreSQL tidak pernah terhapus atau rusak secara tidak sengaja, sistem menerapkan standar keamanan **Dual-Guard**:
- **Guard 1 (Flag Migration Check)**: Setiap perintah manipulasi data target (*Posting*, *Rollback*, dan *Purge*) secara wajib menyertakan filter klausa `WHERE migration = '1'`.
- **Guard 2 (Staging Reference Validation)**: Perintah pembersihan (*Purge*) memverifikasi keterkaitan ID dengan record yang terdaftar di tabel staging sesi terkait sebelum instruksi `DELETE` dieksekusi.

### 1.4 Konektivitas & Auto-Healing SSH Tunnel
Aplikasi terhubung ke database SQL Server melalui terowongan aman (*Secure Shell Tunnel*). Fitur **Auto-Healing SSH Daemon** bekerja di latar belakang:
- Terowongan otomatis mendeteksi jika terjadi *connection reset* atau *keepalive timeout*.
- Melakukan *re-handshake* otomatis ke server gateway (`10.20.95.10:22` port forward ke `11433`) tanpa perlu mematikan (*restart*) aplikasi atau memutuskan pekerjaan operator.

---

## 2. Navigasi Global & Kontrol Header

Header aplikasi selalu berada di posisi paling atas dan menyediakan visibilitas status serta kontrol global bagi seluruh modul:

```
[ 🛡️ ETL COMMAND CENTER ]   [ Client: ANTAM v ] [ Env: DEV v ]   [ 🟢 SQL Server ] [ 🟢 Staging ] [ 🟢 Target ]   [ 👤 Admin (SUPERADMIN) ] [ ⚙️ ] [ 🚪 Logout ]
```

### 2.1 Pemilih Tenant (Client & Environment)
- **Dropdown Client**: Menentukan entitas perusahaan yang sedang dikerjakan (contoh: `ANTAM`).
- **Dropdown Environment**: Memilih lingkungan kerja aktif, yaitu `DEV` (Pengembangan), `UAT` (Pengujian Pengguna), atau `PROD` (Produksi).
- Pergantian Client/Environment secara otomatis menyaring seluruh data di tabel konfigurasi, view sumber, alur kanvas, dan riwayat pipeline.

### 2.2 Status Indikator Database Real-Time
Header menampilkan tiga pill indikator koneksi:
- **SQL Server**: Status keterhubungan ke server sumber SQL Server via SSH Tunnel.
- **Staging**: Status keterhubungan ke database PostgreSQL penampungan (`stg_antam`).
- **Target**: Status keterhubungan ke skema produksi PostgreSQL.
- *Warna Indikator*: Hijau (Normal/Aktif), Merah (Terputus/Gagal Autentikasi), Kuning (Dalam Pengujian).

### 2.3 Master System Settings (Client, Environment, Connection)
Dapat diakses melalui ikon roda gigi (`⚙️`) di kanan atas (khusus role berwenang):
1. **Tab 1: Master Client**:
   - Mendaftarkan kode client (contoh: `ANTAM`), nama instansi, deskripsi, dan status aktif.
2. **Tab 2: Master Environment**:
   - Menautkan environment kerja ke client tertentu, mengatur kode lingkungan (`DEV`, `UAT`, `PROD`), dan nama database penampungan.
3. **Tab 3: Master Connection**:
   - Mengelola parameter koneksi database: *Host*, *Port*, *Database Name*, *Username*, *Password*, dan *Role* (`SOURCE`, `STAGING`, atau `TARGET`).
   - Opsi *SSH Tunnel*: Mengaktifkan tunnel dengan mengisi SSH Host, SSH Port, SSH User, dan Private Key / Password.
   - Tombol **⚡ Test**: Menguji koneksi langsung ke database target sebelum disimpan.

### 2.4 Manajemen Sesi & Logout
- Menampilkan nama lengkap dan badge peran pengguna yang sedang aktif (contoh: `SUPERADMIN`, `ADMIN`, `OPERATOR`, `AUDITOR`).
- Tombol **Logout**: Menutup sesi autentikasi berbasis JWT secara aman dan mengarahkan kembali ke gerbang login.

---

## 3. Menu 0: Selamat Datang (Portal Inisialisasi)

Menu Selamat Datang berfungsi sebagai gerbang sambutan, panduan orientasi cepat, dan *setup wizard* untuk instalasi baru.

### 3.1 Setup Gate untuk Instalasi Baru
Jika aplikasi baru dipasang dan belum memiliki rekaman data Client, Environment, atau Koneksi Database di database internal:
1. Layar secara otomatis menampilkan kartu peringatan **Setup & Initialization Portal**.
2. Tombol utama **🏢 Mulai Daftarkan Client Pertama** memandu administrator mengonfigurasi entitas tenant sebelum modul migrasi dibuka.
3. Setelah Client dan Koneksi terbentuk, gerbang terbuka otomatis dan beralih ke tampilan dashboard penuh.

### 3.2 Ringkasan Dashboard Sambutan
Jika konfigurasi telah aktif, menu ini menampilkan:
- **Hero Banner**: Deskripsi arsitektur integrasi sistem antam_scm ➔ db_procsi.
- **Pintasan Cepat Operasional**:
  - Tombol *Masuk ke Dashboard / Source Data*.
  - Tombol pintasan langsung ke *Workflow Canvas Studio*.
  - Kartu indikator kesiapan modul sistem.

---

## 4. Menu 1: Source Data (Katalog View SQL Server)

Menu **Source Data** berfungsi sebagai modul eksplorasi dan inspeksi data awal pada basis data sumber SQL Server sebelum data diekstraksi ke PostgreSQL.

```
+-------------------------------------------------------------------------------------------------------+
|  Katalog View Sumber: SQL Server (antam_scm.dbo)                                                      |
|  [ All (45) ] [ 🟢 Terdaftar Config (32) ] [ 🟡 Belum Dikonfigurasi (13) ]   [ Cari View...        ]  |
+-------------------------------------------------------------------------------------------------------+
| No | Nama View               | Deskripsi              | Schema | Total Baris | Relasi Config | Aksi   |
|----+-------------------------+------------------------+--------+-------------+---------------+--------|
| 1  | v_migration_vendor      | Data Pokok Vendor SCM  | dbo    | 12,450      | Config #1     | [Detail] |
| 2  | v_migration_bank        | Rekening Bank Rekanan  | dbo    | 8,920       | Config #3     | [Edit]   |
+-------------------------------------------------------------------------------------------------------+
```

### 4.1 Eksplorasi View & Tabel Sumber
- Menampilkan seluruh objek SQL View dengan awalan `v_migration_*` yang ada di database SQL Server.
- Membaca jumlah baris total (*Row Count*) secara aktual dan menampilkan status apakah view tersebut sudah dikaitkan ke sebuah `migration_config`.

### 4.2 Filter Status & Pencarian View
- **Tombol Filter Cepat**:
  - `Semua View`: Menampilkan seluruh view di database sumber.
  - `🟢 Terdaftar Config`: Menyaring view yang sudah memiliki aturan pemetaan di modul konfigurasi.
  - `🟡 Belum Dikonfigurasi`: Menampilkan view baru yang belum pernah dipetakan ke pipeline migrasi.
  - `🔴 Error`: Menampilkan view yang mengalami galat eksekusi query pada SQL Server.
- **Pencarian Cepat**: Input pencarian real-time untuk memfilter nama view atau teks deskripsi.

### 4.3 Data Inspector & Preview Skema DDL
Klik tombol **🔍 Detail** pada baris view:
- **Tab Preview Data**: Menampilkan 50 baris sampel rekaman data asli langsung dari SQL Server.
- **Tab Skema Kolom**: Menampilkan daftar kolom, tipe data SQL Server (`varchar`, `int`, `datetime`), batas panjang karakter, serta status *nullable*.
- **Tab DDL Script**: Menampilkan skrip `CREATE VIEW` lengkap untuk keperluan analisis teknis.

### 4.4 Editor Objek & Query View
Klik tombol **✏️ Edit** pada baris view untuk membuka modal editor:
1. **Area Koding SQL**: Menampilkan query pembentuk view sumber dengan format monospaced editor.
2. **Keterangan & Dokumentasi**: Kolom catatan deskripsi fungsi view.
3. **Footer Dialog yang Terstruktur**:
   - Tombol **📋 Salin Query**: Terletak di sisi kiri footer modal untuk memudahkan teknisi menyalin query ke tools manajemen database eksternal (seperti SSMS atau DBeaver).
   - Tombol **Batal** dan **💾 Simpan Perubahan Query View**: Mengeksekusi instruksi `ALTER VIEW` ke database SQL Server secara aman.
4. **Proteksi Penghapusan**: Tombol **🗑️ Hapus** dikunci (*disabled*) jika view tersebut sedang aktif digunakan oleh konfigurasi migrasi agar dependensi sistem tidak rusak.

---

## 5. Menu 2: Migration Config (Master Pemetaan & Konfigurasi ETL)

Menu **Migration Config** merupakan pusat logika dan aturan konversi (*transformation engine*) yang mengendalikan bagaimana data diekstraksi, ditransformasikan, dan diposting.

### 5.1 Struktur Konfigurasi & Foreign Key Ordering (`exec_order`)
Kunci keberhasilan migrasi relasional terletak pada pengaturan parameter `exec_order` (Urutan Eksekusi):
- **Tabel Induk (*Parent*)** harus memiliki `exec_order` lebih kecil daripada **Tabel Anak (*Child*)**.
- *Contoh Urutan yang Benar*:
  1. `exec_order: 1` ➔ Master Vendor (Tabel `vendor.master_vendor`)
  2. `exec_order: 2` ➔ Kontak Vendor (Tabel `vendor.vendor_contact`, mereferensikan `vendor_id`)
  3. `exec_order: 3` ➔ Rekening Bank Vendor (Tabel `vendor.vendor_bank_account`)
  4. `exec_order: 4` ➔ Dokumen Legal Vendor (Tabel `vendor.vendor_document`)

### 5.2 Empat Sub-Tabel Master
Modul ini dibagi menjadi empat subtab data:

```
[ 📋 1. migration_config ]   [ 🔄 2. migration_convert_rule ]   [ 🎯 3. migration_target_config ]   [ 📚 4. migration_lookup ]
```

1. **`migration_config` (Tabel Pemetaan Utama)**:
   - Menghubungkan `src_view` (SQL Server) ➔ `stg_table` (PostgreSQL Staging) ➔ `tgt_table` (PostgreSQL Target).
   - Menentukan kolom kunci utama (`pk_source_col` dan `pk_target_col`).
   - Menentukan `exec_order`, ukuran chunk batch, serta nama modul fungsional.
2. **`migration_convert_rule` (Aturan Transformasi Kolom)**:
   - Aturan konversi per kolom: pemetaan format tanggal (`YYYY-MM-DD`), pembersihan whitespace, nilai pengganti jika NULL (`DEFAULT_VALUE`), dan ekspresi SQL lanjutan.
3. **`migration_target_config` (Arsitektur 1-View ke Multi-Target)**:
   - Mendukung skenario di mana satu view sumber SQL Server berukuran besar harus dipecah (*splited*) ke dalam beberapa tabel relasional PostgreSQL yang berbeda.
4. **`migration_lookup` (Kamus Kode)**:
   - Tabel referensi untuk mengonversi kode legacy menjadi ID modern di PostgreSQL (misal: kode negara, kode mata uang, jenis badan usaha).

### 5.3 Operasi CRUD, Clone Konfigurasi, dan Uji Coba Query
- **+ Tambah Konfigurasi**: Form wizard interaktif dengan validasi ketersediaan view sumber dan skema target.
- **Uji Coba Query (Test Fetch)**: Menjalankan query uji koneksi untuk memeriksa apakah pemetaan kolom valid sebelum konfigurasi disimpan.
- **Clone Konfigurasi**: Menduplikasi seluruh konfigurasi pemetaan kolom yang sudah ada untuk mempercepat pembuatan konfigurasi pada modul yang serupa.

---

## 6. Menu 3: Workflow Canvas Studio (Dynamic Visual DAG Orchestrator)

Workflow Canvas Studio adalah pusat orkestrasi visual canggih berbasis graf berarah tanpa siklus (*Directed Acyclic Graph / DAG*). Di menu ini, alur migrasi dieksekusi, dipantau, dan dikontrol secara grafis.

```
+-------------------------------------------------------------------------------------------------------+
|  [ Template: Flow 2: Multi-Target Post Engine v ]   [ 🔍 Zoom ] [ ⛶ Fit ]   [ ▶️ Jalankan Alur ]     |
+-------------------------------------------------------------------------------------------------------+
|                                                                                                       |
|    ( Node: Staging Check ) ───> [ Node: Chunk Batch 1000 ] ───> [ Node: Insert Target ]              |
|                                                                          │                            |
|                                                                          ▼                            |
|                                                                 ( Node: Sync Sequence )               |
|                                                                                                       |
+-------------------------------------------------------------------------------------------------------+
|  [ = Bilah Pengatur Tinggi Konsol (Drag Up/Down) ================================================= ]  |
|  [ > Terminal Output ] [ 📋 Riwayat Eksekusi ] [ ❌ Error Log ]             [ Status: SUCCEEDED ]    |
|  14:02:11 [INFO] Memulai posting batch 1 (Baris 1 - 1000)... Selesai (420ms)                          |
|  14:02:12 [INFO] Menyinkronkan sequence vendor_id_seq ke nilai maksimum: 15420...                     |
+-------------------------------------------------------------------------------------------------------+
```

### 6.1 Kanvas Grafis Interaktif (DAG Workflow)
- **Simpul (*Nodes*)**: Merepresentasikan setiap tahapan logika proses migrasi (pengecekan koneksi, validasi delta baris, chunking data, posting, dan sinkronisasi sequence).
- **Garis Penghubung (*Edges*)**: Menunjukkan alur ketergantungan urutan eksekusi data.
- **Manipulasi Kanvas**:
  - *Drag & Drop*: Menggeser simpul alur secara leluasa.
  - *Pan & Zoom*: Menggeser area kanvas dan memperbesar/memperkecil visualisasi.
  - *Tombol 💾 Simpan Layout*: Menyimpan posisi tata letak simpul ke dalam database browser.

### 6.2 Panduan Lengkap Eksekusi 4 Alur Utama (The 4 Flows)

Sistem menyediakan 4 alur kerja preset terstandarisasi:

#### 📥 Flow 1: Staging Landing & Convert Lookup Engine
- **Fungsi**: Mengekstraksi data mentah dari view SQL Server ke tabel penampungan sementara PostgreSQL (`stg_antam`) dan menjalankan konversi kode kamus (*lookup mapping*).
- **Karakteristik**: Aman bagi tabel produksi karena belum menyentuh skema target.
- **Langkah Eksekusi**:
  1. Pilih template **Flow 1: Staging Landing & Convert**.
  2. Klik tombol hijau **▶️ Jalankan Alur**.
  3. Pilih satu atau beberapa Target Konfigurasi melalui opsi *Multi-Select*.
  4. Klik **Mulai Eksekusi Alur** dan pantau progress baris data di terminal konsol.

#### 🚀 Flow 2: Multi-Target Post Engine (Batch Chunking)
- **Fungsi**: Memindahkan data bersih dari staging ke tabel produksi target PostgreSQL dengan pembagian ukuran batch (*chunking*) untuk mencegah kehabisan memori.
- **Karakteristik**: Menambahkan penanda `migration = '1'` dan menyinkronkan nilai *auto-increment sequence*.
- **Langkah Eksekusi**:
  1. Pastikan Flow 1 telah selesai dengan status `SUCCESS`.
  2. Pilih template **Flow 2: Multi-Target Post Engine**.
  3. Klik tombol **▶️ Jalankan Alur**. Dialog hanya akan menampilkan sesi staging yang valid dan belum kadaluarsa.
  4. Tentukan ukuran batch (disarankan: `1000` baris).
  5. Klik **Mulai Eksekusi Alur**.

#### ↩️ Flow 3: Safe Rollback Engine (Transactional Undo)
- **Fungsi**: Membatalkan sesi posting tertentu jika ditemukan ketidaksesuaian data pada tabel target.
- **Karakteristik**:
  - Hanya menghapus baris data yang berpenanda `migration_run_id` terkait.
  - Penghapusan dilakukan secara terbalik (*Order DESC*) agar tidak melanggar batasan Foreign Key.
  - Nilai sequence primary key diselaraskan kembali ke kondisi sebelum migrasi.
- **Langkah Eksekusi**:
  1. Pilih template **Flow 3: Safe Rollback Engine**.
  2. Klik tombol **▶️ Jalankan Alur**.
  3. Pilih Run ID yang akan dibatalkan (hanya menampilkan sesi yang berstatus `is_posted = true`).
  4. Centang konfirmasi persetujuan rollback dan jalankan alur.

#### 🗑️ Flow 4: Target Purge Engine (Dual-Guard & Looping)
- **Fungsi**: Pembersihan data migrasi pada tabel target secara menyeluruh dengan perlindungan ganda (Dual-Guard) untuk mempersiapkan uji coba ulang.
- **Karakteristik**:
  - Mendukung eksekusi multi-tabel sekaligus secara berurutan (*looping*).
  - Dilengkapi *bulkhead error handling* (jika satu tabel gagal, proses tetap dilanjutkan ke tabel berikutnya).
- **Langkah Eksekusi**:
  1. Pilih template **Flow 4: Target Purge Engine**.
  2. Klik tombol **▶️ Jalankan Alur**.
  3. Pilih tabel-tabel target yang ingin dibersihkan (tersedia tombol *Pilih Semua*).
  4. (Opsional) Masukkan daftar ID tertentu pada kolom `DELETE_IDS` jika hanya ingin menghapus sebagian baris.
  5. Konfirmasi dan mulai eksekusi pembersihan.

### 6.3 Dialog Parameter Eksekusi Cerdas
Header dialog eksekusi telah distandarkan dengan format **rata kiri penuh** untuk kenyamanan membaca:
- **Filtering Otomatis**: Dropdown Run ID secara cerdas menyaring data sesuai konteks alur (Flow 2 hanya memunculkan sesi sukses; Flow 3 hanya memunculkan sesi posted).
- **Multi-Select Checkboxes**: Memungkinkan pemilihan beberapa konfigurasi/sesi sekaligus dalam satu kali klik.

### 6.4 Panel Konsol Resizable & Streaming Log Real-Time (SSE)
- **Bilah Pemisah Vertikal (*Vertical Splitter Bar*)**: Pembatas antara kanvas grafis dan panel konsol di bawahnya dapat ditarik (*drag*) naik-turun untuk memperluas atau mempersempit area baca log.
- **Real-Time Streaming**: Menggunakan teknologi *Server-Sent Events (SSE)* sehingga setiap baris pemrosesan data, persentase kemajuan (*progress bar*), dan penggunaan memori tampil secara instan tanpa perlu memuat ulang (*refresh*) halaman.

### 6.5 Riwayat Eksekusi, Per-Step Inspection, & Log Galat
Panel konsol bawah memiliki tiga tab pengawasan:
- **Tab Terminal Output**: Tampilan konsol bergaya CLI dengan pewarnaan log (*Info: Cyan*, *Success: Hijau*, *Warning: Kuning*, *Error: Merah*).
- **Tab Riwayat Eksekusi**: Ringkasan metrik waktu mulai, durasi eksekusi, total baris diproses, dan nama operator.
- **Tab Log Galat**: Menyediakan inspeksi mendalam (*stack trace*) jika terjadi kendala pada saat eksekusi langkah tertentu.

---

## 7. Menu 4: Hasil Migrasi (Pipeline Monitor 3-Tier & Berita Acara)

Menu **Hasil Migrasi** adalah modul audit dan pelaporan formal yang menyajikan tabel rekonsiliasi data 3-lapisan secara komprehensif.

```
+------------------------------------------------------------------------------------------------------------------------+
|  Monitoring Pipeline & Rekonsiliasi Data 3-Tier                                    [ 📄 Input & Cetak Berita Acara ]  |
+------------------------------------------------------------------------------------------------------------------------+
| Config ID | Modul / Config Name | Source View | Baris Source | Staging Baris | Target Baris | Status Match | Aksi     |
|-----------+---------------------+-------------+--------------+---------------+--------------+--------------+----------|
| Config #1 | Master Vendor       | v_mig_vnd   | 12,450       | 12,450        | 12,450       | 🟢 100% Match | [⚖️ Comp] |
| Config #2 | Rekening Bank       | v_mig_bnk   | 8,920        | 8,920         | 8,918        | 🟡 Selisih 2  | [⚖️ Comp] |
+------------------------------------------------------------------------------------------------------------------------+
```

### 7.1 Tabel Rekonsiliasi Data 3-Tahap
Tabel ini membandingkan volume baris data secara berdampingan:
1. **Kolom Baris Source**: Jumlah rekaman aktual di SQL Server View.
2. **Kolom Baris Staging**: Jumlah rekaman yang berhasil ditarik ke PostgreSQL `stg_antam`.
3. **Kolom Baris Target**: Jumlah rekaman ber-flag migrasi yang telah tersimpan di tabel produksi PostgreSQL.

### 7.2 Indikator Status Rekonsiliasi & Status Aksi
- **Indikator Rekonsiliasi**:
  - `🟢 100% Match`: Volume data dari Source hingga Target identik secara kuantitatif.
  - `🟡 Selisih N`: Terdapat perbedaan jumlah baris (misalnya akibat data duplikat yang difilter atau record yang ditolak oleh aturan validasi).
- **Pill Status Aksi**:
  - `🚀 Posted`: Data telah selesai diposting ke tabel produksi target.
  - `📦 Staging`: Data baru sampai di tahap penampungan staging.
  - `↩️ Rolled Back`: Data sebelumnya pernah diposting namun telah dibatalkan kembali.

### 7.3 Fitur Komparasi Data Kolom 3-Tier (⚖️ Compare)
Klik tombol **⚖️ Compare** pada baris konfigurasi:
- Membuka dialog komparasi baris-demi-baris yang menyandingkan data asli SQL Server di sisi kiri dengan data hasil transformasi PostgreSQL di sisi kanan.
- Kolom yang mengalami perubahan nilai (seperti mapping ID kamus atau format tanggal) disorot dengan warna khusus untuk memudahkan audit data engineer.

### 7.4 Formulir Berita Acara Migrasi (Poin 1 s/d 4) & Ekspor PDF
Klik tombol **📄 Input & Cetak Berita Acara** di kanan atas tabel:
Modal Berita Acara Migrasi dirancang khusus dengan format formal perusahaan yang dibagi menjadi **4 Poin Standar**:

```
[ MODAL INPUT BERITA ACARA MIGRASI ]
├── [ 1 ] Informasi Umum Dokumen
│   ├── Nomor Berita Acara  : BA-MIG/2026/X/001
│   ├── Tanggal Pelaksanaan : 22 Oktober 2026
│   └── Tempat Pelaksanaan  : Ruang Command Center / Data Center
├── [ 2 ] Identitas & Penandatangan Pihak Terkait
│   ├── Pihak Pertama (Pelaksana / Tim Teknis ETL) : Nama, NIP, Jabatan
│   └── Pihak Kedua   (Pemberi Kerja / Data Owner)  : Nama, NIP, Jabatan
├── [ 3 ] Ruang Lingkup & Parameter Eksekusi
│   ├── Modul / Objek Migrasi yang Dikerjakan
│   └── Catatan Parameter Teknis Eksekusi (Run ID, Environment)
└── [ 4 ] Tabel Rekonsiliasi Data & Pernyataan Pengesahan
    ├── Ringkasan Volume Data (Source vs Staging vs Target)
    └── Pernyataan Integritas dan Kolom Tanda Tangan Resmi
```

- **Fitur Ekspor**: Menyediakan tombol cetak langsung (*Print Friendly*) dan konversi ke file PDF resmi berstandar dokumen operasional korporat.

---

## 8. Menu 5: System Administration & Access Control (RBAC)

Menu **System Administration** menyediakan tata kelola autentikasi pengguna, peran sistem, dan matriks hak akses perizinan (*Role-Based Access Control*).

```
+-------------------------------------------------------------------------------------------------------+
|  🛡️ System Administration & Access Control                                                           |
|  [ 👥 1. User Management ]   [ 🎭 2. Role Management ]   [ 📋 3. Menu & Permission Matrix ]          |
+-------------------------------------------------------------------------------------------------------+
```

### 8.1 Manajemen Pengguna (Master Users) & Penugasan Tenant
- **Daftar Pengguna**: Tabel tertata rapi menampilkan ID, Avatar, Username, Nama Lengkap, Email, Peran (*Role Tag*), Penugasan Tenant, Status Aktif, Waktu Terakhir Login, dan Tanggal Dibuat.
- **Tombol Tambah Pengguna**: Membuka modal pembuatan akun baru dengan enkripsi password standar industri.
- **Penugasan Akses Tenant (*Multi-Tenant Assignment*)**:
  - Pengguna dapat ditugaskan untuk memiliki akses ke satu atau beberapa entitas Client beserta Environment spesifik (misal: hanya boleh mengakses Client `ANTAM` pada Environment `DEV` dan `UAT`).
  - Akun ber-role `SUPERADMIN` secara otomatis memiliki penanda `🌐 Global Superadmin` (mengakses seluruh client dan environment).
- **Tombol Aksi**:
  - `✏️ Edit`: Mengubah profil, status aktif/nonaktif, dan penugasan tenant.
  - `🔑 Reset`: Mengatur ulang kata sandi pengguna secara instan.
  - `🗑️ Hapus`: Menghapus akun pengguna dari sistem.

### 8.2 Manajemen Peran (Master Roles)
- Menampilkan daftar peran sistem yang terdaftar beserta jumlah pengguna yang terikat (*User Count*).
- Mendukung penambahan peran baru dan perubahan deskripsi otorisasi.
- **Proteksi Khusus**: Peran bawaan `SUPERADMIN` dilindungi secara permanen sehingga tombol hapusnya dikunci (*disabled*) untuk mencegah penguncian sistem (*system lockout*).

### 8.3 Matriks Hak Akses Menu & Perizinan (Menu & Permission Matrix)
- **Kontrol Role Target**:
  - Dropdown **Role Target** di bagian atas tabel memiliki ukuran kompak dan proporsional untuk memilih peran yang ingin dikonfigurasi hak aksesnya.
- **Tabel Matriks Hak Akses**:
  - Menampilkan daftar seluruh menu aplikasi beserta target rute tab-nya.
  - Menyediakan 4 kolom hak perizinan dengan checkbox yang tertata presisi di tengah sel:
    - **View (Lihat)**: Izin membuka dan membaca data pada menu tersebut.
    - **Create (Tambah)**: Izin membuat rekaman konfigurasi atau menambah data baru.
    - **Update (Ubah)**: Izin mengedit query, memperbarui pemetaan, atau mengubah pengaturan.
    - **Delete (Hapus)**: Izin mengeksekusi penghapusan konfigurasi, pembatalan (*rollback*), atau pembersihan (*purge*).
  - Dilengkapi fitur *Pilih Semua (Check-All)* pada header setiap kolom perizinan.
- **Tombol Simpan**: Tombol `💾 Simpan Perubahan Matriks` menyimpan pembaruan otorisasi ke database secara instan tanpa perlu me-restart server.

---

## 9. Menu 6: Userguide Terintegrasi

Menu **Userguide** adalah modul pusat bantuan (*Help Center*) interaktif yang tertanam langsung di dalam aplikasi web.

### 9.1 Fitur Pencarian Tutorial & Filter Kategori
- **Pencarian Cepat (*Search Bar*)**: Pengguna dapat mengetik kata kunci teknis seperti `Rollback`, `Chunking`, `Lookup`, `SSH Tunnel`, atau `Berita Acara` untuk langsung melompat ke panduan yang relevan.
- **Filter Kategori Chip**:
  - `Semua Bab`: Menampilkan seluruh konten dokumentasi.
  - `4 Alur Utama`: Memfokuskan tampilan hanya pada panduan Flow 1 s/d Flow 4.
  - `Konfigurasi`: Menampilkan panduan master mapping dan aturan konversi.
  - `Rekonsiliasi & BA`: Panduan pemeriksaan selisih data dan pembuatan Berita Acara.
  - `FAQ & Solusi Galat`: Menampilkan tanya-jawab kendala teknis.

### 9.2 Navigasi Cepat & Cetak Panduan
- **Bilah Samping Navigasi (*Sticky Sidebar*)**: Menampilkan daftar isi bab 1 sampai bab 9 yang mengikuti posisi scroll layar (*scrollspy*).
- **Tombol Cetak Panduan**: Menyiapkan format panduan dalam tata letak cetak dokumen (*printable view*) yang rapi untuk diunduh sebagai arsip offline.

---

## 10. Standar Operasional Prosedur (SOP) & Troubleshooting (FAQ)

### 10.1 SOP Alur Kerja Migrasi End-to-End

Untuk memastikan migrasi data berjalan aman dan terkendali, seluruh operator wajib mengikuti tahapan baku berikut:

```
+-------------------------------------------------------------------------------------------------------+
|                                    TAHAPAN STANDAR OPERASIONAL (SOP)                                  |
+-------------------------------------------------------------------------------------------------------+
|  1. PERSIAPAN          ➔ Pastikan SSH Tunnel aktif dan uji koneksi DB di Master Connection.           |
|  2. INSPEKSI SOURCE    ➔ Buka Menu Source Data, pastikan View sumber valid dan baris data terbaca.    |
|  3. VERIFIKASI CONFIG  ➔ Buka Menu Migration Config, pastikan pemetaan kolom dan exec_order benar.    |
|  4. RUN FLOW 1         ➔ Buka Canvas Studio, jalankan Flow 1 (Staging) hingga berstatus SUCCESS.      |
|  5. AUDIT STAGING      ➔ Periksa hasil staging pada Menu Hasil Migrasi (Pastikan baris cocok).        |
|  6. RUN FLOW 2         ➔ Jalankan Flow 2 (Batch Chunking) untuk memposting data ke target produksi.   |
|  7. REKONSILIASI AKHIR ➔ Buka Menu Hasil Migrasi, periksa status "100% Match". Gunakan Compare data. |
|  8. DOKUMENTASI BA     ➔ Buat dan cetak Berita Acara Migrasi resmi sebagai bukti sah serah-terima.    |
+-------------------------------------------------------------------------------------------------------+
```

### 10.2 Pertanyaan Sering Diajukan (FAQ) & Penyelesaian Kendala

#### ❓ Mengapa Flow 2 menolak Run ID tertentu dengan notifikasi "Run ID belum berstatus SUCCESS"?
* **Penyebab**: Flow 2 menerapkan proteksi ketat di mana hanya sesi Flow 1 yang selesai sempurna (*100% tanpa galat*) yang diizinkan diposting ke tabel produksi.
* **Solusi**: Periksa tab Error Log pada Workflow Canvas. Jika Flow 1 sebelumnya berstatus *FAILED* atau *PARTIAL*, perbaiki kesalahan sumber data dan jalankan ulang Flow 1 sebelum mencoba Flow 2 kembali.

#### ❓ Mengapa sesi migrasi ditandai sebagai "⚠️ KADALUARSA (SUPERSEDED)"?
* **Penyebab**: Ketika Flow 1 dijalankan ulang untuk konfigurasi tabel yang sama, isi tabel staging akan ditimpa (*overwritten*) oleh data ekstraksi terbaru.
* **Solusi**: Sesi lama sengaja dinonaktifkan sistem untuk mencegah operator secara tidak sengaja memposting data staging yang sudah usang ke tabel produksi. Selalu gunakan Run ID sesi paling baru.

#### ❓ Terjadi galat "Foreign Key Constraint Violation" pada saat menjalankan Flow 2. Bagaimana mengatasinya?
* **Penyebab**: Urutan eksekusi (*exec_order*) tidak mematuhi hierarki dependensi tabel relasional (contoh: data transaksi anak diposting sebelum data master induknya ada di database).
* **Solusi**: Buka menu **Migration Config**. Pastikan tabel master induk memiliki nilai `exec_order` lebih rendah daripada tabel anak. Jalankan Flow 2 untuk tabel induk terlebih dahulu hingga selesai, baru lanjutkan ke tabel anak.

#### ❓ Bagaimana jika koneksi SSH Tunnel ke SQL Server mendadak terputus di tengah pekerjaan?
* **Solusi**: Anda tidak perlu merestart server backend secara manual. Fitur *Auto-Healing SSH Tunnel* pada aplikasi akan mendeteksi putusnya saluran dalam hitungan detik dan otomatis menyambungkan kembali koneksi port forward ke `10.20.95.10:22`.

#### ❓ Apakah menjalankan "Flow 4 (Purge)" akan menghapus data operasional asli yang sudah ada sebelumnya?
* **Solusi**: **Sangat Aman (Tidak Akan Terhapus)**. Berkat implementasi prinsip *Dual-Guard Protection*, seluruh instruksi pembersihan diatur dengan klausa permanen `WHERE migration = '1'` dan divalidasi silang terhadap rekaman staging. Seluruh data operasional yang dibuat langsung melalui aplikasi inti perusahaan tetap utuh dan terlindungi 100%.

---
*Dokumen ini diterbitkan oleh Tim Pengembangan ETL Migration Command Center.*  
*Versi Dokumen: 2.5 (Enterprise Dual-Guard Edition) | Tanggal Pembaruan: Oktober 2026*
