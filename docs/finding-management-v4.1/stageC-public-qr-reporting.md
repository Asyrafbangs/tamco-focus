# Stage C — public QR reporting, built and left closed

v272 created the tables for this and wrote its own reason for stopping there:
"There is deliberately no anonymous policy or public submission procedure in
this migration. Those require the approved privacy, emergency and upload
operating policies before a public endpoint can be enabled." Those policies
arrived with the lean package, so v288 builds the path — and leaves the switch
off.

## Three decisions that shape everything else

**Nothing is granted to `anon`.** The public page is served by our own server,
and its Server Action is the trust boundary: it resolves the sticker's code,
applies the rate limit, validates and rebuilds every photograph, and only then
calls procedures that are granted to `service_role` alone. The browser never
reaches the database. Granting an anonymous database role execute on a submit
procedure would widen the surface v272 closed and buy nothing.

**The reporter is anonymous unless they choose otherwise.** One nullable
contact line, and nothing else about who they are: no account, no device
identifier, no address on the report. The rate limit keeps its counters in a
separate table with a short window, and nothing links a counter to a report —
so the feature that stops abuse cannot become a record of who reported what.

**A switch, not a CHECK.** v272 wrote `check (enabled = false)`, making the
only legal value the closed one. v197 did the same to the rollout mode and
v224 had to undo it; had the pair not been fixed, the first attempt to open the
rollout would have failed with a check violation at the worst possible moment.
The constraint is now dropped **by definition rather than by name** — v272
wrote it inline, so its name is whatever Postgres chose, and a guessed
`drop constraint if exists` would have silently done nothing and left the
switch welded shut until somebody tried to open it.

### And a row to switch

v272 created the settings table and nothing ever inserted into it. Every read
fell through to "not configured", which means the location lookup would have
refused every QR code and the switch itself would have refused the
administrator trying to open the pilot. v288 inserts one closed row per
organisation. This is the same class of defect as the constraint, found the
same way — by writing the test that tries to operate the control.

## What an employee does

Four things, in the order somebody standing in front of a hazard would do them:

1. **Read where they are.** The sticker's code resolves to its label; nobody
   types a location unless the label is not precise enough.
2. **Say what they saw.** One field, and the only required one.
3. **Photograph it, optionally.** Up to three, shrunk on the phone.
4. **Send.** A reference comes back, large enough to read down a radio.

No account, no hazard category, no severity, no owner, no department. The
browser test asserts those four words appear nowhere on the page, because
asking an employee to guess at any of them is how a reporting channel becomes
something people avoid.

The form is a phone screen: one column, 48px targets, and 17px type —
anything under 16px makes iOS zoom the page in on focus, which on this form
would push the Send button off the screen as somebody starts typing.

## The photographs

| Setting        | Value                                      |
| -------------- | ------------------------------------------ |
| Per report     | 3                                          |
| Accepted       | JPG and PNG only                           |
| Input limit    | 12 MB                                      |
| Longest edge   | 2560px                                     |
| JPEG quality   | 0.80                                       |
| Sent per photo | 2 MB ceiling, typically 200–800 KB         |
| Stored         | Private bucket, references only in the row |

2560 rather than staff evidence's 2000: a hazard photographed from across a
bay needs the detail, and a gauge reading has to survive. Legibility beats the
file size.

**Every photograph is re-encoded on the phone, even a small one.** That
re-encode is what drops the EXIF block — and with it the GPS co-ordinates of
whoever was standing there, which would quietly undo the anonymity this form
promises.

**And rebuilt again on the server, which is what makes it a guarantee.**
`rebuildImage` parses the file into its segments, writes out the ones an image
needs, and drops everything else: EXIF, XMP, comments, text chunks, and
anything appended after the end marker. It is not a re-encode — the compressed
data is copied byte for byte, so there is no second quality loss and no image
library in the dependency tree. What is lost is metadata, which is the point.

A photograph that cannot be rebuilt is **refused**, not stored as it arrived:
"as it arrived" is the version that still knows where it was taken.

**HEIC is refused with a way out.** Nothing on the server can decode it, so it
could be neither stripped nor rebuilt. The message names the setting to change
— Settings › Camera › Formats › Most Compatible — rather than saying "unsupported
file type", because the person reading it is standing in a plant and wants to
report something.

## Abuse, and the limits that are not security theatre

- **Rate limit.** Six reports per bucket per ten minutes, counted in one
  statement so two submissions arriving together cannot both read a stale
  count. A bucket is `sha256(address + today + salt)`, truncated; the table
  holds a bucket and a count and nothing else, and is swept daily.
- **An absent address has no bucket at all.** Returning a constant would put
  every anonymous reporter behind one counter and rate-limit the whole site
  down to six reports. That has its own test.
- **Signature, dimensions, size.** The same checks staff evidence gets — the
  bytes decide the type, not the name — plus v285's pixel limits.
- **A photo token, not a reference.** The reference is shown to the reporter,
  so it cannot be the authorisation. Photographs are attached with an
  unguessable token, held hashed, valid for twenty minutes, cleared by the
  sweep.
- **Closed means refused, not queued.** A report submitted while the channel
  is closed is rejected outright. "Received" would be a promise nobody is on
  the other end of.

## What ESH sees

The existing triage queue, with two additions: the photographs as thumbnails
behind a signed five-minute link, and **"Reported anonymously"** said out loud
where a name would be. That second one is not decoration — "nobody to ask"
changes how a coordinator triages, and a blank line where a name might be
invites somebody to go looking for the person who reported it.

Unrouted reports need no change: v273's policy makes a report with no
department visible to organisation-wide ESH and to nobody else, which is
exactly §5's "organisation-wide authorised ESH queue".

## It is still closed

The switch is an administrator's act, beside the rollout switch, demanding a
reason that is kept on the row and in the audit trail. Nobody has run it in
production, so every sticker resolves to "this link does not report anything"
— which is also what a retired sticker and a code nobody issued resolve to, on
purpose: telling a stranger which of the three it is would be telling them
about the plant's own arrangements.

## What is proven, and how

| Level       | Covers                                                                                                                                                                                   |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| pgTAP (32)  | the switch, who may move it, closed-means-refused, retired codes, the rate limit per bucket, the photo token, the cap of three, and that `anon` and `authenticated` can reach none of it |
| Integration | the real pipeline against real storage: the stored bytes carry no EXIF, a fourth photograph is refused, a renamed executable is rejected and leaves nothing behind                       |
| Unit (18)   | the refusals as sentences, the copy's promises, and the bucket's properties                                                                                                              |
| Browser (2) | a stranger with no cookies sends a report with a photograph; a closed channel says so and offers no Send button                                                                          |

Each guard was broken on its own. Storing the bytes as they arrived instead of
rebuilt fails the EXIF assertion. Removing `/report` from the public paths
sends the page to sign-in — and that break is also why the browser test
asserts the **address** rather than the status code: a redirect to sign-in
answers 200 once the browser has followed it, so the status assertion passed
while the page was unreachable.

One fixture is worth recording. The repository's 134-byte base64 JPEG ends
immediately after its scan header, with no entropy data and no end marker, so
the rebuild refuses it — correctly, as a file it cannot account for. The public
browser test therefore builds a real 400×300 noise PNG, which the canvas
re-encodes to a complete JPEG, which is the flow that actually ships.
