# The evidence scanner (v270)

ESH evidence is scanned **after** it has landed, on the scheduled worker. The
owner uploads, the file attaches, they submit, and the scan happens later.
Somebody on a plant floor with one bar of signal is never made to wait for a
virus scanner, and a scanner that is down never stops work being reported.

The application does not host the scanner. It calls whatever answers
`ESH_SCANNER_URL`, so the host is a deployment decision rather than something
welded into the code.

## With the variable unset

Nothing happens. `runEshScanWorker` returns immediately, every file stays
`not_scanned`, and evidence behaves exactly as it did before v270. That is the
only honest default for a feature that depends on infrastructure the
application does not own.

## The contract

One endpoint. POST the bytes, get back JSON:

```http
POST $ESH_SCANNER_URL
Content-Type: <the file's own type>
X-File-Name: <URL-encoded original name>

<raw bytes>
```

```json
{ "infected": false, "detail": null }
```

`detail` carries the signature name when something is found; it is stored and
shown to ESH so a quarantined file can be explained rather than silently
vanishing.

Anything else — a non-200, a timeout over 20 seconds, malformed JSON — is
recorded as `unavailable`, **never** as `clean`. The worker tries a file five
times across runs and then leaves it alone.

## States, and why there are five

| State         | Meaning                                                       |
| ------------- | ------------------------------------------------------------- |
| `not_scanned` | Nobody has looked. No scanner configured, or not reached yet. |
| `pending`     | A worker has claimed it and is looking now.                   |
| `clean`       | A scanner looked and found nothing.                           |
| `infected`    | A scanner found something. The file is quarantined.           |
| `unavailable` | A scanner was configured and could not be reached.            |

`unavailable` exists because the alternative is lying. Without it, a file
nobody could scan is indistinguishable from a file nobody tried to scan, and an
outage would quietly look like a clean bill of health.

## Quarantine

An infected file is set to `state = 'rejected'`. Every existing read already
excludes anything that is not `ready` — `esh_guest_file` and the staff download
route both check it — so quarantine closed every download path at once instead
of adding a new condition to each one. A verifier in scope is emailed.

## Hosting it

ClamAV needs roughly 1–2GB of RAM because it loads its signature databases into
memory, and it needs somewhere to keep them between restarts. That rules out
free tiers that sleep after inactivity or have no disk.

Checked on 30 October 2026:

| Option                               | Verdict                                                                                                                                                                                                    |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| VirusTotal public API                | **No.** Bars commercial use, and the documentation implies submissions feed a shared corpus. Site photographs would leave your control.                                                                    |
| Cloudmersive free tier               | **No.** 600 calls/month is enough, but the 3.5MB file cap rejects most phone photographs. Their first paid tier is $19.99/month.                                                                           |
| Render free tier                     | **No.** Spins down after 15 minutes idle, no persistent disk, and their own documentation says not to use it for production.                                                                               |
| Fly.io                               | Works. About $6.70/month for a 1GB always-on machine. No free tier for new organisations.                                                                                                                  |
| Google Cloud Run, Oracle Always Free | Unverified — both sites refused automated fetching. Cloud Run scaling to zero is plausible if the signature databases are baked into the image, since a slow cold start costs nothing on a background job. |

A minimal shim in front of `clamd` satisfies the contract above in a few lines:
read the request body, pass it to `INSTREAM`, answer `{"infected": …}`.

## What this does not cover

`virus_scan_state` on `task_attachments` and the goal evidence tables is
untouched and still unscanned. Only ESH evidence goes through this.
