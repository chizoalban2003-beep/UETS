## Direct answers first

### 1. Should live data + add-ons just appear in the app?
Yes — and they almost do. The ingestion code (`ingest-data`), the lifecycle progressor (`auto-resolve`), and the briefing generator (`caretaker-events`) all exist and work. **What's missing: nothing is calling them on a schedule.** `pg_cron` + `pg_net` are enabled but no jobs are scheduled. That's why you don't see fresh prices appear by themselves. One migration fixes it.

### 2. How does a user create a market without enabling insider trading or malpractice?
The platform is paper-trading credits (no real money), so SEC-style insider trading doesn't apply — but creator self-dealing, market manipulation, and bad-faith resolution do. Defenses we already have, plus what's missing:

| Risk | Already in place | Gap to close |
|---|---|---|
| Creator front-runs their own market | `execute_trade` blocks creator from trading own market | ✅ done |
| Creator picks a fake "final value" | Auto-resolve pulls from the configured data source, not creator input | ✅ done for provider-backed; manual markets need stricter rules |
| Creator pulls funds and runs | 5% cancel penalty, full stake locked until resolved | ✅ done |
| Bad resolution sneaks through | 24h dispute window, 50-credit bond | ✅ done; but no review queue UI for disputes |
| Spam / low-quality markets | Min stake §400, min rules length 20 chars | weak — add cooldown, rules quality check, optional AI review |
| Manipulating the underlying data feed | Provider feeds are reputable third parties | manual-source markets need an "auto-resolve oracle" or human review |
| Wash trading among friends | None | add: cap per-user volume share, flag suspicious patterns in Caretaker briefing |

The Caretaker as the user's "agent" enforcing fair play means: it's the **creator-side co-pilot** that warns about rule ambiguity before publishing, monitors trade flow during the open window for anomalies, and posts a transparency briefing at resolution.

### 3. Billing for you (the platform owner)
Two layers, kept separate:

```text
PLATFORM REVENUE (you earn)            END-USER BILLING (users pay)
─────────────────────────             ─────────────────────────
Subscriptions (Pro tier):              Free tier:
  • Pro Trader §9/mo                     • Paper credits, all markets
    – higher AI quota                    • Caretaker in "teach" mode only
    – live alerts                        • Create up to 1 market/month
    – mobile push                      Pro tier (§9/mo):
  • Creator Pro §19/mo                   • Unlimited markets
    – unlimited markets                  • Caretaker autopilot
    – featured listing                   • Real-time alerts
                                       Creator Pro (§19/mo):
Per-event fees:                          • Featured market slots
  • 1% of all trade volume → platform   • Bot can advertise markets
  • 50% of accrued fees → creator        • Higher API ingestion quota
Caretaker AI usage:
  • Free quota per user (50 msgs/day)
  • Overage billed via Lovable AI credits
                                       Real-capital tier (post-assessment):
                                         • Funded play, future build
```

Implementation: enable Lovable's built-in **Stripe payments** (best fit — you sell digital subscriptions globally; Stripe acts as merchant of record and handles tax). Paddle is also fine. Both let you start in test mode immediately.

The Caretaker AI **does** consume credits via Lovable AI — so yes, **bot capabilities should be billed**, but billed as part of a tier (not metered per message to the user). That's how every modern AI app does it: include a generous quota in each tier, charge overages or upsell.

### 4. Should the bot monitor markets and send notifications?
Yes — and the table `caretaker_events` already exists for this exact purpose. The `caretaker-events` edge function generates them but isn't scheduled. Same fix as live data: add it to cron.

The bot becoming a "personal assistant + market scout + advertiser + fair-play steward" is a real expansion — that's the meatiest part of this plan (section D below).

### 5. What should the product be called?
We renamed to **Driftworks** in the last cycle — "trade the drift from trend." It's already in the `BRAND` constant, the landing page, the header, the auth page, the OG tags. Unless you want to revisit, we keep Driftworks.

If you do want to revisit, three alternatives that fit the metaphor better than ElasticMarkets:
- **Driftworks** (current) — current default; "drift" maps to the elastic-distortion mental model
- **Tideline** — markets as tides that stretch and snap back
- **Snapback** — names the headline contract type directly

I'll keep Driftworks unless you say otherwise.

---

## What I'll build

### A. Make the platform actually live (1 SQL insert)
Schedule three jobs via `pg_cron` + `pg_net`:
- `ingest-data` every **5 minutes** — pulls latest prices/temps/CO₂/etc. for every active data source
- `auto-resolve` every **10 minutes** — advances markets through `pending_resolution → disputable → resolved`
- `caretaker-events` every **30 minutes** — generates PRE/DURING/POST briefings into the user's notification feed

Done via the Supabase **insert tool** (not migration) because the SQL needs the project's URL and anon key inline.

