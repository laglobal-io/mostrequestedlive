-- Most Requested Live — schema
-- Run once against your Postgres (Neon/Vercel Postgres/Supabase):
--   psql "$DATABASE_URL" -f db/schema.sql

create table if not exists songs (
  id          serial primary key,
  title       text not null,
  artist      text not null,
  created_at  timestamptz not null default now()
);
create unique index if not exists songs_uniq on songs (lower(title), lower(artist));

-- Every request, from every channel.
create table if not exists requests (
  id          bigserial primary key,
  song_id     int references songs(id) on delete set null,
  raw_text    text not null,
  name        text,
  city        text,
  message     text,
  kind        text not null default 'request',   -- request | question | dedication | shoutout | birthday
  source      text not null default 'web',       -- web | tiktok | instagram | x | youtube | phone | sms
  ribbon      text,
  likes       int  not null default 0,
  boosts      int  not null default 0,
  status      text not null default 'approved',  -- pending | approved | rejected
  crew_reply  text,
  ip_hash     text,
  created_at  timestamptz not null default now()
);
create index if not exists requests_created on requests (created_at desc);
create index if not exists requests_song    on requests (song_id);
create index if not exists requests_city    on requests (city);
create index if not exists requests_source  on requests (source);
create index if not exists requests_ip_time on requests (ip_hash, created_at desc);

-- Tonight's running order. The producer drives this; the site reads it.
create table if not exists rundown (
  id           bigserial primary key,
  show_date    date not null default current_date,
  position     int  not null,
  song_id      int  references songs(id) on delete set null,
  request_id   bigint references requests(id) on delete set null,
  requested_by text,
  hour_label   text,
  status       text not null default 'queued',   -- queued | playing | aired
  aired_at     timestamptz,
  created_at   timestamptz not null default now()
);
create unique index if not exists rundown_slot on rundown (show_date, position);
create index if not exists rundown_status on rundown (show_date, status);

-- "Ping me when this airs"
create table if not exists subscriptions (
  id          bigserial primary key,
  song_id     int not null references songs(id) on delete cascade,
  client_id   text not null,
  created_at  timestamptz not null default now(),
  notified_at timestamptz
);
create unique index if not exists subs_uniq on subscriptions (song_id, client_id);

-- Head-to-head "what plays next"
create table if not exists vote_rounds (
  id          bigserial primary key,
  song_a      int not null references songs(id),
  song_b      int not null references songs(id),
  opens_at    timestamptz not null default now(),
  closes_at   timestamptz not null,
  winner_id   int references songs(id),
  resolved    boolean not null default false
);
create table if not exists votes (
  id        bigserial primary key,
  round_id  bigint not null references vote_rounds(id) on delete cascade,
  song_id   int not null references songs(id),
  client_id text not null,
  created_at timestamptz not null default now()
);
create unique index if not exists votes_one_per_client on votes (round_id, client_id);

-- The Lounge
create table if not exists lounge_messages (
  id         bigserial primary key,
  name       text not null,
  body       text not null,
  is_crew    boolean not null default false,
  is_system  boolean not null default false,
  ip_hash    text,
  created_at timestamptz not null default now()
);
create index if not exists lounge_created on lounge_messages (id desc);

-- Weekly chart snapshot, so movement arrows are real.
create table if not exists chart_history (
  week_start date not null,
  song_id    int  not null references songs(id) on delete cascade,
  rank       int  not null,
  request_count int not null,
  primary key (week_start, song_id)
);

-- Crew picks that sit on the chart alongside fan-requested songs.
create table if not exists crew_picks (
  song_id    int primary key references songs(id) on delete cascade,
  week_start date not null default date_trunc('week', now())::date,
  weight     int not null default 0
);
