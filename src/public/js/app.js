// State Aplikasi
const state = {
  activeTab: 'tab-source',
  activeEtlSubtab: 'subtab-runs',
  health: null,
  
  // Modul 1: Source
  source: {
    views: [],
    selectedView: 'v_migration_vendor',
    page: 1,
    limit: 25,
    totalPages: 1,
    total: 0,
    columns: [],
    rows: [],
  },

  // Modul 2: ETL
  etl: {
    overview: null,
    runs: [],
    selectedRunId: null,
    stepLogs: [],
    errorLogs: [],
    masters: null,
  },

  // Modul 3: Pipeline
  pipeline: {
    pipelines: [],
    selectedConfigId: 1,
    selectedStage: 'staging',
    page: 1,
    limit: 25,
    totalPages: 1,
    total: 0,
    columns: [],
    rows: [],
    location: '',
  },
};

// Inisialisasi
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initDashboard();
});

function setupEventListeners() {
  // Main Tabs Navigation
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchMainTab(tabId);
    });
  });

  // ETL Subtabs Navigation
  document.querySelectorAll('.sub-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subtabId = btn.getAttribute('data-subtab');
      switchEtlSubtab(subtabId);
    });
  });

  // Refresh All Button
  document.getElementById('btn-refresh-all').addEventListener('click', () => {
    initDashboard();
  });

  // Source View Controls
  document.getElementById('btn-refresh-views').addEventListener('click', () => {
    loadSourceViews();
  });

  document.getElementById('select-source-limit').addEventListener('change', (e) => {
    state.source.limit = parseInt(e.target.value, 10);
    state.source.page = 1;
    loadSourceViewData();
  });

  document.getElementById('btn-reload-view-data').addEventListener('click', () => {
    loadSourceViewData();
  });

  document.getElementById('btn-source-prev').addEventListener('click', () => {
    if (state.source.page > 1) {
      state.source.page--;
      loadSourceViewData();
    }
  });

  document.getElementById('btn-source-next').addEventListener('click', () => {
    if (state.source.page < state.source.totalPages) {
      state.source.page++;
      loadSourceViewData();
    }
  });

  // ETL Controls
  document.getElementById('btn-refresh-runs').addEventListener('click', () => {
    loadEtlRuns();
  });

  document.getElementById('btn-clear-step-filter').addEventListener('click', () => {
    state.etl.selectedRunId = null;
    document.getElementById('btn-clear-step-filter').classList.add('hidden');
    document.getElementById('steplogs-filter-desc').textContent = 'Menampilkan seluruh riwayat langkah proses ETL';
    loadEtlStepLogs();
  });

  document.getElementById('btn-clear-error-filter').addEventListener('click', () => {
    state.etl.selectedRunId = null;
    document.getElementById('btn-clear-error-filter').classList.add('hidden');
    document.getElementById('errorlogs-filter-desc').textContent = 'Rincian error transformasi dan sampel data baris bermasalah';
    loadEtlErrorLogs();
  });

  // Pipeline Controls
  document.getElementById('btn-refresh-pipeline').addEventListener('click', () => {
    loadPipelineReconciliation();
  });

  // Stage Switcher
  document.querySelectorAll('.stage-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const stageBtn = e.currentTarget || btn;
      const targetStage = stageBtn.getAttribute('data-stage');
      if (!targetStage) return;
      document.querySelectorAll('.stage-btn').forEach((b) => b.classList.remove('active'));
      stageBtn.classList.add('active');
      state.pipeline.selectedStage = targetStage;
      state.pipeline.page = 1;
      loadPipelineStageData();
    });
  });

  const selectStageLimit = document.getElementById('select-stage-limit');
  if (selectStageLimit) {
    selectStageLimit.addEventListener('change', (e) => {
      state.pipeline.limit = parseInt(e.target.value, 10);
      state.pipeline.page = 1;
      loadPipelineStageData();
    });
  }

  document.getElementById('btn-stage-prev').addEventListener('click', () => {
    if (state.pipeline.page > 1) {
      state.pipeline.page--;
      loadPipelineStageData();
    }
  });

  document.getElementById('btn-stage-next').addEventListener('click', () => {
    if (state.pipeline.page < state.pipeline.totalPages) {
      state.pipeline.page++;
      loadPipelineStageData();
    }
  });

  // Modal JSON Close
  document.getElementById('btn-close-modal').addEventListener('click', () => {
    document.getElementById('modal-json').classList.add('hidden');
  });

  document.getElementById('modal-json').addEventListener('click', (e) => {
    if (e.target.id === 'modal-json') {
      document.getElementById('modal-json').classList.add('hidden');
    }
  });

  // Modal Berita Acara Events
  const btnOpenBa = document.getElementById('btn-open-ba');
  if (btnOpenBa) {
    btnOpenBa.addEventListener('click', () => {
      openBeritaAcara(state.pipeline.selectedConfigId);
    });
  }

  const btnCloseBa = document.getElementById('btn-close-ba');
  if (btnCloseBa) {
    btnCloseBa.addEventListener('click', () => {
      document.getElementById('modal-berita-acara').classList.add('hidden');
    });
  }

  const modalBa = document.getElementById('modal-berita-acara');
  if (modalBa) {
    modalBa.addEventListener('click', (e) => {
      if (e.target.id === 'modal-berita-acara') {
        modalBa.classList.add('hidden');
      }
    });
  }

  const btnPrintBa = document.getElementById('btn-print-ba');
  if (btnPrintBa) {
    btnPrintBa.addEventListener('click', () => {
      window.print();
    });
  }

  const btnExportCsv = document.getElementById('btn-export-stg-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => {
      exportStagingCsv();
    });
  }
}

function switchMainTab(tabId) {
  state.activeTab = tabId;
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach((p) => {
    p.classList.toggle('active', p.id === tabId);
  });

  if (tabId === 'tab-source' && state.source.views.length === 0) {
    loadSourceViews();
  } else if (tabId === 'tab-etl' && state.etl.runs.length === 0) {
    loadEtlOverview();
    loadEtlRuns();
  } else if (tabId === 'tab-pipeline' && state.pipeline.pipelines.length === 0) {
    loadPipelineReconciliation();
  }
}

function switchEtlSubtab(subtabId) {
  state.activeEtlSubtab = subtabId;
  document.querySelectorAll('.sub-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-subtab') === subtabId);
  });
  document.querySelectorAll('.subtab-content').forEach((c) => {
    c.classList.toggle('active', c.id === subtabId);
  });

  if (subtabId === 'subtab-steplogs') {
    loadEtlStepLogs(state.etl.selectedRunId);
  } else if (subtabId === 'subtab-errorlogs') {
    loadEtlErrorLogs(state.etl.selectedRunId);
  } else if (subtabId === 'subtab-masters' && !state.etl.masters) {
    loadEtlMasters();
  }
}

async function initDashboard() {
  await checkHealth();
  await loadSourceViews();
  await loadEtlOverview();
  await loadPipelineReconciliation();
}

/**
 * 0. HEALTH CHECK
 */
