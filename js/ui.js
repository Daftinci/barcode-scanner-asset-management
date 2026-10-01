// DOM rendering helpers. Pure functions that read data in and update the page.

const $ = (id) => document.getElementById(id);

export const el = {
  fileInput: $('file-input'),
  fileInfo: $('file-info'),
  clientNameInput: $('client-name-input'),
  clientNameDisplay: $('client-name-display'),
  resumeBanner: $('resume-banner'),
  resumeBannerText: $('resume-banner-text'),
  resumeDismissBtn: $('resume-dismiss-btn'),
  cameraErrorBanner: $('camera-error-banner'),
  cameraErrorText: $('camera-error-text'),
  cameraErrorDismissBtn: $('camera-error-dismiss-btn'),
  sheetPanel: $('sheet-panel'),
  statTotal: $('stat-total'),
  statFound: $('stat-found'),
  statRemaining: $('stat-remaining'),
  progressBarFill: $('progress-bar-fill'),
  scannerInput: $('scanner-input'),
  scannerReadyDot: $('scanner-ready-dot'),
  cameraDeviceSelect: $('camera-device-select'),
  cameraRefreshBtn: $('camera-refresh-btn'),
  cameraStartBtn: $('camera-start-btn'),
  cameraStopBtn: $('camera-stop-btn'),
  cameraVideo: $('camera-video'),
  cameraScanStatus: $('camera-scan-status'),
  remoteUrl: $('remote-url'),
  remoteCopyBtn: $('remote-copy-btn'),
  remoteStatus: $('remote-status'),
  recentScansList: $('recent-scans-list'),
  searchInput: $('search-input'),
  filterSelect: $('filter-select'),
  tablePanel: $('table-panel'),
  dataTableBody: $('data-table-body'),
  unrecognizedPanel: $('unrecognized-panel'),
  unrecognizedTableBody: $('unrecognized-table-body'),
  unrecognizedClearBtn: $('unrecognized-clear-btn'),
  exportBtn: $('export-btn'),
  exportStatus: $('export-status'),
  resetProgressBtn: $('reset-progress-btn'),
  hotkeyList: $('hotkey-list'),
  hotkeyAddBtn: $('hotkey-add-btn'),
  hotkeyLastScanned: $('hotkey-last-scanned'),
  intakeStartBtn: $('intake-start-btn'),
  intakePanel: $('intake-panel'),
  intakeCount: $('intake-count'),
  intakeTableBody: $('intake-table-body'),
};

// Toggles which result panels are visible: 'checklist' mode shows the client-progress stats,
// records table, and unrecognized-scans log; 'intake' mode shows the new-products table instead
// (found/remaining/duplicate-list concepts from checklist mode don't apply to intake sessions).
export function setMode(mode) {
  const isIntake = mode === 'intake';
  el.sheetPanel.classList.toggle('hidden', isIntake);
  el.tablePanel.classList.toggle('hidden', isIntake);
  el.unrecognizedPanel.classList.toggle('hidden', isIntake);
  el.intakePanel.classList.toggle('hidden', !isIntake);
}

export function renderClientName(name) {
  el.clientNameDisplay.textContent = name ? `Client: ${name}` : 'No client loaded';
}

export function renderFileInfo(text) {
  el.fileInfo.textContent = text;
}

export function showBanner(bannerEl, textEl, text) {
  textEl.textContent = text;
  bannerEl.classList.remove('hidden');
}

export function hideBanner(bannerEl) {
  bannerEl.classList.add('hidden');
}

export function renderStats(records) {
  const scannable = records.filter((r) => r.status !== 'no-sn');
  const found = scannable.filter((r) => r.status === 'found').length;
  const total = scannable.length;
  const remaining = total - found;
  el.statTotal.textContent = total;
  el.statFound.textContent = found;
  el.statRemaining.textContent = remaining;
  el.progressBarFill.style.width = total ? `${(found / total) * 100}%` : '0%';
}

function statusLabel(status) {
  if (status === 'found') return 'Found';
  if (status === 'no-sn') return 'No SN';
  return 'Pending';
}

function tipeCellHtml(rec) {
  if (rec.tipe) return escapeHtml(rec.tipe);
  return `<input type="text" class="tipe-input" data-row-index="${rec.rowIndex}" placeholder="Enter tipe..." />`;
}

