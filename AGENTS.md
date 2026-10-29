# AGENTS.md

Panduan lengkap untuk AI assistant ada di [Document/AGENTS.md](Document/AGENTS.md). Baca itu terlebih dahulu, lalu indeks dokumen di [Document/README.md](Document/README.md).

Ringkas: Node.js/Express 5 + vanilla JS, migrasi multi-database → PostgreSQL (driver aktif: SQL Server & PostgreSQL). Jalankan `npm run dev`. SQL wajib terparameter, endpoint wajib `requireAuth` + `ADMIN`/`OPERATIONS`, frontend hanya via `authFetch()`, jangan commit `.env*`, jangan sentuh DB produksi tanpa instruksi.
