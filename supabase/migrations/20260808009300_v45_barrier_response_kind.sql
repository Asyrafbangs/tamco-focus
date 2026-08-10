-- ---------------------------------------------------------------------------
-- v45 sections 41 and 55 — an approval answers yes or no, and the record has
-- to keep which.
--
-- The manager's reply currently stores prose and nothing else. With one button
-- that was honest: a decision is whatever the manager wrote. An approval is
-- not — "Approve" and "Request changes" are different answers to the same
-- question, and if both write an identical row then a week later nobody can
-- tell from the record whether the work was cleared to proceed.
--
-- The kind is recorded alongside the message rather than replacing it. The
-- prose still carries the reasoning; the kind carries the answer.
-- ---------------------------------------------------------------------------

do $$
begin
  if not exists (select 1 from pg_type where typname = 'barrier_response_kind') then
    create type public.barrier_response_kind as enum (
      'answer',            -- a decision, or a plain reply
      'approved',
      'changes_requested'
    );
  end if;
end;
$$;

alter table public.barrier_responses
  add column if not exists kind public.barrier_response_kind not null default 'answer';

comment on column public.barrier_responses.kind is
  'What the reply answers. Only approval requests use approved / '
  'changes_requested; everything else is a plain answer (v45 section 41).';
