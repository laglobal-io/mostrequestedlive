/* Most Requested Live — live client.
   Everything on this page reads from /api/state, which the producer drives from /studio. */
const RM = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = i => document.getElementById(i);

const CLIENT = (() => {
  let k = null;
  try { k = localStorage.getItem('mrl_client'); } catch (e) {}
  if (!k) { k = 'c_' + Math.random().toString(36).slice(2) + Date.now().toString(36); try { localStorage.setItem('mrl_client', k); } catch (e) {} }
  return k;
})();

const api = {
  async get(path) {
    const r = await fetch(path, { headers: { accept: 'application/json' } });
    if (!r.ok) throw new Error(path + ' ' + r.status);
    return r.json();
  },
  async post(path, body) {
    const r = await fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    return r.json().catch(() => ({ ok: false }));
  }
};

/* ---------- toast ---------- */
const toastEl = document.createElement('div');
toastEl.className = 'toast';
document.body.appendChild(toastEl);
let tTimer;
function toast(m) {
  toastEl.textContent = m;
  toastEl.classList.add('show');
  clearTimeout(tTimer);
  tTimer = setTimeout(() => toastEl.classList.remove('show'), 2800);
}

/* ---------- connection banner ---------- */
const conn = document.createElement('div');
conn.className = 'connbar';
conn.innerHTML = '<b>Not connected to the database.</b> <span id="connmsg">Checking…</span>';
document.body.prepend(conn);
function setConn(state, msg) {
  conn.classList.toggle('show', state !== 'ok');
  if (msg) conn.querySelector('#connmsg').textContent = msg;
}

/* =======================================================================
   LIVE STATE
   ======================================================================= */
let STATE = null;
let loungeSince = 0;
let seenRequestId = 0;
let subs = new Set();
let failures = 0;

async function poll() {
  try {
    const s = await api.get(`/api/state?since=${loungeSince}&client=${encodeURIComponent(CLIENT)}`);
    if (!s.ok) throw new Error(s.error || 'bad state');
    failures = 0; setConn('ok');
    applyState(s);
  } catch (err) {
    failures++;
    if (failures === 1) {
      try {
        const h = await api.get('/api/health');
        setConn('bad', h.hint || h.error || 'API unreachable.');
      } catch { setConn('bad', 'API unreachable — is DATABASE_URL set?'); }
    }
  } finally {
    setTimeout(poll, failures ? 8000 : 4000);
  }
}

function applyState(s) {
  const first = !STATE;
  STATE = s;
  subs = new Set(s.subscriptions || []);
  drawChart(s.chart);
  drawRundown(s.rundown, s.nowPlaying);
  drawWall(s.requests);
  drawPlatforms(s.platforms, s.stats);
  drawCup(s.cup);
  drawVote(s.vote, s.myVote);
  drawStats(s.stats);
  drawLeaderboard(s.requests);
  appendLounge(s.lounge);
  if (first) initCities(s.cities);
  pingFromRequests(s.requests);
  if (s.nowPlaying) {
    $('lgnow').textContent = s.nowPlaying.title + ' — ' + s.nowPlaying.artist;
  }
}

/* =======================================================================
   CHART
   ======================================================================= */
function drawChart(chart) {
  if (!chart) return;
  if (!chart.length) {
    $('chartbody').innerHTML =
      '<div style="padding:26px 16px;color:var(--dim)">No requests counted yet this week. The chart fills as requests come in.</div>';
    return;
  }
  const max = chart[0].requests || 1;
  $('chartbody').innerHTML = chart.map(r => {
    const mv = r.move === 'new' ? '<span class="new">New</span>'
      : r.move === 'up' ? `<span class="up">▲ ${r.delta}</span>`
      : r.move === 'down' ? `<span class="dn">▼ ${r.delta}</span>`
      : '<span style="color:var(--faint)">—</span>';
    const tag = r.crew_pick
      ? '<span class="src crew">Crew pick</span>'
      : '<span class="src fans">Fan-requested</span>';
    const on = subs.has(r.song_id);
    return `<div class="crow${r.rank <= 3 ? ' top' : ''}">
      <div class="rank">${r.rank}</div>
      <div class="song"><b>${esc(r.title)}</b><span>${esc(r.artist)}</span>
        <div class="bar"><i style="width:${Math.round(r.requests / max * 100)}%"></i></div>${tag}</div>
      <div class="mv">${mv}<span>${r.requests} req</span></div>
      <div class="rowbtns">
        <button class="btn sm bellc${on ? ' on' : ''}" data-song="${r.song_id}">${on ? '🔔 On' : '🔕 Ping'}</button>
        <button class="btn sm reqc" data-t="${esc(r.title)}" data-a="${esc(r.artist)}">Request</button>
      </div></div>`;
  }).join('');

  document.querySelectorAll('.reqc').forEach(b => b.addEventListener('click', function () {
    $('ctext').value = `${this.dataset.t} by ${this.dataset.a}`;
    $('zone').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' });
    $('ctext').focus();
  }));
  document.querySelectorAll('.bellc').forEach(b => b.addEventListener('click', function () {
    toggleSub(parseInt(this.dataset.song, 10), this);
  }));
}

async function toggleSub(songId, btn) {
  const on = !subs.has(songId);
  on ? subs.add(songId) : subs.delete(songId);
  if (btn) { btn.classList.toggle('on', on); btn.textContent = on ? '🔔 On' : '🔕 Ping'; }
  await api.post('/api/subscribe', { song_id: songId, client: CLIENT, on });
  toast(on ? 'We’ll ping you when it airs' : 'Ping off');
  if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
}

/* =======================================================================
   RUNDOWN  (live playhead)
   ======================================================================= */
