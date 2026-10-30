-- Run this ONLY if you already ran the first schema.sql. It adds the weather cache table.
create table if not exists weather_cache (
  node_id text primary key references nodes(id),
  fetched_at timestamptz not null,
  data jsonb not null
);
alter table weather_cache enable row level security;
create policy "public read weather" on weather_cache for select to anon, authenticated using (true);
