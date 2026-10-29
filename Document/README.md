# Indeks Dokumentasi Proyek MCC-PROCSI

Selamat datang di direktori dokumentasi resmi **MCC-PROCSI** (*Migration Command Center - SCM Antam*). Direktori ini berisi seluruh dokumen teknis, spesifikasi, panduan operasional, dan riwayat arsitektur sistem.

Direktori ini dirancang agar mudah dipahami baik oleh **pengembang manusia (developer/DevOps/QA)** maupun oleh **AI Coding Assistant** (seperti GitHub Copilot atau Claude).

---

## 🧭 Jalur Pembacaan yang Direkomendasikan (Reading Paths)

Pilihlah alur baca sesuai dengan peran Anda:

### 1. 🤖 Jalur AI Coding Assistant / Otomasi
Jika Anda adalah AI yang baru masuk ke sesi kerja proyek ini, baca dokumen dalam urutan ini untuk memperoleh konteks paling akurat:
1. [AGENTS.md](../AGENTS.md) (ringkasan cepat di root repo)
2. [Document/AGENTS.md](./AGENTS.md) (panduan lengkap instruksi AI, aturan emas, dan daftar gotchas)
3. [Document/ARCHITECTURE.md](./ARCHITECTURE.md) (arsitektur 3-tier, struktur modul, in-memory state)
4. [Document/DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) (skema DB `mc_center`, `stg_antam`, tabel target)
5. [Document/MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md) (tahapan 4 flow DAG, guards, dan aturan mutasi)
6. [Document/API_SPEC.md](./API_SPEC.md) (88 rute API Express, RBAC guards, format respons)

### 2. 👨‍💻 Jalur Pengembang Baru (Developer Onboarding)
1. [README.md utama di root](../README.md) (instalasi lokal & on-prem)
2. [Document/ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) (resolusi `.env` otomatis berdasarkan branch & host)
3. [Document/ARCHITECTURE.md](./ARCHITECTURE.md)
4. [Document/CONTRIBUTING.md](./CONTRIBUTING.md) (konvensi kode, branching, commit, dan pengujian)
5. [Document/API_SPEC.md](./API_SPEC.md)
6. [Document/DECISION_LOG.md](./DECISION_LOG.md) (alasan di balik keputusan arsitektur)

### 3. 🚀 Jalur DevOps & System Administrator
1. [README.md utama di root](../README.md) (panduan on-prem on RHEL/Ubuntu/CentOS)
2. [Document/DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) (prosedur rilis, healthcheck, backup harian, rollback)
3. [Document/ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md)
4. [Document/security.md](./security.md) (kebijakan keamanan, RBAC, proteksi input, masking)

