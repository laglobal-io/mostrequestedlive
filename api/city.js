import { sql, json, allowCors } from './_lib.js';

/** GET /api/city?city=Manila,%20PH — top songs plus an 8-week trend for that city. */
export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  const city = (req.query.city || '').trim().slice(0, 60);
  if (!city) return json(res, 400, { ok: false, error: 'need_city' });
  try {
    const top = await sql`
      select s.id as song_id, s.title, s.artist, count(*)::int as n
      from requests r join songs s on s.id = r.song_id
      where r.city = ${city} and r.created_at > now() - interval '7 days'
      group by s.id, s.title, s.artist
      order by n desc limit 5`;

    const ids = top.map(t => t.song_id);
    const trend = ids.length ? await sql`
      select s.id as song_id, s.title,
             date_trunc('week', r.created_at)::date as week,
             count(*)::int as n
      from requests r join songs s on s.id = r.song_id
      where r.city = ${city}
        and r.song_id = any(${ids})
        and r.created_at > now() - interval '8 weeks'
      group by s.id, s.title, week
      order by week` : [];

    return json(res, 200, { ok: true, city, top, trend });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'city_failed', detail: String(err.message || err) });
  }
}
