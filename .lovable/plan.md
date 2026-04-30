# Creator-Operated Market Lifecycle

Turn `markets` from "instantly live on insert" into a real lifecycle with creator skin-in-the-game, review, disputes, fee sharing, and a creator dashboard.

## Lifecycle states

```
draft → pending_review → open → pending_resolution → disputable → resolved
                       ↘ cancelled (refunds at cost basis)
```

- **draft**: creator editing rules, band, data source. Not visible to others.
- **pending_review**: stake locked, awaiting auto-checks (data source reachable, rules present, resolution_at in future).
- **open**: tradeable. AMM seeded from creator stake.
- **pending_resolution**: `resolution_at` passed, awaiting final value (manual or oracle).
- **disputable**: 24h window after a final value posted; any holder can raise a dispute (escrows a small bond).
- **resolved**: payouts done; creator receives 50% of accrued fees minus any upheld dispute slashing.
- **cancelled**: creator stake returned minus a small penalty; traders refunded at cost basis.

## Schema migration

Extend enums + add columns + two new tables.

```sql
alter type market_status add value if not exists 'draft';
alter type market_status add value if not exists 'pending_review';
alter type market_status add value if not exists 'pending_resolution';
alter type market_status add value if not exists 'disputable';
alter type market_status add value if not exists 'cancelled';

alter type ledger_reason add value if not exists 'creator_stake';
alter type ledger_reason add value if not exists 'creator_stake_refund';
alter type ledger_reason add value if not exists 'creator_payout';
alter type ledger_reason add value if not exists 'dispute_bond';
alter type ledger_reason add value if not exists 'dispute_refund';
alter type ledger_reason add value if not exists 'cancel_refund';

alter table public.markets
  add column if not exists rules_md text not null default '',
  add column if not exists creator_stake numeric not null default 0,
  add column if not exists fees_accrued numeric not null default 0,
  add column if not exists submitted_at timestamptz,
  add column if not exists final_posted_at timestamptz;

create table public.market_disputes (
  id uuid primary key default gen_random_uuid(),
  market_id uuid not null,
  raised_by uuid not null,
  reason text not null,
  bond numeric not null,
  status text not null default 'open' check (status in ('open','upheld','rejected')),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.market_disputes enable row level security;
create policy "anyone reads disputes" on public.market_disputes for select using (true);
create policy "users raise own disputes" on public.market_disputes
  for insert with check (auth.uid() = raised_by);
```

Default for new markets switches to `'draft'` (existing rows untouched).

## DB functions

- **`submit_market(_market_id, _stake)`**: validates draft, locks `_stake` from wallet (min 400), seeds AMM reserves on both contracts proportional to stake, sets status `pending_review`, then immediately `open` if auto-checks pass.
- **`cancel_market(_market_id)`**: only by creator while `open` and zero outside trades, OR by system if review fails. Refunds traders at cost basis, returns stake minus 5% penalty.
- **`raise_dispute(_market_id, _reason)`**: only while `disputable`, escrows 50 from wallet into bond.
- **`payout_creator(_market_id)`**: called after `resolved`, transfers `fees_accrued * 0.5` to creator + returns stake.
- Patch **`execute_trade`**: block when `markets.creator_id = auth.uid()` (no self-trading on own staked market) and accumulate `fees_accrued` per trade.

## Edge functions

- `supabase/functions/market-submit/index.ts` — wraps `submit_market`, runs data-source reachability check.
- `supabase/functions/market-cancel/index.ts` — wraps `cancel_market`.
- `supabase/functions/raise-dispute/index.ts` — wraps `raise_dispute` with rate limit (one open dispute per user per market).
- `supabase/functions/creator-payout/index.ts` — wraps `payout_creator`.
- Extend `supabase/functions/auto-resolve/index.ts` to flip `open → pending_resolution` at `resolution_at`, then `pending_resolution → disputable` once final value posted, then `disputable → resolved` after 24h.

## Frontend

- **`src/pages/MarketNew.tsx`** (refactor): wizard with steps Basics → Data → Band & Rules → Stake & Review. Saves as `draft`. Final step calls `market-submit`.
- **`src/pages/MarketsMine.tsx`** (new) at route `/markets/mine`: tabs Drafts / Live / Resolved. Per-row: status pill, fees accrued, stake locked, "Cancel" / "Claim payout" / "Edit draft" actions.
- **`src/pages/MarketDetail.tsx`** (edit): show rules_md, creator stake badge, lifecycle stepper, "Raise dispute" button while `disputable`, dispute list.
- **`src/components/MarketLifecycle.tsx`** (new): horizontal stepper used in detail + dashboard.
- **`src/App.tsx`**: register `/markets/mine` route.
- **`src/components/Layout.tsx`**: add "My Markets" nav entry for authed users.

## Caretaker integration

- Add `list_my_markets` and `creator_payout` tools to `caretaker-chat` so the bot can surface "you have a market in disputable state" and offer to claim payouts.
- `caretaker-events` emits a `pre_event`/`post_event` row for markets the user *created* (in addition to ones they hold), tagged with `kind='action_taken'` for auto-claims under autopilot.

## Out of scope (this pass)

- Multi-LP liquidity; secondary AMM funding only by creator stake for now.
- Oracle-driven auto-final-value; final value still posted by creator/system as today.
- Fiat/real-money settlement (still gated by assessment system).

## Implementation order

1. Schema migration.
2. DB functions + `execute_trade` patch.
3. Edge functions.
4. `MarketNew.tsx` wizard + `MarketsMine.tsx` + lifecycle stepper.
5. `MarketDetail.tsx` dispute UI + Caretaker tool wiring.
6. Smoke test: create draft → submit → trade as second user → resolve → dispute window → claim payout.
