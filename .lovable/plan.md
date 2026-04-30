# Make markets work on any dataset — live data, auto-resolve, templates, richer trends, custom oracles

Turn the platform from "upload a CSV and resolve manually" into a real prediction venue that can spin up markets on any public dataset, fetch fresh values on a schedule, and settle itself.

## What we'll build

### 1. Live data ingestion (scheduled fetchers)

A new `data_sources` table describes *where* each market gets its values from:

- `kind`: `manual` | `provider` | `custom_url`
- `provider`: `coingecko` | `yahoo` | `fred` | `open-meteo` | `polymarket` | `github` | `nasa-co2`
- `provider_params`: JSONB (e.g. `{symbol: "BTC"}`, `{ticker: "AAPL"}`, `{series: "CPIAUCSL"}`, `{lat, lon, var: "temperature_2m"}`)
- `custom_url` + `json_path` for the "paste any HTTPS JSON endpoint" path
- `fetch_interval_minutes` (default 60)
- `last_fetched_at`, `last_error`

A new edge function **`ingest-data`** runs on a `pg_cron` schedule (every 5 min). For each due `data_source` it:
1. Calls the right provider adapter
2. Inserts a new row into `market_data_points`
3. Updates `last_fetched_at` / `last_error`

Provider adapters live in `supabase/functions/ingest-data/providers/*.ts`. All free, no API keys needed for the v1 set (CoinGecko, Yahoo via query1, FRED public CSV, Open-Meteo, Polymarket public, GitHub stars, NASA CO₂). FRED's official API needs a key — we'll use it only if the user adds one later.

### 2. Auto-resolution

New edge function **`auto-resolve`** runs on the same cron. It finds markets where `status = 'open'` and `resolution_at <= now()`, pulls the latest value from the linked data source, and calls `resolve_market(market_id, final_value)`.

The existing `resolve_market` function only allows the creator to call it. We add an internal variant **`resolve_market_system`** (SECURITY DEFINER, callable only by service role) that skips the creator check, used by the cron job.

### 3. Market templates (one-click create)

New `Templates` page and a **Templates** tab on `MarketNew.tsx`. Picks like:

- Crypto price (BTC, ETH, SOL via CoinGecko)
- Stock price (AAPL, NVDA, TSLA via Yahoo)
- Macro (US CPI, unemployment via FRED)
- Weather (temperature in any city via Open-Meteo)
- GitHub stars on any repo
- Atmospheric CO₂ (NASA)

Selecting a template prefills the form (name, category, unit, trend model, band, data source) — user picks resolution date and clicks **Create**. The template also seeds the market with a backfill of recent history so the trend chart has shape immediately.

### 4. Richer trend models

Extend `src/lib/trend.ts` and the `trend_model` enum with:

- `log_linear` — fits `log(y) = a + bx`, good for compounding series
- `seasonal` — naïve STL: rolling mean + repeating weekly/yearly residual, good for weather/traffic
- `bollinger` — adaptive band: rolling mean ± k·rolling-stdev (k stored in `trend_params`)
- `ewma` — exponentially weighted moving average

The `MarketNew` wizard gets a model picker with a short description for each, and the live preview chart updates per-model.

### 5. Custom oracle URL (power-user path)

In `MarketNew`, an "Advanced → Custom data source" panel:

- HTTPS endpoint URL
- JSONPath to extract the numeric value (e.g. `$.data.price`)
- Fetch interval
- A **Test fetch** button that calls a new `test-oracle` edge function and shows the parsed value before saving

The same plumbing powers automatic ingestion later.

### 6. Discovery & UX

- `Markets` page: category filter chips (Crypto / Stocks / Macro / Weather / Code / Climate / Custom) and a "Live" badge on markets backed by a data source
- Market detail page: shows the data source, time of last fetch, and "next update in N min"
- New `Live` tab on the landing page showing the most-traded live markets

## Technical details

**Migrations**
- `data_sources` table + RLS (read public, write only by market creator)
- Add `data_source_id` FK to `markets` (nullable for legacy CSV markets)
- Extend `trend_model` enum with `log_linear`, `seasonal`, `bollinger`, `ewma`
- `resolve_market_system(_market_id, _final_value)` SECURITY DEFINER, callable by service role only
- pg_cron entries hitting the two new edge functions every 5 minutes (using project URL + anon key; created via the insert tool, not migration)

**Edge functions**
- `ingest-data` — iterates due sources, calls provider adapter, inserts data points
- `auto-resolve` — settles markets past their resolution time
- `test-oracle` — one-shot fetch + JSONPath extract for the custom URL UI

All three: CORS headers, Zod validation, structured errors, no client secrets exposed.

**Frontend**
- `src/lib/providers.ts` — template definitions (id, label, category, unit, defaults, sample symbols)
- `src/lib/trend.ts` — add the four new model fitters
- `src/pages/MarketNew.tsx` — Tabs: **CSV** | **Template** | **Custom URL**, model picker upgrade, source preview
- `src/pages/MarketDetail.tsx` — data-source card + last-update indicator
- `src/pages/Markets.tsx` — category chips + Live badge
- `src/components/DataSourceBadge.tsx` — small reusable component

**No external API keys required for the v1 provider set.** FRED official API and any paid sources stay opt-in.

## Roadmap (task list I'll execute)

1. DB schema: `data_sources`, FK on `markets`, enum extension, `resolve_market_system`
2. Edge functions: `ingest-data`, `auto-resolve`, `test-oracle` (with provider adapters)
3. pg_cron schedule for both background functions
4. `src/lib/trend.ts` + `src/lib/providers.ts`
5. `MarketNew` wizard rebuild with Templates / Custom URL / CSV tabs and richer model picker
6. `Markets` discovery (category chips, Live badge) + `MarketDetail` data-source panel
7. Backfill helper inside `ingest-data` so freshly-created template markets get ~90 days of history immediately
8. Manual smoke test: create a BTC market from template → confirm cron writes points → fast-forward `resolution_at` → confirm auto-resolve settles positions
