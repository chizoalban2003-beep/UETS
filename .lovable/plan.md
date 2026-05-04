## Wire event-market toggle into MarketNew

Add a market-kind toggle (Time-series vs Event/YES-NO) to `src/pages/MarketNew.tsx` so creators can publish prediction-style binary markets backed by the new oracle resolver.

### UI changes (`src/pages/MarketNew.tsx`)

1. New top-of-form segmented control: **Time-series** (default) vs **Event (YES/NO)**.
2. When **Event** is selected:
   - Hide Trend & elasticity card, CSV tab, and band/trend fields (not used).
   - Replace Template tab content with an event-template subset (Kalshi/Polymarket mirrors from `TEMPLATES` filtered by `category === "Prediction"`), plus a "Custom oracle" option.
   - Show new oracle-config block:
     - `event_oracle_kind` select: `kalshi`, `polymarket`, `manual`.
     - `event_oracle_ref` input (Kalshi ticker / Polymarket token id / free text for manual).
     - Helper text explaining how each resolves (auto-poll vs manual + 24h dispute window).
   - Resolution date label becomes "Event resolution / cutoff date".
3. Keep Basics card (name, description, category, unit defaults to `p(YES)`, rules).

### Submit logic

- Insert into `markets` with `market_kind: 'event'`, `event_oracle_kind`, `event_oracle_ref`, and skip trend/band defaults (use `linear` / `0`, server already defaults).
- For Kalshi/Polymarket event markets, also create a `data_sources` row pointing at the same provider so live YES-price ticks show on the chart pre-resolution.
- For `manual` oracle, no data_source is created; rules_md must explain the resolution criteria (enforced min length already exists; bump to 60 chars when manual).

### Validation

- If kind=event and oracle=kalshi/polymarket, require `event_oracle_ref`.
- Disable Publish until oracle is configured or template picked.

### Out of scope

- No schema changes (columns already exist).
- No edge-function changes (`event-resolve` already polls Kalshi/Polymarket on schedule).
- Marketplace and billing UI untouched.

After approval I'll edit `MarketNew.tsx` only.