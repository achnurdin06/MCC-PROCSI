/* MCC Operational Helpdesk Bot - rule-based, fully client-side (no external API). */
(function () {
  'use strict';

  const STORAGE_KEY = 'mcc_helpdesk_history_v1';
  const MAX_HISTORY = 40;
  const OPS_ROLES = ['OPERATOR', 'SUPERADMIN'];

  // ---------------------------------------------------------------------
  // Knowledge base: keywords are matched against the normalized user query.
  // actions: [{ label, type: 'tab' | 'health' | 'ask', value }]
  // ---------------------------------------------------------------------
  const KB = [
    {
      id: 'timeout',
      title: 'Connection timeout / koneksi database',
      keywords: ['timeout', 'time out', 'connection terminated', 'koneksi', 'tidak bisa konek', 'ssh', 'tunnel', 'unreachable', 'econnrefused', 'etimedout', 'econnreset', 'database down', 'lambat'],
      answer: [
        '**Connection terminated due to connection timeout** artinya server aplikasi gagal menjangkau database (sumber MSSQL atau target PostgreSQL) dalam batas waktu.',
        '',
        'Langkah penanganan:',
        '1. Klik **Cek Kesehatan Sistem** di bawah untuk melihat database mana yang terputus.',
        '2. Pastikan VPN / jaringan kantor aktif dan host database dapat dijangkau.',
        '3. Jika koneksi melalui **SSH Tunnel**, pastikan kredensial dan port SSH di file `.env` benar, lalu restart aplikasi.',
        '4. Periksa firewall / port database (MSSQL 1433, PostgreSQL 5432/5433).',
        '5. Jika masih gagal, hubungi DBA / admin infrastruktur dengan menyertakan waktu kejadian dan pesan error.'
      ].join('\n'),
      actions: [{ label: 'Cek Kesehatan Sistem', type: 'health' }]
    },
    {
      id: 'login',
      title: 'Login, captcha & akun',
      keywords: ['login', 'masuk', 'captcha', 'kode', 'password', 'kata sandi', 'lupa', 'terkunci', 'akun', 'username', 'daftar', 'register', 'belum aktif', 'sesi', 'session', 'token', '401'],
      answer: [
        'Kendala login yang umum:',
        '- **Captcha salah / kedaluwarsa**: klik tombol ↻ untuk memuat ulang, lalu isi kode yang baru.',
        '- **Username atau kata sandi salah**: periksa huruf besar/kecil. Gunakan **Lupa kata sandi?** untuk mengatur ulang.',
        '- **Akun baru belum bisa masuk**: akun hasil registrasi perlu diaktifkan oleh Superadmin di menu *System Administration > User Management*.',
        '- **Sesi berakhir (401)**: login ulang, token sesi sudah tidak berlaku.',
        '',
        'Bila tetap gagal, minta Superadmin memeriksa status aktif akun Anda.'
      ].join('\n'),
      actions: [{ label: 'Buka System Administration', type: 'tab', value: 'tab-system' }]
    },
    {
      id: 'rbac',
      title: 'Hak akses & menu tidak muncul',
      keywords: ['menu tidak muncul', 'hak akses', 'akses', 'role', 'permission', 'rbac', 'operator', 'auditor', 'superadmin', 'tidak ada tombol', 'tombol hilang', 'forbidden', '403', 'izin', 'matrix'],
      answer: [
        'Menu dan tombol aksi ditentukan oleh **role** dan **Menu Matrix** (View / Create / Update / Delete).',
        '',
        '1. Menu tidak tampil → role Anda belum memiliki izin **View** pada menu tersebut.',
        '2. Tombol tambah/ubah/hapus tidak ada → izin **Create/Update/Delete** belum diberikan.',
        '3. Superadmin dapat mengatur izin pada *System Administration > Menu Matrix* lalu klik **Simpan Matriks**.',
        '4. Setelah izin diubah, pengguna terkait perlu **logout lalu login ulang**.',
        '',
        'Penugasan **Client & Environment** juga memengaruhi data yang bisa Anda lihat.'
      ].join('\n'),
      actions: [{ label: 'Buka System Administration', type: 'tab', value: 'tab-system' }]
    },
    {
      id: 'flow',
      title: 'Menjalankan alur migrasi (Flow 1-4)',
      keywords: ['flow', 'alur', 'jalankan', 'eksekusi', 'run', 'migrasi', 'staging', 'posting', 'pipeline', 'delta', 'new_delta', 'already_in_target', 'kosong'],
      answer: [
        'Urutan migrasi di Workflow Studio:',
        '1. **Flow 1 - Staging**: menarik data dari sumber ke tabel staging dan menandai baris `NEW_DELTA` atau `ALREADY_IN_TARGET`.',
        '2. **Review**: cek jumlah baris dan history per *Run ID* di menu Hasil Migrasi.',
        '3. **Flow 2 - Post**: memindahkan baris `NEW_DELTA` ke tabel target PostgreSQL.',
        '4. **Flow 3 - Rollback**: membatalkan data yang sudah diposting oleh suatu run.',
        '5. **Flow 4 - Purge**: menghapus data hasil migrasi di target (destruktif, jalankan Preview dulu).',
        '',
        'Staging kosong biasanya karena: source view tidak mengembalikan baris, semua data sudah ada di target (`ALREADY_IN_TARGET`), atau *precheck SQL* gagal. Periksa konfigurasi di Migration Config.'
      ].join('\n'),
      actions: [
        { label: 'Buka Workflow Studio', type: 'tab', value: 'tab-canvas' },
        { label: 'Buka Hasil Migrasi', type: 'tab', value: 'tab-pipeline' }
      ]
    },
    {
      id: 'config',
      title: 'Migration Config',
      keywords: ['config', 'konfigurasi', 'mapping', 'pk', 'primary key', 'compare columns', 'seed', 'precheck', 'staging table', 'target table', 'source view', 'import', 'export', 'json'],
      answer: [
        'Panduan mengisi **Migration Config**:',
        '- **Source View**: view/tabel sumber yang akan ditarik.',
        '- **Staging Table** dan **Target Table**: tabel penampung dan tabel tujuan di PostgreSQL.',
        '- **PK Columns**: kolom kunci unik, dipisahkan koma. Salah PK akan membuat deteksi delta tidak akurat.',
        '- **Compare Columns**: kolom yang dibandingkan untuk mendeteksi perubahan data.',
        '- **Seed / ID Column & Width**: pengaturan pembangkit ID bila tabel target membutuhkannya.',
        '- **Precheck SQL**: query validasi sebelum eksekusi, harus mengembalikan hasil yang valid.',
        '',
        'Gunakan **Export/Import** JSON untuk memindahkan konfigurasi antar environment.'
      ].join('\n'),
      actions: [{ label: 'Buka Migration Config', type: 'tab', value: 'tab-config' }]
    },
    {
      id: 'recon',
      title: 'Rekonsiliasi & Berita Acara',
      keywords: ['rekonsiliasi', 'berita acara', 'ba', 'cetak', 'pdf', 'compare', 'tidak sesuai', 'selisih', 'jumlah baris', 'mismatch', 'warning', 'audit', 'history', 'run id'],
      answer: [
        'Di menu **Hasil Migrasi**:',
        '- **History**: riwayat staging per *Run ID* (jumlah NEW_DELTA, ALREADY_IN_TARGET, status posting/rollback).',
        '- **Compare**: membandingkan skema kolom dan jumlah baris sumber, staging, dan target.',
        '- **Cetak Berita Acara**: menghasilkan dokumen BA rekonsiliasi (cetak atau simpan sebagai PDF).',
        '',
        'Jika jumlah baris tidak sesuai:',
        '1. Pastikan Flow 2 (Posting) sudah dijalankan untuk Run ID tersebut.',
        '2. Periksa baris yang masih berstatus `NEW_DELTA` atau gagal posting pada History.',
        '3. Pastikan PK Columns dan Compare Columns pada konfigurasi sudah benar.'
      ].join('\n'),
      actions: [{ label: 'Buka Hasil Migrasi', type: 'tab', value: 'tab-pipeline' }]
    },
    {
      id: 'errors',
      title: 'Kode error umum',
      keywords: ['error', 'gagal', '400', '500', 'bad request', 'duplicate', 'unique', 'constraint', 'violation', 'internal server', 'failed', 'exception', 'tidak berhasil'],
      answer: [
        'Penjelasan error yang sering muncul:',
        '- **400 Bad Request**: input tidak lengkap/tidak valid (mis. captcha salah, field wajib kosong).',
        '- **401 Unauthorized**: sesi habis, login ulang.',
        '- **403 Forbidden**: role tidak memiliki izin untuk aksi tersebut.',
        '- **500 Internal Server Error**: kesalahan di server/database. Cek **Health API**, lalu laporkan ke admin beserta waktu kejadian.',
        '- **Unique / duplicate key violation**: data dengan kunci yang sama sudah ada di target. Periksa PK Columns dan status `ALREADY_IN_TARGET`.',
        '',
        'Sebutkan pesan error lengkapnya pada chat ini agar saya bisa bantu lebih spesifik.'
      ].join('\n'),
      actions: [{ label: 'Cek Kesehatan Sistem', type: 'health' }]
    },
    {
      id: 'tour',
      title: 'Tur / Tour panduan aplikasi',
      keywords: ['tour', 'tur', 'tutorial', 'panduan', 'mulai', 'start', 'baru', 'intro', 'pertama'],
      answer: [
        'Klik tombol **🧭 Tour** di header untuk membuka tur interaktif berisi:',
        '',
        '1. **Pengenalan**: aplikasi, alur 4 tahap, pilih Client/Env.',
        '2. **Source Data**: melihat SQL Server view dan jumlah baris.',
        '3. **Migration Config**: atur mapping, aturan, target, lookup.',
        '4. **Workflow Canvas**: susun DAG dan jalankan migrasi (Anda tekan sendiri).',
        '5. **Hasil Migrasi**: rekonsiliasi 3-tier dan cetak Berita Acara.',
        '6. **Pengaturan Sistem**: kelola user, role, hak akses menu.',
        '',
        'Tur hanya berisi penjelasan dan **tidak menjalankan proses apa pun**. Dapat diulang kapan saja lewat tombol Tour di header.'
      ].join('\n'),
      actions: [{ label: 'Buka Tour Sekarang', type: 'tour' }]
    },
    {
      id: 'guide',
      title: 'Panduan pengguna',
      keywords: ['panduan', 'userguide', 'user guide', 'tutorial', 'cara', 'bantuan', 'help', 'sop', 'dokumen', 'dokumentasi', 'faq'],
      answer: [
        'Panduan lengkap tersedia di menu **Userguide** (Bab 1-10, termasuk SOP & Troubleshooting).',
        '',
        'Anda juga bisa bertanya langsung di sini, contoh:',
        '- "Cara menjalankan flow 1 dan 2"',
        '- "Kenapa menu saya tidak muncul?"',
        '- "Cara cetak berita acara"'
      ].join('\n'),
      actions: [{ label: 'Buka Userguide', type: 'tab', value: 'tab-userguide' }]
    },
    {
      id: 'source',
      title: 'Source Data Catalogue',
      keywords: ['source', 'sumber', 'katalog', 'catalogue', 'view', 'sql server', 'mssql', 'tabel sumber', 'data sumber'],
      answer: [
        '**Source Data Catalogue** menampilkan daftar view/tabel pada database sumber beserta struktur kolomnya.',
        '',
        'Jika daftar kosong atau gagal dimuat:',
        '1. Cek koneksi sumber lewat **Cek Kesehatan Sistem**.',
        '2. Pastikan Client & Environment yang dipilih sudah benar.',
        '3. Pastikan akun database sumber memiliki hak baca pada view terkait.'
      ].join('\n'),
      actions: [
        { label: 'Buka Source Catalogue', type: 'tab', value: 'tab-source' },
        { label: 'Cek Kesehatan Sistem', type: 'health' }
      ]
    },

    // ---------------- Materi khusus role OPERATOR ----------------
    {
      id: 'op-sop',
      roles: OPS_ROLES,
      title: 'Operator: SOP migrasi end-to-end',
      keywords: ['sop operator', 'sop', 'tugas operator', 'langkah operator', 'alur kerja operator', 'prosedur', 'standar operasional', 'mulai dari mana', 'urutan kerja', 'checklist harian'],
      answer: [
        '**SOP Operator** - ikuti urutan baku berikut:',
        '1. **Persiapan**: klik *Cek Kesehatan Sistem* (🩺), pastikan sumber & target terhubung dan Client/Env yang dipilih benar.',
        '2. **Inspeksi Source**: buka *Source Data*, pastikan view sumber terbaca.',
        '3. **Verifikasi Config**: buka *Migration Config*, periksa pemetaan, PK/Business Key dan `exec_order` (tabel induk lebih kecil dari tabel anak).',
        '4. **Flow 1 (Staging)**: jalankan di Workflow Studio sampai status **SUCCESS**.',
        '5. **Audit Staging**: di *Hasil Migrasi* pastikan jumlah baris dan status delta masuk akal.',
        '6. **Flow 2 (Post)**: jalankan untuk Run ID terbaru.',
        '7. **Rekonsiliasi**: periksa *Compare* sampai sumber = staging = target (100% Match).',
        '8. **Berita Acara**: cetak BA sebagai bukti serah-terima.',
        '',
        'Tanyakan "hak operator" untuk melihat apa yang boleh dan tidak boleh Anda lakukan.'
      ].join('\n'),
      actions: [
        { label: 'Buka Workflow Studio', type: 'tab', value: 'tab-canvas' },
        { label: 'Cek Kesehatan Sistem', type: 'health' },
        { label: 'Hak & batas operator', type: 'ask', value: 'hak operator' }
      ]
    },
    {
      id: 'op-permission',
      roles: OPS_ROLES,
      title: 'Operator: hak akses & batasannya',
      keywords: ['hak operator', 'batas operator', 'wewenang operator', 'operator boleh', 'tidak boleh dilakukan', 'tombol import tidak ada', 'tidak bisa import', 'tidak bisa tambah koneksi', 'minta superadmin', 'hanya superadmin', 'akses ditolak operator'],
      answer: [
        '**Yang boleh dilakukan Operator:**',
        '- Menjalankan **Flow 1-4** (Staging, Post, Rollback, Purge) dan membatalkan / force-stop run yang berjalan.',
        '- Menambah, mengubah dan menghapus baris **Migration Config** (termasuk memuat *defaults*).',
        '- Melihat Source Catalogue, Hasil Migrasi, Compare/rekonsiliasi dan mencetak **Berita Acara**.',
        '',
        '**Hanya Superadmin (minta bantuan jika dibutuhkan):**',
        '- Import konfigurasi JSON dan uji *precheck SQL* dari Migration Config.',
        '- Membuat/mengubah/menghapus View sumber dan sinkronisasi view.',
        '- Mengelola Client, Environment, Master Connection dan SSH Hop.',
        '- Mengelola User, Role dan Menu Matrix.',
        '',
        'Respon **403 Forbidden** pada aksi di atas artinya memang di luar wewenang role Operator, bukan kerusakan aplikasi.'
      ].join('\n'),
      actions: [{ label: 'Buka Migration Config', type: 'tab', value: 'tab-config' }]
    },
    {
      id: 'op-flow1',
      roles: OPS_ROLES,
      title: 'Operator: Flow 1 Staging gagal / bermasalah',
      keywords: ['flow 1 gagal', 'staging gagal', 'duplicate source key', 'duplikat key', 'missing business keys', 'business key', 'partial success', 'fail all', 'allow partial', 'precheck source', 'staging kosong', 'run kadaluarsa', 'superseded'],
      answer: [
        '**Troubleshooting Flow 1 (Staging):**',
        '- `DUPLICATE_SOURCE_KEY`: ada key ganda di data sumber. Run GAGAL; contoh key tampil di pesan dan baris tercatat di *Log Galat*. Bersihkan data sumber atau perbaiki *Business Keys* di config, lalu jalankan ulang.',
        '- `MISSING_BUSINESS_KEYS`: config belum punya `business_keys` / `pk_columns`. Lengkapi di *Migration Config*.',
        '- Status **PARTIAL_SUCCESS**: kebijakan `ALLOW_PARTIAL` mencatat baris error dan melanjutkan sisanya. Periksa *Log Galat* sebelum lanjut ke Flow 2.',
        '- Status **FAILED**: kebijakan `FAIL_ALL` - satu baris error menggagalkan config tersebut. Perbaiki penyebabnya lalu ulangi Flow 1.',
        '- Staging kosong: view sumber tidak mengembalikan baris, atau semua baris sudah `ALREADY_IN_TARGET`.',
        '- Run lama bertanda **KADALUARSA (SUPERSEDED)**: Flow 1 sudah dijalankan ulang untuk config yang sama, gunakan Run ID paling baru.',
        '',
        'Flow 1 aman dijalankan ulang; riwayat staging sebelumnya menjadi acuan deteksi delta.'
      ].join('\n'),
      actions: [
        { label: 'Buka Workflow Studio', type: 'tab', value: 'tab-canvas' },
        { label: 'Buka Migration Config', type: 'tab', value: 'tab-config' }
      ]
    },
    {
      id: 'op-flow2',
      roles: OPS_ROLES,
      title: 'Operator: Flow 2 Post ditolak / error',
      keywords: ['flow 2 gagal', 'flow 2 ditolak', 'post ditolak', 'already posted', 'sudah diposting', 'already rolled back', 'belum berstatus success', 'run id belum success', 'foreign key', 'fk violation', 'exec order', 'exec_order', 'batch size', 'use batch', 'posting ganda'],
      answer: [
        '**Troubleshooting Flow 2 (Post):**',
        '- *"Run ID belum berstatus SUCCESS"*: Flow 2 hanya menerima run Flow 1 yang sukses penuh. Perbaiki error di Log Galat dan ulangi Flow 1.',
        '- `ALREADY_POSTED`: run itu sudah pernah diposting (mencegah data ganda). Tidak perlu diulang.',
        '- `ALREADY_ROLLED_BACK`: run yang sudah di-rollback tidak bisa diposting lagi. Mulai siklus baru dari Flow 1.',
        '- **Foreign Key violation**: urutan `exec_order` salah. Pastikan tabel induk (master) bernilai lebih kecil daripada tabel anak, posting induk dulu.',
        '- Lambat / timeout pada data besar: gunakan `useBatch = Y` dan turunkan `batchSize` (default 1000).',
        '',
        '**Sebelum Post**, pastikan hasil rekonsiliasi sudah direview. Satu run = satu keputusan: Post **atau** Rollback.'
      ].join('\n'),
      actions: [
        { label: 'Buka Workflow Studio', type: 'tab', value: 'tab-canvas' },
        { label: 'Buka Hasil Migrasi', type: 'tab', value: 'tab-pipeline' }
      ]
    },
    {
      id: 'op-rollback',
      roles: OPS_ROLES,
      title: 'Operator: Flow 3 Rollback',
      keywords: ['rollback', 'flow 3', 'batalkan posting', 'batalkan migrasi', 'not posted yet', 'belum diposting', 'salah posting', 'tarik data kembali'],
      answer: [
        '**Flow 3 - Rollback** membatalkan data yang sudah diposting oleh suatu Run ID.',
        '1. Pilih Run ID Flow 1 yang **sudah diposting** (Flow 2 sukses).',
        '2. Jalankan Flow 3 di Workflow Studio.',
        '3. Verifikasi di *Hasil Migrasi* bahwa data target berkurang sesuai dugaan.',
        '',
        'Penolakan umum:',
        '- `NOT_POSTED_YET`: run belum pernah diposting, tidak ada yang bisa di-rollback.',
        '- `ALREADY_ROLLED_BACK`: rollback ulang ditolak.',
        '',
        'Setelah rollback, run tersebut **tidak bisa diposting lagi**. Untuk mencoba kembali, jalankan Flow 1 baru.'
      ].join('\n'),
      actions: [{ label: 'Buka Workflow Studio', type: 'tab', value: 'tab-canvas' }]
    },
    {
      id: 'op-purge',
      roles: OPS_ROLES,
      title: 'Operator: Flow 4 Purge (hati-hati)',
      keywords: ['purge', 'flow 4', 'hapus data migrasi', 'bersihkan target', 'purge preview', 'not migration data', 'id not found', 'no target config', 'delete ids', 'ulang dari awal'],
      answer: [
        '**Flow 4 - Purge** menghapus data hasil migrasi di tabel target (mis. mengulang dari awal di dev/UAT).',
        '1. **Selalu klik Preview dulu** - tidak menghapus apa pun, hanya menampilkan data yang akan terhapus.',
        '2. Kosongkan `deleteIds` untuk semua data migrasi pada config, atau isi ID spesifik untuk purge terarah.',
        '3. Jalankan Purge, lalu verifikasi di *Hasil Migrasi*.',
        '',
        'Perlindungan *Dual-Guard*: hanya baris bertanda migrasi (`migration = 1/Y`) atau tercatat di riwayat staging yang dihapus; data operasional asli tidak tersentuh.',
        '- `NOT_MIGRATION_DATA`: ada baris bukan hasil migrasi, penghapusan dibatalkan.',
        '- `ID_NOT_FOUND`: ID yang diminta tidak ada.',
        '- `NO_TARGET_CONFIG`: config belum punya target aktif.',
        '',
        '**Jangan jalankan di produksi** tanpa persetujuan tertulis dan backup.'
      ].join('\n'),
      actions: [{ label: 'Buka Workflow Studio', type: 'tab', value: 'tab-canvas' }]
    },
    {
      id: 'op-run-control',
      roles: OPS_ROLES,
      title: 'Operator: run macet / batalkan eksekusi',
      keywords: ['run macet', 'flow macet', 'hang', 'stuck', 'batalkan run', 'cancel run', 'force stop', 'stop eksekusi', 'berhenti', 'tidak selesai', 'sse', 'log tidak muncul', 'terminal kosong'],
      answer: [
        'Jika eksekusi flow terasa macet:',
        '1. Buka tab **Terminal Output** dan **Log Galat** di panel bawah Workflow Studio untuk melihat node terakhir yang berjalan.',
        '2. Klik **Cek Kesehatan Sistem** - koneksi yang putus sering menjadi penyebab.',
        '3. Gunakan tombol **Batalkan (Cancel)** untuk menghentikan run secara normal.',
        '4. Jika tetap tidak merespons, gunakan **Force Stop**, lalu jalankan ulang flow.',
        '5. Log live tidak tampil? Muat ulang halaman; aliran log (SSE) akan tersambung kembali dengan sesi login yang sama.',
        '',
        'Koneksi SSH Tunnel yang terputus akan tersambung kembali otomatis (*auto-healing*), tidak perlu restart server.'
      ].join('\n'),
      actions: [
        { label: 'Buka Workflow Studio', type: 'tab', value: 'tab-canvas' },
        { label: 'Cek Kesehatan Sistem', type: 'health' }
      ]
    },
    {
      id: 'op-escalate',
      roles: OPS_ROLES,
      title: 'Operator: kapan harus eskalasi',
      keywords: ['eskalasi', 'lapor ke siapa', 'hubungi siapa', 'minta bantuan', 'tidak bisa diselesaikan', 'melapor', 'tiket', 'laporan insiden'],
      answer: [
        '**Eskalasi** bila masalah tidak selesai dengan langkah di Helpdesk:',
        '- Kendala koneksi / jaringan / SSH / firewall → **DBA atau admin infrastruktur**.',
        '- Butuh izin, user, Client/Env, koneksi, import config atau pembuatan View → **Superadmin**.',
        '- Error data atau logika mapping yang berulang → **Tim pengembang ETL**.',
        '',
        '**Sertakan dalam laporan:**',
        '1. Waktu kejadian, Client dan Environment.',
        '2. Flow dan **Run ID** terkait.',
        '3. Pesan error lengkap (salin dari Log Galat) serta tangkapan layar.',
        '4. Langkah yang sudah dicoba dan hasil *Cek Kesehatan Sistem*.'
      ].join('\n'),
      actions: [{ label: 'Cek Kesehatan Sistem', type: 'health' }]
    }
  ];

  const SUGGESTIONS = [
    { label: '🔴 Connection timeout', q: 'Mengapa muncul Connection terminated due to connection timeout?' },
    { label: '⚙️ Jalankan Flow 1 & 2', q: 'Cara menjalankan Flow 1 dan Flow 2' },
    { label: '⚖️ Data tidak sesuai', q: 'Jumlah data sumber dan target tidak sesuai' },
    { label: '🛡️ Lupa password', q: 'Lupa kata sandi atau akun tidak bisa login' },
    { label: '📄 Cetak Berita Acara', q: 'Cara cetak berita acara' }
  ];

  const OPERATOR_SUGGESTIONS = [
    { label: '📋 SOP Operator', q: 'SOP operator' },
    { label: '🔐 Hak operator', q: 'hak operator' },
    { label: '🧪 Flow 1 gagal', q: 'Flow 1 gagal duplicate source key' },
    { label: '📤 Flow 2 ditolak', q: 'Flow 2 ditolak already posted' },
    { label: '↩️ Rollback', q: 'Cara rollback flow 3' },
    { label: '🧹 Purge', q: 'Cara purge flow 4' },
    { label: '⏹️ Run macet', q: 'Run macet cara force stop' },
    { label: '📣 Eskalasi', q: 'Kapan harus eskalasi dan lapor ke siapa' }
  ];

  const STOPWORDS = new Set(['yang', 'dan', 'di', 'ke', 'dari', 'untuk', 'apa', 'ini', 'itu', 'saya', 'aku', 'kok', 'ya', 'dong', 'tolong', 'bagaimana', 'gimana', 'mengapa', 'kenapa', 'adalah', 'muncul', 'pada', 'dengan', 'bisa', 'tidak', 'the', 'is']);

  // ---------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------
  function normalize(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[^a-z0-9_\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtml(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // Minimal markdown: **bold**, `code`, "- " bullets, "1. " lists. Input is escaped first.
  function renderMarkdown(md) {
    const lines = escapeHtml(md).split('\n');
    const out = [];
    let list = null;
    const closeList = () => {
      if (list) { out.push(`</${list}>`); list = null; }
    };
    const inline = (s) => s
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^\*]+)\*/g, '<em>$1</em>')
      .replace(/`([^`]+)`/g, '<code>$1</code>');

    lines.forEach((line) => {
      const ul = line.match(/^- (.*)$/);
      const ol = line.match(/^\d+\. (.*)$/);
      if (ul) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push(`<li>${inline(ul[1])}</li>`);
      } else if (ol) {
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push(`<li>${inline(ol[1])}</li>`);
      } else if (line.trim() === '') {
        closeList();
      } else {
        closeList();
        out.push(`<p>${inline(line)}</p>`);
      }
    });
    closeList();
    return out.join('');
  }

  function scoreEntry(entry, query, tokens) {
    let score = 0;
    entry.keywords.forEach((kw) => {
      const k = normalize(kw);
      if (!k) return;
      if (k.includes(' ')) {
        if (query.includes(k)) score += 3 + k.split(' ').length;
      } else if (tokens.has(k)) {
        score += 2;
      } else if (k.length >= 5 && [...tokens].some((t) => t.length >= 5 && (t.startsWith(k) || k.startsWith(t)))) {
        score += 1;
      }
    });
    return score;
  }

  function currentRole() {
    const user = window.state && window.state.currentUser;
    return user && user.role_code ? String(user.role_code).toUpperCase() : '';
  }

  function findAnswers(rawQuery) {
    const query = normalize(rawQuery);
    const tokens = new Set(query.split(' ').filter((t) => t && !STOPWORDS.has(t)));
    const role = currentRole();
    return KB
      .filter((entry) => !entry.roles || entry.roles.includes(role))
      .map((entry) => ({ entry, score: scoreEntry(entry, query, tokens) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score);
  }

  // ---------------------------------------------------------------------
  // UI
  // ---------------------------------------------------------------------
  let els = {};
  let history = [];
  let open = false;

  function loadHistory() {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      history = Array.isArray(parsed) ? parsed.slice(-MAX_HISTORY) : [];
    } catch (_) {
      history = [];
    }
  }

  function saveHistory() {
    try {
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-MAX_HISTORY)));
    } catch (_) { /* storage unavailable */ }
  }

  function scrollToBottom() {
    els.body.scrollTop = els.body.scrollHeight;
  }

  function appendMessage(role, text, actions, persist = true) {
    const row = document.createElement('div');
    row.className = `hd-msg hd-msg-${role}`;
    const bubble = document.createElement('div');
    bubble.className = 'hd-bubble';
    if (role === 'bot') {
      bubble.innerHTML = renderMarkdown(text);
    } else {
      bubble.textContent = text;
    }
    row.appendChild(bubble);

    if (actions && actions.length) {
      const bar = document.createElement('div');
      bar.className = 'hd-actions';
      actions.forEach((a) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'hd-action-btn';
        btn.textContent = a.label;
        btn.addEventListener('click', () => runAction(a));
        bar.appendChild(btn);
      });
      row.appendChild(bar);
    }

    els.messages.appendChild(row);
    scrollToBottom();
    if (persist) {
      history.push({ role, text, actions: actions || [] });
      saveHistory();
    }
    return row;
  }

  function showTyping() {
    const row = document.createElement('div');
    row.className = 'hd-msg hd-msg-bot hd-typing';
    row.innerHTML = '<div class="hd-bubble"><span></span><span></span><span></span></div>';
    els.messages.appendChild(row);
    scrollToBottom();
    return row;
  }

  function updateContext() {
    const s = window.state || null;
    const user = s && s.currentUser;
    const label = user
      ? `${user.full_name || user.username} • ${user.role_name || user.role_code || 'User'}`
      : 'Belum login';
    els.context.textContent = label;
  }

  function greet() {
    const s = window.state || null;
    const name = s && s.currentUser ? (s.currentUser.full_name || s.currentUser.username) : '';
    appendMessage('bot', `Halo${name ? ' ' + name : ''}! Saya **Helpdesk MCC**. Ceritakan kendala operasional Anda atau pilih topik di bawah.`, [], false);
  }

  function renderHistory() {
    els.messages.innerHTML = '';
    if (!history.length) {
      greet();
      return;
    }
    history.forEach((m) => appendMessage(m.role, m.text, m.actions, false));
  }

  function runAction(action) {
    if (action.type === 'tab') {
      if (typeof window.switchMainTab === 'function') {
        window.switchMainTab(action.value);
      }
    } else if (action.type === 'health') {
      runHealthCheck();
    } else if (action.type === 'tour') {
      if (window.MCCTour && typeof window.MCCTour.start === 'function') {
        window.MCCTour.start();
      }
    } else if (action.type === 'ask') {
      ask(action.value);
    }
  }

  async function runHealthCheck() {
    appendMessage('user', 'Cek kesehatan sistem');
    const typing = showTyping();
    try {
      const res = await fetch('/api/health', { cache: 'no-store' });
      const json = await res.json();
      typing.remove();
      const d = json && json.data;
      if (!d) throw new Error('Respons health tidak valid');
      const line = (name, db) => {
        if (!db) return `- **${name}**: tidak ada data`;
        const status = db.connected ? '🟢 Terhubung' : '🔴 TERPUTUS';
        const extra = db.connected ? ` (latensi ${db.latencyMs} ms)` : db.error ? ` - ${db.error}` : '';
        return `- **${name}**: ${status}${extra}`;
      };
      const lines = [
        '**Hasil pemeriksaan koneksi:**',
        line('Database Sumber', d.sqlserver),
        line('Database Target (PostgreSQL)', d.postgres),
        ''
      ];
      lines.push(d.bothConnected
        ? 'Semua koneksi normal. Jika masalah berlanjut, jelaskan gejalanya agar saya bantu telusuri.'
        : 'Ada koneksi yang terputus. Periksa VPN/jaringan, SSH tunnel, dan firewall, lalu coba lagi. Bila tetap gagal, hubungi DBA.');
      appendMessage('bot', lines.join('\n'));
    } catch (err) {
      typing.remove();
      appendMessage('bot', `Tidak dapat menghubungi server aplikasi: ${err.message}.\n\nPastikan layanan aplikasi berjalan dan jaringan Anda stabil.`);
    }
  }

  function ask(text) {
    const q = String(text || '').trim();
    if (!q) return;
    appendMessage('user', q);
    const typing = showTyping();
    setTimeout(() => {
      typing.remove();
      const results = findAnswers(q);
      if (!results.length) {
        appendMessage('bot', [
          'Maaf, saya belum menemukan jawaban yang cocok. Coba gunakan kata kunci lain, misalnya *timeout*, *flow*, *config*, *login*, atau *berita acara*.',
          '',
          'Atau pilih topik berikut:'
        ].join('\n'), KB.slice(0, 5).map((e) => ({ label: e.title, type: 'ask', value: e.keywords[0] })));
        return;
      }
      const top = results[0].entry;
      const actions = top.actions ? top.actions.slice() : [];
      const related = results.slice(1, 3).map((r) => ({ label: `Lihat: ${r.entry.title}`, type: 'ask', value: r.entry.keywords[0] }));
      appendMessage('bot', top.answer, actions.concat(related));
    }, 350);
  }

  function renderChips() {
    const role = currentRole();
    const list = role === 'OPERATOR' ? OPERATOR_SUGGESTIONS : SUGGESTIONS;
    if (els.chips.dataset.role === role) return;
    els.chips.dataset.role = role;
    els.chips.innerHTML = '';
    list.forEach((sug) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'hd-chip';
      chip.textContent = sug.label;
      chip.addEventListener('click', () => ask(sug.q));
      els.chips.appendChild(chip);
    });
  }

  function setOpen(value) {
    open = value;
    els.root.classList.toggle('hd-open', open);
    els.toggle.setAttribute('aria-expanded', String(open));
    if (open) {
      updateContext();
      renderChips();
      scrollToBottom();
      setTimeout(() => els.input.focus(), 120);
    }
  }

  function clearChat() {
    history = [];
    saveHistory();
    renderHistory();
  }

  function build() {
    const root = document.createElement('div');
    root.id = 'helpdesk-widget';
    root.className = 'no-print';
    root.innerHTML = `
      <section class="hd-window" role="dialog" aria-label="Helpdesk Operasional MCC">
        <header class="hd-header">
          <div class="hd-title">
            <span class="hd-avatar" aria-hidden="true">🤖</span>
            <div>
              <strong>MCC Helpdesk</strong>
              <small><i class="hd-dot"></i> Online • <span id="hd-context"></span></small>
            </div>
          </div>
          <div class="hd-header-actions">
            <button type="button" id="hd-health" title="Cek kesehatan sistem" aria-label="Cek kesehatan sistem">🩺</button>
            <button type="button" id="hd-clear" title="Bersihkan percakapan" aria-label="Bersihkan percakapan">🗑️</button>
            <button type="button" id="hd-close" title="Tutup" aria-label="Tutup helpdesk">✕</button>
          </div>
        </header>
        <div class="hd-body" id="hd-body">
          <div class="hd-messages" id="hd-messages" aria-live="polite"></div>
          <div class="hd-chips" id="hd-chips"></div>
        </div>
        <form class="hd-input-bar" id="hd-form" autocomplete="off">
          <input type="text" id="hd-input" placeholder="Tulis kendala Anda..." maxlength="300" aria-label="Pesan helpdesk">
          <button type="submit" aria-label="Kirim pesan">➤</button>
        </form>
      </section>
      <button type="button" class="hd-toggle" id="hd-toggle" aria-expanded="false" aria-label="Buka Helpdesk" title="Butuh bantuan operasional? Tanya Helpdesk">
        <span class="hd-toggle-icon">💬</span>
        <span class="hd-pulse"></span>
      </button>`;
    document.body.appendChild(root);

    els = {
      root,
      toggle: root.querySelector('#hd-toggle'),
      body: root.querySelector('#hd-body'),
      messages: root.querySelector('#hd-messages'),
      chips: root.querySelector('#hd-chips'),
      form: root.querySelector('#hd-form'),
      input: root.querySelector('#hd-input'),
      context: root.querySelector('#hd-context')
    };

    renderChips();

    els.toggle.addEventListener('click', () => setOpen(!open));
    root.querySelector('#hd-close').addEventListener('click', () => setOpen(false));
    root.querySelector('#hd-clear').addEventListener('click', clearChat);
    root.querySelector('#hd-health').addEventListener('click', runHealthCheck);
    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = els.input.value;
      els.input.value = '';
      ask(value);
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && open) setOpen(false);
    });

    loadHistory();
    renderHistory();
  }

  function init() {
    if (document.getElementById('helpdesk-widget')) return;
    build();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
