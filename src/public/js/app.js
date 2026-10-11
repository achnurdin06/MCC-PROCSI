// =========================================================================
// STATE APLIKASI
// =========================================================================
const state = {
  activeTab: 'tab-source',
  activeConfigSubtab: 'subtab-cfg-main',
  activeProcessSubtab: 'subtab-runs',
  activeSettingTab: 'setting-tab-clients',
  health: null,

  // Global Context (Client, Environment, Connections)
  clients: [],
  selectedClientId: null,
  environments: [],
  selectedEnvId: null,
  connections: [],
  activeSourceConnection: null,
  activeTargetConnection: null,
  selectedSourceConnectionId: null,

  // Wizard state
  wizardStep: 1,

  // Modul 1: Source Data
  source: {
    views: [],
    selectedView: null,
    page: 1,
    limit: 25,
    totalPages: 1,
    total: 0,
    columns: [],
    rows: [],
  },

  // Modul 2: Migration Config
  config: {
    masters: null,
    editingTable: null,
    editingId: null,
    tables: {
      main: { page: 1, limit: 10, sortBy: 'exec_order', sortDir: 'asc', search: '' },
      rules: { page: 1, limit: 10, sortBy: 'rule_id', sortDir: 'asc', search: '' },
      targets: { page: 1, limit: 10, sortBy: 'exec_order', sortDir: 'asc', search: '' },
      lookups: { page: 1, limit: 10, sortBy: 'lookup_name', sortDir: 'asc', search: '' },
    },
  },

  // Modul 3: Migration Proses
  process: {
    overview: null,
    runs: [],
    selectedRunId: null,
    stepLogs: [],
    errorLogs: [],
    page: 1,
    limit: 50,
    status: '',
    sortBy: 'run_id',
    sortDir: 'DESC',
    total: 0,
    totalPages: 1,
    // Step Logs Pagination & Sort
    stepLogsState: {
      page: 1,
      limit: 50,
      status: '',
      sortBy: 'log_id',
      sortDir: 'DESC',
      total: 0,
      totalPages: 1,
    },
    // Error Logs Pagination & Sort
    errorLogsState: {
      page: 1,
      limit: 50,
      sortBy: 'error_id',
      sortDir: 'DESC',
      total: 0,
      totalPages: 1,
    },
  },

  // Modul 4: Hasil Migrasi (Pipeline)
  pipeline: {
    pipelines: [],
    selectedConfigId: null,
    selectedStage: 'staging',
    page: 1,
    limit: 25,
    totalPages: 1,
    total: 0,
    columns: [],
    rows: [],
    location: '',
  },

  // Berita Acara
  beritaAcaraData: null,

  // Universal Delete Target
  deleteTarget: null,
};

// =========================================================================
// INISIALISASI
// =========================================================================
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  initApplication();
});

async function initApplication() {
  await checkHealth();
  await checkSystemInitialization();
}

async function checkSystemInitialization() {
  try {
    const res = await fetch('/api/context/status');
    const json = await res.json();
    const navWelcome = document.getElementById('nav-btn-welcome');
    const welcomeGate = document.getElementById('welcome-setup-gate');
    const welcomeInfo = document.getElementById('welcome-info-dashboard');
    
    if (json.success && !json.data.isInitialized) {
      // Sistem belum terinisialisasi: Tampilkan portal setup gate
      state.isInitialized = false;
      if (navWelcome) navWelcome.style.display = '';
      if (welcomeGate) welcomeGate.classList.remove('hidden');
      if (welcomeInfo) welcomeInfo.classList.add('hidden');
      updateWelcomeStatusBadge(false);
      switchMainTab('tab-welcome');
    } else {
      // Sistem sudah terinisialisasi: Sesuai instruksi user, Selamat Datang disembunyikan
      state.isInitialized = true;
      if (navWelcome) navWelcome.style.display = 'none';
      if (welcomeGate) welcomeGate.classList.add('hidden');
      if (welcomeInfo) welcomeInfo.classList.remove('hidden');
      updateWelcomeStatusBadge(true);
      await loadContextClientsAndEnvironments();
      switchMainTab('tab-source');
    }
  } catch (err) {
    console.warn('Cek inisialisasi gagal:', err.message);
    switchMainTab('tab-source');
  }
}

// =========================================================================
// EVENT LISTENERS SETUP
// =========================================================================
function setupEventListeners() {
  // Main Tabs Navigation
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-tab');
      switchMainTab(tabId);
    });
  });

  // Config Subtabs
  document.querySelectorAll('#tab-config .sub-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subtabId = btn.getAttribute('data-subtab');
      switchConfigSubtab(subtabId);
    });
  });

  // Process Subtabs
  document.querySelectorAll('#tab-process .sub-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const subtabId = btn.getAttribute('data-subtab');
      switchProcessSubtab(subtabId);
    });
  });

  // Setting Subtabs
  document.querySelectorAll('[data-setting-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-setting-tab');
      switchSettingTab(tabId);
    });
  });

  // Header Context Selectors (Single Source of Truth)
  const selClient = document.getElementById('header-select-client');
  if (selClient) {
    selClient.addEventListener('change', async (e) => {
      state.selectedClientId = e.target.value ? parseInt(e.target.value, 10) : null;
      resetVolatileStateAndUI();
      await loadContextEnvironments(state.selectedClientId);
      await resolveEnvironmentConnections(state.selectedEnvId);
      loadCurrentTab();
    });
  }

  const selEnv = document.getElementById('header-select-env');
  if (selEnv) {
    selEnv.addEventListener('change', async (e) => {
      state.selectedEnvId = e.target.value ? parseInt(e.target.value, 10) : null;
      resetVolatileStateAndUI();
      await resolveEnvironmentConnections(state.selectedEnvId);
      loadCurrentTab();
    });
  }

  // Refresh All (Live Health & Reload Current Tab)
  document.getElementById('btn-refresh-all').addEventListener('click', async () => {
    resetVolatileStateAndUI();
    await resolveEnvironmentConnections(state.selectedEnvId);
    loadCurrentTab();
  });

  // Open Settings Modal
  document.getElementById('btn-open-settings').addEventListener('click', () => {
    openSettingsModal();
  });

  document.getElementById('btn-close-settings').addEventListener('click', () => {
    document.getElementById('modal-settings').classList.add('hidden');
  });

  document.getElementById('btn-done-settings').addEventListener('click', async () => {
    document.getElementById('modal-settings').classList.add('hidden');
    await loadContextClientsAndEnvironments();
    loadCurrentTab();
  });

  // Settings Subtabs Filter Listeners
  initSettingFilterListeners();

  // Tab 1: Source View Controls
  document.getElementById('btn-refresh-views').addEventListener('click', () => loadSourceViews());
  document.getElementById('btn-sync-all-views').addEventListener('click', () => syncAllViews());
  document.getElementById('btn-open-create-view').addEventListener('click', () => openViewEditor());
  document.getElementById('btn-close-view-editor').addEventListener('click', () => closeViewEditor());
  document.getElementById('btn-ve-cancel').addEventListener('click', () => closeViewEditor());
  document.getElementById('btn-ve-validate').addEventListener('click', () => validateViewQuery());
  document.getElementById('btn-ve-save').addEventListener('click', () => saveOrExecuteView());

  document.getElementById('select-source-limit').addEventListener('change', (e) => {
    state.source.limit = parseInt(e.target.value, 10);
    state.source.page = 1;
    loadSourceViewData();
  });

  document.getElementById('btn-reload-view-data').addEventListener('click', () => loadSourceViewData());
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

  // Tab 2: Config Controls & Pagination
  document.getElementById('btn-refresh-configs').addEventListener('click', () => loadEtlMasters());

  ['main', 'rules', 'targets', 'lookups'].forEach((key) => {
    const searchEl = document.getElementById(`search-config-${key}`);
    if (searchEl) {
      searchEl.addEventListener('input', (e) => {
        state.config.tables[key].search = e.target.value.trim().toLowerCase();
        state.config.tables[key].page = 1;
        renderConfigTable(key);
      });
    }

    const limitEl = document.getElementById(`limit-config-${key}`);
    if (limitEl) {
      limitEl.addEventListener('change', (e) => {
        state.config.tables[key].limit = parseInt(e.target.value, 10) || 10;
        state.config.tables[key].page = 1;
        renderConfigTable(key);
      });
    }

    const prevEl = document.getElementById(`btn-cfg-${key}-prev`);
    if (prevEl) {
      prevEl.addEventListener('click', () => {
        if (state.config.tables[key].page > 1) {
          state.config.tables[key].page--;
          renderConfigTable(key);
        }
      });
    }

    const nextEl = document.getElementById(`btn-cfg-${key}-next`);
    if (nextEl) {
      nextEl.addEventListener('click', () => {
        state.config.tables[key].page++;
        renderConfigTable(key);
      });
    }
  });

  // Sortable headers on Tab 2
  document.querySelectorAll('th[data-cfg-table]').forEach((th) => {
    th.addEventListener('click', () => {
      const tKey = th.dataset.cfgTable;
      const col = th.dataset.col;
      if (!tKey || !col || !state.config.tables[tKey]) return;

      if (state.config.tables[tKey].sortBy === col) {
        state.config.tables[tKey].sortDir = state.config.tables[tKey].sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        state.config.tables[tKey].sortBy = col;
        state.config.tables[tKey].sortDir = 'asc';
      }
      renderConfigTable(tKey);
    });
  });

  // Tab 3: Process Controls & Pagination
  document.getElementById('btn-refresh-runs').addEventListener('click', () => loadEtlRuns());

  const filterRunsStatus = document.getElementById('filter-runs-status');
  if (filterRunsStatus) {
    filterRunsStatus.addEventListener('change', (e) => {
      state.process.status = e.target.value;
      state.process.page = 1;
      loadEtlRuns();
    });
  }

  const limitRunsSelect = document.getElementById('limit-runs-select');
  if (limitRunsSelect) {
    limitRunsSelect.addEventListener('change', (e) => {
      state.process.limit = parseInt(e.target.value, 10) || 50;
      state.process.page = 1;
      loadEtlRuns();
    });
  }

  const btnRunsPrev = document.getElementById('btn-runs-prev');
  if (btnRunsPrev) {
    btnRunsPrev.addEventListener('click', () => {
      if (state.process.page > 1) {
        state.process.page--;
        loadEtlRuns();
      }
    });
  }

  const btnRunsNext = document.getElementById('btn-runs-next');
  if (btnRunsNext) {
    btnRunsNext.addEventListener('click', () => {
      if (state.process.page < state.process.totalPages) {
        state.process.page++;
        loadEtlRuns();
      }
    });
  }

  // Sortable headers on Tab 3 (Runs)
  document.querySelectorAll('th[data-run-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.runCol;
      if (!col) return;
      if (state.process.sortBy === col) {
        state.process.sortDir = state.process.sortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        state.process.sortBy = col;
        state.process.sortDir = 'DESC';
      }
      loadEtlRuns();
    });
  });

  document.getElementById('btn-clear-step-filter').addEventListener('click', () => {
    state.process.selectedRunId = null;
    state.process.stepLogsState.page = 1;
    document.getElementById('btn-clear-step-filter').classList.add('hidden');
    document.getElementById('steplogs-filter-desc').textContent = 'Menampilkan seluruh riwayat langkah proses ETL';
    loadEtlStepLogs();
  });
  document.getElementById('btn-clear-error-filter').addEventListener('click', () => {
    state.process.selectedRunId = null;
    state.process.errorLogsState.page = 1;
    document.getElementById('btn-clear-error-filter').classList.add('hidden');
    document.getElementById('errorlogs-filter-desc').textContent = 'Rincian error transformasi dan sampel data baris bermasalah';
    loadEtlErrorLogs();
  });

  // Step Logs Controls
  const btnRefreshStep = document.getElementById('btn-refresh-steplogs');
  if (btnRefreshStep) {
    btnRefreshStep.addEventListener('click', () => loadEtlStepLogs(state.process.selectedRunId));
  }
  const filterStepStatus = document.getElementById('filter-steplogs-status');
  if (filterStepStatus) {
    filterStepStatus.addEventListener('change', (e) => {
      state.process.stepLogsState.status = e.target.value;
      state.process.stepLogsState.page = 1;
      loadEtlStepLogs(state.process.selectedRunId);
    });
  }
  const limitStepSelect = document.getElementById('limit-steplogs-select');
  if (limitStepSelect) {
    limitStepSelect.addEventListener('change', (e) => {
      state.process.stepLogsState.limit = parseInt(e.target.value, 10) || 50;
      state.process.stepLogsState.page = 1;
      loadEtlStepLogs(state.process.selectedRunId);
    });
  }
  const btnStepPrev = document.getElementById('btn-steplogs-prev');
  if (btnStepPrev) {
    btnStepPrev.addEventListener('click', () => {
      if (state.process.stepLogsState.page > 1) {
        state.process.stepLogsState.page--;
        loadEtlStepLogs(state.process.selectedRunId);
      }
    });
  }
  const btnStepNext = document.getElementById('btn-steplogs-next');
  if (btnStepNext) {
    btnStepNext.addEventListener('click', () => {
      if (state.process.stepLogsState.page < state.process.stepLogsState.totalPages) {
        state.process.stepLogsState.page++;
        loadEtlStepLogs(state.process.selectedRunId);
      }
    });
  }
  document.querySelectorAll('th[data-step-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.stepCol;
      if (!col) return;
      const s = state.process.stepLogsState;
      if (s.sortBy === col) {
        s.sortDir = s.sortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        s.sortBy = col;
        s.sortDir = 'DESC';
      }
      loadEtlStepLogs(state.process.selectedRunId);
    });
  });

  // Error Logs Controls
  const btnRefreshError = document.getElementById('btn-refresh-errorlogs');
  if (btnRefreshError) {
    btnRefreshError.addEventListener('click', () => loadEtlErrorLogs(state.process.selectedRunId));
  }
  const limitErrorSelect = document.getElementById('limit-errorlogs-select');
  if (limitErrorSelect) {
    limitErrorSelect.addEventListener('change', (e) => {
      state.process.errorLogsState.limit = parseInt(e.target.value, 10) || 50;
      state.process.errorLogsState.page = 1;
      loadEtlErrorLogs(state.process.selectedRunId);
    });
  }
  const btnErrorPrev = document.getElementById('btn-errorlogs-prev');
  if (btnErrorPrev) {
    btnErrorPrev.addEventListener('click', () => {
      if (state.process.errorLogsState.page > 1) {
        state.process.errorLogsState.page--;
        loadEtlErrorLogs(state.process.selectedRunId);
      }
    });
  }
  const btnErrorNext = document.getElementById('btn-errorlogs-next');
  if (btnErrorNext) {
    btnErrorNext.addEventListener('click', () => {
      if (state.process.errorLogsState.page < state.process.errorLogsState.totalPages) {
        state.process.errorLogsState.page++;
        loadEtlErrorLogs(state.process.selectedRunId);
      }
    });
  }
  document.querySelectorAll('th[data-error-col]').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.dataset.errorCol;
      if (!col) return;
      const s = state.process.errorLogsState;
      if (s.sortBy === col) {
        s.sortDir = s.sortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        s.sortBy = col;
        s.sortDir = 'DESC';
      }
      loadEtlErrorLogs(state.process.selectedRunId);
    });
  });

  // Tab 4: Pipeline Controls
  document.getElementById('btn-refresh-pipeline').addEventListener('click', () => loadPipelineReconciliation());

  document.querySelectorAll('.stage-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const stage = e.currentTarget.getAttribute('data-stage');
      if (!stage) return;
      document.querySelectorAll('.stage-btn').forEach((b) => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.pipeline.selectedStage = stage;
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

  // Modal CRUD Universal
  document.getElementById('btn-close-crud-modal').addEventListener('click', () => {
    document.getElementById('modal-config-form').classList.add('hidden');
  });
  document.getElementById('btn-crud-cancel').addEventListener('click', () => {
    document.getElementById('modal-config-form').classList.add('hidden');
  });
  document.getElementById('form-universal-crud').addEventListener('submit', (e) => handleCrudSubmit(e));

  // Modal Delete Confirm
  document.getElementById('btn-close-delete-modal').addEventListener('click', () => {
    document.getElementById('modal-delete-confirm').classList.add('hidden');
  });
  document.getElementById('btn-delete-cancel').addEventListener('click', () => {
    document.getElementById('modal-delete-confirm').classList.add('hidden');
  });
  document.getElementById('btn-delete-proceed').addEventListener('click', () => executeDeleteConfirm());

  // Modal JSON Error View
  const btnCloseModal = document.getElementById('btn-close-modal');
  if (btnCloseModal) {
    btnCloseModal.addEventListener('click', () => {
      document.getElementById('modal-json').classList.add('hidden');
    });
  }

  // Wizard Navigation (Welcome Page)
  const btnWzPrev = document.getElementById('btn-wz-prev');
  if (btnWzPrev) btnWzPrev.addEventListener('click', () => prevWizardStep());

  const btnWzNext = document.getElementById('btn-wz-next');
  if (btnWzNext) btnWzNext.addEventListener('click', () => nextWizardStep());

  const btnWzFinish = document.getElementById('btn-wz-finish');
  if (btnWzFinish) btnWzFinish.addEventListener('click', () => finishWizard());

  // Test Ping Source & Target Database on Step 3
  const btnWzTestSrc = document.getElementById('btn-wz-test-src');
  if (btnWzTestSrc) {
    btnWzTestSrc.addEventListener('click', async () => {
      const fb = document.getElementById('wz-src-test-feedback');
      btnWzTestSrc.disabled = true;
      btnWzTestSrc.textContent = 'Menguji...';
      fb.classList.remove('hidden');
      fb.className = 'text-xs mt-2 p-2 rounded border bg-surface text-cyan';
      fb.textContent = 'Sedang menguji koneksi SQL Server (Source)...';

      const connData = {
        db_type: 'MSSQL',
        host: document.getElementById('wz-src-host').value.trim(),
        port: parseInt(document.getElementById('wz-src-port').value.trim(), 10) || 1433,
        database_name: document.getElementById('wz-src-db').value.trim(),
        username: document.getElementById('wz-src-user').value.trim(),
        password: document.getElementById('wz-src-pass').value.trim(),
        use_ssh_tunnel: true,
        ssh_host: document.getElementById('wz-src-host').value.trim(),
        ssh_port: 22,
        ssh_user: 'developer',
        ssh_password: '***REDACTED***',
      };

      try {
        const res = await fetch('/api/context/connections/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(connData),
        });
        const json = await res.json();
        if (json.success) {
          fb.className = 'text-xs mt-2 p-2 rounded border bg-emerald-950/30 text-emerald-400 border-emerald-800';
          fb.innerHTML = `✓ Koneksi SQL Server Berhasil! (Latency: ${json.latencyMs || 0}ms)`;
        } else {
          fb.className = 'text-xs mt-2 p-2 rounded border bg-rose-950/30 text-rose-400 border-rose-800';
          fb.innerHTML = `⚠️ Respon Server: ${escapeHtml(json.error || 'Gagal tersambung')}`;
        }
      } catch (err) {
        fb.className = 'text-xs mt-2 p-2 rounded border bg-rose-950/30 text-rose-400 border-rose-800';
        fb.textContent = `Error: ${err.message}`;
      } finally {
        btnWzTestSrc.disabled = false;
        btnWzTestSrc.textContent = '⚡ Uji Koneksi Source';
      }
    });
  }

  const btnWzTestTgt = document.getElementById('btn-wz-test-tgt');
  if (btnWzTestTgt) {
    btnWzTestTgt.addEventListener('click', async () => {
      const fb = document.getElementById('wz-tgt-test-feedback');
      btnWzTestTgt.disabled = true;
      btnWzTestTgt.textContent = 'Menguji...';
      fb.classList.remove('hidden');
      fb.className = 'text-xs mt-2 p-2 rounded border bg-surface text-indigo';
      fb.textContent = 'Sedang menguji koneksi PostgreSQL (Target)...';

      const connData = {
        db_type: 'POSTGRESQL',
        host: document.getElementById('wz-tgt-host').value.trim(),
        port: parseInt(document.getElementById('wz-tgt-port').value.trim(), 10) || 5433,
        database_name: document.getElementById('wz-tgt-db').value.trim(),
        username: document.getElementById('wz-tgt-user').value.trim(),
        password: document.getElementById('wz-tgt-pass').value.trim(),
        use_ssh_tunnel: false,
      };

      try {
        const res = await fetch('/api/context/connections/test', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(connData),
        });
        const json = await res.json();
        if (json.success) {
          fb.className = 'text-xs mt-2 p-2 rounded border bg-emerald-950/30 text-emerald-400 border-emerald-800';
          fb.innerHTML = `✓ Koneksi PostgreSQL Berhasil! Latency: ${json.latencyMs || 0}ms • Versi: ${escapeHtml(json.version || '-')}`;
        } else {
          fb.className = 'text-xs mt-2 p-2 rounded border bg-rose-950/30 text-rose-400 border-rose-800';
          fb.innerHTML = `⚠️ Respon Server: ${escapeHtml(json.error || 'Gagal tersambung')}`;
        }
      } catch (err) {
        fb.className = 'text-xs mt-2 p-2 rounded border bg-rose-950/30 text-rose-400 border-rose-800';
        fb.textContent = `Error: ${err.message}`;
      } finally {
        btnWzTestTgt.disabled = false;
        btnWzTestTgt.textContent = '⚡ Uji Koneksi Target';
      }
    });
  }

  // Welcome Page Navigation Buttons
  const btnOpenWelcome = document.getElementById('btn-open-welcome');
  if (btnOpenWelcome) {
    btnOpenWelcome.addEventListener('click', () => switchMainTab('tab-welcome'));
  }

  const btnGotoHome = document.getElementById('btn-goto-home');
  if (btnGotoHome) {
    btnGotoHome.addEventListener('click', () => switchMainTab('tab-source'));
  }

  const btnWelcomeOpenSettings = document.getElementById('btn-welcome-open-settings');
  if (btnWelcomeOpenSettings) {
    btnWelcomeOpenSettings.addEventListener('click', () => openSettingsModal());
  }

  // Global Dialog Handlers: Klik Backdrop Luar untuk Menutup Modal
  document.querySelectorAll('.modal-overlay').forEach((overlay) => {
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) {
        overlay.classList.add('hidden');
      }
    });
  });

  // Global Dialog Handlers: Tombol Escape Menutup Modal Teratas
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modalIds = [
        'modal-delete-confirm',
        'modal-json',
        'modal-config-form',
        'modal-view-editor',
        'modal-settings',
        'modal-berita-acara',
      ];
      for (const id of modalIds) {
        const el = document.getElementById(id);
        if (el && !el.classList.contains('hidden')) {
          el.classList.add('hidden');
          break;
        }
      }
    }
  });

  // Modal Berita Acara Events
  const btnOpenBa = document.getElementById('btn-open-ba');
  if (btnOpenBa) {
    btnOpenBa.addEventListener('click', () => openBeritaAcara(state.pipeline.selectedConfigId));
  }
  const btnCloseBa = document.getElementById('btn-close-ba');
  if (btnCloseBa) {
    btnCloseBa.addEventListener('click', () => document.getElementById('modal-berita-acara').classList.add('hidden'));
  }
  const btnPrintBa = document.getElementById('btn-print-ba');
  if (btnPrintBa) {
    btnPrintBa.addEventListener('click', () => window.print());
  }
  const btnExportCsv = document.getElementById('btn-export-stg-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => exportStagingCsv());
  }
}

