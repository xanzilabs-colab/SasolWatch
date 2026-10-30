create table if not exists public.zernio_runtime_config (
  config_key text primary key,
  config_value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table public.zernio_runtime_config enable row level security;
grant select, insert, update on public.zernio_runtime_config to service_role;
