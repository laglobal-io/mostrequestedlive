import { sql, json, allowCors, readBody, requireKey, clean, parseSong, resolveSong } from './_lib.js';

const TAG = /#mostrequestedlive/i;
const MENTION = /@onairromeo/i;

/**
 * Social-listening intake. Your worker (X polling, YouTube comments,
 * Instagram mention webhooks, or a vendor feed) POSTs normalised posts here.
 *
 * POST { posts: [ { text, author, city, source, external_id, created_at } ] }
 * Header: X-MRL-Key: $INGEST_KEY
 *
 * Posts missing either the hashtag or the mention are rejected and counted,
 * which is what feeds the "dropped, missing tag" number on the site.
 */
export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method' });
  if (!requireKey(req, 'INGEST_KEY')) return json(res, 401, { ok: false, error: 'unauthorized' });

  try {
    const body = await readBody(req);
    const posts = Array.isArray(body.posts) ? body.posts.slice(0, 500) : [];
    let accepted = 0, dropped = 0;
    const reasons = {};

    for (const p of posts) {
      const text = clean(p.text, 280);
      if (!text) { dropped++; reasons.empty = (reasons.empty || 0) + 1; continue; }
      if (!TAG.test(text))     { dropped++; reasons.missing_tag = (reasons.missing_tag || 0) + 1; continue; }
      if (!MENTION.test(text)) { dropped++; reasons.missing_mention = (reasons.missing_mention || 0) + 1; continue; }

      const source = ['tiktok', 'instagram', 'x', 'youtube', 'phone', 'sms'].includes(p.source) ? p.source : 'x';
      const { title, artist } = parseSong(text);
      const songId = await resolveSong(title, artist);
      if (!songId) { dropped++; reasons.unresolved = (reasons.unresolved || 0) + 1; continue; }

      await sql`
        insert into requests (song_id, raw_text, name, city, source, status, created_at)
        values (${songId}, ${text}, ${clean(p.author, 60)}, ${clean(p.city, 60)},
                ${source}, 'approved', ${p.created_at ? new Date(p.created_at) : new Date()})`;
      accepted++;
    }

    return json(res, 200, { ok: true, accepted, dropped, reasons });
  } catch (err) {
    return json(res, 500, { ok: false, error: 'ingest_failed', detail: String(err.message || err) });
  }
}