function setupSearchFilter(inputId, tbodyId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase().trim();
    const rows = document.querySelectorAll(`#${tbodyId} tr`);
    rows.forEach((row) => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(q) ? '' : 'none';
    });
  });
}

// =========================================================================
// TAB SWITCHING LOGIC
// =========================================================================
function switchMainTab(tabId) {
  if (tabId === 'tab-welcome' && state.isInitialized) {
    tabId = 'tab-source';
  }
  state.activeTab = tabId;
  document.querySelectorAll('.nav-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-tab') === tabId);
  });
  document.querySelectorAll('.tab-pane').forEach((p) => {
    p.classList.toggle('active', p.id === tabId);
  });

  loadCurrentTab();
}

function loadCurrentTab() {
  const tabId = state.activeTab;
  if (tabId === 'tab-welcome') {
    loadWelcomeView();
  } else if (tabId === 'tab-source') {
    loadSourceViews();
  } else if (tabId === 'tab-config') {
    loadEtlMasters();
  } else if (tabId === 'tab-process') {
    loadEtlOverview();
    loadEtlRuns();
    if (state.activeProcessSubtab === 'subtab-steplogs') {
      loadEtlStepLogs(state.process.selectedRunId);
    } else if (state.activeProcessSubtab === 'subtab-errorlogs') {
      loadEtlErrorLogs(state.process.selectedRunId);
    }
  } else if (tabId === 'tab-pipeline') {
    loadPipelineReconciliation();
  }
}

function switchConfigSubtab(subtabId) {
  state.activeConfigSubtab = subtabId;
  document.querySelectorAll('#tab-config .sub-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-subtab') === subtabId);
  });
  document.querySelectorAll('#tab-config .subtab-content').forEach((c) => {
    c.classList.toggle('active', c.id === subtabId);
  });
}

function switchProcessSubtab(subtabId) {
  state.activeProcessSubtab = subtabId;
  document.querySelectorAll('#tab-process .sub-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-subtab') === subtabId);
  });
  document.querySelectorAll('#tab-process .subtab-content').forEach((c) => {
    c.classList.toggle('active', c.id === subtabId);
  });

  if (subtabId === 'subtab-steplogs') {
    loadEtlStepLogs(state.process.selectedRunId);
  } else if (subtabId === 'subtab-errorlogs') {
    loadEtlErrorLogs(state.process.selectedRunId);
  }
}

function switchSettingTab(tabId) {
  state.activeSettingTab = tabId;
  document.querySelectorAll('[data-setting-tab]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-setting-tab') === tabId);
  });
  document.querySelectorAll('.setting-tab-content').forEach((c) => {
    c.classList.toggle('active', c.id === tabId);
  });

  if (tabId === 'setting-tab-clients') {
    loadSettingsClients();
  } else if (tabId === 'setting-tab-environments') {
    loadSettingsEnvironments();
  } else if (tabId === 'setting-tab-connections') {
    loadSettingsConnections();
  }
}

/**
 * Mereset seluruh state modul dan DOM element saat Client atau Environment berubah
 * Mencegah data lama tersisa / efek seperti cache antar Client & Environment
 */
function resetVolatileStateAndUI() {
  // 1. Reset Module 1 State & UI
  state.source.views = [];
  state.source.selectedView = null;
  state.source.page = 1;
  state.source.total = 0;
  state.source.totalPages = 1;
  state.source.columns = [];
  state.source.rows = [];

  const elMainView = document.getElementById('kpi-source-main-view');
  if (elMainView) elMainView.textContent = '-';
  const elMainCount = document.getElementById('kpi-source-main-count');
  if (elMainCount) elMainCount.textContent = '0 baris';
  const elInspTitle = document.getElementById('source-inspector-title');
  if (elInspTitle) elInspTitle.textContent = 'Data Inspector';
  const elSrcTotalRec = document.getElementById('source-view-total-records');
  if (elSrcTotalRec) elSrcTotalRec.textContent = '0';
  const elSrcColCount = document.getElementById('source-view-col-count');
  if (elSrcColCount) elSrcColCount.textContent = '0';
  const elSrcPageInd = document.getElementById('source-view-page-indicator');
  if (elSrcPageInd) elSrcPageInd.textContent = '1/1';
  const elSrcPagInfo = document.getElementById('source-pagination-info');
  if (elSrcPagInfo) elSrcPagInfo.textContent = '0 baris';
  const elSrcPageNums = document.getElementById('source-page-numbers');
  if (elSrcPageNums) elSrcPageNums.innerHTML = '';
  const elSrcThead = document.getElementById('source-data-thead');
  if (elSrcThead) elSrcThead.innerHTML = '<tr><th>Pilih view pada tabel di sebelah kiri</th></tr>';
  const elSrcTbody = document.getElementById('source-data-tbody');
  if (elSrcTbody) elSrcTbody.innerHTML = '<tr><td class="text-center py-8 text-muted">Belum ada view yang dimuat.</td></tr>';
  const elSrcAlert = document.getElementById('source-view-alert');
  if (elSrcAlert) elSrcAlert.className = 'hidden';

  // 2. Reset Module 2 State & UI
  state.config.masters = null;
  const cfgKpis = ['kpi-cfg-total-configs', 'kpi-cfg-total-rules', 'kpi-cfg-total-targets', 'kpi-cfg-total-lookups'];
  cfgKpis.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
  const elCfgTbody = document.getElementById('master-config-tbody');
  if (elCfgTbody) elCfgTbody.innerHTML = '<tr><td colspan="15" class="text-center py-8 text-muted">Memuat data konfigurasi...</td></tr>';
  const elRulesTbody = document.getElementById('master-rules-tbody');
  if (elRulesTbody) elRulesTbody.innerHTML = '<tr><td colspan="11" class="text-center py-8 text-muted">Memuat aturan konversi...</td></tr>';
  const elTgtsTbody = document.getElementById('master-targets-tbody');
  if (elTgtsTbody) elTgtsTbody.innerHTML = '<tr><td colspan="12" class="text-center py-8 text-muted">Memuat target config...</td></tr>';
  const elLookupsTbody = document.getElementById('master-lookups-tbody');
  if (elLookupsTbody) elLookupsTbody.innerHTML = '<tr><td colspan="11" class="text-center py-8 text-muted">Memuat data lookup...</td></tr>';

  // 3. Reset Module 3 State & UI
  state.process.overview = null;
  state.process.runs = [];
  state.process.selectedRunId = null;
  state.process.stepLogs = [];
  state.process.errorLogs = [];
  const procKpis = ['kpi-etl-total-runs', 'kpi-etl-success-runs', 'kpi-etl-failed-runs', 'kpi-etl-total-errors'];
  procKpis.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = '0';
  });
  const elStepDesc = document.getElementById('steplogs-filter-desc');
  if (elStepDesc) elStepDesc.textContent = 'Menampilkan seluruh riwayat langkah proses ETL';
  const elBtnClearStep = document.getElementById('btn-clear-step-filter');
  if (elBtnClearStep) elBtnClearStep.classList.add('hidden');
  const elErrDesc = document.getElementById('errorlogs-filter-desc');
  if (elErrDesc) elErrDesc.textContent = 'Rincian error transformasi dan sampel data baris bermasalah';
  const elBtnClearErr = document.getElementById('btn-clear-error-filter');
  if (elBtnClearErr) elBtnClearErr.classList.add('hidden');
  const elRunsTbody = document.getElementById('etl-runs-table-body');
  if (elRunsTbody) elRunsTbody.innerHTML = '<tr><td colspan="14" class="text-center py-8 text-muted">Memuat riwayat migration_run...</td></tr>';
  const elStepsTbody = document.getElementById('etl-steps-table-body');
  if (elStepsTbody) elStepsTbody.innerHTML = '<tr><td colspan="12" class="text-center py-8 text-muted">Belum ada log langkah.</td></tr>';
  const elErrsTbody = document.getElementById('etl-errors-table-body');
  if (elErrsTbody) elErrsTbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-muted">Belum ada log error.</td></tr>';

  // 4. Reset Module 4 State & UI
  state.pipeline.pipelines = [];
  state.pipeline.selectedConfigId = null;
  state.pipeline.page = 1;
  state.pipeline.total = 0;
  state.pipeline.totalPages = 1;
  state.pipeline.columns = [];
  state.pipeline.rows = [];
  const elPipeMaster = document.getElementById('pipeline-master-tbody');
  if (elPipeMaster) elPipeMaster.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-muted">Memuat data rekonsiliasi...</td></tr>';
  const elPipeTitle = document.getElementById('pipeline-detail-title');
  if (elPipeTitle) elPipeTitle.textContent = 'Detail Pipeline';
  const elPipeDesc = document.getElementById('pipeline-detail-desc');
  if (elPipeDesc) elPipeDesc.textContent = 'Memuat alur rekonsiliasi...';
  const elPipeBadges = document.getElementById('pipeline-detail-badges');
  if (elPipeBadges) elPipeBadges.innerHTML = '';
  const elPipeFlow = document.getElementById('pipeline-flow-diagram');
  if (elPipeFlow) elPipeFlow.innerHTML = '<div class="text-center py-8 text-muted" style="width: 100%;">Memuat alur pipeline...</div>';
  const elStageLoc = document.getElementById('stage-location-badge');
  if (elStageLoc) elStageLoc.textContent = 'Tabel: -';
  const elStageTotal = document.getElementById('stage-total-records');
  if (elStageTotal) elStageTotal.textContent = '0';
  const elStagePagInfo = document.getElementById('stage-pagination-info');
  if (elStagePagInfo) elStagePagInfo.textContent = '0 baris ditemukan.';
  const elStagePages = document.getElementById('stage-page-numbers');
  if (elStagePages) elStagePages.innerHTML = '';
  const elStageThead = document.getElementById('stage-data-thead');
  if (elStageThead) elStageThead.innerHTML = '<tr><th>Pilih pipeline untuk melihat sampel data</th></tr>';
  const elStageTbody = document.getElementById('stage-data-tbody');
  if (elStageTbody) elStageTbody.innerHTML = '<tr><td class="text-center py-8 text-muted">Data tahap belum dimuat.</td></tr>';
}

// =========================================================================
// HEALTH CHECK
// =========================================================================
async function checkHealth() {
  const mssqlBadge = document.getElementById('mssql-status');
  const pgBadge = document.getElementById('pg-status');
  const mssqlMeta = document.getElementById('mssql-meta');
  const pgMeta = document.getElementById('pg-meta');

  mssqlBadge.className = 'db-badge loading';
  pgBadge.className = 'db-badge loading';
  mssqlMeta.textContent = 'Memeriksa...';
  pgMeta.textContent = 'Memeriksa...';

  try {
    const res = await fetch('/api/health');
    const json = await res.json();
    state.health = json;

    const data = json.data || json;
    const m = data.sqlserver || data.mssql;
    if (m && m.connected) {
      mssqlBadge.className = 'db-badge connected';
      mssqlMeta.textContent = `${m.database} • ${m.latencyMs}ms`;
      mssqlMeta.title = `Host: ${m.host || 'SQL Server'} (Connected)`;
    } else {
      mssqlBadge.className = 'db-badge error';
      const errText = m?.error ? (m.error.length > 25 ? m.error.slice(0, 22) + '...' : m.error) : 'Disconnected';
      mssqlMeta.textContent = errText;
      mssqlMeta.title = m?.error || 'SQL Server Disconnected';
    }

    const p = data.postgres;
    if (p && p.connected) {
      pgBadge.className = 'db-badge connected';
      pgMeta.textContent = `${p.database} • ${p.latencyMs}ms`;
      pgMeta.title = `Host: ${p.host || 'PostgreSQL'} (Connected)`;
    } else {
      pgBadge.className = 'db-badge error';
      const errText = p?.error ? (p.error.length > 25 ? p.error.slice(0, 22) + '...' : p.error) : 'Disconnected';
      pgMeta.textContent = errText;
      pgMeta.title = p?.error || 'PostgreSQL Disconnected';
    }
  } catch (err) {
    mssqlBadge.className = 'db-badge error';
    pgBadge.className = 'db-badge error';
    mssqlMeta.textContent = 'Koneksi gagal';
    pgMeta.textContent = 'Koneksi gagal';
  }
}

// =========================================================================
// CONTEXT CLIENTS & ENVIRONMENTS LOADER & AUTO-RESOLUTION
// =========================================================================
async function loadContextClientsAndEnvironments() {
  try {
    const clientRes = await fetch('/api/context/clients');
    const clientJson = await clientRes.json();
    if (clientJson.success) {
      state.clients = clientJson.data;
      renderHeaderClientOptions();
    }

    if (state.clients.length > 0) {
      if (!state.selectedClientId) state.selectedClientId = state.clients[0].client_id;
      const selClient = document.getElementById('header-select-client');
      if (selClient) selClient.value = state.selectedClientId;
      await loadContextEnvironments(state.selectedClientId);
      await resolveEnvironmentConnections(state.selectedEnvId);
    }
  } catch (e) {
    console.warn('Gagal memuat context client:', e.message);
  }
}

function renderHeaderClientOptions() {
  const sel = document.getElementById('header-select-client');
  if (!sel) return;
  if (state.clients.length === 0) {
    sel.innerHTML = '<option value="">(Belum ada Client)</option>';
    return;
  }
  sel.innerHTML = state.clients.map((c) => `
    <option value="${c.client_id}">[${escapeHtml(c.client_code)}] ${escapeHtml(c.client_name)}</option>
  `).join('');
}

async function loadContextEnvironments(clientId) {
  const sel = document.getElementById('header-select-env');
  if (!sel) return;
  sel.innerHTML = '<option value="">Memuat...</option>';

  try {
    const url = clientId ? `/api/context/environments?clientId=${clientId}` : `/api/context/environments`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    state.environments = json.data;
    if (state.environments.length === 0) {
      sel.innerHTML = '<option value="">(Belum ada Env)</option>';
      state.selectedEnvId = null;
      await resolveEnvironmentConnections(null);
      return;
    }

    sel.innerHTML = state.environments.map((e) => `
      <option value="${e.env_id}">[${escapeHtml(e.env_code)}] ${escapeHtml(e.env_name)}</option>
    `).join('');

    if (!state.selectedEnvId || !state.environments.some((e) => e.env_id === state.selectedEnvId)) {
      state.selectedEnvId = state.environments[0].env_id;
    }
    sel.value = state.selectedEnvId;
  } catch (err) {
    sel.innerHTML = '<option value="">Gagal memuat env</option>';
  }
}

/**
 * Otomatis mengambil database connection (SOURCE & TARGET) terkait Environment terpilih di Header,
 * menguji status koneksi live, dan meng-update header subtitle serta indikator tab 1.
 */
async function resolveEnvironmentConnections(envId) {
  if (!envId) {
    state.activeSourceConnection = null;
    state.activeTargetConnection = null;
    state.selectedSourceConnectionId = null;
    updateHeaderConnectionUI(null, null);
    return;
  }

  try {
    const res = await fetch(`/api/context/environments/${envId}/health`);
    const json = await res.json();
    if (!json.success) return;

    const healthData = json.data;
    state.activeSourceConnection = healthData.source;
    state.activeTargetConnection = healthData.target;
    state.selectedSourceConnectionId = healthData.source?.connection_id || null;

    updateHeaderConnectionUI(healthData.source, healthData.target);
  } catch (err) {
    console.warn('Gagal resolve koneksi environment:', err.message);
  }
}

