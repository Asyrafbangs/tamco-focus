#!/bin/sh
# clamd first, then the shim. The shim refuses to start without a token, so a
# misconfigured deployment fails loudly here rather than quietly serving as an
# open scanning service.
set -e
freshclam --quiet || echo "[start] freshclam failed; using the signatures in the image"
clamd &
# clamd takes 20-60s to load its signatures. Ask it rather than sleeping a
# guessed number of seconds, so the host's health check never sees a shim that
# is up in front of an engine that is not.
until clamdscan --ping 1 >/dev/null 2>&1; do sleep 2; done
echo "[start] clamd ready"
exec node /opt/scanner/server.mjs
