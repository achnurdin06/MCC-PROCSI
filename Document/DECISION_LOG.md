# Catatan Keputusan Desain (Decision Log)

> Tujuan: menjelaskan **mengapa** sistem dibuat seperti ini agar developer maupun AI tidak "memperbaiki" hal yang disengaja. Tambahkan entri baru di bagian bawah; jangan hapus entri lama — tandai *Digantikan oleh DL-xx*.

Format: **Konteks → Keputusan → Konsekuensi**.

---

### DL-01 — Monolit Express + frontend vanilla JS
- **Konteks**: Tim kecil, deployment on-prem, tanpa pipeline build frontend.
- **Keputusan**: Satu proses Node.js menyajikan API dan berkas statis (`src/public`).
- **Konsekuensi**: Deploy sederhana (`git pull` + restart). `app.js` frontend besar (>8000 baris); modularisasi menjadi utang teknis.

### DL-02 — Skema kontrol `mc_center` di PostgreSQL, logika ETL berat di fungsi SQL
- **Konteks**: Data staging dan target ada di PostgreSQL yang sama; memindahkan jutaan baris lewat Node lambat.
- **Keputusan**: Delta, konversi, posting, rollback, purge diimplementasikan sebagai `mc_center.fn_*`/`pr_*`; Node hanya mengorkestrasi (DAG engine) dan melakukan ingest source → staging.
- **Konsekuensi**: Cepat dan transaksional, tetapi perubahan logika = perubahan DDL yang harus dicatat dan diterapkan manual ke produksi ([DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md#8-perubahan-skema)).

### DL-03 — Tanpa foreign key formal di `mc_center`
- **Konteks**: Skema berkembang bertahap bersama alur ETL; `migration_run.config_id` bertipe TEXT berisi daftar `"1,2,3"`.
- **Keputusan**: Integritas dijaga aplikasi/fungsi, bukan constraint.
- **Konsekuensi**: Hapus data master dengan hati-hati; pertimbangkan normalisasi `run ↔ config` di masa depan.

### DL-04 — Pipeline 3-tier (Source → Staging → Target)
- **Konteks**: Perlu bukti audit di tiap tahap dan kemampuan rollback.
- **Keputusan**: Data tidak pernah langsung dari source ke target; staging menyimpan riwayat (`staging_data_history`).
- **Konsekuensi**: Berita acara dapat membandingkan 3 titik; disk staging bertambah (purge terjadwal bila perlu).

### DL-05 — Eksekusi flow asynchronous + SSE
- **Konteks**: Migrasi berjalan menit–jam; HTTP request tidak boleh menggantung.
- **Keputusan**: `POST /flows/execute` langsung mengembalikan `runId`; progres lewat Server-Sent Events.
- **Konsekuensi**: Status run/SSE di memori → **hanya 1 instance** proses; Nginx wajib `proxy_buffering off`; token boleh lewat `?token=` **hanya** untuk endpoint stream (EventSource tak bisa kirim header).

### DL-06 — Guard idempotensi: satu run hanya sekali Post / Rollback
- **Konteks**: Posting ganda menduplikasi data di sistem produksi.
- **Keputusan**: `fn_validate_post_run`/`fn_validate_rollback_run` menolak `ALREADY_POSTED`, `ALREADY_ROLLED_BACK`, `NOT_POSTED_YET`.
- **Konsekuensi**: Untuk mengulang, jalankan Flow 1 baru (inkremental via delta) — jangan mengakali flag `is_posted`.

### DL-07 — Flow 1 boleh diulang (incremental delta)
- **Konteks**: Source berubah antar hari; operator perlu menarik ulang.
- **Keputusan**: Guard Flow 1 dibuka; delta (`NEW_DELTA` vs `ALREADY_IN_TARGET`) memakai `business_keys`.
- **Konsekuensi**: `business_keys`/`pk_columns` wajib benar; duplikat key di staging menggagalkan run (fail-fast) agar tidak terjadi posting ambigu.

### DL-08 — Enkripsi kolom sensitif di staging
- **Keputusan**: `fn_encrypt_staging`/`fn_decrypt_staging`; perbandingan delta kolom sensitif lewat dekripsi.
- **Konsekuensi**: Kolom `password`, `nik`, `current_token`, `nomor_rekening`, `swift_number`, `no_ktp_pic` tidak plaintext di staging.

### DL-09 — Kredensial koneksi dienkripsi AES-256-GCM (`ENC:v1:`)
- **Keputusan**: Password `master_connection` dienkripsi dengan `ENCRYPTION_MASTER_KEY` (tanpa fallback); respons API menyamarkan nilainya; dekripsi hanya saat membuka koneksi. Format berversi (`v1`) agar skema dapat diganti.
- **Konsekuensi**: Kehilangan kunci = kredensial harus diinput ulang. Kunci dibackup terpisah.

### DL-10 — JWT buatan sendiri (HS256) + validasi DB tiap request
- **Konteks**: Dependensi minimal.
- **Keputusan**: Implementasi `jwt.js` (HS256 saja, tolak `alg` lain, exp 8 jam). `requireAuth` mengecek `is_active` dan role terbaru di DB.
- **Konsekuensi**: Menonaktifkan akun/mengubah role berlaku seketika; biaya satu query ringan per request. Jika DB transien gagal, request tetap lanjut dengan payload token (ketersediaan > ketatnya pengecekan, dicatat sebagai risiko diterima).

### DL-11 — RBAC dua tingkat di server (`ADMIN`, `OPERATIONS`) + matriks menu
- **Keputusan**: Penegakan hak akses di route (`requireRole`), bukan hanya menyembunyikan menu di UI. `sys_role_menus` mengatur menu yang tampil; peran inti: SUPERADMIN, OPERATOR, VIEWER.
- **Konsekuensi**: Role kustom baru hanya mengatur tampilan menu; hak tulis tetap ditentukan `role_code` di route.

### DL-12 — Pendaftaran mandiri → akun nonaktif, role VIEWER
- **Keputusan**: Admin harus menyetujui (mengaktifkan). Forgot-password selalu memberi respons generik (anti-enumerasi).

### DL-13 — Env otomatis berdasar branch git
- **Konteks**: Developer sering salah memakai DB produksi dari laptop.
- **Keputusan**: `main`-family → `.env.production`; lainnya → `.env.development`; `NODE_ENV` eksplisit menang ([ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md)).
- **Konsekuensi**: Checkout `main` di laptop akan memuat env produksi — hindari.

### DL-14 — Validasi SQL: allowlist, bukan sanitasi
- **Keputusan**: Query user hanya `SELECT/WITH` (`assertReadOnlySelect`), identifier dinamis lewat `assertSafeIdentifier`, tabel sensitif (`sys_users`, `sys_roles`, `master_connection`) diblokir dari browse. `sqlInjectionGuard` pada endpoint auth hanyalah lapisan tambahan; pertahanan utama tetap query terparameter.

### DL-15 — `authFetch` menambahkan `Content-Type: application/json` otomatis
- **Konteks**: Bug menu CRUD — body string dikirim tanpa Content-Type sehingga `express.json()` tidak mem-parse dan insert/update gagal.
- **Keputusan**: Jika `body` string dan header belum ada, set otomatis. Jangan mengirim `FormData` lewat string body.

### DL-16 — Pemulihan sesi saat refresh dengan retry, token dihapus hanya saat 401/403
- **Konteks**: Refresh menampilkan login walau token valid (error sementara DB/jaringan menghapus token).
- **Keputusan**: `initAuth()` retry 3× (jeda 1s, 2s); token dibuang hanya bila server menolak; kelas `auth-pending` pada `<html>` menyembunyikan layar login selama pengecekan.

### DL-17 — Hanya satu client/env aktif per konteks UI; koneksi per environment
- **Keputusan**: Source/target diambil dari `master_connection` sesuai client+env terpilih; variabel `MSSQL_*` hanya fallback.

### DL-18 — Berkas tak terpakai dipindah ke `backup/`, bukan dihapus
- **Keputusan**: Skrip sekali pakai (`scratch/*`) disimpan di `backup/scratch/` sebagai referensi DDL historis. Aman dihapus setelah rilis stabil.

---

## Template Entri Baru

```
### DL-xx — Judul singkat
- **Konteks**: masalah/batasan yang ada
- **Keputusan**: apa yang dipilih (dan alternatif yang ditolak)
- **Konsekuensi**: dampak, risiko, utang teknis
```
