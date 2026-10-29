# LAPORAN PENGUJIAN DAN PERBAIKAN SISTEM MIGRASI (FLOW 1 - FLOW 3)
**Dokumen:** Hasil Investigasi Bug, Perbaikan Arsitektur, dan Siklus Pengujian QA  
**Peran:** Senior Software Engineer & Lead QA Engineer  
**Repositori:** `achnurdin06/mig-antam`  
**Basis Data Target:** PostgreSQL (`db_procsi` @ `<HOST_DEV>:<PORT>`)  
**Basis Data Kontrol:** Skema `mc_center` & `etl_antam`  
**Tanggal Eksekusi:** Sesi Verifikasi Menyeluruh (Run 305 s/d 327)  

---

## 1. RINGKASAN EKSEKUTIF

Laporan ini menyajikan hasil investigasi mendalam, perbaikan akar masalah (*root cause fixes*), serta pengujian menyeluruh (positif dan negatif) pada alur kerja migrasi data dari SQL Server ke PostgreSQL untuk seluruh konfigurasi aktif, dengan fokus utama pada **Konfigurasi 1 (Vendor Master)** sebagai jangkar relasi data (*parent entity*).

### Masalah Utama yang Dilaporkan Pengguna:
1. **Riwayat Eksekusi Tidak Otomatis Ter-refresh di Flow 2:** Setelah eksekusi Flow 2 selesai, panel riwayat, log langkah, dan log error pada *Workflow Canvas Studio* tidak diperbarui secara otomatis seperti halnya pada Flow 1.
2. **Duplikasi Posting pada Konfigurasi 2 (Run 263 dan 305):** Terjadi posting dua kali pada data akta perusahaan sehingga baris data target menjadi ganda.
3. **Siklus Pengujian Menyeluruh (Flow 1 s/d 3):** Meminta eksekusi siklus migrasi dari Flow 1 (Staging) sampai Flow 3 (Rollback) untuk seluruh konfigurasi aktif, mencakup uji positif (*positive tests*) dan uji negatif (*negative tests*), serta perbaikan bug langsung jika ditemukan anomali.

### Hasil Utama yang Dicapai:
- **6 Masalah Kritis Diidentifikasi dan Diperbaiki (D-01 s/d D-06):** Mulai dari logika DAG Flow 1, generator SQL mapping target (`fn_build_target_mapping_sql`), mekanisme enkripsi pgcrypto pada kunci bisnis delta (`fn_check_delta`), hingga dua potensi crash engine Node.js (`activeContext` dan `isResumedRun`).
- **Idempotensi Sempurna Terbukti:** Semua konfigurasi aktif (1, 2, 15, 19, 21, 22, 23) telah diuji coba siklus ulang berulang kali (Run 320 s/d 327) dan menghasilkan selisih **+0 baris baru** tanpa ada duplikasi data.
- **Auto-Refresh Canvas Normal:** Event SSE Flow 2 kini menyertakan `nodeType` dan `runId`, serta listener canvas otomatis menyetel `state.process.selectedRunId` sehingga riwayat, log tahapan, dan diagnostik otomatis sinkron.
- **Validasi Rollback Ditingkatkan:** Menambahkan proteksi `STAGING_STALE` pada `fn_validate_rollback_trigger` agar Flow 3 menolak pembatalan yang berbasis data staging yang sudah usang/ditimpa oleh run berikutnya.

---

## 2. INVESTIGASI & AKAR MASALAH (ROOT CAUSE ANALYSIS)

### 2.1 Masalah 1: Mengapa Config 2 Melakukan 2 Kali Post (Run 263 dan 305)?
- **Akar Masalah #1 (SQL Mapping Target Kurang Guard Kunci Bisnis):**  
  Fungsi generator SQL mapping `mc_center.fn_build_target_mapping_sql` dan `etl_antam.fn_build_target_mapping_sql` sebelumnya hanya menambahkan klausa pencegah duplikasi berbasis ID staging:  
  `WHERE NOT EXISTS (SELECT 1 FROM target t WHERE t.id = s.id)`  
  Karena Flow 1 menghasilkan ID staging baru (*surrogate key sequence*) setiap kali dijalankan ulang, run berikutnya menghasilkan ID staging yang belum ada di target, sehingga klausa tersebut tembus dan data yang sama di-*insert* kembali.
