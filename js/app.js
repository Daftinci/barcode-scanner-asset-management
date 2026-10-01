import { loadWorkbookFile, exportResultsFile } from './xlsx-handler.js';
import { matchScan, matchIntakeScan, buildMatchIndex } from './match-index.js';
import { CameraScanner } from './scanner.js';
import { HidScanner } from './hid-scanner.js';
import * as state from './state.js';
import * as audio from './audio.js';
import * as ui from './ui.js';
import * as relay from './relay.js';

let workbookData = null; // { fileName, fileSize, lastModified, clientName, records, index, unrecognizedLog }
let fingerprint = null;
let cameraScanner = null;
let hidScanner = null;
let tableFilter = { search: '', filter: 'all' };
let lastScanned = null; // rowIndex — target for condition hotkeys
let hotkeyMappings = state.loadConditionHotkeys();
let intakeSessionKey = null; // captured once at intake session start, independent of the editable clientName display value
let intakeDefaults = { product: null, tipe: null, box: null, lantai: null, company: null, description: null };

// --- one-time audio unlock on first user gesture ---
function unlockAudioOnce() {
  audio.unlock();
  document.removeEventListener('click', unlockAudioOnce);
  document.removeEventListener('keydown', unlockAudioOnce);
}
document.addEventListener('click', unlockAudioOnce);
document.addEventListener('keydown', unlockAudioOnce);

// --- resume banner on startup ---
function showResumeBannerIfAny() {
  const last = state.loadLastSession();
  if (!last) return;
  ui.showBanner(
    ui.el.resumeBanner,
    ui.el.resumeBannerText,
    `Last session: "${last.clientName}" from "${last.fileName}" (${last.found}/${last.total}) — re-select that same file to resume where you left off.`
  );
}
ui.el.resumeDismissBtn.addEventListener('click', () => ui.hideBanner(ui.el.resumeBanner));
ui.el.cameraErrorDismissBtn.addEventListener('click', () => ui.hideBanner(ui.el.cameraErrorBanner));
showResumeBannerIfAny();

// --- workbook loading ---
ui.el.fileInput.addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  try {
    ui.renderFileInfo('Loading...');
    const data = await loadWorkbookFile(file);
    fingerprint = state.fingerprintFor(file);

    const saved = state.loadSheetProgress(fingerprint);
    workbookData = {
      mode: 'checklist',
      fileName: data.fileName,
      fileSize: data.fileSize,
      lastModified: data.lastModified,
      clientName: (saved && saved.clientName) || data.detectedSheetName,
      records: data.records,
      index: data.index,
      unrecognizedLog: [],
    };
    intakeSessionKey = null;
    if (saved) {
      state.applyProgressToRecords(workbookData.records, saved);
      workbookData.unrecognizedLog = saved.unrecognizedLog || [];
      // Backfill ids for entries logged before per-entry classification fields existed.
      for (const entry of workbookData.unrecognizedLog) {
        if (!entry.id) entry.id = crypto.randomUUID();
      }
    }

    ui.renderFileInfo(`${file.name} — ${workbookData.records.length} rows`);
    ui.el.clientNameInput.disabled = false;
    ui.el.clientNameInput.value = workbookData.clientName;
    ui.setScannerInputEnabled(true);
    ui.setExportEnabled(true);
    ui.setResetEnabled(true);
    ui.hideBanner(ui.el.resumeBanner);
    ui.setMode('checklist');

    if (!hidScanner) {
      hidScanner = new HidScanner({ inputEl: ui.el.scannerInput, onDecode: handleScan });
    }

    lastScanned = null;
    ui.renderLastScannedHint(null);
    ui.el.recentScansList.innerHTML = '';
    renderClientName();
    renderUnrecognizedFull();
    renderClient();
    persistLastSessionSummary();
  } catch (err) {
    console.error(err);
    ui.renderFileInfo(`Error loading file: ${err.message}`);
  }
});

