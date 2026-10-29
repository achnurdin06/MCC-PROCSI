/**
 * Error Formatter & Translator Utilitas
 * Menerjemahkan kode dan pesan error teknis (Database, SQL Server, PostgreSQL, Engine DAG, Purge)
 * menjadi penjelasan bahasa manusia yang komunikatif, ramah pengguna, dan menyertakan solusi konkret.
 */

const KNOWN_ERROR_RULES = [
  // 1. Purge & Perlindungan Data Non-Migrasi (Flow 4)
  {
    match: (err) => /Gagal membaca riwayat staging/i.test(err.message || ''),
    format: (err) => ({
      title: 'Riwayat Migrasi Tidak Dapat Dibaca',
      humanMessage: 'Sistem tidak bisa memeriksa riwayat migrasi (staging_data_history), sehingga penghapusan dibatalkan demi keamanan data.',
      cause: err.message,
      actionableSolution: '1. Pastikan koneksi database PostgreSQL normal.\n2. Pastikan tabel stg_antam.staging_data_history dapat diakses oleh user aplikasi.\n3. Ulangi eksekusi Flow 4.',
      technicalCode: 'HISTORY_UNREADABLE'
    })
  },
  {
    match: (err) => err.code === 'PURGE_BLOCKED' || (err.message && err.message.includes('NOT_MIGRATION_DATA')),
    format: (err, ctx) => {
      const msg = err.message || '';
      const idMatch = msg.match(/ID berikut.*?:\s*([^.]+)/i) || msg.match(/ID \(([^)]+)\)/i);
      const ids = idMatch ? idMatch[1].trim() : (ctx.deleteIds || 'yang dimasukkan');
      return {
        title: 'Penghapusan Dibatalkan Demi Keamanan Data',
        humanMessage: `Sistem mendeteksi bahwa ID [${ids}] adalah data asli sistem target (bukan hasil migrasi Antam) atau tidak memiliki bukti riwayat migrasi. Sesuai aturan keamanan data, data non-migrasi dilarang untuk dihapus.`,
        cause: 'ID tersebut tidak memiliki flag penanda migrasi aktif pada tabel target DAN tidak ditemukan bukti jejaknya di riwayat staging (stg_antam.staging_data_history).',
        actionableSolution: `1. Keluarkan ID [${ids}] dari kolom input hapus.\n2. Jika data tersebut seharusnya merupakan data migrasi, jalankan alur Flow 1 (Staging) lalu Flow 2 (Posting) agar riwayat migrasinya terdaftar resmi sebelum melakukan purge.`,
        technicalCode: 'PURGE_BLOCKED'
      };
    }
  },
  {
    match: (err) => err.code === 'PURGE_INCOMPLETE' || (err.message && err.message.includes('Purge') && err.message.includes('belum tuntas')),
    format: (err) => ({
      title: 'Pembersihan Data Target Belum Tuntas',
      humanMessage: 'Proses penghapusan berhasil dipicu, namun sebagian data masih tertahan di tabel target dan belum terhapus seluruhnya.',
      cause: 'Data target kemungkinan tertahan oleh foreign key constraint dari tabel anak (child relation) atau lock transaksi database.',
      actionableSolution: 'Periksa relasi tabel anak yang merujuk ke data ini, hapus data anak terlebih dahulu, lalu ulangi eksekusi Flow 4.',
      technicalCode: 'PURGE_INCOMPLETE'
    })
  },
  {
    match: (err) => err.code === 'INVALID_DELETE_IDS',
    format: (err) => ({
      title: 'Format ID Hapus Tidak Valid',
      humanMessage: 'Format ID yang dimasukkan pada form hapus tidak sesuai ketentuan.',
      cause: err.message || 'Terdapat karakter yang tidak diperbolehkan pada input ID.',
      actionableSolution: 'Gunakan karakter alfanumerik (huruf, angka, strip, underscore), pisahkan antar ID dengan tanda koma atau spasi.',
      technicalCode: 'INVALID_DELETE_IDS'
    })
  },
  {
    match: (err) => err.code === 'TOO_MANY_DELETE_IDS',
    format: (err) => ({
      title: 'Jumlah ID Melebihi Batas Maksimum',
      humanMessage: 'Daftar ID yang dimasukkan terlalu banyak untuk satu sesi eksekusi.',
      cause: 'Batas maksimum per proses adalah 500 ID untuk menjaga kestabilan dan kinerja database.',
      actionableSolution: 'Pecah daftar ID menjadi beberapa kelompok (maksimal 500 ID per sesi) dan jalankan secara bertahap.',
      technicalCode: 'TOO_MANY_DELETE_IDS'
    })
  },

  // 2. Koneksi & Jaringan Database
  {
    match: (err) => {
      const str = (err.code || '') + ' ' + (err.message || '');
      return /ECONNREFUSED|ETIMEDOUT|connection timeout|Connection terminated|timeout expired|read ECONNRESET/i.test(str);
    },
    format: (err, ctx) => ({
      title: 'Koneksi ke Database Terputus / Batas Waktu Habis',
      humanMessage: 'Aplikasi tidak dapat menghubungi server database tujuan atau waktu tunggu permintaan (timeout) terlampaui.',
      cause: 'Layanan database sedang sibuk, jaringan tidak stabil, atau koneksi SSH Tunnel / VPN terputus.',
      actionableSolution: '1. Pastikan SSH Tunnel / VPN ke server database aktif dan stabil.\n2. Cek status koneksi pada Pengaturan Koneksi.\n3. Ulangi proses eksekusi setelah koneksi normal.',
      technicalCode: 'CONNECTION_TIMEOUT'
    })
  },
  {
    match: (err) => err.code === '28P01' || /password authentication failed/i.test(err.message || ''),
    format: () => ({
      title: 'Otentikasi Database Ditolak',
      humanMessage: 'Username atau kata sandi database yang dikonfigurasi tidak valid.',
      cause: 'Kredensial database di konfigurasi environment (.env atau master_connection) salah atau telah kedaluwarsa.',
      actionableSolution: 'Periksa kembali kredensial database (username, password, database name) di menu Pengaturan Lingkungan.',
      technicalCode: 'AUTH_FAILED'
    })
  },

  // 3. PostgreSQL Database Constraints
  {
    match: (err) => err.code === '23505' || /unique constraint|duplicate key/i.test(err.message || ''),
    format: (err) => {
      const detail = err.detail || err.message || '';
      return {
        title: 'Duplikasi Data (Unique / Primary Key Violation)',
        humanMessage: 'Data yang akan dimasukkan sudah ada di tabel target sehingga melanggar aturan keunikan (Unique / Primary Key).',
        cause: `Terjadi benturan kunci unik: ${detail}`,
        actionableSolution: '1. Jika data ini adalah hasil migrasi sebelumnya yang ingin diperbarui, jalankan Flow 3 (Rollback) terlebih dahulu.\n2. Periksa nomor sequence ID atau data sumber untuk memastikan tidak ada duplikasi ID.',
        technicalCode: 'UNIQUE_KEY_VIOLATION'
      };
    }
  },
  {
    match: (err) => err.code === '23503' || /foreign key constraint|violates foreign key/i.test(err.message || ''),
    format: (err) => {
      const detail = err.detail || err.message || '';
      return {
        title: 'Pelanggaran Relasi Data (Foreign Key Violation)',
        humanMessage: 'Operasi gagal karena data yang diproses memiliki keterikatan relasi dengan data di tabel lain yang belum ada atau tidak dapat diubah.',
        cause: `Relasi foreign key tidak terpenuhi: ${detail}`,
        actionableSolution: '1. Pastikan tabel master/induk terkait sudah dimigrasikan terlebih dahulu sesuai urutan konfigurasi (Execution Order).\n2. Jika sedang melakukan rollback/purge, hapus atau rollback tabel anak terlebih dahulu.',
        technicalCode: 'FOREIGN_KEY_VIOLATION'
      };
    }
  },
  {
    match: (err) => err.code === '23502' || /null value in column.*violates not-null constraint/i.test(err.message || ''),
    format: (err) => {
      const colMatch = (err.message || '').match(/column "([^"]+)"/i);
      const col = colMatch ? colMatch[1] : 'wajib';
      return {
        title: 'Kolom Wajib Belum Terisi (NOT NULL Violation)',
        humanMessage: `Kolom [${col}] pada tabel tujuan wajib memiliki nilai, namun data yang dikirimkan bernilai kosong (NULL).`,
        cause: `Data sumber tidak menyediakan nilai untuk kolom ${col}, atau mapping transformasi belum menetapkan nilai default.`,
        actionableSolution: `Tambahkan penanganan COALESCE atau nilai default untuk kolom [${col}] pada konfigurasi transformasi / query sumber.`,
        technicalCode: 'NOT_NULL_VIOLATION'
      };
    }
  },
  {
    match: (err) => err.code === '42P01' || /relation.*does not exist/i.test(err.message || ''),
    format: (err) => {
      const tblMatch = (err.message || '').match(/relation "([^"]+)" does not exist/i);
      const tbl = tblMatch ? tblMatch[1] : 'tabel';
      return {
        title: 'Tabel Tidak Ditemukan di Database',
        humanMessage: `Tabel atau view [${tbl}] tidak ditemukan di schema database target atau staging.`,
        cause: 'Nama tabel di konfigurasi migrasi berbeda dengan struktur aktual di database, atau schema belum dimigrasikan.',
        actionableSolution: `Periksa ejaan nama schema dan tabel [${tbl}] pada menu Konfigurasi Migrasi.`,
        technicalCode: 'TABLE_NOT_FOUND'
      };
    }
  },
  {
    match: (err) => err.code === '42703' || /column.*does not exist/i.test(err.message || ''),
    format: (err) => {
      const colMatch = (err.message || '').match(/column "([^"]+)" does not exist/i);
      const col = colMatch ? colMatch[1] : 'kolom';
      return {
        title: 'Kolom Tidak Ditemukan',
        humanMessage: `Kolom [${col}] tidak ditemukan pada tabel yang dituju.`,
        cause: 'Struktur kolom pada query transformasi atau tabel staging tidak cocok dengan kolom aktual di tabel target.',
        actionableSolution: `Periksa definisi kolom [${col}] pada skema database dan sesuaikan mapping kolom di konfigurasi migrasi.`,
        technicalCode: 'COLUMN_NOT_FOUND'
      };
    }
  },
  {
    match: (err) => err.code === '40P01' || /deadlock detected/i.test(err.message || ''),
    format: () => ({
      title: 'Benturan Transaksi Database (Deadlock)',
      humanMessage: 'Dua proses database saling menunggu sumber daya yang sama sehingga salah satu transaksi dihentikan oleh server.',
      cause: 'Terdapat proses lain (atau sesi migrasi paralel) yang sedang mengakses tabel yang sama secara bersamaan.',
      actionableSolution: 'Tunggu beberapa saat dan jalankan ulang proses. Hindari mengeksekusi tabel yang sama secara paralel.',
      technicalCode: 'DEADLOCK_DETECTED'
    })
  },

  // 4. Tahapan Khusus Alur Migrasi (Flow 1, 2, 3)
  {
    match: (err) => /PRECHECK_SOURCE/i.test(err.step || '') || /View.*tidak ditemukan di INFORMATION_SCHEMA/i.test(err.message || ''),
    format: (err) => ({
      title: 'Validasi View Sumber (SQL Server) Gagal',
      humanMessage: 'Sistem tidak dapat menemukan view sumber data pada database SQL Server antam_scm.',
      cause: err.message || 'Nama schema atau view sumber tidak ada di database SQL Server sumber.',
      actionableSolution: 'Pastikan konfigurasi src_schema dan src_view pada migration_config sudah sesuai dengan view yang ada di SQL Server.',
      technicalCode: 'PRECHECK_SOURCE_FAILED'
    })
  },
  {
    match: (err) => /PREPARE_STAGING/i.test(err.step || '') || /fn_prepare_staging/i.test(err.message || ''),
    format: (err) => ({
      title: 'Persiapan Tabel Staging Gagal',
      humanMessage: 'Fungsi database gagal membuat atau mereset tabel penampungan sementara (staging).',
      cause: err.message || 'Terkendala izin akses schema stg_antam atau kegagalan DDL database.',
      actionableSolution: 'Pastikan user PostgreSQL memiliki hak akses CREATE/DROP tabel pada schema stg_antam.',
      technicalCode: 'PREPARE_STAGING_FAILED'
    })
  },
  {
    match: (err) => /CHECK_STAGING/i.test(err.step || '') || /fn_check_staging/i.test(err.message || ''),
    format: (err) => ({
      title: 'Validasi Jumlah Baris Staging Tidak Sesuai',
      humanMessage: 'Jumlah baris data yang disalin ke staging tidak cocok dengan jumlah baris pada view sumber.',
      cause: err.message || 'Terjadi inkonsistensi saat pemindahan data dari SQL Server ke PostgreSQL staging.',
      actionableSolution: 'Jalankan ulang Flow 1 untuk memastikan transfer data lengkap.',
      technicalCode: 'CHECK_STAGING_FAILED'
    })
  },
  {
    match: (err) => /DELTA_CHECK/i.test(err.step || '') || /fn_delta_check/i.test(err.message || ''),
    format: (err) => ({
      title: 'Pemeriksaan Perubahan Data (Delta Check) Gagal',
      humanMessage: 'Sistem mengalami kegagalan saat membandingkan data staging dengan data target.',
      cause: err.message || 'Kolom Primary Key / Business Key pada konfigurasi tidak valid untuk perbandingan.',
      actionableSolution: 'Periksa kolom pk_columns dan business_key pada migration_config.',
      technicalCode: 'DELTA_CHECK_FAILED'
    })
  },
  {
    match: (err) => /POST_TARGETS/i.test(err.step || '') || /fn_post_targets/i.test(err.message || ''),
    format: (err) => ({
      title: 'Posting Data ke Target (Flow 2) Gagal',
      humanMessage: 'Gagal memasukkan data dari staging ke dalam tabel target.',
      cause: err.message || 'Terjadi galat integritas data saat eksekusi fn_post_targets.',
      actionableSolution: 'Periksa pesan error detail di tabel log error, perbaiki data sumber jika diperlukan, lalu gunakan tombol "Lanjutkan Post (Flow 2)".',
      technicalCode: 'POST_TARGETS_FAILED'
    })
  },
  {
    match: (err) => /ROLLBACK_TARGETS/i.test(err.step || '') || /fn_rollback_target_data/i.test(err.message || ''),
    format: (err) => ({
      title: 'Pengembalian Data (Rollback Flow 3) Gagal',
      humanMessage: 'Proses rollback data dari target tidak dapat diselesaikan.',
      cause: err.message || 'Fungsi database fn_rollback_target_data mengembalikan galat.',
      actionableSolution: 'Periksa apakah ada data pada tabel target yang sudah terikat dengan transaksi baru.',
      technicalCode: 'ROLLBACK_FAILED'
    })
  }
];