export function renderTable(records, { search, filter }) {
  const q = (search || '').trim().toLowerCase();
  el.dataTableBody.innerHTML = '';
  const frag = document.createDocumentFragment();

  for (const rec of records) {
    if (filter === 'found' && rec.status !== 'found') continue;
    if (filter === 'remaining' && rec.status !== 'pending') continue;

    if (q) {
      const haystack = [rec.sn, rec.product, rec.tipe, rec.description, rec.company]
        .map((v) => (v == null ? '' : String(v).toLowerCase()))
        .join(' ');
      if (!haystack.includes(q)) continue;
    }

    const tr = document.createElement('tr');
    tr.className = `row-status-${rec.status}`;
    tr.innerHTML = `
      <td>${escapeHtml(rec.sn ?? '')}</td>
      <td>${escapeHtml(rec.product ?? '')}</td>
      <td>${tipeCellHtml(rec)}</td>
      <td>${escapeHtml([rec.lantai, rec.box].filter((v) => v != null && v !== '').join(' / '))}</td>
      <td>${escapeHtml(rec.company ?? '')}</td>
      <td>${escapeHtml(rec.description ?? '')}</td>
      <td>${statusLabel(rec.status)}</td>
      <td>${rec.foundAt ? new Date(rec.foundAt).toLocaleTimeString() : ''}</td>
      <td>${escapeHtml(rec.condition ?? '')}</td>
      <td></td>
    `;

    if (rec.status !== 'no-sn') {
      const actionTd = tr.lastElementChild;
      const btn = document.createElement('button');
      btn.className = 'btn btn--small';
      btn.textContent = rec.status === 'found' ? 'Unmark' : 'Mark Found';
      btn.dataset.rowIndex = String(rec.rowIndex);
      btn.dataset.action = rec.status === 'found' ? 'unmark' : 'mark';
      actionTd.appendChild(btn);
    }

    frag.appendChild(tr);
  }
  el.dataTableBody.appendChild(frag);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

const SOURCE_ICON = { camera: '📷', hid: '⌨️', keyboard: '🏷️', remote: '📱' };

export function pushRecentScan(entry) {
  const li = document.createElement('li');
  li.className = `scan-entry scan-entry--${entry.kind}`;
  const icon = SOURCE_ICON[entry.source] || '';
  const time = new Date(entry.timestamp).toLocaleTimeString();
  li.innerHTML = `<span class="scan-entry__icon">${icon}</span> <span class="scan-entry__text">${escapeHtml(entry.text)}</span> <span class="scan-entry__meta">${entry.message} · ${time}</span>`;
  el.recentScansList.prepend(li);
  while (el.recentScansList.children.length > 10) {
    el.recentScansList.removeChild(el.recentScansList.lastElementChild);
  }
}

const UNRECOGNIZED_FIELDS = ['product', 'tipe', 'company', 'description'];

function unrecognizedFieldInput(entry, field) {
  const value = entry[field] == null ? '' : entry[field];
  return `<input type="text" class="unrecognized-field-input" data-id="${escapeHtml(entry.id)}" data-field="${field}" value="${escapeHtml(value)}" placeholder="${field}..." />`;
}

// Full re-render (most recent scan first), mirroring renderTable's approach.
export function renderUnrecognizedTable(log) {
  el.unrecognizedTableBody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const entry of log.slice().reverse()) {
    const tr = document.createElement('tr');
    const icon = SOURCE_ICON[entry.source] || '';
    tr.innerHTML = `
      <td>${escapeHtml(entry.text ?? '')}</td>
      <td>${escapeHtml(entry.format ?? '')}</td>
      <td>${icon} ${escapeHtml(entry.source ?? '')}</td>
      <td>${entry.timestamp ? new Date(entry.timestamp).toLocaleTimeString() : ''}</td>
      ${UNRECOGNIZED_FIELDS.map((field) => `<td>${unrecognizedFieldInput(entry, field)}</td>`).join('')}
    `;
    frag.appendChild(tr);
  }
  el.unrecognizedTableBody.appendChild(frag);
}

const INTAKE_FIELDS = ['product', 'tipe', 'lantai', 'box', 'company', 'description'];

function intakeFieldInput(rec, field) {
  const value = rec[field] == null ? '' : rec[field];
  return `<input type="text" class="intake-field-input" data-row-index="${rec.rowIndex}" data-field="${field}" value="${escapeHtml(value)}" placeholder="${field}..." />`;
}

