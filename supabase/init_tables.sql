-- SQL to initialize required tables for the project
-- Run this in Supabase SQL editor (Project -> SQL Editor)

-- products table
create table if not exists public.products (
  id text primary key,
  name text not null,
  category text,
  price numeric default 0,
  stock integer default 0,
  image text,
  description text,
  specs jsonb,
  created_at timestamptz default now()
);

alter table public.products enable row level security;

drop policy if exists "Public can read products" on public.products;
create policy "Public can read products"
on public.products
for select
to anon, authenticated
using (true);

drop policy if exists "Admins can manage products" on public.products;
create policy "Admins can manage products"
on public.products
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin = true
  )
);

-- profiles table (linked to auth.users)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  name text,
  cedula text,
  is_admin boolean default false,
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

drop policy if exists "Users can read own profile" on public.profiles;
create policy "Users can read own profile"
on public.profiles
for select
to authenticated
using (id = auth.uid());

drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can update own profile"
on public.profiles
for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Admins can read all profiles" on public.profiles;
create policy "Admins can read all profiles"
on public.profiles
for select
to authenticated
using (
  exists (
    select 1
    from public.profiles as admin_profiles
    where admin_profiles.id = auth.uid()
      and admin_profiles.is_admin = true
  )
);

-- cedula -> email lookup table used to resolve login before auth
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

drop policy if exists "Admins can manage profiles" on public.profiles;
create policy "Admins can manage profiles"
on public.profiles
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles as admin_profiles
    where admin_profiles.id = auth.uid()
      and admin_profiles.is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.profiles as admin_profiles
    where admin_profiles.id = auth.uid()
      and admin_profiles.is_admin = true
  )
);

-- orders table
create table if not exists public.orders (
  id text primary key,
  items jsonb,
  total numeric default 0,
  status text default 'pending',
  user_id uuid references auth.users(id),
  created_at timestamptz default now()
);

alter table public.orders enable row level security;

drop policy if exists "Users can read own orders" on public.orders;
create policy "Users can read own orders"
on public.orders
for select
to authenticated
using (user_id = auth.uid());

drop policy if exists "Users can create own orders" on public.orders;
create policy "Users can create own orders"
on public.orders
for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Admins can manage orders" on public.orders;
create policy "Admins can manage orders"
on public.orders
for all
to authenticated
using (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin = true
  )
)
with check (
  exists (
    select 1
    from public.profiles
    where profiles.id = auth.uid()
      and profiles.is_admin = true
  )
);

-- RPC helpers used by the app
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

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, name, cedula, is_admin)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)),
    new.raw_user_meta_data->>'cedula',
    coalesce((new.raw_user_meta_data->>'cedula') = '1108758522', false)
  )
  on conflict (id) do update
  set email = excluded.email,
      name = excluded.name,
      cedula = excluded.cedula,
      is_admin = excluded.is_admin;

  insert into public.cedula_emails (cedula, email, user_id)
  values (
    new.raw_user_meta_data->>'cedula',
    new.email,
    new.id
  )
  on conflict (cedula) do update
  set email = excluded.email,
      user_id = excluded.user_id;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row
execute function public.handle_new_user();

-- Make sure product-images storage bucket exists (create in UI)
