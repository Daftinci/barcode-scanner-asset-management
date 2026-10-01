#!/usr/bin/env bash
# If no cert is already provided (via TLS_CERT/TLS_KEY, or a mounted cert.pem/key.pem) but
# PUBLIC_HOST is set, generate a self-signed one automatically so HTTPS just works out of the
# box in the container — see generate-cert.sh and server.py's module docstring for why this
# matters (iOS Safari requires HTTPS for camera access).
set -e

if [ -z "${TLS_CERT:-}" ] && [ -z "${TLS_KEY:-}" ] && [ ! -f cert.pem ] && [ -n "${PUBLIC_HOST:-}" ]; then
  echo "No TLS cert found — generating a self-signed one for PUBLIC_HOST=$PUBLIC_HOST"
  ./generate-cert.sh "$PUBLIC_HOST"
fi

exec "$@"
