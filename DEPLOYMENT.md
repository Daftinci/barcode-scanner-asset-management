# Deploying to a server (Docker)

This runs the same `server.py` used locally, just packaged into a container so it can live on a
shared Windows Server instead of one operator's laptop. Nothing about the app itself changes:
all workbook/progress state still lives in whichever browser an operator opens the page in
(`localStorage`), and the server is still just a static file host plus the small in-memory
phone-scan relay described in `CLAUDE.md`. Restarting the container clears the relay's in-memory
queue and "current session" status (by design — see `server.py`'s docstring) but never touches
any operator's browser data.

**Trust model**: the `/api/scan` and `/api/session` relay endpoints have no authentication.
That's fine as long as this server is only reachable from a trusted internal network (LAN/VPN) —
anyone who can reach `<host>:<port>` on the network can post fake scans or see what client is
currently being scanned. Don't expose this port to the public internet as-is.

## Prerequisites on the Windows Server

- Docker installed and running in **Linux container mode** (Docker Desktop with WSL2, or Docker
  Engine). Native Windows containers are not needed — `server.py` is pure Python stdlib with no
  OS-specific code. Check with:
  ```powershell
  docker info --format "{{.OSType}}"
  ```
  This should print `linux`. If it prints `windows`, switch Docker Desktop to Linux containers
  (right-click the Docker Desktop tray icon → "Switch to Linux containers…").
- Know the server's real LAN IP or a hostname that other devices on the network can resolve —
  you'll need it for `PUBLIC_HOST` below. Find it with:
  ```powershell
  Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }
  ```

## Build and run

From the project root (copy the whole folder to the server, or `git clone`/transfer it):

```powershell
docker compose up -d --build
```

Before that first run, edit `docker-compose.yml`'s `environment:` block — it needs either
`PUBLIC_URL` (Option A, reverse proxy — see below) or `PUBLIC_HOST` (Option B, direct access)
set correctly, not left as a placeholder/example value. Without one of these set correctly, the
"Remote phone scanner" panel would advertise either nothing useful or the container's internal
Docker network address, which no phone can reach. See `server.py`'s module docstring for the
full `PORT`/`PUBLIC_HOST`/`PUBLIC_PORT`/`PUBLIC_URL` reference (`PUBLIC_PORT` is only needed if
you map to a different external port, e.g. `-p 9000:8000`).

Without compose (Option B example — see below for Option A's extra nginx-side setup):

```powershell
docker build -t ip-phone-scanner .
docker run -d --name ip-phone-scanner -p 8000:8000 -e PUBLIC_HOST=192.168.1.50 --restart unless-stopped ip-phone-scanner
```

## HTTPS (required for iOS/Safari camera access)

iOS Safari refuses to even expose `navigator.mediaDevices.getUserMedia` on a plain `http://`
origin unless it's `localhost` — the remote phone scanner will fail with a `getUserMedia is not
a function`-style error on iPhone without HTTPS. Android Chrome is more lenient about this for
local network IPs, but HTTPS is recommended everywhere for consistency. There are two ways to
get there — pick one:

### Option A: behind an existing reverse proxy (recommended if the server already has one)

If the server already fronts other apps through nginx (or similar) with a real/trusted
certificate, reuse that instead of a self-signed one — phones get a clean HTTPS connection with
no "not private" warning to tap through at all. This is also frequently the *only* way phones
outside the server's own subnet can reach it at all: many networks only route/publish a server's
standard 80/443 ports through a gateway, leaving arbitrary ports like 8000 unreachable from
anywhere except devices on that exact subnet.

Two variants, depending on whether you can get a new DNS record added:

**A1 — new subdomain** (e.g. `scanner.example.com`) — needs a DNS record pointing at the server,
which may mean filing a request with whoever manages DNS if you don't have rights yourself.

**A2 — a path under an existing, already-resolving hostname** (e.g.
`https://existing-host.example.com/scanner/`) — no new DNS record needed at all, since the
hostname already works. Slightly more nginx config (a redirect + prefix strip), but you can do
it entirely yourself today. This is what the rest of this section assumes; for A1, just use the
new hostname with an empty path everywhere below.

1. Publish the container's port and set `PUBLIC_URL` to the full external URL nginx will expose
   it at, **with no trailing slash** (the app appends `/mobile.html` directly onto this):
   ```yaml
   ports:
     - "8000:8000"
   environment:
     - PUBLIC_URL=https://existing-host.example.com/scanner
   ```
   Leave `PUBLIC_HOST`/`TLS_CERT`/`TLS_KEY` unset — the container stays plain HTTP internally;
   nginx is what terminates HTTPS. `docker-entrypoint.sh` only auto-generates a self-signed cert
   when `PUBLIC_HOST` is set, so leaving it unset skips that entirely. (For A1 with a fresh
   subdomain and no path, this is the whole config — skip straight to the nginx block below with
   an empty `location /` instead of `location /scanner/`.)
2. **A1 only**: add a DNS record for the new hostname pointing at the server's address.
   **A2**: skip this — the hostname already resolves.
3. **If nginx itself runs in its own Docker container** (common — check with `docker ps`; if you
   see a `proxy_pass` in its config pointing at another Compose service name like
   `http://backend:3001` rather than `127.0.0.1:...`, that confirms it), `127.0.0.1` inside
   *that* container refers to itself, not the Windows host — use `host.docker.internal` instead,
   which Docker Desktop resolves to the host automatically from any container. If nginx runs
   directly on the host (not containerized), use `127.0.0.1` as normal.

   Add to the *existing* server block for that hostname (same `server { listen 443 ssl; ... }`
   block that already has `ssl_certificate`/`ssl_certificate_key` in it — don't duplicate those
   directives, just add these two `location` blocks inside it):
   ```nginx
   # Redirects a bare "/scanner" (no trailing slash) to "/scanner/" — required because the
   # app's asset/API references are relative to the page's own URL, which only resolves
   # correctly with the trailing slash present.
   location = /scanner {
       return 301 /scanner/;
   }

   location /scanner/ {
       proxy_pass http://host.docker.internal:8000/;   # or 127.0.0.1 if nginx isn't containerized
       proxy_set_header Host $host;                     # trailing slash here strips the /scanner/
       proxy_set_header X-Real-IP $remote_addr;          # prefix before forwarding — the app
       proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;  # itself knows nothing about
       proxy_set_header X-Forwarded-Proto $scheme;                    # being under a prefix.
   }
   ```
   (For A1 — a dedicated subdomain with its own new `server { }` block instead — use a plain
   `location / { proxy_pass http://host.docker.internal:8000; ... }` with no prefix-stripping
   needed, and the subdomain's own certificate, which must cover that hostname: a wildcard cert,
   one whose SAN list you extend to include it, or a new one issued for it.)
4. **Find the config file nginx is actually running, not just its source** — if nginx runs in a
   container, its config is very likely baked into the image at build time rather than
   bind-mounted, so editing a checked-out copy of the file does nothing until you find the real
   build source and rebuild that image. Check first:
   ```powershell
   docker inspect <nginx-container-name> --format "{{json .Mounts}}"
   ```
   If nothing in there has a `Destination` under `/etc/nginx/`, it's baked in — find the source
   file in that project's own repo/build context (e.g. `Get-ChildItem <project-dir> -Recurse
   -Filter nginx.conf`), edit *that*, then `docker compose build <nginx-service-name> &&
   docker compose up -d <nginx-service-name>` from that project's own directory (not this one).
   Also don't assume the source file maps 1:1 to `/etc/nginx/nginx.conf` inside the container —
   many nginx Docker images treat that as the base config and load your file from
   `/etc/nginx/conf.d/default.conf` instead (`docker exec <container> cat /etc/nginx/nginx.conf`
   to see which one actually has your `server { }` blocks in it).
5. Reload nginx (`docker exec <nginx-container> nginx -t` to check the config first, then
   `docker exec <nginx-container> nginx -s reload`, or your platform's service-restart command
   if it's not containerized) and test `https://existing-host.example.com/scanner/api/info`.

### Option B: direct self-signed cert (no reverse proxy)

Simpler to set up, but every phone has to click through a "not private" warning once. Bind the
container's port directly to the network and let it manage its own cert:

```yaml
ports:
  - "8000:8000"
environment:
  - PUBLIC_HOST=192.168.1.50
```

`docker-entrypoint.sh` generates a self-signed `cert.pem`/`key.pem` at container startup using
`PUBLIC_HOST`, as long as you haven't already set `TLS_CERT`/`TLS_KEY` or mounted your own cert
in. The phone's browser will show a one-time "This Connection Is Not Private" warning the first
time it connects — tap **Show Details → visit this website** (wording varies slightly by iOS
version) to proceed; it only asks once per device per cert.

If you already have a real certificate for this server (issued by an internal CA or similar),
mount it in instead of using the auto-generated one:

```yaml
environment:
  - PUBLIC_HOST=192.168.1.50
  - TLS_CERT=/certs/cert.pem
  - TLS_KEY=/certs/key.pem
volumes:
  - ./certs:/certs:ro
```

Running `server.py` directly (not in Docker)? Generate the cert yourself first:

```powershell
.\generate-cert.ps1 <server-lan-ip-or-hostname>
```

(requires `openssl` on PATH — comes with Git for Windows, or `winget install ShiningLight.OpenSSL`).
`server.py` auto-detects `cert.pem`/`key.pem` in its own folder on startup.

## Open Windows Firewall on the server

nginx's own port (443, presumably already open since it's already serving other apps) needs no
new rule for Option A. But `docker-compose.yml`'s default publishes the scanner container's own
port 8000 on all interfaces (not just localhost) either way, so devices on the server's own
subnet can also reach it directly — that needs its own inbound allow rule, same as Option B.
Run this yourself in an elevated PowerShell on the server (this is a system-security change, so
it's not something to script unattended — review it and run it deliberately):

```powershell
New-NetFirewallRule -DisplayName "IP Phone Scanner (8000)" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow -Profile Private,Domain
```

If you'd rather the container *not* be directly reachable at all (Option A only, nginx as the
sole entry point), change `docker-compose.yml`'s `ports:` back to `"127.0.0.1:8000:8000"` and
skip this rule entirely.

## Verify

**Option A (reverse proxy)**: `curl https://existing-host.example.com/scanner/api/info` (from any
device, including this server itself) should return
`{"lanUrl": "https://existing-host.example.com/scanner"}` with no `-k` needed since it's a real
certificate. Open `https://existing-host.example.com/scanner/mobile.html` on a phone to test the
camera scanner. If you get a 404 or the app loads but scans never register, double check step 3's
redirect — visiting the bare `/scanner` path (no trailing slash) in a browser should 301-redirect
to `/scanner/`.

**Option B (direct)**:
- From the server itself: `curl -k https://localhost:8000/api/info` should return
  `{"lanUrl": "https://<PUBLIC_HOST>:8000"}` (`-k` skips the self-signed cert check; a real
  browser will show the one-time warning described above instead).
- From any other device on the same network: open `https://<PUBLIC_HOST>:8000` in a browser —
  you should see the app. Open `https://<PUBLIC_HOST>:8000/mobile.html` on a phone to test the
  camera scanner.

## Troubleshooting (Option A / reverse proxy)

These are real failure modes hit while setting this up, in the order you're likely to hit them:

- **`curl` on Windows fails with `schannel: ... CRYPT_E_NO_REVOCATION_CHECK`** — this is
  `curl.exe`'s built-in Windows TLS backend doing a strict certificate revocation check that
  self-signed/internal-CA certs can't satisfy (no CRL/OCSP endpoint). It's a client-side quirk of
  that specific curl build, unrelated to whether your setup actually works — retry with
  `curl --ssl-no-revoke <url>`. Browsers (including Safari on iPhone) don't have this issue.
- **`curl` fails with a full handshake failure (`schannel: failed to receive handshake`)**,
  where it previously got a valid (if wrong) response — this means the HTTPS server block itself
  is now broken or missing, not just misrouted. Check `docker logs <nginx-container>` for startup
  errors, and confirm the running config actually has *two* `listen` directives (`80` and
  `443 ssl`) with `docker exec <nginx-container> cat /etc/nginx/conf.d/default.conf` (or
  `nginx.conf` — see step 4 above for which one is really in play). A common cause: pasting a
  large multi-line config into a PowerShell **console** truncates partway through (the console's
  paste buffer has practical limits for very long multi-line input) — if the file only has the
  `listen 80` block and not `listen 443 ssl`, that's exactly what happened. Fix by pasting into
  **Notepad** instead (`notepad <path>`) and saving, which doesn't have the same truncation
  issue, then verify before rebuilding:
  ```powershell
  (Get-Content <path> | Select-String "listen").Count   # should match how many server blocks you expect
  ```
- **The request succeeds over HTTPS but returns the *other* app's page/login screen instead of
  our JSON** — nginx is falling through to that app's own catch-all `location /` instead of
  matching `/scanner/`. Almost always means the edited config never actually reached the file
  nginx loads at runtime (see step 4's note on bind-mounted vs. baked-in config, and on which of
  `nginx.conf`/`conf.d/default.conf` is the real one) — confirm with
  `docker exec <nginx-container> cat <real-config-path> | Select-String "scanner"` before
  assuming the proxy rule itself is wrong.
- **502/504 Bad Gateway** from nginx — it reached your `location /scanner/` block fine but
  couldn't reach the app container. Usually means `host.docker.internal` isn't resolving/routing
  from within nginx's container (confirm nginx really is containerized and check the scanner
  container is actually up and reachable at that port from the host itself first with
  `curl http://localhost:8000/api/info` on the server), or the scanner container's port isn't
  actually published (`docker ps` should show `0.0.0.0:8000->8000/tcp`, not blank).

## Updating

```powershell
docker compose up -d --build
```

rebuilds the image from the current source and replaces the running container. The relay's
in-memory state resets (expected — see the trust-model note above); browser-side progress for
any operator is untouched since it never lived on the server.
