# Stage A — hardening what already exists

The lean package's Stage A is an audit with repairs, not a feature. Its
instruction is to improve image compression, secure storage, scanner
validation and the existing private intake — and to reuse what is there rather
than rebuild it. So the first job was establishing what is there, and most of
the answer is "enough".

## What the audit found already sound

Recorded because each was a plausible place for this stage's work and needed
none:

- **Nothing is trusted from the browser.** A procedure agrees the upload and
  names the object, the browser puts the bytes into a private bucket through a
  one-time signed URL, and `inspectUpload` then reads them back and decides
  what the file really is from its first bytes (`sniffEvidenceType`). A file
  that is not what its name claims is deleted at once.
- **No file is ever called clean.** `SCAN_LABELS` calls a `clean` verdict
  "Scanned" rather than "Clean", `unavailable` says so, and with
  `ESH_SCANNER_URL` unset the whole scanner is inert and every file reads "Not
  scanned". The application has never claimed a file was checked when nothing
  checked it.
- **A remote scanner without a shared secret is refused.** v271 made that a
  misconfiguration the worker declines rather than a default it tolerates,
  because every byte of somebody's evidence is POSTed to that URL.
- **Nothing active renders from our origin.** Images and PDFs open in place;
  every other type is served with a forced download.
- **Compression already exists and already keeps the original.** v270 shrinks a
  photograph for a weak signal; v271 uploads the camera's own file afterwards
  in the background so the re-encode cannot lose somebody's evidence.

## The defect: a 200 is not a verdict

`runEshScanWorker` decided like this:

```ts
const answer = (await response.json()) as { infected?: boolean; detail?: string };
verdict = answer.infected ? 'infected' : 'clean';
```

Every answer whose `infected` was merely falsy became a clean bill of health.
`{}` is clean. `{"error":"engine offline"}` is clean. `{"status":"queued"}` is
clean. An explicit `{"infected":null}` is clean. The file is then recorded as
scanned, the label a reader sees says "Scanned", and nothing retries it —
because as far as the record is concerned it has been done.

The case that matters most is the middle one. A scanner reporting **its own
failure** in valid JSON with a 200 is not an exotic shape; it is what a service
in front of `clamd` does when the daemon is not answering, and it is exactly
when a file has not been looked at.

`esh-scan-worker-v271` looks as though it covered this. It does not: its
nonsense case answers `<html>not json</html>`, which fails to parse and takes
the catch that already existed. The gap was everything that parses and still
says nothing — and the passing test's name made the gap invisible.

**The fix.** Only a real boolean is a verdict. Anything else throws into the
same handler a timeout takes, which records `unavailable` — true, visible to
ESH, and retried on the next run. The detail is the answer's _keys_, never its
body: a scanner's error text can quote the file it was given.

`tests/unit/esh-scan-verdict-v285.test.ts` holds eleven cases, one per shape
rather than a loop, so a regression names the shape that regressed. Restoring
the old line fails nine of them and leaves the two genuine-verdict cases
passing.

A second, smaller defect sat in the same line: `{"infected":"false"}` — a
string, and therefore truthy — was reported as **infected**. The same strictness
fixes both directions.

## Pixels, which a byte limit does not describe

A 25 MB cap says nothing about how much work an image is to decode. A
30000 × 30000 PNG of one flat colour is a few hundred kilobytes and asks a
decoder for 3.6 billion pixels. Our server is not that decoder — nothing here
decodes evidence — but every browser that later opens the finding is, and so is
the phone of whoever uploaded it.

`imageDimensions` reads the declared size out of the header for PNG, JPEG, GIF
and WEBP, and `pixelProblem` refuses anything over 80 megapixels or 20000 on a
side. 80 is roughly twice the largest sensor sold in a phone, so a real
photograph — including a 61-megapixel full-frame frame — has room.

Three details are deliberate:

- **The JPEG parser walks the segment chain.** A phone puts kilobytes of EXIF
  and often a thumbnail in front of the frame header, so the dimensions are not
  near the start. `inspectUpload` hands over 64 KB rather than the 8 KB the
  type sniff needs.
