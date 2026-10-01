#!/usr/bin/env python3
"""Static file server for the barcode scanner app, plus a tiny in-memory relay
that lets a phone (running mobile.html on the same Wi-Fi) hand off decoded
barcodes to the PC page (index.html) without either side needing a real backend.

Everything below is ephemeral, in-process state — nothing is written to disk,
there is no database, and no data ever leaves the local network. Replaces the
plain `python -m http.server` this project used to run.

Endpoints (all under /api/, everything else is served as a static file exactly
like http.server would):
  GET  /api/info          -> { lanUrl }            best-guess LAN URL for the phone to open
  GET  /api/scan/latest    -> { lastId }             current high-water mark, no items
  GET  /api/scan?after=N   -> { lastId, scans: [] }   scans with id > N (bounded backlog)
  POST /api/scan           <- { text, format }        record one decoded barcode
  GET  /api/session        -> { clientName, status } | {}   last session status PC reported
  POST /api/session        <- { clientName, status }        PC pushes its current status

Configuration is via environment variables (with the historical `python server.py <port>`
argv form still honored for local/non-container use):
  PORT         — port to listen on (default 8000; argv[1] overrides this if given)
  PUBLIC_HOST  — the address phones should be told to use for /api/info's lanUrl. Required
                 when running in a container: the auto-detect trick below reports whatever
                 IP the container sees for its own default route, which is the container's
                 internal/bridge address, not anything a phone on the real LAN can reach.
                 Set this to the host machine's real LAN IP or a resolvable hostname.
  PUBLIC_PORT  — the port to advertise in that URL, if it differs from PORT (e.g. running
                 the container with `-p 9000:8000` — PORT stays 8000 inside the container,
                 but PUBLIC_PORT should be 9000). Defaults to PORT.
  PUBLIC_URL   — full override for /api/info's lanUrl (e.g. "https://scanner.example.com"),
                 for when this app sits behind a reverse proxy that terminates TLS and/or
                 maps it to a hostname/path that has nothing to do with this process's own
                 host/port. Takes priority over PUBLIC_HOST/PUBLIC_PORT/SCHEME entirely. In
                 this setup you'd typically leave PUBLIC_HOST/TLS_CERT/TLS_KEY unset so this
                 process stays plain HTTP and lets the reverse proxy handle HTTPS.
  TLS_CERT,
  TLS_KEY      — paths to a PEM certificate/key pair. If both are set (or cert.pem/key.pem
                 exist in the working directory), the server speaks HTTPS instead of HTTP.
                 This is required for the remote phone scanner on iOS: Safari doesn't expose
                 navigator.mediaDevices.getUserMedia at all on a plain http:// origin unless
                 it's localhost, so camera access silently fails on iPhone without it. A
                 self-signed cert is fine — generate one with generate-cert.ps1/.sh; the
                 phone's browser will show a one-time "not private" warning to click through.
"""
import http.server
import json
import os
import socket
import socketserver
import ssl
import sys
import threading
import time
from urllib.parse import urlparse, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else int(os.environ.get('PORT', '8000'))
PUBLIC_PORT = int(os.environ.get('PUBLIC_PORT', str(PORT)))
PUBLIC_HOST = os.environ.get('PUBLIC_HOST')
PUBLIC_URL = os.environ.get('PUBLIC_URL')
TLS_CERT = os.environ.get('TLS_CERT') or ('cert.pem' if os.path.isfile('cert.pem') else None)
TLS_KEY = os.environ.get('TLS_KEY') or ('key.pem' if os.path.isfile('key.pem') else None)
SCHEME = 'https' if (TLS_CERT and TLS_KEY) else 'http'
MAX_BACKLOG = 500
MAX_BODY_BYTES = 10_000

_lock = threading.Lock()
_scans = []  # [{id, text, format, receivedAt}], oldest first
_next_id = 1
_session = {}  # last {clientName, total, found} the PC reported, or {}


