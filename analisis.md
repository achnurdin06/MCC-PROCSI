# Analisis Flow 1 – 4 (Migrasi ANTAM)

Dokumen ini membahas kelemahan tiap flow, apakah sistem saat ini sudah menutupnya, dan rekomendasi perbaikan.

**Legenda status:** ✅ sudah tertutup · 🟡 tertutup sebagian · ❌ belum tertutup
**Legenda bukti:** **[V]** diverifikasi di kode/data nyata · **[H]** hipotesis, belum bisa dibuktikan

> Catatan verifikasi: definisi fungsi DB (`pr_finish_run`, `fn_post_all_targets`, `fn_rollback_all_targets`, versi live `fn_purge_target_data`) tidak dapat dibaca ulang karena koneksi DB timeout saat analisis. Perilakunya disimpulkan dari kode Node, data `migration_run`/`migration_step_log`, dan backup `fn_purge_target_data`. Bagian itu ditandai **[H]**.

---

## 0. Ringkasan

| Flow | Peran | Menulis ke | Risiko utama | Kondisi |
|------|-------|-----------|--------------|---------|
| 1 | Staging (ambil dari sumber → `stg_antam.<stg>_src`) | Staging saja | Status run salah (FAILED padahal sukses) setelah resume; staging lama hilang saat run baru | 🟡 |
| 2 | Post ke target | Tabel target | Pesan "Auto-Rollback OK" tidak menjamin rollback berhasil; hanya menerima run `SUCCESS` | 🟡 |
| 3 | Rollback target | Tabel target | Tidak ada pengecekan data sudah diubah run lain; SQL resync sequence disusun lewat string | 🟡 |
| 4 | Purge target | Tabel target (tidak bisa di-undo) | Fungsi DB masih bergantung pada staging terkini; tidak ada backup sebelum hapus | 🟡 |

Masalah lintas flow: skema lock tidak seragam, `end_time` tidak konsisten, status akhir ditentukan di beberapa tempat, error banyak ditelan (`catch(_){}`).

---

## 1. Flow 1 – Staging (detail)

### 1.A Alur proses **[V]**

Pemicu: tombol Jalankan (run baru) atau Lanjutkan (resume run lama). Mesin: `dag-engine.service.js`; ingest: `ingestion.service.js`; fungsi DB: skema `mc_center`.

| Tahap | Langkah | Implementasi | Catatan |
|-------|---------|--------------|---------|
| Pra-run | Resolusi config | Daftar config aktif (atau dari `migration_run.config_id` saat resume) | Config **tanpa target aktif** dilewati (`SKIP_NO_TARGET`); jika semua dilewati → error |
| Pra-run | Lock | `acquireLock`: key 4242 (multi) atau `config_id` (single) | Hanya `Set` in-memory |
| Pra-run | Run baru / resume | Run baru: `initRun`. Resume: status → `RUNNING`, `end_time = NULL`, note "Melanjutkan…" | Log step/error lama **tidak dihapus** |
| Pra-run | Tandai SUPERSEDED | Run lama (belum diposting, config beririsan) diberi note KADALUARSA | Dilakukan **di awal**, sebelum run baru sukses |
| Per config | 1. `CHECK_DB_PREREQ`, 2. `INIT_AND_GET_CONFIG`, 3. `LOOP_CONTROLLER` | Hanya sekali di config pertama / memori | Tidak ada log step untuk node memori |
| Per config | 4. `PRECHECK_SOURCE` | View ada + `COUNT_BIG(*)` → `rowsSrc` | Hitungan ini dipakai validasi nanti |
| Per config | 5. `PREPARE_STAGING` | `fn_prepare_staging` (`DROP`/recreate `stg_antam.<stg>_src`) | Staging lama hilang total |
| Per config | 6. `DATA_STREAM` | Hitung ulang baris, `SELECT` seluruh view ke memori, insert batch ≤ 60.000 parameter; batch gagal → insert per baris, baris buruk → `migration_error_log` (`STAGING_INSERT_ERROR`) | Error fatal → `TRUNCATE` staging |
| Per config | 7. `CHECK_STAGING` | `fn_check_staging(run, cfg, rowsSrc)`: cocokkan jumlah baris + PK duplikat | Hitungan saja, tanpa checksum |
| Per config | 8. `DELTA_CHECK` | `fn_check_delta`: bandingkan dengan data target (data baru vs lama) | Gagal → ambil pesan dari error/step log |
| Per config | 9. `CONVERT_LOOKUP` | `fn_convert_staging`: konversi kode master | Kode tak terpetakan → error |
| Akhir | 10. `FINISH_FLOW1` | `pr_finish_run`: hitung step `FAILED` (selain POST/ROLLBACK) dan error log → status | Multi-config: hanya dijalankan pada config **terakhir** |
| Penutup | Hasil | Semua sukses → `SUCCESS`; sebagian → `PARTIAL_SUCCESS`; semua gagal → `FAILED`; `releaseLock` di `finally` | Strategi: multi-config `CONTINUE_ON_ERROR`, single `ABORT` |