let lastPlayingId = null;
function drawRundown(rows, now) {
  if (!rows) return;
  if (!rows.length) {
    $('plbody').innerHTML = '<div style="padding:24px 16px;color:var(--dim)">Nothing in tonight’s rundown yet. The producer builds it from the studio.</div>';
    $('plnext').textContent = '';
    return;
  }
  $('plbody').innerHTML = rows.map(r => {
    const st = r.status === 'aired' ? 'done' : r.status === 'playing' ? 'now' : '';
    const on = subs.has(r.song_id);
    const t = r.status === 'aired'
      ? (r.aired_at ? fmtTime(r.aired_at) : 'aired')
      : r.status === 'playing' ? 'NOW' : (r.hour_label || '—');
    return `<div class="pl-row ${st}">
      <span class="t">${t}</span>
      <span><b>${esc(r.title || 'TBD')}${r.status === 'playing' ? '<span class="nowpill">On air</span>' : ''}</b>
        <span class="a">${esc(r.artist || '')}</span></span>
      <span class="rq">${r.requested_by ? 'req. ' + esc(r.requested_by) : ''}</span>
      <button class="bell${on ? ' on' : ''}" data-song="${r.song_id || ''}" title="Ping me when this airs">${on ? '🔔' : '🔕'}</button>
    </div>`;
  }).join('');
  document.querySelectorAll('.bell[data-song]').forEach(b => b.addEventListener('click', function () {
    const id = parseInt(this.dataset.song, 10);
    if (!id) return;
    const on = !subs.has(id);
    on ? subs.add(id) : subs.delete(id);
    this.classList.toggle('on', on); this.textContent = on ? '🔔' : '🔕';
    api.post('/api/subscribe', { song_id: id, client: CLIENT, on });
    toast(on ? 'We’ll ping you when it airs' : 'Ping off');
    if (on && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  }));

  const q = rows.filter(r => r.status === 'queued');
  $('plnext').textContent = q.length ? 'up next ' + q[0].title : 'end of rundown';
  const n = rows.filter(r => subs.has(r.song_id) && r.status === 'queued').length;
  $('plsubs').innerHTML = n ? `<span style="color:var(--lime)">${n} song${n > 1 ? 's' : ''} will ping you</span>` : '';

  // A new song went on air.
  if (now && now.song_id !== lastPlayingId) {
    const prev = lastPlayingId;
    lastPlayingId = now.song_id;
    $('np').textContent = now.title + ' — ' + now.artist;
    if (prev !== null && subs.has(now.song_id)) notifyAired(now);
  }
}

function notifyAired(r) {
  try {
    if ('Notification' in window && Notification.permission === 'granted') {
      new Notification('Your request just aired', { body: r.title + ' — ' + r.artist });
    }
  } catch (e) {}
  toast('🔔 ' + r.title + ' is airing now');
  openCard(r.title, r.artist, 'you', fmtTime(r.aired_at || Date.now()) + ' ET');
}

/* =======================================================================
   THE ZONE — requests wall
   ======================================================================= */
const KIND = { request: 'Request', question: 'Artist Q&A', dedication: 'Dedication', shoutout: 'Shoutout', birthday: 'Birthday' };
const AVC = {
  request: 'linear-gradient(135deg,#FF2D9E,#8B3DFF)', question: 'linear-gradient(135deg,#22E0E0,#8B3DFF)',
  dedication: 'linear-gradient(135deg,#FF6BC0,#8B3DFF)', shoutout: 'linear-gradient(135deg,#9DFF3D,#22E0E0)',
  birthday: 'linear-gradient(135deg,#FF2D9E,#9DFF3D)'
};
const PC = { tiktok: '#22E0E0', instagram: '#FF6BC0', x: '#5A4780', youtube: '#FF2A1F', web: '#8B3DFF', phone: '#9DFF3D', sms: '#6B2FA8' };
let myLikes = new Set(), myBoosts = new Set();
try { myLikes = new Set(JSON.parse(localStorage.getItem('mrl_likes') || '[]')); } catch (e) {}
try { myBoosts = new Set(JSON.parse(localStorage.getItem('mrl_boosts') || '[]')); } catch (e) {}
let wallFilter = 'all';

function drawWall(rows) {
  if (!rows) return;
  let list = rows.slice();
  if (wallFilter === 'hot') list.sort((a, b) => b.boosts - a.boosts);
  else if (wallFilter === 'crew') list = list.filter(r => r.crew_reply);
  else if (wallFilter === 'social') list = list.filter(r => r.source !== 'web');
  else if (wallFilter !== 'all') list = list.filter(r => r.kind === wallFilter);

  if (!list.length) {
    $('wall').innerHTML = '<div style="padding:22px;color:var(--dim)">Nothing here yet.</div>';
    return;
  }
  const atTop = $('wall').scrollTop < 40;
  $('wall').innerHTML = list.map(r => {
    const liked = myLikes.has(r.id), boosted = myBoosts.has(r.id);
    return `<div class="post" data-id="${r.id}">
      <div class="av" style="background:${AVC[r.kind] || AVC.request}">${esc((r.name || '??').slice(0, 2).toUpperCase())}</div>
      <div class="pb">
        <div class="ph"><b>${esc(r.name || 'Anonymous')}</b>
          <span class="badge" style="background:${PC[r.source] || '#8B3DFF'};color:#fff">${r.source}</span>
          <span class="pixel">${esc(r.city || '')} · ${KIND[r.kind] || 'Request'} · ${ago(r.created_at)}</span></div>
        ${r.ribbon ? `<span class="ribbon">♥ ${esc(r.ribbon)}</span><br>` : ''}
        <p>${highlight(r.raw_text)}</p>
        ${r.crew_reply ? `<div class="reply"><b>Crew</b>: ${esc(r.crew_reply)}</div>` : ''}
        <div class="pf">
          <button class="act like${liked ? ' on' : ''}" data-a="like">♥ ${r.likes}</button>
          <button class="act boost${boosted ? ' on' : ''}" data-a="boost">⚡ Boost ${r.boosts}</button>
          <button class="act" data-a="tpl">📋 Use as template</button>
          <button class="act" data-a="share">↗ Share</button>
        </div>
      </div></div>`;
  }).join('');
  if (atTop) $('wall').scrollTop = 0;
}

$('wall').addEventListener('click', async e => {
  const btn = e.target.closest('[data-a]');
  const box = e.target.closest('.post');
  if (!btn || !box) return;
  const id = parseInt(box.dataset.id, 10);
  const row = STATE?.requests.find(r => r.id === id);
  const a = btn.dataset.a;

  if (a === 'like' || a === 'boost') {
    const set = a === 'like' ? myLikes : myBoosts;
    const on = !set.has(id);
    on ? set.add(id) : set.delete(id);
    try { localStorage.setItem(a === 'like' ? 'mrl_likes' : 'mrl_boosts', JSON.stringify([...set])); } catch (e) {}
    btn.classList.toggle('on', on);
    const r = await api.post('/api/react', { id, action: a, on });
    if (r.ok) {
      btn.textContent = a === 'like' ? `♥ ${r.likes}` : `⚡ Boost ${r.boosts}`;
      if (row) { row.likes = r.likes; row.boosts = r.boosts; }
    }
    if (a === 'boost' && on) toast('Boosted — it counts toward the chart');
  }
  if (a === 'tpl' && row) {
    $('ctext').value = row.raw_text.replace(/#MostRequestedLive/gi, '').replace(/@onairromeo/gi, '').trim();
    $('ctext').focus();
  }
  if (a === 'share' && row) openShare(row.raw_text);
});

document.querySelectorAll('[data-f]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('[data-f]').forEach(x => x.setAttribute('aria-selected', 'false'));
  t.setAttribute('aria-selected', 'true');
  wallFilter = t.dataset.f;
  drawWall(STATE?.requests || []);
}));

/* composer */
$('ctype').addEventListener('change', function () {
  $('cfor').style.display = this.value ? '' : 'none';
  if (this.value) $('cfor').focus();
});
$('ctpl').addEventListener('click', () => {
  $('ctext').value = 'Requesting [song] by [artist] — shoutout from [your city]!';
  $('ctext').focus();
});
$('cpost').addEventListener('click', postRequest);
async function postRequest() {
  const text = $('ctext').value.trim();
  if (!text) { $('tagnote').textContent = 'Write something first'; return; }
  const whole = $('cwho').value.trim();
  const bits = whole.split(',');
  const name = bits[0]?.trim() || 'Anonymous';
  const city = bits.slice(1).join(',').trim() || null;
  const ty = $('ctype').value;
  const fr = $('cfor').value.trim();

  $('cpost').disabled = true; $('cpost').textContent = 'Sending…';
  const r = await api.post('/api/requests', {
    text, name, city,
    kind: ty ? ty.toLowerCase() : 'request',
    ribbon: ty ? (ty + (fr ? ' for ' + fr : '')) : null
  });
  $('cpost').disabled = false; $('cpost').textContent = 'Post to the Zone';

  if (!r.ok) {
    toast(r.error === 'slow_down' ? 'Easy — too many in a row' : 'Could not send that');
    return;
  }
  $('ctext').value = ''; $('ctype').value = ''; $('cfor').value = ''; $('cfor').style.display = 'none';
  $('tagnote').textContent = 'Required for your post to be counted';
  if (r.song_id) { subs.add(r.song_id); api.post('/api/subscribe', { song_id: r.song_id, client: CLIENT, on: true }); }
  toast('Request counted — in tonight’s rundown');
  poll0();
}

$('qform').addEventListener('submit', async e => {
  e.preventDefault();
  const text = $('qtext').value.trim();
  if (!text) return;
  const whole = $('qwho').value.trim(), bits = whole.split(',');
  const r = await api.post('/api/requests', {
    text, name: bits[0]?.trim() || 'Anonymous', city: bits.slice(1).join(',').trim() || null, kind: 'question'
  });
  if (r.ok) { e.target.reset(); toast('Question sent to the booth'); poll0(); }
});

/* =======================================================================
   LIVE SOCIAL FEED
   ======================================================================= */
