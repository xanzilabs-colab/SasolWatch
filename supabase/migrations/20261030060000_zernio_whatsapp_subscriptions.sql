create table if not exists public.subscribers (
  id bigserial primary key,
  phone text not null unique check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  status text not null default 'unsubscribed' check (status in ('active', 'unsubscribed')),
  subscribed_at timestamptz,
  last_inbound_at timestamptz,
  zernio_conversation_id text,
  account_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscribers_active_last_inbound_idx
  on public.subscribers (status, last_inbound_at desc);

create table if not exists public.zernio_webhook_events (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  message_phone text,
  message_text text,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  attempts int not null default 0,
  processing_error text,
  received_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  processed_at timestamptz
);

create index if not exists zernio_webhook_events_pending_idx
  on public.zernio_webhook_events (status, received_at)
  where status in ('pending', 'failed');

create table if not exists public.zernio_webhook_samples (
  event_id text primary key,
  event_type text not null,
  payload jsonb not null,
  captured_at timestamptz not null default now()
);

alter table public.alerts
  add column if not exists subscriber_id bigint references public.subscribers(id);

create table if not exists public.subscriber_alert_deliveries (
  delivery_key text primary key,
  event_id bigint references public.events(id) on delete set null,
  severity_rank int not null default 0,
  alert_id bigint references public.alerts(id) on delete set null,
  subscriber_id bigint not null references public.subscribers(id) on delete cascade,
  phone text not null,
  message text not null,
  status text not null check (status in ('pending', 'sent', 'failed', 'dry_run')),
  attempts int not null default 0,
  provider_status int,
  provider_message_id text,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists subscriber_alert_deliveries_pending_idx
  on public.subscriber_alert_deliveries (status, created_at)
  where status in ('pending', 'failed');
create index if not exists subscriber_alert_deliveries_provider_id_idx
  on public.subscriber_alert_deliveries (provider_message_id)
  where provider_message_id is not null;

alter table public.subscribers enable row level security;
alter table public.zernio_webhook_events enable row level security;
alter table public.zernio_webhook_samples enable row level security;
alter table public.subscriber_alert_deliveries enable row level security;

create or replace function public.upsert_zernio_subscriber(
  p_phone text,
  p_action text,
  p_conversation_id text,
  p_account_id text,
  p_last_inbound_at timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_phone !~ '^\+[1-9][0-9]{7,14}$' then
    raise exception 'Invalid E.164 phone number';
  end if;
  if p_action not in ('subscribe', 'unsubscribe', 'help') then
    raise exception 'Invalid subscription action';
  end if;

  insert into public.subscribers (
    phone, status, subscribed_at, last_inbound_at, zernio_conversation_id, account_id
  )
  values (
    p_phone,
    case when p_action = 'subscribe' then 'active' else 'unsubscribed' end,
    case when p_action = 'subscribe' then p_last_inbound_at else null end,
    p_last_inbound_at,
    p_conversation_id,
    p_account_id
  )
  on conflict (phone) do update set
    status = case
      when p_action = 'subscribe' then 'active'
      when p_action = 'unsubscribe' then 'unsubscribed'
      else public.subscribers.status
    end,
    subscribed_at = case
      when p_action = 'subscribe' then p_last_inbound_at
      when p_action = 'unsubscribe' then null
      else public.subscribers.subscribed_at
    end,
    last_inbound_at = p_last_inbound_at,
    zernio_conversation_id = coalesce(p_conversation_id, public.subscribers.zernio_conversation_id),
    account_id = coalesce(p_account_id, public.subscribers.account_id),
    updated_at = now();
end;
$$;

revoke all on function public.upsert_zernio_subscriber(text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.upsert_zernio_subscriber(text, text, text, text, timestamptz)
  to service_role;

grant select, insert, update on public.subscribers to service_role;
grant select, insert, update on public.zernio_webhook_events to service_role;
grant select, insert on public.zernio_webhook_samples to service_role;
grant select, insert, update on public.subscriber_alert_deliveries to service_role;
