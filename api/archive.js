import { sql, json, allowCors } from './_lib.js';

/** GET /api/archive?q=&limit= — everything that has actually aired. */
export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  const q = (req.query.q || '').trim().slice(0, 80);
  const limit = Math.min(200, parseInt(req.query.limit || '40', 10) || 40);
  try {
    const rows = q
      ? await sql`
          select r.aired_at, r.hour_label, r.requested_by, s.title, s.artist
          from rundown r join songs s on s.id = r.song_id
          where r.status = 'aired'
            and (s.title ilike ${'%' + q + '%'} or s.artist ilike ${'%' + q + '%'}
                 or coalesce(r.requested_by,'') ilike ${'%' + q + '%'}
                 or to_char(r.aired_at, 'Mon DD YYYY') ilike ${'%' + q + '%'})
          order by r.aired_at desc nulls last limit ${limit}`
      : await sql`
          select r.aired_at, r.hour_label, r.requested_by, s.title, s.artist
          from rundown r join songs s on s.id = r.song_id
          where r.status = 'aired'
          order by r.aired_at desc nulls last limit ${limit}`;
    return json(res, 200, { ok: true, rows });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'archive_failed', detail: String(err.message || err) });
  }
}
