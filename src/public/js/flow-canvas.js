/**
 * Visual Workflow Canvas Studio Engine
 * Full Asynchronous DAG Execution, Live Particle Flow, Interactive Parameters Modal,
 * Comprehensive Error Diagnostics & Database PL/pgSQL Function Tracing.
 */
class FlowCanvasStudio {
  constructor() {
    this.presets = [];
    let savedPreset = 'flow_1_staging';
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem('last_selected_flow_preset')) {
        savedPreset = localStorage.getItem('last_selected_flow_preset');
      }
    } catch (_) {}
    this.currentPresetId = savedPreset;
    this.currentNodes = [];
    this.currentEdges = [];
    this.selectedNodeId = null;
    this.activeRunId = null;
    this.eventSource = null;
    this.isDragging = false;
    this.draggedNode = null;
    this.dragOffset = { x: 0, y: 0 };

    this.container = null;
    this.transformLayer = null;
    this.svgLayer = null;
    this.nodeLayer = null;
    this.consoleBody = null;

    // Zoom & Pan Viewport State
    this.zoomLevel = 1.0;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.panStart = { x: 0, y: 0 };

    // Timer & Diagnostic State
    this.timerInterval = null;
    this.startTime = null;
    this.lastErrorData = null;

    // Edge Visual States Map (Persist saat Drag)
    this.edgeStates = new Map();
  }

  /**
   * Bersihkan seluruh notifikasi, banner eksekusi, console logs, dan visual state
   * Saat ganti template alur maupun saat refresh/reload halaman.
   */
  resetCanvasInfoAndState() {
    // 1. Sembunyikan & reset Live Banner Eksekusi
    this.hideLiveBanner();
    this.stopTimer();

    const bannerTitle = document.getElementById('live-banner-title');
    if (bannerTitle) bannerTitle.textContent = 'Memulai eksekusi alur...';

    const bannerBadge = document.getElementById('live-banner-status-badge');
    if (bannerBadge) {
      bannerBadge.className = 'badge badge-primary';
      bannerBadge.textContent = 'RUNNING';
    }

    const bannerPulse = document.getElementById('live-banner-pulse');
    if (bannerPulse) {
      bannerPulse.className = 'live-status-pulse';
      bannerPulse.style.background = '';
    }

    const bannerFill = document.getElementById('live-banner-progress-fill');
    if (bannerFill) {
      bannerFill.className = 'live-progress-bar-fill';
      bannerFill.style.width = '0%';
    }

    const bannerPercent = document.getElementById('live-banner-percent');
    if (bannerPercent) bannerPercent.textContent = '0%';

    const bannerStepLabel = document.getElementById('live-banner-step-label');
    if (bannerStepLabel) bannerStepLabel.textContent = 'Menunggu inisialisasi...';

    const bannerTimer = document.getElementById('live-banner-timer');
    if (bannerTimer) bannerTimer.textContent = '00:00';

    const bannerSpeed = document.getElementById('live-banner-speed');
    if (bannerSpeed) bannerSpeed.textContent = '0 r/s';

    const btnInspect = document.getElementById('btn-banner-inspect-error');
    if (btnInspect) btnInspect.classList.add('hidden');

    // 2. Bersihkan Terminal Console Logs & Metrics (Hapus riwayat eksekusi alur sebelumnya)
    if (this.consoleBody) this.consoleBody.innerHTML = '';
    const metricSpeed = document.getElementById('console-metric-speed');
    if (metricSpeed) metricSpeed.textContent = '0 r/s';
    const metricRows = document.getElementById('console-metric-rows');
    if (metricRows) metricRows.textContent = '0/0';

    // 3. Bersihkan Edge States & Selected Node
    this.edgeStates.clear();
    this.selectedNodeId = null;
    this.lastErrorData = null;

    // 4. Tutup Seluruh Modal Terkait Alur
    document.getElementById('modal-flow-execute-params')?.classList.add('hidden');
    document.getElementById('modal-node-error-diagnostic')?.classList.add('hidden');
    document.getElementById('modal-node-properties')?.classList.add('hidden');

    // 5. Reset SSE & Run State
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }
    this.activeRunId = null;
    this.isSubmitting = false;
    const runBtn = document.getElementById('btn-canvas-run-flow');
    if (runBtn) runBtn.disabled = false;

    // 6. Dismiss toast notifikasi mengambang jika ada
    document.querySelectorAll('.toast-item')?.forEach(t => t.remove());
  }

  /**
   * Inisialisasi studio saat DOM siap (Cegah registrasi event listener ganda)
   */
  async init() {
    this.container = document.getElementById('canvas-workspace');
    this.transformLayer = document.getElementById('canvas-transform-layer');
    this.subflowLayer = document.getElementById('canvas-subflow-layer');
    this.svgLayer = document.getElementById('canvas-svg-layer');
    this.nodeLayer = document.getElementById('canvas-node-layer');
    this.consoleBody = document.getElementById('canvas-console-logs');

    if (!this.container || !this.svgLayer || !this.nodeLayer) return;

    // Sesuai instruksi: Bersihkan seluruh notifikasi & informasi eksekusi saat refresh kanvas
    this.resetCanvasInfoAndState();

    if (this.initialized) {
      this.updateContextUI();
      this.renderGraph();
      return;
    }
    this.initialized = true;

    this.setupPanAndZoom();
    this.setupEventListeners();
    await this.loadPresets();
  }

  /**
   * Mengambil konteks Client & Environment aktif dari global state dan DOM header
   */
  getActiveContext() {
    const clientSelect = document.getElementById('header-select-client');
    const envSelect = document.getElementById('header-select-env');

    const clientId = window.state?.selectedClientId || (clientSelect?.value ? parseInt(clientSelect.value, 10) : null);
    const envId = window.state?.selectedEnvId || (envSelect?.value ? parseInt(envSelect.value, 10) : null);

    const clientObj = window.state?.clients?.find(c => c.client_id == clientId);
    const envObj = window.state?.environments?.find(e => e.env_id == envId);

    let clientCode = clientObj?.client_code;
    let clientName = clientObj?.client_name;
    if (!clientCode && clientSelect && clientSelect.selectedOptions && clientSelect.selectedOptions[0]) {
      const match = clientSelect.selectedOptions[0].text.match(/\[(.*?)\]\s*(.*)/);
      if (match) {
        clientCode = match[1];
        clientName = match[2];
      } else {
        clientCode = clientSelect.selectedOptions[0].text;
      }
    }
    clientCode = clientCode || 'ANTAM';
    clientName = clientName || 'PT ANTAM Tbk';

    let envCode = envObj?.env_code;
    let envName = envObj?.env_name;
    if (!envCode && envSelect && envSelect.selectedOptions && envSelect.selectedOptions[0]) {
      const match = envSelect.selectedOptions[0].text.match(/\[(.*?)\]\s*(.*)/);
      if (match) {
        envCode = match[1];
        envName = match[2];
      } else {
        envCode = envSelect.selectedOptions[0].text;
      }
    }
    envCode = envCode || 'DEV';
    envName = envName || 'Development';

    return { clientId, envId, clientCode, clientName, envCode, envName };
  }

  /**
   * Memperbarui indikator status Client & Environment di toolbar kanvas
   */
  updateContextUI() {
    const ctx = this.getActiveContext();
    const clientBadge = document.getElementById('canvas-badge-client');
    const envBadge = document.getElementById('canvas-badge-env');

    if (clientBadge) {
      clientBadge.innerHTML = `
        <span class="pill-dot emerald"></span>
        <span class="pill-text">🏢 [${ctx.clientCode}] ${ctx.clientName}</span>
      `;
      clientBadge.title = `Client Aktif: ${ctx.clientName} (ID: ${ctx.clientId || 'N/A'}) - Terikat Kontrol Header`;
    }

    if (envBadge) {
      envBadge.innerHTML = `
        <span class="pill-dot purple"></span>
        <span class="pill-text">🌐 [${ctx.envCode}] ${ctx.envName}</span>
      `;
      envBadge.title = `Environment Aktif: ${ctx.envName} (ID: ${ctx.envId || 'N/A'}) - Terikat Kontrol Header`;
    }
  }

  /**
   * Menghasilkan key penyimpanan tata letak kustom per Client & Env
   */
  getLayoutStorageKey(presetId) {
    const ctx = this.getActiveContext();
    const cCode = (ctx.clientCode || 'global').toLowerCase().replace(/[^a-z0-9]/g, '');
    const eCode = (ctx.envCode || 'default').toLowerCase().replace(/[^a-z0-9]/g, '');
    return `antam_canvas_layout_${cCode}_${eCode}_${presetId || this.currentPresetId}`;
  }

  /**
   * Reaksi instan saat Client atau Environment diubah dari header kontrol utama
   */
  async onContextChanged() {
    this.updateContextUI();
    this.resetCanvasInfoAndState();
    await this.loadPresets();

    // Jika modal eksekusi sedang terbuka, refresh konten opsinya secara dinamis
    const modal = document.getElementById('modal-flow-execute-params');
    if (modal && !modal.classList.contains('hidden')) {
      await this.openExecutionParamsModal();
    }
  }

  /**
   * Muat template preset dari API backend sesuai Client & Environment aktif
   */
  async loadPresets() {
    try {
      this.updateContextUI();
      const ctx = this.getActiveContext();
      this.lastLoadedClientId = ctx.clientId;
      this.lastLoadedEnvId = ctx.envId;

      const params = [];
      if (ctx.clientId) params.push(`clientId=${ctx.clientId}`);
      if (ctx.envId) params.push(`envId=${ctx.envId}`);
      const qs = params.length > 0 ? `?${params.join('&')}` : '';

      const res = await fetch(`/api/flows/presets${qs}`);
      const data = await res.json();
      if (data.success && data.data) {
        this.presets = data.data;
        this.renderPresetDropdown();
        this.loadPreset(this.currentPresetId);
      }
    } catch (err) {
      this.logConsole('ERROR', `Gagal memuat preset alur: ${err.message}`);
    }
  }

  /**
   * Render opsi preset di toolbar
   */
  renderPresetDropdown() {
    const select = document.getElementById('canvas-select-preset');
    if (!select) return;

    select.innerHTML = this.presets.map(p => `
      <option value="${p.id}" ${p.id === this.currentPresetId ? 'selected' : ''}>
        ${p.name}
      </option>
    `).join('');

    select.value = this.currentPresetId;
    select.onchange = (e) => {
      this.loadPreset(e.target.value);
    };
  }

  /**
   * Simpan posisi simpul kanvas (Custom Layout) ke localStorage per Client & Env
   */
  saveLayout() {
    if (!this.currentNodes || this.currentNodes.length === 0) return;

    const layoutData = {};
    this.currentNodes.forEach(node => {
      layoutData[node.id] = { x: node.x, y: node.y };
    });

    try {
      const storageKey = this.getLayoutStorageKey(this.currentPresetId);
      localStorage.setItem(storageKey, JSON.stringify(layoutData));
      // Fallback untuk backward compatibility
      localStorage.setItem(`antam_canvas_layout_${this.currentPresetId}`, JSON.stringify(layoutData));

      const btn = document.getElementById('btn-canvas-save-layout');
      if (btn) {
        const originalHtml = btn.innerHTML;
        btn.innerHTML = '<span>✅</span><span>Tersimpan!</span>';
        btn.classList.add('btn-saved-success');
        setTimeout(() => {
          btn.innerHTML = originalHtml;
          btn.classList.remove('btn-saved-success');
        }, 2200);
      }

      const ctx = this.getActiveContext();
      this.logConsole('SUCCESS', `Tata letak visual untuk alur "${this.currentPresetId}" [${ctx.clientCode} - ${ctx.envCode}] berhasil disimpan!`);
      if (typeof window.showToast === 'function') {
        window.showToast(`✓ Tata letak kanvas [${ctx.clientCode}] berhasil disimpan!`, 'success');
      }
    } catch (err) {
      this.logConsole('ERROR', `Gagal menyimpan layout: ${err.message}`);
    }
  }

  /**
   * Helper untuk membuat path SVG Pola Siku-Siku / Ortogonal (Orthogonal / Right-Angle)
   * Menyediakan sudut siku-siku 90 derajat dengan fillet sudut halus
   */
  createOrthogonalPath(points, cornerRadius = 8) {
    if (!points || points.length < 2) return '';
    if (points.length === 2) {
      return `M ${points[0].x} ${points[0].y} L ${points[1].x} ${points[1].y}`;
    }

    let d = `M ${points[0].x} ${points[0].y}`;

    for (let i = 1; i < points.length - 1; i++) {
      const prev = points[i - 1];
      const curr = points[i];
      const next = points[i + 1];

      const dxIn = curr.x - prev.x;
      const dyIn = curr.y - prev.y;
      const dxOut = next.x - curr.x;
      const dyOut = next.y - curr.y;

      const lenIn = Math.hypot(dxIn, dyIn);
      const lenOut = Math.hypot(dxOut, dyOut);

      // Batasi radius agar tidak melebihi setengah panjang segmen
      const r = Math.min(cornerRadius, lenIn / 2, lenOut / 2);

      if (r <= 1) {
        d += ` L ${curr.x} ${curr.y}`;
      } else {
        const startX = curr.x - (dxIn / lenIn) * r;
        const startY = curr.y - (dyIn / lenIn) * r;
        const endX = curr.x + (dxOut / lenOut) * r;
        const endY = curr.y + (dyOut / lenOut) * r;

        d += ` L ${startX} ${startY} Q ${curr.x} ${curr.y}, ${endX} ${endY}`;
      }
    }

    const last = points[points.length - 1];
    d += ` L ${last.x} ${last.y}`;
    return d;
  }

  /**
   * Muat preset spesifik ke kanvas
   */
  loadPreset(presetId) {
    const preset = this.presets.find(p => p.id === presetId) || this.presets[0];
    if (!preset) return;

    this.currentPresetId = preset.id;
    this.currentFlow = preset;
    try {
      localStorage.setItem('last_selected_flow_preset', preset.id);
    } catch (_) {}
    const select = document.getElementById('canvas-select-preset');
    if (select && select.value !== preset.id) select.value = preset.id;

    // Bersihkan seluruh notifikasi & informasi saat berganti template alur
    this.resetCanvasInfoAndState();

    this.currentNodes = JSON.parse(JSON.stringify(preset.nodes));
    this.currentEdges = JSON.parse(JSON.stringify(preset.edges));

    // Terapkan tata letak tersimpan (Custom Layout) jika ada (prioritas per Client & Env)
    try {
      const storageKey = this.getLayoutStorageKey(preset.id);
      const savedLayoutRaw = localStorage.getItem(storageKey) || localStorage.getItem(`antam_canvas_layout_${preset.id}`);
      if (savedLayoutRaw) {
        const savedLayout = JSON.parse(savedLayoutRaw);
        this.currentNodes.forEach(node => {
          if (savedLayout[node.id] && typeof savedLayout[node.id].x === 'number') {
            node.x = savedLayout[node.id].x;
            node.y = savedLayout[node.id].y;
          }
        });
      }
    } catch (_) {}

    this.selectedNodeId = null;

    this.renderGraph();
    this.renderInspector();
    // Pusatkan graf alur di tengah kanvas secara otomatis
    setTimeout(() => this.centerGraph(false), 50);
  }

  /**
   * Render seluruh graf (Node DOM & SVG Edges)
   * Menyertakan Function Signature Badge untuk Tracing (Bug #4)
   */
  renderGraph() {
    if (!this.nodeLayer || !this.svgLayer) return;

    this.nodeLayer.innerHTML = '';
    if (this.subflowLayer) this.subflowLayer.innerHTML = '';

    // Render Sub-Workflow Looping Group Container Box jika didefinisikan pada preset
    const preset = this.presets.find(p => p.id === this.currentPresetId);
    if (preset?.subflowBox) {
      const box = preset.subflowBox;
      let boxX = box.x;
      let boxY = box.y;
      let boxWidth = box.width;
      let boxHeight = box.height;

      // Hitung jangkauan dinamis dari simpul yang berada di dalam subflow agar selalu proporsional
      if (this.currentNodes && this.currentNodes.length > 0) {
        const containedNodes = this.currentNodes.filter(n => {
          const cx = n.x + 112; // titik tengah horizontal node
          return cx >= (box.x - 30) && cx <= (box.x + box.width + 30);
        });

        if (containedNodes.length > 0) {
          const minX = Math.min(...containedNodes.map(n => n.x));
          const maxX = Math.max(...containedNodes.map(n => n.x + 225));
          const minY = Math.min(...containedNodes.map(n => n.y));
          const maxY = Math.max(...containedNodes.map(n => n.y + 136));
          const padding = 50; // Padding seimbang atas, bawah, kiri, dan kanan (50px)
          boxX = minX - padding;
          boxWidth = (maxX - minX) + (padding * 2);
          boxY = minY - padding;
          boxHeight = (maxY - minY) + (padding * 2);
        }
      }

      const subBoxEl = document.createElement('div');
      subBoxEl.id = 'canvas-subflow-box';
      subBoxEl.className = 'canvas-subflow-container';
      subBoxEl.style.left = `${boxX}px`;
      subBoxEl.style.top = `${boxY}px`;
      subBoxEl.style.width = `${boxWidth}px`;
      subBoxEl.style.height = `${boxHeight}px`;
      subBoxEl.innerHTML = `
        <div class="canvas-subflow-header">
          <span>${box.label || 'Sub-Workflow Looping'}</span>
          <span id="canvas-loop-badge" class="canvas-loop-badge">${box.badge || 'Looping: exec_per_row = Y'}</span>
        </div>
      `;
      (this.subflowLayer || this.nodeLayer).appendChild(subBoxEl);
    }

    // Hitung port socket yang aktif terhubung pada setiap simpul
    const connectedPorts = {};
    this.currentNodes.forEach(node => {
      connectedPorts[node.id] = { top: false, bottom: false, left: false, right: false };
    });

    this.currentEdges.forEach(edge => {
      const srcNode = this.currentNodes.find(n => n.id === edge.source);
      const tgtNode = this.currentNodes.find(n => n.id === edge.target);
      if (!srcNode || !tgtNode) return;

      const isLoop = Boolean(edge.isLoop || tgtNode.x < srcNode.x);
      const isBypass = Boolean(edge.route === 'top' || (edge.routeOffset && edge.routeOffset < 0));

      if (isLoop) {
        if (connectedPorts[srcNode.id]) connectedPorts[srcNode.id].bottom = true;
        if (connectedPorts[tgtNode.id]) connectedPorts[tgtNode.id].bottom = true;
      } else if (isBypass) {
        if (connectedPorts[srcNode.id]) connectedPorts[srcNode.id].top = true;
        if (connectedPorts[tgtNode.id]) connectedPorts[tgtNode.id].left = true;
      } else {
        if (connectedPorts[srcNode.id]) connectedPorts[srcNode.id].right = true;
        if (connectedPorts[tgtNode.id]) connectedPorts[tgtNode.id].left = true;
      }
    });

    this.currentNodes.forEach(node => {
      const el = document.createElement('div');
      el.id = `cnode-${node.id}`;
      const themeClass = this.getNodeTheme(node.type);
      el.className = `canvas-node node-${themeClass} state-idle ${node.id === this.selectedNodeId ? 'selected' : ''}`;
      el.style.left = `${node.x}px`;
      el.style.top = `${node.y}px`;

      const icon = this.getNodeIcon(node.type);
      const dbFuncText = node.dbFunction || 'Custom Logic';
      const auditStepTag = node.auditStep || node.type;
      const ports = connectedPorts[node.id] || { top: false, bottom: false, left: false, right: false };

      el.innerHTML = `
        <!-- 4 Port Socket: Atas, Bawah, Kiri, Kanan (User Requirement 1 & 2) -->
        <div class="node-port port-top ${ports.top ? 'has-connection' : ''}" data-port="top" title="Socket Port Atas"></div>
        <div class="node-port port-bottom ${ports.bottom ? 'has-connection' : ''}" data-port="bottom" title="Socket Port Bawah"></div>
        <div class="node-port port-left ${ports.left ? 'has-connection' : ''}" data-port="left" title="Socket Port Kiri"></div>
        <div class="node-port port-right ${ports.right ? 'has-connection' : ''}" data-port="right" title="Socket Port Kanan"></div>
        <div class="canvas-node-header">
          <div class="canvas-node-title-group">
            <span class="canvas-node-icon" title="Klik ikon untuk melihat spesifikasi & properti lengkap simpul">${icon}</span>
            <span class="canvas-node-title" title="${node.label}">${node.label}</span>
          </div>
          <span class="canvas-node-status-pill status-pill-idle" id="pill-${node.id}">IDLE</span>
        </div>
        <div class="canvas-node-body">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <span class="canvas-node-audit-tag">STEP: ${auditStepTag}</span>
          </div>
          <!-- Tracing Function Badge (Bug #4) -->
          <div class="canvas-node-db-func" title="${dbFuncText}">
            ⚙️ ${dbFuncText}
          </div>
          <div class="canvas-node-metric" id="metric-${node.id}">
            <span>Status:</span>
            <span class="canvas-node-metric-val">Siap</span>
          </div>
        </div>
      `;

      // Klik khusus pada ikon untuk membuka Dialog Detail Properti Simpul
      const iconBtn = el.querySelector('.canvas-node-icon');
      if (iconBtn) {
        iconBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectNode(node.id, false);
          this.openNodePropertiesModal(node.id);
        });
      }

      el.addEventListener('mousedown', (e) => this.onNodeMouseDown(e, node));
      // Klik pada bodi simpul hanya menyorot / memilih simpul (tanpa membuka modal)
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        this.selectNode(node.id, false);
        // Jika node dalam keadaan failed, klik node langsung membuka diagnostik error (Bug #3)
        if (el.classList.contains('state-failed') && this.lastErrorData) {
          this.openErrorDiagnosticModal(this.lastErrorData);
        }
      });

      this.nodeLayer.appendChild(el);
    });

    this.renderEdges();
  }

  /**
   * Render SVG Bezier Edges (Mendukung Forward & Looping Backward Arc Edges)
   */
  renderEdges() {
    if (!this.svgLayer) return;

    let svgHtml = `
      <defs>
        <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="3.5" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>

        <!-- Default Idle Arrow (Slate 500 - Solid Precision) -->
        <marker id="arrow-default" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8.5" markerHeight="8.5" orient="auto-start-reverse">
          <path d="M 1 2 L 10 6 L 1 10 L 3.5 6 Z" fill="#64748b" />
        </marker>

        <!-- Active Running Arrow (Sky 600 - Dynamic Glow) -->
        <marker id="arrow-active" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 1 2 L 10 6 L 1 10 L 3.5 6 Z" fill="#0284c7" />
        </marker>

        <!-- Success Completed Arrow (Emerald 500) -->
        <marker id="arrow-success" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8.5" markerHeight="8.5" orient="auto-start-reverse">
          <path d="M 1 2 L 10 6 L 1 10 L 3.5 6 Z" fill="#10b981" />
        </marker>

        <!-- Failed Arrow (Rose 600) -->
        <marker id="arrow-failed" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9" markerHeight="9" orient="auto-start-reverse">
          <path d="M 1 2 L 10 6 L 1 10 L 3.5 6 Z" fill="#e11d48" />
        </marker>

        <!-- Looping Idle Arrow (Blue 500) -->
        <marker id="arrow-loop" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8.5" markerHeight="8.5" orient="auto-start-reverse">
          <path d="M 1 2 L 10 6 L 1 10 L 3.5 6 Z" fill="#3b82f6" />
        </marker>

        <!-- Looping Active Arrow (Blue 700) -->
        <marker id="arrow-loop-active" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9.5" markerHeight="9.5" orient="auto-start-reverse">
          <path d="M 1 2 L 10 6 L 1 10 L 3.5 6 Z" fill="#1d4ed8" />
        </marker>

        <!-- Bypass Idle Arrow (Emerald 600) -->
        <marker id="arrow-bypass" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="8.5" markerHeight="8.5" orient="auto-start-reverse">
          <path d="M 1 2 L 10 6 L 1 10 L 3.5 6 Z" fill="#059669" />
        </marker>

        <!-- Bypass Active Arrow (Emerald 700) -->
        <marker id="arrow-bypass-active" viewBox="0 0 12 12" refX="10" refY="6" markerWidth="9.5" markerHeight="9.5" orient="auto-start-reverse">
          <path d="M 1 2 L 10 6 L 1 10 L 3.5 6 Z" fill="#047857" />
        </marker>
      </defs>
    `;

    this.currentEdges.forEach(edge => {
      const srcNode = this.currentNodes.find(n => n.id === edge.source);
      const tgtNode = this.currentNodes.find(n => n.id === edge.target);

      if (srcNode && tgtNode) {
        let x1, y1, x2, y2, d, midX, midY;
        const isLoop = Boolean(edge.isLoop || tgtNode.x < srcNode.x);
        const isBypass = Boolean(edge.route === 'top' || (edge.routeOffset && edge.routeOffset < 0));
        const edgeType = isLoop ? 'loop' : (isBypass ? 'bypass' : 'normal');

        // Presisi port vertikal (tinggi simpul diatur 136px, port samping tepat di sumbu top: 68px)
        const portY = 68;
        const R = 9; // Radius port socket (D=18px)

        if (isLoop) {
          // Backward Looping Edge: Pola Siku-Siku / Ortogonal (Right-Angle) ke bawah deretan simpul
          x1 = srcNode.x + 112.5;
          y1 = srcNode.y + 136 + R; // Tepat dari bibir luar socket port bawah
          x2 = tgtNode.x + 112.5;
          y2 = tgtNode.y + 136 + R; // Mendarat tepat di bibir luar socket port bawah loop controller

          const loopY = Math.max(y1, y2) + (edge.loopOffset || 140);
          const points = [
            { x: x1, y: y1 },
            { x: x1, y: loopY },
            { x: x2, y: loopY },
            { x: x2, y: y2 }
          ];
          d = this.createOrthogonalPath(points, 8);
          midX = (x1 + x2) / 2;
          midY = loopY;
        } else if (isBypass) {
          // Forward Bypass Edge: Pola Siku-Siku / Ortogonal (Right-Angle) di atas Subflow Box
          x1 = srcNode.x + 112.5;
          y1 = srcNode.y - R; // Tepat dari bibir luar socket port atas
          x2 = tgtNode.x - R; // Masuk ke bibir luar socket port kiri finish node
          y2 = tgtNode.y + portY;

          const bypassY = Math.min(y1, y2) - Math.abs(edge.routeOffset || 125);
          const turnX = x2 - 40;
          const points = [
            { x: x1, y: y1 },
            { x: x1, y: bypassY },
            { x: turnX, y: bypassY },
            { x: turnX, y: y2 },
            { x: x2, y: y2 }
          ];
          d = this.createOrthogonalPath(points, 8);
          midX = (x1 + turnX) / 2;
          midY = bypassY;
        } else {
          // Normal Forward Flow Edge: Pola Siku-Siku / Ortogonal (Right-Angle) horizontal (Z-step jika beda ketinggian)
          x1 = srcNode.x + 225 + R; // Keluar tepat dari bibir luar socket port kanan
          y1 = srcNode.y + portY;   // Ketinggian tepat 68px
          x2 = tgtNode.x - R;       // Mendarat tepat di bibir luar socket port kiri
          y2 = tgtNode.y + portY;   // Ketinggian tepat 68px

          if (Math.abs(y1 - y2) <= 1) {
            d = `M ${x1} ${y1} L ${x2} ${y2}`;
            midX = (x1 + x2) / 2;
            midY = y1;
          } else {
            const midStepX = (x1 + x2) / 2;
            const points = [
              { x: x1, y: y1 },
              { x: midStepX, y: y1 },
              { x: midStepX, y: y2 },
              { x: x2, y: y2 }
            ];
            d = this.createOrthogonalPath(points, 8);
            midX = midStepX;
            midY = (y1 + y2) / 2;
          }
        }

        // Tentukan state visual yang tersimpan (misal saat drag node)
        const edgeKey = `${edge.source}->${edge.target}`;
        const edgeState = this.edgeStates.get(edgeKey) || 'idle';

        let edgeClass = 'canvas-edge';
        if (isLoop) edgeClass += ' loop-edge';
        if (isBypass) edgeClass += ' bypass-edge';
        if (edgeState && edgeState !== 'idle') edgeClass += ` ${edgeState}`;

        // Tentukan marker panah yang sesuai dengan tipe & state
        let marker = 'url(#arrow-default)';
        if (edgeState === 'active') {
          marker = isLoop ? 'url(#arrow-loop-active)' : (isBypass ? 'url(#arrow-bypass-active)' : 'url(#arrow-active)');
        } else if (edgeState === 'success') {
          marker = 'url(#arrow-success)';
        } else if (edgeState === 'failed') {
          marker = 'url(#arrow-failed)';
        } else {
          marker = isLoop ? 'url(#arrow-loop)' : (isBypass ? 'url(#arrow-bypass)' : 'url(#arrow-default)');
        }

        svgHtml += `
          <path id="edge-${edge.source}-${edge.target}" 
                class="${edgeClass}" 
                d="${d}" 
                data-edge-type="${edgeType}"
                marker-end="${marker}" />
        `;

        if (edge.label) {
          const pillWidth = Math.max(86, edge.label.length * 7.5 + 24);
          svgHtml += `
            <g class="edge-label-group" transform="translate(${midX}, ${midY})">
              <rect x="${-pillWidth / 2}" y="-12" width="${pillWidth}" height="24" rx="12" 
                    class="edge-label-bg ${isLoop ? 'loop' : (isBypass ? 'bypass' : 'normal')}" />
              <text x="0" y="4.5" text-anchor="middle" class="edge-label-text">
                ${edge.label}
              </text>
            </g>
          `;
        }
      }
    });

    this.svgLayer.innerHTML = svgHtml;
  }

  /**
   * Drag Node Handling (Mendukung Zoom & Pan Kanvas)
   */
  onNodeMouseDown(e, node) {
    if (e.button !== 0) return;
    this.isDragging = true;
    this.draggedNode = node;
    const vpRect = this.container.getBoundingClientRect();
    const mouseWorldX = (e.clientX - vpRect.left - this.panX) / this.zoomLevel;
    const mouseWorldY = (e.clientY - vpRect.top - this.panY) / this.zoomLevel;

    this.dragOffset = {
      x: mouseWorldX - node.x,
      y: mouseWorldY - node.y
    };

    document.addEventListener('mousemove', this.onMouseMove);
    document.addEventListener('mouseup', this.onMouseUp);
  }

  onMouseMove = (e) => {
    if (!this.isDragging || !this.draggedNode) return;
    const vpRect = this.container.getBoundingClientRect();
    const mouseWorldX = (e.clientX - vpRect.left - this.panX) / this.zoomLevel;
    const mouseWorldY = (e.clientY - vpRect.top - this.panY) / this.zoomLevel;

    const newX = Math.round(mouseWorldX - this.dragOffset.x);
    const newY = Math.round(mouseWorldY - this.dragOffset.y);

    this.draggedNode.x = newX;
    this.draggedNode.y = newY;

    const el = document.getElementById(`cnode-${this.draggedNode.id}`);
    if (el) {
      el.style.left = `${newX}px`;
      el.style.top = `${newY}px`;
    }

    this.renderEdges();
    this.updateSubflowBoxPosition();
  };

  updateSubflowBoxPosition() {
    const preset = this.presets.find(p => p.id === this.currentPresetId);
    const subBoxEl = document.getElementById('canvas-subflow-box');
    if (!preset?.subflowBox || !subBoxEl || !this.currentNodes) return;

    const box = preset.subflowBox;
    const containedNodes = this.currentNodes.filter(n => {
      const cx = n.x + 112;
      return cx >= (box.x - 60) && cx <= (box.x + box.width + 60);
    });

    if (containedNodes.length > 0) {
      const minX = Math.min(...containedNodes.map(n => n.x));
      const maxX = Math.max(...containedNodes.map(n => n.x + 225));
      const minY = Math.min(...containedNodes.map(n => n.y));
      const maxY = Math.max(...containedNodes.map(n => n.y + 136));
      const padding = 50; // Padding seimbang atas, bawah, kiri, dan kanan (50px)
      subBoxEl.style.left = `${minX - padding}px`;
      subBoxEl.style.width = `${(maxX - minX) + (padding * 2)}px`;
      subBoxEl.style.top = `${minY - padding}px`;
      subBoxEl.style.height = `${(maxY - minY) + (padding * 2)}px`;
    }
  }

  onMouseUp = () => {
    this.isDragging = false;
    this.draggedNode = null;
    document.removeEventListener('mousemove', this.onMouseMove);
    document.removeEventListener('mouseup', this.onMouseUp);
  };

  /**
   * Pilih simpul (Buka Dialog Properti HANYA jika openModal = true)
   */
  selectNode(nodeId, openModal = false) {
    this.selectedNodeId = nodeId;
    document.querySelectorAll('.canvas-node').forEach(el => {
      el.classList.toggle('selected', el.id === `cnode-${nodeId}`);
    });
    if (openModal) {
      this.openNodePropertiesModal(nodeId);
    }
    this.renderInspector();
  }

  /**
   * Buka Dialog Modal Properti Simpul Lengkap (Input & Output Spesifikasi)
   */
  openNodePropertiesModal(nodeId) {
    const node = this.currentNodes.find(n => n.id === nodeId);
    if (!node) return;

    this.selectedNodeId = nodeId;
    const modal = document.getElementById('modal-node-properties');
    if (!modal) return;

    // Header modal
    const iconEl = document.getElementById('node-prop-icon');
    if (iconEl) iconEl.textContent = this.getNodeIcon(node.type);

    const titleEl = document.getElementById('node-prop-title');
    if (titleEl) titleEl.textContent = node.label || node.id;

    const typeBadgeEl = document.getElementById('node-prop-type-badge');
    if (typeBadgeEl) typeBadgeEl.textContent = node.type || 'TASK';

    const subtitleEl = document.getElementById('node-prop-subtitle');
    if (subtitleEl) subtitleEl.textContent = `ID: ${node.id} | ${node.description || 'Simpul orkestrasi alur migrasi'}`;

    // Environment & Connection Badge
    const envBadgeEl = document.getElementById('node-prop-env-badge');
    if (envBadgeEl) {
      const connCtx = node.connectionContext || (this.currentFlow && this.currentFlow.connectionContext) || {};
      const activeCtx = this.getActiveContext ? this.getActiveContext() : {};
      const clientCode = connCtx.clientCode || activeCtx.clientCode || 'ANTAM';
      const clientName = connCtx.clientName || activeCtx.clientName || 'PT ANTAM Tbk';
      const envCode = connCtx.envCode || activeCtx.envCode || 'DEV';
      const envName = connCtx.envName || activeCtx.envName || 'Development';

      const src = connCtx.source || {};
      const tgt = connCtx.target || {};

      let connInfo = '';
      if (connCtx.hasConnection || (connCtx.hasSourceConn && connCtx.hasTargetConn)) {
        const srcLabel = `${src.database || 'MSSQL'} (${src.host || ''}:${src.port || ''}${src.useSsh ? '/SSH' : ''})`;
        const tgtLabel = `${tgt.database || 'PG'} (${tgt.host || ''}:${tgt.port || ''})`;
        connInfo = `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 600; background: rgba(56, 189, 248, 0.2); color: #7dd3fc; border: 1px solid rgba(125, 211, 252, 0.35);">🔌 ${srcLabel} ➔ ${tgtLabel}</span>`;
      } else {
        const missing = [];
        if (!connCtx.hasSourceConn) missing.push('SOURCE MSSQL');
        if (!connCtx.hasTargetConn) missing.push('TARGET PostgreSQL');
        const missingText = missing.length > 0 ? missing.join(' & ') : 'Database';
        connInfo = `<span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; background: rgba(239, 68, 68, 0.25); color: #f87171; border: 1px solid rgba(248, 113, 113, 0.5);">⚠️ Koneksi ${missingText} Belum Dikonfigurasi di master_connection</span>`;
      }

      envBadgeEl.innerHTML = `
        <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(52, 211, 153, 0.35);">🏢 [${clientCode}] ${clientName}</span>
        <span style="display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 9999px; font-size: 10px; font-weight: 700; background: rgba(168, 85, 247, 0.2); color: #c084fc; border: 1px solid rgba(192, 132, 252, 0.35);">🌐 [${envCode}] ${envName}</span>
        ${connInfo}
      `;
    }

    // State Badge
    const stateBadgeEl = document.getElementById('node-prop-state-badge');
    const state = node.lastState || 'IDLE';
    if (stateBadgeEl) {
      stateBadgeEl.textContent = state;
      if (state === 'SUCCESS') {
        stateBadgeEl.style.background = '#dcfce7';
        stateBadgeEl.style.color = '#15803d';
        stateBadgeEl.style.border = '1px solid #86efac';
      } else if (state === 'RUNNING') {
        stateBadgeEl.style.background = '#e0f2fe';
        stateBadgeEl.style.color = '#0284c7';
        stateBadgeEl.style.border = '1px solid #7dd3fc';
      } else if (state === 'FAILED') {
        stateBadgeEl.style.background = '#ffe4e6';
        stateBadgeEl.style.color = '#e11d48';
        stateBadgeEl.style.border = '1px solid #fda4af';
      } else {
        stateBadgeEl.style.background = '#f1f5f9';
        stateBadgeEl.style.color = '#64748b';
        stateBadgeEl.style.border = '1px solid #cbd5e1';
      }
    }

    // Runtime state & duration
    const statusTextEl = document.getElementById('node-prop-exec-status');
    if (statusTextEl) {
      statusTextEl.textContent = state === 'IDLE' ? 'Belum Dieksekusi / Siap' : (state === 'RUNNING' ? 'Sedang Berjalan...' : (state === 'SUCCESS' ? 'Selesai Sukses' : 'Gagal'));
    }
    const durEl = document.getElementById('node-prop-duration');
    if (durEl) durEl.textContent = node.lastElapsed != null ? `${node.lastElapsed} ms` : '-';
    
    const tpEl = document.getElementById('node-prop-throughput');
    if (tpEl) tpEl.textContent = node.lastMetric || '-';

    const auditEl = document.getElementById('node-prop-audit-step');
    if (auditEl) auditEl.textContent = `migration_step_log [${node.auditStep || node.type}]`;

    const errorRow = document.getElementById('node-prop-error-row');
    const errorText = document.getElementById('node-prop-error-text');
    if (errorRow && errorText) {
      if (node.lastError) {
        errorRow.style.display = 'block';
        errorText.textContent = node.lastError;
      } else {
        errorRow.style.display = 'none';
      }
    }

    // 1. SPESIFIKASI INPUT MODUL
    const inputParamsEl = document.getElementById('node-prop-input-params');
    const inputSourcesEl = document.getElementById('node-prop-input-sources');
    const inputPrereqEl = document.getElementById('node-prop-input-prereq');

    const inputs = node.inputs || {};
    const inputParams = inputs.params || (node.signature ? [node.signature] : ['run_id', 'config_id']);
    if (inputParamsEl) {
      inputParamsEl.innerHTML = inputParams.map(p => {
        const isWarning = p.startsWith('⚠️') || p.startsWith('⛔');
        const bg = isWarning ? '#fee2e2' : '#e2e8f0';
        const color = isWarning ? '#b91c1c' : '#0f172a';
        return `
          <div style="padding: 2px 0;">
            <code style="background: ${bg}; color: ${color}; padding: 2px 6px; border-radius: 4px; font-size: 11px; font-family: monospace;">${p}</code>
          </div>
        `;
      }).join('');
    }

    const inputSources = inputs.sources || (node.tablesInvolved ? [node.tablesInvolved] : ['SQL Server / PostgreSQL']);
    if (inputSourcesEl) {
      inputSourcesEl.innerHTML = inputSources.map(s => {
        const isWarning = s.startsWith('⚠️') || s.startsWith('⛔');
        const color = isWarning ? '#dc2626' : '#166534';
        const icon = isWarning ? '' : '📁 ';
        return `
          <div style="padding: 2px 0; font-weight: 600; color: ${color}; font-size: 12px;">${icon}${s}</div>
        `;
      }).join('');
    }

    if (inputPrereqEl) {
      const prereqText = inputs.prereq || 'Koneksi database aktif dan sesi migrasi berstatus valid.';
      const isWarning = prereqText.startsWith('⛔') || prereqText.startsWith('⚠️');
      inputPrereqEl.textContent = prereqText;
      inputPrereqEl.style.color = isWarning ? '#dc2626' : '';
      inputPrereqEl.style.fontWeight = isWarning ? '700' : '';
    }

    // 2. SPESIFIKASI OUTPUT MODUL
    const outputResultsEl = document.getElementById('node-prop-output-results');
    const outputStatusEl = document.getElementById('node-prop-output-status');
    const outputContextEl = document.getElementById('node-prop-output-context');

    const outputs = node.outputs || {};
    const outputResults = outputs.results || (node.tgt_table ? [`Tabel Target: ${node.tgt_table}`] : ['Status Eksekusi Step Log']);
    if (outputResultsEl) {
      outputResultsEl.innerHTML = outputResults.map(r => `
        <div style="padding: 2px 0; font-weight: 600; color: #1e40af; font-size: 12px;">📄 ${r}</div>
      `).join('');
    }

    if (outputStatusEl) {
      outputStatusEl.textContent = outputs.status || 'OK jika berhasil tuntas tanpa error; FAILED jika ada constraint/koneksi bermasalah.';
    }

    if (outputContextEl) {
      outputContextEl.textContent = outputs.contextPass || 'Context diteruskan ke simpul downstream berikutnya.';
    }

    // 3. LOGIKA DATABASE & TRACING
    const dbFuncEl = document.getElementById('node-prop-db-func');
    if (dbFuncEl) dbFuncEl.textContent = node.dbFunction || 'Custom Logic';

    const dbTypeEl = document.getElementById('node-prop-db-type');
    if (dbTypeEl) dbTypeEl.textContent = node.dbType || 'PL/pgSQL';

    const sigEl = document.getElementById('node-prop-signature');
    if (sigEl) sigEl.textContent = node.signature || '$1: run_id, $2: config_id';

    const tablesEl = document.getElementById('node-prop-tables');
    if (tablesEl) tablesEl.textContent = node.tablesInvolved || '-';

    const descEl = document.getElementById('node-prop-desc');
    if (descEl) descEl.textContent = node.description || 'Tidak ada deskripsi teknis khusus.';

    // 4. FORM EDITABLE KONFIGURASI SIMPUL
    const labelInput = document.getElementById('node-prop-input-label');
    const batchInput = document.getElementById('node-prop-input-batch');
    const onerrorInput = document.getElementById('node-prop-input-onerror');
    if (labelInput) labelInput.value = node.label || '';
    if (batchInput) batchInput.value = node.batchSize || 1000;
    if (onerrorInput) onerrorInput.value = node.onError || 'ABORT';

    modal.classList.remove('hidden');
  }

  /**
   * Render Inspector Panel (Fallback compatibility)
   */
  renderInspector() {
    const inspectorEl = document.getElementById('canvas-inspector-body');
    if (!inspectorEl) return;

    const node = this.currentNodes.find(n => n.id === this.selectedNodeId);
    if (!node) {
      inspectorEl.innerHTML = `
        <div style="text-align: center; color: #64748b; padding: 2rem 0;">
          <div style="font-size: 2rem; margin-bottom: 0.5rem;">👆</div>
          <p>Klik salah satu simpul pada kanvas untuk melihat rincian fungsi database, parameter runtime tertangkap, dan konfigurasinya.</p>
        </div>
      `;
      return;
    }

    const stateBadgeColor = node.lastState === 'SUCCESS' ? '#10b981' : (node.lastState === 'RUNNING' ? '#38bdf8' : (node.lastState === 'FAILED' ? '#f43f5e' : '#94a3b8'));
    const stateBadgeBg = node.lastState === 'SUCCESS' ? 'rgba(16, 185, 129, 0.15)' : (node.lastState === 'RUNNING' ? 'rgba(56, 189, 248, 0.15)' : (node.lastState === 'FAILED' ? 'rgba(244, 63, 94, 0.15)' : 'rgba(148, 163, 184, 0.1)'));

    let paramsRowsHtml = '';
    if (node.lastParams && typeof node.lastParams === 'object') {
      const pEntries = Object.entries(node.lastParams);
      if (pEntries.length > 0) {
        paramsRowsHtml = pEntries.map(([k, v]) => {
          let valDisplay = typeof v === 'object' && v !== null ? JSON.stringify(v) : String(v);
          return `
            <div class="tracing-row" style="font-size: 0.72rem; padding: 3px 0; border-bottom: 1px solid rgba(255,255,255,0.04);">
              <span class="tracing-label" style="color: #cbd5e1; font-family: monospace; min-width: 110px;">${k}:</span>
              <span class="tracing-val" style="color: #38bdf8; font-weight: 600; font-family: monospace; word-break: break-all;">${valDisplay}</span>
            </div>
          `;
        }).join('');
      }
    }

    inspectorEl.innerHTML = `
      <!-- Runtime Execution State & Captured Parameters -->
      <div class="inspector-tracing-box" style="background: rgba(15, 23, 42, 0.7); border: 1px solid rgba(167, 139, 250, 0.3); box-shadow: 0 4px 12px rgba(0,0,0,0.25); margin-bottom: 12px;">
        <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 1px solid rgba(167, 139, 250, 0.2); padding-bottom: 5px; margin-bottom: 8px;">
          <span style="font-size: 0.72rem; font-weight: 800; color: #a78bfa; text-transform: uppercase; letter-spacing: 0.5px;">
            ⚡ Runtime State & Parameters
          </span>
          <span style="font-size: 0.68rem; font-weight: 700; padding: 2px 8px; border-radius: 999px; color: ${stateBadgeColor}; background: ${stateBadgeBg}; border: 1px solid ${stateBadgeColor}40;">
            ${node.lastState || 'IDLE / PENDING'}
          </span>
        </div>

        <div class="tracing-row">
          <span class="tracing-label">Durasi Terakhir:</span>
          <span class="tracing-val" style="color: #f1f5f9; font-weight: 700;">${node.lastElapsed != null ? node.lastElapsed + ' ms' : '-'}</span>
        </div>
        ${node.lastMetric ? `
          <div class="tracing-row">
            <span class="tracing-label">Throughput Realtime:</span>
            <span class="tracing-val" style="color: #38bdf8; font-weight: 700;">${node.lastMetric}</span>
          </div>
        ` : ''}
        ${node.lastError ? `
          <div class="tracing-row">
            <span class="tracing-label" style="color: #f43f5e;">Pesan Error:</span>
            <span class="tracing-val" style="color: #f43f5e; font-weight: 700;">${node.lastError}</span>
          </div>
        ` : ''}

        <div style="margin-top: 8px; border-top: 1px dashed rgba(255,255,255,0.08); padding-top: 6px;">
          <div style="font-size: 0.68rem; font-weight: 700; color: #94a3b8; margin-bottom: 4px; text-transform: uppercase;">
            Parameter Tertangkap (In/Out):
          </div>
          <div style="max-height: 160px; overflow-y: auto; padding-right: 4px;">
            ${paramsRowsHtml || '<div style="font-size: 0.7rem; color: #64748b; font-style: italic; padding: 4px 0;">Belum ada parameter (simpul belum dieksekusi).</div>'}
          </div>
        </div>
      </div>

      <!-- Tracing Database Section (Bug #4) -->
      <div class="inspector-tracing-box">
        <div style="font-size: 0.72rem; font-weight: 800; color: #38bdf8; text-transform: uppercase; border-bottom: 1px solid rgba(56, 189, 248, 0.2); padding-bottom: 4px; margin-bottom: 4px;">
          🔍 Database Tracing & Logic
        </div>
        <div class="tracing-row">
          <span class="tracing-label">Fungsi / Stored Procedure:</span>
          <span class="tracing-val" style="color: #38bdf8;">${node.dbFunction || 'N/A'}</span>
        </div>
        <div class="tracing-row">
          <span class="tracing-label">Tipe Eksekusi:</span>
          <span class="tracing-val">${node.dbType || 'PL/pgSQL'}</span>
        </div>
        <div class="tracing-row">
          <span class="tracing-label">Parameter Binding:</span>
          <span class="tracing-val">${node.signature || '$1: run_id, $2: config_id'}</span>
        </div>
        <div class="tracing-row">
          <span class="tracing-label">Tabel Terkait:</span>
          <span class="tracing-val">${node.tablesInvolved || 'N/A'}</span>
        </div>
        <div class="tracing-row">
          <span class="tracing-label">Audit Log Step:</span>
          <span class="tracing-val">migration_step_log [${node.auditStep || node.type}]</span>
        </div>
      </div>

      <div class="inspector-group">
        <label class="inspector-label">Label Simpul:</label>
        <input type="text" class="inspector-input" id="insp-node-label" value="${node.label}">
      </div>

      <div class="inspector-group">
        <label class="inspector-label">Tipe Simpul:</label>
        <input type="text" class="inspector-input" value="${node.type}" disabled style="opacity: 0.7;">
      </div>

      <div class="inspector-group">
        <label class="inspector-label">Deskripsi Teknis:</label>
        <div style="font-size: 0.72rem; color: #94a3b8; line-height: 1.4; background: rgba(0,0,0,0.2); padding: 6px; border-radius: 4px;">
          ${node.description || 'Tidak ada deskripsi teknis.'}
        </div>
      </div>

      <div class="inspector-group">
        <label class="inspector-label">Kondisi On-Error:</label>
        <select class="inspector-select" id="insp-node-onerror">
          <option value="ABORT" selected>Hentikan Alur & Tandai FAILED</option>
          <option value="ROLLBACK">Trigger Auto-Rollback Target</option>
        </select>
      </div>

      <div class="inspector-group">
        <label class="inspector-label">Ukuran Batch (Chunk Size):</label>
        <input type="number" class="inspector-input" id="insp-node-batchsize" value="${node.batchSize || 1000}" min="100" max="10000" step="100">
      </div>

      <div style="margin-top: 0.5rem; padding-top: 0.75rem; border-top: 1px solid rgba(255,255,255,0.08);">
        <button class="btn btn-secondary btn-sm" style="width: 100%;" id="btn-save-node-prop">Simpan Konfigurasi Simpul</button>
      </div>
    `;

    document.getElementById('btn-save-node-prop')?.addEventListener('click', () => {
      const newLabel = document.getElementById('insp-node-label').value;
      const newBatch = parseInt(document.getElementById('insp-node-batchsize').value, 10);
      node.label = newLabel;
      node.batchSize = newBatch;
      this.renderGraph();
      this.logConsole('SUCCESS', `Konfigurasi simpul "${node.id}" berhasil disimpan.`);
    });
  }

  /**
   * Buka Modal Form Parameter Eksekusi (Bug #1 Fix: Memuat parameter secara instan & reliabel)
   */
  async openExecutionParamsModal() {
    const modal = document.getElementById('modal-flow-execute-params');
    const body = document.getElementById('modal-flow-params-body');
    const subtitle = document.getElementById('modal-flow-params-subtitle');
    if (!modal || !body) return;

    const ctx = this.getActiveContext();
    subtitle.innerHTML = `Pilih parameter alur: <strong style="color: #0f172a;">${this.currentPresetId}</strong> &bull; Tenant: <span class="badge" style="background: #ecfdf5; color: #065f46; border: 1px solid #a7f3d0; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">🏢 [${ctx.clientCode}] ${ctx.clientName}</span> &bull; <span class="badge" style="background: #f5f3ff; color: #6b21a8; border: 1px solid #ddd6fe; font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 4px;">🌐 [${ctx.envCode}] ${ctx.envName}</span>`;
    body.innerHTML = '<div style="text-align:center; padding: 2rem;"><span class="loading-spinner"></span> Memuat data parameter konfigurasi...</div>';
    modal.classList.remove('hidden');

    let configs = [];
    let runs = [];

    try {
      // 1. Fetch cepat dari API /api/etl/configs dan /api/etl/runs sesuai Client & Env terpilih
      const params = [];
      if (ctx.clientId) params.push(`clientId=${ctx.clientId}`);
      if (ctx.envId) params.push(`envId=${ctx.envId}`);
      const qs = params.length > 0 ? `?${params.join('&')}` : '';

      const [cfgRes, runRes] = await Promise.all([
        fetch(`/api/etl/configs${qs}`).then(r => r.json()).catch(() => null),
        fetch(`/api/etl/runs${qs}${params.length > 0 ? '&' : '?'}limit=50`).then(r => r.json()).catch(() => null)
      ]);

      if (cfgRes?.success && cfgRes.data) {
        if (Array.isArray(cfgRes.data)) {
          configs = cfgRes.data;
        } else if (Array.isArray(cfgRes.data.migration_config)) {
          configs = cfgRes.data.migration_config;
        } else if (Array.isArray(cfgRes.data.pipelines)) {
          configs = cfgRes.data.pipelines;
        }
      }

      if (runRes?.success && runRes.data) {
        if (Array.isArray(runRes.data)) {
          runs = runRes.data;
        } else if (Array.isArray(runRes.data.runs)) {
          runs = runRes.data.runs;
        }
      }
    } catch (e) {
      console.warn('Gagal memuat data parameter dinamis dari backend:', e);
    }

    // Pastikan selalu bertipe Array agar tidak error .map() atau .filter()
    if (!Array.isArray(configs)) configs = [];
    if (!Array.isArray(runs)) runs = [];

    const currentFlow = this.currentPresetId;
    let fieldsHtml = '';

    try {
      // Field untuk Flow 1 (Butuh Config ID / ALL)
      if (currentFlow === 'flow_1_staging') {
        const postedMap = new Map();
        runs.forEach(r => {
          if (r.is_posted && !r.is_rolled_back) {
            postedMap.set(parseInt(r.config_id, 10), r.run_id);
          }
        });

        let cfgOptionsHtml = '';
        if (configs.length === 0) {
          cfgOptionsHtml = `
            <div class="p-3 text-center text-xs" style="color: #fbbf24; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); border-radius: 6px; margin: 8px;">
              ⚠️ <strong>Belum ada tabel konfigurasi untuk Client [${ctx.clientCode}] di Environment [${ctx.envCode}].</strong><br>
              <span class="text-muted text-xs">Silakan daftarkan konfigurasi tabel pada tab <strong>2. Migration Config</strong>.</span>
            </div>
          `;
        } else {
          cfgOptionsHtml = configs.map((c, idx) => {
            const postedRunId = postedMap.get(parseInt(c.config_id, 10));
            const badge = postedRunId ? `<span class="badge text-xs ml-2" style="background: #fef3c7; color: #92400e; border: 1px solid #fcd34d; font-weight: 700; padding: 3px 8px; border-radius: 4px; font-size: 11px;">⚠️ Diposting (Run #${postedRunId})</span>` : '';
            const isChecked = idx === 0 ? 'checked' : '';
            const isSelectedClass = idx === 0 ? 'is-selected' : '';
            const labelText = `#${c.config_id} - ${c.src_schema ? c.src_schema + '.' : ''}${c.src_view || c.src_name || 'view'} ➔ ${c.tgt_schema ? c.tgt_schema + '.' : ''}${c.tgt_table || 'table'}`;
            const shortLabel = `#${c.config_id} ${c.tgt_table || c.src_view || 'Config'}`;

            return `
              <div class="multiselect-option ${isSelectedClass}" data-id="${c.config_id}" data-short="${shortLabel}" data-full="${labelText}">
                <div class="multiselect-option-left" style="color: #0f172a;">
                  <input type="checkbox" name="param-config-checkbox" value="${c.config_id}" ${isChecked} style="width: 16px; height: 16px; cursor: pointer; accent-color: #0284c7; pointer-events: none;">
                  <span style="font-weight: 600; font-size: 13px; color: #0f172a;">${labelText}</span>
                </div>
                <div>${badge}</div>
              </div>
            `;
          }).join('');
        }

        fieldsHtml += `
          <div class="form-group mb-3">
            <label class="form-label font-bold" style="margin-bottom: 6px;">1. Pilih Konfigurasi Migrasi (Select Box) <span class="text-danger">*</span></label>
            
            <div class="multiselect-container" id="config-multiselect">
              <!-- Trigger display Select Box -->
              <div class="multiselect-trigger" id="config-multiselect-trigger" title="Klik untuk membuka pilihan konfigurasi">
                <div id="config-multiselect-tags" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;"></div>
                <span class="multiselect-placeholder" id="config-multiselect-placeholder" style="display: none;">Pilih konfigurasi migrasi...</span>
                <span class="multiselect-chevron">▼</span>
              </div>
              
              <!-- Dropdown Menu Popover -->
              <div class="multiselect-dropdown" id="config-multiselect-dropdown">
                <div class="multiselect-header">
                  <input type="text" class="multiselect-search-input" id="config-search-input" placeholder="🔍 Cari tabel sumber/target..." autocomplete="off">
                  <div style="display: flex; gap: 6px;">
                    <button type="button" class="btn btn-xs" id="btn-select-all-configs" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border: 1px solid #0284c7; color: #0284c7; background: #f0f9ff; border-radius: 4px; cursor: pointer;">✓ Pilih Semua</button>
                    <button type="button" class="btn btn-xs" id="btn-clear-all-configs" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border: 1px solid #94a3b8; color: #475569; background: #f8fafc; border-radius: 4px; cursor: pointer;">✗ Batal Semua</button>
                  </div>
                </div>
                
                <div class="multiselect-options-list" id="config-options-list">
                  ${cfgOptionsHtml}
                </div>
                
                <div class="multiselect-footer">
                  <span id="config-selection-count">${configs.length > 0 ? '1 konfigurasi terpilih' : '0 konfigurasi'}</span>
                  <span class="text-xs text-muted">Klik opsi untuk toggle item</span>
                </div>
              </div>
            </div>
            
            <div class="form-hint text-xs text-muted mt-1">Pilih 1 konfigurasi untuk migrasi tunggal, atau pilih beberapa untuk batch terurut. Hapus item via tombol ✕ pada tag.</div>
          </div>

          <div class="grid grid-2 gap-3 mb-3">
            <div class="form-group">
              <label class="form-label font-semibold">🏢 Client Code <span class="text-danger">*</span></label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="text" id="param-client-code" class="form-control" value="${escapeHtml(ctx.clientCode)}" readonly style="background: rgba(30, 41, 59, 0.7); cursor: not-allowed; font-weight: 700; color: #6ee7b7; border-color: rgba(16, 185, 129, 0.4);">
                <span class="badge text-xs" style="background: rgba(16, 185, 129, 0.15); color: #6ee7b7; border: 1px solid rgba(16, 185, 129, 0.3); padding: 6px 8px; border-radius: 6px; white-space: nowrap;">🔒 Terikat Header</span>
              </div>
            </div>
            <div class="form-group">
              <label class="form-label font-semibold">🌐 Environment Code <span class="text-danger">*</span></label>
              <div style="display: flex; align-items: center; gap: 8px;">
                <input type="text" id="param-env-code" class="form-control" value="${escapeHtml(ctx.envCode)}" readonly style="background: rgba(30, 41, 59, 0.7); cursor: not-allowed; font-weight: 700; color: #d8b4fe; border-color: rgba(168, 85, 247, 0.4);">
                <span class="badge text-xs" style="background: rgba(168, 85, 247, 0.15); color: #d8b4fe; border: 1px solid rgba(168, 85, 247, 0.3); padding: 6px 8px; border-radius: 6px; white-space: nowrap;">🔒 Terikat Header</span>
              </div>
            </div>
          </div>
          <input type="hidden" id="param-client-id" value="${ctx.clientId || ''}">
          <input type="hidden" id="param-env-id" value="${ctx.envId || ''}">
        `;
      }

      // Field untuk Flow 2 (Post ke Target - Butuh Run ID, Mode Batch, Batch Size)
      if (currentFlow === 'flow_2_post') {
        // Filter cerdas:
        // 1. HANYA sesi berstatus SUCCESS, belum diposting, dan belum di-rollback
        // 2. Abaikan sesi yang sudah KADALUARSA / SUPERSEDED (karena staging table ditimpa oleh run baru)
        // 3. Hanya ambil 1 SESI TERBARU per konfigurasi tabel (1 sesi per config_id)
        const activeRunsByConfig = new Map();
        const sortedRuns = [...runs].sort((a, b) => parseInt(b.run_id, 10) - parseInt(a.run_id, 10));

        sortedRuns.forEach(r => {
          const isSuccess = r.status === 'SUCCESS';
          const notPosted = !r.is_posted;
          const notRolledBack = !r.is_rolled_back;
          const isSuperseded = r.note && (r.note.includes('SUPERSEDED') || r.note.includes('KADALUARSA'));

          if (isSuccess && notPosted && notRolledBack && !isSuperseded) {
            const cfgKey = String(r.config_id || 'UNKNOWN');
            if (!activeRunsByConfig.has(cfgKey)) {
              activeRunsByConfig.set(cfgKey, r);
            }
          }
        });

        const eligiblePostRuns = Array.from(activeRunsByConfig.values());

        if (currentFlow === 'flow_2_post') {
          let runOptionsHtml = '';
          if (eligiblePostRuns.length === 0) {
            runOptionsHtml = `
              <div class="p-3 text-center text-xs" style="color: #fbbf24; background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); border-radius: 6px; margin: 8px;">
                ⚠️ <strong>Tidak ada sesi staging berstatus SUCCESS yang siap diposting.</strong><br>
                <span class="text-muted text-xs">Pastikan Anda telah menjalankan Flow 1 (Staging & Convert) hingga tuntas dan belum pernah diposting.</span>
              </div>
            `;
          } else {
            runOptionsHtml = eligiblePostRuns.map((r, idx) => {
              const isChecked = idx === 0 ? 'checked' : '';
              const isSelectedClass = idx === 0 ? 'is-selected' : '';
              const stgCount = (r.rows_staging || r.rows_stg) ? `${Number(r.rows_staging || r.rows_stg).toLocaleString()} baris` : 'Siap Post';
              const labelText = `Run #${r.run_id} (${r.run_ts || '-'}) - Config #${r.config_id || '?'} [${stgCount}]`;
              const shortLabel = `Run #${r.run_id} (Cfg #${r.config_id || '?'})`;

              return `
                <div class="multiselect-option ${isSelectedClass}" data-id="${r.run_id}" data-short="${shortLabel}" data-full="${labelText}">
                  <div class="multiselect-option-left" style="color: #0f172a;">
                    <input type="checkbox" name="param-run-checkbox" value="${r.run_id}" ${isChecked} style="width: 16px; height: 16px; cursor: pointer; accent-color: #0284c7; pointer-events: none;">
                    <div>
                      <span style="font-weight: 700; font-size: 13px; color: #0f172a;">Run #${r.run_id}</span>
                      <span style="font-size: 12px; color: #475569; margin-left: 6px;">Config #${r.config_id || '?'} &bull; ${stgCount} &bull; ${r.run_ts || '-'}</span>
                    </div>
                  </div>
                  <div>
                    <span class="badge text-xs" style="background: #dcfce7; color: #166534; border: 1px solid #86efac; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 11px;">✓ SUCCESS</span>
                  </div>
                </div>
              `;
            }).join('');
          }

          fieldsHtml += `
            <div class="form-group mb-3">
              <label class="form-label font-bold" style="margin-bottom: 6px;">
                1. Pilih Sesi Staging (RUN_ID) <span class="text-danger">*</span>
                <span class="badge text-xs ml-2" style="background: rgba(16,185,129,0.2); color: #34d399; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Filter: HANYA SUCCESS TERBARU (1 PER CONFIG)</span>
              </label>

              <div class="multiselect-container" id="run-multiselect">
                <!-- Trigger display Select Box -->
                <div class="multiselect-trigger" id="run-multiselect-trigger" title="Klik untuk membuka pilihan Run ID">
                  <div id="run-multiselect-tags" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;"></div>
                  <span class="multiselect-placeholder" id="run-multiselect-placeholder" style="display: none;">Pilih satu atau beberapa Run ID...</span>
                  <span class="multiselect-chevron">▼</span>
                </div>

                <!-- Dropdown Menu Popover -->
                <div class="multiselect-dropdown" id="run-multiselect-dropdown">
                  <div class="multiselect-header">
                    <input type="text" class="multiselect-search-input" id="run-search-input" placeholder="🔍 Cari Run ID, Config, Waktu..." autocomplete="off">
                    <div style="display: flex; gap: 6px;">
                      <button type="button" class="btn btn-xs" id="btn-select-all-runs" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border: 1px solid #0284c7; color: #0284c7; background: #f0f9ff; border-radius: 4px; cursor: pointer;">✓ Pilih Semua</button>
                      <button type="button" class="btn btn-xs" id="btn-clear-all-runs" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border: 1px solid #94a3b8; color: #475569; background: #f8fafc; border-radius: 4px; cursor: pointer;">✗ Batal Semua</button>
                    </div>
                  </div>

                  <div class="multiselect-options-list" id="run-options-list">
                    ${runOptionsHtml}
                  </div>

                  <div class="multiselect-footer">
                    <span id="run-selection-count">0 Run ID dipilih</span>
                    <span class="text-xs text-muted">Hanya sesi staging aktif terbaru (belum kadaluarsa)</span>
                  </div>
                </div>
              </div>

              <div class="form-hint text-xs text-muted mt-1">Pilih 1 Run ID untuk migrasi tunggal, atau pilih beberapa untuk batch multi-run terurut. Sesi yang sudah diposting atau di-rollback otomatis difilter keluar.</div>
            </div>
          `;
        }

        fieldsHtml += `
          <div class="form-group mb-3">
            <label class="form-label font-bold">Mode Posting Target (USE_BATCH) <span class="text-danger">*</span></label>
            <div class="flex gap-4 mt-1">
              <label class="flex-center gap-2 cursor-pointer">
                <input type="radio" name="param-use-batch" value="Y" checked>
                <span class="text-sm font-semibold">BATCH (Chunking Aman)</span>
              </label>
              <label class="flex-center gap-2 cursor-pointer">
                <input type="radio" name="param-use-batch" value="N">
                <span class="text-sm font-semibold">DIRECT (Sekaligus)</span>
              </label>
            </div>
          </div>

          <div class="form-group mb-3" id="param-batch-size-group">
            <label class="form-label font-semibold">Ukuran Batch (BATCH_SIZE) <span class="text-danger">*</span></label>
            <input type="number" id="param-batch-size" class="form-control" value="1000" min="100" max="10000" step="100" required>
            <div class="form-hint text-xs text-muted mt-1">Standar: 1.000 baris per iterasi untuk mencegah OOM dan lock timeout.</div>
          </div>
        `;
      }

      // Field untuk Flow 3 (Rollback - Multi-Select Run ID yang sudah di-post)
      if (currentFlow === 'flow_3_rollback') {
        const eligibleRollbackRuns = runs.filter(r => r.is_posted && !r.is_rolled_back);
        const candidateRollbackRuns = eligibleRollbackRuns;

        let rbOptionsHtml = '';
        if (candidateRollbackRuns.length === 0) {
          rbOptionsHtml = `
            <div class="p-3 text-center text-xs text-muted">
              Tidak ada sesi migrasi yang siap di-rollback (seluruh sesi belum diposting atau sudah pernah di-rollback).
            </div>
          `;
        } else {
          rbOptionsHtml = candidateRollbackRuns.map((r, idx) => {
            const isChecked = idx === 0 ? 'checked' : '';
            const cfgName = r.name_config || (r.tgt_table ? `Table ${r.tgt_table}` : `Config #${r.config_id || 1}`);
            const postInfo = r.posted_at ? new Date(r.posted_at).toLocaleString() : 'Terposting';
            const postMode = r.post_type || 'DIRECT';

            return `
              <div class="multiselect-option ${isChecked ? 'is-selected' : ''}" 
                   data-id="${r.run_id}" 
                   data-short="Run #${r.run_id}" 
                   data-full="Run #${r.run_id} - ${cfgName} [${postInfo}]">
                <input type="checkbox" name="param-rollback-run-checkbox" value="${r.run_id}" ${isChecked} style="width: 16px; height: 16px; cursor: pointer; accent-color: #e11d48; pointer-events: none;">
                <div class="flex-1 multiselect-option-left" style="color: #0f172a;">
                  <div class="font-bold text-sm" style="color: #0f172a;">Run #${r.run_id} (${r.run_ts || '-'})</div>
                  <div class="text-xs" style="color: #475569;">${cfgName} &bull; Diposting: ${postInfo} &bull; Mode: ${postMode}</div>
                </div>
                <div>
                  <span class="badge text-xs" style="background: #ffe4e6; color: #9f1239; border: 1px solid #fecdd3; font-weight: 700; padding: 2px 8px; border-radius: 4px; font-size: 11px;">READY TO ROLLBACK</span>
                </div>
              </div>
            `;
          }).join('');
        }

        fieldsHtml += `
          <div class="p-3 mb-3 rounded border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs">
            ⚠️ <strong>PERINGATAN SAFE ROLLBACK:</strong> Seluruh data target yang diposting oleh Run ID terpilih akan dihapus (urutan DESC). Data produksi asli non-migrasi dijamin tetap 100% aman.
          </div>

          <div class="form-group mb-3">
            <label class="form-label font-bold" style="margin-bottom: 6px;">
              Pilih Sesi Yang Akan Di-Rollback (RUN_ID) <span class="text-danger">*</span>
              <span class="badge text-xs ml-2" style="background: rgba(244,63,94,0.2); color: #fb7185; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Filter: HANYA YANG SUDAH DIPOSTING</span>
            </label>

            <div class="multiselect-container" id="rollback-run-multiselect">
              <!-- Trigger display Select Box -->
              <div class="multiselect-trigger" id="rollback-run-multiselect-trigger" title="Klik untuk membuka pilihan Run ID">
                <div id="rollback-run-multiselect-tags" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;"></div>
                <span class="multiselect-placeholder" id="rollback-run-multiselect-placeholder" style="display: none;">Pilih satu atau beberapa Run ID untuk di-rollback...</span>
                <span class="multiselect-chevron">▼</span>
              </div>

              <!-- Dropdown Menu Popover -->
              <div class="multiselect-dropdown" id="rollback-run-multiselect-dropdown">
                <div class="multiselect-header">
                  <input type="text" class="multiselect-search-input" id="rollback-run-search-input" placeholder="🔍 Cari Run ID, Config, Waktu..." autocomplete="off">
                  <div style="display: flex; gap: 6px;">
                    <button type="button" class="btn btn-xs" id="btn-select-all-rollback-runs" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border: 1px solid #e11d48; color: #e11d48; background: #fff1f2; border-radius: 4px; cursor: pointer;">✓ Pilih Semua</button>
                    <button type="button" class="btn btn-xs" id="btn-clear-all-rollback-runs" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border: 1px solid #94a3b8; color: #475569; background: #f8fafc; border-radius: 4px; cursor: pointer;">✗ Batal Semua</button>
                  </div>
                </div>

                <div class="multiselect-options-list" id="rollback-run-options-list">
                  ${rbOptionsHtml}
                </div>

                <div class="multiselect-footer">
                  <span id="rollback-run-selection-count">0 Run ID dipilih</span>
                  <span class="text-xs text-muted">Hanya sesi berstatus is_posted = true & belum di-rollback</span>
                </div>
              </div>
            </div>

            <div class="form-hint text-xs text-muted mt-1">Pilih 1 Run ID untuk pembatalan tunggal, atau pilih beberapa untuk batch rollback berulang (looping) secara aman.</div>
          </div>

          <div class="form-group mb-3">
            <label class="flex-center gap-2 cursor-pointer text-xs">
              <input type="checkbox" id="param-confirm-rollback" required>
              <span>Saya mengonfirmasi untuk melakukan pembatalan dan penghapusan data target sesi terpilih.</span>
            </label>
          </div>
        `;
      }

      // Field untuk Flow 4 (Purge Target - Mendukung Multi-Select Config ID)
      if (currentFlow === 'flow_4_purge') {
        const purgeOptionsHtml = configs.map((c, idx) => {
          const isChecked = idx === 0 ? 'checked' : '';
          const isSelectedClass = idx === 0 ? 'is-selected' : '';
          const labelText = `#${c.config_id} - ${c.tgt_schema ? c.tgt_schema + '.' : ''}${c.tgt_table || 'table'} (Staging: ${c.stg_table || 'N/A'})`;
          const shortLabel = `#${c.config_id} ${c.tgt_table || 'Table'}`;

          return `
            <div class="multiselect-option ${isSelectedClass}" data-id="${c.config_id}" data-short="${shortLabel}" data-full="${labelText}">
              <div class="multiselect-option-left">
                <input type="checkbox" name="param-purge-config-checkbox" value="${c.config_id}" ${isChecked} style="width: 16px; height: 16px; cursor: pointer; accent-color: #f43f5e; pointer-events: none;">
                <div>
                  <span style="font-weight: 600; font-size: 13px; color: #0f172a;">Config #${c.config_id}</span>
                  <span style="font-size: 12px; color: #64748b; margin-left: 6px;">${c.tgt_schema ? c.tgt_schema + '.' : ''}${c.tgt_table || 'table'}</span>
                </div>
              </div>
              <div>
                <span class="badge text-xs" style="background: rgba(244,63,94,0.12); color: #e11d48; padding: 2px 6px; border-radius: 4px; font-size: 11px;">TARGET PURGE</span>
              </div>
            </div>
          `;
        }).join('');

        fieldsHtml += `
          <div class="p-3 mb-3 rounded border border-rose-500/30 bg-rose-50 text-rose-700 text-xs" style="background: rgba(244,63,94,0.06); border: 1px solid rgba(244,63,94,0.25); color: #be123c;">
            🗑️ <strong>DUAL-GUARD TARGET PURGE:</strong> Hanya menghapus data migrasi ber-flag <code>migration = '1'</code>. Data produksi operasional dijamin 100% aman dan tidak tersentuh.
          </div>

          <div class="form-group mb-3">
            <label class="form-label font-bold" style="margin-bottom: 6px;">
              1. Pilih Target Konfigurasi Tabel (CONFIG_ID) <span class="text-danger">*</span>
              <span class="badge text-xs ml-2" style="background: rgba(2,132,199,0.1); color: #0284c7; padding: 2px 6px; border-radius: 4px; font-size: 11px;">Mendukung Looping Multi-Select</span>
            </label>

            <div class="multiselect-container" id="purge-config-multiselect">
              <!-- Trigger display Select Box -->
              <div class="multiselect-trigger" id="purge-config-multiselect-trigger" title="Klik untuk membuka pilihan tabel target">
                <div id="purge-config-multiselect-tags" style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;"></div>
                <span class="multiselect-placeholder" id="purge-config-multiselect-placeholder" style="display: none;">Pilih satu atau beberapa tabel target...</span>
                <span class="multiselect-chevron">▼</span>
              </div>

              <!-- Dropdown Menu Popover -->
              <div class="multiselect-dropdown" id="purge-config-multiselect-dropdown">
                <div class="multiselect-header">
                  <input type="text" class="multiselect-search-input" id="purge-config-search-input" placeholder="🔍 Cari tabel target..." autocomplete="off">
                  <div style="display: flex; gap: 6px;">
                    <button type="button" class="btn btn-xs" id="btn-select-all-purge-configs" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border: 1px solid #e11d48; color: #e11d48; background: #fff1f2; border-radius: 4px; cursor: pointer;">✓ Pilih Semua</button>
                    <button type="button" class="btn btn-xs" id="btn-clear-all-purge-configs" style="padding: 3px 10px; font-size: 11px; font-weight: 700; border: 1px solid #94a3b8; color: #475569; background: #f8fafc; border-radius: 4px; cursor: pointer;">✗ Batal Semua</button>
                  </div>
                </div>

                <div class="multiselect-options-list" id="purge-config-options-list">
                  ${purgeOptionsHtml}
                </div>

                <div class="multiselect-footer">
                  <span id="purge-config-selection-count">0 tabel dipilih</span>
                  <span class="text-xs text-muted">Looping per-config & aman dengan isolasi error</span>
                </div>
              </div>
            </div>

            <div class="form-hint text-xs text-muted mt-1">Pilih 1 konfigurasi untuk purge tunggal, atau pilih beberapa untuk eksekusi looping per-tabel otomatis.</div>
          </div>

          <div class="form-group mb-3">
            <label class="form-label font-semibold">2. Spesifik ID Yang Dihapus (DELETE_IDS) <span class="text-muted" style="font-weight: 400; font-size: 11px;">(Opsional)</span></label>
            <input type="text" id="param-delete-ids" class="form-control" placeholder="Contoh: 00001031, 00001032 (Kosongkan untuk hapus semua data ber-flag migrasi)">
            <div class="form-hint text-xs text-muted mt-1">Kosongkan kolom ini jika ingin membersihkan seluruh data migrasi pada tabel-tabel terpilih.</div>
          </div>
        `;
      }

      body.innerHTML = fieldsHtml;

      // Inisialisasi Custom Multi-Select Dropdown Helper
      const setupMultiSelect = (cfg) => {
        const msContainer = document.getElementById(cfg.containerId);
        if (!msContainer) return;

        const trigger = document.getElementById(cfg.triggerId);
        const tagsContainer = document.getElementById(cfg.tagsId);
        const placeholder = document.getElementById(cfg.placeholderId);
        const searchInput = document.getElementById(cfg.searchInputId);
        const optionsList = document.getElementById(cfg.optionsListId);
        const countSpan = document.getElementById(cfg.countSpanId);
        const selectAllBtn = document.getElementById(cfg.selectAllBtnId);
        const clearAllBtn = document.getElementById(cfg.clearAllBtnId);
        const options = optionsList ? optionsList.querySelectorAll('.multiselect-option') : [];

        // Fungsi memperbarui visual tags/pills di dalam select box
        const updateVisuals = () => {
          const selectedOpts = [];
          options.forEach(opt => {
            const cb = opt.querySelector(`input[name="${cfg.checkboxName}"]`);
            if (cb && cb.checked) {
              selectedOpts.push({
                id: opt.getAttribute('data-id'),
                short: opt.getAttribute('data-short'),
                full: opt.getAttribute('data-full')
              });
              opt.classList.add('is-selected');
            } else {
              opt.classList.remove('is-selected');
            }
          });

          // Render tags
          if (selectedOpts.length === 0) {
            tagsContainer.innerHTML = '';
            if (placeholder) placeholder.style.display = 'block';
            if (countSpan) countSpan.textContent = `0 ${cfg.entityLabel} dipilih`;
          } else {
            if (placeholder) placeholder.style.display = 'none';
            tagsContainer.innerHTML = selectedOpts.map(item => `
              <span class="multiselect-tag" title="${item.full}">
                ${item.short}
                <span class="multiselect-tag-remove" data-id="${item.id}" title="Hapus">&times;</span>
              </span>
            `).join('');
            if (countSpan) countSpan.textContent = `${selectedOpts.length} dari ${options.length} ${cfg.entityLabel} dipilih`;
          }
        };

        // Render initial tags
        updateVisuals();

        // Toggle dropdown saat trigger diklik
        trigger?.addEventListener('click', (e) => {
          if (e.target.closest('.multiselect-tag-remove')) return;
          msContainer.classList.toggle('is-open');
          if (msContainer.classList.contains('is-open') && searchInput) {
            searchInput.focus();
          }
        });

        // Event hapus tag via tombol [x]
        tagsContainer?.addEventListener('click', (e) => {
          const removeBtn = e.target.closest('.multiselect-tag-remove');
          if (removeBtn) {
            e.stopPropagation();
            const removeId = removeBtn.getAttribute('data-id');
            const targetOpt = optionsList.querySelector(`.multiselect-option[data-id="${removeId}"]`);
            if (targetOpt) {
              const cb = targetOpt.querySelector(`input[name="${cfg.checkboxName}"]`);
              if (cb) cb.checked = false;
            }
            updateVisuals();
          }
        });

        // Toggle opsi saat baris dropdown diklik
        optionsList?.addEventListener('click', (e) => {
          const opt = e.target.closest('.multiselect-option');
          if (opt) {
            const cb = opt.querySelector(`input[name="${cfg.checkboxName}"]`);
            if (cb) {
              cb.checked = !cb.checked;
              updateVisuals();
            }
          }
        });

        // Search filter live
        searchInput?.addEventListener('input', (e) => {
          const q = e.target.value.toLowerCase().trim();
          options.forEach(opt => {
            const txt = (opt.getAttribute('data-full') || '').toLowerCase();
            opt.style.display = txt.includes(q) ? 'flex' : 'none';
          });
        });

        // Tombol Pilih Semua
        selectAllBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          options.forEach(opt => {
            if (opt.style.display !== 'none') {
              const cb = opt.querySelector(`input[name="${cfg.checkboxName}"]`);
              if (cb) cb.checked = true;
            }
          });
          updateVisuals();
        });

        // Tombol Batal Semua
        clearAllBtn?.addEventListener('click', (e) => {
          e.stopPropagation();
          options.forEach(opt => {
            const cb = opt.querySelector(`input[name="${cfg.checkboxName}"]`);
            if (cb) cb.checked = false;
          });
          updateVisuals();
        });

        // Tutup dropdown jika klik di luar
        document.addEventListener('click', (e) => {
          if (!msContainer.contains(e.target)) {
            msContainer.classList.remove('is-open');
          }
        });
      };

      // Inisialisasi untuk config-multiselect (Flow 1 & Full Pipeline)
      setupMultiSelect({
        containerId: 'config-multiselect',
        triggerId: 'config-multiselect-trigger',
        tagsId: 'config-multiselect-tags',
        placeholderId: 'config-multiselect-placeholder',
        searchInputId: 'config-search-input',
        optionsListId: 'config-options-list',
        countSpanId: 'config-selection-count',
        selectAllBtnId: 'btn-select-all-configs',
        clearAllBtnId: 'btn-clear-all-configs',
        checkboxName: 'param-config-checkbox',
        entityLabel: 'konfigurasi'
      });

      // Inisialisasi untuk run-multiselect (Flow 2)
      setupMultiSelect({
        containerId: 'run-multiselect',
        triggerId: 'run-multiselect-trigger',
        tagsId: 'run-multiselect-tags',
        placeholderId: 'run-multiselect-placeholder',
        searchInputId: 'run-search-input',
        optionsListId: 'run-options-list',
        countSpanId: 'run-selection-count',
        selectAllBtnId: 'btn-select-all-runs',
        clearAllBtnId: 'btn-clear-all-runs',
        checkboxName: 'param-run-checkbox',
        entityLabel: 'Run ID'
      });

      // Inisialisasi untuk rollback-run-multiselect (Flow 3)
      setupMultiSelect({
        containerId: 'rollback-run-multiselect',
        triggerId: 'rollback-run-multiselect-trigger',
        tagsId: 'rollback-run-multiselect-tags',
        placeholderId: 'rollback-run-multiselect-placeholder',
        searchInputId: 'rollback-run-search-input',
        optionsListId: 'rollback-run-options-list',
        countSpanId: 'rollback-run-selection-count',
        selectAllBtnId: 'btn-select-all-rollback-runs',
        clearAllBtnId: 'btn-clear-all-rollback-runs',
        checkboxName: 'param-rollback-run-checkbox',
        entityLabel: 'Run ID'
      });

      // Inisialisasi untuk purge-config-multiselect (Flow 4)
      setupMultiSelect({
        containerId: 'purge-config-multiselect',
        triggerId: 'purge-config-multiselect-trigger',
        tagsId: 'purge-config-multiselect-tags',
        placeholderId: 'purge-config-multiselect-placeholder',
        searchInputId: 'purge-config-search-input',
        optionsListId: 'purge-config-options-list',
        countSpanId: 'purge-config-selection-count',
        selectAllBtnId: 'btn-select-all-purge-configs',
        clearAllBtnId: 'btn-clear-all-purge-configs',
        checkboxName: 'param-purge-config-checkbox',
        entityLabel: 'Tabel Target'
      });

      // Toggle batch size visibility jika radio berubah
      const radios = body.querySelectorAll('input[name="param-use-batch"]');
      radios.forEach(r => {
        r.addEventListener('change', (e) => {
          const bsGroup = document.getElementById('param-batch-size-group');
          if (bsGroup) bsGroup.style.display = e.target.value === 'Y' ? 'block' : 'none';
        });
      });
    } catch (renderErr) {
      console.error('Error saat merender form parameter:', renderErr);
      body.innerHTML = `
        <div class="p-3 rounded border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm mb-3">
          Terjadi kesalahan saat memuat form parameter: ${renderErr.message}
        </div>
        <div class="form-group mb-3">
          <label class="form-label font-bold">CONFIG_ID</label>
          <input type="number" id="param-config-id" class="form-control" value="1">
        </div>
      `;
    }
  }

  /**
   * Eksekusi alur secara Asynchronous & Non-Blocking (Bug #1 & Bug #2)
   */
  async submitExecutionWithParams(e) {
    e.preventDefault();

    // Guard debouncing: cegah multi-klik / multiple event trigger
    if (this.isSubmitting) return;
    this.isSubmitting = true;

    const runBtn = document.getElementById('btn-canvas-run-flow');
    const submitBtn = document.getElementById('btn-submit-flow-params');

    try {
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.innerHTML = '<span>⏳</span><span>Memulai...</span>';
      }

      const runIdEl = document.getElementById('param-run-id');
      const useBatchEl = document.querySelector('input[name="param-use-batch"]:checked');
      const batchSizeEl = document.getElementById('param-batch-size');
      const deleteIdsEl = document.getElementById('param-delete-ids');
      const clientCodeEl = document.getElementById('param-client-code');
      const envCodeEl = document.getElementById('param-env-code');

      // Ambil seluruh CONFIG_ID yang dicentang (mendukung single maupun multiple select Flow 1 & Flow 4)
      const checkedBoxes = document.querySelectorAll('input[name="param-config-checkbox"]:checked, input[name="param-purge-config-checkbox"]:checked');
      let selectedConfigIds = [];
      if (checkedBoxes.length > 0) {
        selectedConfigIds = Array.from(checkedBoxes).map(cb => parseInt(cb.value, 10)).filter(n => !isNaN(n));
      } else {
        const configIdEl = document.getElementById('param-config-id');
        if (configIdEl && configIdEl.value) {
          const val = configIdEl.value.trim();
          selectedConfigIds = (val.toUpperCase() === 'ALL') ? 'ALL' : [parseInt(val, 10) || 1];
        }
      }

      // Validasi CONFIG_ID untuk alur yang membutuhkan konfigurasi
      if (this.currentPresetId === 'flow_1_staging' || this.currentPresetId === 'flow_4_purge') {
        if (Array.isArray(selectedConfigIds) && selectedConfigIds.length === 0) {
          throw new Error('Pilih minimal satu konfigurasi migrasi (CONFIG_ID) untuk dieksekusi.');
        }
      }

      // Ambil seluruh RUN_ID yang dicentang (mendukung multi-select Flow 2 & Flow 3)
      const checkedRunBoxes = document.querySelectorAll('input[name="param-run-checkbox"]:checked, input[name="param-rollback-run-checkbox"]:checked');
      let selectedRunIds = [];
      if (checkedRunBoxes.length > 0) {
        selectedRunIds = Array.from(checkedRunBoxes).map(cb => parseInt(cb.value, 10)).filter(n => !isNaN(n));
      } else if (runIdEl && runIdEl.value) {
        selectedRunIds = [parseInt(runIdEl.value, 10)];
      }

      // Validasi RUN_ID untuk Flow 2 (Posting Target)
      if (this.currentPresetId === 'flow_2_post' && selectedRunIds.length === 0) {
        throw new Error('Pilih minimal satu sesi migrasi (RUN_ID) berstatus SUCCESS untuk diposting ke tabel target.');
      }

      // Validasi RUN_ID & konfirmasi untuk Flow 3 (Rollback Target)
      if (this.currentPresetId === 'flow_3_rollback') {
        const confirmCb = document.getElementById('param-confirm-rollback');
        if (confirmCb && !confirmCb.checked) {
          throw new Error('Anda harus mencentang konfirmasi persetujuan rollback terlebih dahulu.');
        }
        if (selectedRunIds.length === 0) {
          throw new Error('Pilih minimal satu sesi migrasi (RUN_ID) yang sudah diposting untuk di-rollback.');
        }
      }

      const ctx = this.getActiveContext();
      const configIdParam = Array.isArray(selectedConfigIds) ? selectedConfigIds.join(',') : (selectedConfigIds || 1);
      const primaryRunId = selectedRunIds.length > 0 ? selectedRunIds[0] : (runIdEl && runIdEl.value ? parseInt(runIdEl.value, 10) : null);
      const useBatch = useBatchEl ? useBatchEl.value : 'Y';
      const batchSize = batchSizeEl ? parseInt(batchSizeEl.value, 10) || 1000 : 1000;
      const deleteIds = deleteIdsEl ? deleteIdsEl.value.trim() : null;
      const clientIdParam = document.getElementById('param-client-id')?.value || ctx.clientId;
      const envIdParam = document.getElementById('param-env-id')?.value || ctx.envId;
      const clientCode = clientCodeEl ? clientCodeEl.value.trim() : ctx.clientCode;
      const envCode = envCodeEl ? envCodeEl.value.trim() : ctx.envCode;

      // Tutup modal parameter
      document.getElementById('modal-flow-execute-params')?.classList.add('hidden');

      if (runBtn) runBtn.disabled = true;

      // Reset visual state
      if (Array.isArray(this.currentNodes)) {
        this.currentNodes.forEach(n => this.setNodeVisualState(n.id, 'idle', 'Siap'));
      }
      if (Array.isArray(this.currentEdges)) {
        this.currentEdges.forEach(e => this.setEdgeVisualState(e.source, e.target, 'idle'));
      }

      // Tampilkan Live Execution Banner Seketika (Bug #2)
      const runLogInfo = (selectedRunIds.length > 1) 
        ? `, Run IDs [${selectedRunIds.join(', ')}] (${selectedRunIds.length} batch runs)` 
        : (primaryRunId ? `, Run #${primaryRunId}` : '');

      this.showLiveBanner(`Memulai alur "${this.currentPresetId}" [${clientCode} - ${envCode}]...`, 'RUNNING');
      this.logConsole('INFO', `Mengirim trigger eksekusi alur "${this.currentPresetId}" [${clientCode} - ${envCode}]${configIdParam ? ` untuk Config [${configIdParam}]` : ''}${runLogInfo}, Mode: ${useBatch} (${batchSize})...`);

      const payload = {
        flowId: this.currentPresetId,
        configId: configIdParam,
        configIds: Array.isArray(selectedConfigIds) ? selectedConfigIds : null,
        runId: primaryRunId,
        runIds: selectedRunIds.length > 0 ? selectedRunIds : (primaryRunId ? [primaryRunId] : null),
        clientId: clientIdParam,
        envId: envIdParam,
        clientCode,
        envCode,
        customNodes: this.currentNodes,
        customEdges: this.currentEdges,
        params: {
          useBatch,
          batchSize,
          deleteIds,
          clientId: clientIdParam,
          envId: envIdParam,
          clientCode,
          envCode
        }
      };

      // Panggil endpoint eksekusi ASYNCHRONOUS (Non-Blocking, respon <50ms)
      const res = await fetch('/api/flows/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const json = await res.json();
      if (!json.success) {
        throw new Error(json.error || 'Gagal memulai eksekusi alur.');
      }

      this.activeRunId = json.data.runId;
      this.updateLiveBannerTitle(`Run ID #${this.activeRunId} - Alur Sedang Berjalan`);
      this.logConsole('SUCCESS', `Sesi migrasi #${this.activeRunId} aktif di background. Membuka jalur streaming SSE...`);

      // Buka koneksi SSE Seketika untuk memantau progres langkah demi langkah (Bug #2)
      this.connectEventStream(this.activeRunId);

    } catch (err) {
      console.error('Error saat submit eksekusi alur:', err);
      this.logConsole('ERROR', `Gagal memulai alur: ${err.message}`);
      this.showErrorOnBanner(err.message);
      if (runBtn) runBtn.disabled = false;
    } finally {
      this.isSubmitting = false;
      if (submitBtn) {
        submitBtn.disabled = false;
        submitBtn.innerHTML = '<span>▶️</span><span>Mulai Eksekusi Alur</span>';
      }
    }
  }

  /**
   * Koneksi Server-Sent Events (SSE) untuk live streaming progres simpul
   */
  connectEventStream(runId) {
    if (this.eventSource) {
      this.eventSource.close();
    }

    this.startTimer();
    this.eventSource = new EventSource(`/api/flows/stream/${runId}`);

    this.eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        this.handleStreamEvent(data);
      } catch (e) {
        // ignore
      }
    };

    this.eventSource.onerror = (e) => {
      console.warn('SSE event stream reconnecting or ended:', e);
    };
  }

  /**
   * Menangani event real-time dari engine SSE (Bug #2, Bug #3 & Bug #4)
   */
  handleStreamEvent(data) {
    switch (data.type) {
      case 'FLOW_SNAPSHOT':
        this.updateLiveProgress(
          data.completedNodes || 0,
          data.totalNodes || 1,
          `Alur: ${data.flowName} (Status: ${data.status})`
        );
        if (data.currentNodeId) {
          this.setNodeVisualState(data.currentNodeId, 'running', 'Sedang Berjalan...');
        }
        break;

      case 'FLOW_STARTED':
        this.updateLiveProgress(0, data.totalNodes, `Memulai alur: ${data.flowName}`);
        this.logConsole('INFO', `[FLOW] "${data.flowName}" dimulai dengan ${data.totalNodes} tahapan eksekusi.`);
        break;

      case 'BATCH_CONFIG_STARTED':
        this.logConsole('INFO', `📦 [BATCH LOOP] Memulai konfigurasi ${data.configIndex}/${data.totalConfigs}: ${data.configName} (ID #${data.configId})`);
        this.updateLiveProgress(
          data.configIndex - 1,
          data.totalConfigs,
          `Batch Looping [${data.configIndex}/${data.totalConfigs}]: ${data.configName}`
        );

        // Update loop badge visual di canvas
        const loopBadgeEl = document.getElementById('canvas-loop-badge');
        if (loopBadgeEl) {
          loopBadgeEl.textContent = `Iterasi ${data.configIndex}/${data.totalConfigs}: ${data.configName}`;
          loopBadgeEl.style.background = '#e879f9';
        }

        // Aktifkan visualisasi garis putar-balik (loop-back edge)
        const activeLoopEdge = document.querySelector('.canvas-edge.loop-edge');
        if (activeLoopEdge) {
          activeLoopEdge.classList.add('active');
        }
        break;

      case 'BATCH_CONFIG_COMPLETED':
        this.logConsole('SUCCESS', `✓ [BATCH LOOP] Konfigurasi #${data.configId} (${data.configName}) selesai (${data.rowsStg || 0} baris staging).`);

        // Flash loop-back edge transition
        const compLoopEdge = document.querySelector('.canvas-edge.loop-edge');
        if (compLoopEdge) {
          compLoopEdge.classList.remove('active');
          compLoopEdge.classList.add('success');
          setTimeout(() => {
            compLoopEdge?.classList.remove('success');
          }, 800);
        }
        break;

      case 'BATCH_RUN_STARTED':
        this.logConsole('INFO', `🔁 [MULTI-RUN LOOP] Memulai Sesi Run #${data.runId} (${data.runIndex}/${data.totalRuns}) - Config: ${data.configName}`);
        this.updateLiveProgress(
          data.runIndex - 1,
          data.totalRuns,
          `Multi-Run Looping [${data.runIndex}/${data.totalRuns}]: Run #${data.runId} (${data.configName})`
        );

        // Update loop badge visual di canvas
        const runLoopBadgeEl = document.getElementById('canvas-loop-badge');
        if (runLoopBadgeEl) {
          runLoopBadgeEl.textContent = `Iterasi Run ${data.runIndex}/${data.totalRuns}: Run #${data.runId}`;
          runLoopBadgeEl.style.background = '#06b6d4';
        }

        // Reset visual state untuk simpul-simpul di dalam sub-workflow box agar pergerakan looping terasa hidup
        ['node_post_precheck', 'node_post_targets', 'node_post_recon'].forEach(nId => {
          this.setNodeVisualState(nId, 'idle', 'Menunggu...');
        });

        // Aktifkan visualisasi garis putar-balik (loop-back edge)
        const activeRunLoopEdge = document.querySelector('.canvas-edge.loop-edge');
        if (activeRunLoopEdge) {
          activeRunLoopEdge.classList.add('active');
        }
        break;

      case 'BATCH_RUN_COMPLETED':
        this.logConsole('SUCCESS', `✓ [MULTI-RUN LOOP] Sesi Run #${data.runId} selesai (${data.rowsNew || 0} baris baru diposting).`);

        // Flash loop-back edge transition
        const compRunLoopEdge = document.querySelector('.canvas-edge.loop-edge');
        if (compRunLoopEdge) {
          compRunLoopEdge.classList.remove('active');
          compRunLoopEdge.classList.add('success');
          setTimeout(() => {
            compRunLoopEdge?.classList.remove('success');
          }, 800);
        }
        break;

      case 'NODE_STARTED':
        this.setNodeVisualState(data.nodeId, 'running', 'Sedang Berjalan...');
        this.highlightActiveIncomingEdge(data.nodeId);
        this.updateLiveProgress(
          data.stepIndex - 1,
          data.totalNodes,
          `Langkah ${data.stepIndex} dari ${data.totalNodes}: ${data.nodeLabel}${data.currentConfigName ? ' (' + data.currentConfigName + ')' : ''}`
        );
        this.logConsole('INFO', `▶️ [CALL] ${data.dbFunction || data.nodeType} -> Memulai langkah: ${data.nodeLabel}`);

        // Update state in-memory simpul untuk Inspector Drawer
        const startedNode = this.currentNodes.find(n => n.id === data.nodeId);
        if (startedNode) {
          startedNode.lastState = 'RUNNING';
          startedNode.lastParams = data.capturedParams || {};
          startedNode.lastDbFunction = data.dbFunction;
          if (this.selectedNodeId === startedNode.id) this.renderInspector();
        }
        break;

      case 'NODE_PROGRESS':
        this.updateNodeMetric(data.nodeId, `${data.loadedRows}/${data.totalRows} baris (${data.speed} r/s)`);
        document.getElementById('console-metric-speed').textContent = `${data.speed} r/s`;
        document.getElementById('console-metric-rows').textContent = `${data.loadedRows}/${data.totalRows}`;
        document.getElementById('live-banner-speed').textContent = `${data.speed} r/s`;

        const progNode = this.currentNodes.find(n => n.id === data.nodeId);
        if (progNode) {
          progNode.lastMetric = `${data.loadedRows}/${data.totalRows} baris (${data.speed} r/s)`;
          if (this.selectedNodeId === progNode.id) this.renderInspector();
        }
        break;

      case 'NODE_COMPLETED':
        this.setNodeVisualState(data.nodeId, 'success', `Selesai (${data.elapsed}ms)`);
        this.markIncomingEdgeSuccess(data.nodeId);
        this.updateLiveProgress(
          data.stepIndex,
          data.totalNodes,
          `Langkah ${data.stepIndex} selesai (${data.elapsed}ms)`
        );
        this.logConsole('SUCCESS', `✓ [RETURN] ${data.dbFunction || data.nodeId} -> Selesai sukses dalam ${data.elapsed}ms`);

        // Update state in-memory simpul untuk Inspector Drawer
        const completedNode = this.currentNodes.find(n => n.id === data.nodeId);
        if (completedNode) {
          completedNode.lastState = 'SUCCESS';
          completedNode.lastElapsed = data.elapsed;
          completedNode.lastParams = {
            ...(completedNode.lastParams || {}),
            ...(data.capturedParams || {}),
            ...(data.result || {})
          };
          if (this.selectedNodeId === completedNode.id) this.renderInspector();
        }
        break;

      case 'FLOW_COMPLETED':
        this.stopTimer();
        this.updateLiveProgress(1, 1, '✓ Seluruh Alur Berhasil Selesai 100%!');
        document.getElementById('live-banner-status-badge').className = 'badge badge-success';
        document.getElementById('live-banner-status-badge').textContent = 'SUCCESS';
        document.getElementById('live-banner-pulse').className = 'live-status-pulse';
        document.getElementById('live-banner-pulse').style.background = '#10b981';

        // Pastikan seluruh simpul dan relasi visual menyala sukses
        if (Array.isArray(this.currentNodes)) {
          this.currentNodes.forEach(n => {
            const el = document.getElementById(`cnode-${n.id}`);
            if (el && !el.classList.contains('state-success')) {
              this.setNodeVisualState(n.id, 'success', 'Selesai Sukses');
            }
          });
        }
        if (Array.isArray(this.currentEdges)) {
          this.currentEdges.forEach(e => {
            this.setEdgeVisualState(e.source, e.target, 'success');
          });
        }

        this.logConsole('SUCCESS', `🎉 [FINISH] Seluruh rangkaian alur migrasi berhasil tuntas 100%!`);
        if (this.eventSource) this.eventSource.close();
        document.getElementById('btn-canvas-run-flow').disabled = false;

        // Auto refresh data tabel riwayat di tab Proses jika ada
        if (typeof window.loadEtlRuns === 'function') window.loadEtlRuns();
        if (typeof window.loadEtlOverview === 'function') window.loadEtlOverview();
        break;

      case 'FLOW_FAILED':
        this.stopTimer();
        this.lastErrorData = data;
        this.showErrorOnBanner(data.error);

        // Tandai simpul yang gagal
        if (data.nodeId) {
          this.setNodeVisualState(data.nodeId, 'failed', `FAILED: ${data.errorCode}`);
          this.markIncomingEdgeFailed(data.nodeId);

          const failedNode = this.currentNodes.find(n => n.id === data.nodeId);
          if (failedNode) {
            failedNode.lastState = 'FAILED';
            failedNode.lastError = data.error;
            failedNode.lastErrorCode = data.errorCode;
            if (this.selectedNodeId === failedNode.id) this.renderInspector();
          }
        }

        this.logConsole('ERROR', `❌ [ERROR] Eksekusi terhenti: ${data.error}`);
        if (this.eventSource) this.eventSource.close();
        document.getElementById('btn-canvas-run-flow').disabled = false;

        // Buka otomatis modal diagnostik error (Bug #3)
        this.openErrorDiagnosticModal(data);
        break;
    }
  }

  /**
   * Buka Modal Diagnostik Error (Bug #3)
   */
  async openErrorDiagnosticModal(errorData) {
    const modal = document.getElementById('modal-node-error-diagnostic');
    if (!modal) return;

    modal.classList.remove('hidden');

    const node = this.currentNodes.find(n => n.id === errorData.nodeId);

    document.getElementById('diag-node-name').textContent = errorData.nodeLabel || errorData.nodeId || 'Simpul Alur';
    document.getElementById('diag-db-func').textContent = node?.dbFunction || 'Fungsi / Stored Procedure Terkait';
    document.getElementById('diag-error-code').textContent = errorData.errorCode || 'EXECUTION_ERROR';
    document.getElementById('diag-step-name').textContent = node?.auditStep || 'UNKNOWN_STEP';
    document.getElementById('diag-error-message').textContent = errorData.error || 'Terjadi kesalahan sistem saat mengeksekusi langkah ini.';

    const countBadge = document.getElementById('diag-samples-count');
    const tbody = document.getElementById('diag-tbody-samples');
    tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b; padding: 1rem;">Memuat sampel data bermasalah dari database...</td></tr>';

    // Ambil sampel data error aktual dari API /api/flows/error-diagnostic/:runId
    if (this.activeRunId) {
      try {
        const res = await fetch(`/api/flows/error-diagnostic/${this.activeRunId}`);
        const json = await res.json();
        if (json.success && json.data?.errorLogs && json.data.errorLogs.length > 0) {
          const logs = json.data.errorLogs;
          countBadge.textContent = `${logs.length} baris`;
          tbody.innerHTML = logs.map(l => `
            <tr>
              <td style="color: #94a3b8;">${l.logged_at ? new Date(l.logged_at).toLocaleTimeString() : '-'}</td>
              <td class="text-rose font-bold">${l.error_code || '-'}</td>
              <td>${l.error_message || l.error_field || '-'}</td>
              <td style="color: #fca5a5; max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">
                ${l.row_data || '-'}
              </td>
            </tr>
          `).join('');
        } else {
          countBadge.textContent = '0 baris';
          tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #64748b; padding: 1rem;">Tidak ada baris data error khusus yang tercatat di migration_error_log.</td></tr>';
        }
      } catch (e) {
        tbody.innerHTML = '<tr><td colspan="4" style="text-align: center; color: #f43f5e; padding: 1rem;">Gagal mengambil sampel error log.</td></tr>';
      }
    }
  }

  /**
   * Manajemen Live Banner & Progress Tracker (Bug #2)
   */
  showLiveBanner(title, status = 'RUNNING') {
    const banner = document.getElementById('canvas-live-banner');
    if (!banner) return;
    banner.classList.remove('hidden');

    document.getElementById('live-banner-title').textContent = title;
    const badge = document.getElementById('live-banner-status-badge');
    badge.className = status === 'RUNNING' ? 'badge badge-primary' : 'badge badge-danger';
    badge.textContent = status;

    const pulse = document.getElementById('live-banner-pulse');
    pulse.className = 'live-status-pulse';

    const inspectBtn = document.getElementById('btn-banner-inspect-error');
    if (inspectBtn) inspectBtn.classList.add('hidden');

    const fill = document.getElementById('live-banner-progress-fill');
    fill.className = 'live-progress-bar-fill';
    fill.style.width = '0%';
  }

  updateLiveBannerTitle(title) {
    const el = document.getElementById('live-banner-title');
    if (el) el.textContent = title;
  }

  updateLiveProgress(currentStep, totalSteps, stepLabel) {
    const percent = Math.min(100, Math.round((currentStep / totalSteps) * 100));
    document.getElementById('live-banner-percent').textContent = `${percent}%`;
    document.getElementById('live-banner-step-label').textContent = stepLabel;
    document.getElementById('live-banner-progress-fill').style.width = `${percent}%`;
  }

  showErrorOnBanner(errorMessage) {
    const banner = document.getElementById('canvas-live-banner');
    if (!banner) return;
    banner.classList.remove('hidden');

    document.getElementById('live-banner-title').textContent = `Eksekusi Terhenti: ${errorMessage}`;
    const badge = document.getElementById('live-banner-status-badge');
    badge.className = 'badge badge-danger';
    badge.textContent = 'FAILED';

    const pulse = document.getElementById('live-banner-pulse');
    pulse.className = 'live-status-pulse pulse-error';

    const fill = document.getElementById('live-banner-progress-fill');
    fill.className = 'live-progress-bar-fill fill-error';

    const inspectBtn = document.getElementById('btn-banner-inspect-error');
    if (inspectBtn) inspectBtn.classList.remove('hidden');
  }

  hideLiveBanner() {
    document.getElementById('canvas-live-banner')?.classList.add('hidden');
  }

  startTimer() {
    this.startTime = Date.now();
    const timerEl = document.getElementById('live-banner-timer');
    if (this.timerInterval) clearInterval(this.timerInterval);

    this.timerInterval = setInterval(() => {
      if (!this.startTime || !timerEl) return;
      const elapsedSec = Math.floor((Date.now() - this.startTime) / 1000);
      const m = String(Math.floor(elapsedSec / 60)).padStart(2, '0');
      const s = String(elapsedSec % 60).padStart(2, '0');
      timerEl.textContent = `${m}:${s}`;
    }, 1000);
  }

  stopTimer() {
    if (this.timerInterval) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
  }

  /**
   * Perbarui status visual simpul & edge
   */
  setNodeVisualState(nodeId, state, statusText) {
    const el = document.getElementById(`cnode-${nodeId}`);
    if (!el) return;

    const node = this.currentNodes?.find(n => n.id === nodeId);
    const themeClass = node ? this.getNodeTheme(node.type) : 'primary';

    el.className = `canvas-node node-${themeClass} state-${state} ${nodeId === this.selectedNodeId ? 'selected' : ''}`;
    const pill = document.getElementById(`pill-${nodeId}`);
    if (pill) {
      pill.className = `canvas-node-status-pill status-pill-${state}`;
      pill.textContent = state.toUpperCase();
    }
    const metric = document.getElementById(`metric-${nodeId}`);
    if (metric && statusText) {
      metric.innerHTML = `<span>Status:</span><span class="canvas-node-metric-val">${statusText}</span>`;
    }
  }

  updateNodeMetric(nodeId, text) {
    const metric = document.getElementById(`metric-${nodeId}`);
    if (metric) {
      metric.innerHTML = `<span>Progress:</span><span class="canvas-node-metric-val">${text}</span>`;
    }
  }

  setEdgeVisualState(sourceId, targetId, state) {
    const edgeKey = `${sourceId}->${targetId}`;
    if (this.edgeStates) {
      this.edgeStates.set(edgeKey, state);
    }

    const edge = document.getElementById(`edge-${sourceId}-${targetId}`);
    if (!edge) return;

    const edgeType = edge.getAttribute('data-edge-type') || 'normal';
    let baseClass = 'canvas-edge';
    if (edgeType === 'loop') baseClass += ' loop-edge';
    if (edgeType === 'bypass') baseClass += ' bypass-edge';

    if (state && state !== 'idle') {
      edge.setAttribute('class', `${baseClass} ${state}`);
    } else {
      edge.setAttribute('class', baseClass);
    }

    // Dynamic marker-end sesuai state dan jenis relasi
    let markerId = 'arrow-default';
    if (state === 'active') {
      if (edgeType === 'loop') markerId = 'arrow-loop-active';
      else if (edgeType === 'bypass') markerId = 'arrow-bypass-active';
      else markerId = 'arrow-active';
    } else if (state === 'success') {
      markerId = 'arrow-success';
    } else if (state === 'failed') {
      markerId = 'arrow-failed';
    } else {
      // idle / default
      if (edgeType === 'loop') markerId = 'arrow-loop';
      else if (edgeType === 'bypass') markerId = 'arrow-bypass';
      else markerId = 'arrow-default';
    }

    edge.setAttribute('marker-end', `url(#${markerId})`);
  }

  highlightActiveIncomingEdge(targetNodeId) {
    this.currentEdges.forEach(e => {
      if (e.target === targetNodeId) {
        this.setEdgeVisualState(e.source, e.target, 'active');
      }
    });
  }

  markIncomingEdgeSuccess(targetNodeId) {
    this.currentEdges.forEach(e => {
      if (e.target === targetNodeId) {
        this.setEdgeVisualState(e.source, e.target, 'success');
      }
    });
  }

  markIncomingEdgeFailed(targetNodeId) {
    this.currentEdges.forEach(e => {
      if (e.target === targetNodeId) {
        this.setEdgeVisualState(e.source, e.target, 'failed');
      }
    });
  }

  /**
   * Tulis log baris ke terminal console bawah
   */
  logConsole(level, message) {
    if (!this.consoleBody) return;
    const now = new Date();
    const ts = now.toTimeString().split(' ')[0] + '.' + String(now.getMilliseconds()).padStart(3, '0');

    const line = document.createElement('div');
    line.className = 'console-line';
    line.innerHTML = `
      <span class="console-ts">[${ts}]</span>
      <span class="console-lvl-${level}">[${level}]</span>
      <span class="console-msg">${message}</span>
    `;

    this.consoleBody.appendChild(line);
    this.consoleBody.scrollTop = this.consoleBody.scrollHeight;
  }

  getNodeIcon(type) {
    switch (type) {
      case 'CHECK_DB_PREREQ': return '🔌';
      case 'INIT_AND_GET_CONFIG': return '📋';
      case 'INIT_BATCH': return '🚀';
      case 'GET_CONFIGS': return '📋';
      case 'LOOP_CONTROLLER':
      case 'LOOP_CONTROLLER_RB': return '🔁';
      case 'PRECHECK_SOURCE': return '🔍';
      case 'PRECHECK_TARGET':
      case 'PRECHECK_ROLLBACK': return '🔍';
      case 'PREPARE_STAGING': return '🏗️';
      case 'DATA_STREAM': return '⚡';
      case 'CHECK_STAGING': return '⚖️';
      case 'CONVERT_LOOKUP': return '🔄';
      case 'DELTA_CHECK': return '📊';
      case 'VALIDATE_POST_GUARD': return '🛡️';
      case 'POST_TARGETS': return '🚀';
      case 'RECONCILIATION_AUDIT':
      case 'AUDIT_ROLLBACK_RECORD': return '⚖️';
      case 'VALIDATE_ROLLBACK_GUARD': return '🛡️';
      case 'ROLLBACK_TARGETS': return '↩️';
      case 'DUAL_GUARD_PURGE':
      case 'PURGE_TARGET': return '🗑️';
      case 'FINISH_FLOW1':
      case 'FINISH_FLOW2':
      case 'FINISH_FLOW3': return '🏁';
      case 'SUCCESS_DONE': return '✅';
      default: return '⚙️';
    }
  }

  /**
   * Mengembalikan kelas tema warna berdasarkan jenis modul simpul
   */
  getNodeTheme(type) {
    switch (type) {
      case 'CHECK_DB_PREREQ':
      case 'VALIDATE_POST_GUARD':
      case 'VALIDATE_ROLLBACK_GUARD':
        return 'cyan';
      case 'INIT_AND_GET_CONFIG':
      case 'INIT_BATCH':
      case 'GET_CONFIGS':
      case 'PRECHECK_TARGET':
      case 'PRECHECK_ROLLBACK':
        return 'indigo';
      case 'LOOP_CONTROLLER':
      case 'LOOP_CONTROLLER_RB':
        return 'amber';
      case 'PRECHECK_SOURCE':
        return 'teal';
      case 'PREPARE_STAGING':
        return 'sky';
      case 'DATA_STREAM':
        return 'emerald';
      case 'CHECK_STAGING':
      case 'RECONCILIATION_AUDIT':
      case 'AUDIT_ROLLBACK_RECORD':
        return 'violet';
      case 'DELTA_CHECK':
        return 'blue';
      case 'CONVERT_LOOKUP':
        return 'fuchsia';
      case 'POST_TARGETS':
        return 'blue';
      case 'ROLLBACK_TARGETS':
      case 'DUAL_GUARD_PURGE':
      case 'PURGE_TARGET':
        return 'rose';
      case 'FINISH_FLOW1':
      case 'FINISH_FLOW2':
      case 'FINISH_FLOW3':
      case 'SUCCESS_DONE':
        return 'emerald-finish';
      default:
        return 'slate';
    }
  }

  /**
   * Terapkan transformasi skala (zoom) dan pergeseran (pan) ke transform layer
   */
  applyTransform(isAnimated = false) {
    if (!this.transformLayer) return;
    if (isAnimated) {
      this.transformLayer.classList.add('animating');
      setTimeout(() => {
        this.transformLayer?.classList.remove('animating');
      }, 350);
    } else {
      this.transformLayer.classList.remove('animating');
    }

    this.transformLayer.style.transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.zoomLevel})`;

    const pct = `${Math.round(this.zoomLevel * 100)}%`;
    const lblToolbar = document.getElementById('canvas-zoom-label');
    const lblFloat = document.getElementById('btn-float-zoom-reset');
    if (lblToolbar) lblToolbar.textContent = pct;
    if (lblFloat) lblFloat.textContent = pct;
  }

  /**
   * Perbesar tampilan kanvas (Zoom In)
   */
  zoomIn() {
    this.zoomTo(this.zoomLevel * 1.2);
  }

  /**
   * Perkecil tampilan kanvas (Zoom Out)
   */
  zoomOut() {
    this.zoomTo(this.zoomLevel / 1.2);
  }

  /**
   * Reset tingkat zoom ke 100% (1.0x)
   */
  resetZoom() {
    this.zoomTo(1.0);
  }

  /**
   * Zoom ke target skala dengan titik fokus kursor / viewport center
   */
  zoomTo(targetZoom, originX = null, originY = null) {
    if (!this.container) return;
    const clamped = Math.max(0.3, Math.min(2.5, targetZoom));
    const vpRect = this.container.getBoundingClientRect();
    const ox = originX !== null ? originX : (vpRect.width / 2);
    const oy = originY !== null ? originY : (vpRect.height / 2);

    const worldX = (ox - this.panX) / this.zoomLevel;
    const worldY = (oy - this.panY) / this.zoomLevel;

    this.panX = Math.round(ox - (worldX * clamped));
    this.panY = Math.round(oy - (worldY * clamped));
    this.zoomLevel = clamped;

    this.applyTransform(true);
  }

  /**
   * Pusatkan seluruh graf simpul di tengah-tengah kanvas (Fit to View & Centered)
   */
  centerGraph(isAnimated = true) {
    if (!this.container || this.currentNodes.length === 0) return;

    // Pastikan container sedang berukuran valid / terlihat di viewport
    const vpW = this.container.clientWidth;
    const vpH = this.container.clientHeight;
    if (!vpW || vpW < 100 || !vpH || vpH < 100) return;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const nodeW = 230;
    const nodeH = 150;

    this.currentNodes.forEach(n => {
      if (n.x < minX) minX = n.x;
      if (n.y < minY) minY = n.y;
      if (n.x + nodeW > maxX) maxX = n.x + nodeW;
      if (n.y + nodeH > maxY) maxY = n.y + nodeH;
    });

    const preset = this.presets.find(p => p.id === this.currentPresetId);
    if (preset?.subflowBox) {
      minX = Math.min(minX, preset.subflowBox.x);
      minY = Math.min(minY, preset.subflowBox.y);
      maxX = Math.max(maxX, preset.subflowBox.x + preset.subflowBox.width);
      maxY = Math.max(maxY, preset.subflowBox.y + preset.subflowBox.height);
    }

    this.currentEdges.forEach(e => {
      if (e.route === 'top' || (e.routeOffset && e.routeOffset < 0)) {
        minY = Math.min(minY, 20);
      }
      if (e.isLoop || e.loopOffset) {
        maxY = Math.max(maxY, 390);
      }
    });

    const graphW = Math.max(100, maxX - minX);
    const graphH = Math.max(100, maxY - minY);
    const centerX = minX + (graphW / 2);
    const centerY = minY + (graphH / 2);

    const paddingX = 60;
    const paddingY = 60;

    const scaleX = (vpW - paddingX * 2) / graphW;
    const scaleY = (vpH - paddingY * 2) / graphH;
    let optimalScale = Math.min(scaleX, scaleY);
    optimalScale = Math.max(0.4, Math.min(1.0, optimalScale));

    this.zoomLevel = optimalScale;
    this.panX = Math.round((vpW / 2) - (centerX * optimalScale));
    this.panY = Math.round((vpH / 2) - (centerY * optimalScale));

    this.applyTransform(isAnimated);
  }

  /**
   * Callback otomatis saat Tab Visual Canvas Studio diaktifkan oleh pengguna
   */
  onTabActivated() {
    this.updateContextUI();
    const ctx = this.getActiveContext();
    if (this.lastLoadedClientId !== ctx.clientId || this.lastLoadedEnvId !== ctx.envId) {
      this.lastLoadedClientId = ctx.clientId;
      this.lastLoadedEnvId = ctx.envId;
      this.loadPresets();
    } else {
      this.renderGraph();
    }
    setTimeout(() => {
      if (this.container && this.container.clientWidth > 100) {
        this.centerGraph(false);
      }
    }, 60);
  }

  /**
   * Pasang interaksi Pan (geser kanvas) dan Wheel Zoom (scroll mouse)
   */
  setupPanAndZoom() {
    if (!this.container) return;

    // Wheel zoom interaktif mengarah ke posisi kursor
    this.container.addEventListener('wheel', (e) => {
      e.preventDefault();
      const rect = this.container.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
      this.zoomTo(this.zoomLevel * zoomFactor, mouseX, mouseY);
    }, { passive: false });

    // Drag canvas background (Pan)
    this.container.addEventListener('mousedown', (e) => {
      if (e.target.closest('.canvas-node') || e.target.closest('.canvas-floating-controls')) {
        return;
      }
      if (e.button !== 0) return;

      this.isPanning = true;
      this.panStart = {
        x: e.clientX - this.panX,
        y: e.clientY - this.panY
      };
      this.container.style.cursor = 'grabbing';
    });

    window.addEventListener('mousemove', (e) => {
      if (!this.isPanning) return;
      this.panX = Math.round(e.clientX - this.panStart.x);
      this.panY = Math.round(e.clientY - this.panStart.y);
      this.applyTransform(false);
    });

    window.addEventListener('mouseup', () => {
      if (this.isPanning) {
        this.isPanning = false;
        if (this.container) this.container.style.cursor = '';
      }
    });
  }

  /**
   * Mengaktifkan fitur drag-to-resize vertikal pada panel bawah canvas studio
   */
  setupConsoleResizer() {
    const resizer = document.getElementById('canvas-console-resizer');
    const panel = document.getElementById('canvas-bottom-panel');
    const header = document.getElementById('canvas-console-header-drag');
    if (!resizer || !panel) return;

    // Pulihkan preferensi tinggi sebelumnya dari localStorage jika ada
    try {
      const savedH = localStorage.getItem('antam_canvas_console_height');
      if (savedH) {
        const hNum = parseInt(savedH, 10);
        if (hNum >= 120 && hNum <= (window.innerHeight - 150)) {
          panel.style.height = `${hNum}px`;
        }
      }
    } catch (_) {}

    let isResizing = false;
    let startY = 0;
    let startHeight = 0;

    const startResize = (e) => {
      // Jika klik berasal dari tombol, link, atau input di header, jangan resize
      if (e.target.closest('button') || e.target.closest('select') || e.target.closest('input') || e.target.closest('.canvas-bottom-tabs')) {
        return;
      }

      isResizing = true;
      startY = e.clientY || (e.touches && e.touches[0].clientY);
      startHeight = panel.getBoundingClientRect().height;

      panel.classList.add('is-resizing');
      resizer.classList.add('is-resizing');
      document.body.style.cursor = 'row-resize';
      document.body.style.userSelect = 'none';

      document.addEventListener('mousemove', onResizeMove);
      document.addEventListener('mouseup', stopResize);
      document.addEventListener('touchmove', onResizeMove, { passive: false });
      document.addEventListener('touchend', stopResize);
    };

    const onResizeMove = (e) => {
      if (!isResizing) return;
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      const deltaY = startY - clientY;
      const minH = 120;
      const maxH = Math.max(minH, window.innerHeight - 160);
      const newH = Math.min(maxH, Math.max(minH, Math.round(startHeight + deltaY)));

      panel.style.height = `${newH}px`;
    };

    const stopResize = () => {
      if (!isResizing) return;
      isResizing = false;
      panel.classList.remove('is-resizing');
      resizer.classList.remove('is-resizing');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';

      document.removeEventListener('mousemove', onResizeMove);
      document.removeEventListener('mouseup', stopResize);
      document.removeEventListener('touchmove', onResizeMove);
      document.removeEventListener('touchend', stopResize);

      try {
        const finalH = Math.round(panel.getBoundingClientRect().height);
        localStorage.setItem('antam_canvas_console_height', String(finalH));
      } catch (_) {}
    };

    resizer.addEventListener('mousedown', startResize);
    resizer.addEventListener('touchstart', startResize, { passive: false });

    if (header) {
      header.addEventListener('mousedown', (e) => {
        // Hanya resize jika mousedown bukan pada tab button atau metriks
        if (!e.target.closest('button') && !e.target.closest('.canvas-bottom-tabs') && !e.target.closest('.canvas-console-metrics')) {
          startResize(e);
        }
      });
    }
  }

  setupEventListeners() {
    this.setupConsoleResizer();

    // Kontrol Zoom & Centered di Floating Widget Viewport
    document.getElementById('btn-float-zoom-in')?.addEventListener('click', () => this.zoomIn());
    document.getElementById('btn-float-zoom-out')?.addEventListener('click', () => this.zoomOut());
    document.getElementById('btn-float-zoom-reset')?.addEventListener('click', () => this.resetZoom());
    document.getElementById('btn-float-center')?.addEventListener('click', () => this.centerGraph(true));

    // Tombol "Eksekusi Alur" membuka Modal Parameter (Bug #1)
    document.getElementById('btn-canvas-run-flow')?.addEventListener('click', () => {
      this.openExecutionParamsModal();
    });

    // Form submit parameter eksekusi
    document.getElementById('form-flow-execute-params')?.addEventListener('submit', (e) => {
      this.submitExecutionWithParams(e);
    });

    // Close parameter modal
    document.getElementById('btn-close-flow-params')?.addEventListener('click', () => {
      document.getElementById('modal-flow-execute-params')?.classList.add('hidden');
    });
    document.getElementById('btn-cancel-flow-params')?.addEventListener('click', () => {
      document.getElementById('modal-flow-execute-params')?.classList.add('hidden');
    });

    // Tombol Inspeksi Error di banner (Bug #3)
    document.getElementById('btn-banner-inspect-error')?.addEventListener('click', () => {
      if (this.lastErrorData) {
        this.openErrorDiagnosticModal(this.lastErrorData);
      }
    });

    // Close diagnostic modal
    document.getElementById('btn-close-error-diagnostic')?.addEventListener('click', () => {
      document.getElementById('modal-node-error-diagnostic')?.classList.add('hidden');
    });
    document.getElementById('btn-diag-close')?.addEventListener('click', () => {
      document.getElementById('modal-node-error-diagnostic')?.classList.add('hidden');
    });

    // Tombol aksi di diagnostic modal: Retry & Rollback
    document.getElementById('btn-diag-retry')?.addEventListener('click', () => {
      document.getElementById('modal-node-error-diagnostic')?.classList.add('hidden');
      this.openExecutionParamsModal();
    });

    document.getElementById('btn-diag-rollback')?.addEventListener('click', async () => {
      document.getElementById('modal-node-error-diagnostic')?.classList.add('hidden');
      if (this.activeRunId) {
        this.loadPreset('flow_3_rollback');
        this.openExecutionParamsModal();
      }
    });

    // Tombol close dialog properti simpul
    document.getElementById('btn-close-node-properties')?.addEventListener('click', () => {
      document.getElementById('modal-node-properties')?.classList.add('hidden');
    });
    document.getElementById('btn-close-node-prop-footer')?.addEventListener('click', () => {
      document.getElementById('modal-node-properties')?.classList.add('hidden');
    });

    // Simpan perubahan konfigurasi simpul dari dialog modal
    document.getElementById('btn-save-node-prop-dialog')?.addEventListener('click', () => {
      const node = this.currentNodes.find(n => n.id === this.selectedNodeId);
      if (!node) return;
      const newLabel = document.getElementById('node-prop-input-label')?.value?.trim();
      const newBatch = parseInt(document.getElementById('node-prop-input-batch')?.value, 10);
      const newOnError = document.getElementById('node-prop-input-onerror')?.value;

      if (newLabel) node.label = newLabel;
      if (!isNaN(newBatch)) node.batchSize = newBatch;
      if (newOnError) node.onError = newOnError;

      this.renderGraph();
      document.getElementById('modal-node-properties')?.classList.add('hidden');
      this.logConsole('SUCCESS', `Konfigurasi simpul "${node.label}" (#${node.id}) berhasil diperbarui.`);
    });

    // Simpan Layout Visual Canvas (User Requirement)
    document.getElementById('btn-canvas-save-layout')?.addEventListener('click', () => {
      this.saveLayout();
    });

    // Reset layout & bersihkan notifikasi / info eksekusi
    document.getElementById('btn-canvas-reset')?.addEventListener('click', () => {
      // Hapus tata letak kustom yang pernah disimpan untuk alur dan tenant ini
      try {
        const storageKey = this.getLayoutStorageKey(this.currentPresetId);
        localStorage.removeItem(storageKey);
        localStorage.removeItem(`antam_canvas_layout_${this.currentPresetId}`);
      } catch (_) {}
      this.resetCanvasInfoAndState();
      this.loadPreset(this.currentPresetId);
      if (typeof window.showToast === 'function') {
        window.showToast('Tata letak kanvas dikembalikan ke posisi default.', 'info');
      }
    });

    // Clear console & metrics
    document.getElementById('btn-canvas-clear-console')?.addEventListener('click', () => {
      if (this.consoleBody) this.consoleBody.innerHTML = '';
      const metricSpeed = document.getElementById('console-metric-speed');
      if (metricSpeed) metricSpeed.textContent = '0 r/s';
      const metricRows = document.getElementById('console-metric-rows');
      if (metricRows) metricRows.textContent = '0/0';
    });
  }
}

// Inisialisasi otomatis
window.flowCanvasStudio = new FlowCanvasStudio();
document.addEventListener('DOMContentLoaded', () => {
  window.flowCanvasStudio.init();
});