- **Akar Masalah #2 (Urutan DAG Flow 1 Keliru):**  
  Preset `flow_1_staging` pada `src/services/dag-engine.service.js` sebelumnya mengeksekusi langkah `DELTA_CHECK` **sebelum** `CONVERT_LOOKUP`. Akibatnya, pada child config seperti Config 2 (Akta), kolom `vendor_id` di staging masih berupa kode referensi lama (misal `00001039`) dan belum dikonversi ke ID vendor target (`00001044`). Pengecekan delta membandingkan kode lama dengan target yang sudah memakai ID baru, menyimpulkan seluruh baris adalah data baru, dan meloloskannya ke target.

### 2.2 Masalah 2: Riwayat Eksekusi Tidak Otomatis Refresh di Flow 2
- **Akar Masalah #1 (Payload SSE Node Completed Tidak Memiliki `nodeType`):**  
  Di `dag-engine.service.js`, saat mengeksekusi Flow 2 dan Flow 3, pemanggilan `emitEvent('node_completed', { ... })` tidak menyertakan properti `nodeType: node.type`.
- **Akar Masalah #2 (State UI Tidak Mengetahui Run ID Aktif):**  
  Fungsi `refreshCanvasHistory` di `src/public/js/app.js` bergantung pada `state.process.selectedRunId`. Saat Flow 2 dimulai lewat shortcut canvas, state tersebut tidak selalu di-set, sehingga fetch panel riwayat, log langkah, dan log error memanggil endpoint dengan ID kosong (`undefined`).

### 2.3 Masalah 3: Engine Crash pada Exception Handling (`activeContext`)
- **Akar Masalah:**  
  Di `src/services/dag-engine.service.js`, fungsi `_runExecutionLoop` mendeklarasikan variabel `context` di dalam blok `try`. Ketika terjadi exception fatal di luar loop tahapan, blok `catch (err)` mencoba mengakses `context.runId` atau `context.flowId`. Hal ini memicu `ReferenceError: context is not defined` yang menyebabkan proses Node.js crash seketika, dan session migrasi menggantung dalam status `RUNNING` tanpa pernah di-update menjadi `FAILED`.

### 2.4 Masalah 4: Engine Crash pada `isResumedRun is not defined` (Run 306 & 307)
- **Akar Masalah:**  
  Variabel `isResumedRun` dan `lastSuccessfulStaging` sebelumnya dideklarasikan pada fungsi `executeFlow`, namun diakses langsung di dalam `_runExecutionLoop` tanpa dilewatkan melalui argumen opsi. Ketika Flow 1 dijalankan pada Run 307, eksekusi melempar `ReferenceError: isResumedRun is not defined`, menyebabkan run langsung berstatus `FAILED`. Run 306 sebelumnya juga menggantung akibat issue ini sebelum crash handler diperbaiki.

### 2.5 Masalah 5: Duplikasi Posting Data Terenkripsi pada Config 23 (Rekening Bank)
- **Akar Masalah (Enkripsi vs Teks Biasa):**  
  Pada Konfigurasi 23 (Rekening Bank), kolom kunci bisnis adalah `(vendor_id, nomor_rekening)`.  
  Di tabel staging `stg_antam.stg_bank_src`, kolom `nomor_rekening` dienkripsi menggunakan ekstensi `pgcrypto` dengan format `PGP:...`. Sedangkan di tabel target `vendor.rekening_bank`, data disimpan dalam bentuk teks terdekripsi (*plain text*).  
  Ketika `fn_check_delta` dan `fn_build_target_mapping_sql` membandingkan nilai `s.nomor_rekening = t.nomor_rekening`, perbandingan antara ciphertext `PGP:...` dan teks asli selalu menghasilkan nilai `FALSE`. Akibatnya, pada Run 319, data rekening bank ter-insert duplikat sebanyak 6 baris.