ui.el.clientNameInput.addEventListener('input', (e) => {
  if (!workbookData) return;
  workbookData.clientName = e.target.value;
  renderClientName();
  persistProgress();
});

// --- new product intake (no source workbook — every scan is a brand-new device) ---
ui.el.intakeStartBtn.addEventListener('click', () => {
  const name = ui.el.clientNameInput.value.trim();
  if (!name) {
    ui.renderFileInfo('Enter a client / session name above before starting a new product intake.');
    ui.el.clientNameInput.focus();
    return;
  }

  const saved = state.loadIntakeSession(name);
  const records = (saved && saved.records) || [];
  intakeSessionKey = name;
  fingerprint = null;
  workbookData = {
    mode: 'intake',
    fileName: null,
    fileSize: null,
    lastModified: null,
    clientName: (saved && saved.sessionName) || name,
    records,
    index: buildMatchIndex(records),
    unrecognizedLog: [],
  };
  intakeDefaults = (saved && saved.defaults) || { product: null, tipe: null, box: null, lantai: null, company: null, description: null };

  ui.renderFileInfo(`Intake session "${workbookData.clientName}" — ${records.length} product(s) so far`);
  ui.el.clientNameInput.value = workbookData.clientName;
  ui.setScannerInputEnabled(true);
  ui.setExportEnabled(true);
  ui.setResetEnabled(true);
  ui.hideBanner(ui.el.resumeBanner);
  ui.setMode('intake');

  if (!hidScanner) {
    hidScanner = new HidScanner({ inputEl: ui.el.scannerInput, onDecode: handleScan });
  }

  lastScanned = null;
  ui.renderLastScannedHint(null);
  ui.el.recentScansList.innerHTML = '';
  renderClientName();
  renderIntakeFull();
});

function renderClientName() {
  ui.renderClientName(workbookData ? workbookData.clientName : null);
  pushSessionInfoDebounced();
}

function persistLastSessionSummary() {
  const scannable = workbookData.records.filter((r) => r.status !== 'no-sn');
  state.saveLastSession({
    fileName: workbookData.fileName,
    fileSize: workbookData.fileSize,
    lastModified: workbookData.lastModified,
    clientName: workbookData.clientName,
    total: scannable.length,
    found: scannable.filter((r) => r.status === 'found').length,
  });
}

function persistProgress() {
  if (workbookData.mode === 'intake') {
    persistIntake();
    pushSessionInfoDebounced();
    return;
  }
  state.saveSheetProgress(fingerprint, workbookData.clientName, workbookData.records, workbookData.unrecognizedLog);
  persistLastSessionSummary();
  pushSessionInfoDebounced();
}

function persistIntake() {
  state.saveIntakeSession(intakeSessionKey, workbookData.clientName, workbookData.records, intakeDefaults);
}

function renderClient() {
  if (!workbookData) return;
  ui.renderStats(workbookData.records);
  ui.renderTable(workbookData.records, tableFilter);
}

function renderIntakeFull() {
  if (!workbookData) return;
  ui.renderIntakeTable(workbookData.records);
  ui.renderIntakeCount(workbookData.records.length);
}

function renderUnrecognizedFull() {
  ui.renderUnrecognizedTable(workbookData ? workbookData.unrecognizedLog : []);
}

// --- table search/filter ---
ui.el.searchInput.addEventListener('input', (e) => {
  tableFilter.search = e.target.value;
  renderClient();
});
ui.el.filterSelect.addEventListener('change', (e) => {
  tableFilter.filter = e.target.value;
  renderClient();
});

// --- manual mark/unmark via table buttons ---
ui.el.dataTableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn || !workbookData) return;
  const rowIndex = Number(btn.dataset.rowIndex);
  const rec = workbookData.records.find((r) => r.rowIndex === rowIndex);
  if (!rec) return;
  if (btn.dataset.action === 'mark') {
    rec.status = 'found';
    rec.foundAt = Date.now();
    rec.foundBy = 'manual';
    setLastScanned(rec.rowIndex);
  } else {
    rec.status = 'pending';
    rec.foundAt = null;
    rec.condition = null;
    rec.conditionAt = null;
  }
  persistProgress();
  renderClient();
});

