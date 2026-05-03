
-- Event markets
DO $$ BEGIN
  CREATE TYPE public.market_kind AS ENUM ('time_series', 'event');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.event_oracle_kind AS ENUM ('manual', 'kalshi', 'polymarket', 'sports_api');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS market_kind public.market_kind NOT NULL DEFAULT 'time_series',
  ADD COLUMN IF NOT EXISTS event_oracle_kind public.event_oracle_kind,
  ADD COLUMN IF NOT EXISTS event_oracle_ref text,
  ADD COLUMN IF NOT EXISTS event_outcome boolean;

-- Add binary contract kind to existing enum if needed
DO $$ BEGIN
  ALTER TYPE public.contract_kind ADD VALUE IF NOT EXISTS 'binary';
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- Creator Elite tier
ALTER TYPE public.sub_tier ADD VALUE IF NOT EXISTS 'creator_elite';

-- Update handle_new_market to branch on market_kind
CREATE OR REPLACE FUNCTION public.handle_new_market()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.market_kind = 'event' THEN
    INSERT INTO public.contracts (market_id, kind) VALUES (NEW.id, 'binary');
  ELSE
    INSERT INTO public.contracts (market_id, kind) VALUES (NEW.id, 'distortion');
    INSERT INTO public.contracts (market_id, kind) VALUES (NEW.id, 'snapback');
  END IF;
  RETURN NEW;
END;
$function$;

-- Event market resolver
CREATE OR REPLACE FUNCTION public.resolve_event_market(_market_id uuid, _outcome boolean)
RETURNS public.markets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _m public.markets;
  _c public.contracts;
  _pos RECORD;
  _yes_val numeric;
  _no_val numeric;
  _payout numeric;
BEGIN
  SELECT * INTO _m FROM public.markets WHERE id = _market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'market not found'; END IF;
  IF _m.market_kind <> 'event' THEN RAISE EXCEPTION 'not an event market'; END IF;
  IF _m.status = 'resolved' THEN RETURN _m; END IF;

  _yes_val := CASE WHEN _outcome THEN 1.0 ELSE 0.0 END;
  _no_val := 1.0 - _yes_val;

  FOR _c IN SELECT * FROM public.contracts WHERE market_id = _market_id LOOP
    FOR _pos IN
      SELECT * FROM public.positions WHERE contract_id = _c.id AND (yes_shares > 0 OR no_shares > 0)
    LOOP
      _payout := _pos.yes_shares * _yes_val + _pos.no_shares * _no_val;
      IF _payout > 0 THEN
        UPDATE public.wallets SET balance = balance + _payout WHERE user_id = _pos.user_id;
        INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
          VALUES (_pos.user_id, _payout, 'settlement', 'contract', _c.id,
                  format('event resolve outcome=%s', _outcome));
      END IF;
    END LOOP;
  END LOOP;

  UPDATE public.markets
    SET status = 'resolved', event_outcome = _outcome, resolved_at = now()
    WHERE id = _market_id RETURNING * INTO _m;
  RETURN _m;
END;
$$;

-- Update quota function to include creator_elite
CREATE OR REPLACE FUNCTION public.consume_caretaker_quota(_user_id uuid, _cost integer DEFAULT 1)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _tier public.sub_tier;
  _cap INT;
  _new INT;
BEGIN
  SELECT tier INTO _tier FROM public.subscriptions WHERE user_id = _user_id;
  IF _tier IS NULL THEN _tier := 'free'; END IF;

  _cap := CASE _tier
    WHEN 'free' THEN 25
    WHEN 'pro_trader' THEN 250
    WHEN 'creator_pro' THEN 1000
    WHEN 'creator_elite' THEN 5000
  END;

  INSERT INTO public.caretaker_usage (user_id, day, count)
  VALUES (_user_id, current_date, _cost)
  ON CONFLICT (user_id, day)
  DO UPDATE SET count = public.caretaker_usage.count + _cost
  RETURNING count INTO _new;

  IF _new > _cap THEN
    RAISE EXCEPTION 'caretaker quota exceeded: % / % (tier %)', _new, _cap, _tier
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN _cap - _new;
END;
$function$;

-- Update payout_creator: Elite gets 70%
CREATE OR REPLACE FUNCTION public.payout_creator(_market_id uuid)
RETURNS public.markets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user uuid := auth.uid();
  _m public.markets;
  _payout numeric;
  _stake_back numeric;
  _share numeric := 0.5;
  _tier public.sub_tier;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _m FROM public.markets WHERE id = _market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'market not found'; END IF;
  IF _m.creator_id <> _user THEN RAISE EXCEPTION 'only creator can claim'; END IF;
  IF _m.status <> 'resolved' THEN RAISE EXCEPTION 'market not resolved'; END IF;
  IF _m.payout_claimed_at IS NOT NULL THEN RAISE EXCEPTION 'payout already claimed'; END IF;

  SELECT tier INTO _tier FROM public.subscriptions WHERE user_id = _user;
  IF _tier = 'creator_pro' THEN _share := 0.6; END IF;
  IF _tier = 'creator_elite' THEN _share := 0.7; END IF;

  _payout := _m.fees_accrued * _share;
  _stake_back := _m.creator_stake;

  UPDATE public.wallets SET balance = balance + _stake_back + _payout WHERE user_id = _user;
  IF _stake_back > 0 THEN
    INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
      VALUES (_user, _stake_back, 'creator_stake_refund', 'market', _market_id, 'stake returned at resolve');
  END IF;
  IF _payout > 0 THEN
    INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
      VALUES (_user, _payout, 'creator_payout', 'market', _market_id,
              format('%s%% of accrued fees %s (tier %s)', (_share*100)::int, _m.fees_accrued, _tier));
  END IF;

  UPDATE public.markets SET payout_claimed_at = now() WHERE id = _market_id RETURNING * INTO _m;
  RETURN _m;
END;
$function$;