### 2.6 Masalah 6: Stale Staging pada Flow 3 Rollback
- **Akar Masalah:**  
  Logika `DELETE` pada `migration_target_config.rollback_sql` menggunakan relasi `WHERE t.id = s.id` ke tabel staging. Jika sebuah sesi migrasi lama (misal Run 313) ingin di-rollback setelah pengguna menjalankan Flow 1 kembali (misal Run 325), ID di tabel staging sudah berganti menjadi sequence baru. Fungsi rollback tetap berjalan sukses namun menghasilkan **selisih 0 baris terhapus (-0)**, sementara status `is_rolled_back` keliru ditandai `true`.

---

## 3. DAFTAR PERBAIKAN TEKNIS (DEFECT LOG)

| ID Defect | Komponen | File / Objek DB | Deskripsi Perbaikan | Status |
|---|---|---|---|---|
| **D-01** | DAG Workflow | `src/services/dag-engine.service.js` | Menukar urutan node Flow 1: `CONVERT_LOOKUP` dijalankan **sebelum** `DELTA_CHECK` agar referensi child terkonversi sebelum evaluasi delta. | **RESOLVED** |
| **D-02** | Target Mapping SQL | `mc_center.fn_build_target_mapping_sql` & `etl_antam.fn_build_target_mapping_sql` | Menambahkan kondisi kunci bisnis dinamis (`v_pk_cond_exists`) pada klausa `WHERE NOT EXISTS`. Jika `business_keys` dikonfigurasi, duplikasi dicegah berdasarkan nilai bisnis riil, bukan semata ID surrogate. | **RESOLVED** |
| **D-03** | SSE & UI Canvas | `src/services/dag-engine.service.js`, `src/public/js/flow-canvas.js`, `src/public/js/app.js` | 1. Menambahkan `nodeType: node.type` pada event `node_completed` Flow 2 & Flow 3.<br>2. Meneruskan `data.runId` dari event completion ke `refreshCanvasHistory(targetRunId)`.<br>3. Mengatur `state.process.selectedRunId` agar sinkronisasi panel riwayat dan log otomatis memuat run yang baru selesai. | **RESOLVED** |
| **D-04** | Node Engine Stability | `src/services/dag-engine.service.js` | 1. Memperkenalkan `let activeContext = null` pada scope fungsi terluar agar block `catch` tidak melempar `ReferenceError: context is not defined`.<br>2. Meneruskan `isResumedRun` dan `lastSuccessfulStaging` via options object ke `_runExecutionLoop` dengan default fallback `false` dan `{}`. | **RESOLVED** |
| **D-05** | Sensitive Key Decryption | `mc_center.fn_check_delta`, `mc_center.fn_build_target_mapping_sql`, `etl_antam.fn_build_target_mapping_sql` | Menambahkan penanganan otomatis kolom sensitif (`nomor_rekening`, `swift_number`, `nik`, `password`, `no_ktp_pic`, `current_token`). Saat membandingkan staging terenkripsi dengan target, sistem membungkus ekspresi dengan `mc_center.fn_decrypt_staging(s.col)`. | **RESOLVED** |
| **D-06** | Rollback Stale Guard | `mc_center.fn_validate_rollback_trigger` | Menambahkan pengecekan `STAGING_STALE`. Jika tabel staging sudah diperbarui oleh run yang lebih baru daripada target run yang hendak di-rollback, eksekusi langsung dibatalkan dengan error informatif untuk mencegah silent failure (0 baris terhapus). | **RESOLVED** |

---

## 4. MATRIKS PENGUJIAN QA (TEST MATRIX)

### 4.1 Ringkasan Pengujian Siklus Positif (Positive End-to-End Cycle)
Setiap konfigurasi diuji menjalankan Flow 1 (Staging, Lookup Convert, Delta Check) dilanjutkan Flow 2 (Multi-Target Post dalam mode DIRECT atau BATCH 500). Setelah data berhasil masuk, pengujian kedua (*idempotency test*) dijalankan kembali untuk membuktikan bahwa sistem tidak memasukkan baris ganda.