const PLATFORMS = [['tiktok', 'TikTok', '#22E0E0', 'TT'], ['instagram', 'Instagram', '#FF6BC0', 'IG'], ['x', 'X', '#FFF6FB', 'X'], ['youtube', 'YouTube', '#FF2A1F', 'YT']];
function drawPlatforms(byPlat, stats) {
  byPlat = byPlat || {};
  $('plats').innerHTML = PLATFORMS.map(([key, label, col, ab]) => {
    const rows = byPlat[key] || [];
    const tot = rows.reduce((s, r) => s + r.n, 0);
    const body = rows.length
      ? rows.map((r, i) => `<div class="prow">
          <span class="p">${i + 1}</span>
          <span class="s"><b>${esc(r.title)}</b><span>${esc(r.artist)}</span></span>
          <span class="c">${r.n.toLocaleString()}</span></div>`).join('')
      : '<div style="padding:14px 0;color:var(--faint);font-size:12.5px">No posts counted in the last 24h.</div>';
    return `<div class="plat">
      <div class="plat-h"><span class="ic" style="background:${col};color:${key === 'x' ? '#100320' : '#fff'}">${ab}</span>
        <b>${label}</b><span class="n">${tot.toLocaleString()}</span></div>${body}</div>`;
  }).join('');
  $('sync').textContent = 'just now';
  $('elig').textContent = (stats?.day_requests || 0).toLocaleString();
  $('drop').textContent = '0';
}

function drawStats(st) {
  if (!st) return;
  $('rpm').textContent = st.last_minute || 0;
  $('inzone').textContent = (st.day_requests || 0).toLocaleString();
}

/* =======================================================================
   CITY CUP
   ======================================================================= */
let myCity = null;
try { myCity = localStorage.getItem('mrl_city'); } catch (e) {}
function drawCup(cup) {
  if (!cup) return;
  if (!cup.length) { $('cupgrid').innerHTML = '<div style="padding:20px;color:var(--dim)">No city data yet.</div>'; return; }
  const max = Math.max(...cup.map(c => c.pts), 1);
  $('cupgrid').innerHTML = cup.map((c, i) => `
    <div class="cupcity${myCity === c.city ? ' me' : ''}">
      <div class="cuph"><span class="r">${i + 1}</span><b>${esc(c.city)}</b><span class="pts">${c.pts.toLocaleString()}</span></div>
      <div class="cupbar"><i style="width:${Math.round(c.pts / max * 100)}%"></i></div>
      <span class="sub">${myCity === c.city ? 'your city — you’re repping' : 'requests + boosts this week'}</span>
      <button class="btn sm" data-city="${esc(c.city)}">${myCity === c.city ? '✓ Repping' : 'Rep this city'}</button>
    </div>`).join('');
  document.querySelectorAll('[data-city]').forEach(b => b.addEventListener('click', function () {
    myCity = this.dataset.city;
    try { localStorage.setItem('mrl_city', myCity); } catch (e) {}
    if (!$('cwho').value.trim()) $('cwho').value = 'you, ' + myCity;
    drawCup(STATE?.cup || []);
    $('cupmsg').innerHTML = '<span style="color:var(--lime)">Repping ' + esc(myCity) + ' — your requests count for it</span>';
    toast('Repping ' + myCity);
  }));
}

/* =======================================================================
   VOTE
   ======================================================================= */
let voteTimer = null;
function drawVote(v, mine) {
  if (!v) {
    $('votegrid').innerHTML = '<div style="padding:24px 16px;color:var(--dim);grid-column:1/-1">No vote running. The producer opens these from the studio during the show.</div>';
    $('votelock').textContent = '--:--'; $('votetotal').textContent = '0'; $('votemsg').textContent = '';
    return;
  }
  const tot = (v.a_votes + v.b_votes) || 1;
  const pair = [
    { id: v.a_id, title: v.a_title, artist: v.a_artist, n: v.a_votes },
    { id: v.b_id, title: v.b_title, artist: v.b_artist, n: v.b_votes }
  ];
  $('votegrid').innerHTML = pair.map(s => {
    const pct = Math.round(s.n / tot * 100);
    return `<button class="vcard${mine === s.id ? ' picked' : ''}" data-v="${s.id}" data-r="${v.id}">
      <b>${esc(s.title)}</b><span>${esc(s.artist)}</span>
      <div class="pct">${pct}%</div>
      <div class="vb"><i style="width:${pct}%"></i></div>
      <span class="mono" style="font-size:11px;color:var(--faint)">${s.n.toLocaleString()} votes</span>
    </button>`;
  }).join('<div class="vs">VS</div>');
  $('votetotal').textContent = (v.a_votes + v.b_votes).toLocaleString();

  document.querySelectorAll('.vcard').forEach(b => b.addEventListener('click', async function () {
    const song_id = parseInt(this.dataset.v, 10), round_id = parseInt(this.dataset.r, 10);
    const r = await api.post('/api/vote', { round_id, song_id, client: CLIENT });
    if (r.ok) { toast('Vote counted'); $('votemsg').innerHTML = '<span style="color:var(--lime)">Vote counted</span>'; poll0(); }
    else toast(r.error === 'round_closed' ? 'That round just closed' : 'Could not vote');
  }));

  clearInterval(voteTimer);
  const close = new Date(v.closes_at).getTime();
  const tickLock = () => {
    const d = Math.max(0, close - Date.now());
    $('votelock').textContent = String(Math.floor(d / 60000)).padStart(2, '0') + ':' + String(Math.floor(d % 60000 / 1000)).padStart(2, '0');
  };
  tickLock(); voteTimer = setInterval(tickLock, 1000);
}

/* =======================================================================
   THE LOUNGE
   ======================================================================= */
function appendLounge(msgs) {
  if (!msgs || !msgs.length) return;
  const box = $('lgmsgs');
  const stick = box.scrollTop + box.clientHeight > box.scrollHeight - 60;
  for (const m of msgs) {
    loungeSince = Math.max(loungeSince, m.id);
    const d = document.createElement('div');
    if (m.is_system) { d.className = 'lg-sys'; d.textContent = '♪ ' + m.body; }
    else {
      d.className = 'lg-msg';
      d.innerHTML = `<div class="av" style="background:${m.is_crew ? 'linear-gradient(135deg,#FF2D9E,#22E0E0)' : 'linear-gradient(135deg,#8B3DFF,#FF6BC0)'}">${esc(m.name.slice(0, 2).toUpperCase())}</div>
        <div class="bd"><b style="${m.is_crew ? 'color:var(--magenta)' : ''}">${esc(m.name)}</b> <span class="pixel">${m.is_crew ? 'crew' : ago(m.created_at)}</span><br>${esc(m.body)}</div>`;
    }
    box.appendChild(d);
  }
  while (box.children.length > 80) box.removeChild(box.firstChild);
  if (stick) box.scrollTop = box.scrollHeight;
}

async function sendLounge() {
  const t = $('lgtext').value.trim();
  if (!t) return;
  const name = ($('cwho').value.trim().split(',')[0] || 'listener').slice(0, 40);
  $('lgtext').value = '';
  const r = await api.post('/api/lounge', { body: t, name });
  if (!r.ok) toast(r.error === 'slow_down' ? 'Slow down a second' : 'Message not sent');
  else { appendLounge([r.message]); loungeSince = Math.max(loungeSince, r.message.id); }
}
$('lgsend').addEventListener('click', sendLounge);
$('lgtext').addEventListener('keydown', e => { if (e.key === 'Enter') sendLounge(); });
$('lgsync').addEventListener('click', () => { if (!playing) togglePlay(); toast('Synced to the live stream'); });
document.querySelectorAll('.lg-react button').forEach(b => b.addEventListener('click', function () {
  const w = $('lgwin'), f = document.createElement('span');
  f.className = 'fl'; f.textContent = this.dataset.e;
  f.style.left = (30 + Math.random() * 70) + '%'; f.style.bottom = '90px';
  w.appendChild(f); setTimeout(() => f.remove(), 2400);
}));
$('lgcount').textContent = '—';
$('lgwho').innerHTML = '<div style="color:var(--dim);font-size:13px">Whoever is posting shows up here during the show.</div>';

/* =======================================================================
   LEADERBOARD
   ======================================================================= */
