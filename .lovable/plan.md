## Concept

Every market is built on a **trend** treated as an elastic object. Creators define:
- a **dataset or event series** (uploaded CSV, manual points, or a pluggable feed),
- a **baseline trend model** (linear regression, moving average, exponential, or custom function),
- an **elasticity band** (the "natural" range around the trend).

Traders take positions on whether the next observation(s) will **stretch above**, **compress below**, or **stay within** the band. A single market generates two natural instruments:
- **Distortion contracts** — pay out proportional to how far the actual value deviates from the modeled trend at resolution time (scalar).
- **Snap-back contracts** — pay out if the series returns inside the band within a window (binary).

This gives the platform one coherent mental model for any dataset with an obvious trend (prices, KPIs, sports stats, weather, on-chain metrics, etc.).

## Scope for v1

Tightly integrated platform + bot, paper-trading only, money-agnostic ledger so any payment rail can plug in later.

### 1. Accounts & wallet ledger
- Email + Google sign-in.
- Each user gets a virtual wallet with starting balance (e.g. 10,000 units).
- Generic `ledger_entries` table records every credit/debit with a reason (deposit, trade, settlement, fee, bot action). Real-money rails attach later by minting/burning entries.

### 2. Markets
- **Create market** wizard:
  1. Name, description, category.
  2. Data source — paste/upload time series, or define an event with manual resolution.
  3. Pick a trend model (linear, MA, exponential, custom expression).
  4. Set elasticity band width (absolute or % of trend).
  5. Resolution date and oracle (manual creator confirmation in v1; pluggable feed adapter later).
- **Market page** shows:
  - Live chart with actual series, fitted trend, elasticity band, current "distortion" indicator.
  - Order book / AMM price for distortion and snap-back contracts.
  - Position & P&L for the logged-in user.

### 3. Trading engine
- Start with a **constant-product AMM** per contract (simple, no order matching needed).
- Buy/sell against the pool; fees go to a market reserve.
- Settlement at resolution: contracts pay out from the reserve based on final distortion vs band.

### 4. AI trading bot
One bot per user, configurable per market:
- **Mode**: Suggest / Approve / Full Auto.
- **Risk limits**: max position size, max daily loss, allowed markets.
- **Strategy presets**: Mean-reversion (bet on snap-back when distortion is high), Momentum (bet on continued stretch), Custom (user describes strategy in plain English; AI interprets).
- The bot:
  1. Pulls latest series + trend model for each enabled market.
  2. Calls the AI gateway with market state + strategy to produce a recommendation (action, size, rationale, confidence).
  3. **Suggest** → shows in a feed.
  4. **Approve** → notification; user one-clicks accept/reject.
  5. **Auto** → executes within risk limits, logs everything.
- **Reporting**: per-bot dashboard with trade log, rationale per trade, realized/unrealized P&L, win rate, exposure, drawdown, strategy summary.

### 5. Core pages
- `/` — landing + featured markets.
- `/markets` — browse/search.
- `/markets/:id` — market detail, chart, trade panel.
- `/markets/new` — create market wizard.
- `/portfolio` — wallet, open positions, history.
- `/bot` — bot config, mode toggle, suggestion feed, performance reports.
- `/auth` — sign in/up.

### 6. Out of scope for v1 (called out so we can sequence later)
- Real money / KYC / regulatory work.
- Live external data feeds (we ship CSV upload + manual entry; adapter interface ready).
- Order book matching, limit orders, margin.
- Multi-bot strategies, backtesting on historical data.

## UX & visual direction

Trading-app feel but approachable: dark theme, monospace for numbers, large clear charts (Recharts), green/red only for P&L, neutral palette elsewhere. Each market card shows a sparkline with the elasticity band shaded so the "elastic" metaphor is visible everywhere.

## Technical notes

- Frontend: React + Vite + Tailwind + shadcn (existing stack).
- Backend: Lovable Cloud (Supabase) — auth, Postgres, edge functions.
- AI: Lovable AI Gateway (default `google/gemini-3-flash-preview`) inside an edge function for bot reasoning + structured output via tool calling.
- Tables (high level): `profiles`, `user_roles`, `wallets`, `ledger_entries`, `markets`, `market_data_points`, `contracts` (distortion + snap-back per market), `pools` (AMM state), `positions`, `trades`, `bots`, `bot_configs`, `bot_suggestions`, `bot_trades`. Roles in a separate `user_roles` table with `has_role()` SECURITY DEFINER function.
- RLS everywhere; ledger writes only via SECURITY DEFINER functions so balances can't be forged.
- Trend fitting + distortion calc done in a Postgres function or edge function so both UI and bot see the same numbers.
- Cron-triggered edge function evaluates open markets, runs bot strategies, and posts suggestions/trades.

## Build order

1. Auth + wallet ledger + roles.
2. Market schema + create wizard + market detail page with chart, trend, band (no trading yet).
3. AMM contracts + trade panel + portfolio.
4. Resolution + settlement flow.
5. Bot: config UI, suggestion engine, suggest mode.
6. Approve mode + notifications.
7. Full-auto mode + risk limits + reporting dashboard.

After v1 is solid we can layer on real-money rails, live data feeds, and richer market types.
