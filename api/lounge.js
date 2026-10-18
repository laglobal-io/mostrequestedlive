import { sql, json, allowCors, readBody, ipHash, clean } from './_lib.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;

  if (req.method === 'GET') {
    const since = parseInt(req.query.since || '0', 10) || 0;
    const rows = await sql`
      select id, name, body, is_crew, is_system, created_at
      from lounge_messages where id > ${since} order by id asc limit 80`;
    return json(res, 200, { ok: true, messages: rows });
  }

  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' });

  try {
    const b = await readBody(req);
    const body = clean(b.body, 200);
    const name = clean(b.name, 40) || 'listener';
    if (!body) return json(res, 400, { ok: false, error: 'empty' });

    const hash = ipHash(req);
    const recent = await sql`
      select count(*)::int as n from lounge_messages
      where ip_hash = ${hash} and created_at > now() - interval '20 seconds'`;
    if (recent[0].n >= 4) return json(res, 429, { ok: false, error: 'slow_down' });

    const row = await sql`
      insert into lounge_messages (name, body, ip_hash)
      values (${name}, ${body}, ${hash})
      returning id, name, body, is_crew, is_system, created_at`;
    return json(res, 200, { ok: true, message: row[0] });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'lounge_failed', detail: String(err.message || err) });
  }
}