- **Unknown is not a refusal.** A header that cannot be parsed returns null and
  the file passes, because refusing real evidence on a parser's blind spot is
  the worse failure. The byte-size and signature checks still ran.
- **A refused image is deleted**, like every other refusal, so nothing
  unverified is left in the bucket.

`esh-image-pixels-v285` builds each header byte by byte rather than loading
fixtures, so every assertion names the bytes it depends on.
`esh-inspect-upload-v285` proves the call site asks — removing the call fails
exactly the two cases that require it and leaves the three pre-existing
refusals passing. That test exists at all because of v284: `server-only` now
resolves to a no-op under vitest, so a module that begins with it can be
imported by a test.

## Compression: the knobs, and not converting screenshots

Two changes, both small:

- **`compressImage` takes options.** Public safety reporting will want a
  longer edge and a re-encode of _every_ photo rather than only large ones —
  that re-encode is what removes the EXIF block and with it the GPS
  co-ordinates of whoever was standing there. Staff evidence keeps its own
  defaults untouched.
- **A PNG is only converted to JPEG when JPEG clearly wins.** Screenshots of
  permits and labels arrive as PNG. JPEG's chroma subsampling puts a coloured
  halo around thin dark text — which is the detail somebody is reading — while
  saving almost nothing, because flat colour is what PNG is already good at.
  Both encodings are produced and compared: when JPEG cannot beat PNG by a
  clear margin the image is flat-toned, and it stays a PNG at its new size.

The two decisions inside the re-encode — the size to draw at, and which
encoding to keep — moved into the domain layer, where they are arithmetic and a
ratio rather than canvas plumbing, and are tested directly.

## The uploads that never finished (v286)

An upload is agreed, the bytes are put into storage, and the server reads them
back and records them. When the third step never happens — the signal goes, the
tab closes, a navigation cancels the Server Action — a row stays in `uploading`
and, if any bytes arrived, a private object sits in the bucket with nothing
pointing at it. v271's background upload has the same shape, and its `pending`
state is a sentence ESH reads: "Full-size original still arriving",
indefinitely.

Neither loses evidence and neither is a hole. They are storage nobody can
account for and a status that has stopped being true, which is cheap to fix now
and awkward once there are thousands.

`esh_evidence_claim_orphans` marks and returns; `runEshOrphanWorker` deletes
the objects, from the daily cron. Four things in it are load-bearing, and each
was broken on its own to show the tests hold it:

| Break                                                  | Result                                                                                                                                   |
| ------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| the five-minute floor removed                          | three assertions fail: a zero-minute call reaches a one-minute-old upload and a still-arriving original                                  |
| the state filter widened to include `ready`            | three assertions fail, two of them about real evidence being swept                                                                       |
| the source key read after the update instead of before | one assertion fails — the worker is handed the null the statement just wrote and deletes nothing while the row claims the object is gone |
| the worker's `remove` call disabled                    | the integration test fails: the object is still in the bucket                                                                            |

The floor deserves a note, because the first version of its test proved
nothing. Inside a transaction `now()` is the transaction's own clock, so a
fixture row created at `now()` is never _strictly_ older than any cutoff and
survives a zero-minute sweep whether the floor exists or not. The fixture rows
are a minute old for exactly that reason.

The procedure is `security definer`, revoked from `public`, `anon` and
`authenticated`, and granted only to `service_role` — which is also asserted,
since only the service role can reach the bucket the sweep is about.

## What Stage A deliberately did not do

- **Server-side EXIF stripping and image rebuilding** belong with the public
  photo pipeline in Stage C, where every photo is canvas re-encoded and
  therefore has no orientation tag to lose. Stripping EXIF from a staff
  photograph that was small enough to skip compression would rotate it in every
  viewer, and v271's kept original is a promise not to alter what was taken.
- **HEIC** is accepted and stored untouched on the staff path, which works.
  Public reporting accepts JPG and PNG only, so its refusal message is Stage C's
  to write.
- **The 2560-pixel edge and 12 MB input limit** from the package's table are
  public-reporting numbers. They arrive with the form that needs them rather
  than being retrofitted onto staff evidence, whose own limits are in five
  places that move together.