// --- inline "Tipe" edit (only offered when the cell is empty, see ui.js's tipeCellHtml) ---
ui.el.dataTableBody.addEventListener('change', (e) => {
  const input = e.target.closest('.tipe-input');
  if (!input || !workbookData) return;
  const rowIndex = Number(input.dataset.rowIndex);
  const rec = workbookData.records.find((r) => r.rowIndex === rowIndex);
  if (!rec) return;
  const value = input.value.trim();
  if (!value) return;
  rec.tipe = value;
  persistProgress();
  renderClient();
});

ui.el.dataTableBody.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('tipe-input')) {
    e.target.blur();
  }
});

// --- condition hotkeys (Alt+1..9), tag the most recently scanned/marked item ---
function setLastScanned(rowIndex) {
  lastScanned = rowIndex;
  const rec = workbookData.records.find((r) => r.rowIndex === rowIndex);
  ui.renderLastScannedHint(rec, workbookData.clientName);
}

function renderHotkeys() {
  ui.renderHotkeyList(hotkeyMappings);
}

function applyConditionHotkey(key) {
  if (!workbookData) return;
  const mapping = hotkeyMappings.find((m) => m.key === key && m.label.trim());
  if (!mapping) return;
  if (lastScanned == null) {
    ui.renderLastScannedHint(null);
    return;
  }
  const rec = workbookData.records.find((r) => r.rowIndex === lastScanned);
  if (!rec || rec.status !== 'found') return;

  rec.condition = mapping.label.trim();
  rec.conditionAt = Date.now();
  persistProgress();
  renderClient();
  ui.renderLastScannedHint(rec, workbookData.clientName);
  ui.pushRecentScan({
    source: 'keyboard',
    kind: 'condition',
    text: rec.sn,
    message: `Condition: ${rec.condition}`,
    timestamp: rec.conditionAt,
  });
}

document.addEventListener('keydown', (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey) return;
  if (!/^[1-9]$/.test(e.key)) return;
  if (document.activeElement && document.activeElement.classList.contains('hotkey-label-input')) return;
  e.preventDefault();
  applyConditionHotkey(e.key);
});

ui.el.hotkeyAddBtn.addEventListener('click', () => {
  const used = new Set(hotkeyMappings.map((m) => m.key));
  const nextKey = '123456789'.split('').find((k) => !used.has(k));
  if (!nextKey) return;
  hotkeyMappings.push({ key: nextKey, label: '' });
  state.saveConditionHotkeys(hotkeyMappings);
  renderHotkeys();
});

ui.el.hotkeyList.addEventListener('input', (e) => {
  const input = e.target.closest('.hotkey-label-input');
  if (!input) return;
  const mapping = hotkeyMappings.find((m) => m.key === input.dataset.key);
  if (!mapping) return;
  mapping.label = input.value;
  state.saveConditionHotkeys(hotkeyMappings);
});

ui.el.hotkeyList.addEventListener('click', (e) => {
  const btn = e.target.closest('.hotkey-remove-btn');
  if (!btn) return;
  hotkeyMappings = hotkeyMappings.filter((m) => m.key !== btn.dataset.key);
  state.saveConditionHotkeys(hotkeyMappings);
  renderHotkeys();
});

renderHotkeys();
ui.renderLastScannedHint(null);

