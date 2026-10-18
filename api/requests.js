import { sql, json, allowCors, readBody, ipHash, clean, parseSong, resolveSong, throttled } from './_lib.js';

const TAG = '#MostRequestedLive';
const MENTION = '@onairromeo';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    const rows = await sql`
      select rq.id, rq.raw_text, rq.name, rq.city, rq.kind, rq.source, rq.ribbon,
             rq.likes, rq.boosts, rq.crew_reply, rq.created_at, s.title, s.artist
      from requests rq left join songs s on s.id = rq.song_id
      where rq.status = 'approved' order by rq.id desc limit 50`;
    return json(res, 200, { ok: true, requests: rows });
  }

  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' });

  try {
    const body = await readBody(req);
    const text = clean(body.text, 280);
    if (!text) return json(res, 400, { ok: false, error: 'empty' });

    const hash = ipHash(req);
    if (await throttled(hash)) return json(res, 429, { ok: false, error: 'slow_down' });

    const kind = ['request', 'question', 'dedication', 'shoutout', 'birthday'].includes(body.kind) ? body.kind : 'request';
    const name = clean(body.name, 60) || 'Anonymous';
    const city = clean(body.city, 60);
    const ribbon = clean(body.ribbon, 60);

    // Tag + mention are appended server-side so a web request counts the
    // same as one that came in from social.
    const stored = `${text} ${TAG} ${MENTION}`;

    const { title, artist } = parseSong(text);
    const songId = kind === 'question' ? null : await resolveSong(title, artist);

    const ins = await sql`
      insert into requests (song_id, raw_text, name, city, kind, source, ribbon, ip_hash, status)
      values (${songId}, ${stored}, ${name}, ${city}, ${kind}, 'web', ${ribbon}, ${hash}, 'approved')
      returning id, created_at`;

    // Put it in tonight's rundown as a queued slot, after whatever is playing.
    let queued = null;
    if (songId) {
      const pos = await sql`
        select coalesce(max(position), 0) + 1 as p from rundown where show_date = current_date`;
      const r = await sql`
        insert into rundown (show_date, position, song_id, request_id, requested_by, status)
        values (current_date, ${pos[0].p}, ${songId}, ${ins[0].id}, ${name + (city ? ', ' + city : '')}, 'queued')
        on conflict do nothing
        returning id, position`;
      queued = r[0] || null;
    }

    return json(res, 200, {
      ok: true,
      id: ins[0].id,
      song_id: songId,
      queued,
      text: stored,
      note: 'Counted. Tag and mention were added automatically.'
    });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'create_failed', detail: String(err.message || err) });
  }
}
