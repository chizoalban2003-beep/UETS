# Driftworks: Agentic Expansion + Billing

Continuing the approved roadmap. Cron jobs, fair-play guardrails, notifications, and dispute UI are live. Remaining work below.

## 1. Agentic Caretaker expansion

Expand `caretaker-events` (every 30m) and add new edge function `caretaker-scout` (hourly) so the bot acts as a true personal agent across four roles:

- **Scout** — scan open markets vs. user goals/risk profile, write top 3 trade ideas into `caretaker_events` (kind=`trade_idea`).
- **Creator-Coach** — when user opens `MarketNew`, surface a side panel with rule-drafting suggestions and recommended data sources (calls existing `market-review` + a new prompt for source matching).
- **Steward** — for each market the user created, monitor `detect_concentration_risk` + dispute volume; emit `kind=fairness_alert` events with one-tap actions (pause trading, message holders).
- **Advertiser** — once a creator's market reaches "open", caretaker drafts a short pitch and inserts a `kind=market_promo` event into the feed of users whose goals match the topic (matching via simple tag overlap on `markets.tags` ↔ `goals.topics`).
- **Goal-Setter** — weekly job adds `kind=goal_suggestion` events: one personal goal (portfolio target), one platform goal (e.g. "publish 1 sports market").

UI: extend `NotificationsBell` to render action buttons per event kind (Trade, View market, Accept goal, Pause). Add a `/caretaker/agenda` route showing all pending agent suggestions grouped by role.

## 2. Billing (Stripe, test mode)

Use Lovable's seamless Stripe integration.

Tiers (paper-currency §, real subscription in USD):
- **Free** — 25 caretaker actions/day, 1 active created market, standard fees.
- **Pro Trader $9/mo** — 250 actions/day, 3 markets, scout enabled, advanced backtests.
- **Creator Pro $19/mo** — 1000 actions/day, 5 markets, advertiser + steward enabled, 60% creator fee share (vs. 50%).

Implementation:
- New tables: `subscriptions(user_id, tier, status, stripe_customer_id, stripe_sub_id, current_period_end)` and `caretaker_usage(user_id, day, count)`.
- SQL function `consume_caretaker_quota(_user_id, _cost)` — increments daily counter, raises on overage based on tier.
- All caretaker edge functions call `consume_caretaker_quota` before LLM calls.
- New edge functions: `billing-checkout` (creates Stripe Checkout session), `billing-portal` (customer portal), `billing-webhook` (updates `subscriptions` from Stripe events).
- New page `/billing` with tier cards, current plan, manage button, usage meter.

Platform fee: already 1% via `fee_bps` on contracts. Adjust `payout_creator` to read tier and pay 50% or 60% accordingly.

## 3. Polish

- Audit any remaining "ElasticMarkets" / old-name strings → replace with "Driftworks". Run `rg -i "elastic|elasticmarket"` and fix.
- `MarketDetail` — show a "Last data point" timestamp + freshness badge so users see ingestion is live.
- `Caretaker` page — add an "Agenda" tab linking to the new agent suggestions feed.
- Ensure Google OAuth button on `/auth` is wired (verify `signInWithOAuth({provider:'google'})`).

## Technical details

- New migration: `subscriptions`, `caretaker_usage`, `consume_caretaker_quota`, RLS (user reads own rows, service role writes).
- Edit `payout_creator` to branch on tier; default 0.5, Creator Pro 0.6.
- `caretaker-scout` scheduled via `pg_cron` hourly; `caretaker-events` weekly cadence kept at 30m for now and extended with goal/promo logic.
- Stripe enabled via `payments--enable_stripe_payments` (seamless flow — user fills the email form themselves).
- Webhook secret + price IDs stored as Supabase secrets; surfaced via `add_secret` only if the seamless flow doesn't auto-provision them.

## Out of scope (next pass)
- Real-money settlement (paper-currency only).
- Mobile push notifications.
- Multi-language caretaker personalities.

Reply **approve** to proceed, or tell me what to change.