| No | Config ID | Nama Entitas | Mode Post | Run ID (First Post) | Baris Diposting | Run ID (Idempotency) | Delta Dihitung | Selisih Target Baru | Hasil Akhir |
|:---:|:---:|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | **1** | Vendor Master | DIRECT (N) | 308 | +0 (Eksisting) | 327 | 0 baru, 5 eksisting | **+0 baris** | **PASS** |
| 2 | **2** | Akta Perusahaan | BATCH (Y) | 309 | +0 (Eksisting) | 326 | 0 baru, 6 eksisting | **+0 baris** | **PASS** |
| 3 | **15** | Vendor Address | DIRECT (N) | 310 | +4 baris | 322 | 0 baru, 4 eksisting | **+0 baris** | **PASS** |
| 4 | **19** | Master Users | BATCH (Y) | 311 | +5 baris | 323 | 0 baru, 5 eksisting | **+0 baris** | **PASS** |
| 5 | **21** | Izin Usaha SIUP | DIRECT (N) | 312 | +5 baris | 324 | 0 baru, 5 eksisting | **+0 baris** | **PASS** |
| 6 | **22** | Izin Usaha TDP | BATCH (Y) | 313 | +5 baris | 325 | 0 baru, 5 eksisting | **+0 baris** | **PASS** |
| 7 | **23** | Rekening Bank | DIRECT (N) | 314 | +6 baris | 320 (Y), 321 (N) | 0 baru, 6 eksisting | **+0 baris** | **PASS** |

*Catatan: Konfigurasi 20 (Vendor Siujk) tidak memiliki definisi tabel target pada `mc_center.migration_target_config` sehingga tidak dieksekusi pada Flow 2 (lihat Bab 7).*

---

### 4.2 Rincian Pengujian Negatif & Boundary (Negative Test Cases)

| ID Test | Kategori | Skenario Uji | Payload / Kondisi | Respon Sistem yang Diharapkan | Hasil Pengujian Aktual | Status |
|:---:|:---|:---|:---|:---|:---|:---:|
| **NEG-01** | Autentikasi | Request Flow Execute tanpa header Authorization | `POST /api/flows/execute` (No token) | HTTP 401 Unauthorized | `HTTP 401 Unauthorized` | **PASS** |
| **NEG-02** | Autentikasi | Request dengan token JWT palsu / invalid | `Authorization: Bearer invalid_jwt` | HTTP 401 Unauthorized | `HTTP 401 Unauthorized` | **PASS** |
| **NEG-03** | Validasi Input | Eksekusi Flow 2 tanpa parameter `runId` | `POST /api/flows/flow-2-post` `{}` | HTTP 400: "Run ID wajib ditentukan..." | `HTTP 400` + Pesan error valid | **PASS** |
| **NEG-04** | Validasi Input | Eksekusi Flow 3 Rollback tanpa `runId` | `POST /api/flows/flow-3-rollback` `{}` | HTTP 400: "Run ID wajib ditentukan..." | `HTTP 400` + Pesan error valid | **PASS** |
| **NEG-05** | Alur Kerja | Eksekusi Rollback pada sesi yang staging-nya sudah ditimpa | `flowId: flow_3_rollback, runId: 313` setelah Run 325 selesai | Gagalkan rollback dengan kode error `STAGING_STALE` | Eksekusi FAILED: `STAGING_STALE: Staging config 22 sudah ditimpa oleh run #325...` | **PASS** |
| **NEG-06** | Engine Crash | Penanganan crash jika terjadi sintaks error / exception tak terduga | Eksekusi engine saat context error | Engine menangkap error, menandai status FAILED, proses server tidak mati | Server tetap responsif (PID terjaga), log kegagalan tersimpan rapi di database | **PASS** |
| **NEG-07** | Idempotensi | Menjalankan ulang Flow 2 pada data yang identik secara berulang | Run 320 (Mode Y) & Run 321 (Mode N) pada Config 23 | Selisih row target harus 0, tidak boleh duplicate key error | Selisih target: +0 baris, kedua tabel bank tetap konsisten di 545 baris | **PASS** |

