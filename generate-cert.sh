#!/usr/bin/env bash
# Generates a self-signed cert.pem/key.pem for server.py's TLS support (see its module
# docstring). Required for the remote phone scanner to work on iOS/Safari, which refuses to
# expose navigator.mediaDevices.getUserMedia at all on a plain http:// origin.
#
# Usage: ./generate-cert.sh <server-lan-ip-or-hostname>
set -euo pipefail
cd "$(dirname "$0")"

# Git Bash/MSYS on Windows mangles leading-slash args like "/CN=..." into fake Windows paths —
# this disables that path conversion. No-op on real Linux/Mac bash.
export MSYS2_ARG_CONV_EXCL="*"

HOST_OR_IP="${1:?Usage: ./generate-cert.sh <server-lan-ip-or-hostname>}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl not found on PATH. Install it (e.g. apt-get install -y openssl) and re-run." >&2
  exit 1
fi

if [[ "$HOST_OR_IP" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  SAN="subjectAltName=IP:$HOST_OR_IP"
else
  SAN="subjectAltName=DNS:$HOST_OR_IP"
fi

openssl req -x509 -nodes -newkey rsa:2048 -keyout key.pem -out cert.pem -days 825 \
  -subj "/CN=$HOST_OR_IP" -addext "$SAN"

echo ""
echo "Generated cert.pem and key.pem for '$HOST_OR_IP' (valid 825 days)."
echo "Restart server.py (or the container) — it auto-detects these files in this folder."