function drawLeaderboard(reqs) {
  if (!reqs) return;
  const by = {};
  for (const r of reqs) {
    const k = (r.name || 'Anonymous') + '|' + (r.city || '');
    by[k] = (by[k] || 0) + r.boosts + 1;
  }
  const top = Object.entries(by).sort((a, b) => b[1] - a[1]).slice(0, 5);
  $('lbrd').innerHTML = top.length
    ? top.map(([k, p], i) => {
        const [n, c] = k.split('|');
        return `<div class="lb"><span class="r">${i + 1}</span><span style="flex:1"><b>${esc(n)}</b><br><span class="pixel">${esc(c)}</span></span><span class="p">${p} ⚡</span></div>`;
      }).join('')
    : '<div style="color:var(--dim);font-size:13px">No boosts yet this week.</div>';
}

/* =======================================================================
   CITY CHART + TREND
   ======================================================================= */
const TCOL = ['#FF2D9E', '#22E0E0', '#9DFF3D', '#8B3DFF', '#FF6BC0'];
let hidden = new Set();
function initCities(cities) {
  if (!cities || !cities.length) {
    $('citysel').innerHTML = '<option>No city data yet</option>';
    return;
  }
  $('citysel').innerHTML = cities.map(c => `<option>${esc(c.city)}</option>`).join('');
  if (myCity && cities.some(c => c.city === myCity)) $('citysel').value = myCity;
  loadCity();
  $('citysel').addEventListener('change', () => { hidden.clear(); loadCity(); });
}
async function loadCity() {
  const city = $('citysel').value;
  if (!city || city.startsWith('No city')) return;
  try {
    const d = await api.get('/api/city?city=' + encodeURIComponent(city));
    if (!d.ok) return;
    $('cityrows').innerHTML = d.top.length
      ? d.top.map((r, i) => `<div class="crow2"><span class="p">${i + 1}</span>
          <span><b>${esc(r.title)}</b><span class="a">${esc(r.artist)}</span></span>
          <span class="c">${r.n.toLocaleString()}</span></div>`).join('')
      : '<div style="color:var(--dim);font-size:13px">No requests from here yet.</div>';
    drawTrend(d.top, d.trend);
  } catch (e) {}
}
function drawTrend(top, trend) {
  if (!top.length) { $('citytrend').innerHTML = ''; $('citylegend').innerHTML = ''; return; }
  const weeks = [...new Set(trend.map(t => t.week))].sort();
  if (weeks.length < 2) {
    $('citytrend').innerHTML = '<div style="padding:30px 10px;color:var(--dim);font-size:13px">Not enough history yet — the trend fills in as weeks accumulate.</div>';
    $('citylegend').innerHTML = ''; return;
  }
  const series = top.map((s, i) => ({
    name: s.title, col: TCOL[i % 5],
    pts: weeks.map(w => (trend.find(t => t.song_id === s.song_id && t.week === w)?.n) || 0)
  }));
  const vis = series.filter(s => !hidden.has(s.name));
  const W = 560, H = 230, PL = 42, PR = 12, PT = 14, PB = 26;
  const max = Math.max(...vis.flatMap(s => s.pts), 1) * 1.15;
  const X = i => PL + i * (W - PL - PR) / Math.max(1, weeks.length - 1);
  const Y = v => H - PB - (v / max) * (H - PT - PB);
  let g = '';
  for (let k = 0; k <= 3; k++) {
    const y = PT + k * (H - PT - PB) / 3;
    g += `<line x1="${PL}" y1="${y}" x2="${W - PR}" y2="${y}" stroke="rgba(255,246,251,.09)"/><text x="6" y="${y + 4}" fill="#8A72B0" font-size="10" font-family="JetBrains Mono">${Math.round(max - k * max / 3)}</text>`;
  }
  weeks.forEach((w, i) => {
    g += `<text x="${X(i)}" y="${H - 8}" fill="#8A72B0" font-size="9.5" text-anchor="middle" font-family="JetBrains Mono">${new Date(w).toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}</text>`;
  });
  vis.forEach(s => {
    g += `<polyline fill="none" stroke="${s.col}" stroke-width="2.2" stroke-linejoin="round" points="${s.pts.map((v, i) => X(i) + ',' + Y(v)).join(' ')}"/>`;
    g += `<circle cx="${X(s.pts.length - 1)}" cy="${Y(s.pts[s.pts.length - 1])}" r="4" fill="${s.col}"/>`;
  });
  $('citytrend').innerHTML = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto">${g}</svg>`;
  $('citylegend').innerHTML = series.map(s => `<button class="lg${hidden.has(s.name) ? ' off' : ''}" data-s="${esc(s.name)}"><span class="sw" style="background:${s.col}"></span>${esc(s.name)}</button>`).join('');
  document.querySelectorAll('.legend .lg').forEach(b => b.addEventListener('click', function () {
    const n = this.dataset.s;
    hidden.has(n) ? hidden.delete(n) : hidden.add(n);
    if (hidden.size === series.length) hidden.delete(n);
    drawTrend(top, trend);
  }));
}

/* =======================================================================
   ARCHIVE
   ======================================================================= */
let archT;
async function loadArchive() {
  const q = $('q').value.trim();
  try {
    const d = await api.get('/api/archive?q=' + encodeURIComponent(q));
    $('arch').innerHTML = d.rows?.length
      ? d.rows.map(r => `<tr>
          <td class="mono">${r.aired_at ? new Date(r.aired_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'}</td>
          <td>${esc(r.title)} — ${esc(r.artist)}</td>
          <td style="color:var(--dim)">${esc(r.requested_by || '')}</td>
          <td class="mono">${esc(r.hour_label || '')}</td></tr>`).join('')
      : '<tr><td colspan="4" style="color:var(--dim);padding:20px 12px">Nothing has aired yet. Songs land here once the producer advances the rundown.</td></tr>';
  } catch (e) {}
}
$('q').addEventListener('input', () => { clearTimeout(archT); archT = setTimeout(loadArchive, 250); });
$('clearq').addEventListener('click', () => { $('q').value = ''; loadArchive(); });

/* =======================================================================
   GLOBE
   ======================================================================= */
