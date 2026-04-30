-- 1. Extend trend_model enum
ALTER TYPE trend_model ADD VALUE IF NOT EXISTS 'log_linear';
ALTER TYPE trend_model ADD VALUE IF NOT EXISTS 'seasonal';
ALTER TYPE trend_model ADD VALUE IF NOT EXISTS 'bollinger';
ALTER TYPE trend_model ADD VALUE IF NOT EXISTS 'ewma';

-- 2. data_source kind enum
DO $$ BEGIN
  CREATE TYPE data_source_kind AS ENUM ('manual','provider','custom_url');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 3. data_sources table
CREATE TABLE IF NOT EXISTS public.data_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL,
  kind data_source_kind NOT NULL DEFAULT 'manual',
  provider TEXT,                   -- coingecko | yahoo | open-meteo | github | nasa-co2 | polymarket | fred
  provider_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_url TEXT,
  json_path TEXT,                  -- dot path, e.g. "data.price" or "0.value"
  fetch_interval_minutes INT NOT NULL DEFAULT 60,
  last_fetched_at TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.data_sources ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Data sources public read" ON public.data_sources
  FOR SELECT USING (true);
CREATE POLICY "Users insert own data source" ON public.data_sources
  FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Users update own data source" ON public.data_sources
  FOR UPDATE USING (auth.uid() = creator_id);
CREATE POLICY "Users delete own data source" ON public.data_sources
  FOR DELETE USING (auth.uid() = creator_id);

CREATE TRIGGER data_sources_set_updated_at
  BEFORE UPDATE ON public.data_sources
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_data_sources_due
  ON public.data_sources (last_fetched_at NULLS FIRST)
  WHERE kind <> 'manual';

-- 4. Link markets to a data source (nullable for legacy CSV markets)
ALTER TABLE public.markets ADD COLUMN IF NOT EXISTS data_source_id UUID REFERENCES public.data_sources(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_markets_data_source ON public.markets(data_source_id);
CREATE INDEX IF NOT EXISTS idx_markets_open_resolution ON public.markets(resolution_at) WHERE status = 'open';

-- 5. System resolve function (no creator check) — for the cron auto-resolver
CREATE OR REPLACE FUNCTION public.resolve_market_system(_market_id uuid, _final_value numeric)
RETURNS markets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _m public.markets;
  _c public.contracts;
  _trend NUMERIC;
  _band NUMERIC;
  _distortion NUMERIC;
  _snap_yes_payout NUMERIC;
  _pos RECORD;
BEGIN
  SELECT * INTO _m FROM public.markets WHERE id = _market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'market not found'; END IF;
  IF _m.status = 'resolved' THEN RETURN _m; END IF;

  SELECT value INTO _trend FROM public.market_data_points
    WHERE market_id = _market_id ORDER BY ts DESC LIMIT 1;
  _trend := COALESCE(_trend, _final_value);

  _band := CASE WHEN _m.band_is_pct THEN abs(_trend) * (_m.band_width/100.0) ELSE _m.band_width END;
  IF _band <= 0 THEN _band := abs(_trend) * 0.05 + 1; END IF;

  _distortion := LEAST(1.0, GREATEST(0.0, (abs(_final_value - _trend) - _band) / (2*_band)));
  IF abs(_final_value - _trend) <= _band THEN _distortion := 0; END IF;
  _snap_yes_payout := CASE WHEN abs(_final_value - _trend) <= _band THEN 1.0 ELSE 0.0 END;

  FOR _c IN SELECT * FROM public.contracts WHERE market_id = _market_id LOOP
    FOR _pos IN
      SELECT * FROM public.positions WHERE contract_id = _c.id AND (yes_shares > 0 OR no_shares > 0)
    LOOP
      DECLARE
        _payout NUMERIC := 0; _yes_val NUMERIC; _no_val NUMERIC;
      BEGIN
        IF _c.kind = 'snapback' THEN
          _yes_val := _snap_yes_payout; _no_val := 1 - _snap_yes_payout;
        ELSE
          _yes_val := _distortion; _no_val := 1 - _distortion;
        END IF;
        _payout := _pos.yes_shares * _yes_val + _pos.no_shares * _no_val;
        IF _payout > 0 THEN
          UPDATE public.wallets SET balance = balance + _payout WHERE user_id = _pos.user_id;
          INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
          VALUES (_pos.user_id, _payout, 'settlement', 'contract', _c.id,
                  format('auto-settle %s yes=%s no=%s', _c.kind, _yes_val, _no_val));
        END IF;
      END;
    END LOOP;
  END LOOP;

  UPDATE public.markets
    SET status='resolved', final_value=_final_value, resolved_at=now()
    WHERE id=_market_id RETURNING * INTO _m;
  RETURN _m;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_market_system(uuid, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_market_system(uuid, numeric) FROM authenticated, anon;

-- 6. Enable cron + net for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;