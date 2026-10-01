// Thin client for server.py's /api/* endpoints — the local relay that lets the phone-facing
// mobile.html hand decoded barcodes to the PC-facing index.html over the same Wi-Fi, without a
// real backend. Every call here is best-effort: if these endpoints don't exist (e.g. the app is
// being served by something other than server.py), callers should treat that as "remote
// scanning unavailable" rather than a hard error.
//
// Paths here are relative (no leading slash) rather than absolute (/api/...) so they keep
// working when the app is reverse-proxied under a path prefix (e.g. https://host/scanner/) —
// see DEPLOYMENT.md's "Option A". They resolve against the current page's own URL, so this
// only works correctly if that URL ends in a slash (bare index.html/mobile.html requests do;
// nginx must redirect a bare "/scanner" to "/scanner/" for the prefix case, also covered in
// DEPLOYMENT.md).

async function getJson(path) {
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

async function postJson(path, body) {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} -> ${res.status}`);
  return res.json();
}

export function fetchInfo() {
  return getJson('api/info');
}

export async function fetchLatestScanId() {
  const { lastId } = await getJson('api/scan/latest');
  return lastId;
}

export function pollScans(afterId) {
  return getJson(`api/scan?after=${encodeURIComponent(afterId)}`);
}

export function postScan(text, format) {
  return postJson('api/scan', { text, format });
}

export function fetchSession() {
  return getJson('api/session');
}

export function postSession(clientName, status) {
  return postJson('api/session', { clientName, status });
}
