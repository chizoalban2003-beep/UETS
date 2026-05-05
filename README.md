# Driftworks

**Trade the drift from trend. Hedge the snap-back. Let an AI Caretaker run the playbook.**

Driftworks is a full-stack prediction-market platform built on the *elastic-trend metaphor*. Any time-series dataset — price feeds, weather, CO₂, on-chain metrics — becomes a tradable market. Two instruments are created per market:

| Instrument | Payout |
|---|---|
| **Distortion** | Scalar (0→1) proportional to how far the final value lands *outside* the elasticity band |
| **Snap-back** | Binary — does the final value finish *inside* the band? |

Pricing uses a constant-product AMM (x·y=k). There's no order book.

---

## Tech stack

| Layer | Tech |
|---|---|
| Frontend | React 18, Vite, TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| Backend | Supabase (Postgres + RLS + Realtime) |
| Edge functions | Deno (19 functions) |
| AI | Lovable AI Gateway (LLM tool-calling, SSE streaming) |
| Payments | Stripe Embedded Checkout |
| Auth | Supabase Auth (email/password + magic link) |

---

## Local development

### Prerequisites

- Node.js ≥ 18 or Bun
- Supabase CLI (`npm i -g supabase`)
- A Supabase project (free tier works)
- A Lovable AI Gateway API key
- A Stripe account (test mode)

### 1. Clone and install

```bash
git clone https://github.com/chizoalban2003-beep/UETS.git
cd UETS
npm install          # or: bun install
```

### 2. Environment variables

Copy `.env.development` and fill in your values:

```bash
cp .env.development .env.local
```

Required variables:

```
VITE_SUPABASE_URL=https://<project>.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=<anon-key>
```

Edge function secrets (set via `supabase secrets set`):

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
LOVABLE_API_KEY
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
```

### 3. Database migrations

```bash
supabase db push
```

### 4. Start the dev server

```bash
npm run dev
# or: bun dev
```

Open [http://localhost:8080](http://localhost:8080).

---

## Project structure

```
src/
  pages/          # Route-level pages (Markets, MarketDetail, Bot, Caretaker, …)
  components/     # Shared components (Layout, ThemeToggle, NotificationsBell, …)
  hooks/          # useAuth, use-mobile, use-toast
  lib/
    trend.ts      # Pure AMM + trend-fitting math (unit-tested)
    caretakerStream.ts  # SSE client for AI chat
    brand.ts, stripe.ts, providers.ts
  integrations/
    supabase/     # Client + generated types
supabase/
  migrations/     # Postgres migrations (18 files)
  functions/      # Deno edge functions (19 functions)
    _shared/
      trend.ts    # Shared trend math for edge functions
```

---

## Key pages

| Route | Description |
|---|---|
| `/` | Landing — hero + elastic-band demo chart |
| `/markets` | Browse/search all markets |
| `/marketplace` | Top markets by fees + activity |
| `/markets/new` | Create a market with trend model + data source |
| `/markets/:id` | Chart, stats, AMM trade panel, dispute flow |
| `/portfolio` | Wallet balance, equity curve, positions, CSV export |
| `/bot` | Trading bot configuration and suggestion feed |
| `/caretaker` | AI co-pilot chat + event journal |
| `/goals` | Trading goals with Caretaker integration |
| `/backtest` | Replay bot strategy on historical data |
| `/reports` | AI-generated performance reports |
| `/assessment` | Two-stage real-capital readiness gate |
| `/billing` | Stripe subscription management |
| `/leaderboard` | Public trader rankings |
| `/admin` | Admin console — disputes + market review (admin role required) |

---

## Subscription tiers

| Tier | Price | Caretaker actions/day | Markets |
|---|---|---|---|
| Free | $0 | 25 | 1 |
| Pro Trader | $9/mo | 250 | 3 |
| Creator Pro | $19/mo | 1,000 | 5 |
| Creator Elite | $39/mo | 5,000 | 10 |

Use Stripe test card `4242 4242 4242 4242` with any future date and CVC.

---

## Edge functions

| Function | Purpose |
|---|---|
| `caretaker-chat` | SSE streaming AI chat with 20+ tools |
| `caretaker-execute` | Execute approved Caretaker tool calls |
| `caretaker-events` | Generate pre/post-event briefings |
| `caretaker-scout` | Proactive market scanning |
| `bot-run` | Generate trade suggestions |
| `bot-backtest` | Replay strategy on historical data |
| `ingest-data` | Oracle data ingestion (price feeds, weather) |
| `auto-resolve` | Market lifecycle automation |
| `market-submit` | Publish market with creator stake |
| `market-review` | Submit market for admin review |
| `market-cancel` | Cancel a market (with penalty) |
| `raise-dispute` | Raise a dispute with $50 bond |
| `event-resolve` | Resolve a market event |
| `creator-payout` | Claim creator stake + fees |
| `generate-report` | AI-generated performance report |
| `assessment-grade-quiz` | Score the literacy quiz |
| `assessment-sim` | Run the bot-graded simulation |
| `billing-checkout` | Create Stripe Checkout session |
| `billing-portal` | Open Stripe billing portal |
| `payments-webhook` | Handle Stripe webhooks |
| `reset-paper-balance` | Reset paper balance (rate-limited) |
| `test-oracle` | Test a custom oracle URL |

---

## Running tests

```bash
npm run test          # run once
npm run test:watch    # watch mode
```

Tests live in `src/test/`. The trend math library (`src/lib/trend.ts`) is fully unit-tested.

---

## Architecture notes

- All DB mutations go through Supabase RPC or SECURITY DEFINER functions — the client never writes directly to sensitive tables.
- Row-level security is enabled on all tables. Users can only read/write their own data.
- The AMM is a standard constant-product market maker: `reserve_yes × reserve_no = k`. Fees (default 100bps) are applied on top of the quoted cost.
- The Caretaker AI has read-only and mutating tool groups. In non-autopilot mode, mutating tools return as pending-approval cards requiring explicit user confirmation.
- Goal progress is tracked by a Postgres trigger on the `wallets` table — goals auto-advance to `achieved` or `failed` when balance thresholds are crossed.
- Daily wallet snapshots are recorded via `record_wallet_snapshot()` to power the portfolio equity curve.

---

## Roadmap

- [ ] Real-capital staking rails (post-assessment)  
- [ ] Push notifications (web push / email via Resend)  
- [ ] Premium oracle integrations (Kalshi, Polymarket)  
- [ ] Social features: creator profiles, follow system  
- [ ] Mobile app  

---

*Paper-trading sandbox tracking real-world data. Real capital unlocks after passing the assessment.*