async function checkHealth() {
  const mssqlBadge = document.getElementById('mssql-status');
  const pgBadge = document.getElementById('pg-status');
  const mssqlMeta = document.getElementById('mssql-meta');
  const pgMeta = document.getElementById('pg-meta');

  mssqlBadge.className = 'db-badge loading';
  pgBadge.className = 'db-badge loading';

  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    // MSSQL Status
    if (data.sqlserver.connected) {
      mssqlBadge.className = 'db-badge connected';
      mssqlMeta.textContent = `Online • ${data.sqlserver.database} (${data.sqlserver.latencyMs}ms)`;
    } else {
      mssqlBadge.className = 'db-badge error';
      mssqlMeta.textContent = 'Gagal terhubung';
    }

    // PostgreSQL Status
    if (data.postgres.connected) {
      pgBadge.className = 'db-badge connected';
      pgMeta.textContent = `Online • ${data.postgres.database} (${data.postgres.latencyMs}ms)`;
    } else {
      pgBadge.className = 'db-badge error';
      pgMeta.textContent = 'Gagal terhubung';
    }
  } catch (e) {
    mssqlBadge.className = 'db-badge error';
    pgBadge.className = 'db-badge error';
    mssqlMeta.textContent = 'Server offline';
    pgMeta.textContent = 'Server offline';
  }
}

/**
 * =========================================================================
 * MODUL 1: SOURCE DATA (SQL SERVER DBO VIEWS)
 * =========================================================================
 */
