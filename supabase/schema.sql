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
  unit_id text not null,
  unit_label text,
  vehicle text,
  error_type text not null,
  error_label text,
  duration_minutes numeric,
  temp1 numeric,
  temp2 numeric,
  speed numeric,
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

create index if not exists idx_daily_temp_snapshots_day on public.daily_temp_snapshots(day desc);
create index if not exists idx_daily_temp_snapshots_unit_id on public.daily_temp_snapshots(unit_id);
create index if not exists idx_pod_snapshots_day on public.pod_snapshots(day desc);
create index if not exists idx_pod_snapshots_unit_id on public.pod_snapshots(unit_id);
