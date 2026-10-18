import { sql, json, allowCors, readBody } from './_lib.js';

/** POST { song_id, client, on } — "ping me when this airs". */
export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' });
  try {
    const { song_id, client, on = true } = await readBody(req);
    const sid = parseInt(song_id, 10);
    const cid = String(client || '').slice(0, 64);
    if (!sid || !cid) return json(res, 400, { ok: false, error: 'bad_input' });
    if (on) {
      await sql`insert into subscriptions (song_id, client_id) values (${sid}, ${cid}) on conflict do nothing`;
    } else {
      await sql`delete from subscriptions where song_id = ${sid} and client_id = ${cid}`;
    }
    return json(res, 200, { ok: true, on: !!on });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'subscribe_failed', detail: String(err.message || err) });
  }
}