### 4. 🧪 Jalur QA & Security Auditor
1. [Document/TESTING_REPORT.md](./TESTING_REPORT.md) (matriks uji coba QA, regresi, pengujian negatif)
2. [Document/security.md](./security.md) (21 hasil remediasi celah keamanan dan kontrol aktif)
3. [Document/MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md) (spesifikasi guard dan pencegah duplikasi)
4. [Document/MIGRATION_FLOWS.md §8](./MIGRATION_FLOWS.md#8-kelemahan-yang-diketahui-status-mitigasi--roadmap) (matriks kelemahan Flow 1–4, status mitigasi, dan roadmap P0–P3)

### 5. 🧑‍💼 Jalur Operator & Pengguna Akhir
1. [Document/USER_GUIDE.md](./USER_GUIDE.md) (Buku Panduan Operasional Sistem / User Guide lengkap dari Menu 0 s/d 6, SOP, dan FAQ)

---

## 📚 Master Katalog Dokumen

| Dokumen | Target Pembaca | Deskripsi Singkat | Status |
| :--- | :--- | :--- | :---: |
| [AGENTS.md](./AGENTS.md) | AI Assistant, Tech Lead | Context primer untuk AI: struktur modul, golden rules, gotchas, DoD | Aktif |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | Developer, Architect | Arsitektur teknis 3-tier, diagram alir, DAG state, single instance | Aktif |
| [API_SPEC.md](./API_SPEC.md) | Developer, Frontend, QA | Spesifikasi lengkap 88 rute API Express, RBAC level, conventions | Aktif |
| [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) | Developer, DBA | Skema `mc_center`, `stg_antam`, fungsi stored proc, config aktif | Aktif |
| [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) | DevOps, Developer | Resolusi env dev/prod dinamis, katalog variabel, tips konfigurasi | Aktif |
| [DEPLOYMENT_RUNBOOK.md](./DEPLOYMENT_RUNBOOK.md) | DevOps, Sysadmin | Runbook rilis on-prem, smoke test, backup, pemulihan insiden | Aktif |
| [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md) | Developer, Data Eng, Architect | Detail teknis Flow 1–4, node sequence, guard code, alur entity baru, **matriks kelemahan & roadmap (§8)** | Aktif |
| [security.md](./security.md) | Security, Auditor, DevOps | Laporan screening keamanan, 21 remediasi aktif, kontrol RBAC & crypto | Aktif |
| [TESTING_REPORT.md](./TESTING_REPORT.md) | QA, Developer | Laporan pengujian fungsional & regresi keamanan, status data riil | Aktif |
| [USER_GUIDE.md](./USER_GUIDE.md) | Operator, Admin, User | User Guide aplikasi web (Menu 0 s/d 6, Canvas, SOP, FAQ) | Aktif (v2.6) |
| [DECISION_LOG.md](./DECISION_LOG.md) | Tim Pengembang | Catatan Keputusan Arsitektur (ADR) DL-01 s/d DL-18 + template baru | Aktif |
| [CONTRIBUTING.md](./CONTRIBUTING.md) | Developer, Kontributor | Panduan kontribusi, alur branching dev/main, format commit, PR | Aktif |
| [CHANGELOG.md](./CHANGELOG.md) | Seluruh Tim | Riwayat perubahan sistem dari v1.0.0 s/d rilis terkini | Aktif |

---

## 🔄 Aturan Pemeliharaan Dokumen (Kapan Harus Update?)

Untuk menjaga dokumen tetap sinkron dengan kode sumber, ikuti panduan berikut saat melakukan perubahan kode:

| Jenis Perubahan Kode | Dokumen yang Wajib Diperbarui |
| :--- | :--- |
| **Menambah / mengubah rute API** (`src/routes/api.js`) | [API_SPEC.md](./API_SPEC.md) & [AGENTS.md](./AGENTS.md) |
| **Menambah / mengubah tabel atau kolom DB** (`mc_center` / `stg_antam`) | [DATABASE_SCHEMA.md](./DATABASE_SCHEMA.md) |
| **Menambah / mengubah variabel environment** | [ENVIRONMENT_CONFIG.md](./ENVIRONMENT_CONFIG.md) & [.env.example](../.env.example) |
| **Mengubah langkah/logika DAG Flow 1–4** | [MIGRATION_FLOWS.md](./MIGRATION_FLOWS.md) & [ARCHITECTURE.md](./ARCHITECTURE.md) |
| **Memperbaiki celah keamanan / otorisasi** | [security.md](./security.md) & [TESTING_REPORT.md](./TESTING_REPORT.md) |
| **Membuat keputusan arsitektural penting** | [DECISION_LOG.md](./DECISION_LOG.md) (tambahkan record `DL-XX`) |
| **Merilis fitur baru / bugfix penting** | [CHANGELOG.md](./CHANGELOG.md) (di bawah judul *[Belum dirilis]* atau nomor rilis baru) |
| **Mengubah antarmuka / workflow pengguna** | [USER_GUIDE.md](./USER_GUIDE.md) |
| **Menutup / menemukan kelemahan Flow 1–4** | Ubah status di [MIGRATION_FLOWS.md §8](./MIGRATION_FLOWS.md#8-kelemahan-yang-diketahui-status-mitigasi--roadmap) |

> **Prinsip satu sumber fakta:** setiap topik hanya ditulis di satu dokumen, dokumen lain cukup menautkan. Rate limit/RBAC → `security.md`; guard & kelemahan flow → `MIGRATION_FLOWS.md`; rute → `API_SPEC.md`; langkah operator → `USER_GUIDE.md`.

---

## 🔗 Referensi Cepat
- Dokumen Root: [README.md](../README.md) · [AGENTS.md](../AGENTS.md) · [.env.example](../.env.example)
- Repositori: `achnurdin06/mig-antam` (GitHub) & `migrasi-dashboard-antam` (GitLab SISI Workstation)
- Kontak & Penanggung Jawab: Tim Pengembang MCC-PROCSI / PT ANTAM Tbk
