# Live Request Feed — Social Listening API

**Purpose:** surface the top 5 requested songs per platform, in near-real-time, from public social posts that contain both `#MostRequestedLive` and `@onairromeo`.

---

## 1. Platform reality check (read this first — verified Aug 2026)

The hard constraint isn't your architecture, it's what each platform will actually sell you. Verify these again before contracting; X has changed its model twice in 2026 alone.

| Platform | Direct access? | What you can actually do |
|---|---|---|
| **YouTube** | **Yes** | Data API v3 for comment threads on your own videos, plus the Live Chat API during premieres. Generous free quota. Fully direct. |
| **Instagram** | **Yes, via mentions** | `mentioned_media` + `mentioned_comment` webhooks fire whenever someone @mentions your Professional account in a caption or comment. Since `@onairromeo` is mandatory, this is your primary IG channel. Hashtag Search is the weak backup: 30 unique hashtags per rolling 7 days, recent_media limited to the last 24 hours, and it won't return the poster's username. |
| **X** | **Partially** | Filtered stream is Pro/Enterprise only, and **Pro closed to new signups in Feb 2026**. Enterprise starts around $42K/month. Self-serve is now pay-per-use: ~$0.005 per read, 7-day recent search, 2M reads/month cap. **Poll recent search every 15–30s instead of streaming.** |
| **TikTok** | **No** | The Research API explicitly excludes commercial users, creators, and advertisers — no application will fix this. The Display API only reaches the authenticated user's own content. There is no public hashtag search. |

**Two consequences that change the design:**

1. **Requiring `@onairromeo` is an asset, not a tax.** It's the only thing that makes Instagram work directly — mention webhooks are account-scoped and push in real time, while hashtag search is rate-crippled and anonymized. Ignore my earlier suggestion to soften the mention requirement; keep it mandatory.

2. **"Real-time" is polling, not streaming, everywhere except YouTube live chat.** Design the UI around a 15–30s sync (which the site already displays honestly) rather than promising instant. X's own filtered stream documents ~6–7s P99 latency anyway, so the perceptual difference is small.

For TikTok you have three options, in descending order of defensibility: license a listening vendor with a TikTok data partnership (Brandwatch, Talkwalker, Sprinklr, Meltwater); use a third-party wrapper API, which is a terms-of-service risk your legal team should sign off on; or **scope TikTok to your own content** — comments on your weekly request video, which you control and can read. The third option is free, clean, and probably captures most of your TikTok request volume anyway, since that's where fans are already commenting.

Design every source as a **normalized adapter** so swapping a vendor touches one file.

## 2. Architecture

```
X Filtered Stream ─┐
YouTube Poller ────┤
IG Graph Poller ───┼──► Normalizer ──► Eligibility Gate ──► Song Resolver ──► Redis
Vendor Webhook ────┘         │              │                    │          (rolling
(TikTok + IG)                │              │                    │          60-min
                             │              │                    │          windows)
                        canonical      requires BOTH        fuzzy match         │
                         schema        tag + mention        to catalog           ▼
                                            │                              Public API
                                            ▼                                   │
                                      dropped_posts                             ▼
                                       (counted,                          Site + on-air
                                        not scored)                        dashboard
```

**Storage:** Redis sorted sets for the live windows (`ZINCRBY`), Postgres for durable post history and the archive. Windows are cheap to recompute; don't over-engineer.

---

## 3. Eligibility gate

A post scores **only if all of these pass:**

1. Text contains `#MostRequestedLive` (case-insensitive) **and** `@onairromeo`
2. Post is public
3. Author is not on the block list
4. Not a duplicate — same author + same song within 10 minutes collapses to one
5. Passes moderation (profanity, spam-pattern, and rate heuristics)

Everything failing #1 goes to `dropped_posts` with a reason code. **Surface that count publicly** — the site shows "dropped, missing tag or mention." It teaches the rule better than any instruction copy, and it makes the requirement feel enforced rather than decorative.

Anti-gaming, since a public chart with a public rule will get gamed:
- Cap one scored request per author per song per hour
- Weight by account age and follower authenticity signal
- Flag coordinated bursts (same phrasing, >N posts, <M seconds) for manual review
- Keep raw counts and scored counts separate; publish scored, retain raw

---

## 4. Song resolution

The hardest unglamorous problem. `"pls play espresso 😩"` has to become `track:sabrina-carpenter-espresso`.

1. Regex the common patterns first (`play X by Y`, `X - Y`, `requesting X`)
2. Fuzzy match against a catalog seeded from your own archive plus a music metadata provider (Spotify Search API or MusicBrainz)
3. Confidence ≥ 0.75 auto-resolves; 0.45–0.75 goes to a producer review queue; below that is unresolved
4. Cache every resolution — your audience requests the same 200 songs constantly, so hit rates get good fast

Route the review queue into the crew's existing workflow. Producers correcting matches during the show is a feature, not overhead: it's how "crew picks" enter the chart legitimately.

---

## 5. Public endpoints

### `GET /v1/feed/live`
Top N per platform for the current window.

```
?window=60m        // 15m | 60m | 24h | show
&limit=5
&platforms=tiktok,instagram,x,youtube
```

```json
{
  "window": { "type": "60m", "opened_at": "2026-08-15T22:00:00Z", "synced_at": "2026-08-15T22:59:45Z" },
  "platforms": [
    {
      "platform": "tiktok",
      "eligible_total": 18422,
      "dropped_total": 1204,
      "coverage": "vendor",
      "top": [
        { "rank": 1, "track_id": "trk_8812", "title": "Ordinary", "artist": "Alex Warren",
          "count": 4180, "delta_15m": 312, "trend": "up" }
      ]
    }
  ]
}
```

`coverage` is `direct` or `vendor` — be honest in the payload about where each number came from.

### `GET /v1/feed/stream`
Server-Sent Events. Emits `request.scored`, `rank.changed`, `window.rolled`. Use SSE over WebSocket: it's one-directional, reconnects natively, and survives CDNs.

### `GET /v1/chart/top20`
The weekly chart. Each entry carries `source: "fan" | "crew"` and `request_count`, which is what powers the honesty tags on the site.

### `POST /v1/requests`
On-site requests from The Zone. Server appends the required tag and mention so a web request is counted identically to a social one.

### `GET /v1/archive/songs`
Search across historical airplay. `?q=&from=&to=&hour=`

---

## 6. Rate, cache, and cost control

- Public reads cached 10s at the edge; the UI polls every 15s, so cache hit rate approaches 100% regardless of audience size
- SSE connections capped per IP
- Vendor calls are the expensive path — never let a page view trigger one. Ingestion writes; the API only reads Redis
- On Saturday nights expect 10–40× weekday volume. Load test at 50× before your first live show

---

## 7. Build order

1. **YouTube + on-site requests only.** Cheapest, fully direct, no procurement. Proves the pipeline end to end.
2. **Instagram mention webhooks.** Requires Meta App Review and a Professional account — start the review early, it's the long pole.
3. **X pay-per-use polling.** Recent search on a 15–30s loop. Budget against the 2M read cap.
4. **Song resolver + producer review queue.** Now the chart can be automated.
5. **TikTok — own-content comments first.** Free and immediate. Only pursue a vendor if coverage proves inadequate.
6. **Anti-gaming and moderation hardening.** Before you publicize that the chart is fan-driven.

---

*Concept spec — figures and endpoint shapes are illustrative and meant as a starting point for engineering scoping.*
