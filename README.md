# 🚀 Migration Command Center (SQL Server ➔ PostgreSQL)

Aplikasi web modern berbasis **Node.js** untuk mengaudit, memantau, dan merekonsiliasi proses migrasi data dari **SQL Server (`antam_scm.dbo`)** melalui **ETL Apache Hop / PostgreSQL (`db_procsi.etl_antam`)** hingga ke tabel **Staging (`stg_antam`)** dan **Target (`vendor`)**.

---

## 🌟 3 Modul Utama Dashboard

### 1. 🌐 Source Data (SQL Server — `antam_scm.dbo`)
- Menampilkan seluruh **VIEW** yang ada di schema `dbo` pada database `antam_scm` (`v_migration_vendor`, `v_vendor_address`, `v_vendor_akta`, `v_vendor_bank`, `v_vendor_siujk`, `v_vendor_siup`, `v_vendor_tdp`, `v_vendor_user`).
- Ringkasan total baris (*row count*) untuk setiap view secara real-time.
- **Data Inspector**: Menampilkan isi record aktual langsung dari view SQL Server dengan paginasi dan tipe data kolom.

### 2. ⚙️ Monitoring Config & Jalannya Proses ETL (`db_procsi.etl_antam`)
- **Master Config**:
  - `migration_config`: Konfigurasi mapping sumber `src_view` ➔ staging `stg_table` ➔ target `tgt_table`, kunci PK, seed ID, dan precheck SQL.
  - `migration_convert_rule`: Aturan konversi kolom, lookup, normalisasi, dan nilai default.
  - `migration_lookup`: Master kamus lookup.
  - `migration_target_config`: Target mapping SQL, precheck, postcheck, dan rollback SQL.
- **Proses Migrasi (Execution & Logs)**:
  - `migration_run`: Riwayat batch eksekusi migrasi (Status `SUCCESS`/`FAILED`, Host Apache Hop, waktu mulai/selesai, durasi).
  - `migration_step_log`: Log langkah throughput (`rows_src`, `rows_stg`, `rows_new`, `rows_changed`, `rows_deleted`).
  - `migration_error_log`: Rincian error transformasi dan sampel data baris bermasalah (`row_data` dalam format JSON).
  - Filter interaktif: Klik salah satu Run ID untuk langsung memfilter step logs & error logs terkait.

### 3. 🎯 Hasil Migrasi (Pipeline 3-Tier Reconciliation & Berita Acara)
- Visualisasi aliran data 3-tahap:
  $$\mathbf{Source\ (SQL\ Server\ dbo.src\_view)} \longrightarrow \mathbf{Staging\ (PG\ stg\_antam.stg\_table)} \longrightarrow \mathbf{Final\ Target\ (PG\ tgt\_schema.tgt\_table)}$$
- Perbandingan jumlah baris di ketiga titik secara berdampingan.
- Selisih (*delta*) dan status sinkronisasi (*Match*, *Partial*, *Overflow*).
- **Interactive 3-Stage Data Viewer**: Meninjau data record aktual pada masing-masing tahapan (Source, Staging, Target).
- **Cetak Berita Acara Validasi Data**:
  - Format resmi standar korporat (Kop Surat ANTAM, Nomor Dokumen, Tanggal, Parameter Config, Tabel Uji Rekonsiliasi, dan Lembar Pengesahan Tanda Tangan).
  - **Lampiran Data Staging**: Rekapitulasi seluruh baris data aktual yang dimigrasikan ke `stg_antam.[stg_table]`.
  - Tombol **"Cetak / Simpan PDF"** (`window.print()`) dan **"Ekspor CSV Staging"**.

---

## 🔌 Dokumentasi REST API

| Method | Endpoint | Deskripsi |
| :--- | :--- | :--- |
| `GET` | `/api/health` | Status koneksi SQL Server (via SSH Tunnel) & PostgreSQL |
| `GET` | `/api/source/views` | Daftar seluruh view SQL Server `dbo` beserta total barisnya |
| `GET` | `/api/source/view-data?view=...&page=1&limit=25` | Data record view SQL Server |
| `GET` | `/api/etl/overview` | Ringkasan metrik eksekusi ETL (total runs, success, errors) |
| `GET` | `/api/etl/configs` | Data master config (`migration_config`, rules, targets) |
| `GET` | `/api/etl/runs?limit=50` | Riwayat eksekusi batch migrasi |
| `GET` | `/api/etl/step-logs?runId=...` | Log langkah eksekusi ETL |
| `GET` | `/api/etl/error-logs?runId=...` | Log error transformasi data |
| `GET` | `/api/reconciliation/pipeline` | Rekonsiliasi 3-tahap Source ➔ Staging ➔ Target |
| `GET` | `/api/reconciliation/stage-data?configId=...&stage=source|staging|target` | Inspeksi record data per tahapan pipeline |
| `GET` | `/api/reconciliation/berita-acara?configId=...` | Data lengkap dokumen Berita Acara & lampiran staging |

---

## 🚀 Menjalankan Aplikasi di Lokal

Aplikasi menggunakan nodemon sehingga otomatis reload saat ada perubahan kode:
```bash
npm run dev
```

Buka di browser:
👉 **[http://localhost:3000](http://localhost:3000)**