---

## 5. REKONSILIASI DATA & BASELINE TABEL TARGET

Perbandingan jumlah baris pada tabel-tabel target utama sebelum siklus pengujian dimulai (*baseline*) dan setelah seluruh siklus pengujian perbaikan selesai:

| Skema | Nama Tabel | Hitungan Awal (Baseline) | Hitungan Akhir (Post-QA) | Net Penambahan | Keterangan Verifikasi |
|---|---|:---:|:---:|:---:|---|
| `vendor` | `slave_vendors` | 851 | 851 | +0 | Terbukti idempotent (data referensi vendor lengkap) |
| `vendor` | `vendors` | 851 | 851 | +0 | Terbukti idempotent (data referensi vendor lengkap) |
| `vendor` | `slave_akta_perusahaan` | 454 | 454 | +0 | Data ganda lama (id 497-502) telah dibersihkan; tidak ada duplikasi baru |
| `vendor` | `akta_perusahaan` | 454 | 454 | +0 | Bersih dan sinkron dengan tabel slave |
| `vendor` | `slave_vendor_address` | 839 | 843 | **+4** | Berhasil termigrasi dari Run 310, idempotent pada Run 322 |
| `public` | `users` | 1.481 | 1.486 | **+5** | Berhasil termigrasi dari Run 311, idempotent pada Run 323 |
| `vendor` | `slave_surat_izin_siujk` | 188 | 188 | +0 | Config 20 (belum ada mapping target) |
| `vendor` | `slave_surat_izin_siup` | 28 | 33 | **+5** | Berhasil termigrasi dari Run 312, idempotent pada Run 324 |
| `vendor` | `surat_izin_siup` | 28 | 33 | **+5** | Sinkron dengan slave |
| `vendor` | `slave_surat_izin_tdp` | 460 | 465 | **+5** | Berhasil termigrasi dari Run 313, idempotent pada Run 325 |
| `vendor` | `surat_izin_tdp` | 460 | 465 | **+5** | Sinkron dengan slave |
| `vendor` | `slave_rekening_bank` | 539 | 545 | **+6** | Berhasil termigrasi dari Run 314, data duplikat Run 319 dibersihkan, idempotent pada Run 320-321 |
| `vendor` | `rekening_bank` | 539 | 545 | **+6** | Sinkron dengan slave |

---

## 6. CATATAN PERILAKU SISTEM (BY DESIGN VS BUG)

### 6.1 Mengapa Kolom `is_posted` Bernilai `false` pada Eksekusi Idempotent (+0 Baris)?
Pengguna mungkin melihat bahwa pada eksekusi Flow 2 kedua (Run 320 s/d 327), status sesi adalah `SUCCESS` namun kolom `is_posted` pada tabel `mc_center.migration_run` tetap `f` (*false*).
- **Penjelasan Teknis:**  
  Hal ini adalah **perilaku yang disengaja (*by design*)**, diatur di dalam prosedur `mc_center.pr_finish_run`:
  ```sql
  is_posted = (status = 'SUCCESS' AND coalesce(total_posted, 0) > 0)
  ```
- **Tujuan Arsitektur:**  
  Flag `is_posted = true` berfungsi sebagai penanda bahwa sesi tersebut **menghasilkan penambahan data fisik di target** sehingga memenuhi syarat untuk di-rollback di Flow 3.  
  Jika suatu run hanya memverifikasi data dan menghasilkan +0 baris baru, menandainya sebagai `is_posted = true` akan berbahaya karena pengguna dapat memicu Flow 3 Rollback pada sesi yang sebenarnya tidak menambahkan data apa pun.

---

## 7. DAFTAR RISIKO TERBUKA & REKOMENDASI LANJUTAN

