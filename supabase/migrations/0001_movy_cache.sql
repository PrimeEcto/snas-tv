-- SNAS backend cache and device state (Supabase / Postgres).
--
-- The Worker scrapes an upstream source API that rate-limits aggressively (429
-- after only a handful of requests), so decrypted payloads are stored here and
-- reused. Supabase is the durable 24/7 store: the Worker talks to it over
-- PostgREST with the service role key, never through a SQL driver.
--
-- Every table below enables row level security with NO policies. The service role
-- bypasses RLS, so in practice only server-side code may read or write; the anon
-- and authenticated keys have no access at all. This migration is idempotent.

-- Decrypted source payloads, keyed by title identity + provider.
create table if not exists movy_stream_cache (
  key text primary key,
  value jsonb not null,
  stored_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists movy_stream_cache_expires_at_idx
  on movy_stream_cache (expires_at);

-- OpenSubtitles search results and converted WebVTT blobs, keyed both by title
-- identity and by individual subtitle id.
create table if not exists movy_subtitle_cache (
  key text primary key,
  value jsonb not null,
  stored_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists movy_subtitle_cache_expires_at_idx
  on movy_subtitle_cache (expires_at);

-- Continue Watching, synced from the Fire TV app per device.
create table if not exists movy_watch_progress (
  device_id text not null,
  tmdb_id integer not null,
  media_type text not null,
  -- Season and episode default to 0 for movies: a Postgres primary key cannot
  -- contain a coalesce expression, so absent values are normalised at write time
  -- instead of stored as NULL.
  season integer not null default 0,
  episode integer not null default 0,
  position_seconds integer not null default 0,
  duration_seconds integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (device_id, tmdb_id, media_type, season, episode)
);

create index if not exists movy_watch_progress_updated_at_idx
  on movy_watch_progress (updated_at desc);

-- Known installs, so progress rows can be attributed and listed.
create table if not exists movy_devices (
  device_id text primary key,
  label text,
  first_seen timestamptz not null default now(),
  last_seen timestamptz not null default now()
);

-- RLS on with no policies: the service role bypasses RLS, so only the Worker's
-- server-side key can touch these tables.
alter table movy_stream_cache enable row level security;
alter table movy_subtitle_cache enable row level security;
alter table movy_watch_progress enable row level security;
alter table movy_devices enable row level security;