const LAND = {1:[[10,18],[22,27],[45,60]],2:[[8,19],[21,28],[33,37],[42,63]],3:[[2,21],[23,27],[32,63]],4:[[2,22],[24,26],[28,28],[32,63]],5:[[8,22],[30,63]],6:[[9,22],[31,63]],7:[[9,20],[32,58]],8:[[10,19],[30,57]],9:[[10,18],[30,57]],10:[[11,17],[29,53]],11:[[12,17],[29,53]],12:[[14,16],[29,39],[44,51]],13:[[16,17],[29,40],[45,46],[49,51]],14:[[18,21],[30,40],[49,54]],15:[[17,24],[33,39],[49,56]],16:[[18,25],[33,39],[50,57]],17:[[18,25],[34,39],[53,56]],18:[[19,25],[34,39],[53,58]],19:[[19,24],[34,38],[52,59]],20:[[19,23],[34,37],[52,59]],21:[[19,22],[35,37],[52,59]],22:[[19,21],[62,63]],23:[[18,20],[61,63]],24:[[19,20]],25:[[19,19]],28:[[0,63]],29:[[0,63]]};
const DOTS = [];
for (const j in LAND) for (const [a, b] of LAND[j]) for (let i = a; i <= b; i++) DOTS.push([90 - (+j + .5) * 5.625, -180 + (i + .5) * 5.625]);
const GEO = {
  'manila': [14.6, 121], 'toronto': [43.7, -79.4], 'madrid': [40.4, -3.7], 'atlanta': [33.7, -84.4],
  'seoul': [37.6, 127], 'london': [51.5, -.1], 'são paulo': [-23.5, -46.6], 'sao paulo': [-23.5, -46.6],
  'sydney': [-33.9, 151.2], 'mexico city': [19.4, -99.1], 'chicago': [41.9, -87.6], 'dublin': [53.3, -6.3],
  'mumbai': [19.1, 72.9], 'los angeles': [34.1, -118.2], 'berlin': [52.5, 13.4], 'lagos': [6.5, 3.4],
  'bogotá': [4.7, -74.1], 'bogota': [4.7, -74.1], 'tokyo': [35.7, 139.7], 'vancouver': [49.3, -123.1],
  'auckland': [-36.8, 174.8], 'dubai': [25.2, 55.3], 'paris': [48.9, 2.4], 'jakarta': [-6.2, 106.8],
  'houston': [29.8, -95.4], 'new york': [40.75, -73.98], 'miami': [25.8, -80.2], 'detroit': [42.3, -83],
  'nashville': [36.2, -86.8], 'manchester': [53.5, -2.2], 'milan': [45.5, 9.2], 'philadelphia': [39.95, -75.16]
};
function geo(city) {
  if (!city) return null;
  const k = city.split(',')[0].trim().toLowerCase();
  if (GEO[k]) return GEO[k];
  // Deterministic fallback so an unknown city still lands somewhere stable.
  let h = 0; for (let i = 0; i < k.length; i++) h = (h * 31 + k.charCodeAt(i)) % 99991;
  return [((h % 120) - 60), ((h * 7) % 360) - 180];
}
const HUB = [40.75, -73.98];
const D2R = Math.PI / 180;
let arcs = [], pings = [];
function v3(lat, lon) { const a = lat * D2R, b = lon * D2R; return [Math.cos(a) * Math.sin(b), Math.sin(a), Math.cos(a) * Math.cos(b)]; }
(function () {
  const c = $('globe'), x = c.getContext('2d');
  let W, H, CX, CY, R, rot = 0;
  function size() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    W = c.parentElement.offsetWidth; H = c.parentElement.offsetHeight;
    c.width = W * dpr; c.height = H * dpr; x.setTransform(dpr, 0, 0, dpr, 0, 0);
    CX = W / 2; CY = H / 2; R = Math.min(W, H) * .46;
  }
  function rp(v) {
    const s = Math.sin(rot * D2R), co = Math.cos(rot * D2R);
    return [CX + R * (v[0] * co + v[2] * s), CY - R * v[1], -v[0] * s + v[2] * co];
  }
  function draw() {
    x.clearRect(0, 0, W, H);
    const g = x.createRadialGradient(CX, CY, R * .75, CX, CY, R * 1.18);
    g.addColorStop(0, 'rgba(139,61,255,.20)'); g.addColorStop(1, 'rgba(139,61,255,0)');
    x.fillStyle = g; x.beginPath(); x.arc(CX, CY, R * 1.18, 0, 7); x.fill();
    x.strokeStyle = 'rgba(34,224,224,.22)'; x.lineWidth = 1;
    x.beginPath(); x.arc(CX, CY, R, 0, 7); x.stroke();
    x.strokeStyle = 'rgba(139,61,255,.20)';
    for (let lat = -60; lat <= 60; lat += 30) {
      x.beginPath(); let st = false;
      for (let lon = -180; lon <= 180; lon += 4) { const [px, py, z] = rp(v3(lat, lon)); if (z > 0) { st ? x.lineTo(px, py) : (x.moveTo(px, py), st = true); } else st = false; }
      x.stroke();
    }
    for (let lon = -180; lon < 180; lon += 30) {
      x.beginPath(); let st = false;
      for (let lat = -88; lat <= 88; lat += 4) { const [px, py, z] = rp(v3(lat, lon)); if (z > 0) { st ? x.lineTo(px, py) : (x.moveTo(px, py), st = true); } else st = false; }
      x.stroke();
    }
    for (const [lat, lon] of DOTS) {
      const [px, py, z] = rp(v3(lat, lon));
      if (z <= 0) continue;
      x.globalAlpha = .10 + z * .55; x.fillStyle = '#E9A8FF';
      const s = 1.4 + z * 1.2; x.fillRect(px - s / 2, py - s / 2, s, s);
    }
    x.globalAlpha = 1;
    const now = performance.now();
    arcs = arcs.filter(a => now - a.t < 2600);
    const hub = v3(HUB[0], HUB[1]);
    for (const a of arcs) {
      const k = Math.min((now - a.t) / 1300, 1), from = v3(a.lat, a.lon);
      x.strokeStyle = 'rgba(34,224,224,' + (1 - Math.max(0, (now - a.t - 1300) / 1300)) * .85 + ')';
      x.lineWidth = 1.4; x.beginPath(); let st = false;
      const N = 34;
      for (let i = 0; i <= N * k; i++) {
        const t = i / N;
        let p = [from[0] + (hub[0] - from[0]) * t, from[1] + (hub[1] - from[1]) * t, from[2] + (hub[2] - from[2]) * t];
        const len = Math.hypot(p[0], p[1], p[2]) || 1, lift = 1 + .30 * Math.sin(Math.PI * t);
        p = [p[0] / len * lift, p[1] / len * lift, p[2] / len * lift];
        const [px, py, z] = rp(p);
        if (z > -.25) { st ? x.lineTo(px, py) : (x.moveTo(px, py), st = true); } else st = false;
      }
      x.stroke();
    }
    pings = pings.filter(p => now - p.t < 1800);
    for (const p of pings) {
      const [px, py, z] = rp(v3(p.lat, p.lon));
      if (z <= 0) continue;
      const k = (now - p.t) / 1800;
      x.globalAlpha = (1 - k) * z; x.strokeStyle = '#9DFF3D'; x.lineWidth = 1.2;
      const s = 6 + k * 22; x.strokeRect(px - s / 2, py - s / 2, s, s);
      x.globalAlpha = z; x.fillStyle = '#9DFF3D'; x.fillRect(px - 1.6, py - 1.6, 3.2, 3.2);
    }
    const [hx, hy, hz] = rp(hub);
    if (hz > 0) {
      x.globalAlpha = 1; x.fillStyle = '#FF2D9E'; x.beginPath(); x.arc(hx, hy, 3.4, 0, 7); x.fill();
      x.strokeStyle = 'rgba(255,45,158,.55)'; x.lineWidth = 1; x.beginPath(); x.arc(hx, hy, 7, 0, 7); x.stroke();
    }
    x.globalAlpha = 1;
    if (!RM) rot += .075;
    requestAnimationFrame(draw);
  }
  size(); draw(); addEventListener('resize', size);
})();

/* Fire a globe ping for each request we haven't seen before. */
function pingFromRequests(reqs) {
  if (!reqs || !reqs.length) return;
  const fresh = reqs.filter(r => r.id > seenRequestId).reverse();
  seenRequestId = Math.max(seenRequestId, ...reqs.map(r => r.id));
  fresh.slice(-14).forEach((r, i) => setTimeout(() => {
    const g = geo(r.city);
    if (!g) return;
    pings.push({ lat: g[0], lon: g[1], t: performance.now() });
    arcs.push({ lat: g[0], lon: g[1], t: performance.now() });
    if (arcs.length > 26) arcs.shift();
    $('pingcap').textContent = '◉ ' + (r.city || 'somewhere') + ' · ' + r.source;
  }, i * 220));
}

/* =======================================================================
   CLOCK / ON AIR
   ======================================================================= */
const ETNOW = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
function satBack(k) { const d = new Date(ETNOW); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7) - 7 * k); return d; }
const F = (d, y) => d.toLocaleDateString('en-US', y ? { month: 'short', day: 'numeric', year: 'numeric' } : { month: 'short', day: 'numeric' });
function tick() {
  const et = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const live = !!(STATE && STATE.nowPlaying) || (et.getDay() === 6 && et.getHours() >= 19);
  $('sign').classList.toggle('live', live);
  $('tray').classList.toggle('live', live);
  $('signtxt').textContent = live ? 'On air now' : 'Off air';
  if (live) {
    $('clockline').style.display = 'none';
    $('cap').textContent = STATE?.nowPlaying
      ? 'On air now — ' + STATE.nowPlaying.title + ' — ' + STATE.nowPlaying.artist
      : 'On air now. The request line is open.';
  } else {
    $('clockline').style.display = '';
    const t = new Date(et); t.setDate(et.getDate() + ((6 - et.getDay() + 7) % 7)); t.setHours(19, 0, 0, 0);
    if (t <= et) t.setDate(t.getDate() + 7);
    const d = t - et;
    $('ch').textContent = String(Math.floor(d / 36e5)).padStart(2, '0');
    $('cm').textContent = String(Math.floor(d % 36e5 / 6e4)).padStart(2, '0');
    $('cs').textContent = String(Math.floor(d % 6e4 / 1e3)).padStart(2, '0');
  }
  $('traytime').textContent = et.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true }) + ' ET';
}
tick(); setInterval(tick, 1000);

