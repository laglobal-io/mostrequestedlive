/* End-to-end exercise of every API handler against a real Postgres.
   Run: DATABASE_URL=... STUDIO_KEY=... INGEST_KEY=... node test/run.mjs      */
import http from 'node:http';

const handlers = {
  '/api/state': (await import('../api/state.js')).default,
  '/api/requests': (await import('../api/requests.js')).default,
  '/api/react': (await import('../api/react.js')).default,
  '/api/lounge': (await import('../api/lounge.js')).default,
  '/api/vote': (await import('../api/vote.js')).default,
  '/api/subscribe': (await import('../api/subscribe.js')).default,
  '/api/studio': (await import('../api/studio.js')).default,
  '/api/ingest': (await import('../api/ingest.js')).default,
  '/api/archive': (await import('../api/archive.js')).default,
  '/api/city': (await import('../api/city.js')).default,
  '/api/health': (await import('../api/health.js')).default
};

/* Minimal Vercel-style req/res around the handlers. */
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const fn = handlers[u.pathname];
  if (!fn) { res.statusCode = 404; return res.end('no route'); }
  req.query = Object.fromEntries(u.searchParams);
  res.status = c => { res.statusCode = c; return res; };
  res.send = b => { res.end(b); return res; };
  try { await fn(req, res); }
  catch (e) { res.statusCode = 500; res.end(JSON.stringify({ ok: false, crash: String(e.stack || e) })); }
});

await new Promise(r => server.listen(7777, r));
const BASE = 'http://127.0.0.1:7777';
const KEY = process.env.STUDIO_KEY;

let pass = 0, fail = 0;
function check(name, cond, extra = '') {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.log(`  ✗ ${name} ${extra}`); }
}
const get = (p) => fetch(BASE + p).then(r => r.json());
const post = (p, body, key) => fetch(BASE + p, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...(key ? { 'x-mrl-key': key } : {}) },
  body: JSON.stringify(body)
}).then(r => r.json());

console.log('\n── health ──');
const h = await get('/api/health');
check('health reports db connected', h.db === true, JSON.stringify(h.error || ''));
check('all tables present', h.ok === true, JSON.stringify(h.tables));

console.log('\n── state ──');
let s = await get('/api/state?client=c_test');
check('state responds ok', s.ok === true, s.detail || '');
check('chart has rows', s.chart?.length > 0, `got ${s.chart?.length}`);
check('chart is ranked 1..n', s.chart?.[0]?.rank === 1);
check('ranks are sequential', s.chart.every((r, i) => r.rank === i + 1));
const fanRows = s.chart.filter(r => !r.crew_pick);
check('fan-requested rows descend by count',
  fanRows.every((r, i) => i === 0 || fanRows[i - 1].requests >= r.requests));
check('rundown present', s.rundown?.length > 0);
check('stats computed', typeof s.stats?.week_requests === 'number');
check('platform groups built', Object.keys(s.platforms || {}).length > 0);
check('cities present', s.cities?.length > 0);
check('cup present', s.cup?.length > 0);