async function loadSourceViews() {
  const tbody = document.getElementById('source-views-table-body');
  tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-muted">Mengambil data views SQL Server...</td></tr>`;

  try {
    const res = await fetch('/api/source/views');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    state.source.views = data.views;

    // KPIs
    document.getElementById('kpi-source-views-count').textContent = data.totalViews;
    document.getElementById('kpi-source-total-rows').textContent = formatNumber(data.totalRowsAllViews);

    const mainView = data.views.find((v) => v.name === 'v_migration_vendor') || data.views[0];
    if (mainView && !state.source.selectedView) {
      state.source.selectedView = mainView.name;
    }

    if (mainView) {
      document.getElementById('kpi-source-main-view').textContent = mainView.name;
      document.getElementById('kpi-source-main-count').textContent = `Total: ${formatNumber(mainView.count)} baris`;
    }

    // Render Table dengan baris yang bisa diklik (view-row-clickable)
    tbody.innerHTML = data.views.map((v, idx) => {
      const isSelected = v.name === state.source.selectedView;
      const hasError = !!v.error;
      const statusBadge = hasError
        ? `<span class="badge badge-warning ml-2" title="${escapeHtml(v.error)}">⚠️ Binding Error</span>`
        : `<span class="badge badge-success ml-2">✓ Siap</span>`;

      return `
        <tr class="view-row-clickable ${isSelected ? 'active-row' : ''}" id="view-row-${v.name}" onclick="selectSourceView('${v.name}')">
          <td class="font-mono text-muted">${idx + 1}</td>
          <td>
            <strong>${v.name}</strong>
            ${v.name === 'v_migration_vendor' ? '<span class="badge badge-neutral ml-1">Main</span>' : ''}
            ${statusBadge}
          </td>
          <td class="font-mono text-muted">[${v.schema}]</td>
          <td class="font-mono font-bold">${hasError ? '-' : formatNumber(v.count)}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="event.stopPropagation(); selectSourceView('${v.name}')">
              Lihat Data
            </button>
          </td>
        </tr>
      `;
    }).join('');

    // Load initial view data
    if (state.source.selectedView) {
      loadSourceViewData();
    }
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="5" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

window.selectSourceView = function (viewName) {
  state.source.selectedView = viewName;
  state.source.page = 1;

  // Highlight baris terpilih
  document.querySelectorAll('#source-views-table-body tr').forEach((tr) => {
    tr.classList.remove('active-row');
  });
  const row = document.getElementById(`view-row-${viewName}`);
  if (row) row.classList.add('active-row');

  loadSourceViewData();
};

async function loadSourceViewData() {
  const viewName = state.source.selectedView;
  if (!viewName) return;

  document.getElementById('source-inspector-title').textContent = `Data Inspector: ${viewName}`;
  const thead = document.getElementById('source-data-thead');
  const tbody = document.getElementById('source-data-tbody');
  const alertEl = document.getElementById('source-view-alert');

  thead.innerHTML = `<tr><th class="text-center py-8 text-muted">Memuat struktur kolom & baris data...</th></tr>`;
  tbody.innerHTML = ``;

  try {
    const url = `/api/source/view-data?view=${encodeURIComponent(viewName)}&page=${state.source.page}&limit=${state.source.limit}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    state.source.total = data.total;
    state.source.totalPages = data.totalPages;
    state.source.columns = data.columns || [];
    state.source.rows = data.rows || [];

    // Tampilkan alert jika ada error binding
    if (data.error) {
      alertEl.className = 'alert-box-warning mb-4 p-4 rounded-md border text-sm';
      alertEl.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 0.25rem;">⚠️ Catatan Database SQL Server: View Binding Error</div>
        <div>${escapeHtml(data.error)}</div>
        <div style="margin-top: 0.35rem; font-size: 0.75rem; color: var(--text-secondary);">
          Struktur <strong>${data.columns.length} kolom</strong> di bawah tetap berhasil dibaca langsung dari metadata schema SQL Server.
        </div>
      `;
    } else {
      alertEl.className = 'hidden';
      alertEl.innerHTML = '';
    }

    // Meta bar
    document.getElementById('source-view-total-records').textContent = data.error ? '0 (Error)' : formatNumber(data.total);
    document.getElementById('source-view-col-count').textContent = data.columns.length;
    document.getElementById('source-view-page-indicator').textContent = `${data.page} / ${data.totalPages}`;

    // Pagination info & buttons
    const startIdx = (data.page - 1) * data.limit + 1;
    const endIdx = Math.min(data.page * data.limit, data.total);
    document.getElementById('source-pagination-info').textContent = data.total > 0
      ? `Menampilkan ${formatNumber(startIdx)} - ${formatNumber(endIdx)} dari total ${formatNumber(data.total)} baris`
      : (data.error ? 'Query data gagal karena kendala binding di SQL Server.' : '0 baris ditemukan.');

    document.getElementById('btn-source-prev').disabled = data.page <= 1;
    document.getElementById('btn-source-next').disabled = data.page >= data.totalPages;

    // Render interactive page numbers
    renderPaginationNumbers('source-page-numbers', data.page, data.totalPages, (newPage) => {
      state.source.page = newPage;
      loadSourceViewData();
    });

    // Render Columns (menyesuaikan secara dinamis dengan nama view terpilih)
    if (data.columns.length === 0) {
      thead.innerHTML = `<tr><th class="text-center py-6 text-muted">Tidak ada kolom yang terdeteksi.</th></tr>`;
      tbody.innerHTML = `<tr><td class="text-center py-8 text-muted">Kolom view tidak tersedia.</td></tr>`;
      return;
    }

    thead.innerHTML = `
      <tr>
        <th style="width: 45px;">#</th>
        ${data.columns.map((c) => `<th>${c.name} <span class="text-muted" style="font-size: 0.65rem">(${c.type})</span></th>`).join('')}
      </tr>
    `;

    // Render Rows
    if (data.rows.length === 0) {
      const msg = data.error
        ? `View tidak dapat mengembalikan baris data (${escapeHtml(data.error)})`
        : `View [dbo].[${viewName}] tidak memiliki record data saat ini.`;
      tbody.innerHTML = `<tr><td colspan="${data.columns.length + 1}" class="text-center py-8 text-muted">${msg}</td></tr>`;
      return;
    }

    tbody.innerHTML = data.rows.map((r, rIdx) => {
      const rowNum = (data.page - 1) * data.limit + rIdx + 1;
      const cells = data.columns.map((c) => {
        const val = r[c.name];
        if (val === null || val === undefined) return `<td><span class="text-muted font-italic">NULL</span></td>`;
        if (typeof val === 'boolean') return `<td><span class="badge ${val ? 'badge-success' : 'badge-danger'}">${val}</span></td>`;
        return `<td>${escapeHtml(String(val))}</td>`;
      }).join('');
      return `<tr><td class="font-mono text-muted">${rowNum}</td>${cells}</tr>`;
    }).join('');
  } catch (err) {
    thead.innerHTML = `<tr><th class="text-center py-8 text-rose">Gagal memuat data</th></tr>`;
    tbody.innerHTML = `<tr><td class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

/**
 * =========================================================================
 * MODUL 2: MONITORING CONFIG & PROSES ETL (etl_antam)
 * =========================================================================
 */
async function loadEtlOverview() {
  try {
    const res = await fetch('/api/etl/overview');
    const json = await res.json();
    if (!json.success) return;
    const data = json.data;
    state.etl.overview = data;

    document.getElementById('kpi-etl-total-runs').textContent = data.totalRuns;
    document.getElementById('kpi-etl-success-runs').textContent = data.successRuns;
    document.getElementById('kpi-etl-failed-runs').textContent = data.failedRuns;
    document.getElementById('kpi-etl-total-errors').textContent = data.totalErrors;
  } catch (e) {}
}

async function loadEtlRuns() {
  const tbody = document.getElementById('etl-runs-table-body');
  tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-muted">Memuat data migration_run...</td></tr>`;

  try {
    const res = await fetch('/api/etl/runs?limit=50');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    state.etl.runs = data.runs;

    if (data.runs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-muted">Belum ada riwayat run di table migration_run.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.runs.map((run) => {
      const isSuccess = run.status === 'SUCCESS' || run.status === 'COMPLETED';
      const isFailed = run.status === 'FAILED';
      const badgeClass = isSuccess ? 'badge-success' : (isFailed ? 'badge-danger' : 'badge-warning');
      const isFiltered = state.etl.selectedRunId == run.run_id;

      // Status Posting & Rollback badges
      const postBadge = run.is_posted
        ? `<span class="badge badge-success">✓ Posted (${escapeHtml(run.post_type || 'auto')})</span>`
        : `<span class="badge badge-neutral">Belum</span>`;

      const rollbackBadge = run.is_rolled_back
        ? `<span class="badge badge-danger">⚠️ Rolled Back</span>`
        : `<span class="badge badge-neutral">Normal</span>`;

      return `
        <tr class="${isFiltered ? 'active-row' : ''}">
          <td class="font-mono font-bold">#${run.run_id}</td>
          <td class="font-mono text-muted" style="font-size: 0.75rem;">${run.run_ts || '-'}</td>
          <td class="font-mono text-cyan" style="font-size: 0.75rem;">${run.main_workflow || '-'}</td>
          <td class="font-mono text-muted">${run.config_id ? `Config #${run.config_id}` : '-'}</td>
          <td><span class="badge ${badgeClass}">${run.status}</span></td>
          <td class="font-mono text-muted" style="font-size: 0.75rem;">${formatDate(run.start_time)}</td>
          <td class="font-mono">${run.duration_seconds ? run.duration_seconds + 's' : '-'}</td>
          <td>${postBadge}</td>
          <td>${rollbackBadge}</td>
          <td class="font-mono text-muted" style="font-size: 0.75rem;">${run.hop_host || '-'}</td>
          <td style="max-width: 200px;" class="text-muted" title="${escapeHtml(run.note || '')}">${escapeHtml(run.note || '-')}</td>
          <td>
            <button class="btn btn-secondary btn-sm" onclick="filterLogsByRun(${run.run_id})">
              Lihat Logs
            </button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

window.filterLogsByRun = function (runId) {
  state.etl.selectedRunId = runId;

  // Update desc and show reset button
  document.getElementById('steplogs-filter-desc').innerHTML = `Menampilkan log langkah untuk <strong>Run #${runId}</strong>`;
  document.getElementById('btn-clear-step-filter').classList.remove('hidden');

  document.getElementById('errorlogs-filter-desc').innerHTML = `Menampilkan log error untuk <strong>Run #${runId}</strong>`;
  document.getElementById('btn-clear-error-filter').classList.remove('hidden');

  // Jump to step logs subtab
  switchEtlSubtab('subtab-steplogs');
};

async function loadEtlStepLogs(runId = null) {
  const tbody = document.getElementById('etl-steps-table-body');
  tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-muted">Memuat data migration_step_log...</td></tr>`;

  try {
    let url = `/api/etl/step-logs?limit=100`;
    if (runId) url += `&runId=${runId}`;

    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-muted">Tidak ada log langkah ${runId ? `untuk Run #${runId}` : ''}.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map((s) => {
      const isSuccess = s.status === 'SUCCESS' || s.status === 'OK';
      const isFailed = s.status === 'FAILED';
      const badgeClass = isSuccess ? 'badge-success' : (isFailed ? 'badge-danger' : 'badge-warning');

      return `
        <tr>
          <td class="font-mono text-muted">${s.log_id}</td>
          <td class="font-mono font-bold">#${s.run_id}</td>
          <td class="font-mono text-cyan">${s.config_id ? `#${s.config_id}` : '-'}</td>
          <td><strong>${s.step_name}</strong></td>
          <td><span class="badge ${badgeClass}">${s.status}</span></td>
          <td class="font-mono">${s.rows_src ?? '-'}</td>
          <td class="font-mono">${s.rows_stg ?? '-'}</td>
          <td class="font-mono text-emerald">${s.rows_new ?? '-'}</td>
          <td class="font-mono text-amber">${s.rows_changed ?? '-'}</td>
          <td class="font-mono text-rose">${s.rows_deleted ?? '-'}</td>
          <td class="font-mono">${s.duration_seconds ? s.duration_seconds + 's' : '-'}</td>
          <td style="max-width: 250px;" class="text-muted" title="${escapeHtml(s.message || '')}">${escapeHtml(s.message || '-')}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

async function loadEtlErrorLogs(runId = null) {
  const tbody = document.getElementById('etl-errors-table-body');
  tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-muted">Memuat data migration_error_log...</td></tr>`;

  try {
    let url = `/api/etl/error-logs?limit=100`;
    if (runId) url += `&runId=${runId}`;

    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-muted">Tidak ada log error ${runId ? `pada Run #${runId}` : ''}.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.map((e) => {
      const rawJson = e.row_data ? (typeof e.row_data === 'object' ? JSON.stringify(e.row_data, null, 2) : String(e.row_data)) : '';
      return `
        <tr>
          <td class="font-mono text-muted">${e.error_id}</td>
          <td class="font-mono font-bold">#${e.run_id}</td>
          <td class="font-mono text-cyan">${e.config_id ? `#${e.config_id}` : '-'}</td>
          <td class="font-mono">${e.step_name || '-'}</td>
          <td><strong class="text-amber">${e.pipeline_name || e.transform_name || '-'}</strong></td>
          <td class="font-mono text-rose" style="font-size: 0.75rem;">${e.error_code || '-'}</td>
          <td class="font-mono text-muted" style="font-size: 0.75rem;">${formatDate(e.error_time)}</td>
          <td style="max-width: 250px;" class="text-rose"><strong>${escapeHtml(e.error_message || '')}</strong></td>
          <td class="font-mono text-amber">${e.error_field || '-'}</td>
          <td>
            ${rawJson ? `<button class="btn btn-secondary btn-sm" onclick="showJsonModal(${e.error_id})">Lihat JSON</button>` : '-'}
          </td>
        </tr>
      `;
    }).join('');

    state.etl.errorLogs = data;
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

window.showJsonModal = function (errorId) {
  const item = state.etl.errorLogs.find((e) => e.error_id == errorId);
  if (!item) return;

  const modal = document.getElementById('modal-json');
  const codePre = document.getElementById('modal-json-content');
  codePre.textContent = typeof item.row_data === 'object' ? JSON.stringify(item.row_data, null, 2) : item.row_data;
  modal.classList.remove('hidden');
};

async function loadEtlMasters() {
  try {
    const res = await fetch('/api/etl/configs');
    const json = await res.json();
    if (!json.success) return;
    const data = json.data;
    state.etl.masters = data;

    // Table 1: migration_config
    const tbodyCfg = document.getElementById('master-config-tbody');
    tbodyCfg.innerHTML = data.migration_config.map((c) => `
      <tr>
        <td class="font-mono font-bold">#${c.config_id}</td>
        <td class="font-mono">${c.exec_order}</td>
        <td><strong class="text-cyan">[${c.src_schema}].[${c.src_view}]</strong></td>
        <td><strong class="text-amber">stg_antam.${c.stg_table}</strong></td>
        <td><strong class="text-emerald">${c.tgt_schema}.${c.tgt_table}</strong></td>
        <td class="font-mono text-muted">${c.pk_columns}</td>
        <td class="font-mono text-muted" style="max-width: 150px; font-size: 0.7rem;" title="${escapeHtml(c.compare_columns || '')}">${escapeHtml(c.compare_columns || '-')}</td>
        <td class="font-mono text-muted">${c.id_column || '-'}: ${c.id_width || '-'} / ${c.id_seed || '-'}</td>
        <td><span class="badge ${c.is_active ? 'badge-success' : 'badge-danger'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
      </tr>
    `).join('');

    // Table 2: migration_convert_rule
    const tbodyRules = document.getElementById('master-rules-tbody');
    tbodyRules.innerHTML = data.migration_convert_rule.map((r) => `
      <tr>
        <td class="font-mono text-muted">#${r.rule_id}</td>
        <td class="font-mono">#${r.config_id}</td>
        <td><strong>${r.column_name}</strong></td>
        <td class="text-muted">${r.source_column || '-'}</td>
        <td class="text-cyan">${r.lookup_name || '-'}</td>
        <td class="text-muted">${r.master_table || '-'}</td>
        <td>${r.on_unmapped || '-'}</td>
        <td class="font-mono">${r.default_value || '-'}</td>
        <td><span class="badge ${r.normalize ? 'badge-success' : 'badge-neutral'}">${r.normalize ? 'Yes' : 'No'}</span></td>
        <td><span class="badge ${r.is_active ? 'badge-success' : 'badge-danger'}">${r.is_active ? 'Active' : 'Inactive'}</span></td>
      </tr>
    `).join('');

    // Table 3: migration_target_config
    const tbodyTargets = document.getElementById('master-targets-tbody');
    tbodyTargets.innerHTML = data.migration_target_config.map((t) => `
      <tr>
        <td class="font-mono text-muted">#${t.target_config_id}</td>
        <td class="font-mono">#${t.config_id}</td>
        <td class="font-mono">${t.exec_order}</td>
        <td><strong class="text-emerald">${t.tgt_schema}.${t.tgt_table}</strong></td>
        <td class="font-mono text-muted">${t.pk_columns}</td>
        <td class="font-mono text-muted" style="max-width: 200px; font-size: 0.7rem;" title="${escapeHtml(t.mapping_sql || '')}">${escapeHtml(t.mapping_sql || '-')}</td>
        <td class="font-mono text-muted" style="max-width: 150px; font-size: 0.7rem;" title="${escapeHtml(t.precheck_sql || '')}">${escapeHtml(t.precheck_sql || '-')}</td>
        <td class="font-mono text-muted" style="max-width: 150px; font-size: 0.7rem;" title="${escapeHtml(t.rollback_sql || '')}">${escapeHtml(t.rollback_sql || '-')}</td>
      </tr>
    `).join('');

    // Table 4: migration_lookup
    const tbodyLookups = document.getElementById('master-lookups-tbody');
    if (tbodyLookups && data.migration_lookup) {
      tbodyLookups.innerHTML = data.migration_lookup.map((l) => `
        <tr>
          <td><strong class="text-amber">${l.lookup_name}</strong></td>
          <td class="text-muted">${l.master_schema ? l.master_schema + '.' : ''}${l.master_table || '-'}</td>
          <td class="font-mono text-cyan">${l.master_src_col || '-'}</td>
          <td class="font-mono text-emerald">${l.master_tgt_col || '-'}</td>
          <td class="font-mono text-muted" style="max-width: 150px; font-size: 0.7rem;" title="${escapeHtml(l.master_filter || '')}">${escapeHtml(l.master_filter || '-')}</td>
          <td>${l.on_unmapped || '-'}</td>
          <td class="font-mono">${l.default_value || '-'}</td>
          <td><span class="badge ${l.normalize ? 'badge-success' : 'badge-neutral'}">${l.normalize ? 'Yes' : 'No'}</span></td>
          <td class="text-muted" style="font-size: 0.75rem;">${escapeHtml(l.description || '-')}</td>
        </tr>
      `).join('');
    }
  } catch (e) {}
}

/**
 * =========================================================================
 * MODUL 3: HASIL MIGRASI (PIPELINE 3-TIER RECONCILIATION)
 * =========================================================================
 */
/**
 * =========================================================================
 * MODUL 3: HASIL MIGRASI (BERDASARKAN MIGRATION_CONFIG)
 * =========================================================================
 */
async function loadPipelineReconciliation() {
  const masterTbody = document.getElementById('pipeline-master-tbody');
  masterTbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-muted">Mengambil data konfigurasi migration_config...</td></tr>`;

  try {
    const res = await fetch('/api/reconciliation/pipeline');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    state.pipeline.pipelines = data.pipelines;

    if (data.pipelines.length === 0) {
      masterTbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-muted">Belum ada data konfigurasi di etl_antam.migration_config.</td></tr>`;
      return;
    }

    // Render Master Table
    masterTbody.innerHTML = data.pipelines.map((p) => {
      const isSelected = p.configId === state.pipeline.selectedConfigId;
      const srcRows = p.source.rows ?? 0;
      const stgRows = p.staging.rows ?? 0;
      const tgtRows = p.target.rows ?? 0;

      const delta1 = p.reconciliation.deltaSourceToStaging;
      const isStage1Match = p.reconciliation.sourceToStagingStatus === 'MATCH';
      const statusBadge = isStage1Match
        ? `<span class="badge badge-success">✓ Sinkron (Delta 0)</span>`
        : `<span class="badge badge-warning">⏳ Selisih (${delta1 > 0 ? '+' : ''}${delta1})</span>`;

      return `
        <tr class="${isSelected ? 'active-row' : ''}" id="cfg-row-${p.configId}">
          <td class="font-mono font-bold">#${p.configId}</td>
          <td class="font-mono text-muted">${p.execOrder}</td>
          <td>
            <strong class="text-cyan">[${p.source.schema}].[${p.source.view}]</strong>
            <div class="text-muted" style="font-size: 0.7rem;">SQL Server (${formatNumber(srcRows)} baris)</div>
          </td>
          <td>
            <strong class="text-amber">stg_antam.${p.staging.table}</strong>
            <div class="text-muted" style="font-size: 0.7rem;">PostgreSQL (${formatNumber(stgRows)} baris)</div>
          </td>
          <td>
            <strong class="text-emerald">${p.target.schema}.${p.target.table}</strong>
            <div class="text-muted" style="font-size: 0.7rem;">PostgreSQL (${formatNumber(tgtRows)} baris)</div>
          </td>
          <td class="font-mono" style="font-size: 0.8125rem;">
            ${formatNumber(srcRows)} <span class="text-muted">➔</span> ${formatNumber(stgRows)} <span class="text-muted">➔</span> ${formatNumber(tgtRows)}
          </td>
          <td>${statusBadge}</td>
          <td>
            <span class="badge ${p.reconciliation.errorsLogged > 0 ? 'badge-danger' : 'badge-neutral'}">
              ${p.reconciliation.errorsLogged} errors
            </span>
          </td>
          <td>
            <div style="display: flex; gap: 0.35rem;">
              <button class="btn btn-secondary btn-sm" onclick="selectPipelineConfig(${p.configId})">
                Tinjau
              </button>
              <button class="btn btn-primary btn-sm" onclick="openBeritaAcara(${p.configId})" title="Cetak Berita Acara Validasi">
                🖨️ BA
              </button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Default select first config
    const targetConfigId = state.pipeline.selectedConfigId || data.pipelines[0].configId;
    selectPipelineConfig(targetConfigId);
  } catch (err) {
    masterTbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

window.selectPipelineConfig = function (configId) {
  state.pipeline.selectedConfigId = configId;

  // Highlight row in master table
  document.querySelectorAll('#pipeline-master-tbody tr').forEach((tr) => {
    tr.classList.remove('active-row');
  });
  const activeTr = document.getElementById(`cfg-row-${configId}`);
  if (activeTr) activeTr.classList.add('active-row');

  const p = state.pipeline.pipelines.find((x) => x.configId === configId);
  if (!p) return;

  // 1. Update Titles
  document.getElementById('pipeline-detail-title').textContent = `Detail Pipeline: Config #${p.configId} (${p.source.view})`;
  document.getElementById('pipeline-detail-desc').textContent = `Alur rekonsiliasi: [${p.source.schema}].[${p.source.view}] ➔ stg_antam.${p.staging.table} ➔ ${p.target.schema}.${p.target.table}`;
  document.getElementById('stage-inspector-title').textContent = `Data Inspector: Config #${p.configId} (${p.source.view})`;
  document.getElementById('config-rules-title').textContent = `Aturan Konversi untuk Config #${p.configId} (${p.source.view})`;

  // 2. Badges Header
  const delta1 = p.reconciliation.deltaSourceToStaging;
  const isMatch = p.reconciliation.sourceToStagingStatus === 'MATCH';
  document.getElementById('pipeline-detail-badges').innerHTML = `
    <span class="badge ${isMatch ? 'badge-success' : 'badge-warning'}">
      ${isMatch ? '✓ Source ➔ Staging Sinkron' : '⏳ Ada Selisih'}
    </span>
    <span class="badge ${p.isActive ? 'badge-neutral' : 'badge-danger'}">
      ${p.isActive ? 'Status: Active' : 'Status: Inactive'}
    </span>
  `;

  // 3. Update 3-Tier Stepper Flow Diagram
  const srcRows = p.source.rows ?? 0;
  const stgRows = p.staging.rows ?? 0;
  const tgtRows = p.target.rows ?? 0;
  const delta2 = p.reconciliation.deltaStagingToTarget;

  document.getElementById('pipeline-flow-diagram').innerHTML = `
    <!-- Node 1: Source -->
    <div class="pipeline-node source">
      <div class="node-stage-label text-cyan">1. Source View (SQL Server)</div>
      <div class="node-table-name">[${p.source.schema}].[${p.source.view}]</div>
      <div class="node-rows-val">${formatNumber(srcRows)}</div>
      <div class="node-db-meta">Database: antam_scm</div>
    </div>

    <!-- Arrow 1 -->
    <div class="pipeline-arrow">
      <span class="arrow-symbol">➔</span>
      <span class="arrow-delta ${delta1 === 0 ? 'text-emerald' : 'text-amber'}">
        ${delta1 === 0 ? 'Match' : (delta1 > 0 ? '+' + delta1 : delta1)}
      </span>
    </div>

    <!-- Node 2: Staging -->
    <div class="pipeline-node staging">
      <div class="node-stage-label text-amber">2. Staging Table (PostgreSQL)</div>
      <div class="node-table-name">stg_antam.${p.staging.table}</div>
      <div class="node-rows-val">${formatNumber(stgRows)}</div>
      <div class="node-db-meta">Database: db_procsi</div>
    </div>

    <!-- Arrow 2 -->
    <div class="pipeline-arrow">
      <span class="arrow-symbol">➔</span>
      <span class="arrow-delta text-cyan">
        ${delta2 >= 0 ? '+' + formatNumber(delta2) : formatNumber(delta2)}
      </span>
    </div>

    <!-- Node 3: Target -->
    <div class="pipeline-node target">
      <div class="node-stage-label text-emerald">3. Final Target (PostgreSQL)</div>
      <div class="node-table-name">${p.target.schema}.${p.target.table}</div>
      <div class="node-rows-val">${formatNumber(tgtRows)}</div>
      <div class="node-db-meta">Database: db_procsi</div>
    </div>
  `;

  // 4. Update Technical Parameters Cards
  document.getElementById('pipeline-params-container').innerHTML = `
    <div class="param-card">
      <div class="param-label">Primary Key Column (pk_columns)</div>
      <div class="param-val text-cyan">${escapeHtml(p.metadata.pkColumns || '-')}</div>
    </div>

    <div class="param-card">
      <div class="param-label">Compare Columns</div>
      <div class="param-val" style="font-size: 0.75rem;">${escapeHtml(p.metadata.compareColumns || '-')}</div>
    </div>

    <div class="param-card">
      <div class="param-label">ID Generator Rule</div>
      <div class="param-val text-emerald">
        Kolom: ${p.metadata.idColumn || '-'} | Width: ${p.metadata.idWidth || '-'} | Seed: ${p.metadata.idSeed || '-'}
      </div>
    </div>

    <div class="param-card">
      <div class="param-label">Exec Order & Status</div>
      <div class="param-val">Urutan: ${p.execOrder} | ${p.isActive ? 'Active' : 'Inactive'}</div>
    </div>

    ${p.metadata.srcPrecheckSql ? `
      <div class="precheck-box">
        <div class="precheck-header">
          <span>Source Precheck SQL (src_precheck_sql)</span>
        </div>
        <div class="precheck-code">${escapeHtml(p.metadata.srcPrecheckSql)}</div>
      </div>
    ` : ''}
  `;

  // 5. Update dinamis label tombol stage & sinkronkan status active
  const btnSrc = document.getElementById('stage-btn-source');
  const btnStg = document.getElementById('stage-btn-staging');
  const btnTgt = document.getElementById('stage-btn-target');
  if (btnSrc) btnSrc.innerHTML = `<span>1. Source View (${p.source.view || 'SQL Server'})</span>`;
  if (btnStg) btnStg.innerHTML = `<span>2. Staging Table (stg_antam.${p.staging.table || 'stg'})</span>`;
  if (btnTgt) btnTgt.innerHTML = `<span>3. Final Target (${p.target.schema}.${p.target.table})</span>`;

  document.querySelectorAll('.stage-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-stage') === state.pipeline.selectedStage);
  });

  // 6. Load Associated Rules & Step Logs
  loadConfigDetails(configId);

  // 7. Load 3-Stage Data Inspector
  state.pipeline.page = 1;
  loadPipelineStageData();
};

async function loadConfigDetails(configId) {
  const tbodyRules = document.getElementById('config-rules-tbody');
  tbodyRules.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-muted">Memuat aturan konversi...</td></tr>`;

  try {
    const res = await fetch(`/api/reconciliation/config-details?configId=${configId}`);
    const json = await res.json();
    if (!json.success) return;
    const data = json.data;

    // 1. Render Kartu Informasi Eksekusi Terkait (migration_run)
    const runBadgeEl = document.getElementById('pipeline-run-badge');
    const runGridEl = document.getElementById('pipeline-run-summary-grid');
    const latestRun = data.latestRun;
    const runsList = data.runs || [];

    if (latestRun) {
      const isSuccess = latestRun.status === 'SUCCESS' || latestRun.status === 'COMPLETED';
      const isFailed = latestRun.status === 'FAILED';
      const badgeCls = isSuccess ? 'badge-success' : (isFailed ? 'badge-danger' : 'badge-warning');

      runBadgeEl.innerHTML = `
        <span class="badge ${badgeCls}">${latestRun.status}</span>
        <span class="badge badge-neutral ml-2">Run #${latestRun.run_id}</span>
      `;

      runGridEl.innerHTML = `
        <div class="param-card">
          <div class="param-label">Run ID & Timestamp</div>
          <div class="param-val text-cyan font-mono">#${latestRun.run_id} • ${latestRun.run_ts || '-'}</div>
        </div>

        <div class="param-card">
          <div class="param-label">Workflow & Hop Host</div>
          <div class="param-val text-emerald font-mono">${latestRun.main_workflow || '-'} (${latestRun.hop_host || '-'})</div>
        </div>

        <div class="param-card">
          <div class="param-label">Waktu Eksekusi & Durasi</div>
          <div class="param-val font-mono" style="font-size: 0.75rem;">
            ${formatDate(latestRun.start_time)} s/d ${formatDate(latestRun.end_time)} (${latestRun.duration_seconds ? latestRun.duration_seconds + 's' : '-'})
          </div>
        </div>

        <div class="param-card">
          <div class="param-label">Status Posting & Rollback</div>
          <div class="param-val">
            <span class="badge ${latestRun.is_posted ? 'badge-success' : 'badge-neutral'}">${latestRun.is_posted ? '✓ Posted (' + (latestRun.post_type || 'auto') + ')' : 'Belum Diposting'}</span>
            ${latestRun.is_rolled_back ? '<span class="badge badge-danger ml-1">⚠️ Rolled Back</span>' : ''}
          </div>
        </div>

        <div class="param-card" style="grid-column: 1 / -1;">
          <div class="param-label">Catatan Eksekusi (Hop Note)</div>
          <div class="param-val text-muted" style="font-size: 0.8125rem;">${escapeHtml(latestRun.note || '-')}</div>
        </div>

        ${runsList.length > 1 ? `
          <div class="param-card" style="grid-column: 1 / -1; overflow-x: auto;">
            <div class="param-label mb-2">Riwayat ${runsList.length} Eksekusi Terakhir Terkait Config #${configId}:</div>
            <table class="mini-run-table">
              <thead>
                <tr>
                  <th>Run ID</th>
                  <th>Timestamp</th>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Durasi</th>
                  <th>Posting</th>
                  <th>Catatan</th>
                </tr>
              </thead>
              <tbody>
                ${runsList.map((r) => `
                  <tr>
                    <td class="font-mono font-bold">#${r.run_id}</td>
                    <td class="font-mono text-muted">${r.run_ts || '-'}</td>
                    <td class="font-mono text-cyan">${r.main_workflow || '-'}</td>
                    <td><span class="badge ${r.status === 'SUCCESS' ? 'badge-success' : (r.status === 'FAILED' ? 'badge-danger' : 'badge-warning')}">${r.status}</span></td>
                    <td class="font-mono">${r.duration_seconds ? r.duration_seconds + 's' : '-'}</td>
                    <td>${r.is_posted ? '<span class="text-emerald">✓ Posted</span>' : '<span class="text-muted">-</span>'}</td>
                    <td class="text-muted" style="max-width: 250px;">${escapeHtml(r.note || '-')}</td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        ` : ''}
      `;
    } else {
      runBadgeEl.innerHTML = `<span class="badge badge-neutral">Belum Ada Riwayat Run</span>`;
      runGridEl.innerHTML = `<div class="p-4 text-muted text-center" style="grid-column: 1 / -1;">Belum ada log eksekusi migration_run yang tercatat untuk konfigurasi ini.</div>`;
    }

    // 2. Render Conversion Rules
    if (data.rules.length === 0) {
      tbodyRules.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-muted">Tidak ada aturan khusus di migration_convert_rule untuk Config #${configId}.</td></tr>`;
      return;
    }

    tbodyRules.innerHTML = data.rules.map((r) => `
      <tr>
        <td class="font-mono text-muted">#${r.rule_id}</td>
        <td><strong class="text-emerald">${r.column_name}</strong></td>
        <td class="text-cyan">${r.source_column || '-'}</td>
        <td class="font-mono text-amber">${r.lookup_name || '-'}</td>
        <td class="text-muted">${r.master_table || '-'}</td>
        <td>${r.on_unmapped || '-'}</td>
        <td class="font-mono">${r.default_value || '-'}</td>
        <td><span class="badge ${r.normalize ? 'badge-success' : 'badge-neutral'}">${r.normalize ? 'Yes' : 'No'}</span></td>
      </tr>
    `).join('');
  } catch (e) {
    tbodyRules.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-rose">Gagal memuat aturan konversi.</td></tr>`;
  }
}

async function loadPipelineStageData() {
  const configId = state.pipeline.selectedConfigId;
  const stage = state.pipeline.selectedStage;

  // Pastikan tombol stage active sinkron secara visual
  document.querySelectorAll('.stage-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-stage') === stage);
  });

  const thead = document.getElementById('stage-data-thead');
  const tbody = document.getElementById('stage-data-tbody');
  const alertBox = document.getElementById('stage-alert-box');

  thead.innerHTML = `<tr><th class="text-center py-8 text-muted">Memuat baris data ${stage}...</th></tr>`;
  tbody.innerHTML = `<tr><td class="text-center py-8 text-muted">Mengambil data dari database...</td></tr>`;

  document.getElementById('stage-meta-location').textContent = `Memuat data (${stage})...`;
  document.getElementById('stage-meta-total').textContent = '...';
  document.getElementById('stage-meta-page').textContent = '...';
  document.getElementById('stage-pagination-info').textContent = `Sedang mengambil data baris...`;
  document.getElementById('btn-stage-prev').disabled = true;
  document.getElementById('btn-stage-next').disabled = true;

  try {
    const url = `/api/reconciliation/stage-data?configId=${configId}&stage=${stage}&page=${state.pipeline.page}&limit=${state.pipeline.limit}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    state.pipeline.page = data.page || 1;
    state.pipeline.limit = data.limit || 25;
    state.pipeline.total = data.total || 0;
    state.pipeline.totalPages = data.totalPages || 1;
    state.pipeline.columns = data.columns || [];
    state.pipeline.rows = data.rows || [];

    // Tampilkan alert jika tabel belum ada atau ada error
    if (data.tableExists === false) {
      alertBox.className = 'alert-box-warning mb-4 p-4 rounded-md border text-sm';
      alertBox.innerHTML = `
        <div class="font-bold mb-1">⚠️ Tabel Belum Tersedia di Database PostgreSQL</div>
        <div>${escapeHtml(data.message || 'Tabel pada tahapan ini belum dibuat di PostgreSQL.')}</div>
      `;
      thead.innerHTML = `<tr><th class="text-center py-4 text-muted">Tabel Belum Dibuat</th></tr>`;
      tbody.innerHTML = `<tr><td class="text-center py-8 text-muted">${escapeHtml(data.message || 'Tabel belum tersedia.')}</td></tr>`;
      
      document.getElementById('stage-meta-location').textContent = data.location;
      document.getElementById('stage-meta-total').textContent = '0 (Belum dibuat)';
      document.getElementById('stage-meta-page').textContent = '1 / 1';
      document.getElementById('stage-pagination-info').textContent = 'Tabel staging/target belum dibuat di database.';
      document.getElementById('btn-stage-prev').disabled = true;
      document.getElementById('btn-stage-next').disabled = true;
      document.getElementById('stage-page-numbers').innerHTML = '';
      return;
    } else if (data.error) {
      alertBox.className = 'alert-box-warning mb-4 p-4 rounded-md border text-sm';
      alertBox.innerHTML = `
        <div class="font-bold mb-1">⚠️ Kendala Akses Data Database</div>
        <div>${escapeHtml(data.error)}</div>
      `;
    } else {
      alertBox.className = 'hidden';
      alertBox.innerHTML = '';
    }

    document.getElementById('stage-meta-location').textContent = data.location;
    document.getElementById('stage-meta-total').textContent = formatNumber(data.total);
    document.getElementById('stage-meta-page').textContent = `${data.page} / ${data.totalPages}`;

    const startIdx = data.total > 0 ? (data.page - 1) * data.limit + 1 : 0;
    const endIdx = Math.min(data.page * data.limit, data.total);
    document.getElementById('stage-pagination-info').textContent = data.total > 0
      ? `Menampilkan ${formatNumber(startIdx)} - ${formatNumber(endIdx)} dari total ${formatNumber(data.total)} baris`
      : '0 baris ditemukan.';

    document.getElementById('btn-stage-prev').disabled = data.page <= 1;
    document.getElementById('btn-stage-next').disabled = data.page >= data.totalPages;

    // Render interactive numeric page buttons
    renderPaginationNumbers('stage-page-numbers', data.page, data.totalPages, (newPage) => {
      state.pipeline.page = newPage;
      loadPipelineStageData();
    });

    // Header
    if (data.columns.length === 0) {
      thead.innerHTML = `<tr><th class="text-center py-6 text-muted">Tidak ada kolom yang terdeteksi.</th></tr>`;
      tbody.innerHTML = `<tr><td class="text-center py-8 text-muted">Tabel belum memiliki definisi kolom.</td></tr>`;
      return;
    }

    thead.innerHTML = `
      <tr>
        <th style="width: 45px;">#</th>
        ${data.columns.map((c) => `<th>${c.name} <span class="text-muted" style="font-size: 0.65rem">(${c.type})</span></th>`).join('')}
      </tr>
    `;

    // Body
    if (data.rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${data.columns.length + 1}" class="text-center py-8 text-muted">Tabel pada tahapan ini tidak memiliki baris data.</td></tr>`;
      return;
    }

    tbody.innerHTML = data.rows.map((r, rIdx) => {
      const rowNum = (data.page - 1) * data.limit + rIdx + 1;
      const cells = data.columns.map((c) => {
        const val = r[c.name];
        if (val === null || val === undefined) return `<td><span class="text-muted font-italic">NULL</span></td>`;
        if (typeof val === 'boolean') return `<td><span class="badge ${val ? 'badge-success' : 'badge-danger'}">${val}</span></td>`;
        return `<td>${escapeHtml(String(val))}</td>`;
      }).join('');
      return `<tr><td class="font-mono text-muted">${rowNum}</td>${cells}</tr>`;
    }).join('');
  } catch (err) {
    thead.innerHTML = `<tr><th class="text-center py-8 text-rose">Gagal memuat data</th></tr>`;
    tbody.innerHTML = `<tr><td class="text-center py-8 text-rose">${escapeHtml(err.message)}</td></tr>`;
    document.getElementById('stage-meta-location').textContent = `Gagal Memuat (${stage})`;
    document.getElementById('stage-meta-total').textContent = '0';
    document.getElementById('stage-meta-page').textContent = '1 / 1';
    document.getElementById('stage-pagination-info').textContent = `Error: ${escapeHtml(err.message)}`;
    document.getElementById('btn-stage-prev').disabled = true;
    document.getElementById('btn-stage-next').disabled = true;
    document.getElementById('stage-page-numbers').innerHTML = '';
  }
}

// Interactive Numeric Pagination Helper
function renderPaginationNumbers(containerId, currentPage, totalPages, onPageClick) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!totalPages || totalPages < 1) {
    container.innerHTML = '';
    return;
  }

  // Jika hanya ada 1 halaman, tetap render nomor 1 aktif agar pengguna melihat tombol halaman secara utuh
  if (totalPages === 1) {
    container.innerHTML = `<button class="page-num-btn active" data-page="1" disabled style="opacity: 0.95; cursor: default;">1</button>`;
    return;
  }

  const pages = [];
  if (totalPages <= 7) {
    for (let i = 1; i <= totalPages; i++) pages.push(i);
  } else {
    pages.push(1);
    if (currentPage > 3) pages.push('...');

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(totalPages - 1, currentPage + 1);
    for (let i = start; i <= end; i++) {
      if (!pages.includes(i)) pages.push(i);
    }

    if (currentPage < totalPages - 2) pages.push('...');
    if (!pages.includes(totalPages)) pages.push(totalPages);
  }

  container.innerHTML = pages.map((p) => {
    if (p === '...') {
      return `<span class="page-num-ellipsis">…</span>`;
    }
    const isActive = p === currentPage;
    return `<button class="page-num-btn ${isActive ? 'active' : ''}" data-page="${p}">${p}</button>`;
  }).join('');

  container.querySelectorAll('.page-num-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const p = parseInt(btn.getAttribute('data-page'), 10);
      if (p && p !== currentPage) {
        onPageClick(p);
      }
    });
  });
}