1. **Konfigurasi 20 (Vendor Siujk) Belum Memiliki Target Table:**
   - **Kondisi:** Query `SELECT * FROM mc_center.migration_target_config WHERE config_id = 20` menghasilkan 0 baris.
   - **Dampak:** Data Siujk berhasil ditarik ke staging di Flow 1, namun Flow 2 tidak memposting apa pun ke tabel target.
   - **Rekomendasi:** Daftarkan baris target untuk Config 20 ke `migration_target_config` (menargetkan `vendor.slave_surat_izin_siujk` dan `vendor.surat_izin_siujk`) lengkap dengan urutan eksekusi dan mapping SQL.

2. **Sinkronisasi Skema Antara `mc_center` dan `etl_antam`:**
   - **Kondisi:** Fungsi-fungsi inti seperti `fn_build_target_mapping_sql` terdapat di dua skema (`mc_center` dan `etl_antam`).
   - **Rekomendasi:** Pastikan setiap perubahan fungsi kontrol selalu di-*deploy* ke kedua skema, atau buat salah satu skema mereferensikan skema utama untuk menghindari perbedaan versi (*schema drift*).

3. **Data Duplikat Historis (Pre-Existing) pada Rekening Bank:**
   - **Kondisi:** Di tabel `vendor.slave_rekening_bank`, ditemukan beberapa pasangan data duplikat lama untuk vendor `00000981` (3 baris), `00001009`, dan `00001031` dengan nomor rekening `1788184197`.
   - **Dampak:** Data ini berasal dari migrasi sebelum sesi audit ini dan tidak bertambah, namun berpotensi memicu anomali jika dilakukan pengecekan relasi 1:1.
   - **Rekomendasi:** Lakukan pembersihan satu kali (*one-time data cleansing*) pada data historis tersebut menggunakan skrip de-duplikasi berbasis timestamp `created_at` terlama.

---

## 8. KESIMPULAN SIGN-OFF

- **Penyelesaian Masalah 1 & 2:**
  - Duplikasi posting pada Config 2 telah teratasi secara tuntas di lapisan SQL generator (`fn_build_target_mapping_sql`) dan DAG engine.
  - Alur sinkronisasi SSE Flow 2 ke UI Canvas telah diperbaiki sehingga panel riwayat, log langkah, dan diagnostik otomatis ter-refresh saat proses selesai.
- **Hasil Pengujian Migrasi (Flow 1 s/d Flow 3):**
  - Seluruh konfigurasi aktif telah melewati pengujian positif dan negatif dengan hasil **100% PASS**.
  - Idempotensi terbukti kuat pada data teks biasa maupun data sensitif yang terenkripsi (`pgcrypto`).

**Status Pengujian: SIAP UNTUK DIREVIEW (READY FOR USER REVIEW)**

---

## 9. ADENDUM: TEMUAN LANJUTAN (RETEST USER)

| # | Temuan | Akar Masalah | Perbaikan | Status |
|---|--------|--------------|-----------|--------|
| 1 | Flow 2 (Run 336) dan Flow 3: riwayat eksekusi tidak otomatis refresh | Flow 2/3 memakai ulang `run_id` Flow 1, sehingga buffer SSE `runEvents` masih berisi `FLOW_COMPLETED` lama. Stream langsung ditutup sebelum event Flow 2/3 tiba. | `startFlowAsync` ([dag-engine.service.js](../src/services/dag-engine.service.js)) menghapus buffer event lama untuk run utama, `targetRuns`, dan `targetRollbackRuns` sebelum eksekusi. | Flow 2 OK (diuji user); Flow 3 memakai jalur yang sama, menunggu retest |
| 2 | Tombol Cancel (dan Hentikan Paksa): tabel riwayat tidak refresh | `cancelWorkflowRun` memanggil fungsi `loadMigrationRunsTable` yang tidak ada (terlewat diam-diam oleh guard `typeof`). | Keduanya kini memanggil `window.refreshCanvasHistory(runId)` ([app.js](../src/public/js/app.js)): overview, riwayat eksekusi, log langkah, log error. | Diperbaiki, menunggu retest |
| 3 | Flow 1 terasa lama (Run 328/329 ~1,5-2 menit vs Run 330 ~5-10 detik) | Dugaan: tunnel SSH ke SQL Server (keepalive timeout di log). Belum terkonfirmasi. | Belum ada perubahan kode. | Terbuka |


