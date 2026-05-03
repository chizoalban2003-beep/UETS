# Driftworks v2: Live Sources, Event Markets, Creator Revenue & Fair-Play

You asked four overlapping things. Short answers first, then the build plan.

## Quick answers

1. **Live data from eToro / Kalshi / Polymarket** — Yes, with caveats.
   - **Kalshi & Polymarket**: public REST APIs. We can mirror their YES/NO mid-prices as a "data feed" (we don't route trades there — Driftworks markets *track* their prices). Good for prediction-market-on-prediction-market.
   - **eToro**: no public market-data API. We proxy via Yahoo Finance / Twelve Data for the same tickers (stocks, ETFs, FX, crypto). Already partly done via `yahoo` provider — we extend it.
   - **Real brokerages**: out of scope; Driftworks stays paper-currency.

2. **Users creating & publishing markets as revenue** — Already wired (creator stake + fee share). We add:
   - **Event-based markets** (not just time-series): "Will X happen by Y?" resolved by a chosen oracle (Kalshi outcome, sports score, manual + dispute window).
   - **Creator marketplace page** so creators get discovery → more volume → more fees.
   - Tiered fee shares: Free 50%, Creator Pro 60%, plus a new **Creator Elite** at 70% (next tier).

3. **Should bot capabilities and market creation be billed?** — Yes, and they already partly are. Refining:
   - **Bot usage** stays metered by the existing caretaker quota (Free 25 / Pro 250 / Elite 1000 actions/day).
   - **Market creation** is gated by tier (active markets cap) and by **creator stake** (skin in the game). No per-market fee — instead, platform takes 1% of trade volume (already in place via `fee_bps`).
   - New: **Premium event oracles** (Kalshi mirroring, sports feeds) cost extra creation credits — bundled in paid tiers.

4. **Time-period markets vs event markets** — Support **both**:
   - **Time-series** (existing): "BTC price distortion vs trend by Dec 31". Auto-resolved by ingest.
   - **Event** (new): "Will the Fed cut rates in Jan?" — resolved at a fixed event date by an oracle (Kalshi outcome / manual + dispute), pays YES/NO at $1/$0.

## What to build

### A. New data providers
- `kalshi` provider — fetch market by ticker, mirror YES price (0–1) as the data point. Use public `https://api.elections.kalshi.com/trade-api/v2/markets/{ticker}`.
- `polymarket` provider — already declared but not implemented. Fetch via `https://gamma-api.polymarket.com/markets?slug=...`, store mid-price.
- `twelvedata` provider — stocks/FX/ETFs/crypto with one API. Add `TWELVEDATA_API_KEY` secret (free tier OK). Wraps "eToro-style" assets.
- Extend `ingest-data` edge function with handlers for the three above.
- Add templates in `src/lib/providers.ts`: SPY, QQQ, EUR/USD (twelvedata); top 5 Kalshi political markets; top 5 Polymarket sports/news markets.

### B. Event-based markets
- New column `markets.market_kind` enum (`time_series`, `event`). Default `time_series`.
- New columns: `event_oracle_kind` (`kalshi`, `polymarket`, `manual`, `sports_api`), `event_oracle_ref` (text, e.g. Kalshi ticker), `event_outcome` (boolean nullable).
- Contracts for event markets: single `binary` contract instead of `distortion`/`snapback`. Update `handle_new_market` trigger to branch on `market_kind`.
- New SQL: `resolve_event_market(_market_id, _outcome bool)` — pays $1 to YES holders if true, NO holders if false.
- Edge function `event-resolve` runs hourly via cron, polls oracles, calls resolver when event date passes.
- `MarketNew.tsx`: add a "Market type" toggle (Time-series / Event) and an oracle picker for events.

### C. Creator marketplace + revenue polish
- New page `/marketplace` listing top-grossing markets, with filters by category and creator. Shows fees-accrued and creator earnings (anonymized).
- New `Creator Elite` tier ($39/mo): 5000 caretaker actions, 10 active markets, 70% fee share, premium oracle access (Kalshi/Polymarket templates). Add Stripe price.
- `payout_creator`: extend share table — Free 50%, Pro 50%, Creator Pro 60%, Creator Elite 70%.
- Creator dashboard widget on `/markets/mine`: lifetime fees, payouts claimed, top market.

### D. Fair-play & security guardrails
- **Concentration alerts** (already exist via `detect_concentration_risk`) — wire into Steward agent so it auto-pauses trading when one wallet holds >60% of either side.
- **Insider trading guard**: prevent the creator from trading their own market (already enforced in `execute_trade`); extend to "creator's bot" by checking `bots.user_id`.
- **Oracle reliability score**: track resolution success per oracle; downrank flaky ones in templates.
- **Dispute window**: already wired (`disputable` status, `raise_dispute`). Add a UI badge on `MarketDetail` showing time left to dispute.
- **Manipulation detection**: edge function `caretaker-fairness` (hourly cron) flags markets where last-minute volume spikes >5x average and posts a `fairness_alert` event.
- **Rate limits**: enforce `enforce_market_creation_limits` already covers cap; add a soft-rate-limit on trades (max 50 trades/min per user) via a new SQL trigger.

### E. Bot management
- Bots remain user-owned. Refinements:
  - Bot can only trade markets in `bots.enabled_market_ids`.
  - Bot trades count toward caretaker quota (`by_bot=true` calls `consume_caretaker_quota`).
  - New "Bot leaderboard" page showing top-PnL bots (opt-in by user) — promotes paid tiers.

## Technical details

- Migration `add_event_markets`: add enums, columns, `resolve_event_market` function, update trigger.
- Migration `creator_elite_tier`: extend `sub_tier` enum with `creator_elite`, update quota function, update `payout_creator`.
- Edge functions: `event-resolve`, `caretaker-fairness`, extend `ingest-data` with kalshi/polymarket/twelvedata handlers.
- Cron jobs (added via insert tool, not migration):
  - `event-resolve` every 15 min
  - `caretaker-fairness` every hour
- Secrets to request: `TWELVEDATA_API_KEY` (free tier).
- Stripe: add `creator_elite_monthly` $39/mo via `payments--batch_create_product`.
- Frontend pages: `/marketplace`, updated `/market/new` with type toggle, `/bots/leaderboard` (opt-in).

## Out of scope (next pass)
- Real brokerage routing.
- Sports score live API (uses manual oracle until we pick a provider).
- Multi-outcome (>2) event markets.

Reply **approve** to proceed, or tell me what to adjust (e.g. drop Creator Elite tier, skip Polymarket, defer marketplace page).