# Most Requested Live — website

Concept build for **Most Requested Live Worldwide with Romeo**, the syndicated Saturday-night request show.

Static site, no build step, no dependencies. Every page is self-contained HTML/CSS/JS, so it deploys to Vercel as-is and will still run if you open `index.html` directly from disk.

> **Note:** all chart positions, requests, Lounge chat, listener counts and city data are **sample data** generated in-browser for demonstration. The interview episodes are real, pulled from the public YouTube channel and podcast feed. See [Going live](#going-live) for what has to be wired up before launch.

---

## Contents

| File | What it is |
|---|---|
| `index.html` | The whole listener-facing site — globe, live request feed, Top 20, rundown, The Lounge, The Zone, City Cup, interviews, gallery, archive |
| `affiliates.html` | Affiliate/station sales area — clock, specs, imaging assets, station list, clearance form |
| `404.html` | Dead air page |
| `og-image.png` | Social share preview, 1200×630 |
| `favicon.svg` | Icon |
| `vercel.json` | Clean URLs, security headers, cache policy |
| `docs/social-listening-api-spec.md` | Spec for the live social-listening request feed |

---

## Deploy

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Most Requested Live — initial site"
git branch -M main
git remote add origin https://github.com/YOUR-ORG/mostrequestedlive.git
git push -u origin main
```

(Or just drag these files into a new repo via the GitHub web uploader — there's no build output to worry about.)

### 2. Import to Vercel

1. [vercel.com/new](https://vercel.com/new) → **Import Git Repository** → pick the repo
2. Framework Preset: **Other**
3. Build Command: *leave empty*
4. Output Directory: *leave empty* (repo root is served)
5. **Deploy**

You'll get a `*.vercel.app` URL in about twenty seconds. Every push to `main` redeploys; every pull request gets its own preview URL, which is a good way to share revisions without touching the live link.

### 3. Custom domain

Vercel → Project → **Settings → Domains** → add `mostrequestedlive.com`.

Then at your registrar:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | `76.76.21.21` |
| `CNAME` | `www` | `cname.vercel-dns.com` |

SSL provisions automatically. **Check whether the apex domain currently points at the iHeart page before you cut over** — you may want to launch on a subdomain like `beta.mostrequestedlive.com` first.

---

## Before you share the link

- [ ] Replace `og-image.png` — the current one uses a substitute typeface because the brand fonts weren't reachable from the build environment. Regenerate it in Archivo Black at 1200×630.
- [ ] Search and replace `https://mostrequestedlive.com` in `sitemap.xml`, `robots.txt` and the `og:` tags if you deploy to a different hostname.
- [ ] Swap the placeholder phone number `1-877-REQUEST` and the short code `24242`.
- [ ] Decide whether `affiliates.html` should be public. It currently carries `noindex`, but it's reachable from the footer and main nav.

---

## Going live

The site is a working front end. These are the back-end pieces it assumes exist:

**1. A rundown tool.** The single biggest dependency, and it doesn't exist yet. The live playhead, the "notify me when this airs" bells, the share cards and the Lounge's song changes all fire from one source of truth: a producer in the booth marking what's playing. Everything live on this site is downstream of that.

**2. Social listening ingestion.** See `docs/social-listening-api-spec.md`. Short version: YouTube and Instagram mention-webhooks are directly accessible, X is pay-per-use polling, and TikTok has no public commercial API — scope it to comments on your own videos or license a vendor.

**3. Content feeds.** Interviews are currently a static array in `index.html`. In production, pull:
- YouTube: `https://www.youtube.com/feeds/videos.xml?channel_id=UCeAP3SwnmOlB9d4E38Pz42A`
- Podcast: the *Most Requested Live Interviews* RSS feed

Parse `title`, `pubDate`, `itunes:duration` and `media:thumbnail`. The artist name is extractable from the title convention (`[Artist] chats with #MostRequestedLive!`) with a regex — the cards lead with artist name rather than full title, because nine identically-titled episodes in a grid are unreadable.

**4. Request storage + chart computation.** Postgres for requests and the archive; Redis sorted sets for the rolling live windows.

**5. Notifications.** Web push for the "coming up in two songs" heads-up, which is the actual tune-in trigger. The at-air notification is what delivers the share card.

**6. Auth.** Fan cards, streaks, boost limits and the City Cup all need identity. Social login is the lowest-friction path and it doubles as a first-party data capture.

---

## Suggested production stack

Next.js on Vercel, a headless CMS (Sanity or Payload) for the rundown, gallery and editorial, Postgres for requests and song history, Redis for live counters, and SSE for the live feed — not WebSocket, since the traffic is one-directional and SSE reconnects natively and survives CDNs.

Load-test at 50× weekday volume. Saturday 7p–12a ET is the only traffic pattern that matters, and it's spiky.

---

## Sponsor inventory

The demo strip at the top has a **Show sponsor inventory** toggle that annotates the sellable units in place: Top 20 presented-by, hour sponsorships, Lounge presenting sponsor, branded ballot, interview presenting sponsor, the share-card co-brand, and the first-party data capture at the composer. It's a presentation aid — remove the `.demobar` block and the `.inv` / `data-inv` attributes before public launch.

---

*Concept prototype. Sample data throughout except where noted.*
