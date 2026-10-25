// =========================================================================
// 🔒 TRANSPARENT AUTHENTICATION FETCH INTERCEPTOR
// Otomatis menyertakan Bearer Token pada seluruh permintaan API internal
// =========================================================================
(function() {
  const nativeFetch = window.fetch;
  window.fetch = async function(resource, init = {}) {
    let url = typeof resource === 'string' ? resource : (resource?.url || '');
    if (url.startsWith('/api') || url.includes('/api/')) {
      const token = (window.state && window.state.userToken) || localStorage.getItem('antam_token');
      if (token && !url.includes('/api/auth/login')) {
        init = init || {};
        const headers = new Headers(init.headers || {});
        if (!headers.has('Authorization')) {
          headers.set('Authorization', `Bearer ${token}`);
        }
        init.headers = headers;
      }
    }
    const res = await nativeFetch.call(this, resource, init);
    if (res.status === 401 && !url.includes('/api/auth/login') && !url.includes('/api/health')) {
      if (typeof handleLogout === 'function') {
        handleLogout();
      }
    }
    return res;
  };
})();

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
    page: 1,
    limit: 10,
    search: '',
    configFilter: 'ALL',
    sortBy: 'name',
    sortDir: 'ASC',

    // Modal Inspector state
    selectedView: null,
    modalTab: 'sitab-preview',
    modalPage: 1,
    modalLimit: 25,
    modalTotalPages: 1,
    modalTotal: 0,
    modalColumns: [],
    modalRows: [],
    modalDdl: '',
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
    sortBy: null,
    sortDir: 'ASC',
    masterPage: 1,
    masterLimit: 10,
    masterSortBy: 'configId',
    masterSortDir: 'ASC',
  },

  // Modul 4: 3-Tier Column & Status Comparator
  compare: {
    selectedConfigId: null,
    selectedTargetTable: null,
    selectedRunId: null,
    data: null,
    activeTab: 'matrix',
    filterStatus: 'ALL',
    searchQuery: '',
  },

  // Berita Acara
  beritaAcaraData: null,
  beritaAcaraSelectedConfigs: [1],
  beritaAcaraConfigsCache: {},
  beritaAcaraLogoLeft: { mode: 'antam', url: '', height: 40 },
  beritaAcaraLogoRight: { mode: 'sisi', url: '', height: 42 },

  // Universal Delete Target
  deleteTarget: null,

  // Authentication & RBAC
  currentUser: null,
  userToken: localStorage.getItem('antam_token') || null,
  userMenus: [],
  activeSysSubtab: 'sys-tab-users',
  system: {
    users: [],
    roles: [],
    selectedMatrixRoleId: null,
    menuMatrix: [],
    usersPage: 1,
    usersLimit: 10,
    usersSortBy: 'user_id',
    usersSortDir: 'ASC',
    rolesPage: 1,
    rolesLimit: 10,
    rolesSortBy: 'role_id',
    rolesSortDir: 'ASC',
  },
};

// =========================================================================
// INISIALISASI
// =========================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setupEventListeners();
  setupAuthEventListeners();
  setupSystemAdminEventListeners();
  await initAuth();
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
      let initTab = 'tab-source';
      try {
        const savedTab = localStorage.getItem('antam_active_main_tab');
        if (savedTab && document.getElementById(savedTab)) {
          initTab = savedTab;
        }
      } catch (_) {}
      switchMainTab(initTab);
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

  // Canvas Studio Bottom Panel Subtabs Navigation
  document.querySelectorAll('.canvas-bottom-tab-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-canvas-tab');
      switchCanvasBottomTab(tabId);
    });
  });

  // Toggle Canvas Console Panel Height (Expand / Collapse)
  window.toggleCanvasBottomPanel = function(e) {
    if (e && e.stopPropagation) e.stopPropagation();
    const panel = document.getElementById('canvas-bottom-panel');
    if (panel) {
      panel.classList.toggle('expanded');
      const isExp = panel.classList.contains('expanded');
      const icon = document.getElementById('canvas-panel-toggle-icon');
      if (icon) icon.textContent = isExp ? '↘️' : '↕️';
      if (isExp) {
        panel.dataset.prevHeight = panel.style.height || '260px';
        panel.style.height = '480px';
      } else {
        panel.style.height = panel.dataset.prevHeight && panel.dataset.prevHeight !== '480px' ? panel.dataset.prevHeight : '260px';
      }
    }
  };

  const btnTogglePanel = document.getElementById('btn-toggle-canvas-panel-height');
  if (btnTogglePanel) {
    btnTogglePanel.onclick = window.toggleCanvasBottomPanel;
  }

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
      if (window.flowCanvasStudio) {
        window.flowCanvasStudio.onContextChanged?.();
      }
      loadCurrentTab();
    });
  }

  const selEnv = document.getElementById('header-select-env');
  if (selEnv) {
    selEnv.addEventListener('change', async (e) => {
      state.selectedEnvId = e.target.value ? parseInt(e.target.value, 10) : null;
      resetVolatileStateAndUI();
      await resolveEnvironmentConnections(state.selectedEnvId);
      if (window.flowCanvasStudio) {
        window.flowCanvasStudio.onContextChanged?.();
      }
      loadCurrentTab();
    });
  }

  // Refresh All (Live Health & Reload Current Tab - Optional Chaining)
  document.getElementById('btn-refresh-all')?.addEventListener('click', async () => {
    resetVolatileStateAndUI();
    await resolveEnvironmentConnections(state.selectedEnvId);
    if (window.flowCanvasStudio) {
      window.flowCanvasStudio.onContextChanged?.();
    }
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

  // Tab 1: Source View Controls & Full-Width Table
  const btnRefreshViews = document.getElementById('btn-refresh-views');
  if (btnRefreshViews) {
    btnRefreshViews.addEventListener('click', () => loadSourceViews(true));
  }
  const btnSyncAllViews = document.getElementById('btn-sync-all-views');
  if (btnSyncAllViews) {
    btnSyncAllViews.addEventListener('click', () => {
      openGeneralConfirmModal({
        title: '⚡ Konfirmasi Sinkronisasi View',
        message: 'Apakah Anda yakin ingin menyinkronkan seluruh query view dari database sumber (SQL Server) ke tabel konfigurasi?',
        submessage: 'Proses ini akan membaca ulang definisi DDL dari database sumber dan memperbarui katalog konfigurasi.',
        proceedLabel: '⚡ Sinkronkan Sekarang',
        proceedClass: 'btn-primary',
        onConfirm: () => syncAllViews(),
      });
    });
  }
  document.getElementById('btn-open-create-view')?.addEventListener('click', () => openViewEditor());
  document.getElementById('btn-close-view-editor')?.addEventListener('click', () => closeViewEditor());
  document.getElementById('btn-ve-cancel')?.addEventListener('click', () => closeViewEditor());
  document.getElementById('btn-ve-validate')?.addEventListener('click', () => validateViewQuery());
  document.getElementById('btn-ve-save')?.addEventListener('click', () => saveOrExecuteView());

  const btnVeFormat = document.getElementById('btn-ve-format');
  if (btnVeFormat) btnVeFormat.addEventListener('click', () => formatViewEditorQuery());

  const btnVeFormatFooter = document.getElementById('btn-ve-format-footer');
  if (btnVeFormatFooter) btnVeFormatFooter.addEventListener('click', () => formatViewEditorQuery());

  const btnVeCopy = document.getElementById('btn-ve-copy');
  if (btnVeCopy) btnVeCopy.addEventListener('click', () => copyViewEditorQuery());

  const veQuerySql = document.getElementById('ve-query-sql');
  if (veQuerySql) {
    veQuerySql.addEventListener('input', () => updateVeQueryStats());
    veQuerySql.addEventListener('keydown', (e) => {
      if (e.key === 'Tab') {
        e.preventDefault();
        const start = veQuerySql.selectionStart;
        const end = veQuerySql.selectionEnd;
        veQuerySql.value = veQuerySql.value.substring(0, start) + '  ' + veQuerySql.value.substring(end);
        veQuerySql.selectionStart = veQuerySql.selectionEnd = start + 2;
        updateVeQueryStats();
      } else if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'F' || e.key === 'f')) {
        e.preventDefault();
        formatViewEditorQuery();
      }
    });
  }

  const searchSourceViews = document.getElementById('search-source-views');
  if (searchSourceViews) {
    let searchDebounceTimer = null;
    searchSourceViews.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        state.source.search = e.target.value.trim().toLowerCase();
        state.source.page = 1;
        renderSourceViewsTable();
      }, 150);
    });
  }

  const filterSourceConfig = document.getElementById('filter-source-config-status');
  if (filterSourceConfig) {
    filterSourceConfig.addEventListener('change', (e) => {
      state.source.configFilter = e.target.value;
      state.source.page = 1;

      // Sinkronkan chip filter cepat aktif
      document.querySelectorAll('.btn-qf').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-qfilter') === e.target.value);
      });

      renderSourceViewsTable();
    });
  }

  // Listener untuk Quick Filter Badges (Semua, Terdaftar, Belum Dikonfigurasi, Error)
  document.querySelectorAll('.btn-qf').forEach((btn) => {
    btn.addEventListener('click', () => {
      const qfilter = btn.getAttribute('data-qfilter');
      state.source.configFilter = qfilter;
      state.source.page = 1;

      // Sinkronkan dropdown filter
      const sel = document.getElementById('filter-source-config-status');
      if (sel) sel.value = qfilter;

      // Update visual active
      document.querySelectorAll('.btn-qf').forEach((b) => b.classList.remove('active'));
      btn.classList.add('active');

      renderSourceViewsTable();
    });
  });

  const selectSourceLimit = document.getElementById('select-source-views-limit');
  if (selectSourceLimit) {
    selectSourceLimit.addEventListener('change', (e) => {
      state.source.limit = parseInt(e.target.value, 10);
      state.source.page = 1;
      renderSourceViewsTable();
    });
  }

  const btnSourcePrev = document.getElementById('btn-source-views-prev');
  if (btnSourcePrev) {
    btnSourcePrev.addEventListener('click', () => {
      if (state.source.page > 1) {
        state.source.page--;
        renderSourceViewsTable();
      }
    });
  }

  const btnSourceNext = document.getElementById('btn-source-views-next');
  if (btnSourceNext) {
    btnSourceNext.addEventListener('click', () => {
      state.source.page++;
      renderSourceViewsTable();
    });
  }

  // Sortable table headers on source views table
  document.querySelectorAll('#table-source-views-full th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const colKey = th.getAttribute('data-sort');
      if (state.source.sortBy === colKey) {
        state.source.sortDir = state.source.sortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        state.source.sortBy = colKey;
        state.source.sortDir = 'ASC';
      }
      renderSourceViewsTable();
    });
  });

  // Modal Inspector Event Listeners
  const modalSourceInspector = document.getElementById('modal-source-inspector');
  if (modalSourceInspector) {
    document.getElementById('btn-close-source-inspector')?.addEventListener('click', () => {
      modalSourceInspector.classList.add('hidden');
    });
    document.getElementById('btn-close-source-inspector-footer')?.addEventListener('click', () => {
      modalSourceInspector.classList.add('hidden');
    });
    modalSourceInspector.addEventListener('click', (e) => {
      if (e.target === modalSourceInspector) {
        modalSourceInspector.classList.add('hidden');
      }
    });
    document.getElementById('btn-si-reload')?.addEventListener('click', () => {
      loadModalSourceViewData();
      loadModalSourceViewDdl();
    });
    document.getElementById('btn-si-export-csv')?.addEventListener('click', () => {
      exportSourceViewToCsv();
    });
    document.getElementById('btn-si-export-json')?.addEventListener('click', () => {
      exportSourceViewToJson();
    });
    document.getElementById('select-si-limit')?.addEventListener('change', (e) => {
      state.source.modalLimit = parseInt(e.target.value, 10);
      state.source.modalPage = 1;
      loadModalSourceViewData();
    });
    document.getElementById('btn-si-prev')?.addEventListener('click', () => {
      if (state.source.modalPage > 1) {
        state.source.modalPage--;
        loadModalSourceViewData();
      }
    });
    document.getElementById('btn-si-next')?.addEventListener('click', () => {
      if (state.source.modalPage < state.source.modalTotalPages) {
        state.source.modalPage++;
        loadModalSourceViewData();
      }
    });
    document.querySelectorAll('#modal-source-inspector .sub-tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const tabId = btn.getAttribute('data-sitab');
        if (tabId) switchSourceInspectorTab(tabId);
      });
    });
    document.getElementById('btn-si-copy-ddl')?.addEventListener('click', () => {
      if (state.source.modalDdl) {
        navigator.clipboard.writeText(state.source.modalDdl).then(() => {
          showToast('Query SQL berhasil disalin ke clipboard!', 'success');
        });
      }
    });
  }

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
  setupQuickFlowActions();
  document.getElementById('btn-refresh-runs').addEventListener('click', () => {
    loadEtlOverview();
    loadEtlRuns();
  });

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
  document.getElementById('btn-refresh-pipeline')?.addEventListener('click', () => loadPipelineReconciliation(true));

  // Pipeline Master Table Sorting & Pagination
  document.querySelectorAll('#pipeline-master-table th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-pipe-col');
      if (!col) return;
      if (state.pipeline.masterSortBy === col) {
        state.pipeline.masterSortDir = state.pipeline.masterSortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        state.pipeline.masterSortBy = col;
        state.pipeline.masterSortDir = 'ASC';
      }
      state.pipeline.masterPage = 1;
      renderPipelineMasterRows(state.pipeline.pipelines);
    });
  });

  const limitPipeSelect = document.getElementById('limit-pipe-master-select');
  if (limitPipeSelect) {
    limitPipeSelect.addEventListener('change', (e) => {
      state.pipeline.masterLimit = parseInt(e.target.value, 10) || 10;
      state.pipeline.masterPage = 1;
      renderPipelineMasterRows(state.pipeline.pipelines);
    });
  }

  const btnPipePrev = document.getElementById('btn-pipe-master-prev');
  if (btnPipePrev) {
    btnPipePrev.addEventListener('click', () => {
      if (state.pipeline.masterPage > 1) {
        state.pipeline.masterPage--;
        renderPipelineMasterRows(state.pipeline.pipelines);
      }
    });
  }

  const btnPipeNext = document.getElementById('btn-pipe-master-next');
  if (btnPipeNext) {
    btnPipeNext.addEventListener('click', () => {
      state.pipeline.masterPage++;
      renderPipelineMasterRows(state.pipeline.pipelines);
    });
  }

  document.querySelectorAll('.stage-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      const stage = e.currentTarget.getAttribute('data-stage');
      if (!stage) return;
      document.querySelectorAll('.stage-btn').forEach((b) => b.classList.remove('active'));
      e.currentTarget.classList.add('active');
      state.pipeline.selectedStage = stage;
      state.pipeline.sortBy = null;
      state.pipeline.sortDir = 'ASC';
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

  // Modal Pipeline Inspector (Tinjauan Hasil Migrasi)
  const btnClosePipelineInspector = document.getElementById('btn-close-pipeline-inspector');
  if (btnClosePipelineInspector) {
    btnClosePipelineInspector.addEventListener('click', () => closePipelineInspectorModal());
  }
  const btnClosePipelineInspectorFooter = document.getElementById('btn-close-pipeline-inspector-footer');
  if (btnClosePipelineInspectorFooter) {
    btnClosePipelineInspectorFooter.addEventListener('click', () => closePipelineInspectorModal());
  }


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
        'modal-general-confirm',
        'modal-pipeline-compare',
        'modal-pipeline-inspector',
        'modal-source-inspector',
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
  initBeritaAcaraEvents();

  // Modal Compare 3-Tier Events
  initCompareModalEvents();
}