Pemulihan: `recoverInterruptedRuns` (RUNNING basi > 10 menit → `FAILED` + step `RUN_INTERRUPTED`), `forceStopRun`, `cancelRun`.

### 1.B Matriks kelemahan vs sistem saat ini

Status: ✅ tertutup · 🟡 sebagian · ❌ belum · **[V]** terverifikasi · **[H]** hipotesis

#### A. Integritas status & riwayat

| # | Kelemahan | Sistem saat ini | Status | Bukti | Rekomendasi |
|---|-----------|-----------------|--------|-------|-------------|
| F1-01 | Status `FAILED` palsu setelah resume: `RUN_INTERRUPTED`/step FAILED lama ikut dihitung `pr_finish_run` | Resume tidak menghapus log lama (Flow 2/3 menghapus) | ❌ | **[V]** Run #260: semua step OK, 0 error log, status FAILED | Saat resume Flow 1, hapus/arsipkan step `FAILED`+`RUN_INTERRUPTED` dan error log run tersebut (atau beri kolom `attempt_no` dan hitung hanya attempt terakhir) |
| F1-02 | `PARTIAL_SUCCESS` di-UPDATE tanpa `end_time` | UPDATE hanya set status + note | ❌ | **[V]** blok UPDATE di loop | Set `end_time = now()` di UPDATE yang sama |
| F1-03 | Jika config **terakhir** gagal, `FINISH_FLOW1` tak pernah jalan; status ditentukan jalur Node, bukan `pr_finish_run` | Dua sumber status (Node + DB) | 🟡 | **[V]** alur loop (finish ditunda ke config terakhir) | Satu fungsi `finalizeRun()` yang selalu dipanggil di akhir, apa pun hasilnya |
| F1-04 | Catatan "Flow 1 selesai sukses" tetap tertulis di run berstatus FAILED/PARTIAL | Note tidak diganti | ❌ | **[V]** Run #260 | Tulis note dari status akhir, bukan dari pesan node |

#### B. Resume, cancel, recovery

| # | Kelemahan | Sistem saat ini | Status | Bukti | Rekomendasi |
|---|-----------|-----------------|--------|-------|-------------|
| F1-05 | Resume menjalankan ulang **semua** config, termasuk yang sudah sukses (DROP + load ulang) | UI mengirim seluruh daftar config run | ❌ | **[V]** `resumeFlow` + resolusi config saat resume | Hitung config sukses dari step log (`FINISH`/`CONVERT` OK) dan hanya jalankan sisanya; beri opsi "ulang semua" |
| F1-06 | Cancel hanya membersihkan staging config **pertama** | `split(',')[0]` | ❌ | **[V]** `cancelRun` | Loop semua config run |
| F1-07 | Force Stop / `recoverInterruptedRuns` tidak membersihkan staging | Hanya ubah status + log | ❌ | **[V]** | Pakai prosedur cleanup yang sama dengan cancel; staging setengah terisi ditandai `INVALID` |
| F1-08 | Run lama ditandai SUPERSEDED saat run baru **mulai**; bila run baru gagal, run lama sudah tak bisa diposting dan staging-nya sudah di-DROP | Penandaan di awal | ❌ | **[V]** Run #246, #247–250 dibuat KADALUARSA oleh #260 yang sempat FAILED | Tandai setelah run baru `SUCCESS`; sebelum itu cukup beri peringatan di UI |
| F1-09 | Run RUNNING yang proses Node-nya mati baru ditandai FAILED setelah 10 menit tanpa aktivitas | Ambang `STALE_RUN_MINUTES = 10` + tombol Force Stop | 🟡 | **[V]** `etl.service.js` | Heartbeat berkala di Node; recovery otomatis saat server start (jika belum) |

