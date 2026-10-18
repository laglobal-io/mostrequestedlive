# Most Requested Live — website + live request platform

**Most Requested Live Worldwide with Romeo** — the syndicated Saturday-night request show.

This is a working application, not a mockup. Listener requests are stored, the Top 20 is computed from real request volume, the on-air song is driven by a producer, and the archive fills itself from whatever has aired.

**Stack:** static front end + Node serverless functions + Postgres. No framework, no build step.

---

## What's actually live

| Feature | How it works |
|---|---|
| **Live request feed** | Every request is a row in `requests`. The globe pings the real city each one came from. |
| **Top 20 chart** | Computed from request counts over a rolling 7 days, plus boosts, plus crew-pick weight. Movement arrows come from last week's snapshot. |
| **On-air song** | The producer drives it from `/studio`. The site reads it and highlights the row. |
| **"Ping me when this airs"** | Stored in `subscriptions`; fires when the producer advances onto that song, which also triggers the share card. |
| **The Lounge** | Real chat, persisted. Song changes drop in as system messages. |
| **What plays next** | Real head-to-head vote, one ballot per browser, changeable. The winner is queued into the rundown. |
| **Song history** | Fills from rundown rows that have actually aired. |
| **City charts & City Cup** | Grouped from the `city` field on requests. |
| **Social intake** | `POST /api/ingest` accepts normalised posts and enforces the `#MostRequestedLive` + `@onairromeo` rule. |

Still static (editorial content — wire to a CMS or feed when you're ready): the interviews list, the photo gallery, the hour-by-hour show outline, and the station finder.

---

## Deploy

### 1. Database

Any Postgres works — Neon, Vercel Postgres, Supabase, RDS. Easiest path is the Vercel Marketplace (Storage → Create → Neon), which sets `DATABASE_URL` for you automatically.

Then load the schema:

```bash
psql "$DATABASE_URL" -f db/schema.sql
psql "$DATABASE_URL" -f db/seed.sql    # optional — gives you a chart on day one
```

> The seed inserts a 20-song catalogue, a starting rundown, and ~600 sample requests spread over six days so the chart isn't empty for the demo. **Skip it, or clear `requests` before launch**, if you want real numbers only.

### 2. Push and import

```bash
git init && git add . && git commit -m "Most Requested Live"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/mostrequestedlive.git
git push -u origin main
```

[vercel.com/new](https://vercel.com/new) → import the repo → Framework Preset **Other** → Deploy. Functions in `/api` are detected automatically.

### 3. Environment variables

Vercel → Settings → Environment Variables:

| Name | Value |
|---|---|
| `DATABASE_URL` | Your Postgres connection string |
| `STUDIO_KEY` | A long random string. This is the producer's password. |
| `INGEST_KEY` | A long random string, for your social-listening worker |

Redeploy after adding them. Then hit **`/api/health`** — it tells you exactly what's wrong if anything is.

### 4. Domain

Settings → Domains → add `mostrequestedlive.com`, then at your registrar:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

Check where the apex currently points before cutting over — consider launching on `beta.` first.

---

## Running the show

The producer works from **`/studio`** (password is `STUDIO_KEY`, stored in their browser after the first sign-in). Everything live on the public site is downstream of this screen.

- **Advance** — airs the current song, starts the next. This is the button that drives the night: it updates the on-air display, fires subscriber pings and share cards, posts a system line in the Lounge, and moves the aired song into the archive.
- **Rundown** — add songs, play one out of order, drop one.
- **Incoming requests** — queue a listener request with one click, reply to it (the reply shows on the site), or hide it.
- **Vote** — open a what's-next round for N minutes; closing it queues the winner.
- **Lounge** — post as crew; shows in magenta.
- **Chart tools** — snapshot the week (do this right before the chart resets, so next week's arrows are real) and add crew picks with a weight.

**Run the snapshot weekly.** Without it every song reads as "New" forever. A Vercel Cron hitting `/api/studio` with `{"action":"snapshot"}` and the key header will do it unattended.

---

## API

| Endpoint | Method | What it does |
|---|---|---|
| `/api/health` | GET | Connection and table check. Start here when something's wrong. |
| `/api/state` | GET | Everything the page polls: now playing, rundown, chart, requests, lounge, vote, cities, stats |
| `/api/requests` | GET, POST | Read the wall / submit a request |
| `/api/react` | POST | Like or boost |
| `/api/subscribe` | POST | Ping me when this airs |
| `/api/vote` | POST | Cast or change a vote |
| `/api/lounge` | GET, POST | Chat |
| `/api/archive` | GET | Search what has aired |
| `/api/city` | GET | One city's top songs + 8-week trend |
| `/api/ingest` | POST | Social listening intake (needs `INGEST_KEY`) |
| `/api/studio` | POST | Producer actions (needs `STUDIO_KEY`) |

The front end polls `/api/state` every 4 seconds and backs off to 8 on failure. For a radio show that's the right trade: cheap, bulletproof, and no long-lived connections to babysit on serverless.

### Feeding the social feed

Your worker posts normalised items:

```bash
curl -X POST https://mostrequestedlive.com/api/ingest \
  -H "content-type: application/json" \
  -H "x-mrl-key: $INGEST_KEY" \
  -d '{"posts":[{"text":"Golden by HUNTR/X #MostRequestedLive @onairromeo",
                 "author":"fan","city":"Manila, PH","source":"tiktok"}]}'
```

Posts missing the hashtag or the mention are rejected and counted by reason. See `docs/social-listening-api-spec.md` for which platforms you can read directly — short version: YouTube and Instagram mentions yes, X is pay-per-use polling, TikTok has no public commercial API.

---

## Tests

`test/run.mjs` exercises all eleven endpoints against a real Postgres — 62 assertions covering the request-to-air loop, vote integrity, the tag rule, auth rejection, and input validation.

```bash
DATABASE_URL=... STUDIO_KEY=... INGEST_KEY=... node test/run.mjs
```

It needs the real `pg` package installed (`npm install`) and a database with `db/schema.sql` loaded.

---

## Before launch

- [ ] Clear the seeded sample requests if you want genuine numbers from day one
- [ ] Set a long `STUDIO_KEY` and don't share it outside the booth
- [ ] Schedule the weekly chart snapshot
- [ ] Replace `og-image.png` — the current one uses a substitute typeface; regenerate in Archivo Black at 1200×630
- [ ] Swap the placeholder phone number (`1-877-REQUEST`) and short code (`24242`)
- [ ] Decide on moderation: requests currently post straight to the wall. To hold them for review, change the `status` default in `api/requests.js` from `'approved'` to `'pending'` and approve from the studio.
- [ ] Remove the green demo strip and the `data-inv` sponsor markers in `index.html` before a public launch — they're presentation aids
- [ ] Load-test at 50× weekday traffic. Saturday 7p–12a ET is the only pattern that matters and it's spiky.

## Known limits

- **Polling, not push.** Four-second refresh. Fine for radio; if you want sub-second, move to a hosted realtime service rather than fighting serverless connection limits.
- **No accounts.** Fan cards, streaks and vote identity key off a browser-local ID, so they don't follow a person across devices. Social login is the natural next step and doubles as first-party data capture.
- **Boost and like counts** are per-browser honest, not fraud-proof. Add auth before you publicise that the chart is fan-driven.
- **Notifications** are in-page plus the browser Notification API while the tab is open. Real web push (service worker + VAPID) is the follow-on, and it's what makes the "coming up in two songs" heads-up possible — which is the actual tune-in trigger.
