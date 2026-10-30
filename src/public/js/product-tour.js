/* Product Tour - Migration Command Center
 * Tour interaktif bersifat read-only: hanya berpindah menu dan menyorot elemen,
 * tanpa menekan tombol aksi atau mengubah data apa pun.
 */
(function () {
  'use strict';

  const SKIP_PREFIX = 'mcc_tour_skip_';
  const OFFERED_KEY = 'mcc_tour_offered';

  // Setiap langkah: tab (menu yang dibuka), target (selector / fungsi), title, body.
  const STEPS = [
    {
      title: 'Selamat Datang di Migration Command Center',
      body: 'Aplikasi ini memigrasikan data dari database sumber (SQL Server) ke database target (PostgreSQL) melalui 3 tahap: <b>Source ➔ Staging ➔ Target</b>. Tour ini hanya menjelaskan, <b>tidak menjalankan proses apa pun</b>.'
    },
    {
      target: '.header-context-controls',
      title: 'Pilih Client & Environment',
      body: 'Semua data di aplikasi mengikuti <b>Client</b> dan <b>Environment</b> yang dipilih di header (misalnya DEV atau PROD). Pastikan pilihan ini benar sebelum bekerja.'
    },
    {
      tab: 'tab-source',
      target: '#nav-btn-source',
      title: 'Menu 1 — Source Data',
      body: 'Langkah pertama: lihat <b>SQL Server View</b> yang menjadi sumber data migrasi. Menu ini hanya untuk melihat dan memahami data sumber.'
    },
    {
      tab: 'tab-source',
      target: '#tab-source .kpi-grid-horizontal',
      title: 'Ringkasan Sumber Data',
      body: 'Kartu ini menunjukkan jumlah view, total baris, dan jumlah view yang sudah terdaftar di konfigurasi migrasi.'
    },
    {
      tab: 'tab-source',
      target: '#tab-source .quick-filter-strip',
      title: 'Filter & Daftar View',
      body: 'Gunakan filter cepat untuk membedakan view yang <b>sudah</b> dan <b>belum</b> terdaftar di Migration Config. View yang belum terdaftar perlu dikonfigurasi di menu berikutnya.'
    },
    {
      tab: 'tab-config',
      target: '#nav-btn-config',
      title: 'Menu 2 — Migration Config',
      body: 'Langkah kedua: atur <b>aturan migrasi</b>. Di sini Anda menentukan view sumber, tabel staging, tabel target, kunci utama (PK), dan urutan eksekusi.'
    },
    {
      tab: 'tab-config',
      target: '#tab-config .sub-tabs-header',
      configSubtab: 'subtab-cfg-main',
      title: '4 Master Konfigurasi',
      body: 'Menu ini berisi <b>4 master data</b> yang saling terhubung dan dibaca oleh Flow 1–4. Urutannya mengikuti cara kerja migrasi: <b>1. Migration Config</b> (apa yang dimigrasi) ➔ <b>2. Convert Rules</b> (bagaimana data diubah) ➔ <b>3. Target Config</b> (bagaimana data ditulis ke tujuan) ➔ <b>4. Master Lookup</b> (kamus nilai pendukung konversi). Empat langkah berikut menjelaskan tujuan masing-masing; tour hanya berpindah tab, tidak mengubah data.'
    },
    {
      tab: 'tab-config',
      target: '#subtab-cfg-main .panel-header',
      configSubtab: 'subtab-cfg-main',
      title: 'Tab 1 — Migration Config',
      body: '<b>Tujuan:</b> master <b>induk</b> yang mendefinisikan <i>satu unit migrasi</i>: dari <b>Source View</b> mana data diambil, ke <b>Staging Table</b> dan <b>Target Table</b> mana, serta urutan (<b>Order</b>) eksekusinya.<br><b>Kolom penting:</b> <b>PK Columns</b> &amp; <b>Business Keys</b> (identitas baris untuk deteksi delta/duplikat), <b>Compare Columns</b> (kolom pembanding perubahan), <b>Error Policy</b> (ALLOW_PARTIAL atau FAIL_ALL), <b>Precheck SQL</b>, dan <b>Client / Env</b> (hanya di tab ini). Config ID di sini dipilih saat menjalankan Flow 1 dan Flow 4.'
    },
    {
      tab: 'tab-config',
      target: '#subtab-cfg-rules .panel-header',
      configSubtab: 'subtab-cfg-rules',
      title: 'Tab 2 — Convert Rules',
      body: '<b>Tujuan:</b> menentukan <b>aturan konversi per kolom</b> saat data dipindah dari source ke staging (Flow 1), sehingga nilai lama menjadi nilai yang sesuai standar sistem baru.<br><b>Isi:</b> tiap Rule terhubung ke <b>Config ID</b>, berisi <b>Column Name</b> tujuan, <b>Source Column</b>, rujukan <b>Lookup Name</b> ke Master Lookup, aksi <b>On Unmapped</b> (bila nilai tidak ditemukan) dengan <b>Default Value</b>, serta opsi <b>Normalize</b> (mis. rapikan huruf/spasi).'
    },
    {
      tab: 'tab-config',
      target: '#subtab-cfg-targets .panel-header',
      configSubtab: 'subtab-cfg-targets',
      title: 'Tab 3 — Target Config',
      body: '<b>Tujuan:</b> menentukan <b>cara data ditulis ke tabel target PostgreSQL</b> pada Flow 2 (Post) dan dibersihkan pada Flow 3/4.<br><b>Isi:</b> tiap Target terhubung ke <b>Config ID</b> dengan <b>Order</b> eksekusi (tabel induk lebih dulu agar aman dari FK), <b>Target Schema/Table</b>, <b>Mapping SQL</b> (perintah insert/mapping), <b>Precheck SQL</b> (validasi sebelum posting), <b>Postcheck SQL</b> (verifikasi sesudah posting), dan <b>Rollback SQL</b> (pembatalan bila diperlukan).'
    },
    {
      tab: 'tab-config',
      target: '#subtab-cfg-lookups .panel-header',
      configSubtab: 'subtab-cfg-lookups',
      title: 'Tab 4 — Master Lookup',
      body: '<b>Tujuan:</b> <b>kamus pemetaan nilai</b> yang dipakai Convert Rules, misalnya mengubah kode vendor/kategori lama menjadi ID di tabel master baru.<br><b>Isi:</b> <b>Lookup Name</b> (nama kamus), <b>Master Schema/Table</b> acuan, <b>Src Column</b> (nilai asal) dan <b>Tgt Column</b> (nilai hasil), <b>Filter Condition</b>, serta perilaku <b>On Unmapped</b> / <b>Default Value</b>. Satu lookup bisa dipakai banyak rule sehingga konsisten dan mudah dirawat.'
    },
    {
      tab: 'tab-canvas',
      target: '#nav-btn-canvas',
      title: 'Menu 3 — Workflow Canvas Studio',
      body: 'Langkah ketiga: susun dan jalankan <b>alur migrasi</b> secara visual dalam bentuk diagram (DAG) yang berisi simpul tahapan.'
    },
    {
      tab: 'tab-canvas',
      target: '#tab-canvas .canvas-toolbar',
      title: 'Toolbar Canvas',
      body: 'Bagian atas Canvas berisi pilihan <b>Template Alur</b>, tombol <b>Eksekusi Alur</b>, simpan/reset tata letak, dan bersihkan log. Tombol eksekusi hanya Anda tekan sendiri — tour ini tidak akan menjalankannya.'
    },
    {
      tab: 'tab-canvas',
      target: '.canvas-preset-wrap',
      title: 'Template Alur: Flow 1 s/d Flow 4',
      body: 'Daftar ini berisi <b>4 alur migrasi</b> yang dijalankan <b>berurutan</b> dan masing-masing punya tujuan berbeda. Penjelasan setiap flow ada di 4 langkah berikut. Tour hanya menjelaskan, tidak mengganti template atau menjalankan apa pun.'
    },
    {
      tab: 'tab-canvas',
      target: '.canvas-preset-wrap',
      title: 'Flow 1 — Staging & Convert',
      body: '<b>Fungsi:</b> menarik data dari <b>Source (SQL Server View)</b> ke tabel <b>staging</b>, menerapkan aturan konversi, lalu menandai tiap baris <code>NEW_DELTA</code> (baru, akan diposting) atau <code>ALREADY_IN_TARGET</code> (sudah ada di target).<br><b>Tujuan:</b> menyiapkan dan memvalidasi data <i>sebelum</i> menyentuh target. Anda memilih <b>Config ID</b> (satu/banyak/ALL). Menghasilkan <b>Run ID</b>, aman diulang. Cek hasil di Log Error sebelum lanjut.'
    },
    {
      tab: 'tab-canvas',
      target: '.canvas-preset-wrap',
      title: 'Flow 2 — Post ke Target',
      body: '<b>Fungsi:</b> memindahkan baris <code>NEW_DELTA</code> dari staging ke <b>tabel target PostgreSQL</b> secara berurutan sesuai exec order, dengan rollback otomatis bila terjadi error.<br><b>Tujuan:</b> menulis data final ke target. Butuh <b>Run ID</b> Flow 1 berstatus SUCCESS dan belum pernah diposting/di-rollback. Mode <b>Batch</b> (dengan ukuran batch) atau <b>Direct</b>. Setelah sukses, run ditandai sudah diposting.'
    },
    {
      tab: 'tab-canvas',
      target: '.canvas-preset-wrap',
      title: 'Flow 3 — Rollback',
      body: '<b>Fungsi:</b> membatalkan data yang sudah diposting oleh satu atau beberapa <b>Run ID</b> dengan menghapus baris hasil posting dari target (urutan terbalik agar aman dari FK).<br><b>Tujuan:</b> koreksi bila hasil posting salah. Hanya run yang sudah diposting dan belum di-rollback yang dapat dipilih. Disarankan dijalankan sebelum mengulang Flow 1 agar data target tidak ganda.'
    },
    {
      tab: 'tab-canvas',
      target: '.canvas-preset-wrap',
      title: 'Flow 4 — Purge Target',
      body: '<b>Fungsi:</b> menghapus data hasil migrasi di tabel target berdasarkan Config ID (satu, banyak, atau seluruh tabel config).<br><b>Tujuan:</b> membersihkan target untuk migrasi ulang. <b>Destruktif</b> namun dilindungi <i>dual-guard</i>: hanya data bertanda migrasi yang dihapus, data produksi non-migrasi aman. Jalankan <b>🔍 Cek Status ID (Preview)</b> dulu — hanya membaca, tidak mengubah data.'
    },
    {
      tab: 'tab-canvas',
      target: '#btn-canvas-run-flow',
      title: 'Tombol Eksekusi Alur',
      body: 'Setelah memilih Flow dan mengisi parameternya, tombol ini membuka form parameter lalu menjalankan alur. <b>Tour tidak menekannya</b>; Anda yang mengendalikan kapan eksekusi dimulai.'
    },
    {
      tab: 'tab-canvas',
      target: '#canvas-bottom-nav',
      title: 'Panel Bawah: 4 Tab Pemantauan',
      body: 'Panel bawah punya <b>4 tab</b> untuk memantau eksekusi dari yang paling real-time sampai detail kesalahan: <b>Live Terminal Console</b>, <b>Riwayat Eksekusi</b>, <b>Log Langkah</b>, dan <b>Log Error</b>. Di kanan ada indikator kecepatan (r/s) dan throughput baris.'
    },
    {
      tab: 'tab-canvas',
      target: '#canvas-bottom-panel',
      canvasTab: 'canvas-tab-terminal',
      title: 'Tab Live Terminal Console',
      body: 'Menampilkan <b>log langsung (real-time)</b> selama alur berjalan: tiap simpul dimulai/selesai, jumlah baris, dan pesan sistem berwarna. Gunakan untuk mengikuti proses saat ini; tombol <b>Clear Log</b> hanya membersihkan tampilan.'
    },
    {
      tab: 'tab-canvas',
      target: '#canvas-bottom-panel',
      canvasTab: 'canvas-tab-runs',
      title: 'Tab Riwayat Eksekusi',
      body: 'Daftar semua <b>run</b> beserta <b>Run ID</b>, flow, status (SUCCESS / PARTIAL_SUCCESS / FAILED), waktu, dan jumlah baris. Dari sini Anda mengambil <b>Run ID</b> untuk Flow 2 dan Flow 3, serta memilih run untuk melihat log detailnya.'
    },
    {
      tab: 'tab-canvas',
      target: '#canvas-bottom-panel',
      canvasTab: 'canvas-tab-steplogs',
      title: 'Tab Log Langkah',
      body: 'Rincian <b>per langkah (simpul)</b> dalam satu run: nama langkah, status, durasi, dan jumlah baris yang diproses. Berguna untuk mengetahui <b>di langkah mana</b> proses lambat atau berhenti.'
    },
    {
      tab: 'tab-canvas',
      target: '#canvas-bottom-panel',
      canvasTab: 'canvas-tab-errorlogs',
      title: 'Tab Log Error',
      body: 'Mencatat <b>baris/data bermasalah</b> beserta penyebabnya (mis. data tidak valid, gagal konversi, pelanggaran constraint). Periksa tab ini setelah Flow 1 sebelum lanjut ke Flow 2, terutama bila status PARTIAL_SUCCESS atau FAILED.'
    },
    {
      tab: 'tab-pipeline',
      target: '#nav-btn-pipeline',
      title: 'Menu 4 — Hasil Migrasi',
      body: 'Langkah keempat: periksa <b>hasil migrasi</b> lewat rekonsiliasi 3 tahap (Source ➔ Staging ➔ Target) untuk memastikan jumlah dan isi data sesuai.'
    },
    {
      tab: 'tab-pipeline',
      target: '#pipeline-master-table',
      title: 'Tabel Rekonsiliasi',
      body: 'Setiap baris menunjukkan status satu pipeline: jumlah data di sumber, staging, dan target, beserta selisih bila ada.'
    },
    {
      tab: 'tab-pipeline',
      target: '#btn-tab-open-ba',
      title: 'Berita Acara',
      body: 'Setelah hasil sesuai, cetak <b>Berita Acara</b> validasi migrasi sebagai dokumen resmi.'
    },
    {
      tab: 'tab-system',
      target: '#nav-btn-system',
      title: 'Menu 5 — System Administration',
      body: 'Pengaturan akses: kelola <b>User</b>, <b>Role</b>, <b>Matrix Menu</b> (hak akses per menu), dan <b>Menu</b>. Menu ini hanya tampil untuk pengguna yang berwenang.'
    },
    {
      tab: 'tab-system',
      target: () => {
        const b = document.getElementById('btn-subtab-users');
        return b ? b.parentElement : null;
      },
      title: 'Sub-menu Administrasi',
      body: 'Atur siapa boleh melihat menu apa. Perubahan Matrix Menu memengaruhi menu yang tampil saat user login berikutnya.'
    },
    {
      optional: true,
      target: '#btn-open-settings',
      title: 'Pengaturan Sistem',
      body: 'Tombol ini membuka pengaturan <b>Client</b>, <b>Environment</b>, dan <b>koneksi database</b> (multi-connection). Ubah hanya bila Anda berwenang.'
    },
    {
      title: 'Tour Selesai 🎉',
      body: 'Alur kerja: <b>Source Data ➔ Migration Config ➔ Workflow Canvas ➔ Hasil Migrasi</b>. Butuh panduan lengkap? Buka menu <b>Userguide</b> atau tanya <b>Helpdesk</b> di pojok kanan bawah. Tour dapat diulang kapan saja lewat tombol <b>🧭 Tour</b> di header.'
    }
  ];

  let ui = null;
  let steps = [];
  let index = 0;
  let originTab = null;
  let canvasTabTouched = false;
  let configSubtabTouched = false;
  let active = false;

  function currentUsername() {
    try {
      const u = typeof state !== 'undefined' ? state.currentUser : null;
      return (u && (u.username || u.user_id)) || 'anon';
    } catch (_) {
      return 'anon';
    }
  }

  function skipKey() {
    return SKIP_PREFIX + currentUsername();
  }

  function isSkipped() {
    try { return localStorage.getItem(skipKey()) === '1'; } catch (_) { return false; }
  }

  function setSkipped(flag) {
    try {
      if (flag) localStorage.setItem(skipKey(), '1');
      else localStorage.removeItem(skipKey());
    } catch (_) { /* penyimpanan tidak tersedia */ }
  }

  function tabAllowed(tabId) {
    if (typeof isTabAllowedForUser === 'function' && !isTabAllowedForUser(tabId)) return false;
    const btn = document.querySelector('.nav-tab-btn[data-tab="' + tabId + '"]');
    return !!btn && btn.style.display !== 'none' && btn.offsetParent !== null;
  }

  function resolveTarget(step) {
    if (!step.target) return null;
    const el = typeof step.target === 'function' ? step.target() : document.querySelector(step.target);
    if (!el || el.offsetParent === null) return null;
    return el;
  }

  function buildSteps() {
    return STEPS.filter((s) => (!s.tab || tabAllowed(s.tab)) && (!s.optional || resolveTarget(s)));
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }

  // ------------------------------------------------------------------
  // Dialog sambutan
  // ------------------------------------------------------------------
  function closeOffer() {
    const d = document.getElementById('mcc-tour-offer');
    if (d) d.remove();
  }

  function showOffer() {
    if (active || document.getElementById('mcc-tour-offer')) return;
    const wrap = el('div', 'mcc-tour-offer');
    wrap.id = 'mcc-tour-offer';
    wrap.innerHTML =
      '<div class="mcc-tour-offer-card" role="dialog" aria-modal="true" aria-labelledby="mcc-tour-offer-title">' +
      '<div class="mcc-tour-offer-icon">🧭</div>' +
      '<h3 id="mcc-tour-offer-title">Ikuti tour singkat aplikasi?</h3>' +
      '<p>Kami akan memandu Anda step by step: <b>Source Data</b>, <b>Migration Config</b>, <b>Workflow Canvas Studio</b>, <b>Hasil Migrasi</b>, hingga pengaturan sistem. Tour hanya berisi penjelasan dan tidak menjalankan proses apa pun.</p>' +
      '<label class="mcc-tour-check"><input type="checkbox" id="mcc-tour-never"> Jangan tampilkan lagi saat login</label>' +
      '<div class="mcc-tour-offer-actions">' +
      '<button type="button" class="mcc-tour-btn mcc-tour-btn-ghost" id="mcc-tour-later">Nanti Saja</button>' +
      '<button type="button" class="mcc-tour-btn mcc-tour-btn-primary" id="mcc-tour-start">Mulai Tour ➔</button>' +
      '</div></div>';
    document.body.appendChild(wrap);

    const never = wrap.querySelector('#mcc-tour-never');
    wrap.querySelector('#mcc-tour-later').addEventListener('click', () => {
      if (never.checked) setSkipped(true);
      closeOffer();
    });
    wrap.querySelector('#mcc-tour-start').addEventListener('click', () => {
      if (never.checked) setSkipped(true);
      closeOffer();
      start();
    });
    wrap.querySelector('#mcc-tour-start').focus();
  }

  // ------------------------------------------------------------------
  // Tour
  // ------------------------------------------------------------------
  function buildUi() {
    const root = el('div', 'mcc-tour-root');
    root.id = 'mcc-tour-root';
    const blocker = el('div', 'mcc-tour-blocker');
    const spot = el('div', 'mcc-tour-spot');
    const card = el('div', 'mcc-tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'mcc-tour-title');
    card.innerHTML =
      '<button type="button" class="mcc-tour-close" aria-label="Tutup tour" title="Tutup (Esc)">✕</button>' +
      '<div class="mcc-tour-progress" id="mcc-tour-progress"></div>' +
      '<h4 class="mcc-tour-title" id="mcc-tour-title"></h4>' +
      '<div class="mcc-tour-body" id="mcc-tour-body"></div>' +
      '<div class="mcc-tour-actions">' +
      '<button type="button" class="mcc-tour-btn mcc-tour-btn-ghost" data-act="skip">Lewati</button>' +
      '<span class="mcc-tour-spacer"></span>' +
      '<button type="button" class="mcc-tour-btn mcc-tour-btn-ghost" data-act="prev">‹ Sebelumnya</button>' +
      '<button type="button" class="mcc-tour-btn mcc-tour-btn-primary" data-act="next">Berikutnya ›</button>' +
      '</div>';
    root.appendChild(blocker);
    root.appendChild(spot);
    root.appendChild(card);
    document.body.appendChild(root);

    card.querySelector('.mcc-tour-close').addEventListener('click', () => stop());
    card.querySelector('[data-act="skip"]').addEventListener('click', () => stop());
    card.querySelector('[data-act="prev"]').addEventListener('click', () => go(index - 1));
    card.querySelector('[data-act="next"]').addEventListener('click', () => {
      if (index >= steps.length - 1) stop(); else go(index + 1);
    });
    return { root, spot, card };
  }

  function position() {
    if (!active || !ui) return;
    const step = steps[index];
    const target = resolveTarget(step);
    const { spot, card } = ui;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const gap = 14;
    const cw = card.offsetWidth;
    const ch = card.offsetHeight;

    if (!target) {
      spot.style.display = 'none';
      ui.root.classList.add('mcc-tour-dim');
      card.style.left = Math.max(8, (vw - cw) / 2) + 'px';
      card.style.top = Math.max(8, (vh - ch) / 2) + 'px';
      return;
    }

    ui.root.classList.remove('mcc-tour-dim');
    const r = target.getBoundingClientRect();
    const pad = 6;
    const top = Math.max(0, r.top - pad);
    const left = Math.max(0, r.left - pad);
    const width = Math.min(vw - left, r.width + pad * 2);
    const height = Math.min(vh - top, r.height + pad * 2);
    spot.style.display = 'block';
    spot.style.top = top + 'px';
    spot.style.left = left + 'px';
    spot.style.width = width + 'px';
    spot.style.height = height + 'px';

    let cardTop;
    if (top + height + gap + ch <= vh - 8) cardTop = top + height + gap;
    else if (top - gap - ch >= 8) cardTop = top - gap - ch;
    else cardTop = Math.max(8, vh - ch - 8);
    let cardLeft = left + width / 2 - cw / 2;
    cardLeft = Math.min(Math.max(8, cardLeft), Math.max(8, vw - cw - 8));
    card.style.top = cardTop + 'px';
    card.style.left = cardLeft + 'px';
  }

  function go(i) {
    if (!active) return;
    index = Math.min(Math.max(0, i), steps.length - 1);
    const step = steps[index];

    if (step.tab && typeof switchMainTab === 'function' && (typeof state === 'undefined' || state.activeTab !== step.tab)) {
      switchMainTab(step.tab);
    }

    if (step.configSubtab && typeof switchConfigSubtab === 'function') {
      switchConfigSubtab(step.configSubtab);
      configSubtabTouched = true;
    }
    if (step.canvasTab && typeof switchCanvasBottomTab === 'function') {
      switchCanvasBottomTab(step.canvasTab);
      canvasTabTouched = true;
    }

    const { card } = ui;
    card.querySelector('#mcc-tour-progress').textContent = 'Langkah ' + (index + 1) + ' dari ' + steps.length;
    card.querySelector('#mcc-tour-title').textContent = step.title;
    card.querySelector('#mcc-tour-body').innerHTML = step.body;
    card.querySelector('[data-act="prev"]').style.visibility = index === 0 ? 'hidden' : 'visible';
    const last = index === steps.length - 1;
    card.querySelector('[data-act="next"]').textContent = last ? 'Selesai ✓' : 'Berikutnya ›';
    card.querySelector('[data-act="skip"]').style.visibility = last ? 'hidden' : 'visible';

    // Beri waktu render panel tab sebelum menghitung posisi sorotan
    setTimeout(() => {
      if (!active) return;
      const target = resolveTarget(step);
      if (target) target.scrollIntoView({ block: 'center', inline: 'center' });
      position();
      card.querySelector('[data-act="next"]').focus({ preventScroll: true });
    }, step.tab ? 250 : 0);
    // Konten tab dimuat asinkron; hitung ulang posisi setelah render selesai
    setTimeout(() => { if (active && steps[index] === step) position(); }, 900);
  }

  function onKey(e) {
    if (!active) return;
    if (e.key === 'Escape') { e.preventDefault(); stop(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); if (index < steps.length - 1) go(index + 1); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
  }

  function start() {
    if (active) return;
    closeOffer();
    steps = buildSteps();
    if (!steps.length) return;
    try { originTab = typeof state !== 'undefined' ? state.activeTab : null; } catch (_) { originTab = null; }
    active = true;
    ui = buildUi();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    document.addEventListener('keydown', onKey, true);
    go(0);
  }

  function stop() {
    if (!active) return;
    active = false;
    if (canvasTabTouched && typeof switchCanvasBottomTab === 'function') switchCanvasBottomTab('canvas-tab-terminal');
    canvasTabTouched = false;
    if (configSubtabTouched && typeof switchConfigSubtab === 'function') switchConfigSubtab('subtab-cfg-main');
    configSubtabTouched = false;
    window.removeEventListener('resize', position);
    window.removeEventListener('scroll', position, true);
    document.removeEventListener('keydown', onKey, true);
    if (ui) ui.root.remove();
    ui = null;
    if (originTab && typeof switchMainTab === 'function') switchMainTab(originTab);
  }

  // Dipanggil setelah login. force=true untuk login baru; tanpa force (pemulihan sesi)
  // dialog hanya muncul sekali per sesi browser agar tidak berulang tiap refresh.
  function offer(opts) {
    const force = !!(opts && opts.force);
    if (isSkipped()) return;
    try {
      if (!force && sessionStorage.getItem(OFFERED_KEY) === currentUsername()) return;
      sessionStorage.setItem(OFFERED_KEY, currentUsername());
    } catch (_) { /* sessionStorage tidak tersedia */ }
    setTimeout(showOffer, 400);
  }

  function clearSession() {
    try { sessionStorage.removeItem(OFFERED_KEY); } catch (_) { /* abaikan */ }
    stop();
    closeOffer();
  }

  function bindButton() {
    const btn = document.getElementById('btn-start-tour');
    if (btn && !btn.dataset.bound) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', () => {
        setSkipped(false);
        start();
      });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', bindButton);
  else bindButton();

  window.MCCTour = { offer, start, stop, clearSession };
})();