// --- scan handling (shared by camera + hardware scanner) ---
function handleScan(payload) {
  if (!workbookData) return;
  if (workbookData.mode === 'intake') {
    handleIntakeScan(payload);
    return;
  }
  const result = matchScan(payload.text, workbookData.records, workbookData.index);
  const timestamp = Date.now();

  if (result.kind === 'found') {
    const rec = workbookData.records[result.rowIndex];
    rec.status = 'found';
    rec.foundAt = timestamp;
    rec.foundBy = payload.source;
    audio.playFound();
    ui.flashScannerInput('found');
    ui.flashCamera('found');
    ui.pushRecentScan({ ...payload, kind: 'found', message: `Found: ${rec.sn}`, timestamp });
    setLastScanned(rec.rowIndex);
    renderClient();
    persistProgress();
  } else if (result.kind === 'duplicate') {
    const rec = workbookData.records[result.rowIndex];
    audio.playDuplicate();
    ui.flashScannerInput('duplicate');
    ui.flashCamera('duplicate');
    ui.pushRecentScan({
      ...payload,
      kind: 'duplicate',
      message: `Already scanned (${rec.sn}${rec.foundAt ? ' @ ' + new Date(rec.foundAt).toLocaleTimeString() : ''})`,
      timestamp,
    });
    setLastScanned(rec.rowIndex);
  } else if (result.kind === 'mac-hint') {
    audio.playUnrecognized();
    ui.flashScannerInput('mac-hint');
    ui.flashCamera('mac-hint');
    ui.pushRecentScan({
      ...payload,
      kind: 'mac-hint',
      message: `That looks like a MAC address — scan the SN barcode instead`,
      timestamp,
    });
  } else {
    audio.playUnrecognized();
    ui.flashScannerInput('unrecognized');
    ui.flashCamera('unrecognized');
    const entry = {
      ...payload,
      timestamp,
      id: crypto.randomUUID(),
      product: null,
      tipe: null,
      company: null,
      description: null,
    };
    workbookData.unrecognizedLog.push(entry);
    renderUnrecognizedFull();
    ui.pushRecentScan({ ...payload, kind: 'unrecognized', message: `Not found in ${workbookData.clientName}`, timestamp });
    persistProgress();
  }
}

// Every scan either registers a brand-new device (no preloaded list to check off against) or
// repeats one already added earlier in this intake session.
function handleIntakeScan(payload) {
  const result = matchIntakeScan(payload.text, workbookData.index.snIndex);
  const timestamp = Date.now();

  if (result.kind === 'unrecognized') {
    audio.playUnrecognized();
    ui.flashScannerInput('unrecognized');
    ui.flashCamera('unrecognized');
    return;
  }

  if (result.kind === 'duplicate') {
    const rec = workbookData.records[result.rowIndex];
    audio.playDuplicate();
    ui.flashScannerInput('duplicate');
    ui.flashCamera('duplicate');
    ui.pushRecentScan({
      ...payload,
      kind: 'duplicate',
      message: `Already added (${rec.sn})`,
      timestamp,
    });
    setLastScanned(rec.rowIndex);
    return;
  }

  const rowIndex = workbookData.records.length;
  const rec = {
    rowIndex,
    sourceRow: null,
    sn: payload.text.trim(),
    snNorm: result.codeNorm,
    mac: null,
    macNorm: null,
    product: intakeDefaults.product,
    tipe: intakeDefaults.tipe,
    box: intakeDefaults.box,
    lantai: intakeDefaults.lantai,
    company: intakeDefaults.company,
    description: intakeDefaults.description,
    status: 'found',
    foundAt: timestamp,
    foundBy: payload.source,
    condition: null,
    conditionAt: null,
  };
  workbookData.records.push(rec);
  if (!workbookData.index.snIndex.has(rec.snNorm)) workbookData.index.snIndex.set(rec.snNorm, []);
  workbookData.index.snIndex.get(rec.snNorm).push(rowIndex);

  audio.playFound();
  ui.flashScannerInput('found');
  ui.flashCamera('found');
  ui.pushRecentScan({ ...payload, kind: 'found', message: `Added: ${rec.sn}`, timestamp });
  setLastScanned(rowIndex);
  renderIntakeFull();
  persistProgress();
}

