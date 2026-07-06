-- Standalone SQL for the cédula login persistence fix.
-- Run this in the Supabase SQL editor.

create table if not exists public.cedula_emails (
  cedula text primary key,
  email text not null unique,
  user_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

alter table public.cedula_emails enable row level security;

drop policy if exists "Public can read cedula emails" on public.cedula_emails;
create policy "Public can read cedula emails"
on public.cedula_emails
for select
to anon, authenticated
using (true);

drop policy if exists "Anyone can insert cedula emails" on public.cedula_emails;
create policy "Anyone can insert cedula emails"
on public.cedula_emails
for insert
to anon, authenticated
with check (cedula is not null and email is not null);

drop policy if exists "Authenticated can update cedula emails" on public.cedula_emails;
create policy "Authenticated can update cedula emails"
on public.cedula_emails
for update
to authenticated
using (true)
with check (true);

create or replace function public.get_email_by_cedula(lookup_cedula text)
returns text
language sql
security definer
set search_path = public, auth
as $$
  with normalized_lookup as (
    select regexp_replace(coalesce(lookup_cedula, ''), '\\D', '', 'g') as cedula_digits
  )
  select coalesce(
    (
      select ce.email
      from public.cedula_emails ce
      cross join normalized_lookup nl
      where regexp_replace(coalesce(ce.cedula, ''), '\\D', '', 'g') = nl.cedula_digits
      limit 1
    ),
    (
      select p.email
      from public.profiles p
      cross join normalized_lookup nl
      where regexp_replace(coalesce(p.cedula, ''), '\\D', '', 'g') = nl.cedula_digits
      limit 1
    ),
    (
      select u.email
      from auth.users u
      cross join normalized_lookup nl
      where regexp_replace(coalesce(u.raw_user_meta_data->>'cedula', ''), '\\D', '', 'g') = nl.cedula_digits
      limit 1
    )
  );
$$;

revoke all on function public.get_email_by_cedula(text) from public;
grant execute on function public.get_email_by_cedula(text) to anon, authenticated;

create or replace function public.sync_profile(
  user_id uuid,
  user_email text,
  user_name text,
  user_cedula text,
  user_is_admin boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, cedula, is_admin)
  values (user_id, user_email, user_name, user_cedula, user_is_admin)
  on conflict (id) do update
  set email = excluded.email,
      name = excluded.name,
      cedula = excluded.cedula,
      is_admin = excluded.is_admin;

  insert into public.cedula_emails (cedula, email, user_id)
  values (user_cedula, user_email, user_id)
  on conflict (cedula) do update
  set email = excluded.email,
      user_id = excluded.user_id;
end;
$$;

revoke all on function public.sync_profile(uuid, text, text, text, boolean) from public;
grant execute on function public.sync_profile(uuid, text, text, text, boolean) to anon, authenticated;
