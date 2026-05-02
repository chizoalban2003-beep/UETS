-- Subscriptions + caretaker quota tracking

CREATE TYPE public.sub_tier AS ENUM ('free', 'pro_trader', 'creator_pro');
CREATE TYPE public.sub_status AS ENUM ('active', 'past_due', 'canceled', 'trialing', 'incomplete');

CREATE TABLE public.subscriptions (
  user_id UUID PRIMARY KEY,
  tier public.sub_tier NOT NULL DEFAULT 'free',
  status public.sub_status NOT NULL DEFAULT 'active',
  stripe_customer_id TEXT,
  stripe_sub_id TEXT,
  current_period_end TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own subscription"
  ON public.subscriptions FOR SELECT
  USING (auth.uid() = user_id);

CREATE TRIGGER subscriptions_updated_at
  BEFORE UPDATE ON public.subscriptions
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.caretaker_usage (
  user_id UUID NOT NULL,
  day DATE NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);

ALTER TABLE public.caretaker_usage ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users read own usage"
  ON public.caretaker_usage FOR SELECT
  USING (auth.uid() = user_id);

-- Quota function: caps actions per day by tier
CREATE OR REPLACE FUNCTION public.consume_caretaker_quota(_user_id UUID, _cost INT DEFAULT 1)
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
$$;

-- Auto-create a free subscription row for new users
CREATE OR REPLACE FUNCTION public.handle_new_user_subscription()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.subscriptions (user_id, tier, status)
  VALUES (NEW.id, 'free', 'active')
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created_subscription ON auth.users;
CREATE TRIGGER on_auth_user_created_subscription
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user_subscription();

-- Backfill: every existing user gets a free subscription row
INSERT INTO public.subscriptions (user_id, tier, status)
SELECT id, 'free', 'active' FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- Update payout_creator to give 60% to creator_pro tier
CREATE OR REPLACE FUNCTION public.payout_creator(_market_id uuid)
 RETURNS markets
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
