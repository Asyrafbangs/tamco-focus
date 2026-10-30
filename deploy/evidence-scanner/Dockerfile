# The ESH evidence scanner (v271): clamd, plus the small shim that speaks the
# contract in docs/evidence-scanner.md. See docs/evidence-scanner-deployment.md
# for where this runs and what it costs.
FROM clamav/clamav:1.4

# Node, for the shim. Alpine's package is current enough and adds ~60MB.
RUN apk add --no-cache nodejs

COPY server.mjs /opt/scanner/server.mjs
COPY clamd.conf /etc/clamav/clamd.conf
COPY start.sh /opt/scanner/start.sh
RUN chmod +x /opt/scanner/start.sh

# Signatures baked in, so a container that starts cold can scan without first
# downloading 1.2GB from the ClamAV mirrors. That makes the image large and the
# signatures as old as the image -- which is why the deployment plan schedules a
# weekly rebuild. `|| true`: a mirror having a bad day must not fail the build,
# and freshclam runs again at startup anyway.
RUN freshclam --quiet || true

ENV PORT=8080 CLAMD_HOST=127.0.0.1 CLAMD_PORT=3310
EXPOSE 8080
ENTRYPOINT ["/opt/scanner/start.sh"]
