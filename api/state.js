import { sql, json, allowCors } from './_lib.js';

/**
 * One poll gives the page everything live on it.
 * GET /api/state?since=<lounge message id>&client=<id>
 */
export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  const since = parseInt(req.query.since || '0', 10) || 0;
  const client = (req.query.client || '').slice(0, 64);

  try {
    const [
      nowPlaying, rundown, chart, recent, lounge,
      stats, platforms, cities, cup, round, myVote, subs
    ] = await Promise.all([
      sql`
        select r.position, s.id as song_id, s.title, s.artist, r.requested_by, r.hour_label, r.aired_at
        from rundown r join songs s on s.id = r.song_id
        where r.show_date = current_date and r.status = 'playing'
        order by r.position limit 1`,

      sql`
        select r.id, r.position, r.status, r.requested_by, r.hour_label, r.aired_at,
               s.id as song_id, s.title, s.artist
        from rundown r left join songs s on s.id = r.song_id
        where r.show_date = current_date
        order by r.position`,

      sql`
        with wk as (
          select song_id, count(*)::int as n
          from requests
          where created_at > now() - interval '7 days' and status = 'approved' and song_id is not null
          group by song_id
        ),
        boosted as (
          select song_id, sum(boosts)::int as b from requests
          where created_at > now() - interval '7 days' and song_id is not null group by song_id
        ),
        scored as (
          select w.song_id, w.n, coalesce(b.b,0) as boosts,
                 w.n + coalesce(b.b,0)/4 + coalesce(cp.weight,0) as score,
                 (cp.song_id is not null) as crew_pick
          from wk w
          left join boosted b on b.song_id = w.song_id
          left join crew_picks cp on cp.song_id = w.song_id
        ),
        ranked as (
          select *, row_number() over (order by score desc, n desc, song_id) as rank from scored
        )
        select r.rank, r.song_id, s.title, s.artist, r.n as requests, r.boosts, r.crew_pick,
               h.rank as last_rank
        from ranked r
        join songs s on s.id = r.song_id
        left join chart_history h
               on h.song_id = r.song_id
              and h.week_start = (date_trunc('week', now()) - interval '7 days')::date
        where r.rank <= 20
        order by r.rank`,

      sql`
        select rq.id, rq.raw_text, rq.name, rq.city, rq.kind, rq.source, rq.ribbon,
               rq.likes, rq.boosts, rq.crew_reply, rq.created_at,
               s.title, s.artist
        from requests rq left join songs s on s.id = rq.song_id
        where rq.status = 'approved'
        order by rq.id desc limit 40`,

      sql`
        select id, name, body, is_crew, is_system, created_at
        from lounge_messages where id > ${since}
        order by id asc limit 60`,

      sql`
        select
          (select count(*)::int from requests where created_at > now() - interval '7 days') as week_requests,
          (select count(*)::int from requests where created_at > now() - interval '1 minute') as last_minute,
          (select count(distinct city)::int from requests where created_at > now() - interval '7 days' and city is not null) as cities,
          (select count(*)::int from requests where created_at > now() - interval '24 hours') as day_requests`,

      sql`
        select source, s.title, s.artist, count(*)::int as n
        from requests rq join songs s on s.id = rq.song_id
        where rq.created_at > now() - interval '24 hours' and rq.status = 'approved'
        group by source, s.title, s.artist
        order by source, n desc`,

      sql`
        select city, count(*)::int as n from requests
        where created_at > now() - interval '7 days' and city is not null
        group by city order by n desc limit 8`,

      sql`
        select city, count(*)::int + coalesce(sum(boosts),0)::int as pts
        from requests where created_at > now() - interval '7 days' and city is not null
        group by city order by pts desc limit 6`,

      sql`
        select vr.id, vr.closes_at,
               a.id as a_id, a.title as a_title, a.artist as a_artist,
               b.id as b_id, b.title as b_title, b.artist as b_artist,
               (select count(*)::int from votes where round_id = vr.id and song_id = a.id) as a_votes,
               (select count(*)::int from votes where round_id = vr.id and song_id = b.id) as b_votes
        from vote_rounds vr join songs a on a.id = vr.song_a join songs b on b.id = vr.song_b
        where vr.resolved = false and vr.closes_at > now()
        order by vr.id desc limit 1`,

      client ? sql`
        select song_id from votes v join vote_rounds vr on vr.id = v.round_id
        where v.client_id = ${client} and vr.resolved = false limit 1` : [],

      client ? sql`select song_id from subscriptions where client_id = ${client}` : []
    ]);

    // Group the per-platform top 5.
    const byPlatform = {};
    for (const row of platforms) {
      (byPlatform[row.source] ||= []).push({ title: row.title, artist: row.artist, n: row.n });
    }
    for (const k of Object.keys(byPlatform)) byPlatform[k] = byPlatform[k].slice(0, 5);

    json(res, 200, {
      ok: true,
      serverTime: new Date().toISOString(),
      nowPlaying: nowPlaying[0] || null,
      rundown,
      chart: chart.map(r => ({
        ...r,
        move: r.last_rank == null ? 'new' : (r.last_rank > r.rank ? 'up' : (r.last_rank < r.rank ? 'down' : 'flat')),
        delta: r.last_rank == null ? 0 : Math.abs(r.last_rank - r.rank)
      })),
      requests: recent,
      lounge,
      stats: stats[0],
      platforms: byPlatform,
      cities,
      cup,
      vote: round[0] || null,
      myVote: myVote[0]?.song_id || null,
      subscriptions: subs.map(s => s.song_id)
    });
  } catch (err) {
    json(res, 500, { ok: false, error: 'state_failed', detail: String(err.message || err) });
  }
}
