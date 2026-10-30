-- SasolSniff backend schema. Run once in the Supabase SQL editor.

create table if not exists nodes (
  id text primary key,
  name text not null,
  lat double precision not null,
  lon double precision not null,
  default_wind_speed_ms double precision not null default 3.0,
  last_seen timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists sources (
  id bigserial primary key,
  name text not null,
  kind text not null check (kind in ('industrial','power','mine','waste_treatment','residential','road')),
  lat double precision not null,
  lon double precision not null,
  illustrative boolean not null default true,
  note text
);

create table if not exists events (
  id bigserial primary key,
  node_id text not null references nodes(id),
  status text not null default 'open' check (status in ('open','closed')),
  started_at timestamptz not null,
  ended_at timestamptz,
  peak_gas_raw int,
  peak_intensity double precision not null default 0,
  severity text not null default 'low',
  severity_rank int not null default 1,
  source_type text,
  confidence double precision,
  wind_from_deg double precision,
  test_mode boolean not null default false,
  alerted_level int not null default 0,
  alerted_at timestamptz,
  summary jsonb,
  created_at timestamptz not null default now()
);

create table if not exists readings (
  id bigserial primary key,
  node_id text not null references nodes(id),
  ts timestamptz not null,
  received_at timestamptz not null default now(),
  gas_raw int not null,
  baseline_raw double precision,
  wind_raw int,
  wind_from_deg double precision,
  temperature_c double precision,
  humidity_pct double precision,
  device_surge boolean not null default false,
  warming_up boolean not null default false,
  test_mode boolean not null default false,
  surge boolean not null default false,
  event_id bigint references events(id),
  fusion jsonb,
  rssi int,
  fw text
);
create index if not exists readings_node_ts_idx on readings (node_id, ts desc);
create index if not exists events_node_status_idx on events (node_id, status);

create table if not exists alert_recipients (
  id bigserial primary key,
  name text not null,
  phone text not null,               -- international format, e.g. 27821234567
  group_type text not null default 'household' check (group_type in ('school','household','clinic','municipality','team')),
  node_id text references nodes(id), -- null = receives alerts from every node
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists alerts (
  id bigserial primary key,
  event_id bigint references events(id),
  node_id text not null references nodes(id),
  recipient_id bigint references alert_recipients(id),
  recipient_name text,
  group_type text,
  channel text not null default 'whatsapp',
  status text not null,              -- sent | failed | dry_run
  severity text,
  message text,
  provider_status int,
  created_at timestamptz not null default now()
);
create index if not exists alerts_node_created_idx on alerts (node_id, created_at desc);

create table if not exists weather_cache (
  node_id text primary key references nodes(id),
  fetched_at timestamptz not null,
  data jsonb not null
);
alter table weather_cache enable row level security;
create policy "public read weather" on weather_cache for select to anon, authenticated using (true);

-- Row level security: the dashboard (anon key) can read everything except recipient phone numbers.
alter table nodes enable row level security;
alter table sources enable row level security;
alter table events enable row level security;
alter table readings enable row level security;
alter table alerts enable row level security;
alter table alert_recipients enable row level security;   -- no policy = service role only

create policy "public read nodes" on nodes for select to anon, authenticated using (true);
create policy "public read sources" on sources for select to anon, authenticated using (true);
create policy "public read events" on events for select to anon, authenticated using (true);
create policy "public read readings" on readings for select to anon, authenticated using (true);
create policy "public read alerts" on alerts for select to anon, authenticated using (true);

-- Realtime for the live dashboard
alter publication supabase_realtime add table readings, events, alerts;

-- Demo node. Coordinates are approximate (central Sasolburg). Update to the real demo location.
insert into nodes (id, name, lat, lon, default_wind_speed_ms)
values ('sasolsniff-node-01', 'SasolSniff Node 01', -26.8167, 27.8167, 3.0)
on conflict (id) do nothing;

-- ILLUSTRATIVE candidate sources placed at made-up offsets from the demo node.
-- These are NOT real facilities. Replace with verified licensed-facility data before claiming anything.
insert into sources (name, kind, lat, lon, illustrative, note) values
 ('Industrial complex (illustrative)', 'industrial', -26.79173, 27.80055, true, 'Demo placeholder'),
 ('Boiler / power plant (illustrative)', 'power', -26.77319, 27.82976, true, 'Demo placeholder'),
 ('Wastewater treatment works (illustrative)', 'waste_treatment', -26.82910, 27.79685, true, 'Demo placeholder'),
 ('Residential area, coal and wood burning (illustrative)', 'residential', -26.82912, 27.82838, true, 'Demo placeholder'),
 ('Main road corridor (illustrative)', 'road', -26.81513, 27.83681, true, 'Demo placeholder'),
 ('Open waste dump (illustrative)', 'waste_treatment', -26.84775, 27.81056, true, 'Demo placeholder'),
 ('Mine / tailings (illustrative)', 'mine', -26.79821, 27.75978, true, 'Demo placeholder');

-- Add your demo phones (international format, digits only), then set active = true:
-- insert into alert_recipients (name, phone, group_type) values ('Nate', '27XXXXXXXXX', 'team');

-- Move the node when you know where the demo is:
-- update nodes set lat = -26.XXXX, lon = 27.XXXX where id = 'sasolsniff-node-01';
