-- ---------------------------------------------------------------------------
-- v108 - the nine colours an organisation actually wants to change.
--
-- The interface is already built on design tokens, so a theme does not need a
-- new styling system - it needs somewhere to keep nine values and a procedure
-- that refuses anything that is not a colour. Everything else is already
-- derived from those tokens, including the tinted panel backgrounds and the
-- focus ring.
--
-- Stored per person rather than per organisation. It is an appearance
-- preference, and it sits beside `theme_preference` and `text_size` which are
-- already personal. An organisation-wide default can be layered on later
-- without moving this.
--
-- Kept as one jsonb rather than nine columns: they are always read together,
-- always written together, and adding a tenth token should not be a migration
-- that rewrites a procedure signature.
-- ---------------------------------------------------------------------------

alter table public.user_profiles
  add column if not exists theme_colors jsonb;

comment on column public.user_profiles.theme_colors is
  'Nine optional colour overrides keyed by design token. Null means the built-in palette.';

/**
 * The keys that may be overridden.
 *
 * Deliberately closed. An open map would let anything be written under any
 * name and rendered into a stylesheet, which is a CSS injection with extra
 * steps; the value pattern below closes the other half of that.
 */
create or replace function focus.theme_colour_keys()
returns text[]
language sql
immutable
as $$
  select array[
    'brand',       -- primary, and everything derived from it
    'background',  -- the application behind the panels
    'nav',         -- the sidebar
    'surface',     -- cards, panels, modals
    'text',        -- primary text
    'muted',       -- secondary text
    'success',
    'warning',
    'danger'
  ];
$$;

create or replace function public.set_theme_colors(p_colors jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  actor uuid := auth.uid();
  entry record;
  cleaned jsonb := '{}'::jsonb;
begin
  if actor is null or not focus.is_active_account() then
    return focus.error('not_authorised', 'Sign in with an active account to change the theme.');
  end if;

  -- Null, or an empty object, means "go back to the built-in palette".
  if p_colors is null or p_colors = 'null'::jsonb or p_colors = '{}'::jsonb then
    update public.user_profiles set theme_colors = null where id = actor;
    return jsonb_build_object('ok', true, 'code', 'theme_reset');
  end if;

  if jsonb_typeof(p_colors) <> 'object' then
    return focus.error('validation_failed', 'The theme could not be read.');
  end if;

  for entry in select key, value from jsonb_each_text(p_colors) loop
    if not (entry.key = any (focus.theme_colour_keys())) then
      return focus.error('validation_failed', format('%s is not a theme colour.', entry.key));
    end if;
    -- Six-digit hex and nothing else. This is the half of the guard that stops
    -- a value like `red; } body { display:none` reaching a stylesheet.
    if entry.value !~ '^#[0-9A-Fa-f]{6}$' then
      return focus.error(
        'validation_failed',
        format('%s must be a colour like #1668e8.', entry.key));
    end if;
    cleaned := cleaned || jsonb_build_object(entry.key, lower(entry.value));
  end loop;

  update public.user_profiles set theme_colors = cleaned where id = actor;

  return jsonb_build_object('ok', true, 'code', 'theme_saved', 'colors', cleaned);
end;
$$;

revoke all on function public.set_theme_colors(jsonb) from public, anon;
grant execute on function public.set_theme_colors(jsonb) to authenticated;

comment on function public.set_theme_colors is
  'Saves the caller''s colour overrides. Refuses unknown keys and anything that is not a six-digit hex colour.';
