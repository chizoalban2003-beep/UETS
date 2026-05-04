
## Goal

Turn the Caretaker into a fully agentic, generative, multi-modal assistant that any user (novice → creator → power trader) can lean on, and finish the last few product gaps before publishing.

Note on GitHub: I can't run `git push` myself. To sync to GitHub, open **Connectors → GitHub → Connect project** in the top bar — after that every change (including the ones below) auto-pushes both ways. I'll flag this again at the end.

---

## Part A — Make the Caretaker extensive & agentic

Right now the Caretaker can chat, stream, and call ~5 tools (`place_trade`, `set_goal`, `update_bot_config`, `create_market_from_template`, `generate_report`). To meet "extensive, interactable, agentic, generative for all kinds of users" we add:

### A1. Expand the tool surface (in `caretaker-chat` + `caretaker-execute`)

New tools the agent can call (all with approval gating for anything that moves money):

- `search_markets({ query, category, status })` — semantic search over markets
- `analyze_market({ market_id })` — pull data ticks, fairness flags, position concentration, return a structured brief
- `analyze_portfolio({ window_days })` — P&L attribution, risk concentration, suggestions
- `explain_concept({ topic })` — generative tutoring (e.g. "what's a snapback contract")
- `draft_market({ idea })` — generative: returns a full draft (name, rules_md, oracle, resolution_at) the user can one-click publish to `/markets/new`
- `simulate_trade({ contract_id, side, shares })` — dry-run pricing + P&L scenarios, no approval needed
- `rebalance_portfolio({ target_risk })` — proposes a multi-trade plan as a single approval bundle
- `schedule_alert({ market_id, condition })` — writes to a new `caretaker_alerts` table, evaluated by `caretaker-events`
- `summarize_news({ market_id })` — uses Lovable AI + ingest data to produce a headline brief
- `pause_bot()` / `resume_bot()` — one-tap risk controls
- `request_payout({ market_id })` — wraps `payout_creator` RPC for creators

### A2. Multi-step planning loop

Update `supabase/functions/caretaker-chat/index.ts` to run a **ReAct-style loop** (max 6 hops): the model can call read-only tools without approval, chain results, and only pause for human approval on **state-changing** tools (trade / payout / publish / bot-config). Stream tool-call thinking via the existing SSE channel so users see "Looking up market X… checking concentration… proposing 2 trades" live.

### A3. Generative outputs

- Add an **image tool**: `generate_chart_image({ market_id })` calls Lovable AI image gen and returns an inline preview in chat.
- Add `compose_market_card({ market_id })` to generate share-ready PNG + caption for socials.
- Default model stays `google/gemini-3-flash-preview`; auto-upgrade to `openai/gpt-5.2` with `reasoning.effort: "medium"` when the user asks for analysis / planning.

### A4. Personas for "all kinds of users"

Extend `CaretakerPersonality` with 4 selectable personas baked into the system prompt:
- **Coach** (novice — explains, asks before acting)
- **Analyst** (data-heavy, charts, reasoning model on)
- **Trader** (terse, fast, suggests trades)
- **Creator** (focuses on market design, payouts, fairness)

Persisted on `profiles.caretaker_persona`.

### A5. Memory

New `caretaker_memory` table (user_id, key, value, updated_at) so the agent can remember prefs ("I never short tech", "max 5% per position"). Tools: `remember(key,val)` / `forget(key)` / read on every turn.

### A6. Voice + quick actions

- Add a mic button in `CaretakerDock` using the browser SpeechRecognition API → feeds the same stream.
- Add 6 suggested-action chips above the input ("Review my portfolio", "Find a market for me", "Draft a market about…", "Explain my last loss", "Run fairness check", "Pause bot").

---

## Part B — What's left to build (product gaps)

Discovered while scanning the codebase:

1. **Marketplace ↔ Market Detail wiring**: `Marketplace.tsx` exists but trade routing back to `MarketDetail` needs an "open in app" CTA + creator profile link.
2. **Notifications**: `NotificationsBell` is mounted but there's no producer for: dispute opened, market resolved, payout ready, alert triggered. Add inserts in `event-resolve`, `raise-dispute`, `payout_creator`, `caretaker-events`.
3. **Creator analytics page**: `/creator` dashboard showing fees accrued, traders, fairness flags, payout history (uses existing `markets.fees_accrued`, `caretaker_fairness` output).
4. **Onboarding finish**: `OnboardingTour` doesn't yet route new users through (a) pick persona, (b) set first goal, (c) talk to Caretaker.
5. **Mobile polish**: Caretaker dock + Markets table aren't great <640px (current viewport 948 is fine, but mobile preview is broken).
6. **Billing edge cases**: webhook handles checkout but not `customer.subscription.deleted` → tier should drop to `free`. Add handler.
7. **Event market resolution UI**: `MarketDetail` doesn't yet show YES/NO oracle status + countdown for `market_kind='event'`.
8. **Tests**: only `example.test.ts` exists. Add Deno tests for `caretaker-execute` approval gating and `payments-webhook` tier mapping (security-critical).
9. **Security memory**: scanner hasn't been seeded for the new tables (`caretaker_alerts`, `caretaker_memory`). Run `security--run_security_scan` after migrations.
10. **GitHub push**: not yet connected. User must enable the GitHub connector once; after that all of the above auto-syncs.

---

## Technical changes (file-level)

Migrations (new):
- `caretaker_alerts(id, user_id, market_id, condition jsonb, active bool, created_at)` + RLS
- `caretaker_memory(user_id, key, value, updated_at, PK(user_id,key))` + RLS
- `notifications(id, user_id, kind, payload jsonb, read_at, created_at)` + RLS
- `profiles.caretaker_persona text default 'coach'`

Edge functions:
- **edit** `supabase/functions/caretaker-chat/index.ts` — add ReAct loop, new tool schemas, persona-aware system prompt, model auto-upgrade
- **edit** `supabase/functions/caretaker-execute/index.ts` — add new tool handlers + approval policy
- **new** `supabase/functions/caretaker-image/index.ts` — image gen via Lovable AI
- **edit** `supabase/functions/caretaker-events/index.ts` — evaluate `caretaker_alerts`, write `notifications`
- **edit** `supabase/functions/payments-webhook/index.ts` — handle `customer.subscription.deleted`
- **new** test files alongside `caretaker-execute` and `payments-webhook`

Frontend:
- **edit** `src/components/CaretakerDock.tsx` — chips, mic, image rendering, persona display
- **edit** `src/components/CaretakerPersonality.tsx` — 4 personas
- **edit** `src/components/NotificationsBell.tsx` — read from new table + realtime
- **new** `src/pages/CreatorDashboard.tsx` + route in `App.tsx` + nav in `Layout.tsx`
- **edit** `src/pages/MarketDetail.tsx` — event-market resolution panel
- **edit** `src/pages/Marketplace.tsx` — CTAs

---

## Out of scope (intentionally deferred)

- Real-money trading, KYC, custody.
- Mobile native app.
- Replacing the AMM with an order book.

---

## After approval

I'll execute Part A first (agentic Caretaker is the headline), then Part B in the order listed, run the security scan, and remind you to click **Connectors → GitHub → Connect project** so the whole batch lands in your repo. Want me to also ask a couple of clarifying questions (e.g. which persona should be default, do you want voice on by default), or just go?
