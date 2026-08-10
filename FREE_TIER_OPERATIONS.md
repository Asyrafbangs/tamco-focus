# Operating TAMCO Focus on free infrastructure

What runs out, where to watch it, and when paying starts being the cheaper
option.

## Supabase Free

| Limit                | Allowance        | Watch              | Matters when                                                                                                           |
| -------------------- | ---------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| Projects             | 2 active per org | Dashboard          | Staging + Production uses both. A third needs a pause or an upgrade                                                    |
| Database size        | 500 MB           | Reports → Database | ~6 people generating tasks and attachments will not approach this for a long time                                      |
| Storage              | 1 GB             | Reports → Storage  | Attachments are the growth path. Watch it, not the row counts                                                          |
| Monthly active users | 50,000           | Auth               | Never, at pilot scale                                                                                                  |
| Egress               | 5 GB/month       | Reports            | Attachment downloads dominate                                                                                          |
| **Backups**          | **None**         | —                  | **Already.** See `BACKUP_AND_RECOVERY.md`                                                                              |
| **Inactivity pause** | **7 days**       | Project status     | A quiet week pauses Production. The daily cron keeps it warm, which is a side benefit rather than the reason it exists |

The two that actually bite are the missing backups and the inactivity pause.
Both are handled; neither is handled by accident.

## Hosting

**Unresolved.** Vercel's Hobby plan is licensed for personal, non-commercial
projects; an internal tool used by TAMCO employees for company work is
commercial use however small the pilot. Deploying there would breach the plan
terms.

| Option                        | Cost                           | Commercial use | Cron                        | Effort                  |
| ----------------------------- | ------------------------------ | -------------- | --------------------------- | ----------------------- |
| Vercel Pro                    | $20/user/month                 | Permitted      | Unlimited, any schedule     | None — deploy as built  |
| Cloudflare Workers (OpenNext) | Free tier permits business use | Permitted      | Cron Triggers, any schedule | Adapter + build changes |
| Self-host on a small VPS      | ~$5/month                      | Permitted      | System cron                 | Ops burden moves to us  |
| Stay local                    | —                              | n/a            | n/a                         | No pilot                |

If Vercel Pro is chosen, `vercel.json` and `/api/cron` work as written. If
Cloudflare is chosen, the endpoint is unchanged and only the schedule
declaration moves.

## GitHub Free

| Limit                | Allowance                                          | Note                                                                                                                         |
| -------------------- | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Private repositories | Unlimited                                          | Fine                                                                                                                         |
| Actions minutes      | 2,000/month on private                             | The static job is ~2 min, the database job ~6. Roughly 250 pushes a month before it bites                                    |
| Branch protection    | **Not available on Free for private repositories** | Discipline substitutes: never push to `main` directly, always via a branch and a green CI run. Documented in `DEPLOYMENT.md` |

The branch-protection gap is the real one. It is a process control rather than a
technical one, which means it can be forgotten. If the team grows beyond the
pilot, GitHub Team is the upgrade that turns it back into a technical control.

## Warning signs

Act, do not wait, when any of these appear:

- Supabase database over 350 MB, or storage over 700 MB
- A Production project that paused — it means nobody used it for a week
- Actions minutes over ~1,500 in a month
- Any cron run returning 500, twice in a row
- A Production error nobody has explained within a day

## When paying becomes the cheaper option

- **Backups.** The first time a restore is needed under time pressure, the
  scripted backup will feel thin. Supabase Pro's daily backups and 7-day PITR
  are the single strongest argument for upgrading.
- **More than the pilot team.** Beyond ~15 people, the storage and egress
  allowances start to need watching weekly, which is not free either.
- **Branch protection.** As soon as more than one person can push.