function setupQuickFlowActions() {
  document.getElementById('btn-quick-open-canvas')?.addEventListener('click', () => {
    switchMainTab('tab-canvas');
  });

  document.getElementById('btn-quick-flow-1')?.addEventListener('click', async () => {
    const configId = prompt('Masukkan Config ID untuk Flow 1 (Staging & Convert):', '1');
    if (!configId) return;
    showToast(`Memulai Flow 1 Staging untuk Config #${configId}...`, 'info');
    try {
      const res = await fetch('/api/flows/flow-1-staging', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId: parseInt(configId, 10) })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Flow 1 Staging & Conversion berhasil tuntas!', 'success');
        loadEtlRuns();
        loadEtlOverview();
      } else {
        showToast(`Gagal: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
    }
  });

  document.getElementById('btn-quick-flow-2')?.addEventListener('click', async () => {
    const runId = prompt('Masukkan Run ID yang akan di-post ke target:');
    if (!runId) return;
    const useBatch = confirm('Gunakan Mode Batch (1.000 baris per batch)? Klik OK untuk BATCH, Cancel untuk DIRECT') ? 'Y' : 'N';
    showToast(`Memulai Flow 2 Post untuk Run ID #${runId} (Mode: ${useBatch === 'Y' ? 'BATCH 1000' : 'DIRECT'})...`, 'info');
    try {
      const res = await fetch('/api/flows/flow-2-post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: parseInt(runId, 10), useBatch, batchSize: 1000 })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Flow 2 Multi-Target Post berhasil tuntas!', 'success');
        loadEtlRuns();
        loadEtlOverview();
      } else {
        showToast(`Gagal: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
    }
  });

  document.getElementById('btn-quick-flow-3')?.addEventListener('click', async () => {
    const runId = prompt('PERINGATAN: Masukkan Run ID yang akan di-ROLLBACK (data target akan dihapus):');
    if (!runId) return;
    if (!confirm(`Konfirmasi: Apakah Anda yakin ingin me-rollback target untuk Run ID #${runId}?`)) return;
    showToast(`Memproses Flow 3 Rollback untuk Run ID #${runId}...`, 'info');
    try {
      const res = await fetch('/api/flows/flow-3-rollback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: parseInt(runId, 10) })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Flow 3 Safe Rollback berhasil membersihkan data target!', 'success');
        loadEtlRuns();
        loadEtlOverview();
      } else {
        showToast(`Gagal: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
    }
  });

  document.getElementById('btn-quick-flow-4')?.addEventListener('click', async () => {
    const configId = prompt('PERINGATAN: Masukkan Config ID untuk PURGE data target (khusus flag migration=1):', '1');
    if (!configId) return;
    if (!confirm(`Konfirmasi: Apakah Anda yakin ingin melakukan PURGE pada data target migrasi Config #${configId}?`)) return;
    showToast(`Memproses Flow 4 Purge Target untuk Config #${configId}...`, 'info');
    try {
      const res = await fetch('/api/flows/flow-4-purge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ configId: parseInt(configId, 10) })
      });
      const data = await res.json();
      if (data.success) {
        showToast('✓ Flow 4 Target Purge selesai.', 'success');
        loadEtlRuns();
        loadEtlOverview();
      } else {
        showToast(`Gagal: ${data.error}`, 'error');
      }
    } catch (e) {
      showToast(`Error: ${e.message}`, 'error');
    }
  });
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
  try {
    localStorage.setItem('antam_active_main_tab', tabId);
  } catch (_) {}
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
  } else if (tabId === 'tab-canvas') {
    if (window.flowCanvasStudio) {
      window.flowCanvasStudio.init();
      window.flowCanvasStudio.onTabActivated?.();
    }
    loadEtlOverview();
    loadEtlRuns();
    if (state.activeCanvasBottomTab === 'canvas-tab-steplogs') {
      loadEtlStepLogs(state.process.selectedRunId);
    } else if (state.activeCanvasBottomTab === 'canvas-tab-errorlogs') {
      loadEtlErrorLogs(state.process.selectedRunId);
    }
  } else if (tabId === 'tab-pipeline') {
    loadPipelineReconciliation();
  } else if (tabId === 'tab-system') {
    loadSystemAdministration();
  } else if (tabId === 'tab-userguide') {
    loadUserguideView();
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

function switchCanvasBottomTab(tabId) {
  // Support legacy subtab ID fallbacks
  if (tabId === 'subtab-runs') tabId = 'canvas-tab-runs';
  if (tabId === 'subtab-steplogs') tabId = 'canvas-tab-steplogs';
  if (tabId === 'subtab-errorlogs') tabId = 'canvas-tab-errorlogs';
  if (tabId === 'subtab-terminal') tabId = 'canvas-tab-terminal';

  state.activeCanvasBottomTab = tabId;
  document.querySelectorAll('.canvas-bottom-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-canvas-tab') === tabId);
  });
  document.querySelectorAll('.canvas-bottom-pane').forEach((pane) => {
    pane.classList.toggle('active', pane.id === tabId);
  });

  if (tabId === 'canvas-tab-runs') {
    loadEtlOverview();
    loadEtlRuns();
  } else if (tabId === 'canvas-tab-steplogs') {
    loadEtlStepLogs(state.process.selectedRunId);
  } else if (tabId === 'canvas-tab-errorlogs') {
    loadEtlErrorLogs(state.process.selectedRunId);
  }
}

// Backwards-compatible alias for existing functions
function switchProcessSubtab(subtabId) {
  switchCanvasBottomTab(subtabId);
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

  // 5. Reset Visual Canvas Studio Ephemeral Info & State
  if (window.flowCanvasStudio) {
    window.flowCanvasStudio.resetCanvasInfoAndState?.();
  }
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
    const mssqlTitle = document.getElementById('mssql-title');
    const pgTitle = document.getElementById('pg-title');

    const m = data.sqlserver || data.mssql;
    if (m && m.connected) {
      mssqlBadge.className = 'db-badge connected';
      if (mssqlTitle) mssqlTitle.textContent = `${m.database || 'antam_scm'} (Source)`;
      mssqlMeta.textContent = `${m.latencyMs}ms`;
      mssqlMeta.title = `Host: ${m.host || 'SQL Server'} (Connected)`;
    } else {
      mssqlBadge.className = 'db-badge error';
      if (mssqlTitle) mssqlTitle.textContent = `${m?.database || 'antam_scm'} (Source)`;
      const errText = m?.error ? (m.error.length > 25 ? m.error.slice(0, 22) + '...' : m.error) : 'Disconnected';
      mssqlMeta.textContent = errText;
      mssqlMeta.title = m?.error || 'SQL Server Disconnected';
    }

    const p = data.postgres;
    if (p && p.connected) {
      pgBadge.className = 'db-badge connected';
      if (pgTitle) pgTitle.textContent = `${p.database || 'db_procsi'} (Target)`;
      pgMeta.textContent = `${p.latencyMs}ms`;
      pgMeta.title = `Host: ${p.host || 'PostgreSQL'} (Connected)`;
    } else {
      pgBadge.className = 'db-badge error';
      if (pgTitle) pgTitle.textContent = `${p?.database || 'db_procsi'} (Target)`;
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
    const clientRes = await authFetch('/api/context/clients');
    const clientJson = await clientRes.json();
    if (clientJson.success) {
      state.clients = clientJson.data;
      renderHeaderClientOptions();
    }

    const isSuperadmin = state.currentUser && state.currentUser.role_code === 'SUPERADMIN';
    const selClient = document.getElementById('header-select-client');
    const selEnv = document.getElementById('header-select-env');

    // Multi-tenant resolution berdasarkan akun pengguna
    if (state.currentUser && !isSuperadmin) {
      const allowedClientCount = state.clients.length;
      if (selClient) {
        selClient.disabled = (allowedClientCount <= 1);
        selClient.title = allowedClientCount <= 1
          ? 'Tenant Anda ditetapkan sebagai ' + (state.currentUser.client_name || state.currentUser.client_code || 'Client')
          : 'Pilih Client yang ditugaskan kepada Anda';
      }
    } else {
      if (selClient) selClient.disabled = false;
      if (selEnv) selEnv.disabled = false;
    }

    if (state.clients.length > 0) {
      if (!state.selectedClientId || !state.clients.some(c => c.client_id == state.selectedClientId)) {
        state.selectedClientId = state.clients[0].client_id;
      }
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
    const res = await authFetch(url);
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

    const isSuperadmin = state.currentUser && state.currentUser.role_code === 'SUPERADMIN';
    if (state.currentUser && !isSuperadmin) {
      const allowedEnvCount = state.environments.length;
      sel.disabled = (allowedEnvCount <= 1);
      sel.title = allowedEnvCount <= 1
        ? 'Environment Anda ditetapkan sebagai ' + (state.environments[0]?.env_name || state.environments[0]?.env_code || 'Env')
        : 'Pilih Environment kerja Anda';
    } else {
      if (sel) sel.disabled = false;
    }

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
  const mssqlTitle = document.getElementById('mssql-title');
  const pgBadge = document.getElementById('pg-status');
  const pgMeta = document.getElementById('pg-meta');
  const pgTitle = document.getElementById('pg-title');

  if (mssqlBadge && mssqlMeta) {
    if (source && source.connected) {
      mssqlBadge.className = 'db-badge connected';
      if (mssqlTitle) mssqlTitle.textContent = `${source.database || 'antam_scm'} (Source)`;
      mssqlMeta.textContent = `${source.latencyMs}ms`;
      mssqlMeta.title = `Host: ${source.host}:${source.port} (${source.version || 'Connected'})`;
    } else {
      mssqlBadge.className = 'db-badge error';
      if (mssqlTitle) mssqlTitle.textContent = `${source?.database || 'antam_scm'} (Source)`;
      const errStr = source ? (source.error ? (source.error.length > 25 ? source.error.slice(0, 22) + '...' : source.error) : 'Disconnected') : 'No Source Conn';
      mssqlMeta.textContent = errStr;
      mssqlMeta.title = source?.error || 'Tidak terhubung';
    }
  }

  if (pgBadge && pgMeta) {
    if (target && target.connected) {
      pgBadge.className = 'db-badge connected';
      if (pgTitle) pgTitle.textContent = `${target.database || 'db_procsi'} (Target)`;
      pgMeta.textContent = `${target.latencyMs}ms`;
      pgMeta.title = `Host: ${target.host}:${target.port} (${target.version || 'Connected'})`;
    } else {
      pgBadge.className = 'db-badge error';
      if (pgTitle) pgTitle.textContent = `${target?.database || 'db_procsi'} (Target)`;
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
        connection_name: 'PostgreSQL Target (vendor/dwh)',
        db_type: 'POSTGRESQL',
        db_role: 'TARGET',
        host: tgtHost,
        port: parseInt(document.getElementById('wz-tgt-port')?.value.trim(), 10) || 5433,
        database_name: document.getElementById('wz-tgt-db')?.value.trim() || 'db_procsi',
        db_schema: 'vendor',
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
  if (typeof isCurrentUserAdmin === 'function' && !isCurrentUserAdmin()) {
    alert('Akses Ditolak: Fitur Pengaturan Sistem hanya dapat diakses oleh user Administrator.');
    return;
  }
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
async function loadSourceViews(forceRefresh = false) {
  // Performance optimization: jika sudah ada data di memory dan bukan force refresh, render instan!
  if (!forceRefresh && state.source.views && state.source.views.length > 0) {
    renderSourceViewsTable();
    return;
  }

  const tbody = document.getElementById('source-views-table-body');
  if (tbody) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-muted">Memuat daftar view SQL Server...</td></tr>`;
  }

  if (!state.selectedSourceConnectionId) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-amber font-medium">⚠️ Belum ada koneksi SOURCE (SQL Server) yang terdaftar untuk Environment ini.<br><span class="text-xs text-muted">Silakan buka menu <strong>Setting ⚙️ ➔ 3. Master Connection</strong> untuk menambahkan koneksi database sumber.</span></td></tr>`;
    }
    const resetValues = [
      ['kpi-source-views-count', '0'],
      ['kpi-source-total-rows', '0'],
      ['kpi-source-mapping-count', '-'],
      ['kpi-source-health-status', '-'],
    ];
    resetValues.forEach(([id, val]) => {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    });
    state.source.views = [];
    state.source.selectedView = null;
    return;
  }

  try {
    let connParam = `?connection_id=${state.selectedSourceConnectionId}`;
    if (state.selectedClientId) connParam += `&client_id=${state.selectedClientId}`;
    if (state.selectedEnvId) connParam += `&env_id=${state.selectedEnvId}`;
    if (forceRefresh) connParam += `&refresh=true`;

    const res = await fetch(`/api/source/views${connParam}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    const views = data.views || [];

    // Card 1: Total Views
    const elViewsCount = document.getElementById('kpi-source-views-count');
    if (elViewsCount) elViewsCount.textContent = views.length;
    const elViewsFoot = document.getElementById('kpi-source-views-foot');
    if (elViewsFoot) elViewsFoot.textContent = `Schema [${data.schema || 'dbo'}] di ${data.database || 'antam_scm'}`;

    // Card 2: Total Rows
    const elTotalRows = document.getElementById('kpi-source-total-rows');
    if (elTotalRows) elTotalRows.textContent = formatNumber(data.totalRowsAllViews || 0);

    // Card 3: Mapping Coverage ke migration_config
    const configuredCount = views.filter((v) => v.isMigrationConfigured).length;
    const unconfiguredCount = views.length - configuredCount;
    const mappingPct = views.length > 0 ? Math.round((configuredCount / views.length) * 100) : 0;
    const elMappingCount = document.getElementById('kpi-source-mapping-count');
    if (elMappingCount) {
      elMappingCount.innerHTML = `<span style="color: #0f172a; font-weight: 800;">${configuredCount} / ${views.length}</span> <span style="font-size: 0.75rem; font-weight: 500; color: #64748b; margin-left: 0.25rem;">(${mappingPct}%)</span>`;
    }
    const elMappingBar = document.getElementById('kpi-source-mapping-bar');
    if (elMappingBar) {
      elMappingBar.style.width = `${mappingPct}%`;
    }

    // Card 4: Object Health / Validity
    const errorViews = views.filter((v) => v.error);
    const elHealthStatus = document.getElementById('kpi-source-health-status');
    const elHealthFoot = document.getElementById('kpi-source-health-foot');
    const elHealthDot = document.getElementById('kpi-source-health-dot');
    if (elHealthStatus) {
      if (errorViews.length === 0) {
        elHealthStatus.innerHTML = `<span style="color: #059669; font-weight: 800;">100% Valid</span>`;
        if (elHealthFoot) elHealthFoot.textContent = '0 error binding query di database sumber';
        if (elHealthDot) elHealthDot.className = 'kpi-h-dot bg-emerald';
      } else {
        elHealthStatus.innerHTML = `<span style="color: #e11d48; font-weight: 800;">${errorViews.length} Bermasalah ⚠️</span>`;
        if (elHealthFoot) elHealthFoot.textContent = `${errorViews[0].name}: ${errorViews[0].error.slice(0, 32)}...`;
        if (elHealthDot) elHealthDot.className = 'kpi-h-dot bg-rose';
      }
    }

    state.source.views = views;
    renderSourceViewsTable();
  } catch (err) {
    if (tbody) {
      tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-rose">${err.message}</td></tr>`;
    }
  }
}

function renderSourceViewsTable() {
  const tbody = document.getElementById('source-views-table-body');
  if (!tbody) return;

  if (!state.source.views || state.source.views.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-muted">Tidak ada VIEW di schema dbo SQL Server.</td></tr>`;
    const pagInfo = document.getElementById('source-views-pagination-info');
    if (pagInfo) pagInfo.textContent = '0 views';
    const pagNumbers = document.getElementById('source-views-page-numbers');
    if (pagNumbers) pagNumbers.innerHTML = '';
    const btnPrev = document.getElementById('btn-source-views-prev');
    if (btnPrev) btnPrev.disabled = true;
    const btnNext = document.getElementById('btn-source-views-next');
    if (btnNext) btnNext.disabled = true;
    return;
  }

  // 1. Update Quick Filter Badge Counts
  const allViews = state.source.views || [];
  const countAll = allViews.length;
  const countConfigured = allViews.filter((v) => v.isMigrationConfigured).length;
  const countUnconfigured = allViews.filter((v) => !v.isMigrationConfigured).length;
  const countError = allViews.filter((v) => Boolean(v.error)).length;

  const qfAll = document.getElementById('qf-count-all');
  if (qfAll) qfAll.textContent = countAll;
  const qfCfg = document.getElementById('qf-count-configured');
  if (qfCfg) qfCfg.textContent = countConfigured;
  const qfUncfg = document.getElementById('qf-count-unconfigured');
  if (qfUncfg) qfUncfg.textContent = countUnconfigured;
  const qfErr = document.getElementById('qf-count-error');
  const btnQfErr = document.getElementById('qf-error');
  if (qfErr) qfErr.textContent = countError;
  if (btnQfErr) {
    btnQfErr.style.display = countError > 0 ? 'inline-flex' : 'none';
  }

  // Sync visual active class on quick filter buttons
  const curFilter = state.source.configFilter || 'ALL';
  document.querySelectorAll('.btn-qf').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-qfilter') === curFilter);
  });

  // 2. Filter
  let items = [...state.source.views];
  if (state.source.search) {
    const q = state.source.search.toLowerCase();
    items = items.filter((v) => 
      v.name.toLowerCase().includes(q) || 
      (v.schema && v.schema.toLowerCase().includes(q)) ||
      (v.description && v.description.toLowerCase().includes(q))
    );
  }

  if (state.source.configFilter === 'MIGRATION_CONFIGURED') {
    items = items.filter((v) => v.isMigrationConfigured);
  } else if (state.source.configFilter === 'MIGRATION_UNCONFIGURED') {
    items = items.filter((v) => !v.isMigrationConfigured);
  } else if (state.source.configFilter === 'ERROR') {
    items = items.filter((v) => Boolean(v.error));
  }

  // 2. Sort
  const sortBy = state.source.sortBy || 'name';
  const sortDir = state.source.sortDir || 'ASC';
  items.sort((a, b) => {
    let valA = a[sortBy];
    let valB = b[sortBy];
    if (sortBy === 'count') {
      valA = parseInt(valA, 10) || 0;
      valB = parseInt(valB, 10) || 0;
      return sortDir === 'ASC' ? valA - valB : valB - valA;
    }
    if (sortBy === 'isMigrationConfigured') {
      valA = a.isMigrationConfigured ? 1 : 0;
      valB = b.isMigrationConfigured ? 1 : 0;
      return sortDir === 'ASC' ? valA - valB : valB - valA;
    }
    valA = (valA || '').toString().toLowerCase();
    valB = (valB || '').toString().toLowerCase();
    return sortDir === 'ASC' ? valA.localeCompare(valB) : valB.localeCompare(valA);
  });

  // Update header sort icons
  document.querySelectorAll('#table-source-views-full th.sortable').forEach((th) => {
    const colKey = th.getAttribute('data-sort');
    const icon = th.querySelector('.sort-icon');
    if (colKey === sortBy) {
      th.classList.remove('sorted-asc', 'sorted-desc');
      th.classList.add(sortDir === 'ASC' ? 'sorted-asc' : 'sorted-desc');
      if (icon) icon.textContent = sortDir === 'ASC' ? '▲' : '▼';
    } else {
      th.classList.remove('sorted-asc', 'sorted-desc');
      if (icon) icon.textContent = '↕';
    }
  });

  const totalFiltered = items.length;
  const limit = state.source.limit || 10;
  const totalPages = Math.max(1, Math.ceil(totalFiltered / limit));
  state.source.page = Math.min(state.source.page || 1, totalPages);
  const page = state.source.page || 1;

  const startIdx = (page - 1) * limit;
  const endIdx = Math.min(startIdx + limit, totalFiltered);
  const pagedItems = items.slice(startIdx, endIdx);

  if (pagedItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-muted">Tidak ada view yang sesuai dengan filter pencarian.</td></tr>`;
  } else {
    tbody.innerHTML = pagedItems.map((v, idx) => {
      const globalIndex = startIdx + idx + 1;

      // Relasi Migration Config Badge
      let migConfigBadge = '';
      if (v.isMigrationConfigured && v.migrationConfigs && v.migrationConfigs.length > 0) {
        const badges = v.migrationConfigs.map((mc) => {
          const activeTag = !mc.isActive ? ' <span class="badge badge-warning" style="font-size: 0.65rem; padding: 1px 4px;">Off</span>' : '';
          return `
            <div class="mig-config-pill" title="Target: [${escapeHtml(mc.tgtSchema || 'vendor')}].[${escapeHtml(mc.tgtTable || '-')}], Staging: [${escapeHtml(mc.stgTable || '-')}]">
              <span class="badge badge-indigo font-mono text-xs font-semibold">✓ Config #${mc.configId}${activeTag}</span>
              <span class="text-muted text-xs font-mono">➔</span>
              <span class="font-mono font-semibold text-xs" style="color: var(--accent-primary);">${escapeHtml(mc.tgtSchema || 'vendor')}.${escapeHtml(mc.tgtTable || '-')}</span>
            </div>
          `;
        }).join('');
        migConfigBadge = `<div class="flex-column gap-1">${badges}</div>`;
      } else {
        migConfigBadge = `
          <div class="flex-center gap-1" style="justify-content: flex-start;">
            <span class="badge badge-neutral text-xs" style="color: var(--text-muted);">Belum Dikonfigurasi</span>
          </div>
        `;
      }

      return `
        <tr>
          <td class="font-mono text-muted text-center col-order">${globalIndex}</td>
          <td class="col-name">
            <div class="flex-center gap-2" style="justify-content: flex-start;">
              <span class="font-mono font-semibold" style="font-size: 0.925rem; color: #0f172a;">${escapeHtml(v.name)}</span>
            </div>
          </td>
          <td class="col-desc">
            ${v.description ? `<span class="text-sm" title="${escapeHtml(v.description)}">${escapeHtml(v.description)}</span>` : `<span class="text-muted text-xs italic">-</span>`}
          </td>
          <td class="col-schema text-center"><span class="badge badge-neutral">${escapeHtml(v.schema || 'dbo')}</span></td>
          <td class="col-num font-mono ${v.error ? 'text-rose' : ''}" style="text-align: right; font-weight: 600;">
            ${v.error ? `<span title="${escapeHtml(v.error)}">Error</span>` : formatNumber(v.count)}
          </td>
          <td class="col-mig-config">${migConfigBadge}</td>
          <td class="col-action">
            <div class="source-action-group">
              <button class="btn btn-primary btn-xs" onclick="openSourceInspectorModal('${v.name}')" title="Buka dialog data inspector, skema kolom, dan DDL">🔍 Detail</button>
              <button class="btn btn-secondary btn-xs" onclick="openViewEditor('${v.name}')" title="Edit query view di SQL Server">✏️ Edit</button>
              ${v.isMigrationConfigured
                ? `<button class="btn btn-secondary btn-xs text-muted" style="opacity: 0.55; cursor: not-allowed;" title="Diproteksi: View ini terdaftar di ${v.migrationConfigs.length} Migration Config (${escapeHtml(v.migrationConfigs.map(c => `Config #${c.configId}`).join(', '))})" onclick="showToast('View [${escapeHtml(v.name)}] diproteksi: Sedang digunakan oleh ${v.migrationConfigs.length} Migration Config!', 'warning')">🔒</button>`
                : `<button class="btn btn-danger btn-xs" onclick="openDeleteModal('source_view', '${v.name}', '${v.name}')" title="Hapus view dari DB">🗑️</button>`
              }
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // Update pagination bar
  const pagInfoEl = document.getElementById('source-views-pagination-info');
  if (pagInfoEl) {
    pagInfoEl.textContent = totalFiltered > 0
      ? `Menampilkan ${formatNumber(startIdx + 1)} - ${formatNumber(endIdx)} dari total ${formatNumber(totalFiltered)} views`
      : '0 views ditemukan';
  }

  const btnPrevEl = document.getElementById('btn-source-views-prev');
  if (btnPrevEl) btnPrevEl.disabled = page <= 1;
  const btnNextEl = document.getElementById('btn-source-views-next');
  if (btnNextEl) btnNextEl.disabled = page >= totalPages;

  renderPaginationNumbers('source-views-page-numbers', page, totalPages, (newPage) => {
    state.source.page = newPage;
    renderSourceViewsTable();
  });
}

// Dialog Modal Data Inspector
window.openSourceInspectorModal = function (viewName) {
  state.source.selectedView = viewName;
  state.source.modalPage = 1;
  state.source.modalTab = 'sitab-preview';

  const modal = document.getElementById('modal-source-inspector');
  if (!modal) return;
  modal.classList.remove('hidden');

  document.getElementById('si-modal-title').textContent = `🔍 Data Inspector: ${viewName}`;
  document.getElementById('si-modal-subtitle').textContent = `Database: antam_scm • Schema: dbo • Inspeksi data aktual, struktur kolom, dan DDL`;

  const viewObj = (state.source.views || []).find((v) => v.name === viewName);

  const footerLeft = document.getElementById('si-footer-left-actions');
  if (footerLeft) {
    if (viewObj && !viewObj.isConfigured) {
      footerLeft.innerHTML = `
        <button class="btn btn-emerald btn-sm" onclick="quickRegisterViewToConfig('${viewName}')">
          ⚡ Daftarkan View Ini ke Migration Config
        </button>
      `;
    } else {
      footerLeft.innerHTML = `
        <span class="badge badge-success text-xs">✓ View sudah terdaftar di Migration Config</span>
      `;
    }
  }

  switchSourceInspectorTab('sitab-preview');
  loadModalSourceViewData();
  loadModalSourceViewDdl();
};

window.inspectView = function (viewName) {
  openSourceInspectorModal(viewName);
};

function switchSourceInspectorTab(tabId) {
  state.source.modalTab = tabId;
  document.querySelectorAll('#modal-source-inspector .sub-tab-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-sitab') === tabId);
  });
  document.querySelectorAll('#modal-source-inspector .sitab-content').forEach((pane) => {
    pane.classList.toggle('active', pane.id === tabId);
    pane.classList.toggle('hidden', pane.id !== tabId);
  });
}

function getPostgresTypeSuggestion(sqlType, maxLen, prec, scale) {
  if (!sqlType) return 'TEXT';
  const t = sqlType.toLowerCase();
  if (t === 'nvarchar' || t === 'varchar') {
    return maxLen && maxLen > 0 && maxLen < 4000 ? `VARCHAR(${maxLen})` : 'TEXT';
  }
  if (t === 'nchar' || t === 'char') {
    return maxLen && maxLen > 0 ? `CHAR(${maxLen})` : 'CHAR(1)';
  }
  if (t === 'int') return 'INTEGER';
  if (t === 'bigint') return 'BIGINT';
  if (t === 'smallint' || t === 'tinyint') return 'SMALLINT';
  if (t === 'bit') return 'BOOLEAN';
  if (t === 'datetime' || t === 'datetime2' || t === 'smalldatetime') return 'TIMESTAMP';
  if (t === 'date') return 'DATE';
  if (t === 'time') return 'TIME';
  if (t === 'decimal' || t === 'numeric') {
    const p = prec || 18;
    const s = scale || 2;
    return `NUMERIC(${p}, ${s})`;
  }
  if (t === 'float' || t === 'real') return 'DOUBLE PRECISION';
  if (t === 'money' || t === 'smallmoney') return 'NUMERIC(19, 4)';
  if (t === 'uniqueidentifier') return 'UUID';
  return sqlType.toUpperCase();
}

async function loadModalSourceViewData() {
  const viewName = state.source.selectedView;
  if (!viewName) return;

  const thead = document.getElementById('si-data-thead');
  const tbody = document.getElementById('si-data-tbody');
  const schemaTbody = document.getElementById('si-schema-tbody');
  const alertEl = document.getElementById('si-alert-box');

  thead.innerHTML = `<tr><th class="text-center py-6 text-muted">Memuat data baris...</th></tr>`;
  tbody.innerHTML = '';
  schemaTbody.innerHTML = `<tr><td colspan="6" class="text-center py-6 text-muted">Memuat skema kolom...</td></tr>`;

  try {
    const connParam = state.selectedSourceConnectionId ? `&connection_id=${state.selectedSourceConnectionId}` : '';
    const page = state.source.modalPage || 1;
    const limit = state.source.modalLimit || 25;
    const url = `/api/source/view-data?view=${encodeURIComponent(viewName)}&page=${page}&limit=${limit}${connParam}`;
    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;

    state.source.modalTotal = data.total || 0;
    state.source.modalTotalPages = data.totalPages || 1;
    state.source.modalColumns = data.columns || [];
    state.source.modalRows = data.rows || [];

    if (data.error) {
      alertEl.className = 'alert-box-warning mb-3 p-3 rounded-md border text-sm';
      alertEl.innerHTML = `
        <div style="font-weight: 600; margin-bottom: 0.25rem;">⚠️ Catatan Database SQL Server: View Binding Error</div>
        <div>${escapeHtml(data.error)}</div>
      `;
    } else {
      alertEl.className = 'hidden';
      alertEl.innerHTML = '';
    }

    document.getElementById('si-total-rows').textContent = data.error ? '0 (Error)' : formatNumber(data.total);
    document.getElementById('si-total-cols').textContent = data.columns.length;
    document.getElementById('si-page-indicator').textContent = `${data.page} / ${data.totalPages}`;
    document.getElementById('si-tab-rows-count').textContent = formatNumber(data.total);
    document.getElementById('si-tab-cols-count').textContent = data.columns.length;

    const startIdx = (data.page - 1) * data.limit + 1;
    const endIdx = Math.min(data.page * data.limit, data.total);
    document.getElementById('si-pagination-info').textContent = data.total > 0
      ? `Menampilkan ${formatNumber(startIdx)} - ${formatNumber(endIdx)} dari total ${formatNumber(data.total)} baris`
      : '0 baris ditemukan.';

    document.getElementById('btn-si-prev').disabled = data.page <= 1;
    document.getElementById('btn-si-next').disabled = data.page >= data.totalPages;

    renderPaginationNumbers('si-page-numbers', data.page, data.totalPages, (newPage) => {
      state.source.modalPage = newPage;
      loadModalSourceViewData();
    });

    // Render Preview Table
    if (data.columns.length === 0) {
      thead.innerHTML = `<tr><th class="text-center py-6 text-muted">Tidak ada kolom terdeteksi.</th></tr>`;
      tbody.innerHTML = `<tr><td class="text-center py-8 text-muted">Kolom view tidak tersedia.</td></tr>`;
    } else {
      thead.innerHTML = `
        <tr>
          <th style="width: 50px;">#</th>
          ${data.columns.map((c) => `<th>${escapeHtml(c.name)} <span class="text-muted" style="font-size: 0.68rem; font-weight: normal;">(${escapeHtml(c.type)})</span></th>`).join('')}
        </tr>
      `;

      if (data.rows.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${data.columns.length + 1}" class="text-center py-8 text-muted">Tidak ada baris data pada halaman ini.</td></tr>`;
      } else {
        tbody.innerHTML = data.rows.map((r, rIdx) => {
          const rowNum = (data.page - 1) * data.limit + rIdx + 1;
          const cells = data.columns.map((c) => {
            const val = r[c.name];
            if (val === null || val === undefined) return `<td><span class="text-muted font-italic">NULL</span></td>`;
            if (typeof val === 'boolean') return `<td><span class="badge ${val ? 'badge-success' : 'badge-danger'}">${val}</span></td>`;
            return `<td>${escapeHtml(String(val))}</td>`;
          }).join('');
          return `<tr><td class="font-mono text-muted text-center">${rowNum}</td>${cells}</tr>`;
        }).join('');
      }
    }

    // Render Schema Table
    if (data.columns.length === 0) {
      schemaTbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-muted">Tidak ada kolom yang terdeteksi.</td></tr>`;
    } else {
      schemaTbody.innerHTML = data.columns.map((c, cIdx) => {
        const lenDisplay = c.maxLength && c.maxLength > 0
          ? (c.maxLength === -1 ? 'MAX' : c.maxLength)
          : (c.precision ? `(${c.precision}, ${c.scale || 0})` : '-');
        const nullBadge = c.nullable
          ? `<span class="badge badge-warning">NULLABLE</span>`
          : `<span class="badge badge-success">NOT NULL</span>`;
        const pgSuggestion = getPostgresTypeSuggestion(c.type, c.maxLength, c.precision, c.scale);

        return `
          <tr>
            <td class="font-mono text-muted text-center">${cIdx + 1}</td>
            <td><strong class="font-mono text-cyan">${escapeHtml(c.name)}</strong></td>
            <td><span class="badge badge-neutral font-mono">${escapeHtml((c.type || '').toUpperCase())}</span></td>
            <td class="font-mono">${lenDisplay}</td>
            <td>${nullBadge}</td>
            <td><span class="badge badge-primary font-mono">${escapeHtml(pgSuggestion)}</span></td>
          </tr>
        `;
      }).join('');
    }

    // Render Data Profiling
    renderSourceViewProfiling(data.columns || [], data.rows || []);
  } catch (err) {
    thead.innerHTML = `<tr><th class="text-center py-6 text-rose">Gagal memuat data</th></tr>`;
    tbody.innerHTML = `<tr><td class="text-center py-8 text-rose">${err.message}</td></tr>`;
    schemaTbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-rose">${err.message}</td></tr>`;
    const profTbody = document.getElementById('si-profiling-tbody');
    if (profTbody) profTbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

function renderSourceViewProfiling(columns, rows) {
  const tbody = document.getElementById('si-profiling-tbody');
  const countEl = document.getElementById('si-profiling-sample-count');
  if (!tbody) return;

  if (countEl) countEl.textContent = rows.length;

  if (!columns || columns.length === 0 || !rows || rows.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-muted">Data sample tidak tersedia untuk profiling.</td></tr>`;
    return;
  }

  const totalRows = rows.length;
  tbody.innerHTML = columns.map((col, idx) => {
    let nullCount = 0;
    let emptyCount = 0;
    const valueSet = new Set();
    const valueCounts = {};

    rows.forEach((r) => {
      const val = r[col.name];
      if (val === null || val === undefined) {
        nullCount++;
      } else {
        const strVal = String(val).trim();
        if (strVal === '') emptyCount++;
        valueSet.add(strVal);
        valueCounts[strVal] = (valueCounts[strVal] || 0) + 1;
      }
    });

    const nonNullCount = totalRows - nullCount;
    const completenessPct = Math.round((nonNullCount / totalRows) * 100);
    const nullPct = Math.round((nullCount / totalRows) * 100);
    const distinctCount = valueSet.size;

    // Top sample values (up to 3)
    const topValues = Object.keys(valueCounts).slice(0, 3).map((v) => `"${escapeHtml(v)}"`).join(', ');

    // Characteristics / Analysis badge
    let charBadge = '';
    if (distinctCount === totalRows && nullCount === 0) {
      charBadge = `<span class="badge badge-success" title="Semua unik & not null pada sample">🔑 Kandidat PK / Unique</span>`;
    } else if (nullCount === 0) {
      charBadge = `<span class="badge badge-primary">✓ 100% Terisi</span>`;
    } else if (nullCount === totalRows) {
      charBadge = `<span class="badge badge-danger">⚠️ 100% Null</span>`;
    } else {
      charBadge = `<span class="badge badge-neutral">${completenessPct}% Terisi</span>`;
    }

    return `
      <tr>
        <td class="font-mono text-muted text-center">${idx + 1}</td>
        <td><strong class="font-mono text-cyan">${escapeHtml(col.name)}</strong></td>
        <td>
          <div class="flex-center gap-1" style="justify-content: flex-start;">
            <div style="flex: 1; height: 6px; background: #e2e8f0; border-radius: 3px; overflow: hidden; max-width: 60px;">
              <div style="height: 100%; width: ${completenessPct}%; background: ${completenessPct === 100 ? '#10b981' : '#6366f1'};"></div>
            </div>
            <span class="font-mono text-xs">${completenessPct}% (${nonNullCount})</span>
          </div>
        </td>
        <td class="font-mono ${nullCount > 0 ? 'text-amber font-semibold' : 'text-muted'}">${nullCount} (${nullPct}%)</td>
        <td class="font-mono ${emptyCount > 0 ? 'text-amber' : 'text-muted'}">${emptyCount}</td>
        <td class="font-mono font-semibold">${distinctCount}</td>
        <td class="text-xs text-muted" style="max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${topValues}">
          ${topValues || '<span class="font-italic">Semua NULL</span>'}
        </td>
        <td>${charBadge}</td>
      </tr>
    `;
  }).join('');
}

async function loadModalSourceViewDdl() {
  const viewName = state.source.selectedView;
  if (!viewName) return;

  const ddlCodeEl = document.getElementById('si-ddl-code');
  if (!ddlCodeEl) return;
  ddlCodeEl.textContent = 'Memuat definisi DDL...';

  try {
    const connParam = state.selectedSourceConnectionId ? `&connection_id=${state.selectedSourceConnectionId}` : '';
    const res = await fetch(`/api/source/view-definition?view=${encodeURIComponent(viewName)}${connParam}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const ddl = json.data?.query_sql || json.data?.definition || `-- Tidak ada query SQL tersimpan untuk view ${viewName}`;
    state.source.modalDdl = ddl;
    ddlCodeEl.textContent = ddl;
  } catch (err) {
    ddlCodeEl.textContent = `-- Gagal memuat definisi DDL: ${err.message}`;
  }
}

function exportSourceViewToCsv() {
  const viewName = state.source.selectedView || 'source_view';
  const columns = state.source.modalColumns || [];
  const rows = state.source.modalRows || [];

  if (columns.length === 0 || rows.length === 0) {
    alert('Tidak ada baris data untuk diexport.');
    return;
  }

  const colNames = columns.map((c) => c.name);
  const csvRows = [];
  csvRows.push(colNames.map((name) => `"${String(name).replace(/"/g, '""')}"`).join(','));

  rows.forEach((r) => {
    const rowValues = colNames.map((col) => {
      const val = r[col];
      if (val === null || val === undefined) return '""';
      return `"${String(val).replace(/"/g, '""')}"`;
    });
    csvRows.push(rowValues.join(','));
  });

  const blob = new Blob([csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${viewName}_sample_rows.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportSourceViewToJson() {
  const viewName = state.source.selectedView || 'source_view';
  const rows = state.source.modalRows || [];

  if (rows.length === 0) {
    alert('Tidak ada baris data untuk diexport.');
    return;
  }

  const jsonString = JSON.stringify(rows, null, 2);
  const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${viewName}_sample_rows.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

window.quickRegisterViewToConfig = function (viewName) {
  document.getElementById('modal-source-inspector')?.classList.add('hidden');
  switchTab('tab-config');
  openCreateModal('migration_config');

  setTimeout(() => {
    const srcSchemaInput = document.getElementById('field-src_schema');
    const srcViewInput = document.getElementById('field-src_view');
    const stgTableInput = document.getElementById('field-stg_table');
    const tgtTableInput = document.getElementById('field-tgt_table');
    const tgtSchemaInput = document.getElementById('field-tgt_schema');

    if (srcSchemaInput) srcSchemaInput.value = 'dbo';
    if (srcViewInput) srcViewInput.value = viewName;

    const cleanName = viewName.replace(/^v_migration_/, '').replace(/^v_/, '');
    if (stgTableInput) stgTableInput.value = viewName.replace(/^v_/, '');
    if (tgtTableInput) tgtTableInput.value = cleanName;
    if (tgtSchemaInput) tgtSchemaInput.value = 'vendor';
  }, 100);
};

// =========================================================================
function extractSelectQueryFrontend(rawSql) {
  if (!rawSql || typeof rawSql !== 'string') return '';
  let sql = rawSql.trim();

  // 1. Bersihkan komentar awalan (-- baris atau /* blok */), opsi SET, dan GO dari skrip SQL Server
  sql = sql.replace(/^(?:\s*(?:--[^\r\n]*|\/\*[\s\S]*?\*\/|SET\s+[^;\r\n]+;?|GO\b)\s*)+/gi, '').trim();

  // 2. Regex mencocokkan pola CREATE (OR ALTER|REPLACE) VIEW <nama> AS <query> atau ALTER VIEW <nama> AS <query>
  const match = sql.match(/^(?:CREATE(?:\s+OR\s+(?:ALTER|REPLACE))?|ALTER)\s+VIEW\s+[\s\S]*?\bAS\b\s*([\s\S]*)$/i);
  if (match && match[1]) {
    sql = match[1].trim();
  }

  // 3. Bersihkan titik koma di akhir
  while (sql.endsWith(';')) {
    sql = sql.slice(0, -1).trim();
  }
  return sql;
}

/**
 * Intelligent SQL Formatter untuk merapikan klausa SELECT, indentasi,
 * kapitalisasi keyword SQL Server / PostgreSQL.
 */
function formatSqlQuery(sql) {
  if (!sql || typeof sql !== 'string') return '';

  let text = extractSelectQueryFrontend(sql).trim();
  if (!text) return '';

  // 1. Tokenize preserving strings, comments, brackets, identifiers
  const tokens = [];
  let i = 0;
  const len = text.length;

  while (i < len) {
    const char = text[i];
    const nextChar = text[i + 1] || '';

    // Whitespace
    if (/\s/.test(char)) {
      let ws = '';
      while (i < len && /\s/.test(text[i])) {
        ws += text[i];
        i++;
      }
      tokens.push({ type: 'whitespace', value: ws });
      continue;
    }

    // Line comment -- ...
    if (char === '-' && nextChar === '-') {
      let comment = '';
      while (i < len && text[i] !== '\n' && text[i] !== '\r') {
        comment += text[i];
        i++;
      }
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    // Block comment /* ... */
    if (char === '/' && nextChar === '*') {
      let comment = '/*';
      i += 2;
      while (i < len && !(text[i] === '*' && text[i + 1] === '/')) {
        comment += text[i];
        i++;
      }
      if (i < len) {
        comment += '*/';
        i += 2;
      }
      tokens.push({ type: 'comment', value: comment });
      continue;
    }

    // Quoted string '...' (handle escaped '')
    if (char === "'") {
      let str = "'";
      i++;
      while (i < len) {
        if (text[i] === "'") {
          str += "'";
          i++;
          if (text[i] === "'") {
            str += "'";
            i++;
          } else {
            break;
          }
        } else {
          str += text[i];
          i++;
        }
      }
      tokens.push({ type: 'string', value: str });
      continue;
    }

    // Bracketed identifier [col or table]
    if (char === '[') {
      let bracket = '[';
      i++;
      while (i < len && text[i] !== ']') {
        bracket += text[i];
        i++;
      }
      if (i < len && text[i] === ']') {
        bracket += ']';
        i++;
      }
      tokens.push({ type: 'identifier', value: bracket });
      continue;
    }

    // Quoted identifier "..."
    if (char === '"') {
      let qIdent = '"';
      i++;
      while (i < len && text[i] !== '"') {
        qIdent += text[i];
        i++;
      }
      if (i < len && text[i] === '"') {
        qIdent += '"';
        i++;
      }
      tokens.push({ type: 'identifier', value: qIdent });
      continue;
    }

    // Dot qualifier (e.g. schema.table or alias.column)
    if (char === '.') {
      tokens.push({ type: 'dot', value: '.' });
      i++;
      continue;
    }

    // Parentheses & delimiters
    if (char === '(' || char === ')' || char === ',' || char === ';') {
      tokens.push({ type: 'symbol', value: char });
      i++;
      continue;
    }

    // Operators: =, <>, !=, <=, >=, <, >, +, -, *, /, %
    if (/[=<>!+*/%&|^~]/.test(char)) {
      let op = char;
      i++;
      while (i < len && /[=<>!+*/%&|^~]/.test(text[i])) {
        op += text[i];
        i++;
      }
      tokens.push({ type: 'operator', value: op });
      continue;
    }

    // Word / Identifier / Number
    let word = '';
    while (i < len && !/[\s(),;=<>!+*/%&|^~'"`\[\.]/.test(text[i])) {
      word += text[i];
      i++;
    }
    if (word) {
      tokens.push({ type: 'word', value: word });
    }
  }

  // 2. Reserved Keywords
  const otherKeywords = [
    'AS', 'DISTINCT', 'ALL', 'IS', 'NULL', 'NOT', 'IN', 'EXISTS', 'BETWEEN', 'LIKE', 'ILIKE',
    'ASC', 'DESC', 'OVER', 'PARTITION', 'BY', 'ROW_NUMBER', 'COUNT', 'SUM',
    'AVG', 'MIN', 'MAX', 'COALESCE', 'NULLIF', 'ISNULL', 'CAST', 'CONVERT',
    'CONCAT', 'SUBSTRING', 'TRIM', 'RTRIM', 'LTRIM', 'UPPER', 'LOWER',
    'YEAR', 'MONTH', 'DAY', 'DATEADD', 'DATEDIFF', 'GETDATE', 'NOW',
    'CURRENT_TIMESTAMP', 'COLLATE', 'NOLOCK', 'PERCENT', 'WITH'
  ];

  const cleanTokens = tokens.filter((t) => t.type !== 'whitespace');

  // Normalize multi-word clauses & keywords
  const normalized = [];
  for (let k = 0; k < cleanTokens.length; k++) {
    const cur = cleanTokens[k];
    const next1 = cleanTokens[k + 1];
    const next2 = cleanTokens[k + 2];

    const curUpper = cur.type === 'word' ? cur.value.toUpperCase() : '';
    const next1Upper = next1 && next1.type === 'word' ? next1.value.toUpperCase() : '';
    const next2Upper = next2 && next2.type === 'word' ? next2.value.toUpperCase() : '';

    // 3 words: LEFT OUTER JOIN, RIGHT OUTER JOIN, FULL OUTER JOIN
    if (['LEFT', 'RIGHT', 'FULL'].includes(curUpper) && next1Upper === 'OUTER' && next2Upper === 'JOIN') {
      normalized.push({ type: 'clause_join', value: `${curUpper} OUTER JOIN` });
      k += 2;
      continue;
    }
    // 2 words
    if (curUpper === 'GROUP' && next1Upper === 'BY') {
      normalized.push({ type: 'clause_major', value: 'GROUP BY' });
      k += 1;
      continue;
    }
    if (curUpper === 'ORDER' && next1Upper === 'BY') {
      normalized.push({ type: 'clause_major', value: 'ORDER BY' });
      k += 1;
      continue;
    }
    if (curUpper === 'UNION' && next1Upper === 'ALL') {
      normalized.push({ type: 'clause_major', value: 'UNION ALL' });
      k += 1;
      continue;
    }
    if (['INNER', 'LEFT', 'RIGHT', 'FULL', 'CROSS'].includes(curUpper) && next1Upper === 'JOIN') {
      normalized.push({ type: 'clause_join', value: `${curUpper} JOIN` });
      k += 1;
      continue;
    }
    if (['CROSS', 'OUTER'].includes(curUpper) && next1Upper === 'APPLY') {
      normalized.push({ type: 'clause_join', value: `${curUpper} APPLY` });
      k += 1;
      continue;
    }
    if (curUpper === 'PARTITION' && next1Upper === 'BY') {
      normalized.push({ type: 'keyword', value: 'PARTITION BY' });
      k += 1;
      continue;
    }
    if (curUpper === 'IS' && next1Upper === 'NOT' && next2Upper === 'NULL') {
      normalized.push({ type: 'keyword', value: 'IS NOT NULL' });
      k += 2;
      continue;
    }
    if (curUpper === 'IS' && next1Upper === 'NULL') {
      normalized.push({ type: 'keyword', value: 'IS NULL' });
      k += 1;
      continue;
    }
    if (curUpper === 'NOT' && next1Upper === 'IN') {
      normalized.push({ type: 'keyword', value: 'NOT IN' });
      k += 1;
      continue;
    }
    if (curUpper === 'NOT' && next1Upper === 'LIKE') {
      normalized.push({ type: 'keyword', value: 'NOT LIKE' });
      k += 1;
      continue;
    }

    // Single words
    if (cur.type === 'word') {
      if (['SELECT', 'FROM', 'WHERE', 'HAVING', 'UNION', 'EXCEPT', 'INTERSECT', 'LIMIT', 'OFFSET', 'WITH'].includes(curUpper)) {
        normalized.push({ type: 'clause_major', value: curUpper });
      } else if (curUpper === 'JOIN') {
        normalized.push({ type: 'clause_join', value: 'JOIN' });
      } else if (['ON', 'AND', 'OR'].includes(curUpper)) {
        normalized.push({ type: 'clause_sub', value: curUpper });
      } else if (['CASE', 'WHEN', 'THEN', 'ELSE', 'END'].includes(curUpper)) {
        normalized.push({ type: 'clause_case', value: curUpper });
      } else if (curUpper === 'TOP') {
        normalized.push({ type: 'top', value: 'TOP' });
      } else if (otherKeywords.includes(curUpper)) {
        normalized.push({ type: 'keyword', value: curUpper });
      } else {
        normalized.push(cur);
      }
    } else {
      normalized.push(cur);
    }
  }

  // 3. Format lines and indentation
  let result = '';
  let indentLevel = 0;
  let parenDepth = 0;
  const parenStack = [];
  let inSelectList = false;

  const getIndent = (lvl) => '  '.repeat(Math.max(0, lvl));

  for (let idx = 0; idx < normalized.length; idx++) {
    const token = normalized[idx];
    const prev = normalized[idx - 1];
    const next = normalized[idx + 1];

    if (token.type === 'comment') {
      if (!result.endsWith('\n') && result.length > 0) result += '\n';
      result += getIndent(indentLevel) + token.value + '\n';
      continue;
    }

    if (token.type === 'clause_major') {
      inSelectList = (token.value === 'SELECT');
      if (result.length > 0 && !result.endsWith('\n')) {
        result += '\n';
      }
      result += getIndent(indentLevel) + token.value;

      if (token.value === 'SELECT') {
        if (next && (next.type === 'top' || (next.type === 'keyword' && next.value === 'DISTINCT'))) {
          result += ' ';
        } else {
          result += '\n' + getIndent(indentLevel + 1);
        }
      } else {
        result += ' ';
      }
      continue;
    }

    if (token.type === 'top') {
      result += 'TOP ';
      if (next) {
        result += next.value;
        idx++;
        const n2 = normalized[idx + 1];
        if (n2 && n2.type === 'keyword' && n2.value === 'PERCENT') {
          result += ' PERCENT';
          idx++;
        }
        if (inSelectList) {
          result += '\n' + getIndent(indentLevel + 1);
        } else {
          result += ' ';
        }
      }
      continue;
    }

    if (token.type === 'clause_join') {
      inSelectList = false;
      if (result.length > 0 && !result.endsWith('\n')) {
        result += '\n';
      }
      result += getIndent(indentLevel) + token.value + ' ';
      continue;
    }

    if (token.type === 'clause_sub') {
      if (token.value === 'ON') {
        if (!result.endsWith('\n')) result += '\n';
        result += getIndent(indentLevel + 1) + 'ON ';
      } else if (token.value === 'AND' || token.value === 'OR') {
        if (parenDepth === 0 || (parenStack.length > 0 && parenStack[parenStack.length - 1] === 'subquery')) {
          if (!result.endsWith('\n')) result += '\n';
          result += getIndent(indentLevel + 1) + token.value + ' ';
        } else {
          result += ' ' + token.value + ' ';
        }
      }
      continue;
    }

    if (token.type === 'clause_case') {
      if (token.value === 'CASE') {
        result += 'CASE';
      } else if (token.value === 'WHEN') {
        if (!result.endsWith('\n')) result += '\n';
        result += getIndent(indentLevel + 2) + 'WHEN ';
      } else if (token.value === 'THEN') {
        result += ' THEN ';
      } else if (token.value === 'ELSE') {
        if (!result.endsWith('\n')) result += '\n';
        result += getIndent(indentLevel + 2) + 'ELSE ';
      } else if (token.value === 'END') {
        if (!result.endsWith('\n')) result += '\n';
        result += getIndent(indentLevel + 1) + 'END';
      }
      continue;
    }

    if (token.type === 'dot') {
      result = result.replace(/ +$/, '') + '.';
      continue;
    }

    if (token.type === 'symbol') {
      if (token.value === ',') {
        result += ',';
        if (inSelectList && (parenDepth === 0 || (parenStack.length > 0 && parenStack[parenStack.length - 1] === 'subquery'))) {
          result += '\n' + getIndent(indentLevel + 1);
        } else {
          result += ' ';
        }
        continue;
      }

      if (token.value === '(') {
        parenDepth++;
        const isSubquery = next && next.type === 'clause_major' && next.value === 'SELECT';
        parenStack.push(isSubquery ? 'subquery' : 'expr');

        if (isSubquery) {
          result += ' (\n';
          indentLevel++;
        } else {
          if (prev && prev.type === 'keyword' && prev.value === 'AS') {
            result += ' (';
          } else {
            result += '(';
          }
        }
        continue;
      }

      if (token.value === ')') {
        const pType = parenStack.pop() || 'expr';
        parenDepth = Math.max(0, parenDepth - 1);

        if (pType === 'subquery') {
          indentLevel = Math.max(0, indentLevel - 1);
          if (!result.endsWith('\n')) result += '\n';
          result += getIndent(indentLevel) + ')';
        } else {
          result = result.replace(/ +$/, '') + ')';
        }
        continue;
      }

      if (token.value === ';') {
        result += ';\n';
        continue;
      }
    }

    if (token.type === 'operator') {
      if (token.value === '*' && prev && prev.type === 'symbol' && prev.value === '(') {
        result += '*';
      } else {
        result += ' ' + token.value + ' ';
      }
    } else {
      if (prev && prev.type === 'dot') {
        result += token.value;
      } else if (prev && prev.type === 'symbol' && prev.value === '(') {
        result += token.value;
      } else if (result.length > 0 && !result.endsWith(' ') && !result.endsWith('\n') && !result.endsWith('(') && !result.endsWith('.')) {
        result += ' ' + token.value;
      } else {
        result += token.value;
      }
    }
  }

  return result
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function updateVeQueryStats() {
  const el = document.getElementById('ve-query-sql');
  const statsEl = document.getElementById('ve-query-stats');
  if (!el || !statsEl) return;
  const val = el.value || '';
  const lines = val ? val.split('\n').length : 0;
  const chars = val.length;
  statsEl.textContent = `${lines} baris • ${chars} karakter`;
}

function formatViewEditorQuery() {
  const textarea = document.getElementById('ve-query-sql');
  if (!textarea) return;
  const raw = textarea.value;
  if (!raw || !raw.trim()) return;

  const formatted = formatSqlQuery(raw);
  if (formatted) {
    textarea.value = formatted;
    updateVeQueryStats();

    // Visual feedback pada tombol format
    const btnHeader = document.getElementById('btn-ve-format');
    const btnFooter = document.getElementById('btn-ve-format-footer');
    if (btnFooter) {
      const origText = btnFooter.innerHTML;
      btnFooter.innerHTML = '✓ Terformat!';
      btnFooter.classList.add('btn-success');
      setTimeout(() => {
        btnFooter.innerHTML = origText;
        btnFooter.classList.remove('btn-success');
      }, 1200);
    }
    showToast('✓ Format query SQL berhasil dirapikan.', 'success', 2000);
  }
}

async function copyViewEditorQuery() {
  const textarea = document.getElementById('ve-query-sql');
  if (!textarea || !textarea.value) return;
  try {
    await navigator.clipboard.writeText(textarea.value);
    const btnCopy = document.getElementById('btn-ve-copy');
    if (btnCopy) {
      const origText = btnCopy.innerHTML;
      btnCopy.innerHTML = '✓ Tersalin!';
      setTimeout(() => {
        btnCopy.innerHTML = origText;
      }, 1200);
    }
    showToast('✓ Query berhasil disalin ke clipboard.', 'info', 2000);
  } catch (e) {
    console.warn('Gagal salin query:', e);
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
    document.getElementById('ve-query-sql').value = '-- Memuat query view dari database...';
    updateVeQueryStats();

    try {
      const connParam = state.selectedSourceConnectionId ? `&connection_id=${state.selectedSourceConnectionId}` : '';
      const res = await fetch(`/api/source/view-definition?view=${encodeURIComponent(existingViewName)}${connParam}`);
      const json = await res.json();
      if (json.success && json.data) {
        // Ekstrak query SELECT murni (tanpa redundant CREATE VIEW ... AS) lalu rapikan susunan query
        const cleanQuery = json.data.querySql || extractSelectQueryFrontend(json.data.sqlServerDefinition || json.data.savedConfig?.query_sql || '');
        const targetSql = cleanQuery || json.data.sqlServerDefinition || '';
        document.getElementById('ve-query-sql').value = formatSqlQuery(targetSql);
        updateVeQueryStats();

        const viewObj = (state.source.views || []).find((v) => v.name === existingViewName);
        document.getElementById('ve-description').value = json.data.savedConfig?.description || json.data.description || viewObj?.description || '';

        if (json.data.schema) {
          document.getElementById('ve-schema-name').value = json.data.schema;
        }
      } else {
        document.getElementById('ve-query-sql').value = '';
        updateVeQueryStats();
      }
    } catch (e) {
      console.warn('Gagal load view definition:', e.message);
      document.getElementById('ve-query-sql').value = '';
      updateVeQueryStats();
    }
  } else {
    document.getElementById('view-editor-title').textContent = 'Buat Objek View Baru di SQL Server';
    document.getElementById('ve-view-name').value = '';
    document.getElementById('ve-view-name').readOnly = false;
    document.getElementById('ve-query-sql').value = formatSqlQuery('SELECT [vendor_id], [vendor_name], [status] FROM [dbo].[tb_vendor]');
    document.getElementById('ve-description').value = '';
    updateVeQueryStats();
  }
}

function closeViewEditor() {
  document.getElementById('modal-view-editor').classList.add('hidden');
}

async function validateViewQuery() {
  const rawQuery = document.getElementById('ve-query-sql').value.trim();
  const box = document.getElementById('ve-validation-box');
  box.classList.remove('hidden');
  box.className = 'p-3 rounded border text-xs mb-2 bg-surface text-muted';
  box.innerHTML = '⚡ Memvalidasi query ke database sumber...';

  if (!rawQuery) {
    box.className = 'p-3 rounded border text-xs mb-2 alert-box-warning';
    box.innerHTML = '<strong>⚠️ Perhatian:</strong> Query SQL tidak boleh kosong.';
    return false;
  }

  try {
    const res = await fetch('/api/source/validate-query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query_sql: rawQuery,
        connection_id: document.getElementById('ve-connection-id')?.value || state.selectedSourceConnectionId,
      }),
    });
    const json = await res.json();
    if (json.data && json.data.valid) {
      box.className = 'p-3 rounded border text-xs mb-2 alert-box-success';
      const colBadges = json.data.columns.slice(0, 15).map((c) => `<code>${escapeHtml(c)}</code>`).join(' ');
      const moreCols = json.data.columns.length > 15 ? ` <span class="text-muted">(+${json.data.columns.length - 15} lainnya)</span>` : '';
      box.innerHTML = `
        <div class="flex-between mb-1">
          <strong class="text-emerald">✓ Query Valid & Terverifikasi!</strong>
          <span class="text-muted font-mono">${json.data.durationMs}ms</span>
        </div>
        <div>Terdeteksi <strong>${json.data.columns.length} kolom</strong>: ${colBadges}${moreCols}</div>
      `;
      // Jika query otomatis diekstrak dari CREATE VIEW, perbarui textarea dengan query murni yang terformat
      if (json.data.cleanQuery && json.data.cleanQuery !== rawQuery && rawQuery.toLowerCase().includes('create')) {
        document.getElementById('ve-query-sql').value = formatSqlQuery(json.data.cleanQuery);
        updateVeQueryStats();
      }
      return true;
    } else {
      box.className = 'p-3 rounded border text-xs mb-2 alert-box-warning';
      box.innerHTML = `
        <div style="font-weight: 700; margin-bottom: 0.25rem;">⚠️ Query Gagal Validasi:</div>
        <div class="font-mono text-xs">${escapeHtml(json.data?.error || json.error || 'Syntax error')}</div>
      `;
      return false;
    }
  } catch (err) {
    box.className = 'p-3 rounded border text-xs mb-2 alert-box-warning';
    box.innerHTML = `<strong>⚠️ Error Jaringan / Server:</strong> ${err.message}`;
    return false;
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
  btn.textContent = 'Memvalidasi query...';

  try {
    // 1. Pastikan Uji Validitas Query Berhasil Terlebih Dahulu
    const isValid = await validateViewQuery();
    if (!isValid) {
      alert('⚠️ Query SQL tidak valid atau gagal saat diuji.\nSilakan periksa pesan kesalahan pada kotak feedback dan perbaiki query sebelum menyimpan.');
      return;
    }

    // Ambil query efektif (mungkin sudah diekstrak dari klausa CREATE VIEW)
    const effectiveQuery = document.getElementById('ve-query-sql').value.trim();

    btn.textContent = 'Menyimpan & membentuk view di DB...';
    const res = await fetch('/api/source/create-view', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        connection_id: document.getElementById('ve-connection-id')?.value || state.selectedSourceConnectionId,
        schema_name: document.getElementById('ve-schema-name')?.value.trim() || 'dbo',
        view_name: viewName,
        query_sql: effectiveQuery,
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
    const querySql = defJson.data?.querySql || extractSelectQueryFrontend(defJson.data?.sqlServerDefinition);

    if (!querySql) {
      alert(`Tidak dapat mengekstrak definisi query untuk [dbo].[${viewName}] dari database sumber.`);
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
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Menyinkronkan...';
  }

  try {
    const res = await fetch('/api/source/sync-all-views', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ connection_id: state.selectedSourceConnectionId }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    showToast(`✓ Berhasil menyinkronkan ${json.data.totalSynced} view ke tabel master konfigurasi!`, 'success');
    loadSourceViews(true);
  } catch (err) {
    showToast(`Gagal menyinkronkan seluruh view: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '⚡ Sinkronkan Semua';
    }
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
    colspan = 16;
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

  renderPaginationNumbers(`cfg-${tableKey}-page-numbers`, tState.page, totalPages, (newPage) => {
    tState.page = newPage;
    renderConfigTable(tableKey);
  });

  // 5. Render Rows
  if (pageItems.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${colspan}" class="text-center py-8 text-muted">Tidak ada data ${tState.search ? 'yang cocok dengan pencarian' : 'pada tabel ini'}.</td></tr>`;
    return;
  }

  if (tableKey === 'main') {
    tbody.innerHTML = pageItems.map((c) => {
      const clientObj = (state.clients || []).find((cl) => cl.client_id == c.client_id);
      const envObj = (state.environments || []).find((e) => e.env_id == c.env_id);
      const clientCode = clientObj ? clientObj.client_code : (c.client_id ? `#${c.client_id}` : '-');
      const envCode = envObj ? envObj.env_code : (c.env_id ? `#${c.env_id}` : '-');

      return `
      <tr>
        <td class="font-mono font-bold text-center"><span class="badge badge-neutral font-bold text-xs">#${c.config_id}</span></td>
        <td><strong class="text-white" style="font-size: 0.925rem;">${escapeHtml(c.name_config || `Config #${c.config_id}`)}</strong></td>
        <td class="font-mono text-center"><span class="badge badge-indigo font-mono text-xs">${c.exec_order}</span></td>
        <td class="text-center">
          <div class="flex-gap-1 justify-center text-xs">
            <span class="badge badge-neutral font-mono" title="Client ID: ${c.client_id || '-'}">${escapeHtml(clientCode)}</span>
            <span class="badge badge-info font-mono" title="Env ID: ${c.env_id || '-'}">${escapeHtml(envCode)}</span>
          </div>
        </td>
        <td class="font-mono text-cyan" style="font-size: 0.8125rem;">
          <span title="Source: [${escapeHtml(c.src_schema || 'dbo')}].[${escapeHtml(c.src_view || '-')}]">[${escapeHtml(c.src_schema || 'dbo')}].[${escapeHtml(c.src_view || '-')}]</span>
        </td>
        <td class="font-mono text-amber" style="font-size: 0.8125rem;">
          <span title="Staging Table: ${escapeHtml(c.stg_table || '-')}">${escapeHtml(c.stg_table || '-')}</span>
        </td>
        <td class="font-mono font-semibold" style="font-size: 0.8125rem; color: #34d399;">
          <span title="Target: [${escapeHtml(c.tgt_schema || 'vendor')}].[${escapeHtml(c.tgt_table || '-')}]">[${escapeHtml(c.tgt_schema || 'vendor')}].[${escapeHtml(c.tgt_table || '-')}]</span>
        </td>
        <td>${formatPkColumns(c.pk_columns)}</td>
        <td>${formatCompareColumns(c.compare_columns)}</td>
        <td class="font-mono text-xs">${escapeHtml(c.id_column || '-')}</td>
        <td class="font-mono text-center text-xs">${c.id_width ?? '-'}</td>
        <td class="font-mono text-center text-xs">${c.id_seed ?? '-'}</td>
        <td>${formatSqlSnippet(c.src_precheck_sql)}</td>
        <td class="text-center"><span class="badge ${c.is_active ? 'badge-success' : 'badge-danger'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="sticky-action-col">
          <div class="flex-gap-2 justify-center">
            <button class="btn btn-secondary btn-sm" onclick="cloneConfig(${c.config_id})" title="Duplikat Konfigurasi ini">📋 Duplikat</button>
            <button class="btn btn-secondary btn-sm" onclick="openEditConfigModal('migration_config', ${c.config_id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="openDeleteModal('migration_config', ${c.config_id}, '${escapeHtml(c.name_config || `Config #${c.config_id}`)}')">Hapus</button>
          </div>
        </td>
      </tr>
      `;
    }).join('');
  } else if (tableKey === 'rules') {
    tbody.innerHTML = pageItems.map((r) => {
      const cfg = (state.config.masters?.migration_config || []).find((c) => c.config_id == r.config_id);
      const cfgName = cfg ? (cfg.name_config || `Config #${r.config_id}`) : `Config #${r.config_id}`;
      const clientObj = (state.clients || []).find((c) => c.client_id == r.client_id);
      const envObj = (state.environments || []).find((e) => e.env_id == r.env_id);
      const clientCode = clientObj ? clientObj.client_code : (r.client_id ? `#${r.client_id}` : '-');
      const envCode = envObj ? envObj.env_code : (r.env_id ? `#${r.env_id}` : '-');

      return `
      <tr>
        <td class="font-mono text-muted text-center font-bold">#${r.rule_id}</td>
        <td class="text-center font-mono">
          <span class="badge badge-neutral font-bold text-amber">#${r.config_id}</span>
          <div class="text-xs text-white font-semibold mt-1">${escapeHtml(cfgName)}</div>
        </td>
        <td><strong class="text-emerald font-mono">${escapeHtml(r.column_name || '-')}</strong></td>
        <td class="text-muted font-mono">${escapeHtml(r.source_column || '-')}</td>
        <td><span class="text-cyan font-semibold">${escapeHtml(r.lookup_name || '-')}</span></td>
        <td class="font-mono text-muted">${escapeHtml(r.master_schema || '-')}</td>
        <td><strong>${escapeHtml(r.master_table || '-')}</strong></td>
        <td class="font-mono text-muted">${escapeHtml(r.master_src_col || '-')}</td>
        <td class="font-mono text-emerald font-semibold">${escapeHtml(r.master_tgt_col || '-')}</td>
        <td>${formatSqlSnippet(r.master_filter)}</td>
        <td class="text-center"><span class="badge ${r.on_unmapped === 'REJECT' ? 'badge-danger' : r.on_unmapped === 'DEFAULT' ? 'badge-info' : 'badge-neutral'} font-mono">${escapeHtml(r.on_unmapped || '-')}</span></td>
        <td class="font-mono text-xs text-center">${escapeHtml(r.default_value !== null && r.default_value !== undefined && r.default_value !== '' ? r.default_value : '-')}</td>
        <td class="text-center"><span class="badge ${r.normalize ? 'badge-success' : 'badge-neutral'}">${r.normalize ? 'Yes' : 'No'}</span></td>
        <td class="text-center">
          <div class="flex-gap-1 justify-center text-xs">
            <span class="badge badge-neutral font-mono" title="Client ID: ${r.client_id || '-'}">${escapeHtml(clientCode)}</span>
            <span class="badge badge-info font-mono" title="Env ID: ${r.env_id || '-'}">${escapeHtml(envCode)}</span>
          </div>
        </td>
        <td class="text-center"><span class="badge ${r.is_active ? 'badge-success' : 'badge-danger'}">${r.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="sticky-action-col">
          <div class="flex-gap-2 justify-center">
            <button class="btn btn-secondary btn-sm" onclick="openEditConfigModal('migration_convert_rule', ${r.rule_id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="openDeleteModal('migration_convert_rule', ${r.rule_id}, 'Rule #${r.rule_id} (${escapeHtml(r.column_name || '')})')">Hapus</button>
          </div>
        </td>
      </tr>
      `;
    }).join('');
  } else if (tableKey === 'targets') {
    tbody.innerHTML = pageItems.map((t) => {
      const cfg = (state.config.masters?.migration_config || []).find((c) => c.config_id == t.config_id);
      const cfgName = cfg ? (cfg.name_config || `Config #${t.config_id}`) : `Config #${t.config_id}`;

      return `
      <tr>
        <td class="font-mono text-muted text-center">#${t.target_config_id}</td>
        <td class="font-mono font-bold text-center">
          <span class="badge badge-neutral text-amber">#${t.config_id}</span>
          <div class="text-xs text-white font-semibold mt-1">${escapeHtml(cfgName)}</div>
        </td>
        <td class="font-mono text-center">${t.exec_order}</td>
        <td class="text-muted">${escapeHtml(t.tgt_schema || 'vendor')}</td>
        <td><strong class="text-emerald">${escapeHtml(t.tgt_table)}</strong></td>
        <td>${formatPkColumns(t.pk_columns)}</td>
        <td>${formatSqlSnippet(t.mapping_sql)}</td>
        <td>${formatSqlSnippet(t.precheck_sql)}</td>
        <td>${formatSqlSnippet(t.postcheck_sql)}</td>
        <td>${formatSqlSnippet(t.rollback_sql)}</td>
        <td class="text-center"><span class="badge ${t.is_active ? 'badge-success' : 'badge-danger'}">${t.is_active ? 'Active' : 'Inactive'}</span></td>
        <td class="sticky-action-col">
          <div class="flex-gap-2 justify-center">
            <button class="btn btn-secondary btn-sm" onclick="openEditConfigModal('migration_target_config', ${t.target_config_id})">Edit</button>
            <button class="btn btn-danger btn-sm" onclick="openDeleteModal('migration_target_config', ${t.target_config_id}, 'Target #${t.target_config_id}')">Hapus</button>
          </div>
        </td>
      </tr>
      `;
    }).join('');
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
      { name: 'name_config', label: 'Nama Konfigurasi / Objek', type: 'text', placeholder: 'e.g. Vendor, Akta Perusahaan, Vendor Address' },
      { name: 'exec_order', label: 'Exec Order', type: 'number', default: 1, required: true },
      { name: 'src_schema', label: 'Source Schema', type: 'text', default: 'dbo', required: true },
      { name: 'src_view', label: 'Source View (SQL Server)', type: 'text', placeholder: 'v_migration_vendor', required: true },
      { name: 'stg_table', label: 'Staging Table (PostgreSQL)', type: 'text', placeholder: 'stg_vendors_src', required: true },
      { name: 'tgt_schema', label: 'Target Schema', type: 'text', default: 'vendor', required: true },
      { name: 'tgt_table', label: 'Target Table (PostgreSQL)', type: 'text', placeholder: 'vendor_header', required: true },
      { name: 'pk_columns', label: 'PK Columns', type: 'text', placeholder: 'id', required: true },
      { name: 'compare_columns', label: 'Compare Columns', type: 'textarea', placeholder: 'e.g. name, email, status (Akan terisi otomatis saat simpan jika dikosongkan)' },
      { name: 'id_column', label: 'ID Column', type: 'text', placeholder: 'id' },
      { name: 'id_width', label: 'ID Width', type: 'number', default: 10 },
      { name: 'id_seed', label: 'ID Seed', type: 'text', default: '1' },
      { name: 'src_precheck_sql', label: 'Source Precheck SQL', type: 'textarea', placeholder: 'SELECT COUNT(*) FROM ... (Akan terisi otomatis saat simpan jika dikosongkan)' },
      { name: 'is_active', label: 'Status Aktif', type: 'boolean', default: true },
    ],
  },
  migration_convert_rule: {
    title: 'Convert Rule (migration_convert_rule)',
    fields: [
      { name: 'client_id', label: '1. Client', type: 'select_client_cascade', required: false },
      { name: 'env_id', label: '2. Environment', type: 'select_env_cascade', required: false },
      { name: 'config_id', label: '3. Migration Config (Target Pipeline)', type: 'select_config', required: true },
      { name: 'column_name', label: '4. Column Name (Target / Staging Column)', type: 'text', placeholder: 'e.g. company_type_id atau vendor_id', required: true },
      { name: 'source_column', label: '5. Source Column (Di Source View)', type: 'text', placeholder: 'e.g. tipe_perusahaan (kosongkan jika sama)' },
      { name: 'lookup_name', label: '6. Lookup Name / Identifier', type: 'text', placeholder: 'e.g. company_type atau akta_perusahaan' },
      { name: 'master_schema', label: '7. Master Schema (PostgreSQL)', type: 'text', default: 'vendor', placeholder: 'vendor' },
      { name: 'master_table', label: '8. Master Table (PostgreSQL)', type: 'text', placeholder: 'e.g. company_types atau vendors' },
      { name: 'master_src_col', label: '9. Master Source Match Col', type: 'text', placeholder: 'e.g. name atau vendor_reference_id' },
      { name: 'master_tgt_col', label: '10. Master Target Return Col', type: 'text', placeholder: 'e.g. id atau code' },
      { name: 'master_filter', label: '11. Master Filter Condition (SQL WHERE)', type: 'textarea', placeholder: 'e.g. is_active = true AND deleted_at IS NULL' },
      { name: 'on_unmapped', label: '12. On Unmapped Action', type: 'select', options: ['DEFAULT', 'NULL', 'REJECT', 'KEEP_ORIGINAL'], default: 'DEFAULT' },
      { name: 'default_value', label: '13. Default Value (Jika Unmapped)', type: 'text', placeholder: 'e.g. 0 atau UNKNOWN' },
      { name: 'normalize', label: '14. Normalize (Trim & Case Insensitive)', type: 'boolean', default: true },
      { name: 'is_active', label: '15. Status Aturan Aktif', type: 'boolean', default: true },
    ],
  },
  migration_target_config: {
    title: 'Target Config',
    fields: [
      { name: 'config_id', label: '1. Migration Config (Pipeline)', type: 'select_config', required: true },
      { name: 'exec_order', label: 'Exec Order', type: 'number', default: 1, required: true },
      { name: 'tgt_schema', label: 'Target Schema', type: 'text', default: 'vendor', required: true },
      { name: 'tgt_table', label: 'Target Table', type: 'text', required: true },
      { name: 'pk_columns', label: 'PK Columns', type: 'text', default: 'id', required: true },
      { name: 'mapping_sql', label: 'Mapping SQL', type: 'textarea', placeholder: 'Otomatis digenerate jika dikosongkan...' },
      { name: 'precheck_sql', label: 'Precheck SQL', type: 'textarea' },
      { name: 'postcheck_sql', label: 'Postcheck SQL', type: 'textarea' },
      { name: 'rollback_sql', label: 'Rollback SQL', type: 'textarea', placeholder: 'Otomatis digenerate jika dikosongkan...' },
      { name: 'is_active', label: 'Status Aktif', type: 'boolean', default: true },
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

window.openCreateConfigModal = async function (tableName) {
  if ((!state.clients || state.clients.length === 0 || !state.environments || state.environments.length === 0) && typeof loadSettingsClientsAndEnvironments === 'function') {
    await loadSettingsClientsAndEnvironments();
  }
  openUniversalForm(tableName, null);
};

window.openEditConfigModal = async function (tableName, id) {
  if ((!state.clients || state.clients.length === 0 || !state.environments || state.environments.length === 0) && typeof loadSettingsClientsAndEnvironments === 'function') {
    await loadSettingsClientsAndEnvironments();
  }
  const meta = state.config.masters ? state.config.masters[tableName] : [];
  let record = null;
  if (tableName === 'migration_config') record = meta?.find((r) => r.config_id == id);
  else if (tableName === 'migration_convert_rule') record = meta?.find((r) => r.rule_id == id);
  else if (tableName === 'migration_target_config') record = meta?.find((r) => r.target_config_id == id);
  else if (tableName === 'migration_lookup') record = meta?.find((r) => r.lookup_name == id);

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

  // Normalisasi existingData untuk Connection & Convert Rule
  let effectiveData = existingData ? { ...existingData } : {};
  if (entityType === 'connection' || entityType === 'migration_convert_rule') {
    if (isEdit && effectiveData.env_id) {
      const parentEnv = state.environments?.find((e) => e.env_id == effectiveData.env_id);
      if (parentEnv && !effectiveData.client_id) {
        effectiveData.client_id = parentEnv.client_id;
      }
    } else if (!isEdit) {
      if (!effectiveData.client_id) {
        effectiveData.client_id = state.selectedClientId || (state.clients && state.clients[0]?.client_id) || '';
      }
      if (!effectiveData.env_id && effectiveData.client_id) {
        const clientEnvs = state.environments ? state.environments.filter((e) => e.client_id == effectiveData.client_id) : [];
        if (clientEnvs.length > 0) effectiveData.env_id = clientEnvs[0].env_id;
      }
    }
  }

  const container = document.getElementById('crud-modal-fields-container');
  const wideFields = [
    'compare_columns', 'src_precheck_sql', 'mapping_sql', 'precheck_sql',
    'postcheck_sql', 'rollback_sql', 'master_filter', 'description', 'note', 'sql_query', 'config_id'
  ];

  const fieldItems = def.fields.map((f) => {
    const val = effectiveData && effectiveData[f.name] !== undefined ? effectiveData[f.name] : (f.default !== undefined ? f.default : '');
    const isPkField = isEdit && f.isPk;
    const isWide = f.type === 'textarea' || wideFields.includes(f.name);

    let inputHtml = '';
    if (f.type === 'textarea') {
      let extraTester = '';
      if (f.name === 'src_precheck_sql' || f.name === 'precheck_sql') {
        extraTester = `
          <div class="precheck-test-container">
            <button type="button" class="btn btn-secondary btn-xs" onclick="testPrecheckQuery('${f.name}')">
              🧪 Uji Precheck SQL
            </button>
            <span id="precheck-status-${f.name}" class="precheck-status-badge text-muted">Belum diuji</span>
          </div>
        `;
      }
      inputHtml = `<textarea name="${f.name}" class="form-input form-textarea font-mono text-xs" rows="3" ${f.required ? 'required' : ''}>${escapeHtml(String(val || ''))}</textarea>${extraTester}`;
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
    } else if (f.type === 'select_config') {
      const configs = state.config.masters?.migration_config || [];
      let selectedVal = val;
      if (!selectedVal && configs.length > 0) {
        selectedVal = configs[0].config_id;
      }
      let configOptions = '';
      if (selectedVal && !configs.some((c) => String(c.config_id) === String(selectedVal))) {
        configOptions += `<option value="${selectedVal}" selected>[Config #${selectedVal}]</option>`;
      }
      if (configs.length > 0) {
        configOptions += configs.map((c) => `
          <option value="${c.config_id}" ${String(selectedVal) === String(c.config_id) ? 'selected' : ''}>
            [Config #${c.config_id}] ${escapeHtml(c.src_view)} ➔ ${escapeHtml(c.tgt_schema || 'vendor')}.${escapeHtml(c.tgt_table)}
          </option>
        `).join('');
      } else {
        configOptions = `<option value="${selectedVal || ''}">-- Belum ada Migration Config (Isi manual ID: ${selectedVal || 1}) --</option>`;
      }
      inputHtml = `
        <select name="${f.name}" class="form-input" required>
          ${configOptions}
        </select>
      `;
    } else if (f.type === 'select_client' || f.type === 'select_client_cascade') {
      const clientOptions = state.clients && state.clients.length > 0
        ? state.clients.map((c) => `<option value="${c.client_id}" ${val == c.client_id ? 'selected' : ''}>[${escapeHtml(c.client_code)}] ${escapeHtml(c.client_name)}</option>`).join('')
        : '<option value="">-- Belum ada Client (Buat Master Client terlebih dahulu) --</option>';
      const noneOption = f.required ? '' : '<option value="">-- Tanpa Client Khusus (Global) --</option>';
      inputHtml = `
        <select name="${f.name}" class="form-input" ${f.required ? 'required' : ''}>
          ${noneOption}${clientOptions}
        </select>
      `;
    } else if (f.type === 'select_env') {
      const envOptions = state.environments && state.environments.length > 0
        ? state.environments.map((e) => `<option value="${e.env_id}" ${val == e.env_id ? 'selected' : ''}>[${escapeHtml(e.env_code)}] ${escapeHtml(e.env_name)}</option>`).join('')
        : '<option value="">-- Belum ada Environment (Buat Master Environment terlebih dahulu) --</option>';
      const noneOption = f.required ? '' : '<option value="">-- Tanpa Environment Khusus (Global) --</option>';
      inputHtml = `
        <select name="${f.name}" class="form-input" ${f.required ? 'required' : ''}>
          ${noneOption}${envOptions}
        </select>
      `;
    } else if (f.type === 'select_env_cascade') {
      const targetClientId = effectiveData.client_id ? parseInt(effectiveData.client_id, 10) : (state.clients && state.clients[0]?.client_id || null);
      const filteredEnvs = targetClientId && state.environments ? state.environments.filter((e) => e.client_id === targetClientId) : (state.environments || []);

      const envOptions = filteredEnvs && filteredEnvs.length > 0
        ? filteredEnvs.map((e) => `<option value="${e.env_id}" ${val == e.env_id ? 'selected' : ''}>[${escapeHtml(e.env_code)}] ${escapeHtml(e.env_name)}</option>`).join('')
        : '<option value="">-- Belum ada Environment untuk Client ini (Tambahkan di Tab Environment) --</option>';
      const noneOption = f.required ? '' : '<option value="">-- Tanpa Environment Khusus (Global) --</option>';
      inputHtml = `
        <select name="${f.name}" class="form-input" ${f.required ? 'required' : ''}>
          ${noneOption}${envOptions}
        </select>
      `;
    } else {
      const isUpper = f.uppercase || f.name === 'client_code' || f.name === 'env_code';
      const inputClass = isUpper ? 'form-input font-mono uppercase' : 'form-input';
      const inputStyle = isUpper ? 'style="text-transform: uppercase; font-family: monospace; font-weight: bold;"' : '';
      const oninputAttr = isUpper ? 'oninput="this.value = this.value.toUpperCase()"' : '';
      const listAttr = f.name === 'src_view' ? 'list="datalist-source-views" autocomplete="off"' : (f.name === 'tgt_table' ? 'list="datalist-target-tables" autocomplete="off"' : '');

      inputHtml = `
        <input type="${f.type}" name="${f.name}" class="${inputClass}" ${inputStyle} value="${escapeHtml(String(val || ''))}"
          placeholder="${escapeHtml(f.placeholder || '')}" ${f.required ? 'required' : ''} ${isPkField ? 'readonly' : ''} ${oninputAttr} ${listAttr}>
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

  // Interactive cascading enhancements untuk Client -> Environment
  const selClient = container.querySelector('select[name="client_id"]');
  const selEnv = container.querySelector('select[name="env_id"]');
  if (selClient && selEnv) {
    selClient.addEventListener('change', () => {
      const cId = parseInt(selClient.value, 10);
      const isReq = selEnv.hasAttribute('required');
      const noneOpt = isReq ? '' : '<option value="">-- Tanpa Environment Khusus (Global) --</option>';
      if (isNaN(cId)) {
        selEnv.innerHTML = noneOpt + '<option value="">-- Pilih Client terlebih dahulu --</option>';
        return;
      }
      const envs = state.environments ? state.environments.filter((e) => e.client_id === cId) : [];
      if (envs.length === 0) {
        selEnv.innerHTML = noneOpt + '<option value="">-- Belum ada Environment untuk Client ini (Tambahkan di Tab Environment) --</option>';
      } else {
        selEnv.innerHTML = noneOpt + envs.map((e) => `<option value="${e.env_id}">[${escapeHtml(e.env_code)}] ${escapeHtml(e.env_name)}</option>`).join('');
      }
    });
  }

  // Interactive enhancements khusus connection form
  if (entityType === 'connection') {
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

  // Interactive enhancements khusus migration_config form: Tombol Isi Otomatis di Footer
  const footerExtra = document.getElementById('crud-modal-footer-extra');
  if (footerExtra) {
    if (entityType === 'migration_config') {
      footerExtra.innerHTML = `
        <button type="button" id="btn-auto-fill-defaults" class="btn btn-indigo flex-center gap-1">
          <span>⚡ Isi Otomatis Sekarang</span>
        </button>
      `;

      const btnAutoFill = footerExtra.querySelector('#btn-auto-fill-defaults');
      btnAutoFill.addEventListener('click', async () => {
        const formEl = document.getElementById('form-universal-crud');
        const fData = new FormData(formEl);
        const srcView = (fData.get('src_view') || '').trim();
        if (!srcView) {
          alert('Silakan isi kolom "Source View (SQL Server)" terlebih dahulu.');
          return;
        }
        btnAutoFill.disabled = true;
        btnAutoFill.textContent = 'Memuat metadata...';
        try {
          const res = await fetch(`/api/etl/configs/migration_config/defaults?src_schema=${encodeURIComponent(fData.get('src_schema') || 'dbo')}&src_view=${encodeURIComponent(srcView)}&pk_columns=${encodeURIComponent(fData.get('pk_columns') || '')}&stg_table=${encodeURIComponent(fData.get('stg_table') || '')}`);
          const json = await res.json();
          if (json.success) {
            const cmpEl = formEl.querySelector('[name="compare_columns"]');
            const preEl = formEl.querySelector('[name="src_precheck_sql"]');
            if (cmpEl && json.compare_columns) cmpEl.value = json.compare_columns;
            if (preEl && json.src_precheck_sql) preEl.value = json.src_precheck_sql;
            alert('✓ Kolom Compare & Precheck SQL berhasil digenerate otomatis!');
          } else {
            alert('Gagal mengambil metadata: ' + (json.error || 'Terjadi kesalahan'));
          }
        } catch (err) {
          alert('Gagal generate: ' + err.message);
        } finally {
          btnAutoFill.disabled = false;
          btnAutoFill.innerHTML = '<span>⚡ Isi Otomatis Sekarang</span>';
        }
      });
    } else if (entityType === 'migration_target_config') {
      footerExtra.innerHTML = `
        <button type="button" id="btn-auto-fill-target-sql" class="btn btn-indigo flex-center gap-1">
          <span>⚡ Generate Mapping & Rollback SQL</span>
        </button>
      `;

      const btnAutoTarget = footerExtra.querySelector('#btn-auto-fill-target-sql');
      btnAutoTarget.addEventListener('click', async () => {
        const formEl = document.getElementById('form-universal-crud');
        const fData = new FormData(formEl);
        const configId = (fData.get('config_id') || '').trim();
        const tgtTable = (fData.get('tgt_table') || '').trim();
        if (!configId) {
          alert('Silakan pilih "Migration Config" terlebih dahulu.');
          return;
        }
        if (!tgtTable) {
          alert('Silakan isi kolom "Target Table" terlebih dahulu.');
          return;
        }
        btnAutoTarget.disabled = true;
        btnAutoTarget.textContent = 'Mengenerate SQL...';
        try {
          const res = await fetch(`/api/etl/configs/migration_target_config/defaults?config_id=${encodeURIComponent(configId)}&tgt_schema=${encodeURIComponent(fData.get('tgt_schema') || 'vendor')}&tgt_table=${encodeURIComponent(tgtTable)}&pk_columns=${encodeURIComponent(fData.get('pk_columns') || 'id')}`);
          const json = await res.json();
          if (json.success) {
            const mapEl = formEl.querySelector('[name="mapping_sql"]');
            const rollEl = formEl.querySelector('[name="rollback_sql"]');
            if (mapEl && json.mapping_sql) mapEl.value = json.mapping_sql;
            if (rollEl && json.rollback_sql) rollEl.value = json.rollback_sql;
            alert('✓ Mapping SQL dan Rollback SQL berhasil digenerate otomatis!');
          } else {
            alert('Gagal generate SQL: ' + (json.error || 'Terjadi kesalahan'));
          }
        } catch (err) {
          alert('Gagal generate SQL: ' + err.message);
        } finally {
          btnAutoTarget.disabled = false;
          btnAutoTarget.innerHTML = '<span>⚡ Generate Mapping & Rollback SQL</span>';
        }
      });
    } else {
      footerExtra.innerHTML = '';
    }
  }

  populateConfigDatalists();
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

  // Point 7: Client-side Staging collision guard
  if (entityType === 'migration_config' && data.stg_table) {
    const activeConfigs = state.config.masters?.migration_config || [];
    const collision = activeConfigs.find((c) => {
      if (isEdit && String(c.config_id) === String(id)) return false;
      if (!c.is_active) return false;
      const sameClient = !data.client_id || !c.client_id || String(c.client_id) === String(data.client_id);
      const sameEnv = !data.env_id || !c.env_id || String(c.env_id) === String(data.env_id);
      return c.stg_table && c.stg_table.toLowerCase() === String(data.stg_table).toLowerCase() && sameClient && sameEnv;
    });
    if (collision) {
      alert(`⚠️ Staging table '${data.stg_table}' sudah digunakan oleh Config #${collision.config_id} (${collision.name_config || ''}). Gunakan nama staging table lain.`);
      return;
    }
  }

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
// UNIVERSAL GENERAL CONFIRMATION DIALOG
// =========================================================================
window.openGeneralConfirmModal = function ({
  title = 'Konfirmasi Aksi',
  message = 'Apakah Anda yakin ingin melanjutkan tindakan ini?',
  submessage = '',
  proceedLabel = 'Lanjutkan',
  proceedClass = 'btn-primary',
  onConfirm = null,
} = {}) {
  const modal = document.getElementById('modal-general-confirm');
  if (!modal) return;

  const titleEl = document.getElementById('general-confirm-title');
  const msgEl = document.getElementById('general-confirm-msg');
  const submsgEl = document.getElementById('general-confirm-submsg');
  const proceedBtn = document.getElementById('btn-general-confirm-proceed');
  const cancelBtn = document.getElementById('btn-general-confirm-cancel');
  const closeBtn = document.getElementById('btn-close-general-confirm');

  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (submsgEl) {
    submsgEl.textContent = submessage;
    submsgEl.style.display = submessage ? 'block' : 'none';
  }

  if (proceedBtn) {
    proceedBtn.textContent = proceedLabel;
    proceedBtn.className = `btn ${proceedClass} btn-sm`;
    proceedBtn.onclick = () => {
      modal.classList.add('hidden');
      if (typeof onConfirm === 'function') {
        onConfirm();
      }
    };
  }

  const closeModal = () => modal.classList.add('hidden');
  if (cancelBtn) cancelBtn.onclick = closeModal;
  if (closeBtn) closeBtn.onclick = closeModal;

  modal.classList.remove('hidden');
};

// =========================================================================
// UNIVERSAL DELETE CONFIRMATION DIALOG
// =========================================================================
window.openDeleteModal = function (type, id, displayName) {
  // Point 1: Client-side Dependency guard for migration_config
  if (type === 'migration_config') {
    const rules = (state.config.masters?.migration_convert_rule || []).filter((r) => r.config_id == id);
    const targets = (state.config.masters?.migration_target_config || []).filter((t) => t.config_id == id);
    if (rules.length > 0 || targets.length > 0) {
      const parts = [];
      if (rules.length > 0) parts.push(`${rules.length} Convert Rules`);
      if (targets.length > 0) parts.push(`${targets.length} Target Configs`);
      alert(`⚠️ Config #${id} tidak dapat dihapus karena masih memiliki relasi aktif (${parts.join(' & ')}).\nHarap hapus atau pindahkan relasi terkait terlebih dahulu.`);
      return;
    }
  }

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
    } else if (type === 'user') {
      url = `/api/auth/users/${id}`;
    } else if (type === 'role') {
      url = `/api/auth/roles/${id}`;
    }

    const isAuthRoute = ['user', 'role'].includes(type);
    const res = await (isAuthRoute ? authFetch(url, { method: 'DELETE' }) : fetch(url, { method: 'DELETE' }));
    const json = await res.json();
    if (!json.success) throw new Error(json.message || json.error);

    alert(`✓ Data berhasil dihapus.`);
    document.getElementById('modal-delete-confirm').classList.add('hidden');

    if (type === 'source_view') {
      loadSourceViews();
    } else if (['client', 'environment', 'connection'].includes(type)) {
      loadSettingsClientsAndEnvironments();
      loadSettingsConnections();
      loadContextClientsAndEnvironments();
    } else if (type === 'user') {
      await loadSysUsers();
    } else if (type === 'role') {
      await loadSysRoles();
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
// MIGRATION CONFIG ENHANCEMENTS (POINTS 1 - 8)
// =========================================================================

/**
 * Point 2: Datalist Autocomplete untuk Source Views dan Target Tables
 */
async function populateConfigDatalists() {
  const dlViews = document.getElementById('datalist-source-views');
  const dlTables = document.getElementById('datalist-target-tables');
  if (!dlViews || !dlTables) return;

  // 1. Source Views Datalist
  let views = state.source?.views || [];
  if (views.length === 0) {
    try {
      const res = await fetch('/api/source/views');
      const json = await res.json();
      if (json.success && json.data?.views) {
        views = json.data.views;
        state.source.views = views;
      }
    } catch (_) {}
  }
  dlViews.innerHTML = views.map((v) => `<option value="${escapeHtml(v.name)}">${escapeHtml(v.description || '')}</option>`).join('');

  // 2. Target Tables Datalist
  const knownTables = new Set();
  (state.config.masters?.migration_config || []).forEach((c) => {
    if (c.tgt_table) knownTables.add(c.tgt_table);
  });
  (state.config.masters?.migration_target_config || []).forEach((t) => {
    if (t.tgt_table) knownTables.add(t.tgt_table);
  });

  try {
    const res = await fetch('/api/tables');
    const json = await res.json();
    if (json.success && json.data?.tables) {
      json.data.tables.forEach((t) => {
        if (t.name) knownTables.add(t.name);
      });
    }
  } catch (_) {}

  dlTables.innerHTML = Array.from(knownTables).sort().map((tbl) => `<option value="${escapeHtml(tbl)}"></option>`).join('');
}
window.populateConfigDatalists = populateConfigDatalists;

/**
 * Point 3: Drill-Down Cross-Tab dari Main Config ke Rules & Targets
 */
window.filterConfigDrillDown = function (subtabKey, configId) {
  const subtabId = `subtab-cfg-${subtabKey}`;
  switchConfigSubtab(subtabId);
  const searchInput = document.getElementById(`search-config-${subtabKey}`);
  if (searchInput) {
    searchInput.value = configId;
  }
  if (!state.config.tables[subtabKey]) {
    state.config.tables[subtabKey] = { page: 1, limit: 10, search: '', sortBy: null, sortDir: 'asc' };
  }
  state.config.tables[subtabKey].search = String(configId);
  state.config.tables[subtabKey].page = 1;
  renderConfigTable(subtabKey);
  showToast(`🔍 Menampilkan ${subtabKey === 'rules' ? 'Convert Rules' : 'Target Config'} untuk Config #${configId}`, 'info', 2500);
};

/**
 * Point 4: Uji Precheck SQL langsung dari modal form
 */
window.testPrecheckQuery = async function (fieldName) {
  const textarea = document.querySelector(`textarea[name="${fieldName}"]`);
  const statusEl = document.getElementById(`precheck-status-${fieldName}`);
  if (!textarea) return;

  const sql = textarea.value.trim();
  if (!sql) {
    if (statusEl) {
      statusEl.className = 'precheck-status-badge text-rose';
      statusEl.textContent = 'Query kosong';
    }
    showToast('Silakan isi query SQL Precheck terlebih dahulu.', 'warning');
    return;
  }

  if (statusEl) {
    statusEl.className = 'precheck-status-badge text-amber';
    statusEl.textContent = '⏳ Menguji ke SQL Server...';
  }

  try {
    const res = await fetch('/api/etl/configs/test-precheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ querySql: sql }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.error);

    if (statusEl) {
      statusEl.className = 'precheck-status-badge text-emerald';
      statusEl.textContent = `✓ Valid (${json.rowCount} baris, ${json.durationMs}ms)`;
    }
    showToast(`✓ Precheck SQL valid! Mengembalikan ${json.rowCount} baris data (${json.durationMs}ms).`, 'success');
  } catch (err) {
    if (statusEl) {
      statusEl.className = 'precheck-status-badge text-rose';
      statusEl.textContent = `❌ ${err.message.slice(0, 45)}...`;
    }
    showToast(`❌ Uji Precheck SQL gagal: ${err.message}`, 'error', 5000);
  }
};

/**
 * Point 5: Duplikat / Clone Migration Config
 */
window.cloneConfig = function (configId) {
  const configs = state.config.masters?.migration_config || [];
  const src = configs.find((c) => c.config_id == configId);
  if (!src) {
    showToast(`Config #${configId} tidak ditemukan.`, 'error');
    return;
  }
  const cloneData = { ...src };
  delete cloneData.config_id;
  cloneData.name_config = `${cloneData.name_config || 'Config'} (Copy)`;
  if (cloneData.stg_table) {
    cloneData.stg_table = `${cloneData.stg_table}_copy`;
  }
  showToast(`📋 Menyalin konfigurasi #${configId} sebagai data baru...`, 'info', 2000);
  openUniversalForm('migration_config', null, cloneData);
};

/**
 * Point 8: Export Master Migration Configs ke File JSON
 */
window.exportAllConfigs = async function () {
  try {
    let url = '/api/etl/configs/export';
    const params = [];
    if (state.selectedClientId) params.push(`clientId=${state.selectedClientId}`);
    if (state.selectedEnvId) params.push(`envId=${state.selectedEnvId}`);
    if (params.length > 0) url += `?${params.join('&')}`;

    const res = await fetch(url);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Gagal export data');

    const jsonStr = JSON.stringify(json, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const downloadUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = downloadUrl;
    a.download = `migration_configs_${timestamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(downloadUrl);

    const totals = json.totals || {};
    showToast(`✓ Berhasil mengekspor konfigurasi (${totals.configs || 0} configs, ${totals.rules || 0} rules, ${totals.targets || 0} targets).`, 'success');
  } catch (err) {
    showToast(`Gagal export: ${err.message}`, 'error');
  }
};

/**
 * Point 8: Trigger & Handle Import Config JSON
 */
window.triggerImportConfigs = function () {
  const fileInput = document.getElementById('input-import-config-file');
  if (fileInput) {
    fileInput.value = '';
    fileInput.click();
  }
};

window.handleImportConfigFile = async function (event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const payload = JSON.parse(e.target.result);
      if (!payload.data || !payload.data.migration_config) {
        throw new Error('File tidak memiliki format konfigurasi valid (struktur data.migration_config hilang).');
      }

      const cfgCount = payload.data.migration_config?.length || 0;
      const ruleCount = payload.data.migration_convert_rule?.length || 0;
      const tgtCount = payload.data.migration_target_config?.length || 0;
      const lkpCount = payload.data.migration_lookup?.length || 0;

      const confirmMsg = `Import konfigurasi dari "${file.name}"?\n- ${cfgCount} Migration Configs\n- ${ruleCount} Convert Rules\n- ${tgtCount} Target Configs\n- ${lkpCount} Lookups\n\nData akan dihubungkan ke Client/Env aktif saat ini. Lanjutkan?`;
      if (!confirm(confirmMsg)) return;

      showToast('Mengimport data konfigurasi...', 'info');
      const res = await fetch('/api/etl/configs/import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          payload,
          clientId: state.selectedClientId,
          envId: state.selectedEnvId,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error || 'Gagal import konfigurasi');

      const imp = json.imported || {};
      showToast(`✓ Sukses import: ${imp.configs} configs, ${imp.rules} rules, ${imp.targets} targets, ${imp.lookups} lookups!`, 'success', 5000);
      await loadEtlMasters();
    } catch (err) {
      showToast(`Gagal import file: ${err.message}`, 'error', 6000);
    }
  };
  reader.readAsText(file);
};

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

    const elTot = document.getElementById('kpi-etl-total-runs');
    if (elTot) elTot.textContent = data.totalRuns;
    const elSucc = document.getElementById('kpi-etl-success-runs');
    if (elSucc) elSucc.textContent = data.successRuns;
    const elFail = document.getElementById('kpi-etl-failed-runs');
    if (elFail) elFail.textContent = data.failedRuns;
    const elErr = document.getElementById('kpi-etl-total-errors');
    if (elErr) elErr.textContent = data.totalErrors;
  } catch (e) {}
}

window.loadEtlOverview = loadEtlOverview;
window.loadEtlRuns = loadEtlRuns;
window.loadEtlStepLogs = loadEtlStepLogs;
window.loadEtlErrorLogs = loadEtlErrorLogs;
window.switchCanvasBottomTab = switchCanvasBottomTab;

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

    renderPaginationNumbers('runs-page-numbers', curPage, state.process.totalPages, (newPage) => {
      state.process.page = newPage;
      loadEtlRuns();
    });

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
      const isSuperseded = Boolean(run.note && (run.note.toUpperCase().includes('SUPERSEDED') || run.note.toUpperCase().includes('KADALUARSA')));
      const isCancelled = run.status === 'CANCELLED';
      const isSuccess = run.status === 'SUCCESS' || run.status === 'COMPLETED';
      const isFailed = run.status === 'FAILED';
      const isPostFailed = (run.main_workflow === 'flow_2_post' && isFailed) || (isFailed && run.note && (run.note.toUpperCase().includes('FLOW 2') || run.note.toUpperCase().includes('PRECHECK_TARGET')));
      const isFiltered = state.process.selectedRunId == run.run_id;

      // Status Badge
      let statusBadge = '';
      if (isSuperseded) {
        statusBadge = `<span class="badge" style="background: rgba(148, 163, 184, 0.2); color: #64748b; border: 1px solid #cbd5e1; font-weight: 700;" title="Sesi usang karena digantikan oleh run baru">⚠️ SUPERSEDED</span>`;
      } else if (isCancelled) {
        statusBadge = `<span class="badge" style="background: rgba(148, 163, 184, 0.2); color: #64748b; border: 1px solid #94a3b8; font-weight: 700;" title="Sesi telah dibatalkan">🚫 CANCELLED</span>`;
      } else if (isSuccess) {
        statusBadge = `<span class="badge badge-success font-bold" title="Sesi aktif dan berhasil dieksekusi">✓ SUCCESS (Aktif)</span>`;
      } else if (isPostFailed) {
        statusBadge = `<span class="badge badge-danger font-bold" title="Staging sukses, namun gagal pada tahap Flow 2 Posting">✕ POST FAILED</span>`;
      } else if (isFailed) {
        statusBadge = `<span class="badge badge-danger font-bold">✕ FAILED</span>`;
      } else {
        const badgeClass = run.status === 'RUNNING' ? 'badge-primary' : 'badge-warning';
        statusBadge = `<span class="badge ${badgeClass}">${run.status}</span>`;
      }

      // Posting & Rollback Badges
      const isPurgeFlow = run.main_workflow === 'flow_4_purge' || run.main_workflow?.includes('purge');
      const isZeroPost = (run.main_workflow === 'flow_2_post' && run.is_posted === false) ||
                         (run.note && (run.note.includes('+0 baris diposting') || run.note.includes('ter-insert=0')));
      let postBadge = '';
      if (isPurgeFlow) {
        postBadge = `<span class="text-muted text-xs font-mono">-</span>`;
      } else if (isZeroPost) {
        postBadge = `<span class="badge badge-warning font-bold" title="Tidak ada baris data baru yang diposting ke target (+0 baris)">📦 No Posted</span>`;
      } else if (run.is_posted) {
        postBadge = `<span class="badge badge-success font-bold">✓ Sudah Post (${escapeHtml(run.post_type || 'auto')})</span>`;
      } else if (isCancelled) {
        postBadge = `<span class="badge" style="background: #f1f5f9; color: #94a3b8; border: 1px dashed #cbd5e1; font-weight: 600;" title="Sesi dibatalkan, tidak diposting">Batal</span>`;
      } else if (isSuperseded) {
        postBadge = `<span class="badge" style="background: #f1f5f9; color: #94a3b8; border: 1px dashed #cbd5e1; font-weight: 600;" title="Data staging telah digantikan oleh sesi baru, tidak diposting">Batal / Usang</span>`;
      } else if (isPostFailed) {
        postBadge = `<span class="badge badge-danger font-bold" title="Gagal saat posting ke tabel target">✕ Gagal Post (Flow 2)</span>`;
      } else if (isSuccess && (run.main_workflow === 'flow_1_staging' || !run.main_workflow)) {
        postBadge = `<span class="badge font-bold" style="background: #e0f2fe; color: #0284c7; border: 1px solid #7dd3fc;" title="Data staging valid, siap diposting ke target (Flow 2)">Siap Post (Flow 2)</span>`;
      } else {
        postBadge = `<span class="text-muted text-xs font-mono">-</span>`;
      }

      let rollbackBadge = '';
      if (isPurgeFlow || isZeroPost) {
        rollbackBadge = `<span class="text-muted text-xs font-mono">-</span>`;
      } else if (run.is_rolled_back) {
        rollbackBadge = `<span class="badge badge-danger">⚠️ Rolled Back</span>`;
      } else if (run.is_posted) {
        rollbackBadge = `<span class="badge badge-neutral">Normal</span>`;
      } else {
        rollbackBadge = `<span class="text-muted text-xs font-mono">-</span>`;
      }

      const clientBadge = run.client_code
        ? `<span class="badge badge-info font-mono font-bold" title="${escapeHtml(run.client_name || '')}">${escapeHtml(run.client_code)}</span>`
        : `<span class="badge badge-neutral text-xs">GLOBAL</span>`;

      const envBadge = run.env_code
        ? `<span class="badge badge-purple font-mono font-bold" title="${escapeHtml(run.env_name || '')}">${escapeHtml(run.env_code)}</span>`
        : `<span class="badge badge-neutral text-xs">DEFAULT</span>`;

      // Note text styling
      let noteStyle = 'color: #64748b; font-size: 0.75rem;';
      if (isSuperseded) {
        noteStyle = 'color: #94a3b8; font-size: 0.75rem; font-style: italic;';
      } else if (run.note && (run.note.includes('AKTIF') || run.note.includes('STAGING SIAP'))) {
        noteStyle = 'color: #15803d; font-size: 0.75rem; font-weight: 600;';
      } else if (run.is_posted) {
        noteStyle = 'color: #0369a1; font-size: 0.75rem; font-weight: 600;';
      }

      const rowBgStyle = (isSuperseded || isCancelled)
        ? 'opacity: 0.7; background-color: rgba(241, 245, 249, 0.4);' 
        : (!run.is_posted && isSuccess && !isPurgeFlow ? 'background-color: rgba(240, 253, 244, 0.35);' : '');

      let workflowDisplay = `<span class="font-mono text-cyan" style="font-size: 0.75rem;">${run.main_workflow || '-'}</span>`;
      if (run.main_workflow === 'flow_2_post') {
        workflowDisplay = `<span class="badge badge-purple font-mono font-bold" title="Tahap 2: Posting Target">flow_2_post</span>`;
      } else if (run.main_workflow === 'flow_4_purge') {
        workflowDisplay = `<span class="badge badge-warning font-mono font-bold" title="Tahap 4: Purge Target">flow_4_purge</span>`;
      } else if (isPostFailed) {
        workflowDisplay = `<span class="font-mono text-cyan" style="font-size: 0.75rem;">flow_1</span><span class="text-xs font-bold" style="color: #ef4444;"> ➔ flow_2</span>`;
      }

      return `
        <tr class="${isFiltered ? 'active-row' : ''}" style="${rowBgStyle}">
          <td class="font-mono font-bold">#${run.run_id}</td>
          <td>${clientBadge}</td>
          <td>${envBadge}</td>
          <td class="font-mono text-muted" style="font-size: 0.75rem;">${run.run_ts || '-'}</td>
          <td>${workflowDisplay}</td>
          <td class="font-mono text-muted">${run.config_id ? `Config #${run.config_id}` : '-'}</td>
          <td>${statusBadge}</td>
          <td class="font-mono text-muted" style="font-size: 0.75rem;">${formatDate(run.start_time)}</td>
          <td class="font-mono">${run.duration_seconds ? run.duration_seconds + 's' : '-'}</td>
          <td>${postBadge}</td>
          <td>${rollbackBadge}</td>
          <td class="font-mono text-muted" style="font-size: 0.75rem;">${run.hop_host || '-'}</td>
          <td style="max-width: 250px; ${noteStyle}" title="${escapeHtml(run.note || '')}">${escapeHtml(run.note || '-')}</td>
          <td>
            <div class="flex-gap-2" style="white-space: nowrap; justify-content: center;">
              <button class="btn btn-secondary btn-sm" onclick="filterLogsByRun(${run.run_id})" title="Lihat detail log langkah dan error sesi ini">
                Lihat Logs
              </button>
              ${(isFailed && !isSuperseded) ? `
                <button class="btn btn-warning btn-sm" onclick="resumeWorkflow(${run.run_id}, '${isPostFailed ? 'flow_2_post' : (run.main_workflow || 'flow_1_staging')}', '${run.config_id || ''}')" title="${isPostFailed ? 'Lanjutkan eksekusi posting Flow 2 untuk sesi ini' : 'Lanjutkan proses pada sesi Run #' + run.run_id}">
                  ▶️ ${isPostFailed ? 'Lanjutkan Post (Flow 2)' : 'Lanjutkan'}
                </button>
                <button class="btn btn-secondary btn-sm" style="color: #ef4444; border-color: rgba(239, 68, 68, 0.35);" onclick="cancelWorkflowRun(${run.run_id})" title="Batalkan status sesi gagal ini (tandai CANCELLED)">
                  🚫 Cancel
                </button>
              ` : ''}
            </div>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-rose">${err.message}</td></tr>`;
  }
}

/**
 * Dialog Konfirmasi Eksekusi Ulang / Lanjutkan Alur (Task 1)
 */
window.openRerunConfirmModal = function (opts = {}) {
  const modal = document.getElementById('modal-rerun-confirm');
  if (!modal) {
    if (confirm(opts.message || 'Apakah Anda yakin ingin mengeksekusi alur ini?')) {
      if (typeof opts.onProceed === 'function') opts.onProceed();
    }
    return;
  }

  const titleEl = document.getElementById('rerun-modal-title');
  const msgEl = document.getElementById('rerun-modal-msg');
  const detailsEl = document.getElementById('rerun-modal-details');
  const btnProceed = document.getElementById('btn-rerun-proceed');
  const btnLabel = document.getElementById('rerun-modal-btn-label');
  const btnCancel = document.getElementById('btn-rerun-cancel');
  const btnClose = document.getElementById('btn-close-rerun-modal');

  if (titleEl) titleEl.textContent = opts.title || (opts.isResume ? 'Konfirmasi Lanjutkan Sesi' : 'Konfirmasi Eksekusi Ulang Alur');
  if (msgEl) msgEl.textContent = opts.message || (opts.isResume ? `Apakah Anda yakin ingin melanjutkan eksekusi pada Run #${opts.runId}?` : `Apakah Anda yakin ingin mengeksekusi ulang alur ini?`);
  if (btnLabel) btnLabel.textContent = opts.btnLabel || (opts.isResume ? 'Ya, Lanjutkan' : 'Ya, Jalankan Ulang');

  if (detailsEl) {
    detailsEl.innerHTML = `
      <div><strong>Workflow:</strong> <span class="text-cyan font-bold">${escapeHtml(opts.workflowId || 'flow_1_staging')}</span></div>
      ${opts.runId ? `<div><strong>Run ID Sesi:</strong> <span class="text-amber font-bold">#${opts.runId}</span></div>` : ''}
      ${opts.configId ? `<div><strong>Target Config:</strong> <span class="text-emerald font-bold">#${escapeHtml(String(opts.configId))}</span></div>` : ''}
      <div class="mt-2 text-xs" style="color: #94a3b8; border-top: 1px dashed rgba(148, 163, 184, 0.2); padding-top: 4px;">
        ${opts.isResume 
          ? '⚠️ Mode Resume: Proses akan melanjutkan tahapan yang tersisa tanpa membuat ID sesi baru.' 
          : 'ℹ️ Parameter alur akan disiapkan di Flow Canvas Studio untuk eksekusi baru.'}
      </div>
    `;
  }

  modal.classList.remove('hidden');

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    btnProceed?.removeEventListener('click', onConfirm);
    btnCancel?.removeEventListener('click', onDismiss);
    btnClose?.removeEventListener('click', onDismiss);
  };

  const onDismiss = () => {
    modal.classList.add('hidden');
    cleanup();
  };

  const onConfirm = () => {
    modal.classList.add('hidden');
    cleanup();
    if (typeof opts.onProceed === 'function') {
      opts.onProceed();
    }
  };

  btnProceed?.addEventListener('click', onConfirm);
  btnCancel?.addEventListener('click', onDismiss);
  btnClose?.addEventListener('click', onDismiss);
};

window.resumeWorkflow = function (runId, workflowId, configId) {
  openRerunConfirmModal({
    title: 'Konfirmasi Lanjutkan Sesi',
    message: `Lanjutkan proses pada Run ID #${runId}?`,
    workflowId,
    configId,
    runId,
    isResume: true,
    btnLabel: 'Ya, Lanjutkan',
    onProceed: () => {
      if (state.activeTab !== 'tab-canvas') {
        switchMainTab('tab-canvas');
      }
      if (window.flowCanvasStudio) {
        if (workflowId) {
          window.flowCanvasStudio.loadPreset(workflowId);
        }
        setTimeout(async () => {
          try {
            await window.flowCanvasStudio.resumeFlow(runId, workflowId, configId);
          } catch (err) {
            if (typeof showToast === 'function') {
              showToast(`Gagal melanjutkan alur: ${err.message}`, 'error');
            } else {
              alert(`Gagal melanjutkan alur: ${err.message}`);
            }
          }
        }, 200);
      }
    }
  });
};

window.rerunWorkflow = function (workflowId, configId, runId = null) {
  openRerunConfirmModal({
    title: 'Konfirmasi Run Ulang Alur',
    message: `Jalankan ulang alur "${workflowId || 'flow_1_staging'}" untuk konfigurasi #${configId || '?'}?`,
    workflowId,
    configId,
    runId,
    isResume: false,
    btnLabel: 'Ya, Jalankan Ulang',
    onProceed: () => {
      if (state.activeTab !== 'tab-canvas') {
        switchMainTab('tab-canvas');
      }
      if (window.flowCanvasStudio) {
        if (workflowId) {
          window.flowCanvasStudio.loadPreset(workflowId);
        }
        setTimeout(() => {
          window.flowCanvasStudio.openExecutionParamsModal(configId || null);
        }, 150);
      }
    }
  });
};

window.cancelWorkflowRun = function (runId) {
  openGeneralConfirmModal({
    title: 'Konfirmasi Pembatalan Sesi',
    message: `Apakah Anda yakin ingin membatalkan sesi Run #${runId}?`,
    submessage: 'Status sesi gagal ini akan diubah menjadi CANCELLED dan tidak dapat di-resume lagi.',
    proceedLabel: 'Ya, Batalkan Sesi',
    proceedClass: 'btn-danger',
    onConfirm: async () => {
      try {
        const res = await fetch(`/api/etl/runs/${runId}/cancel`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Gagal membatalkan sesi.');
        }
        if (typeof showToast === 'function') {
          showToast(`Sesi Run #${runId} berhasil dibatalkan.`, 'success');
        } else {
          alert(`Sesi Run #${runId} berhasil dibatalkan.`);
        }
        if (typeof loadMigrationRunsTable === 'function') {
          await loadMigrationRunsTable();
        }
        if (typeof loadEtlOverview === 'function') {
          await loadEtlOverview();
        }
      } catch (err) {
        if (typeof showToast === 'function') {
          showToast(`Gagal membatalkan sesi: ${err.message}`, 'error');
        } else {
          alert(`Gagal membatalkan sesi: ${err.message}`);
        }
      }
    },
  });
};

window.filterLogsByRun = function (runId) {
  state.process.selectedRunId = runId;

  if (state.activeTab !== 'tab-canvas') {
    switchMainTab('tab-canvas');
  }

  const stepDesc = document.getElementById('steplogs-filter-desc');
  if (stepDesc) stepDesc.innerHTML = `Menampilkan log langkah untuk <strong>Run #${runId}</strong>`;
  document.getElementById('btn-clear-step-filter')?.classList.remove('hidden');

  const errDesc = document.getElementById('errorlogs-filter-desc');
  if (errDesc) errDesc.innerHTML = `Menampilkan log error untuk <strong>Run #${runId}</strong>`;
  document.getElementById('btn-clear-error-filter')?.classList.remove('hidden');

  switchCanvasBottomTab('canvas-tab-steplogs');
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

    renderPaginationNumbers('steplogs-page-numbers', curPage, sState.totalPages, (newPage) => {
      sState.page = newPage;
      loadStepLogs();
    });

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

    renderPaginationNumbers('errorlogs-page-numbers', curPage, eState.totalPages, (newPage) => {
      eState.page = newPage;
      loadErrorLogs();
    });

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

function renderActionStatusBadge(actionStatus, postedAt, rolledBackAt) {
  if (actionStatus === 'POSTED') {
    const titleStr = postedAt ? `Sudah diposting ke target (${formatDate(postedAt)})` : 'Sudah diposting ke target vendor';
    return `<span class="badge badge-success font-bold" title="${titleStr}" style="font-size: 0.78rem;">🚀 Posted</span>`;
  }
  if (actionStatus === 'STAGING' || actionStatus === 'STAGING_ONLY' || actionStatus === 'STAGING ONLY') {
    return `<span class="badge badge-info font-bold" title="Tahap Staging selesai sukses, siap untuk diposting ke target" style="font-size: 0.78rem;">📥 Staging Only</span>`;
  }
  if (actionStatus === 'NOT_POSTED' || actionStatus === 'NO_POSTED') {
    return `<span class="badge badge-warning font-bold" title="Tidak ada baris data yang diposting ke target" style="font-size: 0.78rem;">📦 No Posted</span>`;
  }
  if (actionStatus === 'ROLLED_BACK') {
    const titleStr = rolledBackAt ? `Data di-rollback dari target (${formatDate(rolledBackAt)})` : 'Data di-rollback dari target';
    return `<span class="badge badge-danger font-bold" title="${titleStr}" style="font-size: 0.78rem;">↩️ Rolled Back</span>`;
  }
  return `<span class="badge badge-neutral" style="font-size: 0.78rem;">-</span>`;
}

function renderPipelineMasterRows(pipelines) {
  const masterTbody = document.getElementById('pipeline-master-tbody');
  if (!masterTbody) return;

  const rawList = pipelines || state.pipeline.pipelines || [];
  if (!rawList || rawList.length === 0) {
    masterTbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-muted">Belum ada data konfigurasi di migration_config untuk environment ini.</td></tr>`;
    const rangeEl = document.getElementById('info-pipe-master-range');
    const totalEl = document.getElementById('info-pipe-master-total');
    if (rangeEl) rangeEl.textContent = '0-0';
    if (totalEl) totalEl.textContent = '0';
    const pageNumEl = document.getElementById('pipe-master-page-numbers');
    if (pageNumEl) pageNumEl.innerHTML = '';
    const prevBtn = document.getElementById('btn-pipe-master-prev');
    const nextBtn = document.getElementById('btn-pipe-master-next');
    if (prevBtn) prevBtn.disabled = true;
    if (nextBtn) nextBtn.disabled = true;
    return;
  }

  // 1. Sorting
  const sortBy = state.pipeline.masterSortBy || 'configId';
  const sortDir = state.pipeline.masterSortDir || 'ASC';

  const sorted = [...rawList].sort((a, b) => {
    let valA, valB;
    if (sortBy === 'configId') {
      valA = Number(a.configId) || 0;
      valB = Number(b.configId) || 0;
    } else if (sortBy === 'execOrder') {
      valA = Number(a.execOrder) || 0;
      valB = Number(b.execOrder) || 0;
    } else if (sortBy === 'sourceView') {
      valA = `${a.source?.schema || ''}.${a.source?.view || ''}`.toLowerCase();
      valB = `${b.source?.schema || ''}.${b.source?.view || ''}`.toLowerCase();
    } else if (sortBy === 'stagingTable') {
      valA = (a.staging?.table || '').toLowerCase();
      valB = (b.staging?.table || '').toLowerCase();
    } else if (sortBy === 'targetTable') {
      valA = (a.targets?.[0]?.table || a.target?.table || '').toLowerCase();
      valB = (b.targets?.[0]?.table || b.target?.table || '').toLowerCase();
    } else if (sortBy === 'sumSource') {
      valA = Number(a.targets?.[0]?.sumSource ?? a.source?.rows ?? 0);
      valB = Number(b.targets?.[0]?.sumSource ?? b.source?.rows ?? 0);
    } else if (sortBy === 'sumStaging') {
      valA = Number(a.targets?.[0]?.sumStaging ?? a.staging?.rows ?? 0);
      valB = Number(b.targets?.[0]?.sumStaging ?? b.staging?.rows ?? 0);
    } else if (sortBy === 'sumBefore') {
      valA = Number(a.targets?.[0]?.sumBefore ?? 0);
      valB = Number(b.targets?.[0]?.sumBefore ?? 0);
    } else if (sortBy === 'sumAfter') {
      valA = Number(a.targets?.[0]?.sumAfter ?? a.target?.rows ?? 0);
      valB = Number(b.targets?.[0]?.sumAfter ?? b.target?.rows ?? 0);
    } else if (sortBy === 'lastRunId') {
      valA = Number(a.targets?.[0]?.lastRunId || a.latestRun?.run_id || 0);
      valB = Number(b.targets?.[0]?.lastRunId || b.latestRun?.run_id || 0);
    } else if (sortBy === 'status') {
      valA = a.reconciliation?.sourceToStagingStatus === 'MATCH' ? 1 : 0;
      valB = b.reconciliation?.sourceToStagingStatus === 'MATCH' ? 1 : 0;
    } else if (sortBy === 'errors') {
      valA = Number(a.reconciliation?.errorsLogged || 0);
      valB = Number(b.reconciliation?.errorsLogged || 0);
    } else {
      valA = a[sortBy];
      valB = b[sortBy];
    }

    if (valA < valB) return sortDir === 'ASC' ? -1 : 1;
    if (valA > valB) return sortDir === 'ASC' ? 1 : -1;
    return 0;
  });

  // Update header indicators
  document.querySelectorAll('#pipeline-master-table th.sortable').forEach(th => {
    const col = th.getAttribute('data-pipe-col');
    th.classList.remove('sorted-asc', 'sorted-desc');
    const icon = th.querySelector('.sort-icon');
    if (col === sortBy) {
      th.classList.add(sortDir === 'ASC' ? 'sorted-asc' : 'sorted-desc');
      if (icon) icon.textContent = sortDir === 'ASC' ? '▲' : '▼';
    } else {
      if (icon) icon.textContent = '↕';
    }
  });

  // 2. Pagination
  const total = sorted.length;
  const limit = state.pipeline.masterLimit || 10;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (state.pipeline.masterPage > totalPages) {
    state.pipeline.masterPage = totalPages;
  }
  const curPage = state.pipeline.masterPage || 1;
  const startIdx = (curPage - 1) * limit;
  const endIdx = Math.min(startIdx + limit, total);
  const pagedList = sorted.slice(startIdx, endIdx);

  // Update range and total info
  const rangeEl = document.getElementById('info-pipe-master-range');
  const totalEl = document.getElementById('info-pipe-master-total');
  if (rangeEl) rangeEl.textContent = total > 0 ? `${startIdx + 1}-${endIdx}` : '0-0';
  if (totalEl) totalEl.textContent = formatNumber(total);

  // Render Page Numbers
  renderPaginationNumbers('pipe-master-page-numbers', curPage, totalPages, (newPage) => {
    state.pipeline.masterPage = newPage;
    renderPipelineMasterRows(state.pipeline.pipelines);
  });

  const prevBtn = document.getElementById('btn-pipe-master-prev');
  const nextBtn = document.getElementById('btn-pipe-master-next');
  if (prevBtn) prevBtn.disabled = curPage <= 1;
  if (nextBtn) nextBtn.disabled = curPage >= totalPages;

  // 3. Render Table Rows
  masterTbody.innerHTML = pagedList.map((p) => {
    const isSelected = p.configId === state.pipeline.selectedConfigId;
    const targets = (p.targets && p.targets.length > 0) ? p.targets : [{
      schema: p.target?.schema || 'vendor',
      table: p.target?.table || '-',
      sumSource: p.source?.rows ?? 0,
      sumStaging: p.staging?.rows ?? 0,
      sumBefore: 0,
      sumAfter: p.target?.rows ?? 0,
      lastRunId: p.latestRun?.run_id || null,
      actionStatus: 'NONE',
    }];
    const spanCount = targets.length;
    const isMatch = p.reconciliation?.sourceToStagingStatus === 'MATCH';
    let statusBadge = '';
    const srcCount = Number(p.source?.rows ?? 0);
    const stgCount = Number(p.staging?.rows ?? 0);
    const isAnyNotPosted = targets.some(t => t.actionStatus === 'NOT_POSTED' || t.actionStatus === 'NO_POSTED');
    const isStagingOnly = targets.every(t => t.actionStatus === 'STAGING' || t.actionStatus === 'STAGING_ONLY' || t.actionStatus === 'STAGING ONLY');
    const isAllPosted = targets.every(t => t.actionStatus === 'POSTED');

    if (isMatch && (isAllPosted || isStagingOnly)) {
      statusBadge = `<span class="badge badge-success font-bold" style="font-size: 0.78rem;">✓ 100% Match</span>`;
    } else if (stgCount === 0 || (isAnyNotPosted && targets.every(t => (t.sumAfter ?? 0) === (t.sumBefore ?? 0)))) {
      statusBadge = `<span class="badge badge-danger font-bold" style="font-size: 0.78rem;">0% Match</span>`;
    } else if (srcCount > 0) {
      const pct = Math.min(100, Math.max(0, Math.round((stgCount / srcCount) * 100)));
      if (pct === 0) {
        statusBadge = `<span class="badge badge-danger font-bold" style="font-size: 0.78rem;">0% Match</span>`;
      } else if (pct === 100) {
        statusBadge = `<span class="badge badge-success font-bold" style="font-size: 0.78rem;">✓ 100% Match</span>`;
      } else {
        statusBadge = `<span class="badge badge-warning font-bold" style="font-size: 0.78rem;">⏳ ${pct}% Match</span>`;
      }
    } else {
      statusBadge = `<span class="badge badge-warning font-bold" style="font-size: 0.78rem;">⏳ Selisih</span>`;
    }

    const errorCount = p.reconciliation?.errorsLogged || 0;
    const errorClass = errorCount > 0 ? 'text-rose font-bold' : 'text-muted';
    const errorText = errorCount > 0 ? `${errorCount} errors` : '0 errors';

    return targets.map((t, idx) => {
      const isFirst = idx === 0;
      const actionBadge = renderActionStatusBadge(t.actionStatus, t.postedAt, t.rolledBackAt);

      const firstCols = isFirst ? `
        <td class="font-mono font-bold text-center pipeline-merge-cell" rowspan="${spanCount}">
          #${p.configId}
          ${p.nameConfig ? `<div class="text-xs text-white font-semibold mt-0.5">${escapeHtml(p.nameConfig)}</div>` : ''}
        </td>
        <td class="font-mono text-center pipeline-merge-cell" rowspan="${spanCount}">${p.execOrder}</td>
        <td class="pipeline-merge-cell" rowspan="${spanCount}"><strong class="text-cyan">[${p.source.schema}].[${p.source.view}]</strong></td>
        <td class="pipeline-merge-cell" rowspan="${spanCount}"><strong class="text-amber">stg_antam.${p.staging.table}</strong></td>
      ` : '';

      return `
        <tr class="${isSelected ? 'active-row' : ''} ${isFirst ? 'pipeline-row-start' : 'pipeline-row-child'}" data-config-id="${p.configId}">
          ${firstCols}
          <td><strong class="text-emerald">${t.schema}.${t.table}</strong></td>
          <td class="font-mono text-center font-bold text-emerald">${t.sumSource !== null && t.sumSource !== undefined ? formatNumber(t.sumSource) : (p.source.rows !== undefined ? formatNumber(p.source.rows) : '-')}</td>
          <td class="font-mono text-center font-bold text-emerald">${t.sumStaging !== null && t.sumStaging !== undefined ? formatNumber(t.sumStaging) : (p.staging.rows !== undefined ? formatNumber(p.staging.rows) : '-')}</td>
          <td class="font-mono text-center font-bold text-emerald">${t.sumBefore !== null && t.sumBefore !== undefined ? formatNumber(t.sumBefore) : '<span class="text-muted">-</span>'}</td>
          <td class="font-mono text-center font-bold text-emerald">${t.sumAfter !== null && t.sumAfter !== undefined ? formatNumber(t.sumAfter) : '<span class="text-muted">-</span>'}</td>
          <td class="font-mono text-center font-bold text-emerald">${t.lastRunId ? t.lastRunId : '-'}</td>
          <td class="text-center">${actionBadge}</td>
          <td class="text-center">${statusBadge}</td>
          <td class="text-center"><span class="${errorClass}">${errorText}</span></td>
          <td class="text-center">
            <div style="display: inline-flex; align-items: center; justify-content: center; gap: 4px;">
              <button class="btn btn-secondary btn-xs" onclick="openPipelineInspectorModal(${p.configId}, '${t.table}')" title="Buka dialog peninjauan alur &amp; data tahap">Tinjau</button>
              <button class="btn btn-compare-pipeline btn-xs" onclick="openPipelineCompareModal(${p.configId}, '${t.table}', ${t.lastRunId ? `'${t.lastRunId}'` : 'null'})" title="Komparasi kolom 3-Tier &amp; evaluasi sukses migrasi (Run: #${t.lastRunId || '-'})">⚖️ Compare</button>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }).join('');
}

async function loadPipelineReconciliation(force = false) {
  const masterTbody = document.getElementById('pipeline-master-tbody');
  const refreshBtn = document.getElementById('btn-refresh-pipeline');

  // FAST PATH: Jika sudah ada data di memory (Stale-While-Revalidate), langsung tampilkan 0 milidetik
  if (state.pipeline.pipelines && state.pipeline.pipelines.length > 0) {
    renderPipelineMasterRows(state.pipeline.pipelines);
  } else {
    masterTbody.innerHTML = `<tr><td colspan="14" class="text-center py-6 text-muted"><span class="loading-spinner"></span> Mengambil data rekonsiliasi konfigurasi...</td></tr>`;
  }

  if (refreshBtn) refreshBtn.classList.add('loading');

  try {
    const params = [];
    if (state.selectedClientId) params.push(`clientId=${state.selectedClientId}`);
    if (state.selectedEnvId) params.push(`envId=${state.selectedEnvId}`);
    if (force) params.push('force=true');
    const qs = params.length > 0 ? `?${params.join('&')}` : '';

    const res = await fetch(`/api/reconciliation/pipeline${qs}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    state.pipeline.pipelines = data.pipelines;

    if (data.pipelines.length === 0) {
      masterTbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-muted">Belum ada data konfigurasi di migration_config untuk environment ini.</td></tr>`;
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

    renderPipelineMasterRows(data.pipelines);

    const targetConfigId = (state.pipeline.selectedConfigId && data.pipelines.some((x) => x.configId === state.pipeline.selectedConfigId))
      ? state.pipeline.selectedConfigId
      : data.pipelines[0].configId;
    state.pipeline.selectedConfigId = targetConfigId;
  } catch (err) {
    if (!state.pipeline.pipelines || state.pipeline.pipelines.length === 0) {
      masterTbody.innerHTML = `<tr><td colspan="14" class="text-center py-8 text-rose">${err.message}</td></tr>`;
    }
  } finally {
    if (refreshBtn) refreshBtn.classList.remove('loading');
  }
}

window.openPipelineInspectorModal = function (configId, targetTableName) {
  selectPipelineConfig(configId, targetTableName);
  const modal = document.getElementById('modal-pipeline-inspector');
  if (modal) {
    const cfgBadge = document.getElementById('pipeline-modal-cfg-badge');
    if (cfgBadge) cfgBadge.textContent = `Config #${configId}`;
    modal.classList.remove('hidden');
  }
};

window.closePipelineInspectorModal = function () {
  const modal = document.getElementById('modal-pipeline-inspector');
  if (modal) {
    modal.classList.add('hidden');
  }
};

window.selectPipelineConfig = function (configId, targetTableName) {
  state.pipeline.selectedConfigId = configId;
  state.pipeline.sortBy = null;
  state.pipeline.sortDir = 'ASC';
  if (targetTableName) {
    state.pipeline.selectedTargetTable = targetTableName;
  }
  document.querySelectorAll('#pipeline-master-tbody tr').forEach((tr) => tr.classList.remove('active-row'));
  document.querySelectorAll(`#pipeline-master-tbody tr[data-config-id="${configId}"]`).forEach((tr) => tr.classList.add('active-row'));

  const p = state.pipeline.pipelines.find((x) => x.configId === configId);
  if (!p) return;

  const activeTarget = (targetTableName && p.targets)
    ? (p.targets.find((t) => t.table === targetTableName) || p.targets[0] || p.target)
    : (p.targets?.[0] || p.target);

  document.getElementById('pipeline-detail-title').textContent = `Detail Pipeline: Config #${p.configId} (${p.source.view})`;
  document.getElementById('pipeline-detail-desc').textContent = `Alur rekonsiliasi: [${p.source.schema}].[${p.source.view}] ➔ stg_antam.${p.staging.table} ➔ ${activeTarget.schema}.${activeTarget.table}`;

  const delta1 = p.reconciliation.deltaSourceToStaging;
  const isMatch = p.reconciliation.sourceToStagingStatus === 'MATCH';
  document.getElementById('pipeline-detail-badges').innerHTML = `
    <span class="badge ${isMatch ? 'badge-success' : 'badge-warning'}">${isMatch ? '✓ Source ➔ Staging Sinkron' : '⏳ Ada Selisih'}</span>
    <span class="badge ${p.isActive ? 'badge-neutral' : 'badge-danger'}">${p.isActive ? 'Status: Active' : 'Status: Inactive'}</span>
  `;

  const srcRows = p.source.rows ?? 0;
  const stgRows = p.staging.rows ?? 0;
  const tgtRows = activeTarget.sumAfter ?? p.target.rows ?? 0;
  const delta2 = tgtRows - stgRows;

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
      <div class="node-table-name">${activeTarget.schema}.${activeTarget.table}</div>
      <div class="node-rows-val">${formatNumber(tgtRows)}</div>
      <div class="node-db-meta">Database: ${p.target.database || 'PostgreSQL'}</div>
    </div>
  `;

  // Hubungkan tombol Cetak Berita Acara di dalam modal dengan config terpilih
  const btnOpenBa = document.getElementById('btn-open-ba');
  if (btnOpenBa) {
    btnOpenBa.onclick = () => openBeritaAcara(configId);
  }

  state.pipeline.page = 1;
  loadPipelineStageData();
};

async function loadPipelineStageData() {
  const configId = state.pipeline.selectedConfigId;
  const stage = state.pipeline.selectedStage;
  const targetParam = (stage === 'target' && state.pipeline.selectedTargetTable)
    ? `&targetTable=${encodeURIComponent(state.pipeline.selectedTargetTable)}`
    : '';

  document.querySelectorAll('.stage-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-stage') === stage);
  });

  const thead = document.getElementById('stage-data-thead');
  const tbody = document.getElementById('stage-data-tbody');

  thead.innerHTML = `<tr><th class="text-center py-8 text-muted">Memuat baris data ${stage}...</th></tr>`;
  tbody.innerHTML = `<tr><td class="text-center py-8 text-muted">Mengambil data dari database...</td></tr>`;

  try {
    const sortParam = state.pipeline.sortBy 
      ? `&sortBy=${encodeURIComponent(state.pipeline.sortBy)}&sortDir=${encodeURIComponent(state.pipeline.sortDir || 'ASC')}` 
      : '';
    const url = `/api/reconciliation/stage-data?configId=${configId}&stage=${stage}&page=${state.pipeline.page}&limit=${state.pipeline.limit}${targetParam}${sortParam}`;
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
        <th style="width: 45px; text-align: center;">#</th>
        ${data.columns.map((c) => {
          const isSorted = state.pipeline.sortBy && state.pipeline.sortBy.toLowerCase() === c.name.toLowerCase();
          const sortIcon = isSorted ? (state.pipeline.sortDir === 'ASC' ? '▲' : '▼') : '↕';
          const sortClass = isSorted ? (state.pipeline.sortDir === 'ASC' ? 'sorted-asc' : 'sorted-desc') : '';
          return `
            <th class="sortable ${sortClass}" onclick="window.sortStageData('${escapeHtml(c.name)}')" title="Klik untuk mengurutkan kolom ${escapeHtml(c.name)}" style="cursor: pointer; user-select: none;">
              <div style="display: flex; align-items: center; justify-content: space-between; gap: 6px;">
                <span>${escapeHtml(c.name)} <span class="text-muted" style="font-size: 0.65rem;">(${escapeHtml(c.type)})</span></span>
                <span class="sort-icon" style="font-size: 0.72rem; opacity: ${isSorted ? '1' : '0.4'};">${sortIcon}</span>
              </div>
            </th>
          `;
        }).join('')}
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
      return `<tr><td class="font-mono text-muted text-center">${rowNum}</td>${cells}</tr>`;
    }).join('');
  } catch (err) {
    thead.innerHTML = `<tr><th class="text-center py-8 text-rose">Gagal memuat data</th></tr>`;
    tbody.innerHTML = `<tr><td class="text-center py-8 text-rose">${escapeHtml(err.message)}</td></tr>`;
  }
}

window.sortStageData = function (colName) {
  if (state.pipeline.sortBy && state.pipeline.sortBy.toLowerCase() === colName.toLowerCase()) {
    state.pipeline.sortDir = state.pipeline.sortDir === 'ASC' ? 'DESC' : 'ASC';
  } else {
    state.pipeline.sortBy = colName;
    state.pipeline.sortDir = 'ASC';
  }
  state.pipeline.page = 1;
  loadPipelineStageData();
};

// =========================================================================
// MODUL 4: 3-TIER COLUMN & STATUS COMPARATOR (COMPARE ACTION)
// =========================================================================

function initCompareModalEvents() {
  const btnClose = document.getElementById('btn-close-pipeline-compare');
  if (btnClose) btnClose.addEventListener('click', closePipelineCompareModal);

  const btnCloseFooter = document.getElementById('btn-close-pipeline-compare-footer');
  if (btnCloseFooter) btnCloseFooter.addEventListener('click', closePipelineCompareModal);

  const btnRefresh = document.getElementById('btn-refresh-compare');
  if (btnRefresh) {
    btnRefresh.addEventListener('click', () => {
      if (state.compare.selectedConfigId) {
        loadPipelineComparison(state.compare.selectedConfigId, state.compare.selectedTargetTable, state.compare.selectedRunId);
      }
    });
  }

  const selTarget = document.getElementById('compare-target-select');
  if (selTarget) {
    selTarget.addEventListener('change', (e) => {
      const tgt = e.target.value;
      state.compare.selectedTargetTable = tgt;
      if (state.compare.selectedConfigId) {
        loadPipelineComparison(state.compare.selectedConfigId, tgt, state.compare.selectedRunId);
      }
    });
  }

  const selRun = document.getElementById('compare-run-select');
  if (selRun) {
    selRun.addEventListener('change', (e) => {
      const runVal = e.target.value;
      state.compare.selectedRunId = runVal || null;
      if (state.compare.selectedConfigId) {
        loadPipelineComparison(state.compare.selectedConfigId, state.compare.selectedTargetTable, state.compare.selectedRunId);
      }
    });
  }
}

window.openPipelineCompareModal = function (configId, targetTableName, runId) {
  state.compare.selectedConfigId = configId;
  state.compare.selectedTargetTable = targetTableName || null;
  state.compare.selectedRunId = runId || null;
  state.compare.activeTab = 'matrix';
  state.compare.filterStatus = 'ALL';
  state.compare.searchQuery = '';

  const modal = document.getElementById('modal-pipeline-compare');
  if (!modal) return;

  const cfgBadge = document.getElementById('compare-modal-cfg-badge');
  if (cfgBadge) cfgBadge.textContent = `Config #${configId}`;

  const runBadge = document.getElementById('compare-modal-run-badge');
  if (runBadge) {
    runBadge.textContent = runId ? `Run: #${runId}` : 'Run: -';
  }

  const searchInput = document.getElementById('filter-cmp-col-input');
  if (searchInput) searchInput.value = '';

  switchCompareTab('matrix');
  modal.classList.remove('hidden');

  loadPipelineComparison(configId, targetTableName, runId);
};

window.closePipelineCompareModal = function () {
  const modal = document.getElementById('modal-pipeline-compare');
  if (modal) modal.classList.add('hidden');
};

window.switchCompareTab = function (tabName) {
  state.compare.activeTab = tabName;

  document.querySelectorAll('#modal-pipeline-compare .sub-tab-btn').forEach((btn) => {
    btn.classList.remove('active');
  });

  const activeBtn = document.getElementById(`btn-cmp-tab-${tabName}`);
  if (activeBtn) activeBtn.classList.add('active');

  const panes = ['matrix', 'samples', 'audit'];
  panes.forEach((p) => {
    const paneEl = document.getElementById(`cmp-pane-${p}`);
    if (paneEl) paneEl.style.display = p === tabName ? 'block' : 'none';
  });
};

async function loadPipelineComparison(configId, targetTableName, runId) {
  const verdictContainer = document.getElementById('compare-verdict-container');
  const matrixTbody = document.getElementById('cmp-matrix-tbody');

  if (verdictContainer) {
    verdictContainer.innerHTML = `
      <div class="verdict-hero-card verdict-info">
        <div class="flex-center py-4 gap-3 text-cyan">
          <div class="spinner" style="width: 24px; height: 24px; border-width: 2px;"></div>
          <span>Menganalisis keselarasan kolom 3-Tier &amp; menghitung validasi status migrasi...</span>
        </div>
      </div>
    `;
  }
  if (matrixTbody) {
    matrixTbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-muted">Mengambil data perbandingan kolom...</td></tr>`;
  }

  try {
    const targetParam = targetTableName ? `&targetTable=${encodeURIComponent(targetTableName)}` : '';
    const runParam = runId ? `&runId=${encodeURIComponent(runId)}` : '';
    const res = await fetch(`/api/reconciliation/compare?configId=${configId}${targetParam}${runParam}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error || 'Gagal memuat data komparasi');

    const data = json.data;
    state.compare.data = data;
    state.compare.selectedRunId = data.effectiveRunId;

    // Update Header
    const titleEl = document.getElementById('compare-modal-title');
    if (titleEl) {
      titleEl.innerHTML = `Komparasi Kolom &amp; Validasi: <span class="text-cyan">${escapeHtml(data.nameConfig || `Config #${data.configId}`)}</span>`;
    }
    const descEl = document.getElementById('compare-modal-desc');
    if (descEl) {
      descEl.textContent = `Alur: [${data.source.schema}].[${data.source.view}] ➔ ${data.staging.schema}.${data.staging.table} ➔ ${data.target.schema}.${data.target.table}`;
    }
    const tgtBadge = document.getElementById('compare-modal-target-badge');
    if (tgtBadge) {
      tgtBadge.textContent = `Target: ${data.target.schema}.${data.target.table}`;
      tgtBadge.className = `badge ${data.target.exists ? 'badge-success' : 'badge-danger'} text-xs`;
    }
    const runBadge = document.getElementById('compare-modal-run-badge');
    if (runBadge) {
      runBadge.textContent = data.effectiveRunId ? `Run: #${data.effectiveRunId}` : 'Run: -';
      const runStatusClass = data.latestRun?.status === 'SUCCESS' ? 'badge-success' : (data.latestRun?.status === 'FAILED' ? 'badge-danger' : 'badge-neutral');
      runBadge.className = `badge ${runStatusClass} text-xs font-mono`;
      runBadge.title = data.latestRun?.status ? `Status Run: ${data.latestRun.status}` : 'Run ID';
    }

    // Sesi Run switcher dropdown
    const runWrapper = document.getElementById('compare-run-selector-wrapper');
    const runSelect = document.getElementById('compare-run-select');
    if (runWrapper && runSelect) {
      const allRuns = data.availableRuns || [];
      if (allRuns.length > 0) {
        runWrapper.style.display = 'inline-flex';
        runSelect.innerHTML = allRuns.map((r) => {
          const statusIcon = r.status === 'SUCCESS' ? '✓' : (r.status === 'FAILED' ? '✕' : '⏳');
          const isSel = String(r.run_id) === String(data.effectiveRunId);
          return `<option value="${r.run_id}" ${isSel ? 'selected' : ''}>${statusIcon} #${r.run_id} (${r.status || 'RUN'})</option>`;
        }).join('');
      } else {
        runWrapper.style.display = 'none';
      }
    }

    // Target table switcher if multi-target exists
    const targetWrapper = document.getElementById('compare-target-selector-wrapper');
    const targetSelect = document.getElementById('compare-target-select');
    if (targetWrapper && targetSelect) {
      const allTargets = data.target.allTargetConfigs || [];
      if (allTargets.length > 1) {
        targetWrapper.style.display = 'inline-flex';
        targetSelect.innerHTML = allTargets.map((t) => `
          <option value="${escapeHtml(t.tgt_table)}" ${t.tgt_table === data.target.table ? 'selected' : ''}>
            ${escapeHtml(t.tgt_schema || 'vendor')}.${escapeHtml(t.tgt_table)}
          </option>
        `).join('');
      } else {
        targetWrapper.style.display = 'none';
      }
    }

    // Connect footer buttons
    const btnOpenBa = document.getElementById('btn-compare-open-ba');
    if (btnOpenBa) {
      btnOpenBa.onclick = () => {
        closePipelineCompareModal();
        openBeritaAcara(configId);
      };
    }
    const btnOpenInspector = document.getElementById('btn-compare-open-inspector');
    if (btnOpenInspector) {
      btnOpenInspector.onclick = () => {
        closePipelineCompareModal();
        openPipelineInspectorModal(configId, data.target.table);
      };
    }

    // Render all components
    renderCompareVerdict(data);
    renderCompareMatrix(data);
    renderCompareSamples(data);
    renderCompareAudit(data);
  } catch (err) {
    if (verdictContainer) {
      verdictContainer.innerHTML = `
        <div class="verdict-hero-card verdict-danger">
          <div class="text-rose font-bold py-2">Terjadi kesalahan: ${escapeHtml(err.message)}</div>
        </div>
      `;
    }
    if (matrixTbody) {
      matrixTbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-rose">${escapeHtml(err.message)}</td></tr>`;
    }
  }
}

function renderCompareVerdict(data) {
  const container = document.getElementById('compare-verdict-container');
  if (!container) return;

  const v = data.verdict;
  let icon = '✅';
  let heroClass = 'verdict-success';

  if (v.level === 'WARNING') {
    icon = '⏳';
    heroClass = 'verdict-warning';
  } else if (v.level === 'FAILED') {
    icon = '❌';
    heroClass = 'verdict-danger';
  } else if (v.level === 'STAGING_ONLY') {
    icon = '📦';
    heroClass = 'verdict-info';
  }

  // Row Count Reconciliation details
  const srcN = data.source.rowsCount;
  const stgN = data.staging.rowsCount;
  const tgtN = data.target.rowsCount;
  const isRowSync = srcN === stgN && srcN > 0;
  const rowDeltaBadge = isRowSync 
    ? `<span class="badge badge-success text-xs font-bold">✓ Match 100%</span>`
    : `<span class="badge badge-warning text-xs font-bold">Selisih ${Math.abs(stgN - srcN)} baris</span>`;

  // Mapped coverage percentage
  const totalTgt = data.metrics.totalTargetCols || 1;
  const mappedTgt = data.metrics.mappedTargetCols || 0;
  const coveragePct = Math.round((mappedTgt / totalTgt) * 100);

  container.innerHTML = `
    <div class="verdict-hero-card ${heroClass}">
      <div class="verdict-header-row">
        <div class="verdict-title-group">
          <div class="verdict-icon-bubble">${icon}</div>
          <div>
            <h4 class="verdict-main-title">
              <span>${escapeHtml(v.title)}</span>
              <span class="badge ${v.badgeClass} text-xs">${v.level}</span>
            </h4>
            <div class="verdict-main-subtitle">${escapeHtml(v.subtitle)}</div>
          </div>
        </div>
        <div class="flex-center gap-2">
          <span class="badge badge-neutral text-xs">Run: #${data.latestRun?.run_id || '-'}</span>
          <span class="badge ${data.isActive ? 'badge-success' : 'badge-neutral'} text-xs">${data.isActive ? 'Active' : 'Inactive'}</span>
        </div>
      </div>

      <div class="verdict-metrics-grid">
        <!-- Metric 1: Row Reconciliation -->
        <div class="verdict-metric-item">
          <span class="verdict-metric-label">1. Integritas Jumlah Baris</span>
          <div class="verdict-metric-val">
            <span class="text-cyan">${formatNumber(srcN)}</span>
            <span class="text-muted" style="font-size:0.75rem;">➔</span>
            <span class="text-amber">${formatNumber(stgN)}</span>
            <span class="text-muted" style="font-size:0.75rem;">➔</span>
            <span class="text-emerald">${formatNumber(tgtN)}</span>
          </div>
          <div style="margin-top: 3px;">${rowDeltaBadge}</div>
        </div>

        <!-- Metric 2: Target Column Coverage -->
        <div class="verdict-metric-item">
          <span class="verdict-metric-label">2. Cakupan Kolom Target</span>
          <div class="verdict-metric-val text-emerald">
            <span>${mappedTgt} / ${totalTgt}</span>
            <span style="font-size: 0.8rem; font-weight: normal; color: var(--text-muted);">(${coveragePct}%)</span>
          </div>
          <div class="text-xs text-muted" style="margin-top: 3px;">
            ${coveragePct === 100 ? '<span class="text-emerald font-bold">✓ Semua kolom terpetakan</span>' : `<span class="text-amber">${totalTgt - mappedTgt} kolom unmapped/seed</span>`}
          </div>
        </div>

        <!-- Metric 3: Convert Rules Active -->
        <div class="verdict-metric-item">
          <span class="verdict-metric-label">3. Aturan Konversi (Rule)</span>
          <div class="verdict-metric-val text-cyan">
            <span>${data.metrics.convertRulesActive} Rule</span>
          </div>
          <div class="text-xs text-muted" style="margin-top: 3px;">
            ${data.metrics.convertRulesActive > 0 ? '✓ Lookup & normalisasi aktif' : 'Direct 1:1 schema mapping'}
          </div>
        </div>

        <!-- Metric 4: Error Logs & Health -->
        <div class="verdict-metric-item">
          <span class="verdict-metric-label">4. Audit Log &amp; Error</span>
          <div class="verdict-metric-val ${data.metrics.errorsCount === 0 ? 'text-emerald' : 'text-rose'}">
            <span>${data.metrics.errorsCount} Error Log</span>
          </div>
          <div class="text-xs text-muted" style="margin-top: 3px;">
            ${data.metrics.errorsCount === 0 ? '<span class="text-emerald">✓ Alur migrasi bersih</span>' : '<span class="text-rose font-bold">⚠️ Periksa tab Audit Log</span>'}
          </div>
        </div>
      </div>
    </div>
  `;
}

function renderCompareMatrix(data) {
  const tbody = document.getElementById('cmp-matrix-tbody');
  if (!tbody) return;

  const matrix = data.columnMatrix || [];

  // Update counter badges
  const cntAll = matrix.length;
  const cntMatch = matrix.filter((c) => c.status === 'MATCH').length;
  const cntConv = matrix.filter((c) => c.status === 'CONVERTED' || c.status === 'TYPE_CONVERTED').length;
  const cntWarn = matrix.filter((c) => ['MISSING_REQUIRED', 'UNMAPPED_TARGET', 'UNMAPPED_SOURCE', 'STAGING_EXTRA'].includes(c.status)).length;

  const elAll = document.getElementById('cmp-count-all');
  if (elAll) elAll.textContent = cntAll;
  const elMatch = document.getElementById('cmp-count-match');
  if (elMatch) elMatch.textContent = cntMatch;
  const elConv = document.getElementById('cmp-count-conv');
  if (elConv) elConv.textContent = cntConv;
  const elWarn = document.getElementById('cmp-count-warn');
  if (elWarn) elWarn.textContent = cntWarn;

  // Filter matrix based on current state
  const filter = state.compare.filterStatus;
  const query = (state.compare.searchQuery || '').toLowerCase().trim();

  const filtered = matrix.filter((c) => {
    // Status filter
    if (filter === 'MATCH' && c.status !== 'MATCH') return false;
    if (filter === 'CONVERTED' && !['CONVERTED', 'TYPE_CONVERTED'].includes(c.status)) return false;
    if (filter === 'WARNING' && !['MISSING_REQUIRED', 'UNMAPPED_TARGET', 'UNMAPPED_SOURCE', 'STAGING_EXTRA'].includes(c.status)) return false;

    // Search query
    if (query) {
      const srcName = c.sourceCol?.name?.toLowerCase() || '';
      const stgName = c.stagingCol?.name?.toLowerCase() || '';
      const tgtName = c.targetCol?.name?.toLowerCase() || '';
      const ruleText = c.rule?.lookupName?.toLowerCase() || '';
      return srcName.includes(query) || stgName.includes(query) || tgtName.includes(query) || ruleText.includes(query);
    }
    return true;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center py-8 text-muted">Tidak ada kolom yang cocok dengan kriteria filter saat ini.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map((c, idx) => {
    // Source Col Cell
    let srcCell = `<span class="text-muted font-italic">- (Tidak ada di Source)</span>`;
    if (c.sourceCol) {
      const nullBadge = c.sourceCol.nullable === 'NO' ? `<span class="col-cell-notnull">NOT NULL</span>` : `<span class="col-cell-null">NULL</span>`;
      srcCell = `
        <div>
          <strong class="text-cyan">${escapeHtml(c.sourceCol.name)}</strong>
          ${nullBadge}
          <div class="col-cell-type">${escapeHtml(c.sourceCol.type)}</div>
        </div>
      `;
    }

    // Staging Col Cell
    let stgCell = `<span class="text-muted font-italic">- (Tidak ada di Staging)</span>`;
    if (c.stagingCol) {
      const nullBadge = c.stagingCol.nullable === 'NO' ? `<span class="col-cell-notnull">NOT NULL</span>` : `<span class="col-cell-null">NULL</span>`;
      stgCell = `
        <div>
          <strong class="text-amber">${escapeHtml(c.stagingCol.name)}</strong>
          ${nullBadge}
          <div class="col-cell-type">${escapeHtml(c.stagingCol.type)}</div>
        </div>
      `;
    }

    // Target Col Cell
    let tgtCell = `<span class="text-muted font-italic">- (Tidak masuk Target)</span>`;
    if (c.targetCol) {
      const pkBadge = c.isPk ? `<span class="badge badge-primary" style="font-size:0.6rem; padding: 1px 4px; margin-left: 4px;">PK</span>` : '';
      const nullBadge = c.targetCol.nullable === 'NO' ? `<span class="col-cell-notnull">NOT NULL</span>` : `<span class="col-cell-null">NULL</span>`;
      tgtCell = `
        <div>
          <strong class="text-emerald">${escapeHtml(c.targetCol.name)}</strong>
          ${pkBadge}
          ${nullBadge}
          <div class="col-cell-type">${escapeHtml(c.targetCol.type)}</div>
        </div>
      `;
    }

    // Rule Cell
    let ruleCell = `<span class="text-muted" style="font-size:0.75rem;">Direct (1:1)</span>`;
    if (c.rule) {
      ruleCell = `
        <div style="font-size: 0.75rem;">
          <strong class="text-cyan">${escapeHtml(c.rule.lookupName || 'Convert Rule')}</strong>
          ${c.rule.masterTable ? `<div class="text-muted" style="font-size: 0.68rem;">Tabel: ${escapeHtml(c.rule.masterTable)}</div>` : ''}
          ${c.rule.onUnmapped ? `<div class="text-muted" style="font-size: 0.68rem;">On Unmapped: ${escapeHtml(c.rule.onUnmapped)}</div>` : ''}
        </div>
      `;
    } else if (c.isPk && !c.sourceCol && !c.stagingCol) {
      ruleCell = `<span class="badge badge-primary text-xs">Generated Seed / PK</span>`;
    }

    return `
      <tr>
        <td class="text-center font-mono text-muted">${idx + 1}</td>
        <td>${srcCell}</td>
        <td>${stgCell}</td>
        <td>${tgtCell}</td>
        <td>${ruleCell}</td>
        <td class="text-center">
          <span class="badge ${c.statusBadge}" style="font-size: 0.72rem; white-space: nowrap;">
            ${escapeHtml(c.statusLabel)}
          </span>
        </td>
      </tr>
    `;
  }).join('');
}

window.filterCompareMatrix = function (filterType) {
  state.compare.filterStatus = filterType;
  document.querySelectorAll('.filter-cmp-btn').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-filter') === filterType);
  });
  if (state.compare.data) {
    renderCompareMatrix(state.compare.data);
  }
};

window.handleCompareSearch = function (query) {
  state.compare.searchQuery = query;
  if (state.compare.data) {
    renderCompareMatrix(state.compare.data);
  }
};

function renderCompareSamples(data) {
  const badgeInfo = document.getElementById('cmp-sample-info-badge');
  if (badgeInfo) {
    const srcLen = data.source.sampleRows?.length || 0;
    const stgLen = data.staging.sampleRows?.length || 0;
    const tgtLen = data.target.sampleRows?.length || 0;
    const count = Math.min(5, Math.max(srcLen, stgLen, tgtLen));
    badgeInfo.textContent = tgtLen > 0 
      ? `Menampilkan ${count} Baris Sampel (Target: ${tgtLen} Rekaman Hasil Migrasi)`
      : `Menampilkan ${count} Baris Sampel (Target: Belum Ada Data Termigrasi)`;
  }

  // Tags
  const srcTag = document.getElementById('cmp-sample-src-tag');
  if (srcTag) srcTag.textContent = `[${data.source.schema}].[${data.source.view}]`;

  const stgTag = document.getElementById('cmp-sample-stg-tag');
  if (stgTag) stgTag.textContent = `${data.staging.schema}.${data.staging.table}`;

  const tgtTag = document.getElementById('cmp-sample-tgt-tag');
  if (tgtTag) {
    const hasMigrated = data.target.sampleRows && data.target.sampleRows.length > 0;
    tgtTag.innerHTML = hasMigrated 
      ? `${data.target.schema}.${data.target.table} <span style="margin-left: 4px;">(✓ Termigrasi)</span>`
      : `${data.target.schema}.${data.target.table} <span style="margin-left: 4px;">(Belum Ada Data)</span>`;
    tgtTag.className = `badge ${hasMigrated ? 'badge-success' : 'badge-warning'} text-xs font-bold`;
  }

  // Helper render single sample table
  function populateSampleTable(theadId, tbodyId, cols, rows, emptyHtml) {
    const thead = document.getElementById(theadId);
    const tbody = document.getElementById(tbodyId);
    if (!thead || !tbody) return;

    if (!cols || cols.length === 0) {
      thead.innerHTML = '<tr><th>Kolom</th></tr>';
      tbody.innerHTML = '<tr><td class="text-muted text-center py-4">Tidak ada kolom terdeteksi.</td></tr>';
      return;
    }

    thead.innerHTML = `<tr><th style="width:30px;">#</th>${cols.map((c) => `<th>${escapeHtml(c.name)}</th>`).join('')}</tr>`;

    if (!rows || rows.length === 0) {
      tbody.innerHTML = `<tr><td colspan="${cols.length + 1}" class="text-center py-6 text-muted">${emptyHtml || 'Belum ada baris data.'}</td></tr>`;
      return;
    }

    tbody.innerHTML = rows.map((r, rIdx) => {
      const cells = cols.map((c) => {
        const val = r[c.name];
        if (val === null || val === undefined) return `<td class="text-muted font-italic">NULL</td>`;
        if (typeof val === 'boolean') return `<td><span class="badge ${val ? 'badge-success' : 'badge-danger'} text-xs">${val}</span></td>`;
        return `<td>${escapeHtml(String(val))}</td>`;
      }).join('');
      return `<tr><td class="text-center font-mono text-muted">${rIdx + 1}</td>${cells}</tr>`;
    }).join('');
  }

  populateSampleTable('cmp-sample-src-thead', 'cmp-sample-src-tbody', data.source.columns, data.source.sampleRows);
  populateSampleTable('cmp-sample-stg-thead', 'cmp-sample-stg-tbody', data.staging.columns, data.staging.sampleRows);
  
  const targetEmptyHtml = `
    <div style="padding: 1rem 0;">
      <span class="badge badge-warning text-xs" style="margin-bottom: 6px;">📦 Belum Ada Data Termigrasi</span><br>
      <span class="text-muted text-xs">Belum ada data dari staging yang diposting ke tabel target ini (Status: Staging Only).<br>Gunakan aksi posting untuk memindahkan data ke target vendor.</span>
    </div>
  `;
  populateSampleTable('cmp-sample-tgt-thead', 'cmp-sample-tgt-tbody', data.target.columns, data.target.sampleRows, targetEmptyHtml);
}

function renderCompareAudit(data) {
  const cardsContainer = document.getElementById('cmp-audit-checklist-cards');
  if (cardsContainer) {
    const checklist = data.auditChecklist || [];
    cardsContainer.innerHTML = checklist.map((chk) => {
      let icon = '✓';
      let cardClass = 'pass';
      let badgeClass = 'badge-success';

      if (chk.status === 'WARN') {
        icon = '⚠️';
        cardClass = 'warn';
        badgeClass = 'badge-warning';
      } else if (chk.status === 'FAIL') {
        icon = '✕';
        cardClass = 'fail';
        badgeClass = 'badge-danger';
      } else if (chk.status === 'INFO') {
        icon = 'ℹ';
        cardClass = 'info';
        badgeClass = 'badge-info';
      }

      return `
        <div class="audit-card-item ${cardClass}">
          <div class="audit-card-top">
            <span class="text-xs text-muted font-bold">${escapeHtml(chk.category)}</span>
            <span class="badge ${badgeClass} text-xs font-bold">${chk.status}</span>
          </div>
          <div class="audit-card-title flex-center gap-1" style="justify-content: flex-start;">
            <span>${icon}</span>
            <span>${escapeHtml(chk.title)}</span>
          </div>
          <div class="audit-card-desc">${escapeHtml(chk.message)}</div>
        </div>
      `;
    }).join('');
  }

  // Error Log Table
  const errTbody = document.getElementById('cmp-error-log-tbody');
  if (errTbody) {
    const errs = data.recentErrors || [];
    if (errs.length === 0) {
      errTbody.innerHTML = `<tr><td colspan="4" class="text-emerald text-center py-4">✓ 0 error log. Eksekusi alur migrasi berhasil bersih.</td></tr>`;
    } else {
      errTbody.innerHTML = errs.map((e) => `
        <tr>
          <td class="font-mono text-muted">${formatDate(e.created_at || e.error_time)}</td>
          <td class="font-mono font-bold text-cyan">#${e.run_id || '-'}</td>
          <td>${escapeHtml(e.target_table || '-')}</td>
          <td class="text-rose font-bold">${escapeHtml(e.error_message || e.message || '-')}</td>
        </tr>
      `).join('');
    }
  }

  // Step Log Table
  const stepTbody = document.getElementById('cmp-step-log-tbody');
  if (stepTbody) {
    const steps = data.recentSteps || [];
    if (steps.length === 0) {
      stepTbody.innerHTML = `<tr><td colspan="5" class="text-muted text-center py-4">Belum ada catatan langkah step log.</td></tr>`;
    } else {
      stepTbody.innerHTML = steps.map((s) => `
        <tr>
          <td><strong class="text-cyan">${escapeHtml(s.step_name)}</strong></td>
          <td class="font-mono">${s.rows_before !== null && s.rows_before !== undefined ? formatNumber(s.rows_before) : '-'}</td>
          <td class="font-mono font-bold text-emerald">${s.rows_after !== null && s.rows_after !== undefined ? formatNumber(s.rows_after) : '-'}</td>
          <td><span class="badge ${s.status === 'SUCCESS' || s.status === 'COMPLETED' ? 'badge-success' : 'badge-neutral'} text-xs">${escapeHtml(s.status || 'OK')}</span></td>
          <td class="font-mono text-muted">${formatDate(s.start_time || s.created_at)}</td>
        </tr>
      `).join('');
    }
  }
}

// =========================================================================
// BERITA ACARA RESMI FORMAT SISI — GENERATOR, EDITOR & EXPORT
// =========================================================================

const STANDARD_BA_DEFAULTS = {
  docNo: '033/BA/251253/G300/10.2025',
  datePicker: '2025-10-14',
  dayName: 'Selasa',
  dateWords: 'Empat Belas',
  monthWords: 'Oktober',
  yearWords: 'Dua Ribu Dua Puluh Lima',
  dateFormatted: '14-10-2025',
  migSchedule: 'Selasa, 07 Oktober 2025',
  p1Name: 'RM Hendra Hadiwijaya',
  p1Title: 'Kadiv Kebijakan Keuangan',
  p1Comp: 'PT Sinergi Mitra Investama Tbk',
  p2Name: 'Arief Wicaksono',
  p2Title: 'Project Manager',
  p2Comp: 'PT Sinergi Informatika Semen Indonesia',
  woNo: 'WO/HO-HEAD-25-08-000007',
  woDesc: 'Jasa Implementasi dan Subcription Aplikasi ERP dan HRIS FORCA',
  modName: 'Business Partner',
  rowsBefore: '-',
  rowsAfter: '663',
  rowsNote: 'Terlampir',
  s1Comp: 'PT Sinergi Informatika Semen Indonesia',
  s1Name: 'Tsalitsa Maulida Zahro',
  s1Title: 'Funct. Forca ERP',
  s2Comp: 'PT Sinergi Mitra Investama',
  s2Name: 'Tytys Dwi Saputri',
  s2Title: 'Kadep Akuntansi',
  s3Comp: 'PT Sinergi Informatika Semen Indonesia',
  s3Name: 'Arief Wicaksono',
  s3Title: 'Project Manager',
  s4Comp: 'PT Sinergi Mitra Investama',
  s4Name: 'RM Hendra Hadiwijaya',
  s4Title: 'Kadiv Kebijakan Keuangan',
  showSigs: true,
  includeAtt: true,
  attTitle: '1. Business Partner',
  logoLeftMode: 'antam',
  logoLeftUrl: '',
  logoLeftHeight: 40,
  logoRightMode: 'sisi',
  logoRightUrl: '',
  logoRightHeight: 42
};

// Fallback sample data lampiran jika database belum memiliki data (persis lampiran PDF halaman 3-4)
const SAMPLE_BP_ATTACHMENT_ROWS = [
  { name: 'PT ADHIGUNA MITRA NIAGA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '032721300063000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'ADNAN BUYUNG NASUTION & PARTNERS', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '018165845062000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'PT AGUNG SOLUSI TRANS', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '033240854021000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'AHMAD FARIS MUSTOFA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'NATIONAL ID', idNumber: '725116800525000', taxId: '725116800525000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'PT ARFA EXPLORINDO NUSANTARA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '864434576423000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'PT ARGA BANGUN BANGSA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '022904791013000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'ASSEGAF HAMZAH & PARTNERS', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '020418687062000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'PT BINUANG MITRA BERSAMA BLOK DUA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '709910145732000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'PT BRAVO SATRIA PERKASA (GRAHA BSP)', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '021106182007000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'CAFE GLASS', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '068658749606000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'CAHYO MURTIATMO', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'NATIONAL ID', idNumber: '245373972505000', taxId: '245373972505000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'CIPTA PIRANTI SEJAHTERA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '754067908029000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'CV CITRAMEDIA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '028243830614000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'CV LINTANG MARGA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '738267467604000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'CV LIONA SEJAHTERA', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '030712335606000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'CV TANJUNG DUREN', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '25069378432000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'DANA PENSIUN SEMEN GRESIK (DPSG)', group: 'Affiliated Company', customer: 'Yes', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '011335239641000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'DRS. YULIANTO', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'NATIONAL ID', idNumber: '245449541542000', taxId: '245449541542000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'PT DUTAKOM WIBAWA PUTRA', group: 'Third Party', customer: 'Yes', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'TIN', idNumber: '-', taxId: '017395369631000', taxType: '04_04 - DPP Nilai Lain' },
  { name: 'DWI W RAHMAWATI', group: 'Third Party', customer: 'No', vendor: 'Yes', employee: 'No', salesRep: 'No', buyerDoc: 'NATIONAL ID', idNumber: '086623022612000', taxId: '086623022612000', taxType: '04_04 - DPP Nilai Lain' }
];

// Vector Logo Generators
function getAntamLogoSvg(height = 40) {
  const h = parseInt(height, 10) || 40;
  const w = Math.round((h * 180) / 44);
  const uid = 'antam_grad_' + Math.random().toString(36).substr(2, 6);
  return `
    <svg class="ba-header-logo-svg ba-logo-antam" viewBox="0 0 180 44" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${uid}" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stop-color="#ef4444"/>
          <stop offset="50%" stop-color="#dc2626"/>
          <stop offset="100%" stop-color="#991b1b"/>
        </linearGradient>
      </defs>
      <g transform="translate(3, 4)">
        <polygon points="18,2 36,20 18,38 0,20" fill="url(#${uid})" />
        <polygon points="18,2 36,20 18,20" fill="#dc2626" opacity="0.9"/>
        <polygon points="18,20 36,20 18,38" fill="#991b1b" opacity="0.95"/>
        <polygon points="0,20 18,2 18,20" fill="#f87171" opacity="0.85"/>
        <polygon points="0,20 18,20 18,38" fill="#b91c1c" opacity="0.9"/>
        <polygon points="18,11 26,20 18,29 10,20" fill="#fbbf24" opacity="0.95"/>
      </g>
      <text x="46" y="25" font-family="'Plus Jakarta Sans', Arial, Helvetica, sans-serif" font-weight="900" font-size="20" fill="#0f172a" letter-spacing="1.2">ANTAM</text>
      <text x="47" y="36" font-family="'Plus Jakarta Sans', Arial, Helvetica, sans-serif" font-weight="700" font-size="6.5" fill="#64748b" letter-spacing="1.5">MEMBER OF MIND ID</text>
    </svg>
  `;
}

function getSisiLogoSvg(height = 42) {
  const h = parseInt(height, 10) || 42;
  const w = Math.round((h * 135) / 48);
  const uid = 'sisi_grad_' + Math.random().toString(36).substr(2, 6);
  return `
    <svg class="ba-header-logo-svg ba-sisi-logo" viewBox="0 0 135 48" width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="${uid}" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stop-color="#ea580c"/>
          <stop offset="60%" stop-color="#f97316"/>
          <stop offset="100%" stop-color="#fbbf24"/>
        </linearGradient>
      </defs>
      <path d="M 52 11 C 70 2, 104 2, 131 15 C 117 7, 86 6, 58 13 Z" fill="url(#${uid})"/>
      <path d="M 104 5 C 118 3, 130 6, 134 9 C 126 7, 116 6, 104 6.5 Z" fill="#f59e0b"/>
      <text x="3" y="40" font-family="'Plus Jakarta Sans', Arial, Helvetica, sans-serif" font-weight="900" font-style="italic" font-size="42" fill="#005ba4" letter-spacing="-1">SISI</text>
    </svg>
  `;
}

function renderLogoContent(mode, url, height = 40) {
  if (mode === 'none') return '';
  if (mode === 'antam') return getAntamLogoSvg(height);
  if (mode === 'sisi') return getSisiLogoSvg(height);
  if (mode === 'custom') {
    if (url && url.trim() !== '') {
      return `<img src="${escapeHtml(url.trim())}" class="ba-header-logo-img" style="height:${height}px;" alt="Logo Header" />`;
    }
    return `<div style="font-size:10px;color:#94a3b8;font-style:italic;padding:4px 8px;border:1px dashed #cbd5e1;border-radius:4px;">[Logo Kustom]</div>`;
  }
  return getAntamLogoSvg(height);
}

function getIndonesianDateDetails(dateObj) {
  const days = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const months = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const angkaTerbilang = [
    '', 'Satu', 'Dua', 'Tiga', 'Empat', 'Lima', 'Enam', 'Tujuh', 'Delapan', 'Sembilan',
    'Sepuluh', 'Sebelas', 'Dua Belas', 'Tiga Belas', 'Empat Belas', 'Lima Belas',
    'Enam Belas', 'Tujuh Belas', 'Delapan Belas', 'Sembilan Belas', 'Dua Puluh',
    'Dua Puluh Satu', 'Dua Puluh Dua', 'Dua Puluh Tiga', 'Dua Puluh Empat', 'Dua Puluh Lima',
    'Dua Puluh Enam', 'Dua Puluh Tujuh', 'Dua Puluh Delapan', 'Dua Puluh Sembilan', 'Tiga Puluh',
    'Tiga Puluh Satu'
  ];

  function convertYearToWords(year) {
    const ribs = Math.floor(year / 1000);
    const sisa = year % 1000;
    const pul = sisa % 100;
    let res = (ribs === 2 ? 'Dua Ribu' : ribs === 1 ? 'Seribu' : '');
    if (pul > 0 && pul <= 31) {
      res += ' ' + angkaTerbilang[pul];
    } else if (pul >= 32) {
      const p = Math.floor(pul / 10);
      const s = pul % 10;
      const pWords = ['', 'Sepuluh', 'Dua Puluh', 'Tiga Puluh', 'Empat Puluh', 'Lima Puluh', 'Enam Puluh', 'Tujuh Puluh', 'Delapan Puluh', 'Sembilan Puluh'];
      res += ' ' + pWords[p] + (s > 0 ? ' ' + angkaTerbilang[s] : '');
    }
    return res.trim();
  }

  const d = dateObj.getDate();
  const m = dateObj.getMonth();
  const y = dateObj.getFullYear();

  return {
    dayName: days[dateObj.getDay()],
    dateWords: angkaTerbilang[d] || String(d),
    monthWords: months[m],
    yearWords: convertYearToWords(y),
    dateFormatted: `${String(d).padStart(2, '0')}-${String(m + 1).padStart(2, '0')}-${y}`,
    isoDate: dateObj.toISOString().slice(0, 10),
    scheduleText: `${days[dateObj.getDay()]}, ${String(d).padStart(2, '0')} ${months[m]} ${y}`
  };
}

function initBeritaAcaraEvents() {
  const btnOpenBa = document.getElementById('btn-open-ba');
  if (btnOpenBa) {
    btnOpenBa.addEventListener('click', () => openBeritaAcara(state.pipeline.selectedConfigId));
  }

  const btnTabOpenBa = document.getElementById('btn-tab-open-ba');
  if (btnTabOpenBa) {
    btnTabOpenBa.addEventListener('click', () => openBeritaAcara(state.pipeline.selectedConfigId));
  }

  const btnCloseBa = document.getElementById('btn-close-ba');
  if (btnCloseBa) {
    btnCloseBa.addEventListener('click', () => {
      document.getElementById('modal-berita-acara').classList.add('hidden');
    });
  }

  // Toggle form editor sidebar
  const btnToggleForm = document.getElementById('btn-toggle-ba-form');
  const formPanel = document.getElementById('ba-form-editor-panel');
  if (btnToggleForm && formPanel) {
    btnToggleForm.addEventListener('click', () => {
      formPanel.classList.toggle('collapsed');
      const isCollapsed = formPanel.classList.contains('collapsed');
      const textSpan = document.getElementById('btn-toggle-ba-form-text');
      const iconSpan = document.getElementById('btn-toggle-ba-form-icon');
      if (textSpan) textSpan.textContent = isCollapsed ? 'Buka Form Editor' : 'Sembunyikan Form';
      if (iconSpan) iconSpan.textContent = isCollapsed ? '✏️' : '◀';
    });
  }

  // Reset to default
  const btnResetTop = document.getElementById('btn-reset-ba-form');
  const btnResetBtm = document.getElementById('btn-ba-reset-defaults');
  [btnResetTop, btnResetBtm].forEach((btn) => {
    if (btn) {
      btn.addEventListener('click', () => {
        populateBaForm(state.beritaAcaraData, true);
        renderBaDocument();
      });
    }
  });

  // Apply Changes button
  const btnApply = document.getElementById('btn-ba-apply-changes');
  if (btnApply) {
    btnApply.addEventListener('click', () => {
      renderBaDocument();
      const printArea = document.getElementById('ba-printable-area');
      if (printArea) {
        printArea.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  // Print buttons
  const btnPrintTop = document.getElementById('btn-print-ba');
  const btnPrintBtm = document.getElementById('btn-ba-print-now');
  [btnPrintTop, btnPrintBtm].forEach((btn) => {
    if (btn) {
      btn.addEventListener('click', () => {
        renderBaDocument();
        window.print();
      });
    }
  });

  // Export CSV
  const btnExportCsv = document.getElementById('btn-export-stg-csv');
  if (btnExportCsv) {
    btnExportCsv.addEventListener('click', () => exportStagingCsv());
  }

  // Date Picker change helper
  const datePicker = document.getElementById('ba_input_date_picker');
  if (datePicker) {
    datePicker.addEventListener('change', (e) => {
      const val = e.target.value;
      if (val) {
        const parts = val.split('-');
        if (parts.length === 3) {
          const dObj = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
          if (!isNaN(dObj.getTime())) {
            const dt = getIndonesianDateDetails(dObj);
            const elDay = document.getElementById('ba_input_day_name');
            const elDW = document.getElementById('ba_input_date_words');
            const elMW = document.getElementById('ba_input_month_words');
            const elYW = document.getElementById('ba_input_year_words');
            const elDF = document.getElementById('ba_input_date_formatted');
            if (elDay) elDay.value = dt.dayName;
            if (elDW) elDW.value = dt.dateWords;
            if (elMW) elMW.value = dt.monthWords;
            if (elYW) elYW.value = dt.yearWords;
            if (elDF) elDF.value = dt.dateFormatted;
            renderBaDocument();
          }
        }
      }
    });
  }

  // Logo Left Controls
  const selLogoLeft = document.getElementById('ba_input_logo_left_mode');
  const wrapLogoLeft = document.getElementById('ba_logo_left_custom_wrap');
  const badgeLogoLeft = document.getElementById('ba_logo_left_badge');
  const fileLogoLeft = document.getElementById('ba_input_logo_left_file');
  const urlLogoLeft = document.getElementById('ba_input_logo_left_url');
  const heightLogoLeft = document.getElementById('ba_input_logo_left_height');

  if (selLogoLeft) {
    selLogoLeft.addEventListener('change', (e) => {
      const mode = e.target.value;
      state.beritaAcaraLogoLeft.mode = mode;
      if (wrapLogoLeft) {
        if (mode === 'custom') wrapLogoLeft.classList.remove('hidden');
        else wrapLogoLeft.classList.add('hidden');
      }
      if (badgeLogoLeft) {
        badgeLogoLeft.textContent = mode === 'antam' ? 'Preset: ANTAM' : (mode === 'sisi' ? 'Preset: SISI' : (mode === 'custom' ? 'Kustom' : 'None'));
      }
      renderBaDocument();
    });
  }

  if (fileLogoLeft) {
    fileLogoLeft.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(evt) {
          const dataUrl = evt.target.result;
          state.beritaAcaraLogoLeft.url = dataUrl;
          if (urlLogoLeft) urlLogoLeft.value = dataUrl;
          renderBaDocument();
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (urlLogoLeft) {
    urlLogoLeft.addEventListener('input', (e) => {
      state.beritaAcaraLogoLeft.url = e.target.value.trim();
      renderBaDocument();
    });
  }

  if (heightLogoLeft) {
    heightLogoLeft.addEventListener('input', (e) => {
      state.beritaAcaraLogoLeft.height = parseInt(e.target.value, 10) || 40;
      renderBaDocument();
    });
  }

  // Logo Right Controls
  const selLogoRight = document.getElementById('ba_input_logo_right_mode');
  const wrapLogoRight = document.getElementById('ba_logo_right_custom_wrap');
  const badgeLogoRight = document.getElementById('ba_logo_right_badge');
  const fileLogoRight = document.getElementById('ba_input_logo_right_file');
  const urlLogoRight = document.getElementById('ba_input_logo_right_url');
  const heightLogoRight = document.getElementById('ba_input_logo_right_height');

  if (selLogoRight) {
    selLogoRight.addEventListener('change', (e) => {
      const mode = e.target.value;
      state.beritaAcaraLogoRight.mode = mode;
      if (wrapLogoRight) {
        if (mode === 'custom') wrapLogoRight.classList.remove('hidden');
        else wrapLogoRight.classList.add('hidden');
      }
      if (badgeLogoRight) {
        badgeLogoRight.textContent = mode === 'sisi' ? 'Preset: SISI' : (mode === 'antam' ? 'Preset: ANTAM' : (mode === 'custom' ? 'Kustom' : 'None'));
      }
      renderBaDocument();
    });
  }

  if (fileLogoRight) {
    fileLogoRight.addEventListener('change', (e) => {
      const file = e.target.files && e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function(evt) {
          const dataUrl = evt.target.result;
          state.beritaAcaraLogoRight.url = dataUrl;
          if (urlLogoRight) urlLogoRight.value = dataUrl;
          renderBaDocument();
        };
        reader.readAsDataURL(file);
      }
    });
  }

  if (urlLogoRight) {
    urlLogoRight.addEventListener('input', (e) => {
      state.beritaAcaraLogoRight.url = e.target.value.trim();
      renderBaDocument();
    });
  }

  if (heightLogoRight) {
    heightLogoRight.addEventListener('input', (e) => {
      state.beritaAcaraLogoRight.height = parseInt(e.target.value, 10) || 42;
      renderBaDocument();
    });
  }

  // Config Checklist Selection Buttons
  const btnSelectAllCfg = document.getElementById('btn-ba-select-all-cfg');
  if (btnSelectAllCfg) {
    btnSelectAllCfg.addEventListener('click', () => {
      const checkboxes = document.querySelectorAll('#ba_config_selector_list input[type="checkbox"]');
      const allIds = [];
      checkboxes.forEach((cb) => {
        cb.checked = true;
        const id = parseInt(cb.dataset.configId, 10);
        if (id) allIds.push(id);
        const parent = cb.closest('.ba-config-item');
        if (parent) parent.classList.add('selected');
      });
      onConfigSelectionChanged(allIds);
    });
  }

  const btnResetCfg = document.getElementById('btn-ba-reset-cfg');
  if (btnResetCfg) {
    btnResetCfg.addEventListener('click', () => {
      const mainId = state.pipeline.selectedConfigId || (state.beritaAcaraSelectedConfigs && state.beritaAcaraSelectedConfigs[0]) || 1;
      const checkboxes = document.querySelectorAll('#ba_config_selector_list input[type="checkbox"]');
      checkboxes.forEach((cb) => {
        const id = parseInt(cb.dataset.configId, 10);
        cb.checked = id === mainId;
        const parent = cb.closest('.ba-config-item');
        if (parent) {
          if (id === mainId) parent.classList.add('selected');
          else parent.classList.remove('selected');
        }
      });
      onConfigSelectionChanged([mainId]);
    });
  }

  // Live update on input change for any form field
  const formInputs = document.querySelectorAll('#ba-form-editor-panel input, #ba-form-editor-panel select');
  formInputs.forEach((inp) => {
    inp.addEventListener('input', () => renderBaDocument());
    inp.addEventListener('change', () => renderBaDocument());
  });
}

function getSelectedConfigsData() {
  const ids = state.beritaAcaraSelectedConfigs || [];
  const list = [];
  ids.forEach((id) => {
    let cfg = state.beritaAcaraConfigsCache[id];
    const pl = (state.pipeline?.pipelines || []).find((p) => p.configId === id);
    const masterCfg = (state.config?.masters?.migration_config || []).find((m) => m.config_id === id);

    let nameConfig = masterCfg?.name_config || pl?.nameConfig || pl?.name_config || cfg?.nameConfig || cfg?.name_config;
    let modName = nameConfig || pl?.target?.table?.replace(/_/g, ' ').toUpperCase() || cfg?.modName || ('Config #' + id);
    if (!nameConfig) {
      if (modName.toLowerCase().includes('vendor') && !modName.toLowerCase().includes('address')) modName = 'Vendor';
      else if (modName.toLowerCase().includes('akta')) modName = 'Akta Perusahaan';
      else if (modName.toLowerCase().includes('address')) modName = 'Vendor Address';
    }

    if (!cfg) {
      if (pl) {
        cfg = {
          configId: id,
          nameConfig: nameConfig || modName,
          modName,
          source: pl.source,
          staging: pl.staging,
          target: pl.target,
          targets: pl.targets,
          stagingAttachment: null
        };
      } else if (state.beritaAcaraData?.config?.configId === id) {
        cfg = state.beritaAcaraData.config;
      }
    }

    if (cfg) {
      cfg.nameConfig = nameConfig || cfg.nameConfig || modName;
      cfg.modName = modName;
      if (pl && pl.targets && (!cfg.targets || cfg.targets.length === 0)) {
        cfg.targets = pl.targets;
      }
      list.push(cfg);
    }
  });
  return list;
}

async function onConfigSelectionChanged(selectedIds) {
  state.beritaAcaraSelectedConfigs = selectedIds;

  // Find any IDs not in cache
  const missingIds = selectedIds.filter((id) => !state.beritaAcaraConfigsCache[id] || !state.beritaAcaraConfigsCache[id].stagingAttachment);
  if (missingIds.length > 0) {
    try {
      const res = await fetch(`/api/reconciliation/berita-acara?configIds=${missingIds.join(',')}`);
      const json = await res.json();
      if (json.success && json.data?.configs) {
        json.data.configs.forEach((c) => {
          state.beritaAcaraConfigsCache[c.configId] = c;
        });
      }
    } catch (err) {
      console.warn('Gagal memuat detail config tambahan:', err.message);
    }
  }

  renderBaDocument();
}

window.openBeritaAcara = async function (configId) {
  const targetId = parseInt(configId || state.pipeline.selectedConfigId || 1, 10);
  const modal = document.getElementById('modal-berita-acara');
  modal.classList.remove('hidden');

  // Set selected config
  if (!state.beritaAcaraSelectedConfigs || state.beritaAcaraSelectedConfigs.length === 0 || !state.beritaAcaraSelectedConfigs.includes(targetId)) {
    state.beritaAcaraSelectedConfigs = [targetId];
  }

  try {
    // Pastikan list pipeline termuat untuk opsi checklist
    if (!state.pipeline.pipelines || state.pipeline.pipelines.length === 0) {
      try {
        const pRes = await fetch('/api/reconciliation/pipeline');
        const pJson = await pRes.json();
        if (pJson.success && pJson.data?.pipelines) {
          state.pipeline.pipelines = pJson.data.pipelines;
        }
      } catch (pe) {}
    }

    const res = await fetch(`/api/reconciliation/berita-acara?configId=${targetId}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.error);
    const data = json.data;
    state.beritaAcaraData = data;
    if (data.config) {
      state.beritaAcaraConfigsCache[targetId] = data.config;
    }
    if (data.configs) {
      data.configs.forEach((c) => {
        state.beritaAcaraConfigsCache[c.configId] = c;
      });
    }

    // Populate form with existing data or defaults
    populateBaForm(data, false);
    // Render printable document
    renderBaDocument();
  } catch (err) {
    console.warn('Gagal memuat API Berita Acara, menggunakan standar fallback:', err.message);
    populateBaForm(null, true);
    renderBaDocument();
  }
};

function populateBaForm(data, resetStrict = false) {
  const cfg = data?.config;
  const defaults = { ...STANDARD_BA_DEFAULTS };

  if (cfg) {
    if (cfg.target?.table) {
      const tbl = cfg.target.table.toLowerCase();
      if (tbl.includes('vendor') || tbl.includes('partner')) {
        defaults.modName = 'Business Partner';
        defaults.attTitle = '1. Business Partner';
      } else if (tbl.includes('akta')) {
        defaults.modName = 'Akta Perusahaan';
        defaults.attTitle = '1. Akta Perusahaan';
      } else if (tbl.includes('address')) {
        defaults.modName = 'Alamat Vendor';
        defaults.attTitle = '1. Alamat Vendor';
      } else {
        defaults.modName = cfg.target.table.replace(/_/g, ' ').toUpperCase();
        defaults.attTitle = `1. ${defaults.modName}`;
      }
    }
    if (cfg.source?.rows !== undefined && cfg.source.rows !== null) {
      defaults.rowsBefore = cfg.source.rows > 0 ? formatNumber(cfg.source.rows) : '-';
    }
    if (cfg.staging?.rows || cfg.target?.rows) {
      const cnt = cfg.target?.rows || cfg.staging?.rows;
      defaults.rowsAfter = formatNumber(cnt);
    }
  }

  const setVal = (id, defVal) => {
    const el = document.getElementById(id);
    if (!el) return;
    if (resetStrict || !el.value || el.value.trim() === '') {
      el.value = defVal;
    }
  };

  setVal('ba_input_doc_no', defaults.docNo);
  setVal('ba_input_date_picker', defaults.datePicker);
  setVal('ba_input_day_name', defaults.dayName);
  setVal('ba_input_date_words', defaults.dateWords);
  setVal('ba_input_month_words', defaults.monthWords);
  setVal('ba_input_year_words', defaults.yearWords);
  setVal('ba_input_date_formatted', defaults.dateFormatted);
  setVal('ba_input_mig_schedule', defaults.migSchedule);

  setVal('ba_input_p1_name', defaults.p1Name);
  setVal('ba_input_p1_title', defaults.p1Title);
  setVal('ba_input_p1_comp', defaults.p1Comp);

  setVal('ba_input_p2_name', defaults.p2Name);
  setVal('ba_input_p2_title', defaults.p2Title);
  setVal('ba_input_p2_comp', defaults.p2Comp);

  setVal('ba_input_wo_no', defaults.woNo);
  setVal('ba_input_wo_desc', defaults.woDesc);

  setVal('ba_input_rows_note', defaults.rowsNote);

  setVal('ba_input_s1_name', defaults.s1Name);
  setVal('ba_input_s1_title', defaults.s1Title);
  setVal('ba_input_s1_comp', defaults.s1Comp);

  setVal('ba_input_s2_name', defaults.s2Name);
  setVal('ba_input_s2_title', defaults.s2Title);
  setVal('ba_input_s2_comp', defaults.s2Comp);

  setVal('ba_input_s3_name', defaults.s3Name);
  setVal('ba_input_s3_title', defaults.s3Title);
  setVal('ba_input_s3_comp', defaults.s3Comp);

  setVal('ba_input_s4_name', defaults.s4Name);
  setVal('ba_input_s4_title', defaults.s4Title);
  setVal('ba_input_s4_comp', defaults.s4Comp);

  const elShowSigs = document.getElementById('ba_input_show_sigs');
  if (elShowSigs && resetStrict) elShowSigs.checked = defaults.showSigs;

  // Set Logo values
  const selLogoLeft = document.getElementById('ba_input_logo_left_mode');
  if (selLogoLeft) selLogoLeft.value = state.beritaAcaraLogoLeft.mode;
  const heightLogoLeft = document.getElementById('ba_input_logo_left_height');
  if (heightLogoLeft) heightLogoLeft.value = state.beritaAcaraLogoLeft.height;
  const urlLogoLeft = document.getElementById('ba_input_logo_left_url');
  if (urlLogoLeft) urlLogoLeft.value = state.beritaAcaraLogoLeft.url;

  const selLogoRight = document.getElementById('ba_input_logo_right_mode');
  if (selLogoRight) selLogoRight.value = state.beritaAcaraLogoRight.mode;
  const heightLogoRight = document.getElementById('ba_input_logo_right_height');
  if (heightLogoRight) heightLogoRight.value = state.beritaAcaraLogoRight.height;
  const urlLogoRight = document.getElementById('ba_input_logo_right_url');
  if (urlLogoRight) urlLogoRight.value = state.beritaAcaraLogoRight.url;

  // Build Config Checklist Items
  renderConfigChecklist();
}

function renderConfigChecklist() {
  const container = document.getElementById('ba_config_selector_list');
  if (!container) return;

  // Kumpulkan list konfigurasi unik
  const configsMap = new Map();

  // Dari pipeline summary
  if (state.pipeline?.pipelines) {
    state.pipeline.pipelines.forEach((p) => {
      let modName = p.nameConfig || p.name_config || p.target?.table?.replace(/_/g, ' ').toUpperCase() || `Config #${p.configId}`;
      if (!p.nameConfig && !p.name_config) {
        if (p.target?.table?.toLowerCase().includes('vendor')) modName = 'Vendor';
        else if (p.target?.table?.toLowerCase().includes('akta')) modName = 'Akta Perusahaan';
        else if (p.target?.table?.toLowerCase().includes('address')) modName = 'Vendor Address';
      }

      configsMap.set(p.configId, {
        configId: p.configId,
        modName,
        srcView: p.source?.view || '',
        tgtTable: p.target?.table || '',
        rows: p.target?.rows || p.staging?.rows || 0
      });
    });
  }

  // Dari master migration_config
  if (state.config?.masters?.migration_config) {
    state.config.masters.migration_config.forEach((c) => {
      if (!configsMap.has(c.config_id)) {
        let modName = c.name_config || (c.tgt_table || '').replace(/_/g, ' ').toUpperCase() || `Config #${c.config_id}`;
        if (!c.name_config) {
          if (c.tgt_table?.toLowerCase().includes('vendor')) modName = 'Vendor';
          else if (c.tgt_table?.toLowerCase().includes('akta')) modName = 'Akta Perusahaan';
          else if (c.tgt_table?.toLowerCase().includes('address')) modName = 'Vendor Address';
        }

        configsMap.set(c.config_id, {
          configId: c.config_id,
          modName,
          srcView: c.src_view || '',
          tgtTable: c.tgt_table || '',
          rows: 0
        });
      }
    });
  }

  // Fallback jika belum ada
  if (configsMap.size === 0) {
    const curId = state.beritaAcaraData?.config?.configId || 1;
    configsMap.set(curId, {
      configId: curId,
      modName: state.beritaAcaraData?.config?.target?.table || 'Business Partner',
      srcView: state.beritaAcaraData?.config?.source?.view || 'v_migration_vendor',
      tgtTable: state.beritaAcaraData?.config?.target?.table || 'slave_vendors',
      rows: state.beritaAcaraData?.config?.target?.rows || 663
    });
  }

  const allConfigs = Array.from(configsMap.values()).sort((a, b) => a.configId - b.configId);

  container.innerHTML = allConfigs.map((c) => {
    const isChecked = state.beritaAcaraSelectedConfigs.includes(c.configId);
    return `
      <label class="ba-config-item ${isChecked ? 'selected' : ''}" id="ba_cfg_label_${c.configId}">
        <div class="ba-config-item-main">
          <input type="checkbox" data-config-id="${c.configId}" ${isChecked ? 'checked' : ''} />
          <span class="badge badge-primary text-2xs font-mono">#${c.configId}</span>
          <span class="font-semibold text-white">${escapeHtml(c.modName)}</span>
          <span class="text-2xs text-muted">(${escapeHtml(c.srcView)} ➔ ${escapeHtml(c.tgtTable)})</span>
        </div>
        <span class="badge badge-neutral text-2xs font-mono">${formatNumber(c.rows)} baris</span>
      </label>
    `;
  }).join('');

  // Wire checkbox events
  container.querySelectorAll('input[type="checkbox"]').forEach((cb) => {
    cb.addEventListener('change', (e) => {
      const id = parseInt(e.target.dataset.configId, 10);
      const isChecked = e.target.checked;
      const label = document.getElementById(`ba_cfg_label_${id}`);
      if (label) {
        if (isChecked) label.classList.add('selected');
        else label.classList.remove('selected');
      }

      let currentIds = [...state.beritaAcaraSelectedConfigs];
      if (isChecked && !currentIds.includes(id)) {
        currentIds.push(id);
      } else if (!isChecked && currentIds.includes(id)) {
        currentIds = currentIds.filter((x) => x !== id);
      }
      onConfigSelectionChanged(currentIds);
    });
  });
}

function renderBaDocument() {
  const getVal = (id, defVal) => {
    const el = document.getElementById(id);
    const val = el ? el.value.trim() : '';
    return val !== '' ? val : defVal;
  };

  const getCheck = (id, defVal) => {
    const el = document.getElementById(id);
    return el ? el.checked : defVal;
  };

  const docNo = getVal('ba_input_doc_no', STANDARD_BA_DEFAULTS.docNo);
  const dayName = getVal('ba_input_day_name', STANDARD_BA_DEFAULTS.dayName);
  const dateWords = getVal('ba_input_date_words', STANDARD_BA_DEFAULTS.dateWords);
  const monthWords = getVal('ba_input_month_words', STANDARD_BA_DEFAULTS.monthWords);
  const yearWords = getVal('ba_input_year_words', STANDARD_BA_DEFAULTS.yearWords);
  const dateFormatted = getVal('ba_input_date_formatted', STANDARD_BA_DEFAULTS.dateFormatted);
  const migSchedule = getVal('ba_input_mig_schedule', STANDARD_BA_DEFAULTS.migSchedule);

  const p1Name = getVal('ba_input_p1_name', STANDARD_BA_DEFAULTS.p1Name);
  const p1Title = getVal('ba_input_p1_title', STANDARD_BA_DEFAULTS.p1Title);
  const p1Comp = getVal('ba_input_p1_comp', STANDARD_BA_DEFAULTS.p1Comp);

  const p2Name = getVal('ba_input_p2_name', STANDARD_BA_DEFAULTS.p2Name);
  const p2Title = getVal('ba_input_p2_title', STANDARD_BA_DEFAULTS.p2Title);
  const p2Comp = getVal('ba_input_p2_comp', STANDARD_BA_DEFAULTS.p2Comp);

  const woNo = getVal('ba_input_wo_no', STANDARD_BA_DEFAULTS.woNo);
  const woDesc = getVal('ba_input_wo_desc', STANDARD_BA_DEFAULTS.woDesc);

  const rowsNote = getVal('ba_input_rows_note', STANDARD_BA_DEFAULTS.rowsNote);

  const s1Name = getVal('ba_input_s1_name', STANDARD_BA_DEFAULTS.s1Name);
  const s1Title = getVal('ba_input_s1_title', STANDARD_BA_DEFAULTS.s1Title);
  const s1Comp = getVal('ba_input_s1_comp', STANDARD_BA_DEFAULTS.s1Comp);

  const s2Name = getVal('ba_input_s2_name', STANDARD_BA_DEFAULTS.s2Name);
  const s2Title = getVal('ba_input_s2_title', STANDARD_BA_DEFAULTS.s2Title);
  const s2Comp = getVal('ba_input_s2_comp', STANDARD_BA_DEFAULTS.s2Comp);

  const s3Name = getVal('ba_input_s3_name', STANDARD_BA_DEFAULTS.s3Name);
  const s3Title = getVal('ba_input_s3_title', STANDARD_BA_DEFAULTS.s3Title);
  const s3Comp = getVal('ba_input_s3_comp', STANDARD_BA_DEFAULTS.s3Comp);

  const s4Name = getVal('ba_input_s4_name', STANDARD_BA_DEFAULTS.s4Name);
  const s4Title = getVal('ba_input_s4_title', STANDARD_BA_DEFAULTS.s4Title);
  const s4Comp = getVal('ba_input_s4_comp', STANDARD_BA_DEFAULTS.s4Comp);

  const showSigs = getCheck('ba_input_show_sigs', true);
  const selectedConfigs = getSelectedConfigsData();
  const includeAtt = selectedConfigs.length > 0;

  // Logo Left & Right Rendering
  const logoLeftMode = (document.getElementById('ba_input_logo_left_mode')?.value) || state.beritaAcaraLogoLeft.mode;
  const logoLeftHeight = parseInt(document.getElementById('ba_input_logo_left_height')?.value || state.beritaAcaraLogoLeft.height, 10);
  const logoLeftUrl = (document.getElementById('ba_input_logo_left_url')?.value) || state.beritaAcaraLogoLeft.url;

  const logoRightMode = (document.getElementById('ba_input_logo_right_mode')?.value) || state.beritaAcaraLogoRight.mode;
  const logoRightHeight = parseInt(document.getElementById('ba_input_logo_right_height')?.value || state.beritaAcaraLogoRight.height, 10);
  const logoRightUrl = (document.getElementById('ba_input_logo_right_url')?.value) || state.beritaAcaraLogoRight.url;

  const leftHtml = renderLogoContent(logoLeftMode, logoLeftUrl, logoLeftHeight);
  const rightHtml = renderLogoContent(logoRightMode, logoRightUrl, logoRightHeight);

  // Render to Page 1, Page 2, and Lampiran
  ['ba-view-logo-left-p1', 'ba-view-logo-left-p2', 'ba-view-logo-left-att'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = leftHtml;
  });

  ['ba-view-logo-right-p1', 'ba-view-logo-right-p2', 'ba-view-logo-right-att'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.innerHTML = rightHtml;
  });

  // Render to Form Editor Previews
  const prevLeft = document.getElementById('ba_logo_left_preview');
  if (prevLeft) prevLeft.innerHTML = leftHtml || '<span class="text-2xs text-muted">Sembunyi</span>';
  const prevRight = document.getElementById('ba_logo_right_preview');
  if (prevRight) prevRight.innerHTML = rightHtml || '<span class="text-2xs text-muted">Sembunyi</span>';

  // Render to DOM Texts
  const setText = (id, text) => {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
  };

  setText('ba-view-doc-no', docNo);
  setText('ba-view-day-name', dayName);
  setText('ba-view-date-words', dateWords);
  setText('ba-view-month-words', monthWords);
  setText('ba-view-year-words', yearWords);
  setText('ba-view-date-formatted', dateFormatted);
  setText('ba-view-mig-date', migSchedule);

  setText('ba-view-p1-name', p1Name);
  setText('ba-view-p1-title', p1Title);
  setText('ba-view-p1-comp', p1Comp);

  setText('ba-view-p2-name', p2Name);
  setText('ba-view-p2-title', p2Title);
  setText('ba-view-p2-comp', p2Comp);

  setText('ba-view-wo-no', woNo);
  setText('ba-view-wo-desc', woDesc);

  const allModNames = selectedConfigs.map((c) => c.nameConfig || c.modName).join(', ') || 'Data Master';
  setText('ba-view-mod-target', allModNames);

  setText('ba-view-s1-comp', s1Comp);
  setText('ba-view-s1-name', s1Name);
  setText('ba-view-s1-title', s1Title);

  setText('ba-view-s2-comp', s2Comp);
  setText('ba-view-s2-name', s2Name);
  setText('ba-view-s2-title', s2Title);

  setText('ba-view-s3-comp', s3Comp);
  setText('ba-view-s3-name', s3Name);
  setText('ba-view-s3-title', s3Title);

  setText('ba-view-s4-comp', s4Comp);
  setText('ba-view-s4-name', s4Name);
  setText('ba-view-s4-title', s4Title);

  // Render Tabel Ringkasan (Halaman 1) Sesuai Format Gambar Lampiran 2
  const summaryTbody = document.getElementById('ba-view-summary-tbody');
  if (summaryTbody) {
    if (selectedConfigs.length === 0) {
      summaryTbody.innerHTML = `<tr><td colspan="8" class="text-center py-6 text-muted">Belum ada konfigurasi yang dipilih untuk ringkasan migrasi.</td></tr>`;
    } else {
      let rowsHtml = '';
      selectedConfigs.forEach((cfg, cfgIdx) => {
        const name = cfg.nameConfig || cfg.modName || `Config #${cfg.configId}`;
        const targets = (cfg.targets && cfg.targets.length > 0) ? cfg.targets : [{
          schema: cfg.target?.schema || 'vendor',
          table: cfg.target?.table || cfg.staging?.table || '-',
          sumSource: cfg.source?.rows ?? 0,
          sumStaging: cfg.staging?.rows ?? 0,
          sumBefore: cfg.sumBefore ?? null,
          sumAfter: cfg.target?.rows ?? cfg.staging?.rows ?? 0
        }];
        const spanCount = targets.length;

        targets.forEach((t, tIdx) => {
          const isFirst = tIdx === 0;
          const firstCols = isFirst ? `
            <td style="text-align: center; font-weight: 600; vertical-align: middle;" rowspan="${spanCount}">${cfgIdx + 1}</td>
            <td style="font-weight: 600; vertical-align: middle;" rowspan="${spanCount}">${escapeHtml(name)}</td>
          ` : '';

          const lastCol = isFirst ? `
            <td style="text-align: center; vertical-align: middle;" rowspan="${spanCount}">${escapeHtml(rowsNote)}</td>
          ` : '';

          const srcVal = (t.sumSource !== null && t.sumSource !== undefined) ? formatNumber(t.sumSource) : (cfg.source?.rows !== undefined ? formatNumber(cfg.source.rows) : '-');
          const stgVal = (t.sumStaging !== null && t.sumStaging !== undefined) ? formatNumber(t.sumStaging) : (cfg.staging?.rows !== undefined ? formatNumber(cfg.staging.rows) : '-');
          const beforeVal = (t.sumBefore !== null && t.sumBefore !== undefined) ? formatNumber(t.sumBefore) : '-';
          const afterVal = (t.sumAfter !== null && t.sumAfter !== undefined) ? formatNumber(t.sumAfter) : '-';

          rowsHtml += `
            <tr>
              ${firstCols}
              <td><strong style="color: #059669;">${escapeHtml(t.schema ? `${t.schema}.${t.table}` : t.table)}</strong></td>
              <td style="text-align: center; font-weight: bold; color: #059669;">${srcVal}</td>
              <td style="text-align: center; font-weight: bold; color: #059669;">${stgVal}</td>
              <td style="text-align: center; font-weight: bold; color: #059669;">${beforeVal}</td>
              <td style="text-align: center; font-weight: bold; color: #059669;">${afterVal}</td>
              ${lastCol}
            </tr>
          `;
        });
      });
      summaryTbody.innerHTML = rowsHtml;
    }
  }

  // Signatures SVG visibility
  const sig1Box = document.getElementById('ba-view-s1-box');
  const sig3Box = document.getElementById('ba-view-s3-box');
  if (sig1Box) sig1Box.style.opacity = showSigs ? '1' : '0';
  if (sig3Box) sig3Box.style.opacity = showSigs ? '1' : '0';

  // Attachment display toggle
  const attWrapper = document.getElementById('ba-lampiran-wrapper');
  const attBreak = document.getElementById('ba-att-page-break');
  const attContainer = document.getElementById('ba-attachment-page-container');
  if (attWrapper) attWrapper.style.display = includeAtt ? 'block' : 'none';
  if (attBreak) attBreak.style.display = includeAtt ? 'block' : 'none';
  if (attContainer) attContainer.style.display = includeAtt ? 'flex' : 'none';

  // Render attachment table untuk seluruh config yang dipilih
  if (includeAtt) {
    renderBaAttachmentTable();
  }
}

function renderBaAttachmentTable() {
  const host = document.getElementById('ba-attachment-tables-host');
  if (!host) return;

  const selectedConfigs = getSelectedConfigsData();
  if (selectedConfigs.length === 0) {
    host.innerHTML = `<div class="text-center py-6 text-muted">Tidak ada konfigurasi yang dipilih untuk lampiran.</div>`;
    return;
  }

  let html = '';
  selectedConfigs.forEach((cfg, idx) => {
    const attData = cfg.stagingAttachment || (cfg.configId === state.beritaAcaraData?.config?.configId ? state.beritaAcaraData?.stagingAttachment : null);
    const realRows = attData?.rows;
    const title = `${idx + 1}. ${cfg.modName || cfg.target?.table || cfg.source?.view || 'Data Migrasi'}${cfg.target?.table ? ` (${cfg.target.table})` : ''}`;

    let tableHtml = '';
    if (realRows && realRows.length > 0) {
      const cols = attData.columns || [];
      const preferredCols = ['name', 'nama', 'group', 'customer', 'vendor', 'employee', 'buyer_document', 'id_number', 'tax_id', 'tax_payer_type', 'tipe_vendor', 'email', 'status', 'sap_code'];
      const activeCols = cols.filter((c) => preferredCols.includes(c.name.toLowerCase()))
        .concat(cols.filter((c) => !preferredCols.includes(c.name.toLowerCase())))
        .slice(0, 10);

      tableHtml = `
        <table class="ba-official-att-table mb-4">
          <thead>
            <tr>
              <th style="width: 36px; text-align: center;">No</th>
              ${activeCols.map((c) => `<th>${escapeHtml(c.name.replace(/_/g, ' ').toUpperCase())}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${realRows.slice(0, 500).map((r, rIdx) => {
              const cells = activeCols.map((c) => {
                const val = r[c.name];
                if (val === null || val === undefined) return '<span style="color: #94a3b8; font-style: italic;">-</span>';
                if (typeof val === 'boolean') return val ? 'Yes' : 'No';
                return escapeHtml(String(val));
              }).join('</td><td>');
              return `<tr><td style="text-align: center; font-weight: 600;">${rIdx + 1}</td><td>${cells}</td></tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
    } else {
      // Fallback sample data
      tableHtml = `
        <table class="ba-official-att-table mb-4">
          <thead>
            <tr>
              <th style="width: 36px; text-align: center;">No</th>
              <th>Name</th>
              <th>Group</th>
              <th style="text-align: center; width: 65px;">Customer</th>
              <th style="text-align: center; width: 60px;">Vendor</th>
              <th style="text-align: center; width: 65px;">Employee</th>
              <th>ID Number</th>
              <th>Tax ID</th>
              <th>Tax Payer Type</th>
            </tr>
          </thead>
          <tbody>
            ${SAMPLE_BP_ATTACHMENT_ROWS.slice(0, 500).map((r, rIdx) => `
              <tr>
                <td style="text-align: center; font-weight: 600;">${rIdx + 1}</td>
                <td><strong>${escapeHtml(r.name)}</strong></td>
                <td>${escapeHtml(r.group)}</td>
                <td style="text-align: center;">${escapeHtml(r.customer)}</td>
                <td style="text-align: center;">${escapeHtml(r.vendor)}</td>
                <td style="text-align: center;">${escapeHtml(r.employee)}</td>
                <td class="font-mono">${escapeHtml(r.idNumber)}</td>
                <td class="font-mono">${escapeHtml(r.taxId)}</td>
                <td>${escapeHtml(r.taxType)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    }

    html += `
      <div class="ba-lampiran-section mb-4" id="ba-lampiran-cfg-${cfg.configId}">
        <div style="font-size: 10.5pt; font-weight: 700; margin-bottom: 0.5rem; color: #0f172a; border-bottom: 2px solid #005ba4; padding-bottom: 4px; display: flex; justify-content: space-between;">
          <span>${escapeHtml(title)}</span>
          <span style="font-size: 8pt; font-weight: 600; color: #64748b;">Total: ${formatNumber(cfg.target?.rows || cfg.staging?.rows || 0)} Baris</span>
        </div>
        ${tableHtml}
      </div>
    `;
  });

  host.innerHTML = html;
}

function exportStagingCsv() {
  const activeConfigs = getSelectedConfigsData();
  const firstCfg = activeConfigs[0];
  const attData = firstCfg?.stagingAttachment || state.beritaAcaraData?.stagingAttachment;
  const rows = (attData && attData.rows && attData.rows.length > 0)
    ? attData.rows
    : SAMPLE_BP_ATTACHMENT_ROWS;

  if (!rows || rows.length === 0) {
    alert('Tidak ada data lampiran untuk diekspor.');
    return;
  }

  const keys = Object.keys(rows[0]);
  const csvRows = [];
  csvRows.push(keys.map((k) => `"${k}"`).join(','));

  rows.forEach((r) => {
    const vals = keys.map((k) => {
      let v = r[k];
      if (v === null || v === undefined) return '""';
      if (typeof v === 'object') v = JSON.stringify(v);
      return `"${String(v).replace(/"/g, '""')}"`;
    });
    csvRows.push(vals.join(','));
  });

  const blob = new Blob([csvRows.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const cfgId = firstCfg?.configId || state.beritaAcaraData?.config?.configId || '1';
  a.download = `BA_Lampiran_Migrasi_Config_${cfgId}.csv`;
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

// =========================================================================
// TOAST NOTIFICATION SYSTEM (POJOK KANAN ATAS)
// =========================================================================
function showToast(message, type = 'info', durationMs = 3800) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.className = 'toast-container';
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }

  let cleanMsg = String(message || '').trim();
  let toastType = type;
  let title = '';

  if (cleanMsg.startsWith('✓') || cleanMsg.startsWith('SUCCESS:')) {
    toastType = 'success';
    title = 'Berhasil';
    cleanMsg = cleanMsg.replace(/^✓\s*|^SUCCESS:\s*/i, '');
  } else if (cleanMsg.startsWith('⚠️') || cleanMsg.startsWith('WARNING:')) {
    toastType = 'warning';
    title = 'Perhatian';
    cleanMsg = cleanMsg.replace(/^⚠️\s*|^WARNING:\s*/i, '');
  } else if (cleanMsg.startsWith('❌') || cleanMsg.startsWith('ERROR:') || cleanMsg.startsWith('Gagal') || cleanMsg.startsWith('Error')) {
    toastType = 'error';
    title = 'Peringatan Sistem';
    cleanMsg = cleanMsg.replace(/^❌\s*|^ERROR:\s*/i, '');
  } else {
    if (toastType === 'success') title = 'Berhasil';
    else if (toastType === 'error') title = 'Terjadi Kesalahan';
    else if (toastType === 'warning') title = 'Perhatian';
    else title = 'Informasi';
  }

  const iconMap = {
    success: '✓',
    error: '✕',
    warning: '⚠️',
    info: 'ℹ️'
  };

  const item = document.createElement('div');
  item.className = `toast-item toast-${toastType}`;
  item.innerHTML = `
    <div class="toast-icon">${iconMap[toastType] || 'ℹ️'}</div>
    <div class="toast-content">
      <div class="toast-title">${escapeHtml(title)}</div>
      <div class="toast-message">${escapeHtml(cleanMsg)}</div>
    </div>
    <button type="button" class="toast-close" title="Tutup">&times;</button>
  `;

  let isDismissed = false;
  const dismiss = () => {
    if (isDismissed) return;
    isDismissed = true;
    item.classList.add('toast-hiding');
    setTimeout(() => {
      if (item.parentNode) item.parentNode.removeChild(item);
    }, 280);
  };

  const closeBtn = item.querySelector('.toast-close');
  if (closeBtn) closeBtn.addEventListener('click', dismiss);

  container.appendChild(item);

  if (durationMs > 0) {
    setTimeout(dismiss, durationMs);
  }

  return item;
}

window.showToast = showToast;
window.notify = showToast;

// Proxy alert() browser agar otomatis tampil sebagai toast pojok kanan atas
window.alert = function (msg) {
  showToast(msg);
};

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
  const current = state.sourceConnectionsList.find(
    (c) => String(c.connection_id) === String(state.selectedSourceConnectionId)
  );

  if (current) {
    const veSchema = document.getElementById('ve-schema-name');
    if (veSchema) {
      veSchema.value = current.db_schema || (current.db_type === 'MSSQL' ? 'dbo' : 'public');
    }
  }

  const badgeEl = document.getElementById('source-connection-badge');
  if (badgeEl) {
    if (current) {
      badgeEl.textContent = `${current.db_type} • ${current.database_name} (${current.db_schema || 'dbo'})`;
    } else {
      badgeEl.textContent = 'Semua Koneksi';
    }
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

// =========================================================================
// 🔐 AUTHENTICATION & RBAC MODULE
// =========================================================================

async function authFetch(url, options = {}) {
  const token = state.userToken || localStorage.getItem('antam_token');
  const headers = Object.assign({}, options.headers || {});
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 && !url.includes('/api/auth/login')) {
    console.warn('Sesi login telah kedaluwarsa atau tidak valid.');
    handleLogout();
  }
  return res;
}

async function initAuth() {
  const token = localStorage.getItem('antam_token');
  const loginScreen = document.getElementById('screen-login');
  
  if (!token) {
    if (loginScreen) loginScreen.classList.remove('hidden');
    return;
  }

  try {
    const res = await authFetch('/api/auth/me');
    const json = await res.json();
    if (json.success && json.data) {
      state.userToken = token;
      state.currentUser = json.data.user;
      state.userMenus = json.data.menus || [];
      updateAuthUserBadge(state.currentUser);
      applyMenuPermissions(state.userMenus);
      if (loginScreen) loginScreen.classList.add('hidden');
      await initApplication();
    } else {
      localStorage.removeItem('antam_token');
      state.userToken = null;
      if (loginScreen) loginScreen.classList.remove('hidden');
    }
  } catch (err) {
    console.error('Error saat verifikasi sesi auth:', err);
    if (loginScreen) loginScreen.classList.remove('hidden');
  }
}

async function handleLoginSubmit(event) {
  if (event) event.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const alertBox = document.getElementById('login-alert-box');
  const alertText = document.getElementById('login-alert-text');
  const submitBtn = document.getElementById('btn-submit-login');
  const submitBtnText = document.getElementById('btn-submit-login-text');
  const loginScreen = document.getElementById('screen-login');

  const username = usernameInput ? usernameInput.value.trim() : '';
  const password = passwordInput ? passwordInput.value : '';

  if (!username || !password) {
    if (alertBox) alertBox.classList.remove('hidden');
    if (alertText) alertText.textContent = 'Harap isi username dan kata sandi.';
    return;
  }

  if (submitBtn) submitBtn.disabled = true;
  if (submitBtnText) submitBtnText.textContent = 'Memverifikasi...';
  if (alertBox) alertBox.classList.add('hidden');

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
    });
    const json = await res.json();

    if (!json.success) {
      if (alertBox) alertBox.classList.remove('hidden');
      if (alertText) alertText.textContent = json.message || 'Login gagal. Periksa username dan password Anda.';
      return;
    }

    // Login Berhasil
    localStorage.setItem('antam_token', json.data.token);
    state.userToken = json.data.token;
    state.currentUser = json.data.user;
    state.userMenus = json.data.menus || [];

    updateAuthUserBadge(state.currentUser);
    applyMenuPermissions(state.userMenus);

    if (passwordInput) passwordInput.value = '';
    if (loginScreen) loginScreen.classList.add('hidden');

    await initApplication();
  } catch (err) {
    console.error('Kesalahan saat login:', err);
    if (alertBox) alertBox.classList.remove('hidden');
    if (alertText) alertText.textContent = 'Terjadi kesalahan koneksi server: ' + err.message;
  } finally {
    if (submitBtn) submitBtn.disabled = false;
    if (submitBtnText) submitBtnText.textContent = 'Masuk Sekarang ➔';
  }
}

function handleLogout() {
  const token = state.userToken || localStorage.getItem('antam_token');
  if (token) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` }
    }).catch(() => {});
  }
  localStorage.removeItem('antam_token');
  state.userToken = null;
  state.currentUser = null;
  state.userMenus = [];
  
  // Sembunyikan tombol setting saat logout
  applyAdminSettingsButtonVisibility();

  const loginScreen = document.getElementById('screen-login');
  if (loginScreen) {
    loginScreen.classList.remove('hidden');
    const alertBox = document.getElementById('login-alert-box');
    if (alertBox) alertBox.classList.add('hidden');
    const pwdInput = document.getElementById('login-password');
    if (pwdInput) pwdInput.value = '';
  }
}

function autofillLogin(username, password) {
  const uInput = document.getElementById('login-username');
  const pInput = document.getElementById('login-password');
  const alertBox = document.getElementById('login-alert-box');
  if (uInput) uInput.value = username;
  if (pInput) pInput.value = password;
  if (alertBox) alertBox.classList.add('hidden');
  const submitBtn = document.getElementById('btn-submit-login');
  if (submitBtn) submitBtn.focus();
}

function togglePasswordVisibility(inputId) {
  const input = document.getElementById(inputId);
  if (!input) return;
  input.type = input.type === 'password' ? 'text' : 'password';
}

function isCurrentUserAdmin() {
  if (!state.currentUser) return false;
  const role = (state.currentUser.role_code || state.currentUser.roleCode || '').toUpperCase();
  return role === 'SUPERADMIN' || role === 'ADMIN' || state.currentUser.username === 'admin';
}

function applyAdminSettingsButtonVisibility() {
  const isAdmin = isCurrentUserAdmin();
  const settingBtns = [
    document.getElementById('btn-open-settings'),
    document.getElementById('btn-welcome-open-settings'),
    document.getElementById('btn-gate-open-settings'),
  ];
  settingBtns.forEach(btn => {
    if (btn) {
      if (isAdmin) {
        btn.classList.remove('hidden');
        btn.style.display = '';
      } else {
        btn.classList.add('hidden');
        btn.style.display = 'none';
      }
    }
  });
}

function updateAuthUserBadge(user) {
  if (!user) return;
  const avatarEl = document.getElementById('hdr-user-avatar');
  const nameEl = document.getElementById('hdr-user-name');
  const roleEl = document.getElementById('hdr-user-role');

  if (avatarEl) {
    const initials = (user.full_name || user.username || 'U')
      .split(' ')
      .map(w => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase();
    avatarEl.textContent = initials;
  }
  if (nameEl) nameEl.textContent = user.full_name || user.username;
  if (roleEl) roleEl.textContent = user.role_code || 'USER';

  // Sinkronisasi visibilitas tombol setting untuk admin
  applyAdminSettingsButtonVisibility();
}

function applyMenuPermissions(menus) {
  const isSuperadmin = state.currentUser && state.currentUser.role_code === 'SUPERADMIN';
  
  // Pastikan tombol setting dikendalikan khusus untuk admin
  applyAdminSettingsButtonVisibility();

  const menuNavMap = {
    'TAB_SOURCE': document.getElementById('nav-btn-source'),
    'TAB_CONFIG': document.getElementById('nav-btn-config'),
    'TAB_PROCESS': document.getElementById('nav-btn-process'),
    'TAB_PIPELINE': document.getElementById('nav-btn-pipeline'),
    'TAB_SYSTEM': document.getElementById('nav-btn-system'),
  };

  if (isSuperadmin) {
    Object.values(menuNavMap).forEach(btn => {
      if (btn) btn.style.display = '';
    });
    return;
  }

  // Cek masing-masing menu berdasarkan permission can_view
  const allowedMenuCodes = new Set(
    (menus || []).filter(m => m.can_view).map(m => m.menu_code)
  );

  let currentTabIsVisible = false;

  Object.entries(menuNavMap).forEach(([code, btn]) => {
    if (!btn) return;
    const isAllowed = allowedMenuCodes.has(code);
    btn.style.display = isAllowed ? '' : 'none';
    if (isAllowed && btn.getAttribute('data-tab') === state.activeTab) {
      currentTabIsVisible = true;
    }
  });

  // Pastikan tombol Userguide selalu dapat diakses semua role
  const userguideBtn = document.getElementById('nav-btn-userguide');
  if (userguideBtn) userguideBtn.style.display = '';

  // Jika tab aktif saat ini tidak diizinkan, arahkan ke tab pertama yang diizinkan (kecuali jika sedang di Userguide atau Welcome)
  if (!currentTabIsVisible && state.activeTab !== 'tab-welcome' && state.activeTab !== 'tab-userguide') {
    const firstAllowedBtn = Object.values(menuNavMap).find(btn => btn && btn.style.display !== 'none');
    if (firstAllowedBtn) {
      const targetTab = firstAllowedBtn.getAttribute('data-tab');
      switchMainTab(targetTab);
    }
  }
}

function setupAuthEventListeners() {
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);
}

// =========================================================================
// 🛡️ SYSTEM ADMINISTRATION (USERS, ROLES, MENU MATRIX)
// =========================================================================

function setupSystemAdminEventListeners() {
  // Subtabs switching
  document.querySelectorAll('[data-sys-tab]').forEach(btn => {
    btn.addEventListener('click', () => {
      const tabId = btn.getAttribute('data-sys-tab');
      switchSysSubtab(tabId);
    });
  });

  // User events
  document.getElementById('btn-add-user')?.addEventListener('click', openAddUserModal);
  document.getElementById('btn-refresh-users')?.addEventListener('click', loadSysUsers);
  document.getElementById('form-sys-user')?.addEventListener('submit', submitUserForm);
  document.getElementById('btn-close-user-form')?.addEventListener('click', () => document.getElementById('modal-user-form')?.classList.add('hidden'));
  document.getElementById('btn-cancel-user-form')?.addEventListener('click', () => document.getElementById('modal-user-form')?.classList.add('hidden'));
  document.getElementById('btn-select-all-tenants')?.addEventListener('click', selectAllTenants);
  document.getElementById('btn-deselect-all-tenants')?.addEventListener('click', deselectAllTenants);

  // Reset password events
  document.getElementById('form-reset-pwd')?.addEventListener('submit', submitResetPwd);
  document.getElementById('btn-close-reset-pwd')?.addEventListener('click', () => document.getElementById('modal-user-reset-pwd')?.classList.add('hidden'));
  document.getElementById('btn-cancel-reset-pwd')?.addEventListener('click', () => document.getElementById('modal-user-reset-pwd')?.classList.add('hidden'));

  // Live filter users
  document.getElementById('filter-sys-users')?.addEventListener('input', (e) => {
    state.system.usersPage = 1;
    filterUsersList(e.target.value.toLowerCase().trim());
  });

  // Users Table Sorting & Pagination
  document.querySelectorAll('#table-sys-users th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-user-col');
      if (!col) return;
      if (state.system.usersSortBy === col) {
        state.system.usersSortDir = state.system.usersSortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        state.system.usersSortBy = col;
        state.system.usersSortDir = 'ASC';
      }
      state.system.usersPage = 1;
      const kw = document.getElementById('filter-sys-users')?.value.toLowerCase().trim();
      filterUsersList(kw);
    });
  });

  document.getElementById('limit-sys-users-select')?.addEventListener('change', (e) => {
    state.system.usersLimit = parseInt(e.target.value, 10) || 10;
    state.system.usersPage = 1;
    const kw = document.getElementById('filter-sys-users')?.value.toLowerCase().trim();
    filterUsersList(kw);
  });

  document.getElementById('btn-sys-users-prev')?.addEventListener('click', () => {
    if (state.system.usersPage > 1) {
      state.system.usersPage--;
      const kw = document.getElementById('filter-sys-users')?.value.toLowerCase().trim();
      filterUsersList(kw);
    }
  });

  document.getElementById('btn-sys-users-next')?.addEventListener('click', () => {
    state.system.usersPage++;
    const kw = document.getElementById('filter-sys-users')?.value.toLowerCase().trim();
    filterUsersList(kw);
  });

  // Role events
  document.getElementById('btn-add-role')?.addEventListener('click', openAddRoleModal);
  document.getElementById('btn-refresh-roles')?.addEventListener('click', loadSysRoles);
  document.getElementById('form-sys-role')?.addEventListener('submit', submitRoleForm);
  document.getElementById('btn-close-role-form')?.addEventListener('click', () => document.getElementById('modal-role-form')?.classList.add('hidden'));
  document.getElementById('btn-cancel-role-form')?.addEventListener('click', () => document.getElementById('modal-role-form')?.classList.add('hidden'));

  // Live filter roles
  document.getElementById('filter-sys-roles')?.addEventListener('input', (e) => {
    state.system.rolesPage = 1;
    filterRolesList(e.target.value.toLowerCase().trim());
  });

  // Roles Table Sorting & Pagination
  document.querySelectorAll('#table-sys-roles th.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const col = th.getAttribute('data-role-col');
      if (!col) return;
      if (state.system.rolesSortBy === col) {
        state.system.rolesSortDir = state.system.rolesSortDir === 'ASC' ? 'DESC' : 'ASC';
      } else {
        state.system.rolesSortBy = col;
        state.system.rolesSortDir = 'ASC';
      }
      state.system.rolesPage = 1;
      const kw = document.getElementById('filter-sys-roles')?.value.toLowerCase().trim();
      filterRolesList(kw);
    });
  });

  document.getElementById('limit-sys-roles-select')?.addEventListener('change', (e) => {
    state.system.rolesLimit = parseInt(e.target.value, 10) || 10;
    state.system.rolesPage = 1;
    const kw = document.getElementById('filter-sys-roles')?.value.toLowerCase().trim();
    filterRolesList(kw);
  });

  document.getElementById('btn-sys-roles-prev')?.addEventListener('click', () => {
    if (state.system.rolesPage > 1) {
      state.system.rolesPage--;
      const kw = document.getElementById('filter-sys-roles')?.value.toLowerCase().trim();
      filterRolesList(kw);
    }
  });

  document.getElementById('btn-sys-roles-next')?.addEventListener('click', () => {
    state.system.rolesPage++;
    const kw = document.getElementById('filter-sys-roles')?.value.toLowerCase().trim();
    filterRolesList(kw);
  });

  // Matrix events
  document.getElementById('select-matrix-role')?.addEventListener('change', (e) => {
    loadMenuMatrixForSelectedRole(e.target.value);
  });
  document.getElementById('btn-save-matrix')?.addEventListener('click', saveMenuMatrix);

  // Matrix "Check All" column toggles
  ['view', 'create', 'update', 'delete'].forEach(action => {
    document.getElementById(`check-all-${action}`)?.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll(`input[name="matrix_${action}"]`).forEach(cb => {
        cb.checked = checked;
      });
    });
  });
}

function switchSysSubtab(subtabId) {
  state.activeSysSubtab = subtabId;
  document.querySelectorAll('[data-sys-tab]').forEach(btn => {
    btn.classList.toggle('active', btn.getAttribute('data-sys-tab') === subtabId);
  });

  const paneMap = {
    'sys-tab-users': document.getElementById('pane-sys-users'),
    'sys-tab-roles': document.getElementById('pane-sys-roles'),
    'sys-tab-matrix': document.getElementById('pane-sys-matrix'),
  };

  Object.entries(paneMap).forEach(([id, pane]) => {
    if (pane) pane.classList.toggle('hidden', id !== subtabId);
  });

  if (subtabId === 'sys-tab-users') loadSysUsers();
  else if (subtabId === 'sys-tab-roles') loadSysRoles();
  else if (subtabId === 'sys-tab-matrix') loadSysMatrix();
}

async function loadSystemAdministration() {
  await loadSysRolesListForSelect();
  switchSysSubtab(state.activeSysSubtab || 'sys-tab-users');
}

// -------------------------------------------------------------------------
// USER MANAGEMENT
// -------------------------------------------------------------------------

async function loadSysUsers() {
  const tbody = document.getElementById('sys-users-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="9" class="text-center py-8 text-muted">Memuat daftar pengguna...</td></tr>';

  try {
    const res = await authFetch('/api/auth/users');
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    state.system.users = json.data || [];
    renderSysUsers(state.system.users);
  } catch (err) {
    console.error('Gagal memuat users:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="9" class="text-center py-8 text-danger">Gagal memuat pengguna: ${err.message}</td></tr>`;
  }
}

function renderSysUsers(users) {
  const tbody = document.getElementById('sys-users-tbody');
  if (!tbody) return;

  const rawList = users !== undefined ? users : (state.system.users || []);
  if (!rawList || rawList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10" class="text-center py-8 text-muted">Tidak ada pengguna terdaftar.</td></tr>';
    const rangeEl = document.getElementById('sys-users-range');
    const totalEl = document.getElementById('sys-users-total');
    if (rangeEl) rangeEl.textContent = '0-0';
    if (totalEl) totalEl.textContent = '0';
    const pagesEl = document.getElementById('sys-users-page-numbers');
    if (pagesEl) pagesEl.innerHTML = '';
    const btnPrev = document.getElementById('btn-sys-users-prev');
    const btnNext = document.getElementById('btn-sys-users-next');
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  // 1. Sorting
  const sortBy = state.system.usersSortBy || 'user_id';
  const sortDir = state.system.usersSortDir || 'ASC';

  const sorted = [...rawList].sort((a, b) => {
    let valA, valB;
    if (sortBy === 'user_id') {
      valA = Number(a.user_id) || 0;
      valB = Number(b.user_id) || 0;
    } else if (sortBy === 'username') {
      valA = (a.username || '').toLowerCase();
      valB = (b.username || '').toLowerCase();
    } else if (sortBy === 'full_name') {
      valA = (a.full_name || '').toLowerCase();
      valB = (b.full_name || '').toLowerCase();
    } else if (sortBy === 'email') {
      valA = (a.email || '').toLowerCase();
      valB = (b.email || '').toLowerCase();
    } else if (sortBy === 'role_name') {
      valA = (a.role_name || a.role_code || '').toLowerCase();
      valB = (b.role_name || b.role_code || '').toLowerCase();
    } else if (sortBy === 'is_active') {
      valA = a.is_active ? 1 : 0;
      valB = b.is_active ? 1 : 0;
    } else if (sortBy === 'last_login_at') {
      valA = a.last_login_at ? new Date(a.last_login_at).getTime() : 0;
      valB = b.last_login_at ? new Date(b.last_login_at).getTime() : 0;
    } else if (sortBy === 'created_at') {
      valA = a.created_at ? new Date(a.created_at).getTime() : 0;
      valB = b.created_at ? new Date(b.created_at).getTime() : 0;
    } else {
      valA = a[sortBy];
      valB = b[sortBy];
    }
    if (valA < valB) return sortDir === 'ASC' ? -1 : 1;
    if (valA > valB) return sortDir === 'ASC' ? 1 : -1;
    return 0;
  });

  // Header Sort Indicators
  document.querySelectorAll('#table-sys-users th.sortable').forEach(th => {
    const col = th.getAttribute('data-user-col');
    th.classList.remove('sorted-asc', 'sorted-desc');
    const icon = th.querySelector('.sort-icon');
    if (col === sortBy) {
      th.classList.add(sortDir === 'ASC' ? 'sorted-asc' : 'sorted-desc');
      if (icon) icon.textContent = sortDir === 'ASC' ? '▲' : '▼';
    } else {
      if (icon) icon.textContent = '↕';
    }
  });

  // 2. Pagination
  const total = sorted.length;
  const limit = state.system.usersLimit || 10;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (state.system.usersPage > totalPages) {
    state.system.usersPage = totalPages;
  }
  const curPage = state.system.usersPage || 1;
  const startIdx = (curPage - 1) * limit;
  const endIdx = Math.min(startIdx + limit, total);
  const pagedList = sorted.slice(startIdx, endIdx);

  // Range and Total Info
  const rangeEl = document.getElementById('sys-users-range');
  const totalEl = document.getElementById('sys-users-total');
  if (rangeEl) rangeEl.textContent = total > 0 ? `${startIdx + 1}-${endIdx}` : '0-0';
  if (totalEl) totalEl.textContent = formatNumber(total);

  // Page Numbers
  renderPaginationNumbers('sys-users-page-numbers', curPage, totalPages, (newPage) => {
    state.system.usersPage = newPage;
    renderSysUsers(users);
  });

  const btnPrev = document.getElementById('btn-sys-users-prev');
  const btnNext = document.getElementById('btn-sys-users-next');
  if (btnPrev) btnPrev.disabled = curPage <= 1;
  if (btnNext) btnNext.disabled = curPage >= totalPages;

  // 3. Render Rows
  tbody.innerHTML = pagedList.map(u => {
    const roleBadgeClass = u.role_code === 'SUPERADMIN' 
      ? 'role-tag-superadmin' 
      : u.role_code === 'OPERATOR' ? 'role-tag-operator' : 'role-tag-viewer';
    
    const statusBadge = u.is_active 
      ? '<span class="badge badge-success">Aktif</span>' 
      : '<span class="badge badge-neutral">Nonaktif</span>';

    const lastLogin = u.last_login_at 
      ? new Date(u.last_login_at).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) 
      : '<span class="text-muted">-</span>';

    const createdAt = u.created_at 
      ? new Date(u.created_at).toLocaleDateString('id-ID', { dateStyle: 'short' }) 
      : '-';

    let tenantBadge = '';
    if (u.role_code === 'SUPERADMIN') {
      tenantBadge = `<span class="badge badge-neutral text-2xs" style="padding:0.2rem 0.5rem;background:#f8fafc;color:#0f172a;border:1px solid #cbd5e1;font-weight:600;">🌐 Global Superadmin</span>`;
    } else if (Array.isArray(u.assigned_clients) && u.assigned_clients.length > 0) {
      tenantBadge = `<div style="display:flex;flex-direction:column;gap:5px;">` + 
        u.assigned_clients.map(c => {
          const clientEnvs = (Array.isArray(u.assigned_environments) ? u.assigned_environments : []).filter(e => e.client_id == c.client_id);
          const envsBadges = clientEnvs.length > 0 
            ? clientEnvs.map(e => `<span class="badge badge-neutral text-3xs" style="padding:0.05rem 0.35rem;font-weight:600;">${escapeHtml(e.env_code)}</span>`).join(' ')
            : '<span class="text-3xs text-muted">Semua Env</span>';
          return `<div style="line-height:1.2;">
            <span class="badge badge-primary text-2xs" style="padding:0.12rem 0.4rem;font-weight:600;">🏢 ${escapeHtml(c.client_code)}</span>
            <div style="margin-left:0.4rem;display:inline-flex;gap:3px;align-items:center;">${envsBadges}</div>
          </div>`;
        }).join('') + `</div>`;
    } else if (u.client_id) {
      tenantBadge = `<div style="display:flex;flex-direction:column;gap:3px;">
           <span class="badge badge-primary text-2xs" style="width:fit-content;padding:0.15rem 0.45rem;">🏢 [${escapeHtml(u.client_code || 'CLIENT')}] ${escapeHtml(u.client_name || '')}</span>
           <span class="badge badge-neutral text-2xs" style="width:fit-content;padding:0.1rem 0.4rem;">🌐 ${escapeHtml(u.env_code ? `[${u.env_code}] ${u.env_name || ''}` : 'Semua Env')}</span>
         </div>`;
    } else {
      tenantBadge = `<span class="badge badge-neutral text-2xs" style="padding:0.15rem 0.5rem;">🌐 Akses Global (Semua)</span>`;
    }

    return `
      <tr>
        <td class="font-mono text-muted text-xs text-center">${u.user_id}</td>
        <td>
          <div class="flex-center gap-2" style="justify-content: flex-start;">
            <div class="user-avatar" style="width:24px;height:24px;font-size:0.65rem;">
              ${(u.full_name || u.username)[0].toUpperCase()}
            </div>
            <strong>${escapeHtml(u.username)}</strong>
          </div>
        </td>
        <td>${escapeHtml(u.full_name || '-')}</td>
        <td class="text-muted text-xs">${escapeHtml(u.email || '-')}</td>
        <td class="text-center">
          <span class="badge ${roleBadgeClass}">${escapeHtml(u.role_name || u.role_code)}</span>
        </td>
        <td>${tenantBadge}</td>
        <td class="text-center">${statusBadge}</td>
        <td class="text-center text-xs text-muted font-mono">${lastLogin}</td>
        <td class="text-center text-xs text-muted font-mono">${createdAt}</td>
        <td class="text-center">
          <div class="flex-center gap-1-5" style="justify-content: center; flex-wrap: nowrap;">
            <button class="btn btn-secondary btn-action-pill" title="Edit Pengguna" onclick="openEditUserModal(${u.user_id})">✏️ Edit</button>
            <button class="btn btn-secondary btn-action-pill" title="Reset Password" onclick="openResetPwdModal(${u.user_id}, '${escapeHtml(u.username)}')">🔑 Reset</button>
            <button class="btn btn-danger btn-action-pill" title="Hapus Pengguna" onclick="deleteUser(${u.user_id}, '${escapeHtml(u.username)}')">🗑️ Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function filterUsersList(keyword) {
  if (!keyword) {
    renderSysUsers(state.system.users);
    return;
  }
  const filtered = (state.system.users || []).filter(u => {
    const clientsStr = (u.assigned_clients || []).map(c => `${c.client_code} ${c.client_name}`).join(' ');
    const envsStr = (u.assigned_environments || []).map(e => `${e.env_code} ${e.env_name}`).join(' ');
    return (u.username || '').toLowerCase().includes(keyword) ||
           (u.full_name || '').toLowerCase().includes(keyword) ||
           (u.email || '').toLowerCase().includes(keyword) ||
           (u.role_name || '').toLowerCase().includes(keyword) ||
           (u.client_name || '').toLowerCase().includes(keyword) ||
           (u.client_code || '').toLowerCase().includes(keyword) ||
           clientsStr.toLowerCase().includes(keyword) ||
           envsStr.toLowerCase().includes(keyword);
  });
  renderSysUsers(filtered);
}

async function loadSysRolesListForSelect() {
  try {
    const res = await authFetch('/api/auth/roles');
    const json = await res.json();
    if (json.success) {
      state.system.roles = json.data || [];
      populateRoleSelectOptions(state.system.roles);
    }
  } catch (err) {
    console.warn('Gagal memuat daftar role:', err);
  }
}

function populateRoleSelectOptions(roles) {
  const userRoleSelect = document.getElementById('select-user-role');
  const matrixRoleSelect = document.getElementById('select-matrix-role');

  const optionsHtml = roles.map(r => `<option value="${r.role_id}">${escapeHtml(r.role_name)} (${r.role_code})</option>`).join('');

  if (userRoleSelect) {
    userRoleSelect.innerHTML = `<option value="">-- Pilih Role --</option>` + optionsHtml;
  }
  if (matrixRoleSelect) {
    const currentVal = matrixRoleSelect.value;
    matrixRoleSelect.innerHTML = `<option value="">-- Pilih Role --</option>` + optionsHtml;
    if (currentVal) matrixRoleSelect.value = currentVal;
  }
}

async function renderTenantChecklist(selectedClientIds = [], selectedEnvIds = []) {
  const container = document.getElementById('user-tenants-checklist-container');
  if (!container) return;

  container.innerHTML = '<div class="p-3 text-center text-xs text-muted">Memuat daftar Client &amp; Environment...</div>';

  try {
    const res = await authFetch('/api/context/clients');
    const json = await res.json();
    const clients = json.success ? json.data : (state.clients || []);

    if (!clients || clients.length === 0) {
      container.innerHTML = '<div class="p-3 text-center text-xs text-muted">Tidak ada Client yang terdaftar di sistem.</div>';
      return;
    }

    const selClientSet = new Set(selectedClientIds.map(Number));
    const selEnvSet = new Set(selectedEnvIds.map(Number));

    const html = `
      <div class="tenant-client-list">
        ${clients.map(client => {
          const isClientChecked = selClientSet.has(Number(client.client_id));
          const envs = Array.isArray(client.environments) ? client.environments : [];

          return `
            <div class="tenant-client-card ${isClientChecked ? 'selected' : ''}" id="tenant-card-${client.client_id}">
              <div class="tenant-client-head">
                <label class="flex-center gap-2 cursor-pointer" style="margin: 0; font-weight: 600; font-size: 0.85rem;">
                  <input type="checkbox" 
                         class="check-tenant-client" 
                         data-client-id="${client.client_id}" 
                         ${isClientChecked ? 'checked' : ''} 
                         onchange="window.onTenantClientToggle(${client.client_id}, this.checked)">
                  <span class="badge badge-primary text-2xs">${escapeHtml(client.client_code)}</span>
                  <span>${escapeHtml(client.client_name)}</span>
                </label>
                <span class="text-2xs text-muted">${envs.length} Environment</span>
              </div>
              ${envs.length > 0 ? `
                <div class="tenant-env-group">
                  ${envs.map(env => {
                    const isEnvChecked = selEnvSet.has(Number(env.env_id));
                    return `
                      <label class="tenant-env-chip ${isEnvChecked ? 'selected' : ''}" id="env-chip-${env.env_id}">
                        <input type="checkbox" 
                               class="check-tenant-env" 
                               data-client-id="${client.client_id}" 
                               data-env-id="${env.env_id}" 
                               ${isEnvChecked ? 'checked' : ''} 
                               onchange="window.onTenantEnvToggle(${client.client_id}, ${env.env_id}, this.checked)">
                        <span class="font-mono font-bold">${escapeHtml(env.env_code)}</span>
                        <span class="text-muted text-3xs">(${escapeHtml(env.env_name)})</span>
                      </label>
                    `;
                  }).join('')}
                </div>
              ` : `
                <div class="text-3xs text-muted mt-1 ml-6">Belum ada Environment terdaftar untuk client ini.</div>
              `}
            </div>
          `;
        }).join('')}
      </div>
    `;

    container.innerHTML = html;
  } catch (err) {
    container.innerHTML = `<div class="p-3 text-center text-xs text-danger">Gagal memuat tenant: ${escapeHtml(err.message)}</div>`;
  }
}

function onTenantClientToggle(clientId, isChecked) {
  const card = document.getElementById(`tenant-card-${clientId}`);
  if (card) {
    if (isChecked) card.classList.add('selected');
    else card.classList.remove('selected');
  }

  // Centang / uncentang semua env di bawah client ini
  const envCheckboxes = document.querySelectorAll(`.check-tenant-env[data-client-id="${clientId}"]`);
  envCheckboxes.forEach(cb => {
    cb.checked = isChecked;
    const chip = document.getElementById(`env-chip-${cb.dataset.envId}`);
    if (chip) {
      if (isChecked) chip.classList.add('selected');
      else chip.classList.remove('selected');
    }
  });
}

function onTenantEnvToggle(clientId, envId, isChecked) {
  const chip = document.getElementById(`env-chip-${envId}`);
  if (chip) {
    if (isChecked) chip.classList.add('selected');
    else chip.classList.remove('selected');
  }

  // Jika env dicentang, pastikan checkbox Client otomatis tercentang
  const clientCb = document.querySelector(`.check-tenant-client[data-client-id="${clientId}"]`);
  const card = document.getElementById(`tenant-card-${clientId}`);
  if (isChecked && clientCb && !clientCb.checked) {
    clientCb.checked = true;
    if (card) card.classList.add('selected');
  }
}

function selectAllTenants() {
  document.querySelectorAll('.check-tenant-client').forEach(cb => {
    cb.checked = true;
    const card = document.getElementById(`tenant-card-${cb.dataset.clientId}`);
    if (card) card.classList.add('selected');
  });
  document.querySelectorAll('.check-tenant-env').forEach(cb => {
    cb.checked = true;
    const chip = document.getElementById(`env-chip-${cb.dataset.envId}`);
    if (chip) chip.classList.add('selected');
  });
}

function deselectAllTenants() {
  document.querySelectorAll('.check-tenant-client').forEach(cb => {
    cb.checked = false;
    const card = document.getElementById(`tenant-card-${cb.dataset.clientId}`);
    if (card) card.classList.remove('selected');
  });
  document.querySelectorAll('.check-tenant-env').forEach(cb => {
    cb.checked = false;
    const chip = document.getElementById(`env-chip-${cb.dataset.envId}`);
    if (chip) chip.classList.remove('selected');
  });
}

function openAddUserModal() {
  const form = document.getElementById('form-sys-user');
  if (form) form.reset();

  document.getElementById('modal-user-title').textContent = '👤 Tambah Pengguna Baru';
  document.getElementById('input-user-id').value = '';
  document.getElementById('input-user-username').disabled = false;
  
  const pwdGroup = document.getElementById('group-user-password');
  const pwdInput = document.getElementById('input-user-password');
  const pwdHint = document.getElementById('user-password-hint');
  if (pwdGroup) pwdGroup.style.display = '';
  if (pwdInput) {
    pwdInput.required = true;
    pwdInput.value = '';
  }
  if (pwdHint) pwdHint.textContent = 'Wajib diisi untuk pengguna baru (min 6 karakter).';

  document.getElementById('check-user-active').checked = true;
  renderTenantChecklist([], []);
  document.getElementById('modal-user-form')?.classList.remove('hidden');
}

function openEditUserModal(userId) {
  const user = (state.system.users || []).find(u => u.user_id == userId);
  if (!user) return;

  document.getElementById('modal-user-title').textContent = '👤 Edit Pengguna';
  document.getElementById('input-user-id').value = user.user_id;
  
  const usernameInput = document.getElementById('input-user-username');
  if (usernameInput) {
    usernameInput.value = user.username;
    usernameInput.disabled = (user.username === 'admin'); // Proteksi username admin
  }

  document.getElementById('input-user-fullname').value = user.full_name || '';
  document.getElementById('input-user-email').value = user.email || '';
  document.getElementById('select-user-role').value = user.role_id;
  document.getElementById('check-user-active').checked = !!user.is_active;

  // Sembunyikan field password saat edit (gunakan modal reset password)
  const pwdGroup = document.getElementById('group-user-password');
  const pwdInput = document.getElementById('input-user-password');
  if (pwdGroup) pwdGroup.style.display = 'none';
  if (pwdInput) pwdInput.required = false;

  let selClientIds = [];
  if (Array.isArray(user.assigned_clients) && user.assigned_clients.length > 0) {
    selClientIds = user.assigned_clients.map(c => c.client_id);
  } else if (user.client_id) {
    selClientIds = [user.client_id];
  }

  let selEnvIds = [];
  if (Array.isArray(user.assigned_environments) && user.assigned_environments.length > 0) {
    selEnvIds = user.assigned_environments.map(e => e.env_id);
  } else if (user.env_id) {
    selEnvIds = [user.env_id];
  }

  renderTenantChecklist(selClientIds, selEnvIds);
  document.getElementById('modal-user-form')?.classList.remove('hidden');
}

async function submitUserForm(event) {
  if (event) event.preventDefault();
  const userId = document.getElementById('input-user-id')?.value;
  const username = document.getElementById('input-user-username')?.value.trim();
  const full_name = document.getElementById('input-user-fullname')?.value.trim();
  const email = document.getElementById('input-user-email')?.value.trim();
  const role_id = document.getElementById('select-user-role')?.value;
  const is_active = document.getElementById('check-user-active')?.checked;
  const password = document.getElementById('input-user-password')?.value;

  // Ambil seluruh client_ids yang dicentang
  const checkedClients = Array.from(document.querySelectorAll('.check-tenant-client:checked')).map(cb => parseInt(cb.dataset.clientId, 10));
  const checkedEnvs = Array.from(document.querySelectorAll('.check-tenant-env:checked')).map(cb => parseInt(cb.dataset.envId, 10));

  // Pastikan jika ada env yang dicentang, client_id pemiliknya juga masuk
  document.querySelectorAll('.check-tenant-env:checked').forEach(cb => {
    const cid = parseInt(cb.dataset.clientId, 10);
    if (!checkedClients.includes(cid)) {
      checkedClients.push(cid);
    }
  });

  const btnSubmit = document.getElementById('btn-submit-user-form');
  if (btnSubmit) btnSubmit.disabled = true;

  try {
    if (!userId) {
      // POST Create User
      const res = await authFetch('/api/auth/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          password, 
          full_name, 
          email, 
          role_id, 
          client_ids: checkedClients, 
          env_ids: checkedEnvs, 
          is_active 
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      alert('✓ Pengguna baru berhasil ditambahkan!');
    } else {
      // PUT Update User
      const res = await authFetch(`/api/auth/users/${userId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          username, 
          full_name, 
          email, 
          role_id, 
          client_ids: checkedClients, 
          env_ids: checkedEnvs, 
          is_active 
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      alert('✓ Data pengguna berhasil diperbarui!');
    }

    document.getElementById('modal-user-form')?.classList.add('hidden');
    await loadSysUsers();
  } catch (err) {
    alert('Gagal menyimpan pengguna: ' + err.message);
  } finally {
    if (btnSubmit) btnSubmit.disabled = false;
  }
}

function openResetPwdModal(userId, username) {
  document.getElementById('reset-user-id').value = userId;
  document.getElementById('reset-user-display').textContent = `${username} (ID: ${userId})`;
  document.getElementById('input-reset-password').value = '';
  document.getElementById('input-reset-password-confirm').value = '';
  document.getElementById('modal-user-reset-pwd')?.classList.remove('hidden');
}

async function submitResetPwd(event) {
  if (event) event.preventDefault();
  const userId = document.getElementById('reset-user-id')?.value;
  const pwd = document.getElementById('input-reset-password')?.value;
  const confirmPwd = document.getElementById('input-reset-password-confirm')?.value;

  if (pwd !== confirmPwd) {
    alert('Konfirmasi kata sandi baru tidak cocok!');
    return;
  }

  const btn = document.getElementById('btn-submit-reset-pwd');
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch(`/api/auth/users/${userId}/reset-password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ new_password: pwd }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert('✓ Kata sandi pengguna berhasil diubah!');
    document.getElementById('modal-user-reset-pwd')?.classList.add('hidden');
  } catch (err) {
    alert('Gagal mereset kata sandi: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteUser(userId, username) {
  if (state.currentUser && state.currentUser.user_id == userId) {
    alert('Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif digunakan.');
    return;
  }
  openDeleteModal('user', userId, `Pengguna "${username}"`);
}

// -------------------------------------------------------------------------
// ROLE MANAGEMENT
// -------------------------------------------------------------------------

async function loadSysRoles() {
  const tbody = document.getElementById('sys-roles-tbody');
  if (tbody) tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-muted">Memuat daftar role...</td></tr>';

  try {
    const res = await authFetch('/api/auth/roles');
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    state.system.roles = json.data || [];
    populateRoleSelectOptions(state.system.roles);
    const kw = document.getElementById('filter-sys-roles')?.value.toLowerCase().trim();
    if (kw) {
      filterRolesList(kw);
    } else {
      renderSysRoles(state.system.roles);
    }
  } catch (err) {
    console.error('Gagal memuat roles:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="8" class="text-center py-8 text-danger">Gagal memuat role: ${err.message}</td></tr>`;
  }
}

function filterRolesList(keyword) {
  if (!keyword) {
    renderSysRoles(state.system.roles);
    return;
  }
  const filtered = (state.system.roles || []).filter(r => {
    return (r.role_code || '').toLowerCase().includes(keyword) ||
           (r.role_name || '').toLowerCase().includes(keyword) ||
           (r.description || '').toLowerCase().includes(keyword);
  });
  renderSysRoles(filtered);
}

function renderSysRoles(roles) {
  const tbody = document.getElementById('sys-roles-tbody');
  if (!tbody) return;

  const rawList = roles !== undefined ? roles : (state.system.roles || []);
  if (!rawList || rawList.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="text-center py-8 text-muted">Tidak ada role terdaftar.</td></tr>';
    const rangeEl = document.getElementById('sys-roles-range');
    const totalEl = document.getElementById('sys-roles-total');
    if (rangeEl) rangeEl.textContent = '0-0';
    if (totalEl) totalEl.textContent = '0';
    const pagesEl = document.getElementById('sys-roles-page-numbers');
    if (pagesEl) pagesEl.innerHTML = '';
    const btnPrev = document.getElementById('btn-sys-roles-prev');
    const btnNext = document.getElementById('btn-sys-roles-next');
    if (btnPrev) btnPrev.disabled = true;
    if (btnNext) btnNext.disabled = true;
    return;
  }

  // 1. Sorting
  const sortBy = state.system.rolesSortBy || 'role_id';
  const sortDir = state.system.rolesSortDir || 'ASC';

  const sorted = [...rawList].sort((a, b) => {
    let valA, valB;
    if (sortBy === 'role_id') {
      valA = Number(a.role_id) || 0;
      valB = Number(b.role_id) || 0;
    } else if (sortBy === 'role_code') {
      valA = (a.role_code || '').toLowerCase();
      valB = (b.role_code || '').toLowerCase();
    } else if (sortBy === 'role_name') {
      valA = (a.role_name || '').toLowerCase();
      valB = (b.role_name || '').toLowerCase();
    } else if (sortBy === 'description') {
      valA = (a.description || '').toLowerCase();
      valB = (b.description || '').toLowerCase();
    } else if (sortBy === 'user_count') {
      valA = Number(a.user_count) || 0;
      valB = Number(b.user_count) || 0;
    } else if (sortBy === 'is_active') {
      valA = a.is_active ? 1 : 0;
      valB = b.is_active ? 1 : 0;
    } else if (sortBy === 'created_at') {
      valA = a.created_at ? new Date(a.created_at).getTime() : 0;
      valB = b.created_at ? new Date(b.created_at).getTime() : 0;
    } else {
      valA = a[sortBy];
      valB = b[sortBy];
    }
    if (valA < valB) return sortDir === 'ASC' ? -1 : 1;
    if (valA > valB) return sortDir === 'ASC' ? 1 : -1;
    return 0;
  });

  // Header Sort Indicators
  document.querySelectorAll('#table-sys-roles th.sortable').forEach(th => {
    const col = th.getAttribute('data-role-col');
    th.classList.remove('sorted-asc', 'sorted-desc');
    const icon = th.querySelector('.sort-icon');
    if (col === sortBy) {
      th.classList.add(sortDir === 'ASC' ? 'sorted-asc' : 'sorted-desc');
      if (icon) icon.textContent = sortDir === 'ASC' ? '▲' : '▼';
    } else {
      if (icon) icon.textContent = '↕';
    }
  });

  // 2. Pagination
  const total = sorted.length;
  const limit = state.system.rolesLimit || 10;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  if (state.system.rolesPage > totalPages) {
    state.system.rolesPage = totalPages;
  }
  const curPage = state.system.rolesPage || 1;
  const startIdx = (curPage - 1) * limit;
  const endIdx = Math.min(startIdx + limit, total);
  const pagedList = sorted.slice(startIdx, endIdx);

  // Range and Total Info
  const rangeEl = document.getElementById('sys-roles-range');
  const totalEl = document.getElementById('sys-roles-total');
  if (rangeEl) rangeEl.textContent = total > 0 ? `${startIdx + 1}-${endIdx}` : '0-0';
  if (totalEl) totalEl.textContent = formatNumber(total);

  // Page Numbers
  renderPaginationNumbers('sys-roles-page-numbers', curPage, totalPages, (newPage) => {
    state.system.rolesPage = newPage;
    renderSysRoles(roles);
  });

  const btnPrev = document.getElementById('btn-sys-roles-prev');
  const btnNext = document.getElementById('btn-sys-roles-next');
  if (btnPrev) btnPrev.disabled = curPage <= 1;
  if (btnNext) btnNext.disabled = curPage >= totalPages;

  // 3. Render Rows
  tbody.innerHTML = pagedList.map(r => {
    const isProtected = r.role_code === 'SUPERADMIN';
    const statusBadge = r.is_active 
      ? '<span class="badge badge-success">Aktif</span>' 
      : '<span class="badge badge-neutral">Nonaktif</span>';

    const createdAt = r.created_at 
      ? new Date(r.created_at).toLocaleDateString('id-ID', { dateStyle: 'short' }) 
      : '-';

    return `
      <tr>
        <td class="font-mono text-muted text-xs text-center">${r.role_id}</td>
        <td>
          <span class="font-mono font-bold text-cyan">${escapeHtml(r.role_code)}</span>
        </td>
        <td><strong>${escapeHtml(r.role_name)}</strong></td>
        <td class="text-muted text-xs">${escapeHtml(r.description || '-')}</td>
        <td class="text-center">
          <span class="badge badge-neutral font-mono">${r.user_count || 0} user</span>
        </td>
        <td class="text-center">${statusBadge}</td>
        <td class="text-center text-xs text-muted font-mono">${createdAt}</td>
        <td class="text-center">
          <div class="flex-center gap-1-5" style="justify-content: center; flex-wrap: nowrap;">
            <button class="btn btn-secondary btn-action-pill" title="Edit Role" onclick="openEditRoleModal(${r.role_id})">✏️ Edit</button>
            <button class="btn btn-danger btn-action-pill" title="Hapus Role" onclick="deleteRole(${r.role_id}, '${escapeHtml(r.role_name)}')" ${isProtected ? 'disabled style="opacity:0.35;cursor:not-allowed;"' : ''}>🗑️ Hapus</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openAddRoleModal() {
  const form = document.getElementById('form-sys-role');
  if (form) form.reset();

  document.getElementById('modal-role-title').textContent = '🎭 Tambah Role Baru';
  document.getElementById('input-role-id').value = '';
  document.getElementById('input-role-code').disabled = false;
  document.getElementById('check-role-active').checked = true;
  document.getElementById('modal-role-form')?.classList.remove('hidden');
}

function openEditRoleModal(roleId) {
  const role = (state.system.roles || []).find(r => r.role_id == roleId);
  if (!role) return;

  document.getElementById('modal-role-title').textContent = '🎭 Edit Role';
  document.getElementById('input-role-id').value = role.role_id;
  
  const codeInput = document.getElementById('input-role-code');
  if (codeInput) {
    codeInput.value = role.role_code;
    codeInput.disabled = (role.role_code === 'SUPERADMIN');
  }

  document.getElementById('input-role-name').value = role.role_name || '';
  document.getElementById('input-role-desc').value = role.description || '';
  document.getElementById('check-role-active').checked = !!role.is_active;

  document.getElementById('modal-role-form')?.classList.remove('hidden');
}

async function submitRoleForm(event) {
  if (event) event.preventDefault();
  const roleId = document.getElementById('input-role-id')?.value;
  const role_code = document.getElementById('input-role-code')?.value.trim();
  const role_name = document.getElementById('input-role-name')?.value.trim();
  const description = document.getElementById('input-role-desc')?.value.trim();
  const is_active = document.getElementById('check-role-active')?.checked;

  const btn = document.getElementById('btn-submit-role-form');
  if (btn) btn.disabled = true;

  try {
    if (!roleId) {
      const res = await authFetch('/api/auth/roles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_code, role_name, description, is_active }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      alert('✓ Role baru berhasil ditambahkan!');
    } else {
      const res = await authFetch(`/api/auth/roles/${roleId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role_code, role_name, description, is_active }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.message);
      alert('✓ Data role berhasil diperbarui!');
    }

    document.getElementById('modal-role-form')?.classList.add('hidden');
    await loadSysRoles();
  } catch (err) {
    alert('Gagal menyimpan role: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteRole(roleId, roleName) {
  openDeleteModal('role', roleId, `Role "${roleName}" (Semua hak akses user dengan role ini akan terhapus)`);
}

// -------------------------------------------------------------------------
// MENU & PERMISSION MATRIX (RBAC)
// -------------------------------------------------------------------------

async function loadSysMatrix() {
  await loadSysRolesListForSelect();
  const select = document.getElementById('select-matrix-role');
  if (select && select.value) {
    loadMenuMatrixForSelectedRole(select.value);
  } else if (select && select.options.length > 1) {
    select.selectedIndex = 1;
    loadMenuMatrixForSelectedRole(select.value);
  }
}

async function loadMenuMatrixForSelectedRole(roleId) {
  const tbody = document.getElementById('sys-matrix-tbody');
  const descEl = document.getElementById('matrix-role-desc');

  if (!roleId) {
    if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-muted">Silakan pilih role untuk menampilkan matriks perizinan.</td></tr>';
    if (descEl) descEl.textContent = '';
    return;
  }

  state.system.selectedMatrixRoleId = roleId;
  const targetRole = (state.system.roles || []).find(r => r.role_id == roleId);
  if (descEl && targetRole) {
    descEl.textContent = targetRole.description ? `• ${targetRole.description}` : '';
  }

  if (tbody) tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-muted">Memuat matriks perizinan menu...</td></tr>';

  try {
    const res = await authFetch(`/api/auth/role-menus/${roleId}`);
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    state.system.menuMatrix = json.data || [];
    renderMenuMatrix(state.system.menuMatrix);
  } catch (err) {
    console.error('Gagal memuat matriks role menus:', err);
    if (tbody) tbody.innerHTML = `<tr><td colspan="7" class="text-center py-8 text-danger">Gagal memuat matriks: ${err.message}</td></tr>`;
  }
}

function renderMenuMatrix(matrix) {
  const tbody = document.getElementById('sys-matrix-tbody');
  if (!tbody) return;

  if (!matrix || matrix.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" class="text-center py-8 text-muted">Tidak ada data menu sistem.</td></tr>';
    return;
  }

  tbody.innerHTML = matrix.map((m, idx) => {
    return `
      <tr data-menu-id="${m.menu_id}">
        <td class="text-center text-muted text-xs">${idx + 1}</td>
        <td>
          <div class="flex-center gap-2" style="justify-content: flex-start;">
            <span style="font-size: 1.15rem;">${m.menu_icon || '📄'}</span>
            <strong>${escapeHtml(m.menu_name)}</strong>
            <span class="text-muted font-mono text-2xs">(${m.menu_code})</span>
          </div>
        </td>
        <td>
          <span class="badge badge-neutral font-mono text-xs">${escapeHtml(m.route_tab)}</span>
        </td>
        <td class="text-center">
          <input type="checkbox" name="matrix_view" data-menu-id="${m.menu_id}" ${m.can_view ? 'checked' : ''}>
        </td>
        <td class="text-center">
          <input type="checkbox" name="matrix_create" data-menu-id="${m.menu_id}" ${m.can_create ? 'checked' : ''}>
        </td>
        <td class="text-center">
          <input type="checkbox" name="matrix_update" data-menu-id="${m.menu_id}" ${m.can_update ? 'checked' : ''}>
        </td>
        <td class="text-center">
          <input type="checkbox" name="matrix_delete" data-menu-id="${m.menu_id}" ${m.can_delete ? 'checked' : ''}>
        </td>
      </tr>
    `;
  }).join('');
}

async function saveMenuMatrix() {
  const roleId = state.system.selectedMatrixRoleId || document.getElementById('select-matrix-role')?.value;
  if (!roleId) {
    alert('Pilih role terlebih dahulu!');
    return;
  }

  const rows = document.querySelectorAll('#sys-matrix-tbody tr[data-menu-id]');
  if (!rows || rows.length === 0) {
    alert('Tidak ada matriks menu yang dapat disimpan.');
    return;
  }

  const permissions = [];
  rows.forEach(tr => {
    const menuId = parseInt(tr.getAttribute('data-menu-id'), 10);
    const can_view = tr.querySelector('input[name="matrix_view"]')?.checked || false;
    const can_create = tr.querySelector('input[name="matrix_create"]')?.checked || false;
    const can_update = tr.querySelector('input[name="matrix_update"]')?.checked || false;
    const can_delete = tr.querySelector('input[name="matrix_delete"]')?.checked || false;

    permissions.push({
      menu_id: menuId,
      can_view,
      can_create,
      can_update,
      can_delete,
    });
  });

  const btn = document.getElementById('btn-save-matrix');
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch(`/api/auth/role-menus/${roleId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ permissions }),
    });
    const json = await res.json();
    if (!json.success) throw new Error(json.message);

    alert('✓ Matriks perizinan menu berhasil disimpan!');

    // Jika role yang diperbarui sama dengan role user aktif saat ini, perbarui session & navigasi
    if (state.currentUser && state.currentUser.role_id == roleId) {
      const meRes = await authFetch('/api/auth/me');
      const meJson = await meRes.json();
      if (meJson.success && meJson.data) {
        state.userMenus = meJson.data.menus || [];
        applyMenuPermissions(state.userMenus);
      }
    }
  } catch (err) {
    alert('Gagal menyimpan matriks perizinan: ' + err.message);
  } finally {
    if (btn) btn.disabled = false;
  }
}

// =========================================================================
// 📖 USERGUIDE / PANDUAN PENGGUNA MODUL INTERAKTIF
// =========================================================================
let userguideInitialized = false;

function loadUserguideView() {
  if (!userguideInitialized) {
    initUserguide();
    userguideInitialized = true;
  }
}

function initUserguide() {
  // Bind left nav clicks
  const leftNavLinks = document.querySelectorAll('#userguide-left-nav a');
  leftNavLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (!href) return;
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        leftNavLinks.forEach(l => {
          l.classList.remove('bg-primary-container', 'text-on-primary-container', 'font-semibold');
          l.classList.add('text-on-surface-variant');
        });
        link.classList.remove('text-on-surface-variant');
        link.classList.add('bg-primary-container', 'text-on-primary-container', 'font-semibold');
      }
    });
  });

  // Bind right TOC clicks
  const tocLinks = document.querySelectorAll('#toc-nav .toc-link');
  tocLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const href = link.getAttribute('href');
      if (!href) return;
      const target = document.querySelector(href);
      if (target) {
        target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        tocLinks.forEach(l => {
          l.classList.remove('text-primary', 'bg-surface-container-low', 'font-semibold');
          l.classList.add('text-on-surface-variant');
        });
        link.classList.remove('text-on-surface-variant');
        link.classList.add('text-primary', 'bg-surface-container-low', 'font-semibold');
      }
    });
  });

  // Back to top scroll listener
  window.addEventListener('scroll', () => {
    const btn = document.getElementById('userguide-back-to-top');
    if (!btn) return;
    if (window.scrollY > 300) {
      btn.classList.remove('opacity-0', 'pointer-events-none');
      btn.classList.add('opacity-100');
    } else {
      btn.classList.add('opacity-0', 'pointer-events-none');
      btn.classList.remove('opacity-100');
    }
  });
}

function scrollToTopUserguide() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleAccordion(id) {
  const content = document.getElementById('content-' + id);
  const icon = document.getElementById('icon-' + id);
  if (!content) return;
  const isHidden = content.classList.contains('hidden');
  if (isHidden) {
    content.classList.remove('hidden');
    if (icon) icon.innerText = 'expand_less';
  } else {
    content.classList.add('hidden');
    if (icon) icon.innerText = 'expand_more';
  }
}

function inspectViewMock(viewName) {
  const titleElem = document.getElementById('inspect-target-title');
  const snippetElem = document.getElementById('code-snippet-ddl');
  if (titleElem) titleElem.innerText = viewName;
  if (snippetElem) {
    snippetElem.innerText = `SELECT 
    v.vendor_id, 
    v.vendor_code, 
    v.vendor_name, 
    v.tax_number, 
    v.is_active, 
    v.created_at
FROM antam_scm.dbo.${viewName} v 
WHERE v.is_deleted = 0;`;
  }
  const container = document.getElementById('inspector-preview');
  if (container) {
    container.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    container.classList.add('ring-2', 'ring-primary');
    setTimeout(() => container.classList.remove('ring-2', 'ring-primary'), 1200);
  }
  if (typeof showToast === 'function') {
    showToast(`Menampilkan skema DDL untuk: ${viewName}`, 'info');
  }
}

function copySqlCode() {
  const code = document.getElementById('code-snippet-ddl');
  if (code) {
    navigator.clipboard.writeText(code.innerText);
    if (typeof showToast === 'function') {
      showToast('Query SQL berhasil disalin ke clipboard!', 'success');
    } else {
      alert('Query SQL berhasil disalin ke clipboard!');
    }
  }
}

function copyDocLink() {
  navigator.clipboard.writeText(window.location.href);
  const btn = document.getElementById('btn-copy-link');
  if (btn) {
    const orig = btn.innerHTML;
    btn.innerHTML = '<span class="material-symbols-outlined text-[17px]">check</span> Berhasil Disalin';
    setTimeout(() => { btn.innerHTML = orig; }, 2000);
  }
  if (typeof showToast === 'function') {
    showToast('Tautan dokumen panduan berhasil disalin!', 'success');
  }
}

function downloadPdfMock() {
  if (typeof showToast === 'function') {
    showToast('Membuka dialog cetak PDF Panduan & SOP...', 'info');
  }
  setTimeout(() => window.print(), 300);
}

function generateBaPdf() {
  if (typeof openBeritaAcaraModal === 'function') {
    openBeritaAcaraModal();
  } else if (typeof showToast === 'function') {
    showToast('Membuka generator Berita Acara resmi format PDF...', 'info');
  }
}

function toggleModalSettings() {
  if (typeof openSettingsModal === 'function') {
    openSettingsModal();
  } else {
    alert('Membuka dialog Master System Settings.');
  }
}

function setGuideFilter(type) {
  const chips = document.querySelectorAll('#guide-chips .guide-chip');
  chips.forEach(c => {
    c.classList.remove('bg-primary', 'text-on-primary', 'font-bold');
    c.classList.add('bg-surface-container-lowest', 'text-on-surface');
  });
  if (event && event.currentTarget) {
    event.currentTarget.classList.remove('bg-surface-container-lowest', 'text-on-surface');
    event.currentTarget.classList.add('bg-primary', 'text-on-primary', 'font-bold');
  }

  // Target bab mapping
  const targetMap = {
    'all': 'bab-1',
    'flows': 'bab-6',
    'config': 'bab-5',
    'ba': 'bab-7',
    'troubleshoot': 'bab-10'
  };

  const targetId = targetMap[type] || 'bab-1';
  const el = document.getElementById(targetId);
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    el.classList.add('ring-2', 'ring-primary');
    setTimeout(() => el.classList.remove('ring-2', 'ring-primary'), 1500);
  }
}

function filterGuideTopics() {
  const input = document.getElementById('guide-filter-input');
  if (!input) return;
  const q = input.value.toLowerCase().trim();
  const headings = document.querySelectorAll('#tab-userguide h2, #tab-userguide h3, #tab-userguide h4');
  headings.forEach(h => {
    if (q.length > 2 && h.innerText.toLowerCase().includes(q)) {
      h.classList.add('text-primary');
    } else {
      h.classList.remove('text-primary');
    }
  });
}

function printUserguide() {
  window.print();
}

// Global Exports
window.handleLoginSubmit = handleLoginSubmit;
window.handleLogout = handleLogout;
window.autofillLogin = autofillLogin;
window.togglePasswordVisibility = togglePasswordVisibility;
window.openAddUserModal = openAddUserModal;
window.openEditUserModal = openEditUserModal;
window.openResetPwdModal = openResetPwdModal;
window.deleteUser = deleteUser;
window.openAddRoleModal = openAddRoleModal;
window.openEditRoleModal = openEditRoleModal;
window.deleteRole = deleteRole;
window.switchSysSubtab = switchSysSubtab;
window.saveMenuMatrix = saveMenuMatrix;
window.onTenantClientToggle = onTenantClientToggle;
window.onTenantEnvToggle = onTenantEnvToggle;
window.selectAllTenants = selectAllTenants;
window.deselectAllTenants = deselectAllTenants;
window.isCurrentUserAdmin = isCurrentUserAdmin;
window.applyAdminSettingsButtonVisibility = applyAdminSettingsButtonVisibility;
window.loadUserguideView = loadUserguideView;
window.initUserguide = initUserguide;
window.printUserguide = printUserguide;
window.toggleAccordion = toggleAccordion;
window.inspectViewMock = inspectViewMock;
window.copySqlCode = copySqlCode;
window.copyDocLink = copyDocLink;
window.downloadPdfMock = downloadPdfMock;
window.generateBaPdf = generateBaPdf;
window.toggleModalSettings = toggleModalSettings;
window.scrollToTopUserguide = scrollToTopUserguide;
window.setGuideFilter = setGuideFilter;
window.filterGuideTopics = filterGuideTopics;


