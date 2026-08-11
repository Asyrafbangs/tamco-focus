# Supabase email templates

Paste these into **Authentication → Emails → Templates** on
`tamco-focus-production`. One per tab.

## The one thing that must be right

Every link uses `{{ .TokenHash }}` and points at `/auth/callback`, not
`{{ .ConfirmationURL }}`.

The default templates use `ConfirmationURL`, which routes through Supabase's own
verify endpoint and returns tokens in a URL fragment. A fragment never reaches
the server, so a server-rendered application cannot read it — the person lands
signed-out and confused. `TokenHash` is exchanged server-side by
`src/app/auth/callback/route.ts`, which is why that route exists.

If a link ever 404s again, check this first: a template reverted to
`ConfirmationURL` will produce exactly that.

`{{ .SiteURL }}` resolves to whatever **URL Configuration → Site URL** says, so
these templates are correct for any environment without editing.

---

## Invite user

Subject:

```
You have been added to TAMCO Focus
```

Body:

```html
<div
  style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0d2342;max-width:520px"
>
  <p style="font-size:18px;font-weight:600;margin:0 0 16px">TAMCO Focus</p>

  <p style="margin:0 0 16px">
    You have been given an account on TAMCO Focus, where the team keeps track of its work, routines
    and goals.
  </p>

  <p style="margin:0 0 24px">
    Choose a password to get started. The link works once and expires in 24 hours.
  </p>

  <p style="margin:0 0 24px">
    <a
      href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite"
      style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600"
    >
      Set your password
    </a>
  </p>

  <p style="margin:0 0 8px;color:#5b6b82;font-size:13px">
    If the button does not work, paste this into your browser:
  </p>
  <p style="margin:0 0 24px;color:#5b6b82;font-size:12px;word-break:break-all">
    {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=invite
  </p>

  <p style="margin:0;color:#5b6b82;font-size:13px">
    If you were not expecting this, you can ignore it — nothing happens until you set a password.
  </p>
</div>
```

---

## Reset password

Subject:

```
Reset your TAMCO Focus password
```

Body:

```html
<div
  style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0d2342;max-width:520px"
>
  <p style="font-size:18px;font-weight:600;margin:0 0 16px">TAMCO Focus</p>

  <p style="margin:0 0 16px">Someone asked to reset the password for this address.</p>

  <p style="margin:0 0 24px">
    If it was you, choose a new one. The link works once and expires in an hour.
  </p>

  <p style="margin:0 0 24px">
    <a
      href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery"
      style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600"
    >
      Choose a new password
    </a>
  </p>

  <p style="margin:0 0 8px;color:#5b6b82;font-size:13px">
    If the button does not work, paste this into your browser:
  </p>
  <p style="margin:0 0 24px;color:#5b6b82;font-size:12px;word-break:break-all">
    {{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=recovery
  </p>

  <p style="margin:0;color:#5b6b82;font-size:13px">
    If it was not you, ignore this. Your password stays as it is, and nobody can use this link
    without your inbox.
  </p>
</div>
```

---

## Change email address

Subject:

```
Confirm your new TAMCO Focus email address
```

Body:

```html
<div
  style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#0d2342;max-width:520px"
>
  <p style="font-size:18px;font-weight:600;margin:0 0 16px">TAMCO Focus</p>

  <p style="margin:0 0 24px">
    Confirm that {{ .Email }} is yours, and it becomes the address you sign in with.
  </p>

  <p style="margin:0 0 24px">
    <a
      href="{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email_change"
      style="display:inline-block;background:#1f6feb;color:#ffffff;text-decoration:none;padding:11px 20px;border-radius:8px;font-weight:600"
    >
      Confirm this address
    </a>
  </p>

  <p style="margin:0;color:#5b6b82;font-size:13px">
    If you did not ask for this, ignore it — the change does not take effect.
  </p>
</div>
```

---

## Notes

**Inline styles only.** Every serious email client strips `<style>` blocks, and
Gmail strips classes. What is inline is what renders.

**Plain wording on purpose.** These arrive from a gmail.com sender about a
vercel.app address, which already looks marginal to a spam filter. Urgency
language, tracking pixels and image-only buttons make it worse. A plain
text-and-link message is the version that gets delivered.

**No name interpolation.** `{{ .Data }}` only carries what was passed at
invitation time, and a template that renders an empty greeting looks broken. The
address in the To line is enough.

**One link, one use.** Clicking twice fails, and the second click shows the
generic "no longer valid" message on the sign-in page — deliberately the same
message as an expired or tampered link.
