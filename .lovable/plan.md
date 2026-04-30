
# Driftworks: rebrand, demo polish, backtest, hedging, real-capital assessment

## Goals
1. Rebrand the app to **Driftworks**.
2. Make it obvious this is a demo with paper money tracking real-world data, with a reset.
3. Give users (and the Caretaker bot) a way to backtest the bot against historical data.
4. Give users a portfolio view with net exposure and Caretaker-driven cross-market hedge suggestions.
5. Add a staged **Real-Capital Readiness Assessment** (literacy quiz → bot-graded simulation → eligibility flag).
6. Run a backend smoke test of the existing system and report what works.

---

## 1. Rebrand to Driftworks
- `index.html`: title and meta description.
- `src/components/Layout.tsx`: header logo/wordmark to "Driftworks", tagline "Trade the drift from trend".
- `src/pages/Landing.tsx`: hero copy, feature blurbs.
- Add a small `BRAND` constant in `src/lib/brand.ts` so future renames are one-line.
- No DB changes.

## 2. Demo Mode + Paper Balance Reset
- **Demo badge**: persistent pill in the header ("Demo · Paper Capital") with a tooltip explaining "Real-world market data, paper money. Real-capital staking unlocks after assessment."
- **Onboarding tour** (first login): 3-step popover hitting Markets → Bot → Caretaker.
- **Reset paper balance**: button in Portfolio → Settings area.
  - New edge function `reset-paper-balance`: closes open positions at current AMM mid, zeroes positions, resets wallet to §10,000, writes a `ledger_entries` row with reason `signup_bonus` and note "demo reset".
  - Rate-limit: max 1 reset per 24h (check last reset ledger entry server-side).

## 3. Bot Backtest
- New page `src/pages/Backtest.tsx` at `/backtest`.
- New edge function `bot-backtest`:
  - Inputs: `market_ids[]`, `lookback_days`, `strategy`, `max_position_size`.
  - For each market, walks `market_data_points` chronologically, simulates the same decision logic as `bot-run` against the AMM state at each tick (re-derive prices from data, not from current reserves), and produces a trade timeline + cumulative P&L.
  - Returns: per-market series, aggregate P&L, win rate, max drawdown, Sharpe-ish ratio.
- UI: market multiselect, lookback slider (7/30/90), strategy picker, line chart of equity curve, table of simulated trades.
- Caretaker tool: add `run_backtest` to `caretaker-chat` so the bot can self-evaluate ("how would I have done last 30 days on SPX?").

## 4. Portfolio + Cross-Market Hedging
- Extend `src/pages/Portfolio.tsx`:
  - **Net exposure panel**: per market, sum of (yes_shares − no_shares) × current price; aggregate by category.
  - **Correlation hint**: simple Pearson correlation of last 30 days of `market_data_points` between markets the user holds, surfaced as a heatmap.
- Caretaker enhancement: new tool `suggest_hedges` in `caretaker-chat`:
  - Given current positions, finds the highest |correlation| pair where the user is net-long both, and proposes a sized opposite contract (e.g., long snap-back on A → suggest long distortion on correlated B).
  - Returns as a normal pending-approval tool card so the user clicks Approve to execute.
- No schema change — uses existing tables.

## 5. Real-Capital Readiness Assessment (staged)
Two stages, both required, gated.

**Stage 1 — Literacy quiz**
- New table `assessment_attempts`:
  - `user_id`, `stage` (`quiz`|`sim`), `score` numeric, `passed` bool, `details` jsonb, `created_at`.
  - RLS: user manages own.
- New page `/assessment` with a 10-question quiz on: how the trend band works, distortion vs snap-back payouts, AMM pricing, fees, what the bot does in each mode, risk of correlated positions.
- Pass threshold: 8/10. Stored as an attempt row.

**Stage 2 — Bot-graded simulation**
- Unlocks only after Stage 1 pass.
- Edge function `assessment-sim`:
  - Spins up an isolated scenario: 3 synthetic markets with scripted data trajectories, §5,000 sim balance (NOT the user's wallet — kept in `details` jsonb on an attempt row).
  - User makes ~5 decisions over the scenario (buy/sell/hold across markets).
  - Caretaker (gpt-5) scores each decision against an optimal-policy reference and returns a 0–100 score plus written feedback.
- Pass threshold: 75.

**Eligibility flag**
- New table `user_capital_eligibility`:
  - `user_id` (PK), `quiz_passed_at`, `sim_passed_at`, `eligible` bool generated/updated by trigger when both pass, `tier` text default `'pending'` (future: `'tier_1'`, etc.), `notes`.
  - RLS: user reads own; only service role writes.
- UI: `/assessment` shows progress (Quiz ✓ / Simulation ✗) and final "Eligible for real-capital staking — coming soon" state.
- **No real money is moved.** This is purely the eligibility gate so when the real-capital rail ships, qualified users are already vetted.

## 6. Backend Smoke Test (I run it, report results)
Using read tools + edge-function curl:
- Confirm `handle_new_user` trigger seeds wallet, role, bot, and top-5 markets (query `wallets`, `bots`, `user_roles` for a recent signup).
- Curl each edge function with a minimal payload and capture status + first-line of response.
- Check `cloud_status` is `ACTIVE_HEALTHY`.
- Run `supabase--linter` to catch RLS / function security issues.
- Report a pass/fail table in chat after build.

---

## Technical details

**Schema changes (one migration)**
```sql
create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  stage text not null check (stage in ('quiz','sim')),
  score numeric not null,
  passed boolean not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.assessment_attempts enable row level security;
create policy "users manage own attempts" on public.assessment_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table public.user_capital_eligibility (
  user_id uuid primary key,
  quiz_passed_at timestamptz,
  sim_passed_at timestamptz,
  eligible boolean not null default false,
  tier text not null default 'pending',
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.user_capital_eligibility enable row level security;
create policy "users read own eligibility" on public.user_capital_eligibility
  for select using (auth.uid() = user_id);
-- writes only via service role from edge functions
```

**New edge functions**
- `reset-paper-balance` — verify_jwt true (in code), 24h cooldown.
- `bot-backtest` — verify_jwt true (in code), pure simulation, no DB writes.
- `assessment-sim` — verify_jwt true (in code), uses `LOVABLE_API_KEY` with `google/gemini-2.5-flash` for scoring; writes attempt row + updates eligibility via service role.

**Caretaker tool additions** (in `caretaker-chat/index.ts`)
- `run_backtest({market_ids, lookback_days})` — read-only.
- `suggest_hedges()` — returns proposals as pending tool cards (uses existing approval flow).

**Routes added in `src/App.tsx`**
- `/backtest`, `/assessment` (both auth-gated).

**Files created**
- `src/lib/brand.ts`
- `src/pages/Backtest.tsx`, `src/pages/Assessment.tsx`
- `src/components/DemoBadge.tsx`, `src/components/OnboardingTour.tsx`
- `supabase/functions/reset-paper-balance/index.ts`
- `supabase/functions/bot-backtest/index.ts`
- `supabase/functions/assessment-sim/index.ts`
- One migration file.

**Files edited**
- `index.html`, `src/components/Layout.tsx`, `src/pages/Landing.tsx`, `src/pages/Portfolio.tsx`, `src/App.tsx`, `supabase/functions/caretaker-chat/index.ts`.

## Out of scope (call out, don't build)
- Actual real-money rails / KYC / custodian — only the eligibility gate ships now.
- Multi-tier capital limits — `tier` column is reserved but unused.
- Live correlation matrix beyond user's held markets — kept narrow for performance.