// Helpers
function formatNumber(num) {
  if (num === null || num === undefined) return '-';
  return new Intl.NumberFormat('id-ID').format(num);
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('id-ID', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  } catch (e) {
    return isoStr;
  }
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * =========================================================================
 * CETAK BERITA ACARA VALIDASI & LAMPIRAN DATA STAGING
 * =========================================================================
 */
window.openBeritaAcara = async function (configId) {
  const targetId = configId || state.pipeline.selectedConfigId || 1;
  const modal = document.getElementById('modal-berita-acara');
  modal.classList.remove('hidden');

  document.getElementById('ba-status-badge').textContent = 'Memuat data...';
  document.getElementById('ba-status-badge').className = 'badge badge-warning';
  document.getElementById('ba-body-daydate').textContent = 'Memuat data validasi...';
  document.getElementById('ba-reconciliation-tbody').innerHTML = `<tr><td colspan="5" class="text-center py-4 text-muted">Mengambil data rekonsiliasi dan lampiran staging...</td></tr>`;
  document.getElementById('ba-attachment-thead').innerHTML = '';
  document.getElementById('ba-attachment-tbody').innerHTML = `<tr><td class="text-center py-4 text-muted">Memuat data lampiran staging...</td></tr>`;

  try {
    const res = await fetch(`/api/reconciliation/berita-acara?configId=${targetId}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    state.beritaAcaraData = data;

    // Header info
    document.getElementById('ba-status-badge').textContent = data.document.verdict;
    document.getElementById('ba-status-badge').className = `badge ${data.document.isSynced ? 'badge-success' : 'badge-warning'}`;
    document.getElementById('ba-doc-info').textContent = `${data.document.docNumber} • ${data.config.source.view} ➔ ${data.config.staging.table}`;
    document.getElementById('ba-print-docnum').textContent = data.document.docNumber;
    document.getElementById('ba-print-date').textContent = data.document.dateString;
    document.getElementById('ba-body-daydate').textContent = `${data.document.dateString} pukul ${data.document.timeString} WIB`;

    // Metadata parameter
    document.getElementById('ba-cfg-id').textContent = `Config #${data.config.configId}`;
    document.getElementById('ba-cfg-order').textContent = data.config.execOrder;
    document.getElementById('ba-cfg-source').textContent = `SQL Server [${data.config.source.database}].[${data.config.source.schema}].[${data.config.source.view}]`;
    document.getElementById('ba-cfg-staging').textContent = `PostgreSQL ${data.config.staging.database}.${data.config.staging.schema}.${data.config.staging.table}`;
    document.getElementById('ba-cfg-target').textContent = `PostgreSQL ${data.config.target.database}.${data.config.target.schema}.${data.config.target.table}`;
    document.getElementById('ba-cfg-pk').textContent = data.config.pkColumns || 'id';
    document.getElementById('ba-cfg-compare').textContent = data.config.compareColumns || '-';
    document.getElementById('ba-cfg-idrule').textContent = `Kolom: ${data.config.idColumn || '-'} (Width: ${data.config.idWidth || '-'}, Seed: ${data.config.idSeed || '-'})`;

    // Reconciliation table
    const srcRows = data.config.source.rows ?? 0;
    const stgRows = data.config.staging.rows ?? 0;
    const tgtRows = data.config.target.rows ?? 0;
    const delta1 = data.config.deltaSourceToStaging;
    const delta2 = data.config.deltaStagingToTarget;

    const isMatch = delta1 === 0 && srcRows > 0;
    document.getElementById('ba-reconciliation-tbody').innerHTML = `
      <tr>
        <td><strong>1. Sumber Data (Source)</strong></td>
        <td><code>[${data.config.source.schema}].[${data.config.source.view}]</code> (SQL Server)</td>
        <td><strong>${formatNumber(srcRows)}</strong> baris</td>
        <td>- (Basis)</td>
        <td><span class="badge badge-neutral">Basis Sumber</span></td>
      </tr>
      <tr>
        <td><strong>2. Penampungan (Staging)</strong></td>
        <td><code>${data.config.staging.schema}.${data.config.staging.table}</code> (PostgreSQL)</td>
        <td><strong>${formatNumber(stgRows)}</strong> baris</td>
        <td>${delta1 === 0 ? '0' : (delta1 > 0 ? '+' + delta1 : delta1)}</td>
        <td><span class="badge ${isMatch ? 'badge-success' : 'badge-warning'}">${isMatch ? '✓ 100% Sinkron (Valid)' : '⏳ Ada Selisih'}</span></td>
      </tr>
      <tr>
        <td><strong>3. Hasil Akhir (Final Target)</strong></td>
        <td><code>${data.config.target.schema}.${data.config.target.table}</code> (PostgreSQL)</td>
        <td><strong>${formatNumber(tgtRows)}</strong> baris</td>
        <td>${delta2 >= 0 ? '+' + formatNumber(delta2) : formatNumber(delta2)}</td>
        <td><span class="badge badge-success">Target Aktif</span></td>
      </tr>
    `;

    // Verdict box
    document.getElementById('ba-verdict-container').innerHTML = `
      <div class="ba-verdict-title">KESIMPULAN HASIL VALIDASI: ${data.document.verdict}</div>
      <p class="ba-verdict-desc">
        Berdasarkan rekonsiliasi data, sebanyak <strong>${formatNumber(srcRows)}</strong> baris data pada Source View berhasil diekstrak dan dicocokkan ke dalam Staging Table <code>${data.config.staging.schema}.${data.config.staging.table}</code> sebanyak <strong>${formatNumber(stgRows)}</strong> baris. Selisih data (delta) tercatat <strong>${delta1}</strong> baris. ${data.document.isSynced ? 'Seluruh record data terverifikasi identik dan memenuhi kriteria integritas migrasi.' : 'Terdapat selisih data yang memerlukan peninjauan lebih lanjut.'}
      </p>
    `;

    // Staging Attachment Heading & Table
    document.getElementById('ba-attachment-heading').textContent = `REKAPITULASI DATA STAGING (${data.stagingAttachment.schema}.${data.stagingAttachment.table})`;
    document.getElementById('ba-attachment-meta').textContent = `Total data staging: ${formatNumber(data.stagingAttachment.totalRecords)} baris (${data.stagingAttachment.displayedRecords} record ditampilkan pada lembar ini).`;

    const cols = data.stagingAttachment.columns;
    const rows = data.stagingAttachment.rows;

    // Pick primary columns
    const preferredCols = ['id', 'uuid', 'name', 'email', 'status', 'sap_code', 'tipe_vendor', 'company_type_id', 'created_at'];
    const activeCols = cols.filter(c => preferredCols.includes(c.name)).concat(cols.filter(c => !preferredCols.includes(c.name))).slice(0, 10);

    document.getElementById('ba-attachment-thead').innerHTML = `
      <tr>
        <th style="width: 35px; text-align: center;">No</th>
        ${activeCols.map(c => `<th>${c.name}</th>`).join('')}
      </tr>
    `;

    if (rows.length === 0) {
      document.getElementById('ba-attachment-tbody').innerHTML = `<tr><td colspan="${activeCols.length + 1}" class="text-center py-4 text-muted">Tidak ada data pada tabel staging.</td></tr>`;
    } else {
      document.getElementById('ba-attachment-tbody').innerHTML = rows.map((r, idx) => {
        const cells = activeCols.map(c => {
          const val = r[c.name];
          if (val === null || val === undefined) return '<span style="color: #94a3b8; font-style: italic;">NULL</span>';
          if (typeof val === 'boolean') return val ? 'TRUE' : 'FALSE';
          return escapeHtml(String(val));
        }).join('</td><td>');
        return `<tr><td style="text-align: center; font-weight: bold;">${idx + 1}</td><td>${cells}</td></tr>`;
      }).join('');
    }
  } catch (err) {
    document.getElementById('ba-reconciliation-tbody').innerHTML = `<tr><td colspan="5" class="text-center py-4 text-rose">Gagal memuat berita acara: ${err.message}</td></tr>`;
  }
};

function exportStagingCsv() {
  if (!state.beritaAcaraData || !state.beritaAcaraData.stagingAttachment) {
    alert('Data lampiran staging belum tersedia.');
    return;
  }

  const { table, columns, rows } = state.beritaAcaraData.stagingAttachment;
  if (!rows || rows.length === 0) {
    alert('Tidak ada data staging untuk diekspor.');
    return;
  }

  const colNames = columns.map(c => c.name);
  const csvRows = [];
  
  // Header
  csvRows.push(colNames.map(c => `"${c}"`).join(','));

  // Rows
  rows.forEach(r => {
    const values = colNames.map(c => {
      let val = r[c];
      if (val === null || val === undefined) return '""';
      if (typeof val === 'object') val = JSON.stringify(val);
      const strVal = String(val).replace(/"/g, '""');
      return `"${strVal}"`;
    });
    csvRows.push(values.join(','));
  });

  const blob = new Blob([csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `BA_Lampiran_Staging_${table}_Config_${state.beritaAcaraData.config.configId}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
