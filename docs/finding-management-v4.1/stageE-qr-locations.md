# Stage E — somewhere for a sticker to point

Public reporting was built in Stage C and left closed. Asked to open it, the
honest answer turned out to be that opening it would have achieved nothing:
**there was no way to create a location**, so every sticker in the plant would
have resolved to "this link does not report anything".

v272 created `esh_qr_locations`, revoked it from `authenticated`, and left it
there. v288 built the submission path on top and read locations through a
`service_role` function. Neither gave anybody a way to add a row. This is the
third control in this module that existed and could not be operated — after
v197's rollout `CHECK` and v288's missing settings row — so the test for this
one does what those two needed: it creates a location, reads it back the way
the public page does, and retires it.

## The code is generated, never typed

A sticker's code is the whole of its authorisation. Anybody who learns it can
submit a report against that location, and nothing else is checked — that is
the design, because the alternative is asking an employee to identify
themselves.

So `BR2-PRESS-LINE-2` is exactly the wrong code: anybody who has walked
through the building can guess it, from a desk, without ever seeing a sticker.
`esh_add_qr_location` generates sixteen random characters and keeps the
meaning in the label, which is what the reporter sees at the top of the form.
Nothing in the address says where it is.

The browser test asserts the generated code does not contain a word from the
label. Deriving it from the label fails that assertion, which is how the
guard is proven rather than asserted.

## Retiring, never deleting

A sticker that has been printed and glued to a machine cannot be recalled.
Retiring sets `active = false` and keeps the row, so:

- the code stops resolving — the public page says the link does not report
  anything, which is also what an unissued code says;
- a report already submitted against it still names where it came from;
- the code can never be issued again, because the row still holds it.

The list keeps retired locations visible, folded, for the same reason: somebody
who finds an old sticker on a wall needs to be able to tell that it is dead on
purpose rather than missing from the system.

## Who may do it

An ESH coordinator, for departments they cover, with `<> all` and the explicit
null branch — the operator that has already shipped wrong six times here. A
viewer who can see the area cannot put a sticker in it. A department outside
their scope is refused as `department_not_yours`, and so is a department that
does not exist: the scope check runs first, so the procedure never tells a
coordinator whether a department they cannot see is real.

Both acts are audited.

## Printing the stickers

`node scripts/make-qr.mjs "BR2 Press line 2=https://…/report/<code>"` writes
one SVG per sticker plus a print-ready `index.html`, into a sibling of the
repository — never inside it, the same rule the backups follow and for the
same reason.

Generated offline on purpose. Pasting the address into a QR website hands that
location's code to a third party, and the code is the authorisation.

Error correction is set to level Q: a sticker on a plant floor gets scuffed,
oiled and partly covered, and Q survives about a quarter of the code being
unreadable. The quiet zone stays at the standard four modules, because
trimming it is the usual reason a printed code will not scan.

Each sheet carries the place in large type, one line saying what the code is
for, and the line that matters most: _if somebody is in immediate danger, stop
and follow the site emergency procedure — this code does not raise an alarm._

## What this does not do

It does not open public reporting. That is still one administrator's sentence
on the Identity and access screen, and the same card closes it again — closing
stops new reports and keeps the ones already received.

Two things remain nobody's to infer:

- **who watches the queue**, daily, for the pilot area;
- **the site's own emergency arrangement**, which the form points at without
  naming, and which somebody has to confirm sits beside the sticker.

The package's own instruction was to keep reporting disabled until the
safeguards _and the site's reporting arrangements_ have been tested and
approved. The safeguards are tested. The arrangements are not an engineering
question.
