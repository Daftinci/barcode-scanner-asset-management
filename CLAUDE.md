# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static, no-build client-side web app that scans device serial-number barcodes — via a
keyboard-wedge USB/Bluetooth scanner, a phone's own camera (over the local Wi-Fi, `mobile.html`),
or a local webcam/DroidCam — and checks them off against a client's device-list Excel workbook.
All app logic (matching, workbook state, checklist UI) runs in the PC's browser and persists to
its `localStorage`; `server.py` is not a real backend, just a static file server plus a tiny
in-memory relay queue so a second device (the phone) can hand it decoded barcodes. See "Remote
phone scanner relay" below.

## Running / developing

- Start the local server: double-click `Klik Ini 2 kali.bat` or `run-server.ps1`, or run
  `python server.py 8000` from the repo root and open `http://localhost:8000`. Do **not** use
  plain `python -m http.server` — that serves the static files fine but has none of the
  `/api/*` relay routes, so the remote phone scanner silently won't work (the PC page's "Remote
  phone scanner" panel will say so). There is no dev server, bundler, or build step otherwise.
- Use Chrome or Edge for testing, on both the PC and any phone (camera device enumeration/labels
  are unreliable in Firefox).
- There is no test suite (`npm test` is a stub) and no linter configured. Verify changes by
  loading the app in a browser and exercising the scan flow manually.
- `js/app.js` is loaded as an ES module (`<script type="module">`) directly by `index.html` —
  no transpilation/bundling occurs, so only use syntax the target browsers support natively.
- `vendor/xlsx/xlsx.full.min.js` (SheetJS) and `vendor/zxing/zxing.min.js` are loaded as plain
  global-exposing `<script>` tags (not modules) before `js/app.js`, so `XLSX` and `ZXing` are
  available as globals inside the `js/` modules without an import. `package.json`'s
  `devDependencies` are only for editor/type support — the actual runtime code is the vendored
  copies in `vendor/`, and they are what ships. If upgrading a library version, update the
  vendored file (and its `LICENSE`), not just `package.json`.

## Architecture

Plain ES modules under `js/`, wired together in `js/app.js` (no framework, no build step):

- **`app.js`** — entry point and event wiring. Holds the one piece of mutable app state,
  `workbookData` (`{ fileName, fileSize, lastModified, clientName, records, index,
  unrecognizedLog }`), and orchestrates the other modules. Every mutation to `workbookData`
  is followed by a call to `persistProgress()` (writes to `localStorage`) and a re-render.
- **`xlsx-handler.js`** — loads a `.xlsx`/`.xls` `File` via SheetJS, delegates row parsing to
  `match-index.js`, and builds/writes the exported results workbook. Never mutates or
  re-saves the source file — export always creates a brand-new workbook.
- **`match-index.js`** — the domain logic, framework-free and easiest to unit-reason about in
  isolation:
  - `parseSheetRows`: turns a sheet's raw `header:1` rows into `records`, resolving columns by
    normalized header name (`sn`, `mac`, `product`, `tipe`, `box`, `lantai`, `company`,
    `description`). Throws if no `SN` column is found — this is how `xlsx-handler.js` decides
    a given sheet isn't a scannable client list (e.g. a PivotTable summary tab) and skips to
    the next sheet in the workbook.
  - `buildMatchIndex`: builds `Map<normalizedCode, rowIndex[]>` indexes for SN and MAC so scans
    resolve in O(1).
  - `matchScan`: given a raw scanned string, returns one of four outcomes —
    `found` (first pending row with matching SN), `duplicate` (SN matches but already found),
    `mac-hint` (the scanned code matches a MAC, not an SN — the user likely scanned the wrong
    barcode), or `unrecognized`.
