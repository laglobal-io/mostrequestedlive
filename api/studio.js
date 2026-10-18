import { sql, json, allowCors, readBody, requireKey, clean, resolveSong } from './_lib.js';

/**
 * The producer's control surface. Every live thing on the site is driven from here.
 * All calls need the X-MRL-Key header matching STUDIO_KEY.
 *
 * POST { action: ... }
 *   auth                                  – check the key is valid
 *   queue   { title, artist, requested_by } – add a song to tonight's rundown
 *   play    { id }                        – mark a rundown row as on air (airs whatever was playing)
 *   advance                               – air the current song, start the next one
 *   remove  { id }                        – drop a queued row
 *   reorder { id, position }              – move a queued row
 *   reply   { request_id, text }          – crew reply on a request
 *   status  { request_id, status }        – approve / reject a request
 *   crew    { body }                      – post into the Lounge as crew
 *   round   { a_title, a_artist, b_title, b_artist, minutes } – open a what's-next vote
 *   resolve                               – close the open vote, winner goes to the rundown
 *   snapshot                              – freeze this week's chart so movement arrows work
 *   crewpick{ title, artist, weight }     – weight a song onto the chart
 */
export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' });
  if (!requireKey(req, 'STUDIO_KEY')) return json(res, 401, { ok: false, error: 'unauthorized' });

  try {
    const b = await readBody(req);
    const action = b.action;

    switch (action) {
      case 'auth':
        return json(res, 200, { ok: true });

      case 'queue': {
        const songId = await resolveSong(clean(b.title, 120), clean(b.artist, 120));
        if (!songId) return json(res, 400, { ok: false, error: 'need_title' });
        const p = await sql`select coalesce(max(position),0)+1 as p from rundown where show_date = current_date`;
        const r = await sql`
          insert into rundown (show_date, position, song_id, requested_by, hour_label, status)
          values (current_date, ${p[0].p}, ${songId}, ${clean(b.requested_by, 80)}, ${clean(b.hour_label, 20)}, 'queued')
          returning id, position`;
        return json(res, 200, { ok: true, row: r[0] });
      }

      case 'play': {
        const id = parseInt(b.id, 10);
        if (!id) return json(res, 400, { ok: false, error: 'bad_id' });
        await sql`update rundown set status='aired', aired_at=now()
                  where show_date=current_date and status='playing'`;
        const r = await sql`update rundown set status='playing', aired_at=now()
                            where id=${id} returning id, song_id, position`;
        if (!r.length) return json(res, 404, { ok: false, error: 'not_found' });
        await announce(r[0].song_id);
        return json(res, 200, { ok: true, now: r[0] });
      }

      case 'advance': {
        const cur = await sql`
          select id, position from rundown
          where show_date=current_date and status='playing' order by position limit 1`;
        if (cur.length) {
          await sql`update rundown set status='aired', aired_at=now() where id=${cur[0].id}`;
        }
        const next = await sql`
          select id, song_id from rundown
          where show_date=current_date and status='queued'
          order by position limit 1`;
        if (!next.length) return json(res, 200, { ok: true, now: null, note: 'end of rundown' });
        await sql`update rundown set status='playing', aired_at=now() where id=${next[0].id}`;
        await announce(next[0].song_id);
        return json(res, 200, { ok: true, now: next[0] });
      }

      case 'remove':
        await sql`delete from rundown where id=${parseInt(b.id, 10)} and status='queued'`;
        return json(res, 200, { ok: true });

      case 'reorder': {
        const id = parseInt(b.id, 10), pos = parseInt(b.position, 10);
        if (!id || !pos) return json(res, 400, { ok: false, error: 'bad_input' });
        await sql`update rundown set position = position + 1
                  where show_date=current_date and position >= ${pos} and id <> ${id}`;
        await sql`update rundown set position = ${pos} where id = ${id}`;
        return json(res, 200, { ok: true });
      }

      case 'reply': {
        const rid = parseInt(b.request_id, 10);
        const text = clean(b.text, 240);
        if (!rid || !text) return json(res, 400, { ok: false, error: 'bad_input' });
        await sql`update requests set crew_reply = ${text} where id = ${rid}`;
        return json(res, 200, { ok: true });
      }

      case 'status': {
        const rid = parseInt(b.request_id, 10);
        const st = ['pending', 'approved', 'rejected'].includes(b.status) ? b.status : null;
        if (!rid || !st) return json(res, 400, { ok: false, error: 'bad_input' });
        await sql`update requests set status = ${st} where id = ${rid}`;
        return json(res, 200, { ok: true });
      }

      case 'crew': {
        const body = clean(b.body, 200);
        if (!body) return json(res, 400, { ok: false, error: 'empty' });
        const r = await sql`
          insert into lounge_messages (name, body, is_crew)
          values (${clean(b.name, 40) || 'Romeo'}, ${body}, true) returning id`;
        return json(res, 200, { ok: true, id: r[0].id });
      }

      case 'round': {
        const a = await resolveSong(clean(b.a_title, 120), clean(b.a_artist, 120));
        const c = await resolveSong(clean(b.b_title, 120), clean(b.b_artist, 120));
        if (!a || !c) return json(res, 400, { ok: false, error: 'need_two_songs' });
        const mins = Math.min(60, Math.max(1, parseInt(b.minutes, 10) || 5));
        await sql`update vote_rounds set resolved = true where resolved = false`;
        const r = await sql`
          insert into vote_rounds (song_a, song_b, closes_at)
          values (${a}, ${c}, now() + make_interval(mins => ${mins}))
          returning id, closes_at`;
        return json(res, 200, { ok: true, round: r[0] });
      }

      case 'resolve': {
        const open = await sql`
          select id, song_a, song_b from vote_rounds
          where resolved = false order by id desc limit 1`;
        if (!open.length) return json(res, 200, { ok: true, note: 'no open round' });
        const t = await sql`
          select song_id, count(*)::int as n from votes where round_id = ${open[0].id} group by song_id`;
        const tally = Object.fromEntries(t.map(r => [r.song_id, r.n]));
        const winner = (tally[open[0].song_a] || 0) >= (tally[open[0].song_b] || 0) ? open[0].song_a : open[0].song_b;
        await sql`update vote_rounds set resolved = true, winner_id = ${winner} where id = ${open[0].id}`;
        const p = await sql`select coalesce(max(position),0)+1 as p from rundown where show_date = current_date`;
        await sql`
          insert into rundown (show_date, position, song_id, requested_by, status)
          values (current_date, ${p[0].p}, ${winner}, 'voted in by listeners', 'queued')`;
        return json(res, 200, { ok: true, winner });
      }

      case 'snapshot': {
        await sql`
          insert into chart_history (week_start, song_id, rank, request_count)
          select date_trunc('week', now())::date, song_id, rank, n from (
            select song_id, count(*)::int as n,
                   row_number() over (order by count(*) desc, song_id) as rank
            from requests
            where created_at > now() - interval '7 days' and status='approved' and song_id is not null
            group by song_id
          ) t where rank <= 40
          on conflict (week_start, song_id) do update
            set rank = excluded.rank, request_count = excluded.request_count`;
        return json(res, 200, { ok: true });
      }

      case 'crewpick': {
        const songId = await resolveSong(clean(b.title, 120), clean(b.artist, 120));
        if (!songId) return json(res, 400, { ok: false, error: 'need_title' });
        const w = Math.max(0, Math.min(10000, parseInt(b.weight, 10) || 0));
        await sql`
          insert into crew_picks (song_id, weight) values (${songId}, ${w})
          on conflict (song_id) do update set weight = excluded.weight`;
        return json(res, 200, { ok: true });
      }

      default:
        return json(res, 400, { ok: false, error: 'unknown_action' });
    }
  } catch (err) {
    return json(res, 500, { ok: false, error: 'studio_failed', detail: String(err.message || err) });
  }
}

/** Drop a system line into the Lounge and mark subscribers as notified. */
async function announce(songId) {
  if (!songId) return;
  const s = await sql`select title, artist from songs where id = ${songId}`;
  if (s.length) {
    await sql`
      insert into lounge_messages (name, body, is_system)
      values ('on air', ${s[0].title + ' — ' + s[0].artist + ' is on air now'}, true)`;
  }
  await sql`update subscriptions set notified_at = now() where song_id = ${songId}`;
}
