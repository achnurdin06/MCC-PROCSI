# Alur Migrasi (Flow 1–4) & Aturan Bisnis

> Terakhir diperbarui: 29 Oktober 2026 · Sumber: [`dag-engine.service.js`](../src/services/dag-engine.service.js) dan fungsi `mc_center.fn_*` (lihat [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md))

## 1. Gambaran Siklus

```
Flow 1 (Staging)  ──► Review Hasil Migrasi / Berita Acara ──► Flow 2 (Post)
                                                                  │
                                      anomali ◄───────────────────┤
                                         ▼                        ▼
                                  Flow 3 (Rollback)         selesai
                                         │
                       Flow 4 (Purge) ◄──┘ (hapus data migrasi di target / bersihkan ulang)
```

Setiap eksekusi menghasilkan satu `run_id` di `migration_run`. Flow 2 dan 3 beroperasi pada `run_id` Flow 1 yang sudah ada.

## 2. Flow 1 — Staging

**Tujuan**: menarik data dari view SQL Server ke tabel `stg_antam.<stg_table>`, mendeteksi delta terhadap target, dan mengonversi nilai lewat aturan lookup.

| # | Node | Aksi |
|---|---|---|
| 1 | `CHECK_DB_PREREQ` | Cek koneksi source & target, fungsi `mc_center` tersedia |
| 2 | `INIT_AND_GET_CONFIG` | Buat/ambil `run_id`, muat `migration_config` aktif (urut `exec_order`) |
| 3 | `LOOP_CONTROLLER` | Iterasi per `config_id` |
| 4 | `PRECHECK_SOURCE` | Jalankan `src_precheck_sql` (read-only) pada source |
| 5 | `PREPARE_STAGING` | `fn_prepare_staging` — siapkan/kosongkan tabel staging |
| 6 | `DATA_STREAM` | `ingestion.service` menyalin baris source → staging (batch). Kolom sensitif dienkripsi di staging (`fn_encrypt_staging`) |
| 7 | `CHECK_STAGING` | `fn_check_staging` — validasi jumlah/isi |
| 8 | `DELTA_CHECK` | `fn_check_delta` — bandingkan **business key** staging vs target; hasil di `staging_data_history` |
| 9 | `CONVERT_LOOKUP` | `fn_convert_staging` — terapkan `migration_convert_rule` + `migration_lookup` |

Aturan:
- Delta memakai `business_keys` (fallback `pk_columns`). Tanpa keduanya → error `MISSING_BUSINESS_KEYS`.
- Duplikat key di staging → run **GAGAL** (`DUPLICATE_SOURCE_KEY`) dengan contoh key di pesan, dan baris duplikat dicatat di `migration_error_log`.
- Status delta per baris: `NEW_DELTA` (akan diposting) atau `ALREADY_IN_TARGET` (dilewati).
- Kolom sensitif (`password`, `nik`, `current_token`, `nomor_rekening`, `swift_number`, `no_ktp_pic`) dibandingkan via `fn_decrypt_staging`.
- `error_policy`: `FAIL_ALL` (default; satu baris error menggagalkan config) atau `ALLOW_PARTIAL` (baris error dicatat, sisanya lanjut).
- Flow 1 dapat dijalankan ulang secara inkremental; riwayat staging sebelumnya menjadi acuan delta.

## 3. Flow 2 — Post

**Tujuan**: memuat data staging yang sudah dikonversi ke tabel target.

| # | Node | Aksi |
|---|---|---|
| 1 | `VALIDATE_POST_GUARD` | `fn_validate_post_run(run_id)` |
| 2 | `LOOP_CONTROLLER` | Iterasi config pada run |
| 3 | `PRECHECK_TARGET` | `fn_precheck_target` — `precheck_sql` target |
| 4 | `POST_TARGETS` | `fn_post_all_targets(run, cfg, batch_size, use_batch)` → `fn_post_target_dispatch` per `migration_target_config` (urut `exec_order`) memakai `mapping_sql` |
| 5 | `RECONCILIATION_AUDIT` | Hitung ulang source/staging/target untuk berita acara |