- **`scanner.js`** (`CameraScanner`) — wraps ZXing's `BrowserMultiFormatReader` for
  camera-based decoding (Code128 primary, plus Code39/EAN-13/UPC-A/UPC-E/QR Code/PDF417), with a
  1.5s debounce so a barcode sitting in frame isn't decoded repeatedly. Used by both `app.js`
  (PC-side local webcam/DroidCam panel) and `mobile.js` (phone's own camera). Starts the stream
  via `decodeFromConstraints` with `width`/`height` ideal-1080p and `focusMode: continuous`
  hints (best-effort — ignored if the device/driver doesn't support them, so this is safe to
  request even for DroidCam's virtual camera). Also exposes `getVideoTrack()`/`torchSupported()`/
  `setTorch()` for the phone's flashlight toggle, which only works on a real camera track, not
  DroidCam's.
- **`hid-scanner.js`** (`HidScanner`) — captures input from hardware keyboard-wedge scanners.
  Keeps a dedicated `<input>` focused at all times (refocusing after a short delay on blur, so
  clicking into the search box or a table button doesn't get fought over) and treats an
  Enter-terminated buffer as one discrete scan. Also has a document-level fallback listener in
  case focus lands elsewhere. All scanning inputs (camera, HID, and remote/relay) funnel into
  the same `handleScan()` callback in `app.js`.
- **`relay.js`** — thin `fetch()` client for `server.py`'s `/api/*` endpoints, imported by both
  `app.js` (polls `GET /api/scan`, pushes `POST /api/session`) and `mobile.js` (posts
  `POST /api/scan`, polls `GET /api/session`). Every call is expected to potentially fail (404)
  if the app isn't being served by `server.py` — callers treat that as "remote scanning
  unavailable," not a fatal error.
- **`mobile.js`** / **`mobile.html`** — the phone-facing page. Full-screen camera view with a
  CSS viewfinder overlay, built on the same `CameraScanner` as the PC page. On every decode it
  queues the code and POSTs it to `/api/scan` (retrying on network failure so a scan is never
  silently dropped), and polls `/api/session` every 2s to show the PC's current client
  name/progress in its header. It has no access to the workbook and does no matching — that
  still happens only on the PC.
- **`state.js`** — all `localStorage` persistence. Scan progress is keyed by a cheap file
  fingerprint (`name|size|lastModified`, see `fingerprintFor`), not file content, since the
  app can't silently reopen a file handle after a page reload — the user must re-select the
  same file to resume. Also persists the last-session summary (for the resume banner), the
  last-used camera device, and user-configurable condition hotkey mappings (Alt+1..9 →
  free-text label, e.g. "Lengkap"/"Tanpa Gagang").
- **`ui.js`** — pure DOM rendering/query helpers (`el` is a cache of `getElementById` lookups
  done once at module load). No business logic lives here; it only reads data structures and
  updates the page.
- **`audio.js`** — WebAudio-generated feedback tones (no audio asset files). The
  `AudioContext` must be unlocked from a user gesture (`app.js` does this on the first
  click/keydown) before any tone will actually play.

### Remote phone scanner relay (`server.py`)

`server.py` replaces the plain `python -m http.server` this project used to run. It still serves
static files exactly the same way (`http.server.SimpleHTTPRequestHandler`), but also handles a
few `/api/*` routes as an in-memory, non-persistent relay — nothing is written to disk, restarting
the server clears all state, and it never talks to anything outside the local machine/network:

- `GET /api/info` — `{ lanUrl }`, the server's best-guess LAN URL (used by `app.js` to display
  the address the phone should open).
- `GET /api/scan/latest` — `{ lastId }`, the current high-water mark with no items; `app.js`
  calls this once on load so a fresh PC page session doesn't replay old backlog scans.
- `GET /api/scan?after=N` — `{ lastId, scans: [...] }`, scans with `id > N`. `app.js` polls this
  every 700ms while a workbook/intake session is loaded and feeds each result into `handleScan()`
  with `source: 'remote'`.
- `POST /api/scan` — `{ text, format }`, called by `mobile.js` on every decode. Bounded backlog
  (last 500), so a PC that's briefly unreachable doesn't grow the queue unboundedly.
- `GET`/`POST /api/session` — `{ clientName, status }`, a one-shot "what's currently loaded"
  string `app.js` pushes (debounced) so `mobile.js` can show it in its header. Overwritten, not
  queued — there's only ever one current session.

Scans posted before the PC has a workbook/intake session loaded are **not** dropped — `app.js`'s
poll loop no-ops while `workbookData` is null, so they sit in the server's queue and get applied
as soon as a session starts. This is intentional (no data loss if the phone operator scans before
the PC catches up) but means an operator switching clients should double check the right session
is loaded before resuming scanning.

`server.py` also reads `PORT`/`PUBLIC_HOST`/`PUBLIC_PORT` from the environment (see its module
docstring) so it can run in a container — see `Dockerfile`/`docker-compose.yml`/`DEPLOYMENT.md`.
`PUBLIC_HOST` exists because `_lan_ip()`'s auto-detect trick (open a UDP socket to 8.8.8.8 and
read the local sockname) reports the *container's* internal bridge address when dockerized, not
anything a phone on the real LAN can reach — deployers must set it explicitly. The relay
endpoints have no authentication either way (by design, per the project's current trust model:
internal LAN/VPN only, never expose this port to the public internet).

`server.py` can also speak HTTPS: if `TLS_CERT`/`TLS_KEY` env vars are set, or `cert.pem`/
`key.pem` exist in the working directory, it wraps its listening socket in `ssl.SSLContext`
(`SCHEME` becomes `'https'`, which also changes the protocol in `/api/info`'s advertised
`lanUrl`). This exists specifically because **iOS Safari does not expose
`navigator.mediaDevices.getUserMedia` at all on a plain `http://` origin** (unless it's
`localhost`) — `mobile.html`'s camera start silently fails with a `getUserMedia is not
defined`-style error on iPhone without it. `generate-cert.ps1`/`generate-cert.sh` create a
self-signed cert for a given IP/hostname via the `openssl` CLI (not a pip dependency — shells
out rather than vendoring a crypto library). In Docker, `docker-entrypoint.sh` auto-generates one
from `PUBLIC_HOST` at container startup if no cert was already provided/mounted, so HTTPS works
out of the box there; the plain local-run path requires running the generate script manually
once. A self-signed cert is sufficient — browsers still treat the connection as a secure context
once the user taps through the "not private" warning, which is the whole point.

When this app sits behind an existing reverse proxy (e.g. nginx already fronting other internal
apps on the same server, reusing whatever certificate it already has — see "Option A" in
`DEPLOYMENT.md`), set `PUBLIC_URL` instead of `PUBLIC_HOST`: it's a full URL override for
`/api/info`'s `lanUrl` and the startup log's advertised address, taking priority over the
`PUBLIC_HOST`/`PUBLIC_PORT`/`SCHEME` composition entirely
(`ADVERTISED_URL = PUBLIC_URL or f'{SCHEME}://{LAN_IP}:{PUBLIC_PORT}'`). In that mode
`PUBLIC_HOST`/`TLS_CERT`/`TLS_KEY` are deliberately left unset so the container stays plain HTTP
internally — the reverse proxy is what terminates HTTPS. Note the reused cert isn't necessarily
*publicly* trusted (the production deployment reuses a self-signed cert backed by an internal
CA — see the sibling app's `/ca-cert` download endpoint) — it just avoids a *second*,
*different* self-signed-cert warning on top of whatever trust story the fronting app already
has, and if a device already trusts that CA (e.g. from using the other app before), it's a
clean connection with no warning at all. This also tends to be the *only* way to reach the app
from outside the server's own subnet in networks that only publish a server's standard 80/443
ports through a gateway (a real scenario hit during development: a dev machine on a different
network could reach an internal nginx-fronted app on 443 but got "destination net unreachable"
for the container's own port 8000 directly).

`PUBLIC_URL` can include a path prefix (e.g. `https://host/scanner`, no trailing slash — `app.js`
appends `/mobile.html` directly onto it) for hosting under an already-resolving hostname instead
of requesting a new DNS record for a dedicated subdomain — see DEPLOYMENT.md's "A2" variant. This
only works because `js/relay.js`'s fetch calls use *relative* paths (`api/info`, not `/api/info`)
rather than absolute ones, so they resolve against whatever prefix the current page was loaded
under. That relies on the page's own URL ending in a slash (bare `index.html`/`mobile.html`
requests naturally do); nginx must 301-redirect a bare path-with-no-trailing-slash to the
slash-terminated form, and its `proxy_pass` needs a trailing slash on both the `location` and the
target to strip the prefix before forwarding to the container (which knows nothing about being
under a prefix — it always serves its own routes at its own root).