#### C. Konkurensi & lock

| # | Kelemahan | Sistem saat ini | Status | Bukti | Rekomendasi |
|---|-----------|-----------------|--------|-------|-------------|
| F1-10 | Lock hanya `Set` in-memory; hasil `pg_try_advisory_lock` diabaikan dan berjalan lewat pool (tidak menetap per sesi) | Aman hanya untuk satu proses Node | 🟡 | **[V]** `db-dispatcher.service.js` | Advisory lock di koneksi khusus, cek hasilnya, lepas di `finally` |
| F1-11 | Key lock multi (4242) dan single (`config_id`) berbeda: multi-config run dan single-config run pada tabel yang sama bisa jalan bersamaan dan saling `DROP` staging | Tidak ada lock per tabel staging | ❌ | **[V]** penentuan `lockKey` | Lock per `stg_table` (diambil berurutan) |
| F1-12 | Flow 1 dan Flow 2 memakai ruang key berbeda; staging bisa di-DROP saat Flow 2 sedang membaca | Tidak ada pemeriksaan lintas flow | ❌ | **[V]** key 4242/config_id vs 7373/900000+run | Flow 1 menolak jalan bila ada run Flow 2 `RUNNING` untuk config yang sama |

#### D. Kualitas & keamanan data staging

| # | Kelemahan | Sistem saat ini | Status | Bukti | Rekomendasi |
|---|-----------|-----------------|--------|-------|-------------|
| F1-13 | Seluruh view dimuat ke memori Node sebelum insert | `srcData.recordset` | ❌ | **[V]** `streamIngestion` | Baca bertahap (`request.stream` / paging berbasis PK) |
| F1-14 | `COUNT_BIG` di PRECHECK, `COUNT_BIG` lagi di DATA_STREAM, lalu `SELECT` — tiga pembacaan terpisah tanpa snapshot; sumber yang berubah menyebabkan mismatch atau data tak konsisten | Tidak ada isolasi snapshot | 🟡 | **[V]** | Pakai `SNAPSHOT`/`REPEATABLE READ` satu transaksi, atau pakai `rowsSrc` dari hasil baca aktual |
| F1-15 | Validasi hanya jumlah baris + PK duplikat | Tanpa checksum/agregat (sum, min/max) | 🟡 | **[V]** (isi `fn_check_staging` **[H]**: DB timeout) | Tambah checksum agregat per kolom kunci/numerik opsional |
| F1-16 | Baris yang gagal insert tercatat di error log, tetapi run tetap lanjut; apakah `fn_check_staging` menolak jika `loaded < rowsSrc` belum terverifikasi | Per-baris fallback + `errorRows` | 🟡 | `STAGING_INSERT_ERROR` **[V]**; keputusan gagal/lanjut **[H]** | Tentukan ambang: `errorRows > 0` → status `PARTIAL`/`FAILED` yang eksplisit, tampilkan di UI |
| F1-17 | Kolom yang tidak ada di salah satu sisi **diam-diam diabaikan** | `getMatchingColumns` hanya mengambil kolom yang cocok | ❌ | **[V]** | Catat peringatan bila kolom staging tak punya padanan di sumber (kecuali kolom sistem) |
| F1-18 | Konversi nilai diam-diam: tanggal `1900-01-01`/tak valid → `NULL`; UUID tak valid → `NULL`; tanggal dikonversi ke UTC (`toISOString`) | `formatValueForPg` | ❌ | **[V]** | Catat jumlah nilai yang diubah ke `NULL` per kolom; tetapkan zona waktu eksplisit |
| F1-19 | Kolom sensitif dienkripsi lewat `fn_encrypt_staging` | Berlaku per kolom terdaftar | ✅ | **[V]** | – |
| F1-20 | Insert batch bersifat atomik per statement; fallback per baris tidak membuat data ganda | Batch gagal tidak menyisakan sebagian | ✅ | **[V]** | – |

#### E. Ketahanan & praktik teknis

