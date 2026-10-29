# Panduan Kontribusi MCC-PROCSI

> Terakhir diperbarui: 29 Oktober 2026

## 1. Menyiapkan Lingkungan Lokal

```bash
git clone <repo> && cd MCC-PROCSI
git checkout dev
npm ci
cp .env.example .env.development     # isi nilai nyata; JANGAN di-commit
openssl rand -hex 32                  # jalankan 2×: JWT_SECRET dan ENCRYPTION_MASTER_KEY
npm run dev                           # http://localhost:3000
```

Branch `dev` otomatis memakai `.env.development` ([ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md)). Jangan menjalankan aplikasi dari branch `main` di laptop — ia akan memuat `.env.production`.

## 2. Alur Branch

| Branch | Fungsi | Env |
|---|---|---|
| `main` | Produksi; hanya menerima merge dari `dev` yang sudah lulus uji | `.env.production` |
| `dev` | Integrasi & pengujian | `.env.development` |
| `feature/<topik>`, `fix/<topik>` | Pekerjaan individual dari `dev` | development |

Remote: `origin` (GitHub) dan `sisi` (GitLab workstation). Push ke `dev` dan `main` pada **kedua** remote bila diminta rilis.

## 3. Format Commit

[Conventional Commits](https://www.conventionalcommits.org/) berbahasa Indonesia atau Inggris, konsisten dalam satu commit:

```
feat(menu): tambah drag-reorder menu
fix(auth): jangan hapus token saat error jaringan
docs: perbarui API_SPEC
security(api): batasi endpoint /data ke SUPERADMIN
```
Tipe: `feat`, `fix`, `docs`, `refactor`, `security`, `chore`, `test`.

## 4. Konvensi Kode

- **Bahasa**: kode & identifier Inggris; pesan UI, error, dan komentar Indonesia.
- **Backend** berlapis: `routes` → `controllers` → `services`. Controller tidak berisi SQL; service tidak mengenal `req/res`.
- **SQL**: selalu terparameter (`$1, $2`) lewat `queryPostgres(sql, params)`. Identifier dinamis (nama tabel/kolom) wajib lewat `assertSafeIdentifier`; query user lewat `assertReadOnlySelect` ([sql-guard.js](../src/utils/sql-guard.js)).
- **Route baru**: wajib `requireAuth`; tambahkan `ADMIN` atau `OPERATIONS` untuk operasi tulis. Endpoint auth publik wajib rate limiter + `sqlInjectionGuard`.
- **Respons**: `{ success, data|error, message }` ([API_SPEC.md](./API_SPEC.md)). Jangan bocorkan stack trace / SQL ke klien.
- **Rahasia**: tidak boleh ada kredensial di kode, log, atau dokumen. Kredensial koneksi disimpan terenkripsi `ENC:v1:`.
- **Frontend**: panggil API hanya lewat `authFetch()`; jangan memakai `fetch` langsung untuk endpoint terproteksi. Hindari `innerHTML` dengan data tak tepercaya (escape).
- **Komentar**: hanya untuk logika yang tidak jelas dengan sendirinya.

## 5. Pengujian

Belum ada test suite otomatis; verifikasi manual terstruktur:

1. `npm run dev` lalu `curl http://localhost:3000/api/health` → `bothConnected: true`.
2. Uji endpoint yang diubah dengan `curl` + token (login via `/api/auth/captcha` → `/api/auth/login`), termasuk kasus **tanpa token (401)** dan **role tidak cukup (403)**.
3. Perubahan UI: uji di browser, termasuk **refresh halaman** (sesi harus bertahan) dan tiga role.
4. Perubahan flow/fungsi SQL: jalankan Flow 1→2→3 pada satu config di DB **dev** dan cocokkan dengan [TESTING_REPORT.md](./TESTING_REPORT.md).
5. `npm audit --omit=dev` harus 0 kerentanan.
6. Catat hasil penting di TESTING_REPORT.md.

## 6. Checklist Pull Request

- [ ] Branch berasal dari `dev`, target PR `dev`
- [ ] Tidak ada `.env*`, kredensial, atau `config/hop-configs/` di diff
- [ ] Route baru memiliki guard peran + dicantumkan di [API_SPEC.md](./API_SPEC.md)
- [ ] Perubahan skema DB dicantumkan di [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) + skrip SQL-nya
- [ ] Variabel env baru ditambahkan ke `.env.example` dan [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md)
- [ ] Keputusan desain penting dicatat di [DECISION_LOG.md](./DECISION_LOG.md)
- [ ] [CHANGELOG.md](./CHANGELOG.md) diperbarui
- [ ] Diuji manual (lihat bagian 5)

## 7. Berkas yang Tidak Boleh Dilacak Git

`.env`, `.env.*` (kecuali `.env.example`), `node_modules/`, `*.log`, `config/hop-configs/`.

## 8. Dokumentasi

Dokumentasi hidup di folder `Document/` (kecuali [README.md](../README.md) di root). Kode adalah sumber kebenaran: bila dokumen dan kode berbeda, perbaiki dokumen pada PR yang sama. Indeks: [Document/README.md](./README.md).