/* =======================================================================
   STATIC CONTENT (editorial — swap for a CMS or feed later)
   ======================================================================= */
const rundownHours = [['7p', 'Hour 1', 'Top 20 countdown starts at No. 20', 'Chart', 0], ['8p', 'Hour 2', 'Live guest in studio, taking your questions', 'Live guest', 1], ['9p', 'Hour 3', 'The TwittaMix — your requests back to back', 'Requests', 0], ['10p', 'Hour 4', 'Best Of The Web + the No. 1 reveal', 'Chart', 0], ['11p', 'Hour 5', 'You program it. Every song, no exceptions.', 'Listener hour', 0]];
$('rundown').innerHTML = rundownHours.map(([t, h, d, tag, m]) => `<div class="hr${m ? ' mk' : ''}"><span class="pixel">${t} ET · ${h}</span><b>${d}</b><span class="tag">${tag}</span></div>`).join('');
document.querySelectorAll('.sec-top .note').forEach(n => { if (n.textContent.indexOf('7p–12a ET') > -1) n.textContent = F(satBack(0)) + ' · 7p–12a ET'; });

const guests = ['RIIZE', 'KATSEYE', 'JO1', '82MAJOR', 'LNGSHOT', 'Temper City', 'Tara Macri', 'KISS OF LIFE'];
const hues = ['#FF2D9E', '#8B3DFF', '#22E0E0', '#FF6BC0', '#6B2FA8', '#FF2D9E', '#8B3DFF', '#22E0E0'];
$('top8').innerHTML = guests.map((g, i) => `<a href="#interviews" title="${g}"><div class="av" style="background:linear-gradient(135deg,${hues[i]},${hues[(i + 3) % 8]})">${g.slice(0, 2).toUpperCase()}</div><span>${g}</span></a>`).join('');

const pods = [['Full Show replay', '5h 02m', 'Hour by hour, as it aired', '#FF2D9E'], ['The Top 20 Countdown', '48m', 'This week’s chart, condensed', '#8B3DFF'], ['Best Of The Web', '14m', 'What the internet did this week', '#FF6BC0'], ['The TwittaMix', '31m', 'Your requests, back to back', '#6B2FA8']];
$('pods').innerHTML = pods.map(([t, d, s, c]) => `<div class="tile"><div class="thumb" style="background:linear-gradient(135deg,${c},#1E0C38)"><span class="g">◉</span><span class="pixel">${d}</span></div><div class="tileb"><b>${t}</b><span style="font-size:12.5px;color:var(--dim)">${s}</span></div></div>`).join('');

const ways = [['☎', 'Call the studio', 'Talk to Romeo live, on air', '1-877-REQUEST'], ['💬', 'Text the show', 'Anytime, all week', 'Text SONG to 24242'], ['🖥', 'Right here', 'Post in The Zone', 'Counts instantly'], ['🎙', 'Voice note', 'Best ones open the show', 'Record in The Zone'], ['📱', 'TikTok', 'Comment on the weekly video', '#MostRequestedLive @onairromeo'], ['📸', 'Instagram', 'DM or reply to the story', '#MostRequestedLive @onairromeo'], ['✖', 'X', 'Post it with both tags', '#MostRequestedLive @onairromeo'], ['▶', 'YouTube', 'Drop it in the premiere chat', '#MostRequestedLive @onairromeo']];
$('ways').innerHTML = ways.map(([g, t, s, h]) => `<div class="way"><span class="g">${g}</span><b>${t}</b><span>${s}</span><span class="h">${h}</span></div>`).join('');

const IV = [
  ['Cameron Whitcomb talks making "Kingdom of Fear," skydiving and staying clean', 'Cameron Whitcomb', '10:12', 'pod', 'Oct 17, 2026', '#FF2D9E'],
  ['Temper City talk "Self Aware," Erling Haaland’s TikTok, and the songs that inspire them', 'Temper City', '13:04', 'yt', 'Oct 11, 2026', '#8B3DFF'],
  ['LNGSHOT chats with #MostRequestedLive!', 'LNGSHOT', '16:22', 'pod', 'Oct 4, 2026', '#22E0E0'],
  ['John Roberts chats with #MostRequestedLive!', 'John Roberts', '11:38', 'yt', 'Sep 27, 2026', '#FF6BC0'],
  ['82MAJOR chats with #MostRequestedLive!', '82MAJOR', '10:05', 'pod', 'Sep 20, 2026', '#6B2FA8'],
  ['JO1 chats with #MostRequestedLive!', 'JO1', '20:41', 'yt', 'Sep 20, 2026', '#FF2D9E'],
  ['Tara Macri chats with #MostRequestedLive!', 'Tara Macri', '13:15', 'pod', 'Aug 30, 2026', '#22E0E0'],
  ['KISS OF LIFE chats with #MostRequestedLive!', 'KISS OF LIFE', '10:50', 'yt', 'Aug 30, 2026', '#8B3DFF'],
  ['RIIZE chats with #MostRequestedLive!', 'RIIZE', '12:30', 'yt', 'Jul 25, 2026', '#FF6BC0']
];
const SRCL = { yt: ['YouTube', '#FF2A1F'], pod: ['Podcast', '#8B3DFF'] };
let ivi = 0;
function setFeat(i) {
  ivi = i; const v = IV[i];
  $('ivfeat').style.background = 'linear-gradient(140deg,' + v[5] + ',#1E0C38)';
  $('ivfeat').textContent = v[3] === 'yt' ? '▶' : '◉';
  $('ivk').textContent = '▸ ' + SRCL[v[3]][0] + ' · ' + v[4];
  $('ivt').textContent = v[1]; $('ivd').textContent = v[0];
  $('ivplay').textContent = (v[3] === 'yt' ? '▶ Watch — ' : '▶ Listen — ') + v[2];
}
function drawIV(f = 'all') {
  const rows = IV.map((v, i) => [v, i]).filter(([v]) => f === 'all' || v[3] === f);
  $('ivgrid').innerHTML = rows.map(([v, i]) => `<button class="ivc" data-i="${i}">
    <div class="th" style="background:linear-gradient(140deg,${v[5]},#1E0C38)"><span>${v[3] === 'yt' ? '▶' : '◉'}</span>
      <span class="sb" style="background:${SRCL[v[3]][1]}">${SRCL[v[3]][0]}</span><span class="dur">${v[2]}</span></div>
    <div class="bd"><b>${v[1]}</b><span style="font-size:12px;color:var(--dim)">${v[0].length > 64 ? v[0].slice(0, 64) + '…' : v[0]}</span><span class="dt">${v[4]}</span></div>
  </button>`).join('');
  document.querySelectorAll('.ivc').forEach(b => b.addEventListener('click', () => { setFeat(+b.dataset.i); $('interviews').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' }); }));
}
setFeat(0); drawIV();
document.querySelectorAll('[data-iv]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('[data-iv]').forEach(x => x.setAttribute('aria-selected', 'false'));
  t.setAttribute('aria-selected', 'true'); drawIV(t.dataset.iv);
}));
$('ivplay').addEventListener('click', () => {
  const v = IV[ivi];
  $('np').textContent = v[1] + ' — ' + SRCL[v[3]][0] + ' interview';
  $('playbtn').textContent = '❙❙ Pause'; playing = true; toast('Playing ' + v[1]);
});
$('ivyt').addEventListener('click', () => window.open('https://www.youtube.com/@MostRequestedLive', '_blank', 'noopener'));
$('ivpod').addEventListener('click', () => window.open('https://podcasts.apple.com/us/podcast/most-requested-live-interviews/id1601885678', '_blank', 'noopener'));
$('ivsync').textContent = 'last sync ' + ETNOW.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) + ' ET';

