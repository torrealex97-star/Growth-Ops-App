-- ============================================================
-- VSL tracking (IA WINNERS) — vturb-style, in-house
-- ============================================================

create table if not exists vsl_videos (
  id               uuid primary key default gen_random_uuid(),
  slug             text unique not null,
  name             text not null,
  source_url       text,                       -- .mp4 (Vercel Blob) o .m3u8 (Bunny/HLS)
  poster_url       text,                        -- miniatura mostrada al instante
  duration_seconds numeric not null default 0,
  config           jsonb  not null default '{}'::jsonb,  -- {barColor, primaryColor, autoplay, muted, lockSeek, showBar}
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

-- una fila por sesión de visionado (anónima; se puede identificar con email del form)
create table if not exists vsl_sessions (
  id            uuid primary key default gen_random_uuid(),
  video_id      uuid not null references vsl_videos(id) on delete cascade,
  anon_id       text not null,
  lead_email    text,
  lead_name     text,
  referrer      text,
  device        text,                     -- mobile | desktop | tablet
  country       text,
  user_agent    text,
  duration      numeric not null default 0,   -- duración conocida del vídeo en esta sesión
  max_position  numeric not null default 0,   -- segundo máximo alcanzado
  watched_seconds int[] not null default '{}',-- segundos enteros únicos vistos (heatmap real)
  plays         int  not null default 0,
  reached_end   boolean not null default false,
  first_play_at timestamptz,
  last_beat_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (video_id, anon_id)
);

create index if not exists idx_vsl_sessions_video on vsl_sessions(video_id);
create index if not exists idx_vsl_sessions_email on vsl_sessions(lead_email) where lead_email is not null;
create index if not exists idx_vsl_sessions_created on vsl_sessions(created_at);