function updateHeaderConnectionUI(source, target) {
  // 1. Subtitle Header Brand Kiri Atas
  const srcTypeEl = document.getElementById('hdr-source-type');
  const srcMetaEl = document.getElementById('hdr-source-meta');
  const tgtTypeEl = document.getElementById('hdr-target-type');
  const tgtMetaEl = document.getElementById('hdr-target-meta');

  if (srcTypeEl) srcTypeEl.textContent = source?.db_type || 'SQL Server';
  if (srcMetaEl) srcMetaEl.textContent = source ? `${source.database}.${source.db_schema}` : 'belum ada source';
  if (tgtTypeEl) tgtTypeEl.textContent = target?.db_type || 'PostgreSQL';
  if (tgtMetaEl) tgtMetaEl.textContent = target ? `${target.database}.${target.db_schema}` : 'belum ada target';

  // 2. Badges Status Database Header Kanan Atas
  const mssqlBadge = document.getElementById('mssql-status');
  const mssqlMeta = document.getElementById('mssql-meta');
  const pgBadge = document.getElementById('pg-status');
  const pgMeta = document.getElementById('pg-meta');

  if (mssqlBadge && mssqlMeta) {
    if (source && source.connected) {
      mssqlBadge.className = 'db-badge connected';
      mssqlMeta.textContent = `${source.database} • ${source.latencyMs}ms`;
      mssqlMeta.title = `Host: ${source.host}:${source.port} (${source.version || 'Connected'})`;
    } else {
      mssqlBadge.className = 'db-badge error';
      const errStr = source ? (source.error ? (source.error.length > 25 ? source.error.slice(0, 22) + '...' : source.error) : 'Disconnected') : 'No Source Conn';
      mssqlMeta.textContent = errStr;
      mssqlMeta.title = source?.error || 'Tidak terhubung';
    }
  }

  if (pgBadge && pgMeta) {
    if (target && target.connected) {
      pgBadge.className = 'db-badge connected';
      pgMeta.textContent = `${target.database} • ${target.latencyMs}ms`;
      pgMeta.title = `Host: ${target.host}:${target.port} (${target.version || 'Connected'})`;
    } else {
      pgBadge.className = 'db-badge error';
      const errStr = target ? (target.error ? (target.error.length > 25 ? target.error.slice(0, 22) + '...' : target.error) : 'Disconnected') : 'No Target Conn';
      pgMeta.textContent = errStr;
      pgMeta.title = target?.error || 'Tidak terhubung';
    }
  }

  // 3. Tab 1 Source Badge
  const srcBadge = document.getElementById('source-connection-badge');
  if (srcBadge) {
    if (source && source.connection_id) {
      srcBadge.className = 'badge badge-info text-xs';
      srcBadge.textContent = `${source.db_type} • ${source.database} (${source.db_schema}) [${source.host}:${source.port}]`;
    } else {
      srcBadge.className = 'badge badge-warning text-xs';
      srcBadge.textContent = 'Belum ada koneksi SOURCE aktif untuk environment ini';
    }
  }

  // 4. Modal View Creator Select
  const veSelect = document.getElementById('ve-connection-id');
  if (veSelect && source && source.connection_id) {
    veSelect.innerHTML = `<option value="${source.connection_id}">[${source.db_type}] ${escapeHtml(source.connection_name)} (${source.database})</option>`;
  }
}

// =========================================================================
// ONBOARDING WIZARD (DEDICATED WELCOME PAGE CONTROLS)
// =========================================================================
async function loadWelcomeView() {
  updateWizardStepView();
  try {
    const res = await fetch('/api/context/status');
    const json = await res.json();
    if (json.success) {
      state.isInitialized = Boolean(json.data.isInitialized);
      updateWelcomeStatusBadge(state.isInitialized);
    }
  } catch (e) {
    // ignore
  }
}

function updateWelcomeStatusBadge(isInit) {
  const badge = document.getElementById('welcome-status-badge');
  if (!badge) return;
  if (isInit) {
    badge.className = 'badge badge-success';
    badge.textContent = '✓ Sistem Telah Terkonfigurasi';
  } else {
    badge.className = 'badge badge-warning';
    badge.textContent = '⚠️ Menunggu Konfigurasi Awal';
  }
}

function updateWizardStepView() {
  for (let i = 1; i <= 4; i++) {
    const ind = document.getElementById(`wz-step-indicator-${i}`);
    const pane = document.getElementById(`wz-step-${i}`);
    if (ind) {
      ind.classList.toggle('active', i === state.wizardStep);
      ind.classList.toggle('completed', i < state.wizardStep);
    }
    if (pane) pane.classList.toggle('active', i === state.wizardStep);
  }

  const stepNum = document.getElementById('wz-current-step-num');
  if (stepNum) stepNum.textContent = state.wizardStep;

  const btnPrev = document.getElementById('btn-wz-prev');
  const btnNext = document.getElementById('btn-wz-next');
  const btnFinish = document.getElementById('btn-wz-finish');

  if (btnPrev) btnPrev.disabled = state.wizardStep === 1;
  if (state.wizardStep === 4) {
    if (btnNext) btnNext.classList.add('hidden');
    if (btnFinish) btnFinish.classList.remove('hidden');
    renderWizardSummary();
  } else {
    if (btnNext) btnNext.classList.remove('hidden');
    if (btnFinish) btnFinish.classList.add('hidden');
  }
}

function prevWizardStep() {
  if (state.wizardStep > 1) {
    state.wizardStep--;
    updateWizardStepView();
  }
}

function nextWizardStep() {
  if (state.wizardStep === 1) {
    const code = document.getElementById('wz-client-code')?.value.trim();
    const name = document.getElementById('wz-client-name')?.value.trim();
    if (!code || !name) {
      alert('Kode dan Nama Client wajib diisi.');
      return;
    }
  } else if (state.wizardStep === 2) {
    const code = document.getElementById('wz-env-code')?.value.trim();
    const name = document.getElementById('wz-env-name')?.value.trim();
    if (!code || !name) {
      alert('Kode dan Nama Environment wajib diisi.');
      return;
    }
  }

  if (state.wizardStep < 4) {
    state.wizardStep++;
    updateWizardStepView();
  }
}

function renderWizardSummary() {
  const box = document.getElementById('wz-summary-box');
  if (!box) return;

  const clientCode = document.getElementById('wz-client-code')?.value.trim() || 'ANTAM';
  const clientName = document.getElementById('wz-client-name')?.value.trim() || 'PT ANTAM Tbk';
  const envCode = document.getElementById('wz-env-code')?.value.trim() || 'DEV';
  const envName = document.getElementById('wz-env-name')?.value.trim() || 'Development';
  const srcHost = document.getElementById('wz-src-host')?.value.trim() || 'HOST_REDACTED';
  const srcPort = document.getElementById('wz-src-port')?.value.trim() || '1433';
  const srcDb = document.getElementById('wz-src-db')?.value.trim() || 'antam_scm';
  const tgtHost = document.getElementById('wz-tgt-host')?.value.trim() || 'HOST_REDACTED';
  const tgtPort = document.getElementById('wz-tgt-port')?.value.trim() || '5433';
  const tgtDb = document.getElementById('wz-tgt-db')?.value.trim() || 'db_procsi';

  box.innerHTML = `
    <div class="mb-2"><strong>🏢 Identitas Client:</strong> [${escapeHtml(clientCode)}] ${escapeHtml(clientName)}</div>
    <div class="mb-2"><strong>🌐 Target Environment:</strong> [${escapeHtml(envCode)}] ${escapeHtml(envName)}</div>
    <div class="mt-3 text-cyan"><strong>🔌 Database Sumber (MSSQL):</strong> ${escapeHtml(srcHost)}:${escapeHtml(srcPort)} • Database: <code>${escapeHtml(srcDb)}</code> (via SSH)</div>
    <div class="text-indigo"><strong>🔌 Database Target (PostgreSQL):</strong> ${escapeHtml(tgtHost)}:${escapeHtml(tgtPort)} • Database: <code>${escapeHtml(tgtDb)}</code></div>
    <div class="mt-3 text-muted text-xs">Semua pengaturan ini akan disimpan ke tabel master sistem dan langsung siap digunakan pada dashboard.</div>
  `;
}