/* gallery */
const PHOTOS = [
  ['Romeo and KATSEYE after hour 2', 'guests', 'Studio A', '#FF2D9E', '#8B3DFF', 'w2 h2'],
  ['Romeo running the request board', 'studio', '', '#22E0E0', '#8B3DFF', ''],
  ['With Alex Warren, first visit', 'guests', '', '#8B3DFF', '#1E0C38', ''],
  ['Doechii in the booth', 'guests', '', '#FF6BC0', '#6B2FA8', 'h2'],
  ['The board at 11:58pm', 'studio', '', '#FF2D9E', '#241040', ''],
  ['Load-in, Chicago', 'road', 'B96', '#6B2FA8', '#22E0E0', ''],
  ['With RIIZE after the interview', 'guests', '', '#9DFF3D', '#8B3DFF', 'w2'],
  ['Hour 5, the crew shot', 'studio', '', '#8B3DFF', '#FF2D9E', ''],
  ['Broadcasting from Manila', 'road', '', '#22E0E0', '#241040', ''],
  ['With Gracie Abrams before soundcheck', 'guests', '', '#FF6BC0', '#22E0E0', ''],
  ['With Tate McRae, second visit', 'guests', '', '#FF2D9E', '#6B2FA8', 'w2'],
  ['Romeo and the producers, Toronto', 'road', 'Virgin Radio', '#8B3DFF', '#9DFF3D', '']
];
PHOTOS.forEach((p, i) => { p[2] = F(satBack(i), true) + (p[2] ? ' · ' + p[2] : ''); });
const GKIND = { studio: 'In studio', guests: 'Artist selfie', road: 'On the road' };
let shown = [], lbi = 0;
function drawGal(f = 'all') {
  shown = PHOTOS.map((p, i) => [p, i]).filter(([p]) => f === 'all' || p[1] === f);
  $('gal').innerHTML = shown.map(([p], n) => `<button class="ph-t ${p[5]}" data-n="${n}" style="background:linear-gradient(140deg,${p[3]},${p[4]})">
    <span class="ph-i">📷</span><span class="ph-k">${GKIND[p[1]]}</span>
    <span class="ph-c">${p[0]}<em>${p[2]}</em></span></button>`).join('');
  document.querySelectorAll('.ph-t').forEach(b => b.addEventListener('click', () => openLb(+b.dataset.n)));
}
function openLb(n) {
  lbi = n; const p = shown[n][0];
  $('lbstage').style.background = 'linear-gradient(140deg,' + p[3] + ',' + p[4] + ')';
  $('lbcap').textContent = p[0];
  $('lbmeta').textContent = p[2] + ' · ' + GKIND[p[1]];
  $('lbfile').textContent = 'mrl_' + String(shown[n][1] + 1).padStart(3, '0') + '.jpg';
  $('lbcount').textContent = (n + 1) + ' of ' + shown.length;
  $('lb').classList.add('open');
}
function stepLb(d) { openLb((lbi + d + shown.length) % shown.length); }
$('lbprev').addEventListener('click', () => stepLb(-1));
$('lbnext').addEventListener('click', () => stepLb(1));
$('lbclose').addEventListener('click', () => $('lb').classList.remove('open'));
$('lb').addEventListener('click', e => { if (e.target === $('lb')) $('lb').classList.remove('open'); });
$('lbshare').addEventListener('click', () => { $('lb').classList.remove('open'); openShare(shown[lbi][0][0]); });
addEventListener('keydown', e => {
  if (!$('lb').classList.contains('open')) return;
  if (e.key === 'Escape') $('lb').classList.remove('open');
  if (e.key === 'ArrowLeft') stepLb(-1);
  if (e.key === 'ArrowRight') stepLb(1);
});
document.querySelectorAll('[data-g]').forEach(t => t.addEventListener('click', () => {
  document.querySelectorAll('[data-g]').forEach(x => x.setAttribute('aria-selected', 'false'));
  t.setAttribute('aria-selected', 'true'); drawGal(t.dataset.g);
}));
drawGal();

/* predict */
function drawPred() {
  const top5 = (STATE?.chart || []).slice(0, 5);
  if (!top5.length) { $('predict').innerHTML = '<div style="color:var(--dim);font-size:13px">Opens once the chart has songs on it.</div>'; return; }
  let mine = null; try { mine = localStorage.getItem('mrl_pred'); } catch (e) {}
  $('predict').innerHTML = top5.map(r => `<div class="prow2${mine == r.song_id ? ' picked' : ''}" data-i="${r.song_id}"><b>${esc(r.title)}</b><span class="pc">${r.requests} req</span></div>`).join('');
  document.querySelectorAll('.prow2').forEach(el => el.addEventListener('click', function () {
    const id = this.dataset.i;
    try { localStorage.setItem('mrl_pred', id); } catch (e) {}
    const row = top5.find(r => r.song_id == id);
    drawPred();
    $('predictmsg').innerHTML = '<div class="ok"><b>Locked in.</b> You called ' + esc(row.title) + '. Results when the chart resets Saturday.</div>';
    toast('Prediction locked');
  }));
}

/* =======================================================================
   SHARE / CARD / VOICE / PLAYER / DEMO
   ======================================================================= */
