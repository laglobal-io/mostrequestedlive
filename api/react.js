import { sql, json, allowCors, readBody, ipHash } from './_lib.js';

/** POST { id, action: 'like'|'boost', on: true|false } */
export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' });
  try {
    const { id, action, on = true } = await readBody(req);
    const rid = parseInt(id, 10);
    if (!rid || !['like', 'boost'].includes(action)) return json(res, 400, { ok: false, error: 'bad_input' });
    const d = on ? 1 : -1;
    const row = action === 'like'
      ? await sql`update requests set likes  = greatest(0, likes  + ${d}) where id = ${rid} returning likes, boosts`
      : await sql`update requests set boosts = greatest(0, boosts + ${d}) where id = ${rid} returning likes, boosts`;
    if (!row.length) return json(res, 404, { ok: false, error: 'not_found' });
    return json(res, 200, { ok: true, ...row[0] });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'react_failed', detail: String(err.message || err) });
  }
}
