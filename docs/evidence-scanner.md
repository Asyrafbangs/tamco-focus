# The evidence scanner (v270, corrected and extended in v271)

ESH evidence is scanned **after** it has landed, on the scheduled worker. The
owner uploads, the file attaches, they submit, and the scan happens later.

> **v270 did not work.** `esh_evidence_assets` has carried a trigger since v199
> refusing any update to a row whose `message_id` is set, and v199 also pinned
> such a row to `state = 'ready'`. Every file that matters is sent in a message,
> so `esh_scan_claim` raised an exception on the first row it tried to claim and
> quarantine could not have moved a file out of 'ready' even if it had got that
> far. v270's own fixture never sent a file, so eleven assertions passed over a
> feature that was inert. v271 separates the record — what a file is, where it
> lives, who sent it — from what we have since learned about it, and the pgTAP
> assertions now run against sent files, which is the only kind there is.
> Somebody on a plant floor with one bar of signal is never made to wait for a
> virus scanner, and a scanner that is down never stops work being reported.

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
Authorization: Bearer $ESH_SCANNER_TOKEN
Content-Type: <the file's own type>
X-File-Name: <URL-encoded original name>

<raw bytes>
```

`ESH_SCANNER_TOKEN` is **required for any host that is not loopback** (v271).
Every byte of somebody's evidence is POSTed to this URL; an endpoint with no
shared secret in front of it is an open scanning service for anyone who learns
the address, and a place to send site photographs by accident if the variable
is ever mistyped. Without a token the worker logs and does nothing, leaving
files `not_scanned` — which is true.

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

## Which bytes get scanned

The preserved original, when there is one (v271), and otherwise the stored
object. A compressed copy is pixels a canvas drew and cannot carry what came in
with the camera's file; the original can, and it is the one being kept for
years.

Two consequences, both deliberate:

- Keeping an original **resets** the asset's scan state. The copy may already
  have been called clean, but those are no longer the bytes most worth looking
  at, and leaving the row `clean` would be the lie this column exists to
  prevent.
- A file whose original is still on its way is **not** claimable. Scanning it
  now and never again would leave an original nobody ever looked at, reported
  as clean. A source upload that never finishes is written off after an hour,
  and the copy is then scanned instead.

## Quarantine

An infected file is set to `state = 'rejected'`. Every existing read already
excludes anything that is not `ready` — `esh_guest_file` and the staff download
route both check it — so quarantine closed every download path at once instead
of adding a new condition to each one. A verifier in scope is emailed.

## Hosting it

See **[evidence-scanner-deployment.md](./evidence-scanner-deployment.md)** for
the container, the hosting options with current costs, and the deployment and
verification steps. The short version: ClamAV needs 2–4GB of RAM because it
loads its signature databases into memory, which rules out every free tier that
sleeps or has no disk; Cloud Run scaling to zero is nearly free if the
signatures are baked into the image and that image is rebuilt weekly, and
Fly.io always-on is about $13–25 a month with nothing to remember.

## What this does not cover

`virus_scan_state` on `task_attachments` and the goal evidence tables is
untouched and still unscanned. Only ESH evidence goes through this.