Guard (penolakan dengan error jelas):
- `ALREADY_ROLLED_BACK` — run yang sudah di-rollback tidak boleh diposting; mulai siklus baru dari Flow 1.
- `ALREADY_POSTED` — mencegah posting ganda / duplikasi data.
- Run tak ditemukan / tanpa `config_id` / `run_id` tidak numerik.
Setelah sukses: `is_posted = true`, `posted_at`, `post_type` terisi.

Parameter UI: `useBatch` (`Y`/`N`, default `Y`), `batchSize` (default 1000).

## 4. Flow 3 — Rollback

**Tujuan**: membatalkan data yang diposting oleh suatu run.

Node: `VALIDATE_ROLLBACK_GUARD` → `LOOP_CONTROLLER_RB` → `PRECHECK_ROLLBACK` → `ROLLBACK_TARGETS` (`fn_rollback_all_targets` → `fn_rollback_target_dispatch`, memakai `rollback_sql`) → `AUDIT_ROLLBACK_RECORD` (`pr_finish_rollback_run`).

Guard:
- `NOT_POSTED_YET` — run belum pernah diposting → tidak ada yang di-rollback.
- `ALREADY_ROLLED_BACK` — rollback ulang ditolak.
Setelah sukses: `is_rolled_back = true`, `rolled_back_at` terisi. Run itu **tidak bisa diposting lagi**.

## 5. Flow 4 — Purge

**Tujuan**: menghapus data hasil migrasi dari tabel target (opsional per ID) — mis. untuk mengulang dari awal di lingkungan dev/UAT.

Node: `INIT_PURGE_SESSION` → `LOOP_CONTROLLER_PURGE` → `DUAL_GUARD_PURGE` → `PURGE_TARGET` (`fn_purge_target_data(run, cfg, ids)`) → `RECONCILIATION_PURGE`.

