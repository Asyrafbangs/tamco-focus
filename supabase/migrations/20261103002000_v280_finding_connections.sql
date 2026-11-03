-- ============================================================================
-- v280 — every reviewed connection between two findings, as one relation
--
-- Stage 4 is Patterns, and the Patterns page has said since Stage 1 that
-- "recurring issues will appear after ESH has reviewed categories and links".
-- Links now exist: v209's duplicate outcome, v267's effectiveness follow-up
-- and v279's symmetric related link. Categories do not, and are an open
-- decision, so nothing here groups by hazard type and nothing infers a cause
-- from a title, a location or a handful of observations.
--
-- What this view does is report decisions somebody already made. Each of the
-- three sources is a link a coordinator recorded deliberately, so reading them
-- together is not inference. It is the same three facts the finding detail page
-- shows, aggregated so a pattern over them can be counted.
--
-- Stored once, read from both ends. v209 and v267 store one directed row and
-- v279 stores one ordered row, so each source appears twice here with the ends
-- swapped and the relationship named from the reader's side. A page asking
-- "what is connected to this finding?" is then one `where finding_id = …`.
--
-- `security_invoker = true` is this view's entire access control: it makes
-- every branch run under the reader's own policies rather than the view
-- owner's. Never drop and recreate this view without it — a plain
-- `create or replace` keeps the option, a `drop view` loses it silently, and
-- the register has leaked that way before.
--
-- Both ends must be visible, matching v279's rule. A reader who can see one
-- finding of a pair would otherwise learn that an invisible finding exists and
-- is connected to theirs. The `exists` clauses are filtered by
-- `esh_findings`'s own policy because of `security_invoker`, so "visible"
-- means exactly what it means everywhere else.
-- ============================================================================

create view public.esh_finding_connections with (security_invoker = true) as
-- v209 — what this finding repeats.
select
  f.organization_id,
  f.id as finding_id,
  f.duplicate_of_finding_id as other_finding_id,
  'duplicate_of'::text as kind,
  f.resolved_at as occurred_at,
  f.status_reason as note
from public.esh_findings f
where
  f.duplicate_of_finding_id is not null
  and exists (
    select 1 from public.esh_findings o where o.id = f.duplicate_of_finding_id
  )

union all

-- v209, from the other end — what came back as this finding.
select
  f.organization_id,
  f.duplicate_of_finding_id as finding_id,
  f.id as other_finding_id,
  'reported_again_as'::text as kind,
  f.resolved_at as occurred_at,
  f.status_reason as note
from public.esh_findings f
where
  f.duplicate_of_finding_id is not null
  and exists (
    select 1 from public.esh_findings o where o.id = f.duplicate_of_finding_id
  )

union all

-- v267 — the fix did not hold, and this is what that raised.
select
  c.organization_id,
  c.finding_id,
  c.follow_up_finding_id as other_finding_id,
  'recurred_as'::text as kind,
  c.decided_at as occurred_at,
  c.decision_note as note
from public.esh_effectiveness_checks c
where
  c.follow_up_finding_id is not null
  and exists (select 1 from public.esh_findings o where o.id = c.finding_id)
  and exists (select 1 from public.esh_findings o where o.id = c.follow_up_finding_id)

union all

-- v267, from the other end — the correction this finding exists because of.
select
  c.organization_id,
  c.follow_up_finding_id as finding_id,
  c.finding_id as other_finding_id,
  'raised_from'::text as kind,
  c.decided_at as occurred_at,
  c.decision_note as note
from public.esh_effectiveness_checks c
where
  c.follow_up_finding_id is not null
  and exists (select 1 from public.esh_findings o where o.id = c.finding_id)
  and exists (select 1 from public.esh_findings o where o.id = c.follow_up_finding_id)

union all

-- v279 — related, which is symmetric, so the one stored row is read both ways.
select
  l.organization_id,
  l.finding_id,
  l.related_finding_id as other_finding_id,
  'related'::text as kind,
  l.created_at as occurred_at,
  l.note
from public.esh_finding_links l

union all

select
  l.organization_id,
  l.related_finding_id as finding_id,
  l.finding_id as other_finding_id,
  'related'::text as kind,
  l.created_at as occurred_at,
  l.note
from public.esh_finding_links l;

comment on view public.esh_finding_connections is
  'Every reviewed finding-to-finding link, from both ends, named from the reader side. Sources: esh_findings.duplicate_of_finding_id (v209), esh_effectiveness_checks.follow_up_finding_id (v267), esh_finding_links (v279). security_invoker is this view access control: do not drop and recreate it without the option.';

revoke all on public.esh_finding_connections from anon, authenticated;
grant select on public.esh_finding_connections to authenticated;
