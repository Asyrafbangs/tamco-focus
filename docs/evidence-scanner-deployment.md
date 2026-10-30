# Deploying a private ClamAV for ESH evidence (v271)

The application calls whatever answers `ESH_SCANNER_URL`. This is the plan for
making that something we own, what it costs, and the one decision that drives
the cost.

Everything here is **optional**. With the variable unset, nothing is scanned,
every file honestly reads "Not scanned", and no behaviour changes. That is the
current production state.

The container is in [`deploy/evidence-scanner/`](../deploy/evidence-scanner):
a `Dockerfile` on the official `clamav/clamav` image, `server.mjs` (the shim
that speaks the contract in [evidence-scanner.md](./evidence-scanner.md)),
`clamd.conf` and `start.sh`. Nothing is written to disk — bytes arrive in
memory, go to clamd's INSTREAM socket, and are dropped.

## The decision that sets the price

ClamAV loads its signature databases into memory. The ClamAV project's own
container documentation asks for **4GB**, because the engine needs about
**1.2GiB** and a _concurrent_ database reload builds the new engine beside the
old one, briefly doubling that; it says plainly that 2GB may be insufficient.
Run out and the kernel kills clamd, which inside a container usually means the
container stops answering.

`clamd.conf` here sets `ConcurrentDatabaseReload no`. That halves the peak and
blocks scanning for a few seconds during a reload — which costs a background
job nothing and makes a **2GB** machine viable. The 4GB figure is the vendor's
recommendation and the safe one; 2GB is the informed one. Both are priced below.

## What it would cost

Checked 30 October 2026. Prices move; the Fly.io figures are from its own
pricing page, the rest are secondary and marked as such.

| Option                                        | Shape                                                          | Monthly                                                                                                              |
| --------------------------------------------- | -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Google Cloud Run**, scale to zero           | 2 vCPU, 4GiB, min-instances 0, signatures baked into the image | **≈ $0**, plus ~$0.20 image storage                                                                                  |
| **Fly.io**, always on                         | `shared-cpu-1x`, 2GB, 3GB volume                               | **≈ $13.15** ($2.19 base + 1.75GB × $6.00 + $0.45 volume)                                                            |
| **Fly.io**, always on, vendor-recommended RAM | `shared-cpu-1x`, 4GB, 3GB volume                               | **≈ $25.15** ($2.19 + 3.75GB × $6.00 + $0.45)                                                                        |
| **Oracle Cloud Always Free**                  | 4 ARM cores, 24GB, always on                                   | **$0**, if you can get one                                                                                           |
| **Hetzner / small VPS**                       | 4GB shared vCPU                                                | **≈ €20** — was the cheap answer until the 2026 increases                                                            |
| Render free tier                              | —                                                              | **Not viable.** Sleeps after 15 minutes idle, no persistent disk, and its own docs say not for production            |
| Cloudmersive free tier                        | —                                                              | **Not viable.** 3.5MB file cap rejects most phone photographs                                                        |
| VirusTotal public API                         | —                                                              | **Not viable.** Bars commercial use, and submissions feed a shared corpus — site photographs would leave our control |

Fly.io has no free tier for new organisations. Egress is irrelevant either way:
the scanner downloads from Supabase (inbound, free) and answers with a few
bytes of JSON.

### Why Cloud Run is nearly free

Cloud Run bills per 100ms of actual execution, and this workload executes for
about a minute a day. One cron pass that cold-starts, loads signatures and
scans a handful of files is roughly 60 vCPU-seconds and 240 GiB-seconds. Even
hourly — 24 passes a day — comes to about 43,000 vCPU-seconds and 173,000
GiB-seconds a month, inside the documented instance-based free tier of 240,000
vCPU-seconds and 450,000 GiB-seconds. (Those allowances and rates are from
secondary sources; Google's own pricing page would not render for automated
reading, so **confirm them before relying on the figure**.)