console.log('\n── a listener posts a request ──');
const r1 = await post('/api/requests', {
  text: 'Golden by HUNTR/X', name: 'Michael', city: 'Philadelphia, PA', kind: 'request'
});
check('request accepted', r1.ok === true, r1.detail || r1.error || '');
check('song resolved from free text', !!r1.song_id);
check('tag + mention appended server-side',
  /#MostRequestedLive/.test(r1.text) && /@onairromeo/.test(r1.text), r1.text);
check('auto-queued into tonight\'s rundown', !!r1.queued);

console.log('\n── dedication with a ribbon ──');
const r2 = await post('/api/requests', {
  text: 'Abracadabra by Lady Gaga', name: 'Dana', city: 'Austin, TX',
  kind: 'dedication', ribbon: 'Dedication for Sam'
});
check('dedication accepted', r2.ok === true);

console.log('\n── likes and boosts ──');
const like = await post('/api/react', { id: r1.id, action: 'like', on: true });
check('like increments', like.ok && like.likes === 1, JSON.stringify(like));
const boost = await post('/api/react', { id: r1.id, action: 'boost', on: true });
check('boost increments', boost.ok && boost.boosts === 1, JSON.stringify(boost));
const unlike = await post('/api/react', { id: r1.id, action: 'like', on: false });
check('un-like decrements', unlike.ok && unlike.likes === 0);
const floor = await post('/api/react', { id: r1.id, action: 'like', on: false });
check('likes never go negative', floor.likes === 0);

console.log('\n── notify-me subscription ──');
const sub = await post('/api/subscribe', { song_id: r1.song_id, client: 'c_test', on: true });
check('subscribe ok', sub.ok === true);
s = await get('/api/state?client=c_test');
check('state reports my subscription', s.subscriptions?.includes(r1.song_id));

console.log('\n── the lounge ──');
const lm = await post('/api/lounge', { body: 'first post from the test', name: 'tester' });
check('lounge post accepted', lm.ok === true, lm.detail || '');
const lg = await get('/api/lounge?since=0');
check('lounge returns messages', lg.messages?.length > 0);
const sinceId = lm.message.id;
const lg2 = await get('/api/lounge?since=' + sinceId);
check('since= returns only newer', (lg2.messages || []).every(m => m.id > sinceId));

console.log('\n── studio auth ──');
const bad = await post('/api/studio', { action: 'auth' }, 'wrong-key-wrong-key');
check('wrong key rejected', bad.ok !== true);
const noKey = await post('/api/studio', { action: 'auth' });
check('missing key rejected', noKey.ok !== true);
const good = await post('/api/studio', { action: 'auth' }, KEY);
check('correct key accepted', good.ok === true);

console.log('\n── producer drives the show ──');
const q = await post('/api/studio', { action: 'queue', title: 'Golden', artist: 'HUNTR/X', requested_by: 'test' }, KEY);
check('queue adds to rundown', q.ok === true, q.detail || '');
const stBefore = await get('/api/state');
const playingBefore = stBefore.rundown.find(r => r.status === 'playing');
const queuedBefore = stBefore.rundown.filter(r => r.status === 'queued').length;
const adv = await post('/api/studio', { action: 'advance' }, KEY);
check('advance works', adv.ok === true, adv.detail || '');
const stAfter = await get('/api/state');
const playingAfter = stAfter.rundown.find(r => r.status === 'playing');
check('playhead moved to the next rundown row', playingBefore?.id !== playingAfter?.id,
  `row ${playingBefore?.id} -> ${playingAfter?.id}`);
check('the song that was playing is now aired',
  stAfter.rundown.find(r => r.id === playingBefore?.id)?.status === 'aired');
check('queue shrank by one', stAfter.rundown.filter(r => r.status === 'queued').length === queuedBefore - 1);
check('previous song marked aired',
  (await get('/api/state')).rundown.some(r => r.status === 'aired'));

console.log('\n── archive fills from what aired ──');
const arc = await get('/api/archive');
check('archive has aired songs', arc.rows?.length > 0, `got ${arc.rows?.length}`);
const arcq = await get('/api/archive?q=' + encodeURIComponent(arc.rows[0].title.slice(0, 4)));
check('archive search filters', arcq.ok && arcq.rows.length > 0);
const arcnone = await get('/api/archive?q=zzzznotathing');
check('archive search can return empty', arcnone.ok && arcnone.rows.length === 0);

console.log('\n── voting ──');
const vr = await post('/api/studio', {
  action: 'round', a_title: 'Ordinary', a_artist: 'Alex Warren',
  b_title: 'Touch', b_artist: 'KATSEYE', minutes: 5
}, KEY);
check('round opens', vr.ok === true, vr.detail || '');
s = await get('/api/state?client=voter1');
check('state exposes open round', !!s.vote);
const v1 = await post('/api/vote', { round_id: s.vote.id, song_id: s.vote.a_id, client: 'voter1' });
check('vote accepted', v1.ok === true, v1.detail || '');
await post('/api/vote', { round_id: s.vote.id, song_id: s.vote.b_id, client: 'voter1' });
const s2 = await get('/api/state?client=voter1');
check('changing vote does not double-count',
  (s2.vote.a_votes + s2.vote.b_votes) === 1, `${s2.vote.a_votes}+${s2.vote.b_votes}`);
check('state reports my current pick', s2.myVote === s2.vote.b_id);
const res = await post('/api/studio', { action: 'resolve' }, KEY);
check('resolve closes round and queues winner', res.ok === true);
const s3 = await get('/api/state');
check('no round open after resolve', !s3.vote);

console.log('\n── social ingest: the tag rule is enforced ──');
const ing = await post('/api/ingest', {
  posts: [
    { text: 'Espresso by Sabrina Carpenter #MostRequestedLive @onairromeo', author: 'fan1', city: 'Manila, PH', source: 'tiktok' },
    { text: 'Water by Tyla #MostRequestedLive', author: 'fan2', source: 'x' },
    { text: 'Houdini by Dua Lipa @onairromeo', author: 'fan3', source: 'instagram' },
    { text: 'luther by Kendrick Lamar #mostrequestedlive @ONAIRROMEO', author: 'fan4', city: 'Seoul, KR', source: 'youtube' }
  ]
}, process.env.INGEST_KEY);
check('ingest ok', ing.ok === true, ing.detail || '');
check('accepts posts with both tag and mention', ing.accepted === 2, `accepted ${ing.accepted}`);
check('drops posts missing one', ing.dropped === 2, `dropped ${ing.dropped}`);
check('drop reasons reported', !!ing.reasons.missing_mention && !!ing.reasons.missing_tag, JSON.stringify(ing.reasons));
const ingBad = await post('/api/ingest', { posts: [] }, 'nope');
check('ingest rejects a bad key', ingBad.ok !== true);

console.log('\n── per-city ──');
const city = await get('/api/city?city=' + encodeURIComponent('Manila, PH'));
check('city endpoint ok', city.ok === true, city.detail || '');
check('city returns top songs', city.top?.length > 0);

console.log('\n── crew reply + chart tools ──');
const rep = await post('/api/studio', { action: 'reply', request_id: r1.id, text: 'Locked for hour 3.' }, KEY);
check('crew reply saved', rep.ok === true);
s = await get('/api/state');
check('reply visible on the wall', s.requests.some(x => x.crew_reply === 'Locked for hour 3.'));
const snap = await post('/api/studio', { action: 'snapshot' }, KEY);
check('chart snapshot ok', snap.ok === true, snap.detail || '');
const cp = await post('/api/studio', { action: 'crewpick', title: 'Water', artist: 'Tyla', weight: 500 }, KEY);
check('crew pick ok', cp.ok === true);
s = await get('/api/state');
const waterRow = s.chart.find(r => r.title === 'Water');
check('crew pick flagged on the chart', waterRow?.crew_pick === true);
check('crew pick weight lifts its rank', waterRow?.rank <= 3, `rank ${waterRow?.rank}`);

console.log('\n── validation ──');
check('empty request rejected', (await post('/api/requests', { text: '' })).ok !== true);
check('bad react rejected', (await post('/api/react', { id: 0, action: 'nope' })).ok !== true);
check('unknown studio action rejected', (await post('/api/studio', { action: 'explode' }, KEY)).ok !== true);
check('city requires a name', (await get('/api/city')).ok !== true);

console.log(`\n${'─'.repeat(44)}\n  ${pass} passed, ${fail} failed\n`);
server.close();
process.exit(fail ? 1 : 0);