def _lan_ip():
    if PUBLIC_HOST:
        return PUBLIC_HOST
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        s.connect(('8.8.8.8', 80))  # UDP "connect" — no packet actually sent
        return s.getsockname()[0]
    except OSError:
        return '127.0.0.1'
    finally:
        s.close()


LAN_IP = _lan_ip()
ADVERTISED_URL = PUBLIC_URL or f'{SCHEME}://{LAN_IP}:{PUBLIC_PORT}'


class Handler(http.server.SimpleHTTPRequestHandler):
    def log_message(self, fmt, *args):
        if self.path.startswith('/api/'):
            super().log_message(fmt, *args)

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def _read_json_body(self):
        length = int(self.headers.get('Content-Length', 0) or 0)
        if length <= 0 or length > MAX_BODY_BYTES:
            return None
        raw = self.rfile.read(length)
        try:
            return json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return None

    def do_GET(self):
        path = urlparse(self.path).path
        if path == '/api/info':
            self._send_json(200, {'lanUrl': ADVERTISED_URL})
            return
        if path == '/api/scan/latest':
            with _lock:
                last_id = _scans[-1]['id'] if _scans else 0
            self._send_json(200, {'lastId': last_id})
            return
        if path == '/api/scan':
            qs = parse_qs(urlparse(self.path).query)
            try:
                after = int(qs.get('after', ['0'])[0])
            except ValueError:
                after = 0
            with _lock:
                new = [s for s in _scans if s['id'] > after]
                last_id = _scans[-1]['id'] if _scans else after
            self._send_json(200, {'lastId': last_id, 'scans': new})
            return
        if path == '/api/session':
            with _lock:
                self._send_json(200, dict(_session))
            return
        super().do_GET()

    def do_POST(self):
        global _next_id
        path = urlparse(self.path).path
        if path == '/api/scan':
            data = self._read_json_body()
            if data is None:
                self._send_json(400, {'error': 'invalid json body'})
                return
            text = str(data.get('text', '')).strip()
            if not text:
                self._send_json(400, {'error': 'missing text'})
                return
            fmt = data.get('format')
            entry = {
                'text': text[:512],
                'format': (str(fmt)[:64] if fmt else None),
                'receivedAt': int(time.time() * 1000),
            }
            with _lock:
                entry['id'] = _next_id
                _next_id += 1
                _scans.append(entry)
                if len(_scans) > MAX_BACKLOG:
                    del _scans[: len(_scans) - MAX_BACKLOG]
            self._send_json(200, {'ok': True, 'id': entry['id']})
            return
        if path == '/api/session':
            data = self._read_json_body()
            if data is None:
                self._send_json(400, {'error': 'invalid json body'})
                return
            with _lock:
                _session.clear()
                _session.update({
                    'clientName': data.get('clientName'),
                    'status': data.get('status'),
                })
            self._send_json(200, {'ok': True})
            return
        self._send_json(404, {'error': 'not found'})


class ThreadingHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def main():
    with ThreadingHTTPServer(('0.0.0.0', PORT), Handler) as httpd:
        if SCHEME == 'https':
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
            ctx.load_cert_chain(certfile=TLS_CERT, keyfile=TLS_KEY)
            httpd.socket = ctx.wrap_socket(httpd.socket, server_side=True)
        elif not PUBLIC_URL:
            print('WARNING: no TLS_CERT/TLS_KEY (or cert.pem/key.pem) found — serving plain')
            print('         HTTP. The remote phone scanner will NOT work on iOS/Safari like')
            print('         this (camera access requires HTTPS). Run generate-cert.ps1 or')
            print('         generate-cert.sh, then restart. See server.py\'s module docstring.')
        else:
            print(f'Plain HTTP on {PORT} — assuming PUBLIC_URL ({PUBLIC_URL}) is fronted by a')
            print('reverse proxy that terminates HTTPS itself.')
        print(f'Serving at:')
        print(f'  This PC:    {SCHEME}://localhost:{PORT}')
        print(f'  Phone:       {ADVERTISED_URL}/mobile.html')
        print('Press Ctrl+C to stop.')
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
