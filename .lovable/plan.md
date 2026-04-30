# Polish, personality, and a real login walkthrough

## What you asked, answered first

### 1. "Some names still show ElasticMarkets"
I searched the whole codebase. There is exactly **one** literal stale brand string left:

- `src/pages/Auth.tsx` line 57 — `Welcome to ElasticMarkets`

Everything else (header, footer, landing hero, `<title>`, OG tags, `BRAND` constant) already says **Driftworks**.

There is also a second category — the word **"elastic"** used as *product vocabulary*, not as a brand:
- Landing copy ("The elastic-trend metaphor", "elasticity band", `ElasticDemo` chart)
- `MarketNew` ("Trend & elasticity", placeholder "BTC price elastic")
- `index.css` (`--gradient-elastic`, `.bg-gradient-elastic`)
- `trend.ts` / `providers.ts` comments

This is the core mental model of the product (a trend is a stretched elastic; you trade the distortion). I'll **rename only the brand string** and leave the metaphor copy alone unless you tell me to retire it.

### 2. Does the bot need a name, language, personality?
Right now the Caretaker has **one fixed voice**, hardcoded in `caretaker-chat/index.ts`:
> "You are the Caretaker — the always-on co-pilot for Driftworks…"

It already adapts on two axes:
- **Skill level** (beginner / intermediate / advanced) — controls how much it explains
- **Mode** (teach / suggest / co-pilot / autopilot) — controls how much it does

What it does **not** have:
- A custom **display name** (always "Caretaker")
- A **personality preset** (calm flight-crew vs. terse quant vs. friendly coach)
- A **language preference** (always English)

My recommendation: keep "Caretaker" as the **default agentic identity** (it's universal, role-based, and matches the platform metaphor), but let each user **rename it** and pick a **voice preset** + **language**. That gives personality without fragmenting the brand.

### 3. What is the entire platform?
**Driftworks** is a paper-trading sandbox for **trend-distortion markets**:

```text
  Real-world dataset  →  Trend model + elasticity band  →  Two contracts per market
  (price, weather,        (linear / EWMA /                 ┌─ DISTORTION (scalar): how
   climate, on-chain)      Bollinger / seasonal)           │   far did reality stretch?
                                                           └─ SNAPBACK   (binary):  did
                                                               it return inside the band?
                              ↑                                       ↓
                       Creator stakes §400+                  AMM (constant-product, fee)
                       to publish a market           ←  Traders take YES/NO via wallet
                              ↓                                       ↓
                       Lifecycle: draft → pending_review →   open  → pending_resolution
                                  → disputable (24h) → resolved → creator payout (50% fees)
                              ↓                                       ↓
                       Caretaker AI co-pilot               Bot (off / suggest / approve / auto)
                       (teach / suggest / co-pilot /       runs strategies inside guardrails
                        autopilot, with PRE/DURING/POST    (max position, max daily loss,
                        event briefings)                    watchlist)
                              ↓
                       Assessment → real-capital tier
```

Major surfaces already shipped: Landing, Auth, Markets list, Market detail (with lifecycle stepper, rules, dispute UI), Create market wizard, **My markets** dashboard, Portfolio, Bot config, Caretaker chat with streaming + tool-calling, Goals, Reports, Backtest, Assessment, onboarding tour, dock.

### 4. Is it ready to start trading / functioning?
**Functionally: yes for paper trading.** Auth works, markets resolve automatically, AMM executes, ledger is consistent, RLS is in place, edge functions deploy, real-capital is gated behind the assessment.

**Gaps I'd close before calling it "complete":**

| Area | Status | Gap |
|---|---|---|
| Branding | 95% | `Auth.tsx` still says ElasticMarkets |
| Caretaker voice | works | no name/persona/language settings |
| Auth UX | works | Google works, but no password reset, no `/reset-password` page |
| Email confirmation | on by default | first-time users hit "check your email" — fine, but unmentioned in UI |
| Real-capital path | demo only | no actual cash-in/out; assessment grants tier but no funding step |
| Mobile | usable | header nav is desktop-only, no mobile menu |
| Empty states | partial | new user landing on `/portfolio` or `/markets/mine` has no guidance |
| Smoke test | unknown | I haven't logged in and clicked through end-to-end yet |

This plan addresses the first three (brand, personality, auth UX smoke test) and **gives you a written gap list** for the rest so you can prioritize.

---

## What I'll do

### A. Brand cleanup (1 file)
- `src/pages/Auth.tsx` → `Welcome to Driftworks` + tagline from `BRAND.tagline`
- Optional, ask first: rename the "elastic-trend metaphor" copy on Landing if you want to drop the word "elastic" entirely. **Default: leave it**, because it's the product's mental model.

### B. Caretaker personality (DB + 2 files + 1 edge function)

Add to `profiles` table:
- `caretaker_name` text default `'Caretaker'`
- `caretaker_voice` text default `'calm'` (one of: `calm`, `coach`, `quant`, `concise`)
- `caretaker_language` text default `'en'`

In `src/pages/Caretaker.tsx` (and `Bot.tsx` panel):
- Three new fields in the settings card: name input, voice preset selector with one-line previews, language dropdown (en / es / fr / de / pt for now)
- `CaretakerDock` header reads the custom name

In `supabase/functions/caretaker-chat/index.ts`:
- Read `caretaker_name`, `caretaker_voice`, `caretaker_language` alongside skill+mode
- Inject into the system prompt: `Your name is ${name}. Voice: ${VOICE_GUIDE[voice]}. Reply in ${language}.`
- `VOICE_GUIDE`:
  - **calm** — flight-crew cadence, specific, no hedging (current default)
  - **coach** — warm, encouraging, asks one reflective question per reply
  - **quant** — terse, numbers-first, no emoji, no fluff
  - **concise** — three sentences max unless asked to expand

Universal across the platform: yes — same identity drives the dock, the chat page, briefings, and trade rationales.

### C. Login + seamless smoke test (browser)
After the build, I'll open the preview, **you click "Continue with Google" once**, then I:
1. Verify the header shows your balance + Driftworks brand
2. Open `/markets`, pick one, confirm prices + lifecycle stepper render
3. Open `/caretaker`, confirm the new name/voice/language settings save and the next reply uses them
4. Open `/markets/mine` to confirm the creator dashboard loads (empty state ok)
5. Report what worked and any console/network errors

If Google sign-in trips on the preview domain, I'll fall back to email/password and tell you.

### D. Written "is it ready" report
At the end, I'll deliver the gap table above with a short recommendation for the next 1–2 build cycles (most likely: mobile nav + password reset + funding step for real capital).

---

## Technical notes

- Migration adds three nullable-with-default columns to `profiles` — no data loss, no RLS change needed (existing policies already cover the row)
- `types.ts` regenerates automatically after the migration
- The Caretaker system prompt is composed string-by-string; adding voice/name/language is a 4-line change
- No new edge functions; no new routes
- `BRAND.name` already exists, so the Auth fix is one-line
- Browser smoke test uses `navigate_to_sandbox` after you sign in; I don't have and won't ask for your Google password
