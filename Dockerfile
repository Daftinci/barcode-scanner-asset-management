# server.py is pure Python stdlib (no pip dependencies at runtime — package.json's
# devDependencies are editor/type support only, see CLAUDE.md), so the image just needs a
# Python interpreter, the openssl CLI (for the self-signed cert docker-entrypoint.sh
# generates), and the static app files. slim keeps the image small.
FROM python:3.12-slim

RUN apt-get update && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server.py index.html mobile.html generate-cert.sh docker-entrypoint.sh ./
COPY css ./css
COPY js ./js
COPY vendor ./vendor
RUN chmod +x generate-cert.sh docker-entrypoint.sh

# Everything the app needs is static files + the stdlib relay server — no build step.
ENV PORT=8000
EXPOSE 8000

# PUBLIC_HOST must be set at `docker run`/compose time to the host's real LAN IP or a
# resolvable hostname — see server.py's module docstring and DEPLOYMENT.md. Without it,
# /api/info would advertise the container's internal bridge IP, which no phone can reach.
# docker-entrypoint.sh uses the same PUBLIC_HOST to auto-generate a self-signed HTTPS cert
# (required for the remote phone scanner on iOS) unless one is already mounted in.
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["python", "server.py"]