### B. Fair-play guardrails for creators (DB + 1 edge function)
1. **Pre-publish AI review** — when a creator hits "Submit", run an edge function `market-review` that uses Lovable AI to grade the rules markdown for ambiguity, returns a 1-5 score and concrete suggestions. Below 3 = block submission with feedback. Above 3 = allow.
2. **Cooldown** — DB trigger: a user can't have more than 3 markets in `open` status at once, and can't submit two markets within 5 minutes.
3. **Wash-trade detector** — extend `caretaker-events` to flag if any single non-creator user holds >40% of a contract's outstanding shares. Posts an alert to the creator's feed.
4. **Dispute review UI** — new tab on `/markets/mine` showing disputes raised on your markets, with the option to amend the final value (which extends the dispute window by 24h).

### C. Notifications & alerts (1 component + push opt-in)
- Header bell icon with unread count from `caretaker_events`
- `/notifications` page listing all events with mark-as-read
- Browser-push opt-in for Pro tier (uses the Notifications API; no SW infra needed for MVP)
- The bot writes events when: a watched market crosses the band, your position moves >10%, your goal hits its deadline, a market you created gets disputed

### D. Agentic bot expansion (the big piece — 3 edge functions + 1 page)

The Caretaker today: chat + tools to execute trades. The Caretaker tomorrow:

```text
┌─────────────────────── CARETAKER (per user) ──────────────────────┐
│                                                                   │
│  SCOUT (every 30 min, scheduled)                                  │
│  ├─ scans all open markets, scores by elasticity vs user's goals  │
│  ├─ writes top-3 candidates to caretaker_events                   │
│  └─ if mode = autopilot, places a small probe trade               │
│                                                                   │
│  CREATOR-COACH (on demand from /markets/new)                      │
│  ├─ given a topic, suggests dataset + provider + trend model      │
│  ├─ drafts the rules_md for the user to edit                      │
│  └─ estimates expected liquidity from similar past markets        │
│                                                                   │
│  STEWARD (when user is a market creator)                          │
│  ├─ posts daily transparency briefing on each open market         │
│  ├─ flags wash-trade patterns and concentration risk              │
│  └─ recommends amendments if disputes are raised                  │
│                                                                   │
│  ADVERTISER (Creator-Pro tier only)                               │
│  ├─ writes a 1-line pitch for newly-published markets             │
│  └─ surfaces them in other users' "discover" feed (with badge)    │
│                                                                   │
│  GOAL-SETTER (weekly, scheduled)                                  │
│  ├─ proposes one user goal, one portfolio goal, one platform goal │
│  └─ user accepts/rejects from /goals                              │
└───────────────────────────────────────────────────────────────────┘
```

New edge functions: `caretaker-scout`, `caretaker-creator-coach`, `caretaker-steward`. Each gets a cron entry. Each writes to `caretaker_events`. None of them ever hit real money or bypass RLS.

### E. Billing layer
1. Run `recommend_payment_provider` to confirm Stripe is the best fit (digital subscriptions + global)
2. Enable built-in Stripe payments in **test mode** (no account needed yet)
3. Create three products: **Free**, **Pro Trader §9/mo**, **Creator Pro §19/mo**
4. Add a `subscriptions` table mirroring Stripe state via webhook
5. Gate features in code: `requireTier('pro')` middleware on edge functions, conditional UI on pages
6. **Caretaker AI quota**: 50 messages/day free, 500/day Pro, unlimited Creator Pro — counted in `profiles.caretaker_msgs_today` reset by daily cron

Will ask for your confirmation before flipping the live switch — test mode is enough for development.

### F. Brand & smoke test
- Confirm Driftworks naming everywhere (already done; one final scan)
- Walk through the live app once after sign-in: create draft market → publish → watch ingestion run → confirm caretaker briefing appears → confirm notification bell updates

---

## Technical notes

- **Cron SQL** uses `net.http_post` to the deployed edge function URL with the anon key in headers. Per project rules, this goes through the **insert tool**, not a migration, so the URL and key don't leak into remixes.
- **Pre-publish review** uses `google/gemini-3-flash-preview` via Lovable AI gateway — fast, cheap, structured output via tool calling.
- **Wash-trade detection** is a SQL view + threshold check in `caretaker-events`; no ML required for v1.
- **Notifications bell** reads `caretaker_events` via Supabase Realtime channel — instant updates, no polling.
- **Subscriptions table** is the canonical source of truth; Stripe webhook updates it. Frontend reads only this table, never Stripe directly.
- **Quota enforcement**: small atomic SQL function `consume_caretaker_quota(user_id) returns boolean` called at the top of `caretaker-chat`.
- **Creator cooldown**: `BEFORE INSERT/UPDATE OF status` trigger on `markets`, raises if violated.
- All new edge functions deploy automatically. No new env vars needed beyond what's already set.

---

## Order of operations (so you can review at each step)

1. **Schedule the cron jobs** (live data starts flowing)
2. **Add notifications bell + page**
3. **Pre-publish AI review + creator cooldown**
4. **Caretaker scout + creator-coach + steward** (the agentic upgrade)
5. **Stripe billing in test mode** (after you confirm Stripe vs Paddle)
6. **Final smoke test + brand sweep**

I'll pause after step 1 so you can confirm fresh data lands in `market_data_points` before I push further. If anything fails, we fix it before adding more surface area.