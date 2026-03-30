create extension if not exists pgcrypto;

create table if not exists public.customer_profiles (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  temp_min numeric,
  temp_max numeric,
  unit_ids text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.pod_sites (
  id uuid primary key default gen_random_uuid(),
  external_id text unique,
  name text not null,
  customer_id text,
  latitude numeric not null,
  longitude numeric not null,
  radius_meters numeric not null default 150,
  max_speed_kph numeric not null default 5,
  unit_ids text[] not null default '{}',
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.daily_temp_snapshots (
  id text primary key,
  day date not null,
  error_timestamp timestamptz not null,
  error_time text,
  account_id text,
  account_label text,
  unit_id text not null,
  unit_label text,
  vehicle text,
  error_type text not null,
  error_label text,
  duration_minutes numeric,
  temp1 numeric,
  temp2 numeric,
  speed numeric,
  end_timestamp timestamptz,
  latitude numeric,
  longitude numeric,
  location_summary text,
  zone_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.pod_snapshots (
  id text primary key,
  day date not null,
  snapshot_timestamp timestamptz not null,
  snapshot_time text,
  unit_id text not null,
  unit_label text,
  customer_name text,
  pod_id text,
  pod_name text,
  latitude numeric,
  longitude numeric,
  speed numeric,
  distance_meters numeric,
  location_summary text,
  created_at timestamptz not null default now()
);

alter table if exists public.daily_temp_snapshots add column if not exists account_id text;
alter table if exists public.daily_temp_snapshots add column if not exists account_label text;
alter table if exists public.daily_temp_snapshots add column if not exists end_timestamp timestamptz;
alter table if exists public.daily_temp_snapshots add column if not exists latitude numeric;
alter table if exists public.daily_temp_snapshots add column if not exists longitude numeric;
alter table if exists public.daily_temp_snapshots add column if not exists location_summary text;
alter table if exists public.daily_temp_snapshots add column if not exists zone_name text;

create index if not exists idx_daily_temp_snapshots_day on public.daily_temp_snapshots(day desc);
create index if not exists idx_daily_temp_snapshots_unit_id on public.daily_temp_snapshots(unit_id);
create index if not exists idx_pod_snapshots_day on public.pod_snapshots(day desc);
create index if not exists idx_pod_snapshots_unit_id on public.pod_snapshots(unit_id);

create table if not exists public.dashboard_web_users (
  id text primary key,
  username text unique not null,
  display_name text not null,
  password_hash text not null,
  role text not null default 'admin',
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_dashboard_web_users_username on public.dashboard_web_users(username);


create table if not exists public.app_settings (
  id text primary key,
  config_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.app_state (
  id text primary key,
  state_data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