Aturan:
- Selalu jalankan **`/api/flows/flow-4-purge-preview`** dulu (UI menyediakan tombol Preview) — tidak menghapus apa pun.
- `DUAL_GUARD_PURGE`: hanya baris yang berasal dari migrasi yang boleh dihapus (flag kolom `migration` bernilai 1/Y **atau** tercatat di `staging_data_history`). Selain itu → `NOT_MIGRATION_DATA`, penghapusan dibatalkan.
- `deleteIds` kosong = semua data migrasi untuk config tsb; isi dengan ID spesifik untuk purge terarah. ID tak ditemukan → `ID_NOT_FOUND`.
- Config tanpa target aktif → `NO_TARGET_CONFIG`.
- **Jangan dijalankan di produksi tanpa persetujuan tertulis dan backup** ([DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md#5-backup--pemulihan)).

## 6. Menambah Entitas Migrasi Baru (checklist)

1. **SQL Server**: buat view `dbo.v_vendor_<entitas>` (menu *Source Data* → Create View, role SUPERADMIN).
2. **Staging**: buat tabel `stg_antam.stg_<entitas>_src` yang kolomnya sama dengan view (+ kolom sistem bila template mengharuskan).
3. **`migration_config`**: isi `name_config`, `src_schema='dbo'`, `src_view`, `stg_table`, `tgt_schema`, `tgt_table`, `pk_columns`, **`business_keys`**, `exec_order`, `error_policy`, `is_active=true`, `client_id`, `env_id`.
4. **`migration_target_config`**: minimal satu baris per tabel target (jangan lupa — config 20 Siujk belum punya). Trigger `trg_fn_auto_mapping_target_config` membangun `mapping_sql`; periksa hasilnya, isi `precheck_sql`, `postcheck_sql`, `rollback_sql`.
5. **`migration_convert_rule` / `migration_lookup`**: untuk kolom yang butuh pemetaan referensi (`on_unmapped`, `default_value`, `normalize`).
6. Uji di **dev**: Flow 1 pada satu config → cek *Hasil Migrasi* (3-tier) → Flow 2 → Flow 3 → ulangi.
7. Ekspor konfigurasi (`GET /api/etl/configs/export`) dan impor ke produksi (`POST /api/etl/configs/import`, SUPERADMIN).

## 7. Aturan Emas

1. Jangan memposting run yang belum direview rekonsiliasinya.
2. Satu run = satu keputusan: Post **atau** Rollback; tidak ada posting ulang.
3. Urutan `exec_order` menentukan dependensi (induk lebih dulu: Vendor → Address/Akta/Siup/Tdp/Bank).
4. Query pada `src_precheck_sql`/`query_sql` view hanya `SELECT/WITH`.
5. Kolom sensitif tidak pernah dibandingkan atau ditampilkan dalam bentuk plaintext di log.
6. Perubahan fungsi `fn_*` diuji di dev dan dicatat di [CHANGELOG.md](./CHANGELOG.md).

## 8. Kelemahan yang Diketahui, Status Mitigasi & Roadmap

Bagian ini mengonsolidasikan analisis mendalam mengenai keterbatasan dan risiko teknis pada Flow 1–4, status mitigasi faktual pada basis kode saat ini, serta peta jalan (roadmap) penyempurnaannya. Hasil pengujian fungsional dan regresi lengkap dicatat pada [TESTING_REPORT.md](./TESTING_REPORT.md).

**Legenda Status:**
- ✅ **Tertutup (Fixed):** Kontrol telah diterapkan dan terverifikasi pada kode atau fungsi basis data.
- 🟡 **Parsial (Partial):** Mitigasi sebagian telah ada (mis. penanganan di Node.js namun stored procedure DB belum selaras penuh, atau batas toleransi waktu).
- ❌ **Terbuka (Open):** Masalah belum tertutup dan masuk ke dalam prioritas perbaikan (roadmap).

---

### 8.1 Matriks Kelemahan Flow 1 (Staging)

| # | Temuan Kelemahan | Kondisi Sistem Saat Ini | Status | Dampak / Rekomendasi Mitigasi |
|---|---|---|:---:|---|
| **F1-01** | Status `FAILED` palsu setelah resume | Resume Flow 1 tidak membersihkan `migration_step_log` (`FAILED`/`RUN_INTERRUPTED`) lama; `pr_finish_run` menghitung total kegagalan historis. | ❌ | **P0:** Hapus/arsipkan step gagal lama saat resume Flow 1 (sebagaimana Flow 2/3 telah lakukan). |
| **F1-02** | `PARTIAL_SUCCESS` di-UPDATE tanpa `end_time` | Di `dag-engine.service.js` (blok penanganan parsial), query UPDATE hanya mengatur status dan note tanpa kolom `end_time`. | ❌ | **P0:** Sertakan `end_time = NOW()` pada query UPDATE `PARTIAL_SUCCESS`. |
| **F1-03** | Dual-source status (Node vs `pr_finish_run`) | Jika config terakhir gagal, `FINISH_FLOW1` tidak dieksekusi; status ditentukan logika fallback Node.js. | 🟡 | **P0:** Terapkan fungsi `finalizeRun()` terpusat yang selalu dipanggil di blok `finally`. |
| **F1-04** | Catatan status kontradiktif di note | Catatan "Flow 1 selesai sukses" dapat tertinggal pada run yang berstatus akhir `FAILED`/`PARTIAL_SUCCESS`. | ❌ | **P0:** Susun deskripsi note run murni dari status akhir hasil evaluasi terpadu. |
| **F1-05** | Resume menjalankan ulang seluruh config | UI mengirim seluruh daftar config; config yang sudah sukses diekstraksi tetap di-DROP dan dimuat ulang. | ❌ | **P1:** Evaluasi config yang sudah berhasil dari log step, jalankan hanya config yang tertunda/gagal. |
| **F1-06** | Pembersihan saat Cancel hanya config pertama | Fungsi `cancelRun` membersihkan tabel staging hanya untuk config index ke-0 (`split(',')[0]`). | ❌ | **P0:** Lakukan iterasi pembersihan staging untuk seluruh config ID yang tercatat pada run. |
| **F1-07** | Force Stop & recovery tidak membersihkan staging | Handler interupsi/stale run hanya mengubah status run menjadi `FAILED` tanpa membersihkan tabel staging parsial. | ❌ | **P0:** Terapkan fungsi pembersihan staging yang seragam pada event cancel, force-stop, dan recovery. |
| **F1-08** | Penandaan `SUPERSEDED` terlalu dini | Run lama ditandai kadaluarsa saat run baru **mulai**; jika run baru gagal di awal, run lama terlanjur tidak bisa diposting. | ❌ | **P1:** Tandai `SUPERSEDED` hanya setelah run baru berstatus `SUCCESS`. |
| **F1-09** | Deteksi proses mati bergantung ambang batas waktu | Stale run dideteksi jika `RUNNING` tanpa pembaruan selama `STALE_RUN_MINUTES = 10`. | 🟡 | **P2:** Tambahkan mekanisme heartbeat proses worker dan pemulihan otomatis saat server booting. |
| **F1-10** | Kunci eksekusi berbasis in-memory | Proteksi konkurensi memakai `Set` lokal di memori Node.js (`activeRuns`, `runLocks`); belum aman untuk multi-instance. | 🟡 | **P2:** Terapkan advisory lock persisten berbasis PostgreSQL connection terdedikasi atau Redis lock. |
| **F1-11** | Pemisahan ruang kunci single vs multi-config | Multi-config memakai lock key `4242`, sedangkan single config memakai `config_id`; ada celah tabrakan jika berjalan bersamaan. | ❌ | **P1:** Kunci berbasis `stg_table` atau urutan resource kanonik. |
| **F1-12** | Kunci Flow 1 dan Flow 2 tidak berbagi ruang | Key Flow 1 (`4242`/`config_id`) berbeda dengan Flow 2 (`7373`/`900000+run`); Flow 1 dapat me-DROP staging yang sedang dibaca Flow 2. | ❌ | **P1:** Validasi silang: Flow 1 menolak jalan jika ada Flow 2 `RUNNING` untuk config yang beririsan. |
| **F1-13** | Recordset view dimuat utuh ke memori Node.js | `streamIngestion` memuat seluruh `srcData.recordset` sebelum batching; risiko OOM pada tabel berukuran gigabyte. | ❌ | **P3:** Migrasi ke pembacaan streaming/kursor berbasis TDS driver atau pemotongan chunk berbasis PK sumber. |
| **F1-14** | Pembacaan data sumber tanpa isolasi snapshot | Dilakukan 3 kali pembacaan terpisah (`COUNT_BIG` di precheck, `COUNT_BIG` di ingestion, lalu `SELECT`); rentan selisih jika ada transaksi aktif di sumber. | 🟡 | **P3:** Gunakan snapshot isolation atau pakai hitungan baris aktual hasil `SELECT`. |
| **F1-15** | Validasi staging kuantitatif tanpa checksum | Pemeriksaan staging di `fn_check_staging` mencocokkan jumlah baris dan keunikan PK, belum menyertakan hash/checksum agregat. | 🟡 | **P3:** Tambahkan validasi hash/checksum agregat opsional untuk kolom kunci numerik. |
| **F1-16** | Kegagalan baris pada fallback insert per baris | Baris korup dicatat ke `migration_error_log` (`STAGING_INSERT_ERROR`), namun penentuan status akhir masih perlu visibilitas tinggi di UI. | 🟡 | **P1:** Tampilkan metrik baris gagal insert secara eksplisit di UI ringkasan dan dashboard. |
| **F1-17** | Kolom tidak cocok diabaikan secara diam-diam | `getMatchingColumns` memotong kolom yang tidak berpasangan tanpa melempar peringatan di log eksekusi. | ❌ | **P2:** Catat daftar kolom sumber yang tidak memiliki padanan di staging ke dalam warning log. |
| **F1-18** | Konversi nilai otomatis ke `NULL` | Tanggal invalid (`1900-01-01`), format date parsing, atau UUID korup dikonversi menjadi `NULL` tanpa rekapitulasi. | ❌ | **P2:** Berikan rekapitulasi jumlah nilai yang mengalami pembersihan (sanitasi) ke `NULL`. |
| **F1-19** | Proteksi enkripsi data sensitif | Kolom kredensial (`password`, `nik`, rekening) dienkripsi secara transparan via `fn_encrypt_staging`. | ✅ | Proteksi kriptografis aktif. |
| **F1-20** | Atomisitas batch insert | Batch gagal dibatalkan per kelompok statement dan dialihkan ke pengujian per-baris tanpa data duplikat. | ✅ | Data staging bebas duplikasi batch. |
| **F1-21** | Error pada pembersihan darurat ditelan | Kegagalan perintah `TRUNCATE` atau cleanup darurat ditangkap blok `catch(_){}` kosong. | ❌ | **P2:** Catat kegagalan cleanup ke `migration_error_log` dengan tingkat keparahan `WARN`. |
| **F1-22** | Identifier tabel staging disusun string | Penulisan string `stg_antam."${actualStg}"` aman selama nama config terkontrol, namun rawan injeksi jika input sembarang. | 🟡 | **P2:** Terapkan helper `quoteIdent` untuk semua penyusunan nama objek database secara seragam. |
| **F1-23** | Kerapuhan koneksi jaringan DB sumber | Putusnya koneksi SQL Server atau DB target menyebabkan run gagal tanpa retry otomatis. | 🟡 | **P2:** Terapkan retry bertingkat dengan eksponensial backoff untuk koneksi database. |
| **F1-24** | Flow 2 menolak hasil `PARTIAL_SUCCESS` | Flow 2 hanya menerima run berstatus `SUCCESS`; data config yang sukses pada run parsial tidak dapat diposting. | ❌ | **P1:** Izinkan posting selektif untuk config-config yang 100% sukses pada run parsial. |
| **F1-25** | Isolasi modifikasi target | Flow 1 tidak menyentuh skema target produksi sehingga tidak menimbulkan risiko kerusakan tabel utama. | ✅ | Terisolasi di skema `stg_antam`. |
| **F1-26** | Penanganan config tanpa target aktif | Konfigurasi tanpa target aktif dilewati secara aman (`SKIP_NO_TARGET`) dan dicatat informatif. | ✅ | Mengurangi risiko runtime error. |

---

### 8.2 Matriks Kelemahan Flow 2 (Post ke Target)

| # | Temuan Kelemahan | Kondisi Sistem Saat Ini | Status | Rekomendasi Mitigasi |
|---|---|---|:---:|---|
| **2.1** | Notifikasi "Auto-Rollback OK" semu | Jika proses posting gagal dan prosedur auto-rollback internal juga mengalami galat, pesan "Auto-Rollback OK" tetap tertulis. | ❌ | **P0:** Evaluasi hasil auto-rollback: jika gagal, tulis `Auto-Rollback GAGAL - Perlu Flow 3 Manual` dan beri peringatan di UI. |
| **2.2** | Penolakan run berstatus `PARTIAL_SUCCESS` | Validasi awal menolak seluruh run yang tidak berstatus `SUCCESS` penuh. | ❌ | **P1:** Berikan dialog konfirmasi untuk memproses hanya konfigurasi yang sukses. |
| **2.3** | Integritas staging terhadap penimpaan run lain | Belum ada verifikasi bahwa baris di staging masih sesuai dengan `rows_staging` saat Flow 1 selesai dieksekusi. | 🟡 | **P1:** Cocokkan jumlah baris di staging dengan snapshot di `migration_run` sebelum memulai posting. |
| **2.4** | `PARTIAL_SUCCESS` multi-run tanpa `end_time` | Run multi-sesi yang berakhir parsial di-UPDATE tanpa mengisi `end_time`. | ❌ | **P0:** Perbarui query UPDATE pada `dag-engine.service.js` agar menyertakan `end_time = NOW()`. |
| **2.5** | Asosiasi config ID terikat pada index pertama | Variabel internal `currentConfigId` mengambil elemen `[0]`, sehingga log error multi-config kurang spesifik. | 🟡 | **P2:** Tautkan log error dengan ID konfigurasi yang sedang aktif diproses pada loop. |
| **2.6** | Pemisahan ruang kunci dengan Flow 1 | Ruang key lock terpisah (Flow 2 memakai 7373/900000+run), berisiko balapan (*race condition*) dengan Flow 1 baru. | ❌ | **P1:** Ruang lock terintegrasi per tabel staging/target. |
| **2.7** | Pelacakan identitas record target | Konsistensi rollback mengandalkan penanda `migration = '1'` dan `migration_run_id` pada tabel target. | ✅ | Terverifikasi pada skema target dan fungsi dispatch. |
| **2.8** | Rekonsiliasi audit menahan posting gagal | Adanya catatan error berkategori `POST%` atau ketidakcocokan baris membatalkan finalisasi posting. | ✅ | Menjamin data tidak ditandai `is_posted` jika ada kejanggalan. |
| **2.9** | Pembersihan log lama saat resume Flow 2 | Resume Flow 2 secara bersih menghapus riwayat error log `POST%` lama dari run terkait. | ✅ | Mencegah akumulasi status salah. |
| **2.10** | Proteksi posting berulang (`ALREADY_POSTED`) | Run yang sudah pernah diposting langsung ditolak untuk mencegah duplikasi data transaksi target. | ✅ | Terproteksi oleh stored procedure `fn_validate_post_run`. |

---

### 8.3 Matriks Kelemahan Flow 3 (Safe Rollback)

| # | Temuan Kelemahan | Kondisi Sistem Saat Ini | Status | Rekomendasi Mitigasi |
|---|---|---|:---:|---|
| **3.1** | Susunan SQL resync sequence berbasis konkatenasi string | Penulisan nama skema dan tabel pada perintah sinkronisasi sequence masih disusun via string `${tc.tgt_schema}`. | 🟡 | **P2:** Gunakan fungsi `format('%I.%I', ...)` atau query berparameter terproteksi. |
| **3.2** | Belum ada deteksi data telah dimutasi proses bisnis lain | Data target yang dihapus rollback diasumsikan murni hasil migrasi tanpa ada perubahan lanjutan oleh pengguna sistem target. | 🟡 | **P2:** Tambahkan peringatan jika `updated_at > posted_at` pada data target yang hendak di-rollback. |
| **3.3** | Tindakan Rollback tidak dapat dibatalkan (*no undo*) | Baris dihapus langsung dari tabel target tanpa dibuatkan snapshot atau tabel arsip sementara. | ❌ | **P3:** Sediakan tabel arsip rollback sementara sebelum instruksi `DELETE` dieksekusi. |
| **3.4** | `PARTIAL_SUCCESS` multi-run tanpa `end_time` | Mengikuti pola yang sama dengan Flow 1 & 2; update status parsial multi-run belum menyertakan `end_time`. | ❌ | **P0:** Lengkapi kolom `end_time = NOW()` pada blok penanganan parsial Flow 3. |
| **3.5** | Kunci eksekusi in-memory (key `8484`) | Belum menggunakan lock terdistribusi. | 🟡 | **P2:** Penyelarasan mekanisme lock terpadu. |
| **3.6** | Verifikasi status run sebelum rollback | Run wajib memiliki `is_posted = true` dan belum pernah di-rollback (`is_rolled_back = false`). | ✅ | Terproteksi oleh guard `NOT_POSTED_YET` dan `ALREADY_ROLLED_BACK`. |
| **3.7** | Resume bersih & pencatatan `end_time` saat gagal | Error log `ROLLBACK%` lama dibersihkan saat resume, dan kegagalan mencatat waktu berakhir secara akurat. | ✅ | Menghasilkan riwayat waktu audit yang konsisten. |

---

### 8.4 Matriks Kelemahan Flow 4 (Target Purge)

| # | Temuan Kelemahan | Kondisi Sistem Saat Ini | Status | Rekomendasi Mitigasi |
|---|---|---|:---:|---|
| **4.1** | Penolakan purge jika Flow 1 diulang | Stored procedure `fn_purge_target_data` dan modul `purge-precheck.service.js` kini memanfaatkan `stg_antam.staging_data_history` sebagai referensi silang data migrasi. | ✅ | Tertutup penuh; ID valid lintas run dapat dibersihkan dengan aman. |
| **4.2** | Purge tidak dapat dibatalkan (*irreversible*) | Data target langsung dihapus permanen; tidak ada mekanisme *soft-delete* atau snapshot otomatis. | ❌ | **P3:** Tambahkan tabel `purge_archive` (JSON payload) untuk menyimpan baris sebelum dihapus permanen. |
| **4.3** | State purge disimpan di memori proses | State pra-pemeriksaan (`purgeState`) berada di memori Node.js; namun sesi resume selalu mengulang `INIT_PURGE_SESSION` sehingga aman. | 🟡 | **P2:** Simpan state purge berumur pendek ke tabel sesi atau Redis jika berpindah ke multi-worker. |
| **4.4** | Waktu berakhir `end_time` kosong pada run sukses historis | Terjadi pada run flow 4 masa lalu (contoh: Run #255); alur finalisasi kini diselaraskan. | 🟡 | **P0:** Pastikan pemanggilan `pr_finish_run` atau UPDATE run pada Flow 4 selalu mengisi `end_time`. |
| **4.5** | Penyusunan query sequence resync berbasis string | Serupa dengan temuan 3.1 pada penataan ulang urutan nomor transaksi. | 🟡 | **P2:** Terapkan helper `quoteIdent` secara konsisten. |
| **4.6** | Pembatasan kuota seleksi ID (Maks. 500 ID) | Mencegah overload parameter query SQL dan memori aplikasi. | ✅ | Batasan ukuran input terlindungi. |
| **4.7** | Kebijakan kegagalan ketat (*STRICT all-or-nothing*) | Jika ditemukan minimal satu ID terlindungi (*PROTECTED*) atau bukan data migrasi, seluruh transaksi dibatalkan (`PURGE_BLOCKED`). | ✅ | Melindungi integritas data operasional target secara maksimal. |
| **4.8** | Sanitasi identifier database | Menggunakan pola whitelist identifier aman (`SAFE_IDENT`) dan fungsi `quoteIdent`. | ✅ | Menutup risiko SQL Injection struktural. |
| **4.9** | Perlindungan fail-safe riwayat staging | Jika pembacaan tabel riwayat gagal, pre-check langsung memblokir purge. | ✅ | Mencegah penghapusan tak disengaja saat database penampung tidak siap. |

---

### 8.5 Masalah Lintas Flow (Cross-Flow Issues)

1. **X1 - Mekanisme Lock Belum Terpusat:** Penanganan konkurensi masih menggunakan `Set` di memori lokal proses Node.js dengan ruang kunci yang berbeda-beda (`4242` di Flow 1, `7373` di Flow 2, `8484` di Flow 3). Jika server dijalankan dalam mode cluster atau multi-container, celah balapan proses (*race condition*) tetap dapat terjadi.
2. **X2 - Konsistensi Pengisian `end_time`:** Query UPDATE berstatus `PARTIAL_SUCCESS` pada Flow 1, 2, dan 3 belum menyertakan `end_time = NOW()`.
3. **X3 - Kepemilikan Status Akhir (Dual Source of Truth):** Status akhir ditentukan sebagian oleh stored procedure `pr_finish_run` dan sebagian oleh handler perkondisian pada kode Node.js.
4. **X4 - Penelanan Galat Pembersihan (`catch(_){}`):** Beberapa blok cleanup pembersihan darurat menelan error tanpa mencatat peringatan ke `migration_error_log`.
5. **X5 - Helper Identifier Belum Terstandarisasi Penuh:** Helper `quoteIdent` telah diterapkan pada modul purge, namun modul sequence resync di Flow 2 dan 3 masih menggunakan interpolasi string biasa.
6. **X6 - Harmonisasi Alur Interupsi:** Perilaku pembersihan staging pada aksi `cancelRun`, `forceStopRun`, dan pemulihan `recoverInterruptedRuns` belum seragam (cancel hanya membersihkan config pertama, sedangkan force-stop tidak membersihkan staging).

---

### 8.6 Roadmap Mitigasi Terstruktur (P0 – P3)

```
[ P0: Kritis & Cepat (Quick Wins) ]
├── 1. Perbaiki F1-01: Bersihkan log step FAILED / RUN_INTERRUPTED lama saat resume Flow 1.
├── 2. Perbaiki F1-02, 2.4, 3.4: Tambahkan end_time = NOW() pada seluruh UPDATE PARTIAL_SUCCESS.
├── 3. Perbaiki F1-06: Loop seluruh config ID pada aksi cancelRun agar staging bersih menyeluruh.
└── 4. Perbaiki 2.1: Validasi status auto-rollback riil (jangan selalu tulis "Auto-Rollback OK").

[ P1: Integritas Alur & Pengalaman Operator ]
├── 1. Perbaiki F1-05: Resume selektif (jalankan hanya konfigurasi yang belum sukses).
├── 2. Perbaiki F1-08: Tandai SUPERSEDED hanya setelah run baru mencapai status SUCCESS.
├── 3. Perbaiki F1-24 & 2.2: Izinkan Flow 2 memproses konfigurasi sukses dari run PARTIAL_SUCCESS.
└── 4. Perbaiki F1-11 & F1-12: Satukan ruang kunci lock Flow 1 dan Flow 2 untuk mencegah penimpaan staging.

[ P2: Keandalan Arsitektur & Sanitasi ]
├── 1. Terapkan PostgreSQL Advisory Lock atau Redis terdistribusi menggantikan in-memory Set.
├── 2. Gunakan helper quoteIdent untuk seluruh perintah resync sequence dan DDL dinamis.
├── 3. Tangkap dan catat seluruh galat cleanup yang sebelumnya ditelan ke migration_error_log (WARN).
└── 4. Tambahkan mekanisme auto-retry dan heartbeat pada koneksi database sumber.

[ P3: Ketahanan Skala Besar & Audit Lanjutan ]
├── 1. Ubah pembacaan view SQL Server menjadi streaming berbasis kursor / paging chunk.
├── 2. Tambahkan validasi hash / checksum agregat pada pengecekan data staging vs sumber.
└── 3. Buat tabel arsip snapshot (purge_archive & rollback_archive) agar penghapusan data dapat di-undo.
```

---

### 8.7 Bukti Data Kasus Riil (Audit Historis)
- **Kasus Run #260 (Flow 1, Config 2):** Menghasilkan status akhir `FAILED` meskipun seluruh tahapan ekstraksi data berhasil 100% dan tidak ada error log baru. Investigasi membuktikan `pr_finish_run` menghitung baris `RUN_INTERRUPTED` dari sesi sebelumnya yang gagal.
- **Kasus Run #246 & #247–250:** Ditandai `KADALUARSA (SUPERSEDED)` oleh eksekusi Run #260 sesaat setelah dimulai, sehingga saat Run #260 sempat gagal, run lama terlanjur tidak bisa diposting kembali.
- **Kasus Run #255 (Flow 4):** Berstatus `SUCCESS` namun kolom `end_time` bernilai `NULL` di database akibat jalur UPDATE status akhir yang tidak konsisten.
- **Kasus ID 00001037 / 00001039 (Purge):** Sempat terblokir pada stored procedure lama karena staging terhapus oleh run Flow 1 baru; berhasil diatasi setelah penerapan skema `stg_antam.staging_data_history`.

