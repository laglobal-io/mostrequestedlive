import pg from 'pg';
import crypto from 'node:crypto';

/* One pooled client per warm lambda. Works with Neon, Supabase, Vercel
   Postgres, RDS or a plain Postgres — anything with a connection string. */
const { Pool } = pg;
let pool;
function getPool() {
  if (!pool) {
    const cs = process.env.DATABASE_URL;
    if (!cs) throw new Error('DATABASE_URL is not set');
    pool = new Pool({
      connectionString: cs,
      max: 1,
      idleTimeoutMillis: 10_000,
      connectionTimeoutMillis: 8_000,
      ssl: /localhost|127\.0\.0\.1/.test(cs) ? false : { rejectUnauthorized: false }
    });
  }
  return pool;
}

/** Tagged template → parameterised query. sql`select * from t where id = ${id}` */
export async function sql(strings, ...values) {
  if (typeof strings === 'string') {
    const r = await getPool().query(strings);
    return r.rows;
  }
  const text = strings.reduce((acc, s, i) => acc + s + (i < values.length ? '$' + (i + 1) : ''), '');
  const r = await getPool().query(text, values);
  return r.rows;
}

export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).send(JSON.stringify(body));
}

export function ipHash(req) {
  const ip =
    (req.headers['x-forwarded-for'] || '').split(',')[0].trim() ||
    req.socket?.remoteAddress ||
    'unknown';
  return crypto.createHash('sha256').update(ip + (process.env.STUDIO_KEY || 'salt')).digest('hex').slice(0, 32);
}

export function clean(v, max = 280) {
  if (typeof v !== 'string') return null;
  const s = v.replace(/\s+/g, ' ').trim().slice(0, max);
  return s.length ? s : null;
}

/** Pull "Song — Artist" / "Song by Artist" out of free text. */
export function parseSong(text) {
  if (!text) return { title: null, artist: null };
  let t = text
    .replace(/#MostRequestedLive/gi, '')
    .replace(/@onairromeo/gi, '')
    .replace(/^\s*(can you |pls |please |requesting |request |play )+/i, '')
    .trim();
  let m = t.match(/^(.+?)\s+(?:—|–|-|by)\s+(.+)$/i);
  if (m) return { title: clean(m[1], 120), artist: clean(m[2], 120) };
  return { title: clean(t, 120), artist: null };
}

/** Find or create a song row. Fuzzy-matches on title when no artist is given. */
export async function resolveSong(title, artist) {
  if (!title) return null;
  if (artist) {
    const hit = await sql`
      select id from songs
      where lower(title) = lower(${title}) and lower(artist) = lower(${artist}) limit 1`;
    if (hit.length) return hit[0].id;
    const ins = await sql`
      insert into songs (title, artist) values (${title}, ${artist})
      on conflict do nothing returning id`;
    if (ins.length) return ins[0].id;
    const again = await sql`
      select id from songs
      where lower(title) = lower(${title}) and lower(artist) = lower(${artist}) limit 1`;
    return again.length ? again[0].id : null;
  }
  // No artist supplied — match an existing title before creating a duplicate.
  const loose = await sql`
    select id from songs where lower(title) = lower(${title}) order by id limit 1`;
  if (loose.length) return loose[0].id;
  const like = await sql`
    select id from songs where lower(title) like ${'%' + title.toLowerCase() + '%'} order by id limit 1`;
  if (like.length) return like[0].id;
  const ins = await sql`
    insert into songs (title, artist) values (${title}, ${'Unknown'})
    on conflict do nothing returning id`;
  return ins.length ? ins[0].id : null;
}

export function requireKey(req, envName) {
  const want = process.env[envName];
  if (!want) return false;
  const got =
    req.headers['x-mrl-key'] ||
    (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!got || got.length !== want.length) return false;
  return crypto.timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

export function allowCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-MRL-Key, Authorization');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  return false;
}

export async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

/** Simple DB-backed throttle: max N writes per ip per window. */
export async function throttled(hash, maxPerMinute = 8) {
  const r = await sql`
    select count(*)::int as n from requests
    where ip_hash = ${hash} and created_at > now() - interval '1 minute'`;
  return r[0].n >= maxPerMinute;
}