The catch is real and is the whole trade: **signatures are only as fresh as the
image**, because downloading 1.2GB of definitions on every cold start would
make each pass take minutes. So the image must be rebuilt on a schedule — a
weekly GitHub Actions job is enough for a background scanner that is a second
line of defence behind `sniffEvidenceType`, not a gate anybody is waiting on.
If that job is forgotten, scanning silently decays in quality while still
reporting `clean`, which is the one failure mode in this feature that the
design otherwise refuses to allow.

**So:** Cloud Run if the cost matters more than operational simplicity, with
the rebuild job treated as part of the deployment rather than a nice-to-have.
Fly.io at ~$13–25/month if it does not — freshclam just runs, and there is
nothing to forget.

## Deploying it on Fly.io

1. Create the app and a volume for the signature databases:

   ```bash
   cd deploy/evidence-scanner
   fly launch --no-deploy --name tamco-evidence-scanner --region sin
   fly volumes create clamav_db --size 3 --region sin
   ```

2. Generate the shared secret and set it. It is the only thing between the
   scanner and the internet:

   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   fly secrets set ESH_SCANNER_TOKEN=<the value>
   ```

3. In `fly.toml`, mount the volume at `/var/lib/clamav`, set
   `memory = "2gb"` (or `4gb`), and set `min_machines_running = 1` —
   a machine that sleeps has to reload 1.2GB of signatures to wake up.

4. Deploy, and check it is answering:

   ```bash
   fly deploy
   curl https://tamco-evidence-scanner.fly.dev/health
   ```

5. Point the application at it, in Vercel → Settings → Environment Variables,
   Production:

   - `ESH_SCANNER_URL` = `https://tamco-evidence-scanner.fly.dev/`
   - `ESH_SCANNER_TOKEN` = the same value as step 2

   Redeploy, because environment variables are read at build time. Note that
   **Vercel secrets cannot be read back** — record the token somewhere you can
   retrieve it, or you will be rotating it to find out what it is.

6. Confirm end to end with EICAR, the standard harmless test string:

   ```bash
   printf 'X5O!P%%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*' > eicar.txt
   curl -s -X POST https://tamco-evidence-scanner.fly.dev/ \
     -H "Authorization: Bearer $ESH_SCANNER_TOKEN" \
     -H 'Content-Type: text/plain' --data-binary @eicar.txt
   ```

   It must answer `{"infected":true,"detail":"Eicar-Signature"}` or similar.
   An unauthenticated request to the same URL must answer `401`.

## What the application does with it

Nothing blocking. The owner uploads, the file attaches, they submit; the
scheduled worker in `src/app/api/cron/route.ts` calls `runEshScanWorker`
afterwards. Somebody on a plant floor with one bar of signal is never made to
wait for a virus scanner, and a scanner that is down never stops work being
reported.

Three things are worth knowing before this goes live:

- **A remote scanner without a token is refused.** The worker logs and does
  nothing rather than POST somebody's evidence to an endpoint with no shared
  secret in front of it. Loopback addresses are exempt, which is how it runs
  in development.
- **`unavailable` is not `clean`.** A non-200, a timeout over 20 seconds, or
  unparseable JSON records `unavailable`. A pgTAP assertion holds that line,
  because without it an outage looks like a clean bill of health.
- **It scans the preserved original** when there is one (v271), not the
  compressed copy. A canvas re-encode cannot carry what the camera's own file
  carried, and the original is the file being kept for years.

## Scope

ESH evidence only. `virus_scan_state` on `task_attachments` and the goal
evidence tables is untouched and still unscanned.

Sources for the figures above: [Fly.io pricing](https://fly.io/pricing),
[ClamAV Docker documentation](https://docs.clamav.net/manual/Installing/Docker.html),
[Cloud Run pricing](https://cloud.google.com/run/pricing),
[Cloud Run free tier (secondary)](https://agentdeals.dev/vendor/google-cloud-run),
[Hetzner 2026 pricing (secondary)](https://www.bitdoze.com/hetzner-cloud-cost-optimized-plans/).
