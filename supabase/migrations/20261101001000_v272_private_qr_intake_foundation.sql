-- v272 — Stage 2 begins with a private, disabled-by-default data boundary.
-- There is deliberately no anonymous policy or public submission procedure in
-- this migration. Those require the approved privacy, emergency and upload
-- operating policies before a public endpoint can be enabled.

create table public.esh_qr_intake_settings (
  organization_id uuid primary key references public.organizations (id) on delete cascade,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  check (enabled = false)
);

create table public.esh_qr_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  public_code text not null check (public_code ~ '^[A-Za-z0-9_-]{8,64}$'),
  display_label text not null check (length(btrim(display_label)) between 1 and 160),
  active boolean not null default true,
  retired_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, public_code),
  check ((active and retired_at is null) or (not active))
);

create index esh_qr_locations_lookup_idx
  on public.esh_qr_locations (organization_id, public_code)
  where active;

create table public.esh_report_intake (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations (id) on delete cascade,
  qr_location_id uuid references public.esh_qr_locations (id) on delete set null,
  source text not null check (source in ('qr', 'esh_manual')),
  status text not null default 'new' check (status in ('new', 'triaging', 'accepted', 'duplicate', 'declined')),
  report_text text not null check (length(btrim(report_text)) between 1 and 4000),
  reported_location text,
  public_reference uuid not null default gen_random_uuid(),
  received_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (organization_id, public_reference)
);

create index esh_report_intake_queue_idx
  on public.esh_report_intake (organization_id, status, received_at);

alter table public.esh_qr_intake_settings enable row level security;
alter table public.esh_qr_locations enable row level security;
alter table public.esh_report_intake enable row level security;

revoke all on table public.esh_qr_intake_settings from anon, authenticated;
revoke all on table public.esh_qr_locations from anon, authenticated;
revoke all on table public.esh_report_intake from anon, authenticated;