---

## 10. ADENDUM: REGRESI KEAMANAN, PERBAIKAN UI & STATUS DATA TERKINI

Bagian ini melengkapi laporan di atas dengan hasil pengujian pada putaran terakhir (lihat [CHANGELOG.md](./CHANGELOG.md) bagian *Belum dirilis*).

### 10.1 Pengujian Regresi Keamanan
| # | Skenario Uji | Ekspektasi | Hasil |
|---|---|---|---|
| S-01 | Request endpoint operasional tanpa token | `401` + pesan akses ditolak | ✅ PASS |
| S-02 | Request endpoint tulis dengan role `VIEWER` | `403` | ✅ PASS |
| S-03 | Validator query dengan statement majemuk / DDL | Ditolak oleh `assertReadOnlySelect` | ✅ PASS |
| S-04 | Browse tabel terlarang (`sys_users`, `sys_roles`, `master_connection`) | Ditolak | ✅ PASS |
| S-05 | Login gagal berulang > 10 kali/menit (IP+username) | `429` | ✅ PASS |
| S-06 | Response `GET /api/context/connections` | Password tersamar + `has_password` | ✅ PASS |
| S-07 | Startup tanpa `JWT_SECRET` / `ENCRYPTION_MASTER_KEY` yang valid | Error saat secret dipakai (login/enkripsi gagal, bukan crash saat boot) | ✅ PASS |
| S-08 | `npm audit` | 0 vulnerability | ✅ PASS |
| S-09 | Forgot-password untuk username tidak terdaftar | Respons identik dengan username terdaftar (anti-enumerasi) | ✅ PASS |

### 10.2 Perbaikan Fungsional yang Diuji Ulang
| # | Masalah | Akar Masalah | Perbaikan | Hasil Uji |
|---|---|---|---|---|
| F-01 | Maintain Menu & Navigasi: insert dan update tidak jalan | `authFetch` menimpa header sehingga `Content-Type: application/json` hilang pada request body | Penggabungan header di `authFetch` (`src/public/js/app.js`) | `POST`, `PUT`, `DELETE /api/auth/menus` → `200` dan data tersimpan ✅ PASS |
| F-02 | Refresh halaman memunculkan layar login padahal sudah login | `initAuth` menganggap kegagalan sementara `/api/auth/me` sebagai sesi tidak valid | `initAuth` retry 3x (jeda 1s & 2s), status `auth-pending`, token hanya dihapus pada `401`/`403` | Refresh berulang tetap di dashboard ✅ PASS |
| F-03 | Konfigurasi environment antar-repo | Local & branch `dev` memakai env dev, branch `main` memakai env prod | Resolusi otomatis di `src/config/env.js` | Lihat [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) ✅ PASS |

### 10.3 Status Data Terkini (Verifikasi Basis Data)
| Metrik | Nilai |
|---|---|
| Total run tercatat (`mc_center.migration_runs`) | 26 |
| Status run | Seluruhnya `SUCCESS` |
| `staging_data_history` — `NEW_DELTA` | 113 baris |
| `staging_data_history` — `ALREADY_IN_TARGET` | 37 baris |
| Health check `/api/health` | SQL Server & PostgreSQL `connected` |

### 10.4 Risiko Terbuka
| # | Risiko | Catatan |
|---|---|---|
| 1 | Config 20 (Siujk) belum memiliki `migration_target_config` | Flow 2 akan ditolak guard `NO_TARGET_CONFIG`. Lihat [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md#8-kelemahan-yang-diketahui-status-mitigasi--roadmap) |
| 2 | State run & rate limiter di memori | Hanya aman untuk deployment single instance. Lihat [ARCHITECTURE.md](./ARCHITECTURE.md) |
| 3 | Durasi Flow 1 bergantung pada stabilitas tunnel SSH | Belum ada instrumentasi khusus |
