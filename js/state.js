// localStorage persistence for scan progress. Keyed by a cheap file fingerprint
// (name+size+lastModified) since we can't silently re-open a file after reload
// without the File System Access API.

const PREFIX = 'ipphone-scanner:v1';

export function fingerprintFor(file) {
  return `${file.name}|${file.size}|${file.lastModified}`;
}

function progressKey(fingerprint) {
  return `${PREFIX}:${fingerprint}`;
}

const LAST_SESSION_KEY = `${PREFIX}:last-session`;
const LAST_DEVICE_KEY = `${PREFIX}:last-camera-device`;

export function saveSheetProgress(fingerprint, clientName, records, unrecognizedLog) {
  const payload = {
    clientName,
    rows: records
      .filter((r) => r.status !== 'pending' || r.condition || r.tipe)
      .map((r) => ({
        rowIndex: r.rowIndex,
        status: r.status,
        foundAt: r.foundAt,
        condition: r.condition,
        conditionAt: r.conditionAt,
        tipe: r.tipe,
      })),
    unrecognizedLog,
  };
  localStorage.setItem(progressKey(fingerprint), JSON.stringify(payload));
}

export function loadSheetProgress(fingerprint) {
  const raw = localStorage.getItem(progressKey(fingerprint));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearSheetProgress(fingerprint) {
  localStorage.removeItem(progressKey(fingerprint));
}

// Applies a previously-saved progress payload onto freshly-parsed records (mutates in place).
export function applyProgressToRecords(records, saved) {
  if (!saved || !saved.rows) return;
  const byRowIndex = new Map(saved.rows.map((r) => [r.rowIndex, r]));
  for (const rec of records) {
    const found = byRowIndex.get(rec.rowIndex);
    if (!found) continue;
    if (found.tipe) rec.tipe = found.tipe;
    if (rec.status !== 'no-sn') {
      rec.status = found.status;
      rec.foundAt = found.foundAt;
      rec.condition = found.condition ?? null;
      rec.conditionAt = found.conditionAt ?? null;
    }
  }
}

export function saveLastSession(summary) {
  localStorage.setItem(LAST_SESSION_KEY, JSON.stringify({ ...summary, savedAt: Date.now() }));
}

export function loadLastSession() {
  const raw = localStorage.getItem(LAST_SESSION_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearLastSession() {
  localStorage.removeItem(LAST_SESSION_KEY);
}

export function saveLastCameraDevice(deviceId) {
  localStorage.setItem(LAST_DEVICE_KEY, deviceId);
}

export function loadLastCameraDevice() {
  return localStorage.getItem(LAST_DEVICE_KEY);
}

function intakeKey(sessionKey) {
  return `${PREFIX}:intake:${sessionKey}`;
}

// Intake sessions have no source file to re-parse and merge onto, so (unlike
// saveSheetProgress) the full records array is the source of truth and is stored as-is.
export function saveIntakeSession(sessionKey, sessionName, records, defaults) {
  const payload = { sessionName, records, defaults };
  localStorage.setItem(intakeKey(sessionKey), JSON.stringify(payload));
}

export function loadIntakeSession(sessionKey) {
  const raw = localStorage.getItem(intakeKey(sessionKey));
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

export function clearIntakeSession(sessionKey) {
  localStorage.removeItem(intakeKey(sessionKey));
}

const HOTKEYS_KEY = `${PREFIX}:condition-hotkeys`;
const DEFAULT_HOTKEYS = [
  { key: '1', label: 'Tanpa Gagang' },
  { key: '2', label: 'Lengkap' },
];

export function loadConditionHotkeys() {
  const raw = localStorage.getItem(HOTKEYS_KEY);
  if (!raw) return DEFAULT_HOTKEYS.slice();
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length ? parsed : DEFAULT_HOTKEYS.slice();
  } catch (e) {
    return DEFAULT_HOTKEYS.slice();
  }
}

export function saveConditionHotkeys(mappings) {
  localStorage.setItem(HOTKEYS_KEY, JSON.stringify(mappings));
}