async function finishWizard() {
  const btn = document.getElementById('btn-wz-finish');
  btn.disabled = true;
  btn.textContent = 'Menyimpan Konfigurasi...';

  const srcHost = document.getElementById('wz-src-host')?.value.trim() || 'HOST_REDACTED';
  const tgtHost = document.getElementById('wz-tgt-host')?.value.trim() || 'HOST_REDACTED';

  const payload = {
    client: {
      client_code: document.getElementById('wz-client-code')?.value.trim() || 'ANTAM',
      client_name: document.getElementById('wz-client-name')?.value.trim() || 'PT ANTAM Tbk',
      description: document.getElementById('wz-client-desc')?.value.trim() || '',
    },
    environment: {
      env_code: document.getElementById('wz-env-code')?.value.trim() || 'DEV',
      env_name: document.getElementById('wz-env-name')?.value.trim() || 'Development',
      description: document.getElementById('wz-env-desc')?.value.trim() || '',
    },
    connections: [
      {
        connection_name: 'SQL Server Source (dbo)',
        db_type: 'MSSQL',
        db_role: 'SOURCE',
        host: srcHost,
        port: parseInt(document.getElementById('wz-src-port')?.value.trim(), 10) || 1433,
        database_name: document.getElementById('wz-src-db')?.value.trim() || 'antam_scm',
        username: document.getElementById('wz-src-user')?.value.trim() || 'sa',
        password: document.getElementById('wz-src-pass')?.value.trim() || '***REDACTED***',
        use_ssh_tunnel: true,
        ssh_host: srcHost,
        ssh_port: 22,
        ssh_user: 'developer',
        ssh_password: '***REDACTED***',
      },
      {
        connection_name: 'PostgreSQL Target (etl_antam)',
        db_type: 'POSTGRESQL',
        db_role: 'TARGET',
        host: tgtHost,
        port: parseInt(document.getElementById('wz-tgt-port')?.value.trim(), 10) || 5433,
        database_name: document.getElementById('wz-tgt-db')?.value.trim() || 'db_procsi',
        username: document.getElementById('wz-tgt-user')?.value.trim() || 'procsi',
        password: document.getElementById('wz-tgt-pass')?.value.trim() || '***REDACTED***',
        use_ssh_tunnel: false,
      },
    ],
  };

  try {
    const res = await fetch('/api/context/init-wizard', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    state.isInitialized = true;
    updateWelcomeStatusBadge(true);
    alert('✓ Inisialisasi sistem berhasil! Selamat datang di Migration Command Center.');
    await loadContextClientsAndEnvironments();
    await checkHealth();

    // SETELAH BERHASIL SETTING, BARU MASUK KE HALAMAN AWAL (DASHBOARD TAB 1)
    switchMainTab('tab-source');
  } catch (err) {
    alert('Gagal menyimpan inisialisasi: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan & Masuk ke Halaman Awal ✓';
  }
}

// =========================================================================
// SYSTEM SETTING MODAL LOGIC (CLIENT, ENV, MULTIPLE CONNECTIONS)
// =========================================================================
function openSettingsModal() {
  document.getElementById('modal-settings').classList.remove('hidden');
  switchSettingTab(state.activeSettingTab);
}

async function loadSettingsClientsAndEnvironments() {
  await Promise.all([loadSettingsClients(), loadSettingsEnvironments()]);
}

async function loadSettingsClients() {
  const tbodyClients = document.getElementById('settings-clients-tbody');
  if (!tbodyClients) return;
  tbodyClients.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">Memuat data client...</td></tr>`;

  try {
    const res = await fetch('/api/context/clients');
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    state.clients = json.data || [];

    if (state.clients.length === 0) {
      tbodyClients.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">Belum ada client terdaftar. Silakan klik "+ Tambah Client".</td></tr>`;
      return;
    }

    tbodyClients.innerHTML = state.clients.map((c) => {
      const envs = c.environments || [];
      const envBadges = envs.length > 0
        ? envs.map((env) => `
            <span class="badge badge-success font-mono" style="cursor: pointer; margin: 2px 4px 2px 0; display: inline-flex; align-items: center; gap: 4px;" title="Kelola Koneksi untuk [${escapeHtml(env.env_code)}] ${escapeHtml(env.env_name)}" onclick="filterConnectionByEnv(${c.client_id}, ${env.env_id})">
              🏷️ ${escapeHtml(env.env_code)}
            </span>
          `).join('')
        : '<span class="text-muted text-xs italic">Belum ada Environment</span>';

      return `
        <tr>
          <td class="font-mono font-bold">#${c.client_id}</td>
          <td><strong class="text-cyan">${escapeHtml(c.client_code)}</strong></td>
          <td><strong>${escapeHtml(c.client_name)}</strong></td>
          <td class="text-muted text-xs">${escapeHtml(c.description || '-')}</td>
          <td>
            <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 4px;">
              ${envBadges}
              <button class="btn btn-emerald btn-xs" style="padding: 2px 6px;" onclick="openCreateEnvForClient(${c.client_id})" title="Tambah Environment Baru untuk Client ini">➕ Env</button>
            </div>
          </td>
          <td><span class="badge ${c.is_active ? 'badge-success' : 'badge-danger'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
          <td>
            <div class="flex-gap-2" style="align-items: center;">
              <button class="btn btn-indigo btn-xs" onclick="openEnvManagerModal(${c.client_id}, null)" title="Setup Wizard Multi-Connection">⚙️ Setup Wizard</button>
              <button class="btn btn-secondary btn-xs" onclick="openEditSettingModal('client', ${c.client_id})" title="Edit Client">✏️</button>
              <button class="btn btn-danger btn-xs" onclick="openDeleteModal('client', ${c.client_id}, '${escapeHtml(c.client_name)}')" title="Hapus Client">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbodyClients.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-rose">Error: ${err.message}</td></tr>`;
  }
}

async function loadSettingsEnvironments(filterClientId = null) {
  const tbodyEnvs = document.getElementById('settings-environments-tbody');
  const filterSelect = document.getElementById('setting-filter-env-client');
  if (!tbodyEnvs) return;

  tbodyEnvs.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">Memuat data environment...</td></tr>`;

  try {
    if (!state.clients || state.clients.length === 0) {
      const cRes = await fetch('/api/context/clients');
      const cJson = await cRes.json();
      state.clients = cJson.data || [];
    }

    if (filterSelect) {
      const curVal = filterClientId !== null ? String(filterClientId) : filterSelect.value;
      filterSelect.innerHTML = '<option value="">Semua Client</option>' + state.clients.map((c) => `
        <option value="${c.client_id}" ${curVal == String(c.client_id) ? 'selected' : ''}>[${escapeHtml(c.client_code)}] ${escapeHtml(c.client_name)}</option>
      `).join('');
    }

    const currentFilterClient = filterClientId !== null ? filterClientId : (filterSelect?.value ? parseInt(filterSelect.value, 10) : null);
    const url = currentFilterClient ? `/api/context/environments?clientId=${currentFilterClient}` : '/api/context/environments';
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    state.environments = json.data || [];

    if (state.environments.length === 0) {
      tbodyEnvs.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-muted">Belum ada environment yang cocok. Silakan klik "+ Tambah Environment".</td></tr>`;
      return;
    }

    tbodyEnvs.innerHTML = state.environments.map((e) => {
      const connCount = parseInt(e.total_connections, 10) || 0;
      const connBadge = connCount > 0
        ? `<span class="badge badge-info" style="cursor: pointer;" onclick="filterConnectionByEnv(${e.client_id}, ${e.env_id})">🔌 ${connCount} Koneksi</span>`
        : `<span class="badge badge-neutral text-xs">0 Koneksi</span>`;

      return `
        <tr>
          <td class="font-mono font-bold">#${e.env_id}</td>
          <td><strong class="text-cyan">[${escapeHtml(e.client_code || '')}]</strong> ${escapeHtml(e.client_name || '-')}</td>
          <td><strong class="text-amber">${escapeHtml(e.env_code)}</strong></td>
          <td><strong>${escapeHtml(e.env_name)}</strong> <span class="text-muted text-xs block">${escapeHtml(e.description || '')}</span></td>
          <td>${connBadge}</td>
          <td><span class="badge ${e.is_active ? 'badge-success' : 'badge-danger'}">${e.is_active ? 'Active' : 'Inactive'}</span></td>
          <td>
            <div class="flex-gap-2">
              <button class="btn btn-warning btn-xs" onclick="syncHopConfig(${e.env_id}, '${escapeHtml(e.env_code)}', '${escapeHtml(e.client_code || '')}')" title="Generate & Sync Konfigurasi ke Apache Hop">⚡ Sync to Hop</button>
              <button class="btn btn-cyan btn-xs" onclick="filterConnectionByEnv(${e.client_id}, ${e.env_id})" title="Lihat Koneksi Terkait">🔌 Koneksi</button>
              <button class="btn btn-indigo btn-xs" onclick="openEnvManagerModal(${e.client_id}, ${e.env_id})" title="Kelola Koneksi Database di Wizard">⚙️ Setup</button>
              <button class="btn btn-secondary btn-xs" onclick="openEditSettingModal('environment', ${e.env_id})" title="Edit Environment">✏️</button>
              <button class="btn btn-danger btn-xs" onclick="openDeleteModal('environment', ${e.env_id}, '${escapeHtml(e.env_name)}')" title="Hapus Environment">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbodyEnvs.innerHTML = `<tr><td colspan="7" class="text-center py-4 text-rose">Error: ${err.message}</td></tr>`;
  }
}

async function loadSettingsConnections(filterClientId = null, filterEnvId = null, filterRole = null) {
  const tbody = document.getElementById('settings-connections-tbody');
  const selClient = document.getElementById('setting-filter-conn-client');
  const selEnv = document.getElementById('setting-filter-conn-env');
  const selRole = document.getElementById('setting-filter-conn-role');
  if (!tbody) return;

  tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-muted">Memuat koneksi database...</td></tr>`;

  try {
    if (!state.clients || state.clients.length === 0 || !state.environments || state.environments.length === 0) {
      const [cRes, eRes] = await Promise.all([
        fetch('/api/context/clients'),
        fetch('/api/context/environments'),
      ]);
      const cJson = await cRes.json();
      const eJson = await eRes.json();
      state.clients = cJson.data || [];
      state.environments = eJson.data || [];
    }

    if (selClient) {
      const curC = filterClientId !== null ? String(filterClientId) : selClient.value;
      selClient.innerHTML = '<option value="">Semua Client</option>' + state.clients.map((c) => `
        <option value="${c.client_id}" ${curC == String(c.client_id) ? 'selected' : ''}>[${escapeHtml(c.client_code)}] ${escapeHtml(c.client_name)}</option>
      `).join('');
    }

    const currentClientId = filterClientId !== null ? filterClientId : (selClient?.value ? parseInt(selClient.value, 10) : null);

    if (selEnv) {
      let filteredEnvs = state.environments;
      if (currentClientId) {
        filteredEnvs = state.environments.filter((e) => e.client_id === currentClientId);
      }
      const curE = filterEnvId !== null ? String(filterEnvId) : selEnv.value;
      selEnv.innerHTML = '<option value="">Semua Environment</option>' + filteredEnvs.map((e) => `
        <option value="${e.env_id}" ${curE == String(e.env_id) ? 'selected' : ''}>[${escapeHtml(e.env_code)}] ${escapeHtml(e.env_name)}</option>
      `).join('');
    }

    const currentEnvId = filterEnvId !== null ? filterEnvId : (selEnv?.value ? parseInt(selEnv.value, 10) : null);
    const currentRole = filterRole !== null ? filterRole : (selRole?.value || null);

    let url = '/api/context/connections';
    const params = [];
    if (currentEnvId) params.push(`envId=${currentEnvId}`);
    if (currentClientId) params.push(`clientId=${currentClientId}`);
    if (params.length > 0) url += `?${params.join('&')}`;

    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    let connections = json.data || [];
    state.connections = connections;

    if (currentRole) {
      connections = connections.filter((c) => c.db_role === currentRole);
    }

    if (connections.length === 0) {
      tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-muted">Belum ada koneksi database untuk filter yang dipilih. Silakan klik "+ Tambah Koneksi Baru".</td></tr>`;
      return;
    }

    tbody.innerHTML = connections.map((conn) => {
      const roleBadge = conn.db_role === 'SOURCE' ? 'badge-cyan' : (conn.db_role === 'STAGING' ? 'badge-warning' : 'badge-success');
      return `
        <tr>
          <td class="font-mono font-bold">#${conn.connection_id}</td>
          <td><strong class="text-cyan">[${escapeHtml(conn.client_code || 'ALL')}]</strong> ${escapeHtml(conn.client_name || '-')}</td>
          <td><span class="badge badge-indigo font-mono">${escapeHtml(conn.env_code || 'ENV')}</span></td>
          <td><strong>${escapeHtml(conn.connection_name)}</strong></td>
          <td><span class="badge ${roleBadge}">${escapeHtml(conn.db_role)}</span></td>
          <td><strong class="text-white">${escapeHtml(conn.db_type)}</strong></td>
          <td class="font-mono text-xs">${escapeHtml(conn.host)}:${conn.port}</td>
          <td class="font-mono text-cyan">${escapeHtml(conn.database_name)} <span class="text-muted text-xs">(${escapeHtml(conn.db_schema || 'dbo')})</span></td>
          <td>${conn.use_ssh_tunnel ? '<span class="badge badge-warning" title="' + escapeHtml(conn.ssh_host || '') + '">SSH</span>' : '<span class="text-muted">Direct</span>'}</td>
          <td><span class="badge ${conn.is_active ? 'badge-success' : 'badge-danger'}">${conn.is_active ? 'Active' : 'Off'}</span></td>
          <td>
            <div class="flex-gap-2">
              <button class="btn btn-secondary btn-sm" onclick="testPingConnection(${conn.connection_id})" title="Uji Koneksi">⚡ Test</button>
              <button class="btn btn-secondary btn-sm" onclick="openEditSettingModal('connection', ${conn.connection_id})">Edit</button>
              <button class="btn btn-danger btn-sm" onclick="openDeleteModal('connection', ${conn.connection_id}, '${escapeHtml(conn.connection_name)}')">Hapus</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="11" class="text-center py-4 text-rose">Error: ${err.message}</td></tr>`;
  }
}

window.openCreateEnvForClient = function (clientId) {
  openUniversalForm('environment', null, { client_id: clientId });
};

window.filterConnectionByEnv = function (clientId, envId) {
  switchSettingTab('setting-tab-connections');
  const selClient = document.getElementById('setting-filter-conn-client');
  const selEnv = document.getElementById('setting-filter-conn-env');
  if (selClient) selClient.value = clientId || '';
  loadSettingsConnections(clientId, envId);
};

function initSettingFilterListeners() {
  const filterEnvClient = document.getElementById('setting-filter-env-client');
  if (filterEnvClient) {
    filterEnvClient.addEventListener('change', (e) => {
      loadSettingsEnvironments(e.target.value ? parseInt(e.target.value, 10) : null);
    });
  }

  const filterConnClient = document.getElementById('setting-filter-conn-client');
  if (filterConnClient) {
    filterConnClient.addEventListener('change', (e) => {
      const clientId = e.target.value ? parseInt(e.target.value, 10) : null;
      loadSettingsConnections(clientId, null);
    });
  }

  const filterConnEnv = document.getElementById('setting-filter-conn-env');
  if (filterConnEnv) {
    filterConnEnv.addEventListener('change', (e) => {
      const envId = e.target.value ? parseInt(e.target.value, 10) : null;
      const clientId = filterConnClient?.value ? parseInt(filterConnClient.value, 10) : null;
      loadSettingsConnections(clientId, envId);
    });
  }

  const filterConnRole = document.getElementById('setting-filter-conn-role');
  if (filterConnRole) {
    filterConnRole.addEventListener('change', (e) => {
      const role = e.target.value || null;
      const clientId = filterConnClient?.value ? parseInt(filterConnClient.value, 10) : null;
      const envId = filterConnEnv?.value ? parseInt(filterConnEnv.value, 10) : null;
      loadSettingsConnections(clientId, envId, role);
    });
  }

  const btnReset = document.getElementById('btn-reset-conn-filters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (filterConnClient) filterConnClient.value = '';
      if (filterConnEnv) filterConnEnv.value = '';
      if (filterConnRole) filterConnRole.value = '';
      loadSettingsConnections(null, null, null);
    });
  }
}

window.testPingConnection = async function (connId) {
  const conn = state.connections.find((c) => c.connection_id === connId);
  if (!conn) return;

  const btn = event?.currentTarget;
  if (btn) btn.textContent = '...';

  try {
    const res = await fetch('/api/context/connections/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(conn),
    });
    const json = await res.json();
    if (json.success) {
      alert(`✓ Koneksi Berhasil!\nDatabase: ${conn.database_name}\nLatency: ${json.latencyMs}ms\nVersi: ${json.version || '-'}`);
    } else {
      alert(`⚠️ Koneksi Gagal!\n${json.error}`);
    }
  } catch (err) {
    alert(`Error saat menguji koneksi: ${err.message}`);
  } finally {
    if (btn) btn.textContent = '⚡ Test';
  }
};

// =========================================================================
// MODUL 1: SOURCE DATA (SQL SERVER VIEWS & VIEW CREATOR)
// =========================================================================
async function loadSourceViews() {
  const tbody = document.getElementById('source-views-table-body');
  tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-muted">Memuat daftar view SQL Server...</td></tr>`;

  if (!state.selectedSourceConnectionId) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-amber font-medium">⚠️ Belum ada koneksi SOURCE (SQL Server) yang terdaftar untuk Environment ini.<br><span class="text-xs text-muted">Silakan buka menu <strong>Setting ⚙️ ➔ 3. Master Connection</strong> untuk menambahkan koneksi database sumber.</span></td></tr>`;
    document.getElementById('kpi-source-views-count').textContent = '0';
    document.getElementById('kpi-source-total-rows').textContent = '0';
    document.getElementById('kpi-source-main-view').textContent = '-';
    document.getElementById('kpi-source-main-count').textContent = '0 baris';
    state.source.views = [];
    state.source.selectedView = null;
    document.getElementById('source-inspector-title').textContent = 'Data Inspector';
    document.getElementById('source-data-thead').innerHTML = '<tr><th>Pilih view pada tabel di sebelah kiri</th></tr>';
    document.getElementById('source-data-tbody').innerHTML = '<tr><td class="text-center py-8 text-muted">Belum ada koneksi SOURCE untuk environment ini.</td></tr>';
    document.getElementById('source-view-total-records').textContent = '0';
    document.getElementById('source-view-col-count').textContent = '0';
    document.getElementById('source-view-page-indicator').textContent = '1/1';
    document.getElementById('source-pagination-info').textContent = '0 baris';
    const alertEl = document.getElementById('source-view-alert');
    if (alertEl) alertEl.className = 'hidden';
    return;
  }

  try {
    const connParam = `?connection_id=${state.selectedSourceConnectionId}`;
    const res = await fetch(`/api/source/views${connParam}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    document.getElementById('kpi-source-views-count').textContent = data.totalViews;
    document.getElementById('kpi-source-total-rows').textContent = formatNumber(data.totalRowsAllViews);

    const mainViewItem = data.views.find((v) => v.name === 'v_migration_vendor') || data.views[0];
    if (mainViewItem) {
      document.getElementById('kpi-source-main-view').textContent = mainViewItem.name;
      document.getElementById('kpi-source-main-count').textContent = mainViewItem.error
        ? 'Error query'
        : `${formatNumber(mainViewItem.count)} baris`;
    }

    state.source.views = data.views;

    if (data.views.length === 0) {
      tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-muted">Tidak ada VIEW di schema dbo SQL Server.</td></tr>`;
      state.source.views = [];
      state.source.selectedView = null;
      document.getElementById('kpi-source-views-count').textContent = '0';
      document.getElementById('kpi-source-total-rows').textContent = '0';
      document.getElementById('kpi-source-main-view').textContent = '-';
      document.getElementById('kpi-source-main-count').textContent = '0 baris';
      document.getElementById('source-inspector-title').textContent = 'Data Inspector';
      document.getElementById('source-data-thead').innerHTML = '<tr><th>Pilih view pada tabel di sebelah kiri</th></tr>';
      document.getElementById('source-data-tbody').innerHTML = '<tr><td class="text-center py-8 text-muted">Tidak ada view yang tersedia.</td></tr>';
      document.getElementById('source-view-total-records').textContent = '0';
      document.getElementById('source-view-col-count').textContent = '0';
      document.getElementById('source-view-page-indicator').textContent = '1/1';
      document.getElementById('source-pagination-info').textContent = '0 baris';
      document.getElementById('source-page-numbers').innerHTML = '';
      document.getElementById('btn-source-prev').disabled = true;
      document.getElementById('btn-source-next').disabled = true;
      const alertEl = document.getElementById('source-view-alert');
      if (alertEl) alertEl.className = 'hidden';
      return;
    }

    // Pastikan selectedView sinkron dengan daftar views aktual
    if (!state.source.selectedView || !data.views.some((v) => v.name === state.source.selectedView)) {
      const defaultView = data.views.find((v) => v.name === 'v_migration_vendor') || data.views[0];
      state.source.selectedView = defaultView ? defaultView.name : null;
      state.source.page = 1;
    }

    tbody.innerHTML = data.views.map((v, idx) => {
      const isSelected = state.source.selectedView === v.name;
      const configBadge = v.isConfigured
        ? `<span class="badge badge-success">✓ Tercatat (${v.isSynced ? 'Sinkron' : 'Perlu Sync'})</span>`
        : `<span class="badge badge-neutral">Belum Dicatat</span>`;

      return `
        <tr class="${isSelected ? 'active-row' : ''}">
          <td class="font-mono text-muted">${idx + 1}</td>
          <td><strong class="font-mono text-cyan">${v.name}</strong></td>
          <td><span class="badge badge-neutral">${v.schema}</span></td>
          <td class="font-mono ${v.error ? 'text-rose' : ''}">
            ${v.error ? `<span title="${escapeHtml(v.error)}">Error</span>` : formatNumber(v.count)}
          </td>
          <td>${configBadge}</td>
          <td>
            <div class="flex-gap-2">
              <button class="btn btn-secondary btn-sm" onclick="inspectView('${v.name}')">Inspect</button>
              <button class="btn btn-secondary btn-sm" onclick="quickSyncView('${v.name}')" title="Simpan query view ke tabel konfigurasi">💾 Sync</button>
              <button class="btn btn-secondary btn-sm" onclick="openViewEditor('${v.name}')" title="Edit query view">✏️ Edit</button>
              <button class="btn btn-danger btn-sm" onclick="openDeleteModal('source_view', '${v.name}', '${v.name}')" title="Hapus view dari DB">🗑️</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    // Load data inspector for selected view
    loadSourceViewData();
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

window.inspectView = function (viewName) {
  state.source.selectedView = viewName;
  state.source.page = 1;
  document.querySelectorAll('#source-views-table-body tr').forEach((tr) => tr.classList.remove('active-row'));
  event?.currentTarget?.closest('tr')?.classList.add('active-row');
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
  tbody.innerHTML = '';

  try {
    const connParam = state.selectedSourceConnectionId ? `&connection_id=${state.selectedSourceConnectionId}` : '';
    const url = `/api/source/view-data?view=${encodeURIComponent(viewName)}&page=${state.source.page}&limit=${state.source.limit}${connParam}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    state.source.total = data.total;
    state.source.totalPages = data.totalPages;
    state.source.columns = data.columns || [];
    state.source.rows = data.rows || [];

    if (data.error) {
      alertEl.className = 'alert-box-warning mb-4 p-4 rounded-md border text-sm';
      alertEl.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 0.25rem;">⚠️ Catatan Database SQL Server: View Binding Error</div>
        <div>${escapeHtml(data.error)}</div>
      `;
    } else {
      alertEl.className = 'hidden';
      alertEl.innerHTML = '';
    }

    document.getElementById('source-view-total-records').textContent = data.error ? '0 (Error)' : formatNumber(data.total);
    document.getElementById('source-view-col-count').textContent = data.columns.length;
    document.getElementById('source-view-page-indicator').textContent = `${data.page} / ${data.totalPages}`;

    const startIdx = (data.page - 1) * data.limit + 1;
    const endIdx = Math.min(data.page * data.limit, data.total);
    document.getElementById('source-pagination-info').textContent = data.total > 0
      ? `Menampilkan ${formatNumber(startIdx)} - ${formatNumber(endIdx)} dari total ${formatNumber(data.total)} baris`
      : (data.error ? 'Query data gagal karena kendala binding di SQL Server.' : '0 baris ditemukan.');

    document.getElementById('btn-source-prev').disabled = data.page <= 1;
    document.getElementById('btn-source-next').disabled = data.page >= data.totalPages;

    renderPaginationNumbers('source-page-numbers', data.page, data.totalPages, (newPage) => {
      state.source.page = newPage;
      loadSourceViewData();
    });

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

// =========================================================================
// VIEW CREATOR, EDITOR & QUERY SYNC LOGIC
// =========================================================================
async function openViewEditor(existingViewName = null) {
  const modal = document.getElementById('modal-view-editor');
  modal.classList.remove('hidden');
  document.getElementById('ve-validation-box').classList.add('hidden');

  if (existingViewName) {
    document.getElementById('view-editor-title').textContent = `Edit Query View: [dbo].[${existingViewName}]`;
    document.getElementById('ve-view-name').value = existingViewName;
    document.getElementById('ve-view-name').readOnly = true;

    try {
      const connParam = state.selectedSourceConnectionId ? `&connection_id=${state.selectedSourceConnectionId}` : '';
      const res = await fetch(`/api/source/view-definition?view=${encodeURIComponent(existingViewName)}${connParam}`);
      const json = await res.json();
      if (json.success && json.data) {
        document.getElementById('ve-query-sql').value = json.data.sqlServerDefinition || json.data.savedConfig?.query_sql || '';
        document.getElementById('ve-description').value = json.data.savedConfig?.description || '';
      }
    } catch (e) {
      console.warn('Gagal load view definition:', e.message);
    }
  } else {
    document.getElementById('view-editor-title').textContent = 'Buat Objek View Baru di SQL Server';
    document.getElementById('ve-view-name').value = '';
    document.getElementById('ve-view-name').readOnly = false;
    document.getElementById('ve-query-sql').value = 'SELECT \n  [vendor_id],\n  [vendor_name],\n  [status]\nFROM [dbo].[tb_vendor]';
    document.getElementById('ve-description').value = '';
  }
}

function closeViewEditor() {
  document.getElementById('modal-view-editor').classList.add('hidden');
}

async function validateViewQuery() {
  const querySql = document.getElementById('ve-query-sql').value.trim();
  const box = document.getElementById('ve-validation-box');
  box.classList.remove('hidden');
  box.className = 'p-3 rounded border text-xs mb-2 bg-surface text-muted';
  box.textContent = 'Memvalidasi query ke SQL Server...';

  try {
    const res = await fetch('/api/source/validate-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query_sql: querySql,
        connection_id: document.getElementById('ve-connection-id')?.value || state.selectedSourceConnectionId,
      }),
    });
    const json = await res.json();
    if (json.data && json.data.valid) {
      box.className = 'p-3 rounded border text-xs mb-2 alert-box-success';
      box.innerHTML = `
        <strong>✓ Query Valid!</strong> (${json.data.durationMs}ms)<br>
        Kolom terdeteksi (${json.data.columns.length}): <code>${json.data.columns.join(', ')}</code>
      `;
    } else {
      box.className = 'p-3 rounded border text-xs mb-2 alert-box-warning';
      box.innerHTML = `<strong>⚠️ Query Gagal Validasi:</strong><br>${escapeHtml(json.data?.error || json.error)}`;
    }
  } catch (err) {
    box.className = 'p-3 rounded border text-xs mb-2 alert-box-warning';
    box.innerHTML = `<strong>⚠️ Error:</strong> ${err.message}`;
  }
}

async function saveOrExecuteView() {
  const viewName = document.getElementById('ve-view-name').value.trim();
  const querySql = document.getElementById('ve-query-sql').value.trim();
  const description = document.getElementById('ve-description').value.trim();

  if (!viewName || !querySql) {
    alert('Nama view dan Query SQL wajib diisi.');
    return;
  }

  const btn = document.getElementById('btn-ve-save');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    const res = await fetch('/api/source/create-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id: document.getElementById('ve-connection-id')?.value || state.selectedSourceConnectionId,
        schema_name: document.getElementById('ve-schema-name')?.value.trim() || 'dbo',
        view_name: viewName,
        query_sql: querySql,
        description,
      }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    alert(`✓ ${json.data.message}`);
    closeViewEditor();
    loadSourceViews();
  } catch (err) {
    alert(`Gagal membuat/menyimpan view: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan & Bentuk View di DB ✓';
  }
}

window.quickSyncView = async function (viewName) {
  try {
    const connParam = state.selectedSourceConnectionId ? `&connection_id=${state.selectedSourceConnectionId}` : '';
    const defRes = await fetch(`/api/source/view-definition?view=${encodeURIComponent(viewName)}${connParam}`);
    const defJson = await defRes.json();
    const querySql = defJson.data?.sqlServerDefinition;

    if (!querySql) {
      alert(`Tidak dapat mengekstrak definisi query untuk [dbo].[${viewName}] dari SQL Server.`);
      return;
    }

    const saveRes = await fetch('/api/source/save-view-definition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        schema_name: 'dbo',
        view_name: viewName,
        query_sql: querySql,
        connection_id: state.selectedSourceConnectionId,
        description: `Disinkronkan otomatis dari SQL Server [dbo].[${viewName}]`,
      }),
    });
    const saveJson = await saveRes.json();
    if (!saveJson.success) throw new Error(saveJson.error);

    alert(`✓ Definisi query view [dbo].[${viewName}] berhasil disinkronkan ke tabel konfigurasi!`);
    loadSourceViews();
  } catch (err) {
    alert(`Gagal sync view: ${err.message}`);
  }
};

async function syncAllViews() {
  const btn = document.getElementById('btn-sync-all-views');
  btn.disabled = true;
  btn.textContent = 'Menyinkronkan...';

  try {
    const res = await fetch('/api/source/sync-all-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: state.selectedSourceConnectionId }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    alert(`✓ Berhasil menyinkronkan ${json.data.totalSynced} view ke tabel master konfigurasi!`);
    loadSourceViews();
  } catch (err) {
    alert(`Gagal menyinkronkan seluruh view: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = '⚡ Sinkronkan Semua';
  }
}

// =========================================================================
// MODUL 2: MIGRATION CONFIG (FORMATTERS, PAGINATION, SORTING & CRUD)
// =========================================================================
function formatCompareColumns(cols) {
  if (!cols) return '<span class="text-muted">-</span>';
  const parts = cols.split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return '<span class="text-muted">-</span>';
  return `<div class="tags-wrap-list" title="${escapeHtml(cols)}">
    ${parts.map((p) => `<span class="tag-col-chip">${escapeHtml(p)}</span>`).join('')}
  </div>`;
}

function formatSqlSnippet(sqlStr) {
  if (!sqlStr) return '<span class="text-muted">-</span>';
  return `<span class="wrap-code" title="${escapeHtml(sqlStr)}">${escapeHtml(sqlStr)}</span>`;
}

function formatPkColumns(pk) {
  if (!pk) return '<span class="text-muted">-</span>';
  return `<span class="tag-col-chip" style="color: var(--accent-emerald); border-color: rgba(16,185,129,0.3); background: rgba(16,185,129,0.1); font-weight: 600;">${escapeHtml(pk)}</span>`;
}

function renderAllConfigTables() {
  ['main', 'rules', 'targets', 'lookups'].forEach((k) => renderConfigTable(k));
}

function renderConfigTable(tableKey) {
  if (!state.config.masters) return;
  const tState = state.config.tables[tableKey];
  if (!tState) return;

  let rawList = [];
  let tbodyId = '';
  let colspan = 15;

  if (tableKey === 'main') {
    rawList = state.config.masters.migration_config || [];
    tbodyId = 'master-config-tbody';
    colspan = 15;
  } else if (tableKey === 'rules') {
    rawList = state.config.masters.migration_convert_rule || [];
    tbodyId = 'master-rules-tbody';
    colspan = 11;
  } else if (tableKey === 'targets') {
    rawList = state.config.masters.migration_target_config || [];
    tbodyId = 'master-targets-tbody';
    colspan = 12;
  } else if (tableKey === 'lookups') {
    rawList = state.config.masters.migration_lookup || [];
    tbodyId = 'master-lookups-tbody';
    colspan = 11;
  }

  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;

  // 1. Filtering by search
  let filtered = [...rawList];
  if (tState.search) {
    const q = tState.search;
    filtered = filtered.filter((item) => {
      return Object.values(item).some((val) => val !== null && val !== undefined && String(val).toLowerCase().includes(q));
    });
  }

  // 2. Sorting
  if (tState.sortBy) {
    const col = tState.sortBy;
    const isAsc = tState.sortDir === 'asc';
    filtered.sort((a, b) => {
      let vA = a[col];
      let vB = b[col];
      if (typeof vA === 'number' && typeof vB === 'number') {
        return isAsc ? vA - vB : vB - vA;
      }
      vA = String(vA ?? '').toLowerCase();
      vB = String(vB ?? '').toLowerCase();
      return isAsc ? vA.localeCompare(vB) : vB.localeCompare(vA);
    });
  }

  // Update header sort indicators
  const tableEl = document.getElementById(`table-cfg-${tableKey}`);
  if (tableEl) {
    tableEl.querySelectorAll('th[data-cfg-table]').forEach((th) => {
      const col = th.dataset.col;
      const icon = th.querySelector('.sort-icon');
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (col === tState.sortBy) {
        th.classList.add(tState.sortDir === 'asc' ? 'sorted-asc' : 'sorted-desc');
        if (icon) icon.textContent = tState.sortDir === 'asc' ? '▲' : '▼';
      } else {
        if (icon) icon.textContent = '↕';
      }
    });
  }

  // 3. Pagination math
  const total = filtered.length;
  const limit = tState.limit || 10;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (tState.page > totalPages) tState.page = totalPages;
  if (tState.page < 1) tState.page = 1;

  const startIdx = (tState.page - 1) * limit;
  const endIdx = Math.min(startIdx + limit, total);
  const pageItems = filtered.slice(startIdx, endIdx);

  // 4. Update Pagination Toolbar Info
  const rangeEl = document.getElementById(`info-cfg-${tableKey}-range`);
  const totalEl = document.getElementById(`info-cfg-${tableKey}-total`);
  const pageBadge = document.getElementById(`badge-cfg-${tableKey}-page`);
  const prevBtn = document.getElementById(`btn-cfg-${tableKey}-prev`);
  const nextBtn = document.getElementById(`btn-cfg-${tableKey}-next`);

  if (rangeEl) rangeEl.textContent = total > 0 ? `${startIdx + 1}-${endIdx}` : '0-0';
  if (totalEl) totalEl.textContent = total;
  if (pageBadge) pageBadge.textContent = `Hal ${tState.page} / ${totalPages}`;
  if (prevBtn) prevBtn.disabled = tState.page <= 1;
  if (nextBtn) nextBtn.disabled = tState.page >= totalPages;

  // 5. Render Rows
  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-8 text-muted">Tidak ada data ${tState.search ? 'yang cocok dengan pencarian' : 'pada tabel ini'}.</td></tr>`;
    return;
  }

  if (tableKey === 'main') {
    tbody.innerHTML = pageItems.map((c) => `
      <tr>
        <td class="font-mono font-bold text-center">#${c.config_id}</td>
        <td class="font-mono text-center">${c.exec_order}</td>
        <td class="font-mono text-muted">${escapeHtml(c.src_schema || 'dbo')}</td>
        <td><strong class="text-cyan">${escapeHtml(c.src_view)}</strong></td>
        <td><strong class="text-amber">stg_antam.${escapeHtml(c.stg_table)}</strong></td>
        <td class="font-mono text-muted">${escapeHtml(c.tgt_schema || 'vendor')}</td>
        <td><strong class="text-emerald">${escapeHtml(c.tgt_table)}</strong></td>
        <td>${formatPkColumns(c.pk_columns)}</td>
        <td>${formatCompareColumns(c.compare_columns)}</td>
        <td class="font-mono">${escapeHtml(c.id_column || '-')}</td>
        <td class="font-mono text-center">${c.id_width ?? '-'}</td>
        <td class="font-mono text-center">${c.id_seed ?? '-'}</td>
        <td>${formatSqlSnippet(c.src_precheck_sql)}</td>
        <td class="text-center"><span class="badge ${c.is_active ? 'badge-success' : 'badge-danger'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="sticky-action-col">
          <div class="flex-gap-2 justify-center">
            <button class="btn btn-secondary btn-sm" onclick="openEditConfigModal('migration_config', ${c.config_id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="openDeleteModal('migration_config', ${c.config_id}, 'Config #${c.config_id}')">Hapus</button>
          </div>
        </td>
      </tr>
    `).join('');
  } else if (tableKey === 'rules') {
    tbody.innerHTML = pageItems.map((r) => `
      <tr>
        <td class="font-mono text-muted text-center">#${r.rule_id}</td>
        <td class="font-mono font-bold text-center">#${r.config_id}</td>
        <td><strong class="text-emerald">${escapeHtml(r.column_name)}</strong></td>
        <td class="text-muted font-mono">${escapeHtml(r.source_column || '-')}</td>
        <td class="text-cyan">${escapeHtml(r.lookup_name || '-')}</td>
        <td class="text-muted">${escapeHtml(r.master_table || '-')}</td>
        <td>${escapeHtml(r.on_unmapped || '-')}</td>
        <td class="font-mono">${escapeHtml(r.default_value || '-')}</td>
        <td class="text-center"><span class="badge ${r.normalize ? 'badge-success' : 'badge-neutral'}">${r.normalize ? 'Yes' : 'No'}</span></td>
        <td class="text-center"><span class="badge ${r.is_active ? 'badge-success' : 'badge-danger'}">${r.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="sticky-action-col">
          <div class="flex-gap-2 justify-center">
            <button class="btn btn-secondary btn-sm" onclick="openEditConfigModal('migration_convert_rule', ${r.rule_id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="openDeleteModal('migration_convert_rule', ${r.rule_id}, 'Rule #${r.rule_id}')">Hapus</button>
          </div>
        </td>
      </tr>
    `).join('');
  } else if (tableKey === 'targets') {
    tbody.innerHTML = pageItems.map((t) => `
      <tr>
        <td class="font-mono text-muted text-center">#${t.target_config_id}</td>
        <td class="font-mono font-bold text-center">#${t.config_id}</td>
        <td class="font-mono text-center">${t.exec_order}</td>
        <td class="text-muted">${escapeHtml(t.tgt_schema || 'vendor')}</td>
        <td><strong class="text-emerald">${escapeHtml(t.tgt_table)}</strong></td>
        <td>${formatPkColumns(t.pk_columns)}</td>
        <td>${formatSqlSnippet(t.mapping_sql)}</td>
        <td>${formatSqlSnippet(t.precheck_sql)}</td>
        <td>${formatSqlSnippet(t.postcheck_sql)}</td>
        <td>${formatSqlSnippet(t.rollback_sql)}</td>
        <td class="text-center"><span class="badge ${t.is_active !== false ? 'badge-success' : 'badge-danger'}">Active</span></td>
        <td class="sticky-action-col">
          <div class="flex-gap-2 justify-center">
            <button class="btn btn-secondary btn-sm" onclick="openEditConfigModal('migration_target_config', ${t.target_config_id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="openDeleteModal('migration_target_config', ${t.target_config_id}, 'Target #${t.target_config_id}')">Hapus</button>
          </div>
        </td>
      </tr>
    `).join('');
  } else if (tableKey === 'lookups') {
    tbody.innerHTML = pageItems.map((l) => `
      <tr>
        <td><strong class="text-amber">${escapeHtml(l.lookup_name)}</strong></td>
        <td class="text-muted">${escapeHtml(l.master_schema || 'public')}</td>
        <td><strong>${escapeHtml(l.master_table || '-')}</strong></td>
        <td class="font-mono text-cyan">${escapeHtml(l.master_src_col || '-')}</td>
        <td class="font-mono text-emerald">${escapeHtml(l.master_tgt_col || '-')}</td>
        <td>${formatSqlSnippet(l.master_filter)}</td>
        <td>${escapeHtml(l.on_unmapped || '-')}</td>
        <td class="font-mono">${escapeHtml(l.default_value || '-')}</td>
        <td class="text-center"><span class="badge ${l.normalize ? 'badge-success' : 'badge-neutral'}">${l.normalize ? 'Yes' : 'No'}</span></td>
        <td class="wrap-col text-muted text-xs" style="max-width: 180px;">${escapeHtml(l.description || '-')}</td>
        <td class="sticky-action-col">
          <div class="flex-gap-2 justify-center">
            <button class="btn btn-secondary btn-sm" onclick="openEditConfigModal('migration_lookup', '${escapeHtml(l.lookup_name)}')">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="openDeleteModal('migration_lookup', '${escapeHtml(l.lookup_name)}', '${escapeHtml(l.lookup_name)}')">Hapus</button>
          </div>
        </td>
      </tr>
    `).join('');
  }
}

async function loadEtlMasters() {
  try {
    const params = [];
    if (state.selectedClientId) params.push(`clientId=${state.selectedClientId}`);
    if (state.selectedEnvId) params.push(`envId=${state.selectedEnvId}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';

    const res = await fetch(`/api/etl/configs${qs}`);
    const json = await res.json();
    if (!json.success) return;
    const data = json.data;
    state.config.masters = data;

    // Update KPI
    document.getElementById('kpi-cfg-total-configs').textContent = data.totals.configs;
    document.getElementById('kpi-cfg-total-rules').textContent = data.totals.rules;
    document.getElementById('kpi-cfg-total-targets').textContent = data.totals.targetConfigs;
    document.getElementById('kpi-cfg-total-lookups').textContent = data.totals.lookups;

    // Render all 4 config tables with reactive pagination, limits, and sorting
    renderAllConfigTables();
  } catch (e) {
    console.warn('Gagal memuat master config:', e.message);
  }
}

// =========================================================================
// UNIVERSAL CRUD MODAL FORM GENERATOR
// =========================================================================
const FORM_DEFINITIONS = {
  migration_config: {
    title: 'Migration Config',
    fields: [
      { name: 'exec_order', label: 'Exec Order', type: 'number', default: 1, required: true },
      { name: 'src_schema', label: 'Source Schema', type: 'text', default: 'dbo', required: true },
      { name: 'src_view', label: 'Source View (SQL Server)', type: 'text', placeholder: 'v_migration_vendor', required: true },
      { name: 'stg_table', label: 'Staging Table (PostgreSQL)', type: 'text', placeholder: 'stg_vendors_src', required: true },
      { name: 'tgt_schema', label: 'Target Schema', type: 'text', default: 'vendor', required: true },
      { name: 'tgt_table', label: 'Target Table (PostgreSQL)', type: 'text', placeholder: 'vendor_header', required: true },
      { name: 'pk_columns', label: 'PK Columns', type: 'text', placeholder: 'id', required: true },
      { name: 'compare_columns', label: 'Compare Columns', type: 'textarea', placeholder: 'name, email, status' },
      { name: 'id_column', label: 'ID Column', type: 'text', placeholder: 'id' },
      { name: 'id_width', label: 'ID Width', type: 'number', default: 10 },
      { name: 'id_seed', label: 'ID Seed', type: 'text', default: '1' },
      { name: 'src_precheck_sql', label: 'Source Precheck SQL', type: 'textarea', placeholder: 'SELECT COUNT(*) FROM ...' },
      { name: 'is_active', label: 'Status Aktif', type: 'boolean', default: true },
    ],
  },
  migration_convert_rule: {
    title: 'Convert Rule',
    fields: [
      { name: 'config_id', label: 'Config ID', type: 'number', required: true },
      { name: 'column_name', label: 'Column Name (Staging/Target)', type: 'text', required: true },
      { name: 'source_column', label: 'Source Column', type: 'text' },
      { name: 'lookup_name', label: 'Lookup Name', type: 'text' },
      { name: 'master_table', label: 'Master Table', type: 'text' },
      { name: 'on_unmapped', label: 'On Unmapped', type: 'select', options: ['REJECT', 'NULL', 'DEFAULT'], default: 'REJECT' },
      { name: 'default_value', label: 'Default Value', type: 'text' },
      { name: 'normalize', label: 'Normalize', type: 'boolean', default: false },
      { name: 'is_active', label: 'Status Aktif', type: 'boolean', default: true },
    ],
  },
  migration_target_config: {
    title: 'Target Config',
    fields: [
      { name: 'config_id', label: 'Config ID', type: 'number', required: true },
      { name: 'exec_order', label: 'Exec Order', type: 'number', default: 1, required: true },
      { name: 'tgt_schema', label: 'Target Schema', type: 'text', default: 'vendor', required: true },
      { name: 'tgt_table', label: 'Target Table', type: 'text', required: true },
      { name: 'pk_columns', label: 'PK Columns', type: 'text', default: 'id', required: true },
      { name: 'mapping_sql', label: 'Mapping SQL', type: 'textarea', required: true },
      { name: 'precheck_sql', label: 'Precheck SQL', type: 'textarea' },
      { name: 'postcheck_sql', label: 'Postcheck SQL', type: 'textarea' },
      { name: 'rollback_sql', label: 'Rollback SQL', type: 'textarea' },
    ],
  },
  migration_lookup: {
    title: 'Lookup Reference',
    fields: [
      { name: 'lookup_name', label: 'Lookup Name (PK)', type: 'text', required: true, isPk: true },
      { name: 'master_schema', label: 'Master Schema', type: 'text', default: 'public' },
      { name: 'master_table', label: 'Master Table', type: 'text', required: true },
      { name: 'master_src_col', label: 'Source Column', type: 'text', required: true },
      { name: 'master_tgt_col', label: 'Target Column', type: 'text', required: true },
      { name: 'master_filter', label: 'Filter Condition', type: 'text' },
      { name: 'on_unmapped', label: 'On Unmapped', type: 'select', options: ['REJECT', 'NULL', 'DEFAULT'], default: 'REJECT' },
      { name: 'default_value', label: 'Default Value', type: 'text' },
      { name: 'normalize', label: 'Normalize', type: 'boolean', default: false },
      { name: 'description', label: 'Deskripsi', type: 'textarea' },
    ],
  },
  client: {
    title: 'Master Client',
    fields: [
      { name: 'client_code', label: 'Kode Client (UPPERCASE font-mono)', type: 'text', placeholder: 'ANTAM', required: true, uppercase: true },
      { name: 'client_name', label: 'Nama Resmi Client', type: 'text', placeholder: 'PT ANTAM Tbk', required: true },
      { name: 'description', label: 'Deskripsi', type: 'textarea' },
      { name: 'is_active', label: 'Status Aktif', type: 'boolean', default: true },
    ],
  },
  environment: {
    title: 'Master Environment',
    fields: [
      { name: 'client_id', label: '1. Pilih Client Pemilik', type: 'select_client', required: true },
      { name: 'env_code', label: '2. Kode Environment (UPPERCASE font-mono)', type: 'text', placeholder: 'DEV', required: true, uppercase: true },
      { name: 'env_name', label: '3. Nama Environment', type: 'text', placeholder: 'Development Server', required: true },
      { name: 'description', label: 'Deskripsi', type: 'textarea' },
      { name: 'is_active', label: 'Status Aktif', type: 'boolean', default: true },
    ],
  },
  connection: {
    title: 'Master Connection',
    fields: [
      { name: 'client_id', label: '1. Pilih Client', type: 'select_client_cascade', required: true },
      { name: 'env_id', label: '2. Pilih Environment (Terkait Client)', type: 'select_env_cascade', required: true },
      { name: 'connection_name', label: 'Nama Koneksi Database', type: 'text', placeholder: 'Koneksi SQL Server Source DEV', required: true },
      { name: 'db_role', label: 'Peran Database (Role)', type: 'select', options: ['SOURCE', 'STAGING', 'TARGET'], default: 'SOURCE' },
      { name: 'db_type', label: 'Tipe Mesin Database', type: 'select', options: ['MSSQL', 'POSTGRESQL'], default: 'POSTGRESQL' },
      { name: 'host', label: 'Host / IP Server', type: 'text', placeholder: 'HOST_REDACTED atau localhost', required: true },
      { name: 'port', label: 'Port Database', type: 'number', default: 5432, required: true },
      { name: 'database_name', label: 'Nama Database', type: 'text', placeholder: 'db_procsi', required: true },
      { name: 'db_schema', label: 'Schema Database', type: 'text', default: 'dbo' },
      { name: 'username', label: 'Username Database', type: 'text', required: true },
      { name: 'password', label: 'Password Database', type: 'password', placeholder: 'Kosongkan jika password tidak diubah' },
      { name: 'use_ssh_tunnel', label: 'Gunakan SSH Tunnel', type: 'boolean', default: false },
      { name: 'ssh_host', label: 'SSH Host', type: 'text', placeholder: 'jump.server.local' },
      { name: 'ssh_port', label: 'SSH Port', type: 'number', default: 22 },
      { name: 'ssh_user', label: 'SSH User', type: 'text', placeholder: 'ubuntu' },
      { name: 'ssh_password', label: 'SSH Password / Key Passphrase', type: 'password' },
      { name: 'is_active', label: 'Status Aktif', type: 'boolean', default: true },
    ],
  },
};

window.openCreateConfigModal = function (tableName) {
  openUniversalForm(tableName, null);
};

window.openEditConfigModal = function (tableName, id) {
  const meta = state.config.masters[tableName];
  let record = null;
  if (tableName === 'migration_config') record = meta.find((r) => r.config_id == id);
  else if (tableName === 'migration_convert_rule') record = meta.find((r) => r.rule_id == id);
  else if (tableName === 'migration_target_config') record = meta.find((r) => r.target_config_id == id);
  else if (tableName === 'migration_lookup') record = meta.find((r) => r.lookup_name == id);

  openUniversalForm(tableName, id, record);
};

window.openCreateSettingModal = function (type) {
  openUniversalForm(type, null);
};

window.openEditSettingModal = async function (type, id) {
  if (!state.clients || state.clients.length === 0 || !state.environments || state.environments.length === 0) {
    await loadSettingsClientsAndEnvironments();
  }
  if (!state.connections || state.connections.length === 0) {
    await loadSettingsConnections();
  }

  let record = null;
  if (type === 'client') record = state.clients.find((c) => c.client_id == id);
  else if (type === 'environment') record = state.environments.find((e) => e.env_id == id);
  else if (type === 'connection') record = state.connections.find((c) => c.connection_id == id);

  openUniversalForm(type, id, record);
};

window.openUniversalForm = openUniversalForm;

function openUniversalForm(entityType, id = null, existingData = null) {
  state.config.editingTable = entityType;
  state.config.editingId = id;

  const def = FORM_DEFINITIONS[entityType];
  if (!def) return;

  const isEdit = id !== null;
  document.getElementById('crud-modal-title').textContent = `${isEdit ? 'Edit' : 'Tambah'} ${def.title}`;
  document.getElementById('crud-modal-subtitle').textContent = isEdit
    ? `Memperbarui record ID: #${id}`
    : `Membuat data baru pada ${def.title}`;

  // Normalisasi existingData untuk Connection
  let effectiveData = existingData ? { ...existingData } : {};
  if (entityType === 'connection') {
    if (isEdit && effectiveData.env_id) {
      const parentEnv = state.environments.find((e) => e.env_id == effectiveData.env_id);
      if (parentEnv && !effectiveData.client_id) {
        effectiveData.client_id = parentEnv.client_id;
      }
    } else if (!isEdit) {
      if (!effectiveData.client_id) {
        effectiveData.client_id = state.selectedClientId || (state.clients[0]?.client_id) || '';
      }
      if (!effectiveData.env_id && effectiveData.client_id) {
        const clientEnvs = state.environments.filter((e) => e.client_id == effectiveData.client_id);
        if (clientEnvs.length > 0) effectiveData.env_id = clientEnvs[0].env_id;
      }
    }
  }

  const container = document.getElementById('crud-modal-fields-container');
  const wideFields = [
    'compare_columns', 'src_precheck_sql', 'mapping_sql', 'precheck_sql',
    'postcheck_sql', 'rollback_sql', 'master_filter', 'description', 'note', 'sql_query'
  ];

  const fieldItems = def.fields.map((f) => {
    const val = effectiveData && effectiveData[f.name] !== undefined ? effectiveData[f.name] : (f.default !== undefined ? f.default : '');
    const isPkField = isEdit && f.isPk;
    const isWide = f.type === 'textarea' || wideFields.includes(f.name);

    let inputHtml = '';
    if (f.type === 'textarea') {
      inputHtml = `<textarea name="${f.name}" class="form-input form-textarea font-mono text-xs" rows="3" ${f.required ? 'required' : ''}>${escapeHtml(String(val || ''))}</textarea>`;
    } else if (f.type === 'boolean') {
      inputHtml = `
        <select name="${f.name}" class="form-input">
          <option value="true" ${val === true || val === 'true' ? 'selected' : ''}>True (Aktif / Ya)</option>
          <option value="false" ${val === false || val === 'false' ? 'selected' : ''}>False (Nonaktif / Tidak)</option>
        </select>
      `;
    } else if (f.type === 'select') {
      inputHtml = `
        <select name="${f.name}" class="form-input">
          ${f.options.map((opt) => `<option value="${opt}" ${val === opt ? 'selected' : ''}>${opt}</option>`).join('')}
        </select>
      `;
    } else if (f.type === 'select_client' || f.type === 'select_client_cascade') {
      const clientOptions = state.clients && state.clients.length > 0
        ? state.clients.map((c) => `<option value="${c.client_id}" ${val == c.client_id ? 'selected' : ''}>[${escapeHtml(c.client_code)}] ${escapeHtml(c.client_name)}</option>`).join('')
        : '<option value="">-- Belum ada Client (Buat Master Client terlebih dahulu) --</option>';
      inputHtml = `
        <select name="${f.name}" class="form-input" required>
          ${clientOptions}
        </select>
      `;
    } else if (f.type === 'select_env') {
      const envOptions = state.environments && state.environments.length > 0
        ? state.environments.map((e) => `<option value="${e.env_id}" ${val == e.env_id ? 'selected' : ''}>[${escapeHtml(e.env_code)}] ${escapeHtml(e.env_name)}</option>`).join('')
        : '<option value="">-- Belum ada Environment (Buat Master Environment terlebih dahulu) --</option>';
      inputHtml = `
        <select name="${f.name}" class="form-input" required>
          ${envOptions}
        </select>
      `;
    } else if (f.type === 'select_env_cascade') {
      const targetClientId = effectiveData.client_id ? parseInt(effectiveData.client_id, 10) : (state.clients[0]?.client_id || null);
      const filteredEnvs = targetClientId ? state.environments.filter((e) => e.client_id === targetClientId) : state.environments;

      const envOptions = filteredEnvs && filteredEnvs.length > 0
        ? filteredEnvs.map((e) => `<option value="${e.env_id}" ${val == e.env_id ? 'selected' : ''}>[${escapeHtml(e.env_code)}] ${escapeHtml(e.env_name)}</option>`).join('')
        : '<option value="">-- Belum ada Environment untuk Client ini (Tambahkan di Tab Environment) --</option>';
      inputHtml = `
        <select name="${f.name}" class="form-input" required>
          ${envOptions}
        </select>
      `;
    } else {
      const isUpper = f.uppercase || f.name === 'client_code' || f.name === 'env_code';
      const inputClass = isUpper ? 'form-input font-mono uppercase' : 'form-input';
      const inputStyle = isUpper ? 'style="text-transform: uppercase; font-family: monospace; font-weight: bold;"' : '';
      const oninputAttr = isUpper ? 'oninput="this.value = this.value.toUpperCase()"' : '';

      inputHtml = `
        <input type="${f.type}" name="${f.name}" class="${inputClass}" ${inputStyle} value="${escapeHtml(String(val || ''))}"
          placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''} ${isPkField ? 'readonly' : ''} ${oninputAttr}>
      `;
    }

    return `
      <div class="form-group mb-2 ${isWide ? 'col-span-2' : ''}">
        <label class="form-label">${f.label} ${f.required ? '<span class="text-rose">*</span>' : ''}</label>
        ${inputHtml}
      </div>
    `;
  }).join('');

  container.innerHTML = `<div class="modal-form-grid">${fieldItems}</div>`;

  // Interactive enhancements untuk connection form
  if (entityType === 'connection') {
    const selClient = container.querySelector('select[name="client_id"]');
    const selEnv = container.querySelector('select[name="env_id"]');
    if (selClient && selEnv) {
      selClient.addEventListener('change', () => {
        const cId = parseInt(selClient.value, 10);
        const envs = state.environments.filter((e) => e.client_id === cId);
        if (envs.length === 0) {
          selEnv.innerHTML = '<option value="">-- Belum ada Environment untuk Client ini (Tambahkan di Tab Environment) --</option>';
        } else {
          selEnv.innerHTML = envs.map((e) => `<option value="${e.env_id}">[${escapeHtml(e.env_code)}] ${escapeHtml(e.env_name)}</option>`).join('');
        }
      });
    }

    const selDbType = container.querySelector('select[name="db_type"]');
    const portInput = container.querySelector('input[name="port"]');
    const schemaInput = container.querySelector('input[name="db_schema"]');
    if (selDbType && portInput) {
      selDbType.addEventListener('change', () => {
        if (selDbType.value === 'MSSQL') {
          if (!portInput.value || portInput.value == 5432) portInput.value = 1433;
          if (schemaInput && (!schemaInput.value || schemaInput.value === 'public')) schemaInput.value = 'dbo';
        } else if (selDbType.value === 'POSTGRESQL') {
          if (!portInput.value || portInput.value == 1433) portInput.value = 5432;
          if (schemaInput && (!schemaInput.value || schemaInput.value === 'dbo')) schemaInput.value = 'public';
        }
      });
    }

    const selSsh = container.querySelector('select[name="use_ssh_tunnel"]');
    if (selSsh) {
      const toggleSsh = () => {
        const isSsh = selSsh.value === 'true';
        container.querySelectorAll('[name="ssh_host"], [name="ssh_port"], [name="ssh_user"], [name="ssh_password"]').forEach((el) => {
          const fg = el.closest('.form-group');
          if (fg) fg.style.display = isSsh ? 'block' : 'none';
        });
      };
      selSsh.addEventListener('change', toggleSsh);
      toggleSsh();
    }
  }

  document.getElementById('modal-config-form').classList.remove('hidden');
}

async function handleCrudSubmit(e) {
  e.preventDefault();
  const form = e.target;
  const formData = new FormData(form);
  const data = {};

  const def = FORM_DEFINITIONS[state.config.editingTable];
  def.fields.forEach((f) => {
    let val = formData.get(f.name);
    if (f.type === 'number' || f.name === 'client_id' || f.name === 'env_id' || f.name === 'config_id' || f.name === 'port' || f.name === 'ssh_port' || f.name === 'exec_order' || f.name === 'id_width') {
      val = val !== '' && val !== null ? Number(val) : null;
    } else if (f.type === 'boolean') {
      val = val === 'true';
    } else if (f.name === 'client_code' || f.name === 'env_code') {
      val = typeof val === 'string' ? val.trim().toUpperCase() : val;
    }
    data[f.name] = val;
  });

  const isEdit = state.config.editingId !== null;
  const entityType = state.config.editingTable;
  const id = state.config.editingId;

  // Khusus connection: hapus client_id dari payload karena tabel master_connection hanya menyimpan env_id
  if (entityType === 'connection') {
    delete data.client_id;
  }

  const btn = document.getElementById('btn-crud-submit');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    let url = '';
    let method = isEdit ? 'PUT' : 'POST';

    if (['migration_config', 'migration_convert_rule', 'migration_target_config', 'migration_lookup'].includes(entityType)) {
      if (!isEdit) {
        if (state.selectedClientId && !data.client_id) data.client_id = state.selectedClientId;
        if (state.selectedEnvId && !data.env_id) data.env_id = state.selectedEnvId;
      }
      url = isEdit ? `/api/etl/configs/${entityType}/${encodeURIComponent(id)}` : `/api/etl/configs/${entityType}`;
    } else if (entityType === 'client') {
      url = isEdit ? `/api/context/clients/${id}` : `/api/context/clients`;
    } else if (entityType === 'environment') {
      url = isEdit ? `/api/context/environments/${id}` : `/api/context/environments`;
    } else if (entityType === 'connection') {
      url = isEdit ? `/api/context/connections/${id}` : `/api/context/connections`;
    }

    const res = await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    alert(`✓ ${json.message || 'Data berhasil disimpan!'}`);
    document.getElementById('modal-config-form').classList.add('hidden');

    if (['client', 'environment', 'connection'].includes(entityType)) {
      await loadSettingsClients();
      await loadSettingsEnvironments();
      await loadSettingsConnections();
      await loadContextClientsAndEnvironments();
    } else {
      await loadEtlMasters();
    }
  } catch (err) {
    alert(`Gagal menyimpan data: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Simpan Data ✓';
  }
}

// =========================================================================
// UNIVERSAL DELETE CONFIRMATION DIALOG
// =========================================================================
window.openDeleteModal = function (type, id, displayName) {
  state.deleteTarget = { type, id, displayName };
  document.getElementById('delete-modal-msg').innerHTML = `
    Apakah Anda yakin ingin menghapus <strong>${escapeHtml(displayName)}</strong>?
  `;
  document.getElementById('modal-delete-confirm').classList.remove('hidden');
};

async function executeDeleteConfirm() {
  if (!state.deleteTarget) return;
  const { type, id } = state.deleteTarget;

  const btn = document.getElementById('btn-delete-proceed');
  btn.disabled = true;
  btn.textContent = 'Menghapus...';

  try {
    let url = '';
    if (type === 'source_view') {
      const connParam = state.selectedSourceConnectionId ? `?connection_id=${state.selectedSourceConnectionId}` : '';
      url = `/api/source/drop-view/${encodeURIComponent(id)}${connParam}`;
    } else if (['migration_config', 'migration_convert_rule', 'migration_target_config', 'migration_lookup'].includes(type)) {
      url = `/api/etl/configs/${type}/${encodeURIComponent(id)}`;
    } else if (type === 'client') {
      url = `/api/context/clients/${id}`;
    } else if (type === 'environment') {
      url = `/api/context/environments/${id}`;
    } else if (type === 'connection') {
      url = `/api/context/connections/${id}`;
    }

    const res = await fetch(url, { method: 'DELETE' });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    alert(`✓ Data berhasil dihapus.`);
    document.getElementById('modal-delete-confirm').classList.add('hidden');

    if (type === 'source_view') {
      loadSourceViews();
    } else if (['client', 'environment', 'connection'].includes(type)) {
      loadSettingsClientsAndEnvironments();
      loadSettingsConnections();
      loadContextClientsAndEnvironments();
    } else {
      loadEtlMasters();
    }
  } catch (err) {
    alert(`Gagal menghapus: ${err.message}`);
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hapus Permanen';
  }
}

// =========================================================================
// MODUL 3: MIGRATION PROSES (RUNS & LOGS)
// =========================================================================
async function loadEtlOverview() {
  try {
    const params = [];
    if (state.selectedClientId) params.push(`clientId=${state.selectedClientId}`);
    if (state.selectedEnvId) params.push(`envId=${state.selectedEnvId}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';

    const res = await fetch(`/api/etl/overview${qs}`);
    const json = await res.json();
    if (!json.success) return;
    const data = json.data;
    state.process.overview = data;

    document.getElementById('kpi-etl-total-runs').textContent = data.totalRuns;
    document.getElementById('kpi-etl-success-runs').textContent = data.successRuns;
    document.getElementById('kpi-etl-failed-runs').textContent = data.failedRuns;
    document.getElementById('kpi-etl-total-errors').textContent = data.totalErrors;
  } catch (e) {}
}

async function loadEtlRuns() {
  const tbody = document.getElementById('etl-runs-table-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-muted">Memuat data migration_run...</td></tr>`;

  try {
    const { page, limit, status, sortBy, sortDir } = state.process;
    const params = [
      `page=${page || 1}`,
      `limit=${limit || 50}`,
    ];
    if (status) params.push(`status=${encodeURIComponent(status)}`);
    if (sortBy) params.push(`sortBy=${encodeURIComponent(sortBy)}`);
    if (sortDir) params.push(`sortDir=${encodeURIComponent(sortDir)}`);
    if (state.selectedClientId) params.push(`clientId=${state.selectedClientId}`);
    if (state.selectedEnvId) params.push(`envId=${state.selectedEnvId}`);
    const qs = `?${params.join('&')}`;

    const res = await fetch(`/api/etl/runs${qs}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    state.process.runs = data.runs || [];
    state.process.total = data.total || 0;
    state.process.totalPages = data.totalPages || 1;

    // Update Sort Headers UI on Tab 3
    document.querySelectorAll('th[data-run-col]').forEach((th) => {
      const col = th.dataset.runCol;
      const iconSpan = th.querySelector('.sort-icon');
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (col === sortBy) {
        th.classList.add(sortDir.toLowerCase() === 'asc' ? 'sorted-asc' : 'sorted-desc');
        if (iconSpan) iconSpan.textContent = sortDir.toLowerCase() === 'asc' ? '▲' : '▼';
      } else {
        if (iconSpan) iconSpan.textContent = '↕';
      }
    });

    // Update Pagination UI on Tab 3
    const total = state.process.total;
    const curPage = state.process.page || 1;
    const curLimit = state.process.limit || 50;
    const startIdx = total === 0 ? 0 : (curPage - 1) * curLimit + 1;
    const endIdx = Math.min(curPage * curLimit, total);

    const infoRange = document.getElementById('info-runs-range');
    const infoTotal = document.getElementById('info-runs-total');
    const badgePage = document.getElementById('badge-runs-page');
    const btnPrev = document.getElementById('btn-runs-prev');
    const btnNext = document.getElementById('btn-runs-next');

    if (infoRange) infoRange.textContent = `${startIdx}-${endIdx}`;
    if (infoTotal) infoTotal.textContent = total;
    if (badgePage) badgePage.textContent = `Hal ${curPage} / ${state.process.totalPages}`;
    if (btnPrev) btnPrev.disabled = curPage <= 1;
    if (btnNext) btnNext.disabled = curPage >= state.process.totalPages;

    if (state.process.runs.length === 0) {
      tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-muted">Belum ada riwayat run di table migration_run untuk environment ini.</td></tr>`;
      state.process.selectedRunId = null;
      document.getElementById('etl-steps-table-body').innerHTML = `<tr><td colspan="12" class="text-center py-8 text-muted">Tidak ada log langkah untuk environment ini.</td></tr>`;
      document.getElementById('etl-errors-table-body').innerHTML = `<tr><td colspan="10" class="text-center py-8 text-muted">Tidak ada log error pada environment ini.</td></tr>`;
      document.getElementById('steplogs-filter-desc').textContent = 'Menampilkan seluruh riwayat langkah proses ETL';
      document.getElementById('btn-clear-step-filter').classList.add('hidden');
      document.getElementById('errorlogs-filter-desc').textContent = 'Rincian error transformasi dan sampel data baris bermasalah';
      document.getElementById('btn-clear-error-filter').classList.add('hidden');
      return;
    }

    if (state.process.selectedRunId && !state.process.runs.some((r) => r.run_id == state.process.selectedRunId)) {
      state.process.selectedRunId = null;
      document.getElementById('steplogs-filter-desc').textContent = 'Menampilkan seluruh riwayat langkah proses ETL';
      document.getElementById('btn-clear-step-filter').classList.add('hidden');
      document.getElementById('errorlogs-filter-desc').textContent = 'Rincian error transformasi dan sampel data baris bermasalah';
      document.getElementById('btn-clear-error-filter').classList.add('hidden');
    }

    tbody.innerHTML = state.process.runs.map((run) => {
      const isSuccess = run.status === 'SUCCESS' || run.status === 'COMPLETED';
      const isFailed = run.status === 'FAILED';
      const badgeClass = isSuccess ? 'badge-success' : (isFailed ? 'badge-danger' : 'badge-warning');
      const isFiltered = state.process.selectedRunId == run.run_id;

      const postBadge = run.is_posted
        ? `<span class="badge badge-success">✓ Posted (${escapeHtml(run.post_type || 'auto')})</span>`
        : `<span class="badge badge-neutral">Belum</span>`;

      const rollbackBadge = run.is_rolled_back
        ? `<span class="badge badge-danger">⚠️ Rolled Back</span>`
        : `<span class="badge badge-neutral">Normal</span>`;

      const clientBadge = run.client_code
        ? `<span class="badge badge-info font-mono font-bold" title="${escapeHtml(run.client_name || '')}">${escapeHtml(run.client_code)}</span>`
        : `<span class="badge badge-neutral text-xs">GLOBAL</span>`;

      const envBadge = run.env_code
        ? `<span class="badge badge-purple font-mono font-bold" title="${escapeHtml(run.env_name || '')}">${escapeHtml(run.env_code)}</span>`
        : `<span class="badge badge-neutral text-xs">DEFAULT</span>`;

      return `
        <tr class="${isFiltered ? 'active-row' : ''}">
          <td class="font-mono font-bold">#${run.run_id}</td>
          <td>${clientBadge}</td>
          <td>${envBadge}</td>
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
    tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

window.filterLogsByRun = function (runId) {
  state.process.selectedRunId = runId;

  document.getElementById('steplogs-filter-desc').innerHTML = `Menampilkan log langkah untuk <strong>Run #${runId}</strong>`;
  document.getElementById('btn-clear-step-filter').classList.remove('hidden');

  document.getElementById('errorlogs-filter-desc').innerHTML = `Menampilkan log error untuk <strong>Run #${runId}</strong>`;
  document.getElementById('btn-clear-error-filter').classList.remove('hidden');

  switchProcessSubtab('subtab-steplogs');
};

async function loadEtlStepLogs(runId = null) {
  const tbody = document.getElementById('etl-steps-table-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-muted">Memuat data migration_step_log...</td></tr>`;

  try {
    const sState = state.process.stepLogsState;
    const params = [
      `page=${sState.page || 1}`,
      `limit=${sState.limit || 50}`,
    ];
    if (sState.status) params.push(`status=${encodeURIComponent(sState.status)}`);
    if (sState.sortBy) params.push(`sortBy=${encodeURIComponent(sState.sortBy)}`);
    if (sState.sortDir) params.push(`sortDir=${encodeURIComponent(sState.sortDir)}`);

    if (runId) {
      params.push(`runId=${runId}`);
    } else {
      if (state.selectedClientId) params.push(`clientId=${state.selectedClientId}`);
      if (state.selectedEnvId) params.push(`envId=${state.selectedEnvId}`);
    }

    const res = await fetch(`/api/etl/step-logs?${params.join('&')}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    const list = Array.isArray(data) ? data : (data.stepLogs || []);
    sState.total = data.total !== undefined ? data.total : list.length;
    sState.totalPages = data.totalPages !== undefined ? data.totalPages : (Math.ceil(sState.total / sState.limit) || 1);
    state.process.stepLogs = list;

    // Update Sort Headers UI
    document.querySelectorAll('th[data-step-col]').forEach((th) => {
      const col = th.dataset.stepCol;
      const iconSpan = th.querySelector('.sort-icon');
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (col === sState.sortBy) {
        th.classList.add(sState.sortDir.toLowerCase() === 'asc' ? 'sorted-asc' : 'sorted-desc');
        if (iconSpan) iconSpan.textContent = sState.sortDir.toLowerCase() === 'asc' ? '▲' : '▼';
      } else {
        if (iconSpan) iconSpan.textContent = '↕';
      }
    });

    // Update Pagination UI
    const total = sState.total;
    const curPage = sState.page || 1;
    const curLimit = sState.limit || 50;
    const startIdx = total === 0 ? 0 : (curPage - 1) * curLimit + 1;
    const endIdx = Math.min(curPage * curLimit, total);

    const infoRange = document.getElementById('info-steplogs-range');
    const infoTotal = document.getElementById('info-steplogs-total');
    const badgePage = document.getElementById('badge-steplogs-page');
    const btnPrev = document.getElementById('btn-steplogs-prev');
    const btnNext = document.getElementById('btn-steplogs-next');

    if (infoRange) infoRange.textContent = `${startIdx}-${endIdx}`;
    if (infoTotal) infoTotal.textContent = total;
    if (badgePage) badgePage.textContent = `Hal ${curPage} / ${sState.totalPages}`;
    if (btnPrev) btnPrev.disabled = curPage <= 1;
    if (btnNext) btnNext.disabled = curPage >= sState.totalPages;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-muted">Tidak ada log langkah ${runId ? `untuk Run #${runId}` : ''}.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((s) => {
      const isSuccess = s.status === 'SUCCESS' || s.status === 'OK';
      const isFailed = s.status === 'FAILED';
      const badgeClass = isSuccess ? 'badge-success' : (isFailed ? 'badge-danger' : 'badge-warning');

      return `
        <tr>
          <td class="font-mono text-muted text-center">${s.log_id}</td>
          <td class="font-mono font-bold text-center">#${s.run_id}</td>
          <td class="font-mono text-cyan text-center">${s.config_id ? `#${s.config_id}` : '-'}</td>
          <td><strong>${escapeHtml(s.step_name)}</strong></td>
          <td class="text-center"><span class="badge ${badgeClass}">${s.status}</span></td>
          <td class="font-mono text-center">${s.rows_src ?? '-'}</td>
          <td class="font-mono text-center">${s.rows_stg ?? '-'}</td>
          <td class="font-mono text-emerald text-center">${s.rows_new ?? '-'}</td>
          <td class="font-mono text-amber text-center">${s.rows_changed ?? '-'}</td>
          <td class="font-mono text-rose text-center">${s.rows_deleted ?? '-'}</td>
          <td class="font-mono text-center">${s.duration_seconds ? s.duration_seconds + 's' : '-'}</td>
          <td style="max-width: 250px;" class="text-muted wrap-col" title="${escapeHtml(s.message || '')}">${escapeHtml(s.message || '-')}</td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="12" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

async function loadEtlErrorLogs(runId = null) {
  const tbody = document.getElementById('etl-errors-table-body');
  if (!tbody) return;
  tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-muted">Memuat data migration_error_log...</td></tr>`;

  try {
    const eState = state.process.errorLogsState;
    const params = [
      `page=${eState.page || 1}`,
      `limit=${eState.limit || 50}`,
    ];
    if (eState.sortBy) params.push(`sortBy=${encodeURIComponent(eState.sortBy)}`);
    if (eState.sortDir) params.push(`sortDir=${encodeURIComponent(eState.sortDir)}`);

    if (runId) {
      params.push(`runId=${runId}`);
    } else {
      if (state.selectedClientId) params.push(`clientId=${state.selectedClientId}`);
      if (state.selectedEnvId) params.push(`envId=${state.selectedEnvId}`);
    }

    const res = await fetch(`/api/etl/error-logs?${params.join('&')}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    const list = Array.isArray(data) ? data : (data.errorLogs || []);
    eState.total = data.total !== undefined ? data.total : list.length;
    eState.totalPages = data.totalPages !== undefined ? data.totalPages : (Math.ceil(eState.total / eState.limit) || 1);
    state.process.errorLogs = list;

    // Update Sort Headers UI
    document.querySelectorAll('th[data-error-col]').forEach((th) => {
      const col = th.dataset.errorCol;
      const iconSpan = th.querySelector('.sort-icon');
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (col === eState.sortBy) {
        th.classList.add(eState.sortDir.toLowerCase() === 'asc' ? 'sorted-asc' : 'sorted-desc');
        if (iconSpan) iconSpan.textContent = eState.sortDir.toLowerCase() === 'asc' ? '▲' : '▼';
      } else {
        if (iconSpan) iconSpan.textContent = '↕';
      }
    });

    // Update Pagination UI
    const total = eState.total;
    const curPage = eState.page || 1;
    const curLimit = eState.limit || 50;
    const startIdx = total === 0 ? 0 : (curPage - 1) * curLimit + 1;
    const endIdx = Math.min(curPage * curLimit, total);

    const infoRange = document.getElementById('info-errorlogs-range');
    const infoTotal = document.getElementById('info-errorlogs-total');
    const badgePage = document.getElementById('badge-errorlogs-page');
    const btnPrev = document.getElementById('btn-errorlogs-prev');
    const btnNext = document.getElementById('btn-errorlogs-next');

    if (infoRange) infoRange.textContent = `${startIdx}-${endIdx}`;
    if (infoTotal) infoTotal.textContent = total;
    if (badgePage) badgePage.textContent = `Hal ${curPage} / ${eState.totalPages}`;
    if (btnPrev) btnPrev.disabled = curPage <= 1;
    if (btnNext) btnNext.disabled = curPage >= eState.totalPages;

    if (list.length === 0) {
      tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-muted">Tidak ada log error ${runId ? `pada Run #${runId}` : ''}.</td></tr>`;
      return;
    }

    tbody.innerHTML = list.map((e) => {
      const rawJson = e.row_data ? (typeof e.row_data === 'object' ? JSON.stringify(e.row_data, null, 2) : String(e.row_data)) : '';
      return `
        <tr>
          <td class="font-mono text-muted text-center">${e.error_id}</td>
          <td class="font-mono font-bold text-center">#${e.run_id}</td>
          <td class="font-mono text-cyan text-center">${e.config_id ? `#${e.config_id}` : '-'}</td>
          <td class="font-mono">${escapeHtml(e.step_name || '-')}</td>
          <td><strong class="text-amber">${escapeHtml(e.pipeline_name || e.transform_name || '-')}</strong></td>
          <td class="font-mono text-rose text-center" style="font-size: 0.75rem;">${escapeHtml(e.error_code || '-')}</td>
          <td class="font-mono text-muted" style="font-size: 0.75rem;">${formatDate(e.error_time)}</td>
          <td style="max-width: 250px;" class="text-rose wrap-col"><strong>${escapeHtml(e.error_message || '')}</strong></td>
          <td class="font-mono text-amber">${escapeHtml(e.error_field || '-')}</td>
          <td class="text-center">
            ${rawJson ? `<button class="btn btn-secondary btn-sm" onclick="showJsonModal(${e.error_id})">Lihat JSON</button>` : '-'}
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="10" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

window.showJsonModal = function (errorId) {
  const item = state.process.errorLogs.find((e) => e.error_id == errorId);
  if (!item) return;

  const modal = document.getElementById('modal-json');
  const codePre = document.getElementById('modal-json-content');
  codePre.textContent = typeof item.row_data === 'object' ? JSON.stringify(item.row_data, null, 2) : item.row_data;
  modal.classList.remove('hidden');
};

// =========================================================================
// MODUL 4: HASIL MIGRASI (PIPELINE 3-TIER RECONCILIATION)
// =========================================================================
async function loadPipelineReconciliation() {
  const masterTbody = document.getElementById('pipeline-master-tbody');
  masterTbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-muted">Mengambil data rekonsiliasi 3-Tahap...</td></tr>`;

  try {
    const params = [];
    if (state.selectedClientId) params.push(`clientId=${state.selectedClientId}`);
    if (state.selectedEnvId) params.push(`envId=${state.selectedEnvId}`);
    const qs = params.length > 0 ? `?${params.join('&')}` : '';

    const res = await fetch(`/api/reconciliation/pipeline${qs}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    state.pipeline.pipelines = data.pipelines;

    if (data.pipelines.length === 0) {
      masterTbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-muted">Belum ada data konfigurasi di migration_config untuk environment ini.</td></tr>`;
      state.pipeline.selectedConfigId = null;
      document.getElementById('pipeline-detail-title').textContent = 'Detail Pipeline';
      document.getElementById('pipeline-detail-desc').textContent = 'Belum ada alur rekonsiliasi untuk environment ini.';
      document.getElementById('pipeline-detail-badges').innerHTML = '';
      document.getElementById('pipeline-flow-diagram').innerHTML = '<div class="text-center py-8 text-muted" style="width: 100%;">Tidak ada alur pipeline yang aktif.</div>';
      document.getElementById('stage-location-badge').textContent = 'Tabel: -';
      document.getElementById('stage-total-records').textContent = '0';
      document.getElementById('stage-pagination-info').textContent = '0 baris ditemukan.';
      document.getElementById('stage-page-numbers').innerHTML = '';
      document.getElementById('btn-stage-prev').disabled = true;
      document.getElementById('btn-stage-next').disabled = true;
      document.getElementById('stage-data-thead').innerHTML = '<tr><th>Data Kosong</th></tr>';
      document.getElementById('stage-data-tbody').innerHTML = '<tr><td class="text-center py-8 text-muted">Tidak ada data tahap pipeline.</td></tr>';
      return;
    }

    masterTbody.innerHTML = data.pipelines.map((p) => {
      const isSelected = p.configId === state.pipeline.selectedConfigId;
      const srcRows = p.source.rows ?? 0;
      const stgRows = p.staging.rows ?? 0;
      const tgtRows = p.target.rows ?? 0;

      const isMatch = p.reconciliation.sourceToStagingStatus === 'MATCH';
      const statusBadge = isMatch
        ? `<span class="badge badge-success">✓ 100% Match</span>`
        : `<span class="badge badge-warning">⏳ Selisih (${p.reconciliation.deltaSourceToStaging})</span>`;

      return `
        <tr class="${isSelected ? 'active-row' : ''}" id="cfg-row-${p.configId}">
          <td class="font-mono font-bold">#${p.configId}</td>
          <td class="font-mono">${p.execOrder}</td>
          <td><strong class="text-cyan">[${p.source.schema}].[${p.source.view}]</strong></td>
          <td><strong class="text-amber">stg_antam.${p.staging.table}</strong></td>
          <td><strong class="text-emerald">${p.target.schema}.${p.target.table}</strong></td>
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
              <button class="btn btn-secondary btn-sm" onclick="selectPipelineConfig(${p.configId})">Tinjau</button>
              <button class="btn btn-primary btn-sm" onclick="openBeritaAcara(${p.configId})" title="Cetak Berita Acara">🖨️ BA</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');

    const targetConfigId = (state.pipeline.selectedConfigId && data.pipelines.some((x) => x.configId === state.pipeline.selectedConfigId))
      ? state.pipeline.selectedConfigId
      : data.pipelines[0].configId;
    selectPipelineConfig(targetConfigId);
  } catch (err) {
    masterTbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

window.selectPipelineConfig = function (configId) {
  state.pipeline.selectedConfigId = configId;
  document.querySelectorAll('#pipeline-master-tbody tr').forEach((tr) => tr.classList.remove('active-row'));
  const activeTr = document.getElementById(`cfg-row-${configId}`);
  if (activeTr) activeTr.classList.add('active-row');

  const p = state.pipeline.pipelines.find((x) => x.configId === configId);
  if (!p) return;

  document.getElementById('pipeline-detail-title').textContent = `Detail Pipeline: Config #${p.configId} (${p.source.view})`;
  document.getElementById('pipeline-detail-desc').textContent = `Alur rekonsiliasi: [${p.source.schema}].[${p.source.view}] ➔ stg_antam.${p.staging.table} ➔ ${p.target.schema}.${p.target.table}`;

  const delta1 = p.reconciliation.deltaSourceToStaging;
  const isMatch = p.reconciliation.sourceToStagingStatus === 'MATCH';
  document.getElementById('pipeline-detail-badges').innerHTML = `
    <span class="badge ${isMatch ? 'badge-success' : 'badge-warning'}">${isMatch ? '✓ Source ➔ Staging Sinkron' : '⏳ Ada Selisih'}</span>
    <span class="badge ${p.isActive ? 'badge-neutral' : 'badge-danger'}">${p.isActive ? 'Status: Active' : 'Status: Inactive'}</span>
  `;

  const srcRows = p.source.rows ?? 0;
  const stgRows = p.staging.rows ?? 0;
  const tgtRows = p.target.rows ?? 0;
  const delta2 = p.reconciliation.deltaStagingToTarget;

  document.getElementById('pipeline-flow-diagram').innerHTML = `
    <div class="pipeline-node source">
      <div class="node-stage-label text-cyan">1. Source View (${p.source.dbType || 'SQL Server'})</div>
      <div class="node-table-name">[${p.source.schema}].[${p.source.view}]</div>
      <div class="node-rows-val">${formatNumber(srcRows)}</div>
      <div class="node-db-meta">Database: ${p.source.database || 'Source DB'}</div>
    </div>
    <div class="pipeline-arrow">
      <span class="arrow-symbol">➔</span>
      <span class="arrow-delta ${delta1 === 0 ? 'text-emerald' : 'text-amber'}">${delta1 === 0 ? 'Match' : (delta1 > 0 ? '+' + delta1 : delta1)}</span>
    </div>
    <div class="pipeline-node staging">
      <div class="node-stage-label text-amber">2. Staging Table (PostgreSQL)</div>
      <div class="node-table-name">${p.staging.schema || 'stg_antam'}.${p.staging.table}</div>
      <div class="node-rows-val">${formatNumber(stgRows)}</div>
      <div class="node-db-meta">Database: ${p.staging.database || 'PostgreSQL'}</div>
    </div>
    <div class="pipeline-arrow">
      <span class="arrow-symbol">➔</span>
      <span class="arrow-delta text-cyan">${delta2 >= 0 ? '+' + formatNumber(delta2) : formatNumber(delta2)}</span>
    </div>
    <div class="pipeline-node target">
      <div class="node-stage-label text-emerald">3. Final Target (PostgreSQL)</div>
      <div class="node-table-name">${p.target.schema}.${p.target.table}</div>
      <div class="node-rows-val">${formatNumber(tgtRows)}</div>
      <div class="node-db-meta">Database: ${p.target.database || 'PostgreSQL'}</div>
    </div>
  `;

  state.pipeline.page = 1;
  loadPipelineStageData();
};

async function loadPipelineStageData() {
  const configId = state.pipeline.selectedConfigId;
  const stage = state.pipeline.selectedStage;

  document.querySelectorAll('.stage-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-stage') === stage);
  });

  const thead = document.getElementById('stage-data-thead');
  const tbody = document.getElementById('stage-data-tbody');

  thead.innerHTML = `<tr><th class="text-center py-8 text-muted">Memuat baris data ${stage}...</th></tr>`;
  tbody.innerHTML = `<tr><td class="text-center py-8 text-muted">Mengambil data dari database...</td></tr>`;

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

    document.getElementById('stage-location-badge').textContent = `Tabel: ${data.location}`;
    document.getElementById('stage-total-records').textContent = formatNumber(data.total);

    const startIdx = data.total > 0 ? (data.page - 1) * data.limit + 1 : 0;
    const endIdx = Math.min(data.page * data.limit, data.total);
    document.getElementById('stage-pagination-info').textContent = data.total > 0
      ? `Menampilkan ${formatNumber(startIdx)} - ${formatNumber(endIdx)} dari total ${formatNumber(data.total)} baris`
      : '0 baris ditemukan.';

    document.getElementById('btn-stage-prev').disabled = data.page <= 1;
    document.getElementById('btn-stage-next').disabled = data.page >= data.totalPages;

    renderPaginationNumbers('stage-page-numbers', data.page, data.totalPages, (newPage) => {
      state.pipeline.page = newPage;
      loadPipelineStageData();
    });

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
  }
}

// =========================================================================
// BERITA ACARA VALIDASI GENERATOR & CSV EXPORT
// =========================================================================
window.openBeritaAcara = async function (configId) {
  const targetId = configId || state.pipeline.selectedConfigId || 1;
  const modal = document.getElementById('modal-berita-acara');
  modal.classList.remove('hidden');

  try {
    const res = await fetch(`/api/reconciliation/berita-acara?configId=${targetId}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    state.beritaAcaraData = data;

    document.getElementById('ba-doc-no').textContent = `Nomor: ${data.document.docNumber}`;
    document.getElementById('ba-doc-day-date').textContent = `${data.document.dateString} pukul ${data.document.timeString} WIB`;

    document.getElementById('ba-param-grid').innerHTML = `
      <div class="ba-param-item"><strong>Config ID:</strong> Config #${data.config.configId} (Order ${data.config.execOrder})</div>
      <div class="ba-param-item"><strong>Source View:</strong> [${data.config.source.database}].[${data.config.source.schema}].[${data.config.source.view}]</div>
      <div class="ba-param-item"><strong>Staging Table:</strong> ${data.config.staging.database}.${data.config.staging.schema}.${data.config.staging.table}</div>
      <div class="ba-param-item"><strong>Target Table:</strong> ${data.config.target.database}.${data.config.target.schema}.${data.config.target.table}</div>
      <div class="ba-param-item"><strong>Kunci PK:</strong> ${data.config.pkColumns || 'id'}</div>
      <div class="ba-param-item"><strong>Compare Columns:</strong> ${data.config.compareColumns || '-'}</div>
    `;

    const srcRows = data.config.source.rows ?? 0;
    const stgRows = data.config.staging.rows ?? 0;
    const tgtRows = data.config.target.rows ?? 0;
    const delta1 = data.config.deltaSourceToStaging;
    const delta2 = data.config.deltaStagingToTarget;
    const isMatch = delta1 === 0 && srcRows > 0;

    document.getElementById('ba-reconciliation-tbody').innerHTML = `
      <tr>
        <td><strong>1. Sumber Data (Source)</strong></td>
        <td><code>[${data.config.source.schema}].[${data.config.source.view}]</code></td>
        <td><code>${data.config.pkColumns || 'id'}</code></td>
        <td><strong>${formatNumber(srcRows)}</strong> baris</td>
        <td>- (Basis)</td>
        <td><span class="badge badge-neutral">Basis Sumber</span></td>
      </tr>
      <tr>
        <td><strong>2. Penampungan (Staging)</strong></td>
        <td><code>${data.config.staging.schema}.${data.config.staging.table}</code></td>
        <td><code>${data.config.pkColumns || 'id'}</code></td>
        <td><strong>${formatNumber(stgRows)}</strong> baris</td>
        <td>${delta1 === 0 ? '0' : (delta1 > 0 ? '+' + delta1 : delta1)}</td>
        <td><span class="badge ${isMatch ? 'badge-success' : 'badge-warning'}">${isMatch ? '✓ Valid / Sinkron' : '⏳ Ada Selisih'}</span></td>
      </tr>
      <tr>
        <td><strong>3. Hasil Akhir (Target)</strong></td>
        <td><code>${data.config.target.schema}.${data.config.target.table}</code></td>
        <td><code>${data.config.pkColumns || 'id'}</code></td>
        <td><strong>${formatNumber(tgtRows)}</strong> baris</td>
        <td>${delta2 >= 0 ? '+' + formatNumber(delta2) : formatNumber(delta2)}</td>
        <td><span class="badge badge-success">Target Aktif</span></td>
      </tr>
    `;

    document.getElementById('ba-notes-list').innerHTML = `
      <li>Total data dari sumber SQL Server yang diproses sebanyak <strong>${formatNumber(srcRows)}</strong> baris.</li>
      <li>Data yang berhasil disimpan di tabel staging adalah <strong>${formatNumber(stgRows)}</strong> baris.</li>
      <li>Status rekonsiliasi data dinyatakan <strong>${data.document.verdict}</strong>.</li>
    `;

    document.getElementById('ba-attachment-heading').textContent = `REKAPITULASI DATA STAGING (${data.stagingAttachment.schema}.${data.stagingAttachment.table})`;
    document.getElementById('ba-attachment-meta').textContent = `Total data staging: ${formatNumber(data.stagingAttachment.totalRecords)} baris.`;

    const cols = data.stagingAttachment.columns;
    const rows = data.stagingAttachment.rows;
    const preferredCols = ['id', 'uuid', 'name', 'email', 'status', 'sap_code', 'tipe_vendor', 'company_type_id', 'created_at'];
    const activeCols = cols.filter(c => preferredCols.includes(c.name)).concat(cols.filter(c => !preferredCols.includes(c.name))).slice(0, 10);

    document.getElementById('ba-attachment-thead').innerHTML = `
      <tr>
        <th style="width: 35px; text-align: center;">No</th>
        ${activeCols.map(c => `<th>${c.name}</th>`).join('')}
      </tr>
    `;

    if (rows.length === 0) {
      document.getElementById('ba-attachment-tbody').innerHTML = `<tr><td colspan="${activeCols.length + 1}" class="text-center py-4 text-muted">Tidak ada data staging.</td></tr>`;
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
    alert(`Gagal memuat Berita Acara: ${err.message}`);
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
  csvRows.push(colNames.map(c => `"${c}"`).join(','));

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

// =========================================================================
// HELPER UTILITIES
// =========================================================================
function renderPaginationNumbers(containerId, currentPage, totalPages, onPageClick) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!totalPages || totalPages < 1) {
    container.innerHTML = '';
    return;
  }

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
    if (p === '...') return `<span class="page-num-ellipsis">…</span>`;
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
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Global Window Function Bindings for HTML onclick events
window.switchMainTab = switchMainTab;
window.openSettingsModal = openSettingsModal;
window.openCreateConfigModal = openCreateConfigModal;
window.openEditConfigModal = openEditConfigModal;
window.openCreateSettingModal = openCreateSettingModal;
window.openEditSettingModal = openEditSettingModal;
window.openUniversalForm = openUniversalForm;
window.openDeleteModal = openDeleteModal;
window.executeDeleteConfirm = executeDeleteConfirm;
window.openViewEditor = openViewEditor;
window.closeViewEditor = closeViewEditor;
window.showJsonModal = showJsonModal;
window.openBeritaAcara = openBeritaAcara;
window.testPingConnection = testPingConnection;
window.prevWizardStep = prevWizardStep;
window.nextWizardStep = nextWizardStep;
window.finishWizard = finishWizard;




// =========================================================================
// MULTI-SOURCE CONNECTION SELECTOR & VIEW MANAGER (Requirement 5)
// =========================================================================
async function loadSourceConnectionsSelect(envId = null) {
  const selectEl = document.getElementById('source-connection-select');
  const veSelect = document.getElementById('ve-connection-id');
  if (!selectEl) return;

  try {
    const targetEnvId = envId !== null ? envId : state.selectedEnvId;
    const url = targetEnvId ? `/api/context/connections?envId=${targetEnvId}` : '/api/context/connections';
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) return;

    const allConns = json.data || [];
    // Prioritaskan koneksi bertipe SOURCE
    const sourceConns = allConns.filter((c) => c.db_role === 'SOURCE');
    state.sourceConnectionsList = sourceConns.length > 0 ? sourceConns : allConns;

    if (state.sourceConnectionsList.length > 0) {
      state.selectedSourceConnectionId = state.sourceConnectionsList[0].connection_id;
    } else {
      state.selectedSourceConnectionId = null;
    }

    const optionsHtml = state.sourceConnectionsList.map((c) => {
      const selected = String(c.connection_id) === String(state.selectedSourceConnectionId) ? 'selected' : '';
      return `<option value="${c.connection_id}" ${selected}>${escapeHtml(c.connection_name)} (${c.db_type} - ${escapeHtml(c.database_name)})</option>`;
    }).join('');

    selectEl.innerHTML = optionsHtml || '<option value="">(Belum ada koneksi SOURCE)</option>';
    if (veSelect) {
      veSelect.innerHTML = optionsHtml || '<option value="">(Belum ada koneksi SOURCE)</option>';
    }

    updateSourceConnectionBadge();
  } catch (err) {
    console.warn('Gagal memuat daftar koneksi sumber:', err.message);
  }
}

function updateSourceConnectionBadge() {
  const badgeEl = document.getElementById('source-connection-badge');
  if (!badgeEl) return;

  const current = state.sourceConnectionsList.find(
    (c) => String(c.connection_id) === String(state.selectedSourceConnectionId)
  );

  if (current) {
    badgeEl.textContent = `${current.db_type} • ${current.database_name} (${current.db_schema || 'dbo'})`;
    const veSchema = document.getElementById('ve-schema-name');
    if (veSchema) {
      veSchema.value = current.db_schema || (current.db_type === 'MSSQL' ? 'dbo' : 'public');
    }
  } else {
    badgeEl.textContent = 'Semua Koneksi';
  }
}

// =========================================================================
// MODAL ENVIRONMENT & MULTI-CONNECTION MANAGER (Requirement 1)
// =========================================================================
let currentEnvConnections = [];

window.openEnvManagerModal = async function (clientId, envId = null) {
  const client = state.clients.find((c) => c.client_id == clientId) || { client_id: clientId, client_code: 'CLIENT', client_name: 'Client' };
  
  document.getElementById('em-client-id').value = clientId;
  document.getElementById('em-client-badge').textContent = `Client: [${client.client_code}] ${client.client_name}`;
  
  const modalTitle = document.getElementById('em-modal-title');
  const modeBadge = document.getElementById('em-mode-badge');
  
  // Reset form koneksi item
  hideEnvConnForm();

  if (envId) {
    // Mode Edit Environment
    modeBadge.textContent = 'Mode: Edit Environment';
    modeBadge.className = 'badge badge-info text-xs';
    modalTitle.textContent = '✏️ Edit Environment & Koneksi Database';
    document.getElementById('em-env-id').value = envId;

    try {
      const res = await fetch(`/api/context/environments/${envId}/details`);
      const json = await res.json();
      if (!json.success) throw new Error(json.error);

      const env = json.data.environment;
      document.getElementById('em-env-code').value = env.env_code || '';
      document.getElementById('em-env-name').value = env.env_name || '';
      document.getElementById('em-env-desc').value = env.description || '';
      document.getElementById('em-env-is-active').checked = env.is_active !== false;

      currentEnvConnections = json.data.connections || [];
    } catch (err) {
      alert('Gagal memuat detail environment: ' + err.message);
      return;
    }
  } else {
    // Mode Create Environment
    modeBadge.textContent = 'Mode: Create Environment Baru';
    modeBadge.className = 'badge badge-success text-xs';
    modalTitle.textContent = '➕ Create Environment & Setup Koneksi';
    document.getElementById('em-env-id').value = '';
    document.getElementById('em-env-code').value = 'DEV';
    document.getElementById('em-env-name').value = 'Development';
    document.getElementById('em-env-desc').value = `Lingkungan migrasi untuk ${client.client_name}`;
    document.getElementById('em-env-is-active').checked = true;

    currentEnvConnections = [];
  }

  renderEnvConnectionsTable();
  document.getElementById('modal-env-manager').classList.remove('hidden');
};

function renderEnvConnectionsTable() {
  const tbody = document.getElementById('em-connections-tbody');
  const countBadge = document.getElementById('em-conn-count-badge');
  countBadge.textContent = `${currentEnvConnections.length} Koneksi`;

  if (currentEnvConnections.length === 0) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center py-4 text-muted">Belum ada koneksi. Klik "+ Tambah Koneksi ke Tabel" di atas untuk menambahkan.</td></tr>';
    return;
  }

  tbody.innerHTML = currentEnvConnections.map((conn, idx) => {
    const roleBadge = conn.db_role === 'SOURCE' ? 'badge-cyan' : (conn.db_role === 'STAGING' ? 'badge-warning' : 'badge-success');
    return `
      <tr>
        <td class="font-mono text-muted">${idx + 1}</td>
        <td><strong>${escapeHtml(conn.connection_name)}</strong></td>
        <td><span class="badge ${roleBadge}">${escapeHtml(conn.db_role)}</span></td>
        <td><strong class="text-white">${escapeHtml(conn.db_type)}</strong></td>
        <td class="font-mono text-xs">${escapeHtml(conn.host)}:${conn.port}</td>
        <td class="font-mono text-cyan">${escapeHtml(conn.database_name)} (${escapeHtml(conn.db_schema || 'dbo')})</td>
        <td><span class="badge ${conn.use_ssh_tunnel ? 'badge-info' : 'badge-neutral'}">${conn.use_ssh_tunnel ? 'SSH' : 'Direct'}</span></td>
        <td><span class="badge ${conn.is_active !== false ? 'badge-success' : 'badge-danger'}">${conn.is_active !== false ? 'Aktif' : 'Nonaktif'}</span></td>
        <td>
          <div class="flex-gap-2">
            <button type="button" class="btn btn-secondary btn-xs" onclick="editEnvConnItem(${idx})">✏️</button>
            <button type="button" class="btn btn-danger btn-xs" onclick="deleteEnvConnItem(${idx})">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function showEnvConnForm(item = null, index = -1) {
  const card = document.getElementById('em-conn-form-card');
  const title = document.getElementById('em-conn-form-title');
  const tempId = document.getElementById('em-conn-temp-id');
  const testBox = document.getElementById('em-conn-test-box');
  testBox.classList.add('hidden');
  testBox.innerHTML = '';

  tempId.value = index;

  if (item) {
    title.textContent = '✏️ Edit Koneksi Database';
    document.getElementById('em-conn-name').value = item.connection_name || '';
    document.getElementById('em-conn-dbtype').value = item.db_type || 'MSSQL';
    document.getElementById('em-conn-dbrole').value = item.db_role || 'SOURCE';
    document.getElementById('em-conn-host').value = item.host || '';
    document.getElementById('em-conn-port').value = item.port || (item.db_type === 'MSSQL' ? 1433 : 5432);
    document.getElementById('em-conn-dbname').value = item.database_name || '';
    document.getElementById('em-conn-schema').value = item.db_schema || (item.db_type === 'MSSQL' ? 'dbo' : 'public');
    document.getElementById('em-conn-user').value = item.username || '';
    document.getElementById('em-conn-pass').value = '';
    document.getElementById('em-conn-pass').placeholder = item.connection_id ? 'Biarkan kosong jika tidak berubah' : '••••••••';
    document.getElementById('em-conn-ssh-tunnel').checked = Boolean(item.use_ssh_tunnel);
    document.getElementById('em-conn-ssh-host').value = item.ssh_host || '';
    document.getElementById('em-conn-ssh-port').value = item.ssh_port || 22;
    document.getElementById('em-conn-ssh-user').value = item.ssh_user || '';
    document.getElementById('em-conn-ssh-fields').classList.toggle('hidden', !item.use_ssh_tunnel);
  } else {
    title.textContent = '➕ Tambah Koneksi Database';
    document.getElementById('em-conn-name').value = '';
    document.getElementById('em-conn-dbtype').value = 'MSSQL';
    document.getElementById('em-conn-dbrole').value = 'SOURCE';
    document.getElementById('em-conn-host').value = '';
    document.getElementById('em-conn-port').value = 1433;
    document.getElementById('em-conn-dbname').value = '';
    document.getElementById('em-conn-schema').value = 'dbo';
    document.getElementById('em-conn-user').value = 'sa';
    document.getElementById('em-conn-pass').value = '';
    document.getElementById('em-conn-pass').placeholder = '••••••••';
    document.getElementById('em-conn-ssh-tunnel').checked = false;
    document.getElementById('em-conn-ssh-host').value = '';
    document.getElementById('em-conn-ssh-port').value = 22;
    document.getElementById('em-conn-ssh-user').value = '';
    document.getElementById('em-conn-ssh-fields').classList.add('hidden');
  }

  card.classList.remove('hidden');
}

function hideEnvConnForm() {
  const card = document.getElementById('em-conn-form-card');
  if (card) card.classList.add('hidden');
}

window.editEnvConnItem = function (index) {
  showEnvConnForm(currentEnvConnections[index], index);
};

window.deleteEnvConnItem = function (index) {
  if (confirm('Hapus koneksi ini dari daftar environment?')) {
    currentEnvConnections.splice(index, 1);
    renderEnvConnectionsTable();
  }
};

async function testEnvConnPing() {
  const testBox = document.getElementById('em-conn-test-box');
  testBox.classList.remove('hidden');
  testBox.className = 'p-2 rounded text-xs mb-3 bg-surface text-muted';
  testBox.textContent = 'Menguji koneksi database...';

  const payload = {
    db_type: document.getElementById('em-conn-dbtype').value,
    host: document.getElementById('em-conn-host').value.trim(),
    port: document.getElementById('em-conn-port').value.trim(),
    database_name: document.getElementById('em-conn-dbname').value.trim(),
    username: document.getElementById('em-conn-user').value.trim(),
    password: document.getElementById('em-conn-pass').value,
  };

  try {
    const res = await fetch('/api/context/connections/test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (json.data && json.data.success) {
      testBox.className = 'p-2 rounded text-xs mb-3 alert-box-success';
      testBox.innerHTML = `<strong>✓ Berhasil!</strong> (${json.data.latencyMs}ms) - ${escapeHtml(json.data.version || '')}`;
    } else {
      testBox.className = 'p-2 rounded text-xs mb-3 alert-box-warning';
      testBox.innerHTML = `<strong>⚠️ Gagal:</strong> ${escapeHtml(json.data?.error || json.error)}`;
    }
  } catch (err) {
    testBox.className = 'p-2 rounded text-xs mb-3 alert-box-warning';
    testBox.innerHTML = `<strong>⚠️ Error:</strong> ${err.message}`;
  }
}

function saveEnvConnItem() {
  const idx = parseInt(document.getElementById('em-conn-temp-id').value, 10);
  const connName = document.getElementById('em-conn-name').value.trim();
  const host = document.getElementById('em-conn-host').value.trim();
  const dbName = document.getElementById('em-conn-dbname').value.trim();

  if (!connName || !host || !dbName) {
    alert('Nama Koneksi, Host, dan Nama Database wajib diisi.');
    return;
  }

  const existing = idx >= 0 ? currentEnvConnections[idx] : {};
  const passVal = document.getElementById('em-conn-pass').value;

  const item = {
    ...existing,
    connection_name: connName,
    db_type: document.getElementById('em-conn-dbtype').value,
    db_role: document.getElementById('em-conn-dbrole').value,
    host: host,
    port: parseInt(document.getElementById('em-conn-port').value, 10) || 5432,
    database_name: dbName,
    db_schema: document.getElementById('em-conn-schema').value.trim() || 'dbo',
    username: document.getElementById('em-conn-user').value.trim(),
    password: passVal ? passVal : (existing.connection_id ? '__UNCHANGED__' : ''),
    use_ssh_tunnel: document.getElementById('em-conn-ssh-tunnel').checked,
    ssh_host: document.getElementById('em-conn-ssh-host').value.trim() || null,
    ssh_port: parseInt(document.getElementById('em-conn-ssh-port').value, 10) || 22,
    ssh_user: document.getElementById('em-conn-ssh-user').value.trim() || null,
    is_active: true,
  };

  if (idx >= 0) {
    currentEnvConnections[idx] = item;
  } else {
    currentEnvConnections.push(item);
  }

  hideEnvConnForm();
  renderEnvConnectionsTable();
}

async function saveEnvironmentAndConnections() {
  const clientId = document.getElementById('em-client-id').value;
  const envId = document.getElementById('em-env-id').value;
  const envCode = document.getElementById('em-env-code').value.trim();
  const envName = document.getElementById('em-env-name').value.trim();
  const desc = document.getElementById('em-env-desc').value.trim();
  const isActive = document.getElementById('em-env-is-active').checked;

  if (!envCode || !envName) {
    alert('Kode Environment dan Nama Environment wajib diisi.');
    return;
  }

  const btn = document.getElementById('btn-save-env-manager');
  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    const payload = {
      client_id: clientId,
      env_id: envId ? parseInt(envId, 10) : null,
      env_code: envCode,
      env_name: envName,
      description: desc,
      is_active: isActive,
      connections: currentEnvConnections,
    };

    const res = await fetch('/api/context/environments/save-with-connections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    alert('✓ Environment dan daftar koneksi berhasil disimpan!');
    document.getElementById('modal-env-manager').classList.add('hidden');

    // Reload settings & connections
    await loadSettingsClientsAndEnvironments();
    await loadSettingsConnections();
    await loadContextClientsAndEnvironments();
    await loadSourceConnectionsSelect();
  } catch (err) {
    alert('Gagal menyimpan environment: ' + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = '💾 Simpan Environment & Koneksi ✓';
  }
}

// Inisialisasi event listener tambahan
document.addEventListener('DOMContentLoaded', () => {
  // Event listeners modal environment manager
  document.getElementById('btn-close-env-manager')?.addEventListener('click', () => {
    document.getElementById('modal-env-manager').classList.add('hidden');
  });
  document.getElementById('btn-cancel-env-manager')?.addEventListener('click', () => {
    document.getElementById('modal-env-manager').classList.add('hidden');
  });
  document.getElementById('btn-em-add-conn')?.addEventListener('click', () => showEnvConnForm());
  document.getElementById('btn-em-cancel-conn-form')?.addEventListener('click', hideEnvConnForm);
  document.getElementById('btn-em-cancel-conn-item')?.addEventListener('click', hideEnvConnForm);
  document.getElementById('btn-em-test-conn')?.addEventListener('click', testEnvConnPing);
  document.getElementById('btn-em-save-conn-item')?.addEventListener('click', saveEnvConnItem);
  document.getElementById('btn-save-env-manager')?.addEventListener('click', saveEnvironmentAndConnections);

  document.getElementById('em-conn-ssh-tunnel')?.addEventListener('change', (e) => {
    document.getElementById('em-conn-ssh-fields')?.classList.toggle('hidden', !e.target.checked);
  });

  document.getElementById('em-conn-dbtype')?.addEventListener('change', (e) => {
    const portEl = document.getElementById('em-conn-port');
    const schemaEl = document.getElementById('em-conn-schema');
    if (e.target.value === 'MSSQL') {
      portEl.value = 1433;
      schemaEl.value = 'dbo';
    } else if (e.target.value === 'POSTGRESQL') {
      portEl.value = 5432;
      schemaEl.value = 'public';
    } else if (e.target.value === 'MYSQL') {
      portEl.value = 3306;
      schemaEl.value = '';
    }
  });
});

window.openEnvManagerModal = openEnvManagerModal;
window.openSettingsModal = openSettingsModal;
window.switchSettingTab = switchSettingTab;
window.loadSettingsClients = loadSettingsClients;
window.loadSettingsEnvironments = loadSettingsEnvironments;
window.loadSettingsConnections = loadSettingsConnections;
window.openCreateEnvForClient = openCreateEnvForClient;
window.filterConnectionByEnv = filterConnectionByEnv;

// ==========================================
// ⚡ SYNC TO APACHE HOP ACTION
// ==========================================
window.syncHopConfig = async function (envId, envCode, clientCode) {
  const btn = window.event?.target;
  const oldText = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '⚡ Syncing...';
  }

  try {
    const res = await fetch(`/api/settings/environments/${envId}/sync-hop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    alert(`✓ ${json.message || `File config Hop berhasil di-generate untuk environment ${envCode} (${clientCode || 'ANTAM'})`}\n\nPath File Hop: ${json.data?.filePath || ''}`);
  } catch (err) {
    alert(`Gagal sinkronisasi ke Apache Hop: ${err.message}`);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = oldText || '⚡ Sync to Hop';
    }
  }
};