One real deployment of this app does exactly this, fronted by a sibling internal app's own
nginx rather than a dedicated subdomain. Two nginx-specific gotchas worth knowing if you're
doing the same:
- **If nginx itself runs in its own separate Docker container** (not on the host directly),
  its `location /scanner/` block needs to reach this app via `proxy_pass
  http://host.docker.internal:8000/` — `127.0.0.1` from inside *that* container means itself,
  not the Windows host running this app's own container.
- **A containerized nginx's config is often baked into that image at build time, not
  bind-mounted** — editing a local checkout of it does nothing at runtime. Find the real source
  in that other project's own repo/build context and rebuild+recreate that service to pick up
  changes. Also, what got copied in at build time isn't necessarily `/etc/nginx/nginx.conf`
  itself inside the running container — that image's base `nginx.conf` just does
  `include /etc/nginx/conf.d/*.conf;`, and the real site config ends up at
  `/etc/nginx/conf.d/default.conf` instead. `docker exec <container> cat <path>` to confirm
  which file actually has the `server { }` blocks before assuming an edit took effect.

### Key invariants to preserve

- **One workbook = one client.** Each client has their own `.xlsx` file; multi-sheet
  client-per-tab workbooks are explicitly not supported (only the first sheet with an `SN`
  header column is read).
- **Source workbooks are never modified.** Export always writes a new
  `<client name> - Scan Results.xlsx` file rather than touching the loaded file.
- Row identity for progress persistence and matching is `rowIndex` (0-based position among
  parsed data rows), not `sourceRow` (1-based original sheet row, kept only for reference).
- SN/MAC comparisons are always done on normalized codes (trimmed, uppercased) — see
  `normalizeCode` in `match-index.js`.