// New-product intake rows are always fully editable (unlike renderTable's read-only-unless-empty
// Tipe cell) since every field is being classified by hand for the first time.
export function renderIntakeTable(records) {
  el.intakeTableBody.innerHTML = '';
  const frag = document.createDocumentFragment();
  for (const rec of records) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${escapeHtml(rec.sn ?? '')}</td>
      ${INTAKE_FIELDS.map((field) => `<td>${intakeFieldInput(rec, field)}</td>`).join('')}
      <td>${rec.foundAt ? new Date(rec.foundAt).toLocaleTimeString() : ''}</td>
      <td></td>
    `;
    const actionTd = tr.lastElementChild;
    const btn = document.createElement('button');
    btn.className = 'btn btn--small';
    btn.textContent = 'Remove';
    btn.dataset.rowIndex = String(rec.rowIndex);
    btn.dataset.action = 'remove';
    actionTd.appendChild(btn);
    frag.appendChild(tr);
  }
  el.intakeTableBody.appendChild(frag);
}

export function renderIntakeCount(count) {
  el.intakeCount.textContent = `${count} product${count === 1 ? '' : 's'} added`;
}

export function flashScannerInput(kind) {
  el.scannerInput.classList.remove('flash-found', 'flash-duplicate', 'flash-unrecognized', 'flash-mac-hint');
  // force reflow so the animation can restart if the same class is reapplied quickly
  void el.scannerInput.offsetWidth;
  el.scannerInput.classList.add(`flash-${kind}`);
}

export function flashCamera(kind) {
  el.cameraVideo.classList.remove('flash-found', 'flash-duplicate', 'flash-unrecognized', 'flash-mac-hint');
  void el.cameraVideo.offsetWidth;
  el.cameraVideo.classList.add(`flash-${kind}`);
}

export function populateCameraDevices(devices, selectedId) {
  el.cameraDeviceSelect.innerHTML = '';
  devices.forEach((d, i) => {
    const opt = document.createElement('option');
    opt.value = d.deviceId;
    opt.textContent = d.label || `Camera ${i + 1}`;
    if (d.deviceId === selectedId) opt.selected = true;
    el.cameraDeviceSelect.appendChild(opt);
  });
}

export function setCameraRunning(running) {
  el.cameraStartBtn.classList.toggle('hidden', running);
  el.cameraStopBtn.classList.toggle('hidden', !running);
  if (!running) el.cameraScanStatus.textContent = '';
}

export function setCameraScanStatus(text) {
  el.cameraScanStatus.textContent = text;
}

export function setRemoteUrl(url) {
  if (url) {
    el.remoteUrl.textContent = url;
    el.remoteCopyBtn.classList.remove('hidden');
  } else {
    el.remoteUrl.textContent = 'Unavailable — restart via run-server.ps1 or "Klik Ini 2 kali.bat".';
    el.remoteCopyBtn.classList.add('hidden');
  }
}

export function setRemoteStatus(text) {
  el.remoteStatus.textContent = text;
}

export function setScannerInputEnabled(enabled) {
  el.scannerInput.disabled = !enabled;
  el.scannerReadyDot.classList.toggle('ready', enabled);
}

export function setExportEnabled(enabled) {
  el.exportBtn.disabled = !enabled;
}

let exportStatusTimer = null;

export function showExportStatus(text, isError) {
  el.exportStatus.textContent = text;
  el.exportStatus.style.color = isError ? 'var(--red)' : 'var(--green)';
  clearTimeout(exportStatusTimer);
  exportStatusTimer = setTimeout(() => {
    el.exportStatus.textContent = '';
  }, 8000);
}

export function setResetEnabled(enabled) {
  el.resetProgressBtn.disabled = !enabled;
}

export function renderHotkeyList(mappings) {
  el.hotkeyList.innerHTML = '';
  for (const m of mappings) {
    const row = document.createElement('div');
    row.className = 'hotkey-row';
    row.innerHTML = `
      <span class="hotkey-key">Alt+${escapeHtml(m.key)}</span>
      <input type="text" class="hotkey-label-input" data-key="${escapeHtml(m.key)}" value="${escapeHtml(m.label)}" placeholder="Label..." />
      <button class="btn btn--small hotkey-remove-btn" data-key="${escapeHtml(m.key)}">Remove</button>
    `;
    el.hotkeyList.appendChild(row);
  }
}

export function renderLastScannedHint(rec, sheetName) {
  if (!rec) {
    el.hotkeyLastScanned.textContent = 'Scan an item first, then press Alt+<number> to tag it.';
    return;
  }
  const cond = rec.condition ? ` — currently tagged "${rec.condition}"` : '';
  el.hotkeyLastScanned.textContent = `Last scanned: ${rec.sn} (${sheetName})${cond}`;
}