// --- editable classification fields + row removal for intake sessions ---
ui.el.intakeTableBody.addEventListener('change', (e) => {
  const input = e.target.closest('.intake-field-input');
  if (!input || !workbookData) return;
  const rowIndex = Number(input.dataset.rowIndex);
  const rec = workbookData.records.find((r) => r.rowIndex === rowIndex);
  if (!rec) return;
  const field = input.dataset.field;
  const value = input.value.trim() || null;
  rec[field] = value;
  intakeDefaults[field] = value; // carries forward as the default for the next new scan
  persistProgress();
});

ui.el.intakeTableBody.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('intake-field-input')) {
    e.target.blur();
  }
});

ui.el.intakeTableBody.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action="remove"]');
  if (!btn || !workbookData) return;
  const rowIndex = Number(btn.dataset.rowIndex);
  workbookData.records = workbookData.records
    .filter((r) => r.rowIndex !== rowIndex)
    .map((r, i) => ({ ...r, rowIndex: i }));
  workbookData.index = buildMatchIndex(workbookData.records);
  lastScanned = null; // any prior rowIndex reference may now point at a different record after reindexing
  ui.renderLastScannedHint(null);
  persistProgress();
  renderIntakeFull();
});

ui.el.unrecognizedClearBtn.addEventListener('click', () => {
  if (!workbookData) return;
  workbookData.unrecognizedLog = [];
  renderUnrecognizedFull();
  persistProgress();
});

// --- editable classification fields on unrecognized scans (Product/Tipe/Company/Description) ---
ui.el.unrecognizedTableBody.addEventListener('change', (e) => {
  const input = e.target.closest('.unrecognized-field-input');
  if (!input || !workbookData) return;
  const entry = workbookData.unrecognizedLog.find((u) => u.id === input.dataset.id);
  if (!entry) return;
  entry[input.dataset.field] = input.value.trim() || null;
  persistProgress();
});

ui.el.unrecognizedTableBody.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && e.target.classList.contains('unrecognized-field-input')) {
    e.target.blur();
  }
});

// --- reset progress ---
ui.el.resetProgressBtn.addEventListener('click', () => {
  if (!workbookData) return;
  if (workbookData.mode === 'intake') {
    if (!confirm(`Clear all ${workbookData.records.length} scanned product(s) from "${workbookData.clientName}"? This cannot be undone.`)) return;
    workbookData.records = [];
    workbookData.index = buildMatchIndex([]);
    state.clearIntakeSession(intakeSessionKey);
    lastScanned = null;
    ui.renderLastScannedHint(null);
    renderIntakeFull();
    return;
  }
  if (!confirm(`Reset all scan progress for ${workbookData.clientName}? This cannot be undone.`)) return;
  for (const rec of workbookData.records) {
    if (rec.status !== 'no-sn') {
      rec.status = 'pending';
      rec.foundAt = null;
      rec.condition = null;
      rec.conditionAt = null;
    }
  }
  workbookData.unrecognizedLog = [];
  state.clearSheetProgress(fingerprint);
  renderUnrecognizedFull();
  renderClient();
  persistLastSessionSummary();
  lastScanned = null;
  ui.renderLastScannedHint(null);
});

// --- export ---
ui.el.exportBtn.addEventListener('click', () => {
  if (!workbookData) return;
  try {
    const outName = exportResultsFile(workbookData, workbookData.clientName);
    ui.showExportStatus(`Exported "${outName}" to your Downloads folder.`);
  } catch (err) {
    console.error(err);
    ui.showExportStatus(`Export failed: ${err.message}`, true);
  }
});

// --- camera controls ---
cameraScanner = new CameraScanner({
  videoEl: ui.el.cameraVideo,
  onDecode: handleScan,
  onTick: () => ui.setCameraScanStatus(`Scanning… last frame analyzed at ${new Date().toLocaleTimeString()}`),
  onError: (err) => {
    ui.showBanner(ui.el.cameraErrorBanner, ui.el.cameraErrorText, `Camera error: ${err.message || err}`);
    ui.setCameraRunning(false);
  },
});

