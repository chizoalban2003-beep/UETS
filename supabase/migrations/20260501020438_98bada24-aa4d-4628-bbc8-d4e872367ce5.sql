
-- Guardrail 1: cap active markets per creator at 5
CREATE OR REPLACE FUNCTION public.enforce_market_creation_limits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _active int;
  _last_submit timestamptz;
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT count(*) INTO _active FROM public.markets
      WHERE creator_id = NEW.creator_id
        AND status IN ('draft','open','pending_resolution','disputable');
    IF _active >= 5 THEN
      RAISE EXCEPTION 'You already have % active markets. Resolve or cancel one before creating another.', _active;
    END IF;
  END IF;

  -- Cooldown on transition to "open" via submit_market
  IF TG_OP = 'UPDATE' AND OLD.status = 'draft' AND NEW.status = 'open' THEN
    SELECT max(submitted_at) INTO _last_submit FROM public.markets
      WHERE creator_id = NEW.creator_id AND id <> NEW.id;
    IF _last_submit IS NOT NULL AND now() - _last_submit < interval '60 seconds' THEN
      RAISE EXCEPTION 'Please wait a moment before publishing another market (60s cooldown).';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_market_limits ON public.markets;
CREATE TRIGGER trg_enforce_market_limits
BEFORE INSERT OR UPDATE ON public.markets
FOR EACH ROW EXECUTE FUNCTION public.enforce_market_creation_limits();

-- Guardrail 2: concentration alert helper (called by caretaker-events)
CREATE OR REPLACE FUNCTION public.detect_concentration_risk(_market_id uuid)
RETURNS TABLE(user_id uuid, contract_id uuid, side text, share_pct numeric)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH totals AS (
    SELECT c.id AS contract_id,
           NULLIF(SUM(p.yes_shares), 0) AS yes_total,
           NULLIF(SUM(p.no_shares), 0)  AS no_total
    FROM public.contracts c
    LEFT JOIN public.positions p ON p.contract_id = c.id
    WHERE c.market_id = _market_id
    GROUP BY c.id
  )
  SELECT p.user_id, p.contract_id, 'yes'::text AS side,
         (p.yes_shares / t.yes_total * 100)::numeric AS share_pct
  FROM public.positions p
  JOIN totals t ON t.contract_id = p.contract_id
  WHERE p.yes_shares > 0 AND t.yes_total > 0
    AND (p.yes_shares / t.yes_total) > 0.40
  UNION ALL
  SELECT p.user_id, p.contract_id, 'no'::text AS side,
         (p.no_shares / t.no_total * 100)::numeric
  FROM public.positions p
  JOIN totals t ON t.contract_id = p.contract_id
  WHERE p.no_shares > 0 AND t.no_total > 0
    AND (p.no_shares / t.no_total) > 0.40;
$$;