/**
 * Menerjemahkan error teknis menjadi struktur bahasa manusia
 * @param {Error|Object|string} err 
 * @param {Object} context { runId, configId, stepName, flowId, deleteIds, ... }
 * @returns {Object}
 */
function formatHumanError(err, context = {}) {
  const safeErr = typeof err === 'string'
    ? { message: err }
    : (err || { message: 'Terjadi kesalahan sistem yang tidak diketahui' });

  const errObj = {
    code: safeErr.code || safeErr.errorCode || null,
    message: safeErr.message || String(safeErr),
    detail: safeErr.detail || safeErr.errorDetail || null,
    step: safeErr.step || safeErr.stepName || context.stepName || null,
    stack: safeErr.stack || null,
    sqlState: safeErr.sqlState || safeErr.code || null
  };

  for (const rule of KNOWN_ERROR_RULES) {
    if (rule.match(errObj)) {
      const res = rule.format(errObj, context);
      return {
        isHumanFormatted: true,
        title: res.title,
        humanMessage: res.humanMessage,
        cause: res.cause,
        actionableSolution: res.actionableSolution,
        technicalCode: res.technicalCode || errObj.code || 'ERROR',
        technicalDetail: errObj.detail || errObj.message,
        shortSummary: `${res.title}: ${res.humanMessage.slice(0, 150)}${res.humanMessage.length > 150 ? '...' : ''}`
      };
    }
  }

  // Fallback generik yang ramah
  const rawMsg = errObj.message || 'Kesalahan internal sistem.';
  const cleaned = rawMsg
    .replace(/^Error:\s*/i, '')
    .replace(/\s+at\s+.*$/g, '')
    .trim();

  return {
    isHumanFormatted: false,
    title: 'Kendala Eksekusi Alur Migrasi',
    humanMessage: `Terjadi kendala saat mengeksekusi tahapan ${errObj.step || context.stepName || 'proses'}: ${cleaned}`,
    cause: errObj.detail ? `Detail teknis: ${errObj.detail}` : 'Proses sistem terhenti karena kondisi database atau parameter input yang tidak sesuai.',
    actionableSolution: 'Periksa log langkah dan log error pada sesi ini untuk melihat rincian baris data bermasalah, lalu lakukan eksekusi ulang.',
    technicalCode: errObj.code || 'EXECUTION_ERROR',
    technicalDetail: rawMsg,
    shortSummary: `Kendala pada ${errObj.step || context.stepName || 'alur'}: ${cleaned}`
  };
}

module.exports = {
  formatHumanError
};