const TAGS = '#MostRequestedLive @onairromeo';
let shareText = '';
function openShare(x) {
  const clean = x.replace(/#MostRequestedLive/gi, '').replace(/@onairromeo/gi, '').trim();
  shareText = clean + ' ' + TAGS;
  $('shprev').innerHTML = esc(clean) + ' <span class="tag">' + TAGS + '</span>';
  $('shok').innerHTML = ''; $('ov').classList.add('open');
}
$('shclose').addEventListener('click', () => $('ov').classList.remove('open'));
$('ov').addEventListener('click', e => { if (e.target === $('ov')) $('ov').classList.remove('open'); });
$('shcopy').addEventListener('click', () => {
  navigator.clipboard?.writeText(shareText);
  $('shok').innerHTML = '<div class="ok"><b>Copied.</b> The tag and mention travel with it, so it counts toward the chart.</div>';
});
document.querySelectorAll('.shrow button').forEach(b => b.addEventListener('click', function () {
  const p = this.dataset.p, t = encodeURIComponent(shareText);
  const urls = { X: 'https://twitter.com/intent/tweet?text=' + t };
  if (urls[p]) window.open(urls[p], '_blank', 'noopener');
  else { navigator.clipboard?.writeText(shareText); $('shok').innerHTML = '<div class="ok"><b>Copied for ' + p + '.</b> Paste it into your post.</div>'; }
}));

function drawCard(song, artist, who, when) {
  const c = $('cardcv'), x = c.getContext('2d'), W = 1080;
  c.width = W; c.height = W;
  const g = x.createLinearGradient(0, 0, W, W);
  g.addColorStop(0, '#FF2D9E'); g.addColorStop(.55, '#8B3DFF'); g.addColorStop(1, '#1E0C38');
  x.fillStyle = g; x.fillRect(0, 0, W, W);
  x.fillStyle = 'rgba(255,255,255,.10)';
  for (let i = 0; i < 190; i++) { const r = Math.random() * 2.4 + .6; x.beginPath(); x.arc(Math.random() * W, Math.random() * W, r, 0, 7); x.fill(); }
  x.strokeStyle = '#FFF6FB'; x.lineWidth = 9; x.beginPath(); x.arc(W / 2, 368, 232, 0, 7); x.stroke();
  x.textAlign = 'center'; x.fillStyle = '#FFF6FB';
  x.font = '400 66px "Archivo Black", Impact, sans-serif';
  x.fillText('MOST', W / 2, 300); x.fillText('REQUESTED', W / 2, 368); x.fillText('LIVE', W / 2, 436);
  x.font = '400 22px "JetBrains Mono", monospace'; x.fillStyle = 'rgba(255,255,255,.85)';
  x.fillText('WORLDWIDE WITH ROMEO', W / 2, 486);
  x.fillStyle = '#9DFF3D'; x.font = '400 26px "JetBrains Mono", monospace';
  x.fillText('▸ PLAYED ON AIR', W / 2, 700);
  x.fillStyle = '#FFF6FB';
  let fs = 74; x.font = '400 ' + fs + 'px "Archivo Black", Impact, sans-serif';
  while (x.measureText(song).width > 900 && fs > 34) { fs -= 4; x.font = '400 ' + fs + 'px "Archivo Black", Impact, sans-serif'; }
  x.fillText(song, W / 2, 790);
  x.font = '500 38px "Space Grotesk", sans-serif'; x.fillStyle = 'rgba(255,255,255,.85)';
  x.fillText(artist, W / 2, 846);
  x.fillStyle = 'rgba(0,0,0,.35)'; x.fillRect(140, 910, 800, 96);
  x.fillStyle = '#FFF6FB'; x.font = '500 32px "Space Grotesk", sans-serif';
  x.fillText('Requested by ' + who, W / 2, 952);
  x.font = '400 24px "JetBrains Mono", monospace'; x.fillStyle = 'rgba(255,255,255,.75)';
  x.fillText(when, W / 2, 990);
  x.font = '400 19px "JetBrains Mono", monospace'; x.fillStyle = 'rgba(255,255,255,.55)';
  x.fillText('presented by  ▸  YOUR BRAND', W / 2, 1046);
  $('carddl').href = c.toDataURL('image/png');
}
function openCard(song, artist, who, when, head) {
  $('cardhead').textContent = head || 'Your request just aired';
  $('cardfile').textContent = song.toLowerCase().replace(/[^a-z0-9]+/g, '_') + '.png';
  drawCard(song, artist, who, when);
  $('cardov').classList.add('open');
}
$('cardclose').addEventListener('click', () => $('cardov').classList.remove('open'));
$('cardov').addEventListener('click', e => { if (e.target === $('cardov')) $('cardov').classList.remove('open'); });
$('cardshare').addEventListener('click', () => { $('cardov').classList.remove('open'); openShare('My request just played on Most Requested Live'); });

/* voice note */
$('vnwave').innerHTML = Array.from({ length: 22 }, (_, i) => `<i style="animation-delay:${i * .05}s"></i>`).join('');
let rec = null, recOn = false, recSec = 0, recT;
$('vnbtn').addEventListener('click', async function () {
  if (recOn) {
    recOn = false; this.classList.remove('rec'); this.textContent = '●';
    $('vnwave').classList.remove('on'); clearInterval(recT);
    try { rec && rec.state === 'recording' && rec.stop(); } catch (e) {}
    $('vnsend').style.display = '';
    if (!rec) $('vnmsg').innerHTML = '<div class="ok"><b>Recorded.</b> Mic unavailable here, so this shows the flow only.</div>';
    return;
  }
  recOn = true; recSec = 0; this.classList.add('rec'); this.textContent = '■';
  $('vnwave').classList.add('on'); $('vnmsg').innerHTML = ''; $('vnsend').style.display = 'none';
  try {
    const st = await navigator.mediaDevices.getUserMedia({ audio: true });
    rec = new MediaRecorder(st); const ch = [];
    rec.ondataavailable = e => ch.push(e.data);
    rec.onstop = () => { const b = new Blob(ch, { type: 'audio/webm' }); $('vnaudio').src = URL.createObjectURL(b); $('vnaudio').style.display = ''; st.getTracks().forEach(t => t.stop()); };
    rec.start();
  } catch (e) { rec = null; }
  recT = setInterval(() => {
    recSec++; $('vntime').textContent = '0:' + String(recSec).padStart(2, '0') + ' / 0:30';
    if (recSec >= 30) $('vnbtn').click();
  }, 1000);
});
$('vnsend').addEventListener('click', async () => {
  const whole = $('cwho').value.trim(), bits = whole.split(',');
  const r = await api.post('/api/requests', {
    text: '🎙 Voice note — 0:' + String(recSec).padStart(2, '0'),
    name: bits[0]?.trim() || 'Anonymous', city: bits.slice(1).join(',').trim() || null, kind: 'shoutout'
  });
  $('vnmsg').innerHTML = r.ok
    ? '<div class="ok"><b>Voice note sent.</b> The crew listens to every one before the show.</div>'
    : '<div class="ok"><b>Could not send.</b> Try again in a moment.</div>';
  if (r.ok) { toast('Voice note sent'); poll0(); }
});

/* player + station finder */
let playing = false;
function togglePlay() {
  playing = !playing;
  $('playbtn').textContent = playing ? '❙❙ Pause' : '▶ Play';
  $('np').textContent = playing
    ? (STATE?.nowPlaying ? STATE.nowPlaying.title + ' — ' + STATE.nowPlaying.artist : 'Live stream — Most Requested Live')
    : 'Most Requested Live';
}
$('playbtn').addEventListener('click', togglePlay);
$('herolisten').addEventListener('click', () => { if (!playing) togglePlay(); });
$('menulisten').addEventListener('click', () => { if (!playing) togglePlay(); });
$('startbtn').addEventListener('click', () => { $('zone').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' }); $('ctext').focus(); });

const stations = ['Z100 — New York, NY', 'KIIS FM — Los Angeles, CA', 'B96 — Chicago, IL', 'Q102 — Philadelphia, PA', 'Mix 104.1 — Boston, MA', 'Virgin Radio — Toronto, ON', 'Hits 96.1 — Syracuse, NY', '102.5 WFMF — Baton Rouge, LA'];
$('zipform').addEventListener('submit', e => {
  e.preventDefault();
  const z = $('zip').value.trim();
  if (z) $('stn').textContent = stations[z.length % stations.length];
});

/* demo strip */
try { if (sessionStorage.getItem('mrl_demo') === 'off') $('demobar').style.display = 'none'; } catch (e) {}
$('demohide').addEventListener('click', () => { $('demobar').style.display = 'none'; try { sessionStorage.setItem('mrl_demo', 'off'); } catch (e) {} });
document.querySelectorAll('[data-go]').forEach(b => b.addEventListener('click', function () { $(this.dataset.go).scrollIntoView({ behavior: RM ? 'auto' : 'smooth' }); }));
$('invtog').addEventListener('click', function () {
  document.body.classList.toggle('invon');
  const on = document.body.classList.contains('invon');
  this.textContent = on ? '✕ Hide sponsor inventory' : '◉ Show sponsor inventory';
  this.style.color = on ? 'var(--lime)' : '';
  if (on) { $('tonight').scrollIntoView({ behavior: RM ? 'auto' : 'smooth' }); toast('Sponsorable inventory highlighted'); }
});

/* =======================================================================
   HELPERS
   ======================================================================= */
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function highlight(s) {
  return esc(s)
    .replace(/#MostRequestedLive/gi, '<span class="tag">#MostRequestedLive</span>')
    .replace(/@onairromeo/gi, '<span class="tag">@onairromeo</span>');
}
function ago(ts) {
  const d = (Date.now() - new Date(ts).getTime()) / 1000;
  if (d < 60) return 'just now';
  if (d < 3600) return Math.floor(d / 60) + 'm ago';
  if (d < 86400) return Math.floor(d / 3600) + 'h ago';
  return Math.floor(d / 86400) + 'd ago';
}
function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase().replace(' ', '');
}

/* kick a poll immediately after a write */
let pollSoon = null;
function poll0() { clearTimeout(pollSoon); pollSoon = setTimeout(async () => {
  try {
    const s = await api.get(`/api/state?since=${loungeSince}&client=${encodeURIComponent(CLIENT)}`);
    if (s.ok) { applyState(s); drawPred(); }
  } catch (e) {}
}, 300); }

loadArchive();
poll();
setTimeout(drawPred, 1500);
