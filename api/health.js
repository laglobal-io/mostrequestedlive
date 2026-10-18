import { sql, json, allowCors } from './_lib.js';

export default async function handler(req, res) {
  if (allowCors(req, res)) return;
  const out = { ok: false, db: false, tables: {}, env: {} };
  out.env.DATABASE_URL = !!process.env.DATABASE_URL;
  out.env.STUDIO_KEY = !!process.env.STUDIO_KEY;
  out.env.INGEST_KEY = !!process.env.INGEST_KEY;
  try {
    const t = await sql`select now() as now`;
    out.db = true; out.now = t[0].now;
    for (const name of ['songs', 'requests', 'rundown', 'lounge_messages', 'vote_rounds']) {
      try {
        const r = await sql(`select count(*)::int as n from ${name}`);
        out.tables[name] = r[0].n;
      } catch { out.tables[name] = 'missing'; }
    }
    out.ok = Object.values(out.tables).every(v => v !== 'missing');
    if (!out.ok) out.hint = 'Run db/schema.sql against your database.';
  } catch (err) {
    out.error = String(err.message || err);
    out.hint = 'Check DATABASE_URL is set in Vercel project settings.';
  }
  return json(res, out.ok ? 200 : 503, out);
}