| # | Kelemahan | Sistem saat ini | Status | Bukti | Rekomendasi |
|---|-----------|-----------------|--------|-------|-------------|
| F1-21 | `TRUNCATE` cleanup dan pembersihan lain ditelan (`catch(_){}`) | Kegagalan cleanup tak terlihat | ❌ | **[V]** loop Flow 1 + `streamIngestion` (hanya `console`) | Tulis ke `migration_error_log` sebagai warning |
| F1-22 | Nama staging disusun string (`"${actualStg}"`) | Nilai dari `migration_config` (tepercaya, tapi rapuh) | 🟡 | **[V]** | Validasi dengan pola identifier aman + quote (helper `quoteIdent` sudah ada di `purge-precheck.service.js`) |
| F1-23 | Koneksi DB putus saat run (SQL Server/Postgres) | Error fatal → config FAILED → resume manual | 🟡 | **[V]** (timeout DB terbukti saat analisis) | Retry terbatas dengan backoff untuk pembacaan sumber/insert; tandai `RETRY_EXHAUSTED` |
| F1-24 | `PARTIAL_SUCCESS` tidak bisa diposting oleh Flow 2 | Flow 2 hanya menerima `SUCCESS` | ❌ | **[V]** validasi Flow 2 (Run #246 tertahan) | Izinkan posting config sukses saja, dengan konfirmasi |
| F1-25 | Flow 1 tidak menulis ke target sehingga tidak perlu rollback target | Cukup cleanup staging | ✅ | **[V]** | – |
| F1-26 | Config tanpa target aktif dilewati dan tercatat | `SKIP_NO_TARGET` | ✅ | **[V]** | – |

Ringkasan: 26 butir → ✅ 4 · 🟡 8 · ❌ 14.

### 1.C Rekomendasi Flow 1 (urut prioritas)

| Prioritas | Aksi | Menutup | Usaha | Risiko |
|-----------|------|---------|-------|--------|
| **P0** | Bersihkan step FAILED / `RUN_INTERRUPTED` / error log lama saat resume; tulis note dari status akhir | F1-01, F1-04 | Kecil | Rendah |
| **P0** | `end_time` di UPDATE `PARTIAL_SUCCESS`; satu `finalizeRun()` | F1-02, F1-03 | Kecil | Rendah |
| **P0** | Cleanup staging **semua** config pada cancel / force-stop / recover | F1-06, F1-07 | Kecil | Rendah |
| **P1** | Resume hanya config yang belum sukses | F1-05 | Sedang | Sedang (perlu tes resume multi-config) |
| **P1** | SUPERSEDED setelah run baru `SUCCESS` | F1-08 | Sedang | Rendah |
| **P1** | Flow 2 menerima `PARTIAL_SUCCESS` (config sukses saja) | F1-24 | Sedang | Sedang |
| **P1** | Lock per `stg_table` + cek run Flow 2 aktif | F1-11, F1-12 | Sedang | Sedang |
| **P2** | Advisory lock sungguhan di koneksi khusus | F1-10 | Sedang | Sedang |
| **P2** | Warning kolom tak cocok, hitung nilai yang di-NULL-kan, log error cleanup | F1-17, F1-18, F1-21 | Kecil | Rendah |
| **P2** | Retry/backoff koneksi, heartbeat run | F1-09, F1-23 | Sedang | Rendah |
| **P3** | Pembacaan bertahap + snapshot + checksum | F1-13, F1-14, F1-15 | Besar | Sedang |

Item yang perlu dicek setelah koneksi DB pulih (**[H]**): isi `pr_finish_run`, `fn_check_staging` (apakah `errorRows > 0` membuat gagal), `fn_prepare_staging`.

---

## 2. Flow 2 – Post ke Target

### Cara kerja saat ini **[V]**
- Menerima satu atau banyak Run ID Flow 1. Per run, config diambil dari `migration_run.config_id` (yang punya target aktif).
- Sebelum jalan: status → `RUNNING`, hapus error log `POST%`/`FLOW_EXECUTION` dan step `FAILED` lama (resume bersih).
- `PRECHECK_TARGET` → `POST_TARGETS` (`fn_post_all_targets`) → `RECONCILIATION_AUDIT` → `fn_finalize` (`is_posted = true`, `post_type`, `posted_at`).
- Jika gagal di tengah: **auto-rollback** (`rollbackAllTargets` tiap config) lalu status `FAILED`.
- Validasi: hanya run `SUCCESS` (atau `FAILED` hasil Flow 2), belum `is_posted`, belum `is_rolled_back`, bukan `SUPERSEDED`.
- Guard Flow 3 dan pipeline memakai `is_posted`/`is_rolled_back`.

### Matriks kelemahan

| # | Kelemahan | Sistem saat ini | Status | Bukti |
|---|-----------|-----------------|--------|-------|
| 2.1 | Catatan "Auto-Rollback OK" tetap tertulis walau rollback sendiri gagal | Error rollback ditelan, hanya warning | ❌ | **[V]** blok kegagalan Flow 2 |
| 2.2 | Hanya menerima `SUCCESS` | `PARTIAL_SUCCESS` ditolak | ❌ | **[V]** (lihat 1.4) |
| 2.3 | Tidak memastikan staging masih milik run yang diposting | Staging bisa sudah di-DROP/recreate oleh Flow 1 run lain | 🟡 | **[V]** `fn_prepare_staging` DROP; mitigasi parsial lewat status `SUPERSEDED` |
| 2.4 | `PARTIAL_SUCCESS` multi-run di-UPDATE tanpa `end_time` dan ditulis ke run primer | Riwayat run lain tidak mencerminkan hasil | ❌ | **[V]** |
| 2.5 | `currentConfigId = runConfigIds[0]` | Metadata/log error terkait config pertama saja | 🟡 | **[V]** |
| 2.6 | Lock in-memory; key tidak berbagi ruang dengan Flow 1 (7373/900000+run vs 4242/config_id) | Flow 1 dan Flow 2 bisa jalan bersamaan | ❌ | **[V]** key lock |
| 2.7 | Konsistensi rollback bergantung pada marker run di fungsi DB | Tidak bisa diverifikasi | – | **[H]** |
| 2.8 | Reconciliation audit gagal jika ada error log POST% dan cek jumlah baris per step | Menahan finalisasi jika tidak cocok | ✅ | **[V]** |
| 2.9 | Resume bersih (log lama dihapus) | Sudah | ✅ | **[V]** |
| 2.10 | Run yang sudah diposting ditolak | Mencegah posting ganda | ✅ | **[V]** |

### Rekomendasi
1. Catat hasil auto-rollback sebenarnya: `Auto-Rollback OK` hanya jika sukses, selain itu `Auto-Rollback GAGAL – perlu Flow 3 manual` dan tampilkan peringatan di UI (2.1).
2. Terima `PARTIAL_SUCCESS` untuk config sukses (2.2).
3. Sebelum post, verifikasi jumlah baris staging = `rows_staging` run (2.3).
4. Set `end_time` dan tulis status per run, bukan hanya run primer (2.4).
5. Lock tunggal lintas flow (2.6).
6. Setelah akses DB pulih, baca `fn_post_all_targets`/`fn_rollback_all_targets` untuk menutup 2.7.

---

## 3. Flow 3 – Rollback Target

### Cara kerja saat ini **[V]**
- Guard: run harus `is_posted = true` dan belum `is_rolled_back`. Auto-picker memilih run posted terakhir yang belum di-rollback.
- Sebelum jalan: status `RUNNING`, `end_time = NULL`, hapus error log `ROLLBACK%`/`FLOW_EXECUTION` (resume bersih).
- `ROLLBACK_TARGETS` (`fn_rollback_all_targets` per config) → `AUDIT_ROLLBACK_RECORD` (resync sequence) → `fn_finalize` (`is_rolled_back`).
- Gagal → `FAILED` dengan `end_time` dan pesan ramah. Multi-run: `PARTIAL_SUCCESS`.
- Flow 1 dan 2 ada auto-rollback; Flow 3 adalah rollback manual (tombol "ulang alur"/"rollback target" yang duplikat di modal diagnosis sudah dihapus).

### Matriks kelemahan

| # | Kelemahan | Sistem saat ini | Status | Bukti |
|---|-----------|-----------------|--------|-------|
| 3.1 | SQL resync sequence disusun dengan string (`'${tc.tgt_schema}'`) dan error ditelan | Nilai berasal dari konfigurasi internal (risiko rendah), tapi rapuh | 🟡 | **[V]** `AUDIT_ROLLBACK_RECORD` |
| 3.2 | Tidak ada pengecekan bahwa data hasil run sudah diubah/ditimpa run lain | Rollback per `run_id` mengandalkan marker di fungsi DB | – | **[H]** |
| 3.3 | Rollback tidak bisa di-undo | Tidak ada snapshot/backup sebelum hapus | ❌ | **[V]** tidak ada langkah backup |
| 3.4 | `PARTIAL_SUCCESS` multi-run tanpa `end_time` | | ❌ | **[V]** (pola sama 1.7) |
| 3.5 | Lock in-memory (key 8484 / 800000+run) | | 🟡 | **[V]** |
| 3.6 | Guard `is_posted`/`is_rolled_back` | Mencegah rollback ganda atau rollback run belum diposting | ✅ | **[V]** |
| 3.7 | Resume bersih, `end_time` diisi saat gagal | | ✅ | **[V]** |

### Rekomendasi
1. Ganti SQL resync sequence dengan `format('%I.%I', …)`/query berparameter dan **log** error, jangan ditelan (3.1).
2. Tambahkan pre-check "apakah ada run posting yang lebih baru untuk tabel/config yang sama"; tolak atau beri peringatan (3.2).
3. Opsional: snapshot ID/baris yang akan dihapus ke tabel arsip sebelum rollback (3.3).
4. Seragamkan `end_time` dan lock (3.4, 3.5).

---

## 4. Flow 4 – Target Purge

### Cara kerja saat ini **[V]**
- Input: daftar ID (maks. 500) atau semua data migrasi, per Config ID, urutan `exec_order` terbalik.
- `INIT_PURGE_SESSION` membuat rencana pre-check (`purge-precheck.service.js`) untuk semua config di awal. Mode **STRICT**: jika ada ID terblokir, seluruh purge dibatalkan (`PURGE_BLOCKED`).
- Bukti migrasi berasal dari `stg_antam.staging_data_history` (kunci dinormalisasi, mis. nol di depan). Status ID: `MIGRATED_ACTIVE` / `PROTECTED` / `ALREADY_PURGED` / `NOT_FOUND`.
- `PURGE_TARGET` hanya mengirim ID kandidat terverifikasi ke `fn_purge_target_data`, lalu `countRemaining`; ID tersisa → `PURGE_INCOMPLETE`.
- Resume membaca `deleteIds` dari log `PURGE_PARAMS` run tersebut. Pesan error sudah dibuat ramah.
- `purgeState` disimpan in-memory dan dibersihkan di `finally`.

### Matriks kelemahan

| # | Kelemahan | Sistem saat ini | Status | Bukti |
|---|-----------|-----------------|--------|-------|
| 4.1 | `fn_purge_target_data` (mode SPECIFIC) menolak dengan `NOT_MIGRATION_DATA` jika ID tidak ada di tabel staging **saat ini**; Flow 1 ulang membuat staging baru | Pre-check Node memakai `staging_data_history`, sehingga ID valid lolos pre-check tapi fungsi DB masih bisa menolak | 🟡 | **[V]** backup SQL + kasus ID 00001037/00001039 |
| 4.2 | Purge tidak bisa di-undo; tidak ada backup | Hanya dijaga pre-check dan flag `migration` | ❌ | **[V]** |
| 4.3 | `purgeState` in-memory hilang jika server restart; `DUAL_GUARD_PURGE` lalu gagal | Resume menjalankan ulang `INIT_PURGE_SESSION`, jadi risiko kecil | 🟡 | **[V]** kode; perilaku resume pasca-restart **[H]** |
| 4.4 | Run #255 (flow_4, SUCCESS) `end_time` NULL | Riwayat dan durasi tidak lengkap | ❌ | **[V]** data |
| 4.5 | Resync sequence di `RECONCILIATION_PURGE` memakai SQL string | | 🟡 | **[V]** (pola sama 3.1) |
| 4.6 | Batas 500 ID | Mencegah input terlalu besar; mode "semua" sebagai alternatif | ✅ | **[V]** |
| 4.7 | STRICT all-or-nothing | Mencegah purge parsial yang tidak terduga | ✅ | **[V]** |
| 4.8 | Penyaring identifier aman (`SAFE_IDENT`, `quoteIdent`) | | ✅ | **[V]** |
| 4.9 | Gagal baca history → `PURGE_BLOCKED` (fail-safe) | | ✅ | **[V]** |
| 4.10 | Branch "semua data" di fungsi DB belum diperiksa | | – | **[H]** |

### Rekomendasi
1. Ubah `fn_purge_target_data` agar bukti migrasi berasal dari `staging_data_history` (atau parameter daftar ID terverifikasi dari Node), bukan tabel staging saat ini. Ini menutup 4.1 secara tuntas. Lakukan lewat migrasi SQL yang terdokumentasi; backup versi lama ada di folder sesi.
2. Tambahkan arsip sebelum hapus (tabel `purge_archive` dengan `run_id`, config, payload JSON) agar purge bisa dipulihkan (4.2).
3. Pastikan `end_time` selalu diisi saat status akhir (4.4).
4. Tinjau branch "semua data" di fungsi DB (4.10).
5. Perbaiki helper resync sequence (4.5).

---

## 5. Masalah lintas flow

| # | Masalah | Dampak | Rekomendasi |
|---|---------|--------|-------------|
| X1 | Lock: `Set` in-memory, hasil advisory lock diabaikan, key berbeda per flow | Dua proses/instance dapat berjalan bersamaan; Flow 1 dan 2 bisa tumpang tindih | Satu modul lock di koneksi khusus, cek hasil, key berdasarkan config/tabel |
| X2 | `end_time` tidak konsisten (PARTIAL_SUCCESS, Flow 4) | Riwayat dan durasi salah | Satu fungsi `finalizeRun(status, note)` yang selalu mengisi `end_time` |
| X3 | Status akhir ditentukan di banyak tempat (Node + `pr_finish_run`) | Status bisa bertentangan dengan log (run #260) | Tetapkan satu sumber; hitung dari log run saat ini saja |
| X4 | `catch(_){}` di banyak tempat | Kegagalan cleanup/rollback tidak terlihat | Log sebagai warning di `migration_error_log` |
| X5 | Identifier SQL disusun dengan string | Rapuh jika nama config berubah | Helper `quoteIdent` bersama (sudah ada di `purge-precheck.service.js`) |
| X6 | Pemulihan: cancel/force-stop/recover tidak seragam | Staging/target bisa tertinggal setengah jadi | Satu prosedur cleanup per flow, dipakai oleh ketiganya |

---

## 6. Roadmap prioritas

| Prioritas | Item | Flow | Usaha |
|-----------|------|------|-------|
| P0 | Bersihkan log lama saat resume Flow 1 (status palsu FAILED) | 1 | Kecil |
| P0 | Pesan auto-rollback jujur | 2 | Kecil |
| P0 | `end_time` di semua status akhir | 1, 2, 3, 4 | Kecil |
| P1 | Resume hanya config yang belum sukses | 1 | Sedang |
| P1 | SUPERSEDED setelah run baru sukses | 1 | Sedang |
| P1 | Flow 2 menerima PARTIAL_SUCCESS | 1, 2 | Sedang |
| P1 | `fn_purge_target_data` berbasis history | 4 | Sedang (perubahan DB) |
| P2 | Lock terpadu | Semua | Sedang |
| P2 | Cleanup staging semua config pada cancel/force-stop/recover | 1 | Kecil–sedang |
| P2 | Helper identifier + log error yang ditelan | 3, 4 | Kecil |
| P3 | Arsip sebelum purge/rollback | 3, 4 | Besar |
| P3 | Ingestion berbasis cursor + checksum | 1 | Besar |

## 7. Bukti data

- **Run #260** (flow_1, config 2): FAILED dengan catatan "Flow 1 selesai sukses…". Step log: `RUN_INTERRUPTED` FAILED (lama), lalu PRECHECK…FINISH semuanya OK; 0 error log. Penyebab: status dihitung dari log lama.
- **Run #246** (PARTIAL_SUCCESS) dan #247–250 ditandai KADALUARSA oleh #260 sebelum #260 sukses.
- **Run #255** (flow_4, SUCCESS) `end_time` NULL. Runs #256–259 (flow_4) CANCELLED akibat `NOT_MIGRATION_DATA` sebelum pre-check ditambahkan.