async function refreshCameraDevices() {
  try {
    // Request permission first so device labels are populated.
    const stream = await navigator.mediaDevices.getUserMedia({ video: true });
    stream.getTracks().forEach((t) => t.stop());
    const devices = await cameraScanner.listVideoInputDevices();
    const lastDevice = state.loadLastCameraDevice();
    ui.populateCameraDevices(devices, lastDevice);
  } catch (err) {
    ui.showBanner(ui.el.cameraErrorBanner, ui.el.cameraErrorText, `Could not access camera: ${err.message || err}`);
  }
}

ui.el.cameraRefreshBtn.addEventListener('click', refreshCameraDevices);

ui.el.cameraStartBtn.addEventListener('click', async () => {
  const deviceId = ui.el.cameraDeviceSelect.value;
  try {
    await cameraScanner.start(deviceId);
    if (deviceId) state.saveLastCameraDevice(deviceId);
    ui.setCameraRunning(true);
    ui.hideBanner(ui.el.cameraErrorBanner);
  } catch (err) {
    ui.showBanner(ui.el.cameraErrorBanner, ui.el.cameraErrorText, `Could not start camera: ${err.message || err}`);
  }
});

ui.el.cameraStopBtn.addEventListener('click', async () => {
  await cameraScanner.stop();
  ui.setCameraRunning(false);
});

// --- remote phone scanner (mobile.html, relayed via server.py's /api/scan) ---
let remoteAvailable = false;
let remoteScanLastId = 0;
let sessionPushTimer = null;

function pushSessionInfoDebounced() {
  if (!remoteAvailable || !workbookData) return;
  clearTimeout(sessionPushTimer);
  sessionPushTimer = setTimeout(() => {
    let status;
    if (workbookData.mode === 'intake') {
      status = `${workbookData.records.length} product(s) added`;
    } else {
      const scannable = workbookData.records.filter((r) => r.status !== 'no-sn');
      const found = scannable.filter((r) => r.status === 'found').length;
      status = `${found}/${scannable.length} found`;
    }
    relay.postSession(workbookData.clientName, status).catch(() => {});
  }, 300);
}

async function pollRemoteScans() {
  if (!workbookData) return;
  try {
    const { lastId, scans } = await relay.pollScans(remoteScanLastId);
    remoteScanLastId = lastId;
    for (const s of scans) {
      handleScan({ text: s.text, format: s.format, source: 'remote' });
    }
    if (scans.length) {
      ui.setRemoteStatus(`Relay ready — last phone scan received at ${new Date().toLocaleTimeString()}.`);
    }
  } catch (err) {
    // Transient network hiccup (phone/PC briefly off Wi-Fi) — keep polling silently.
  }
}

async function initRemoteScan() {
  try {
    const info = await relay.fetchInfo();
    ui.setRemoteUrl(`${info.lanUrl}/mobile.html`);
    remoteScanLastId = await relay.fetchLatestScanId();
    remoteAvailable = true;
    ui.setRemoteStatus('Relay ready — waiting for phone scans.');
    setInterval(pollRemoteScans, 700);
    pushSessionInfoDebounced();
  } catch (err) {
    ui.setRemoteUrl(null);
    ui.setRemoteStatus(
      'Not running via the relay server — start the app with run-server.ps1 or "Klik Ini 2 kali.bat" (not by opening index.html directly) to enable phone scanning.'
    );
  }
}

ui.el.remoteCopyBtn.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(ui.el.remoteUrl.textContent);
    ui.setRemoteStatus('Copied to clipboard.');
  } catch (err) {
    // Clipboard API may be unavailable (e.g. insecure context) — the URL text is still selectable.
  }
});

initRemoteScan();
