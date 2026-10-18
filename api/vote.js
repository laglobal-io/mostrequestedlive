import { sql, json, allowCors, readBody } from './_lib.js';

/** POST { round_id, song_id, client } — one vote per client per round, changeable. */
export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' });
  try {
    const { round_id, song_id, client } = await readBody(req);
    const rid = parseInt(round_id, 10), sid = parseInt(song_id, 10);
    const cid = String(client || '').slice(0, 64);
    if (!rid || !sid || !cid) return json(res, 400, { ok: false, error: 'bad_input' });

    const round = await sql`
      select id from vote_rounds where id = ${rid} and resolved = false and closes_at > now()`;
    if (!round.length) return json(res, 409, { ok: false, error: 'round_closed' });

    await sql`
      insert into votes (round_id, song_id, client_id) values (${rid}, ${sid}, ${cid})
      on conflict (round_id, client_id) do update set song_id = excluded.song_id`;

    const tally = await sql`
      select song_id, count(*)::int as n from votes where round_id = ${rid} group by song_id`;
    return json(res, 200, { ok: true, tally });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'vote_failed', detail: String(err.message || err) });
  }
}
