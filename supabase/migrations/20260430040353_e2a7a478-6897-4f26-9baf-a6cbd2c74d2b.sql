
-- =========================================
-- ENUMS
-- =========================================
CREATE TYPE public.app_role AS ENUM ('admin', 'user');
CREATE TYPE public.trend_model AS ENUM ('linear', 'moving_avg', 'exponential');
CREATE TYPE public.market_status AS ENUM ('open', 'resolving', 'resolved');
CREATE TYPE public.contract_kind AS ENUM ('distortion', 'snapback');
CREATE TYPE public.trade_side AS ENUM ('buy_yes', 'sell_yes', 'buy_no', 'sell_no');
CREATE TYPE public.ledger_reason AS ENUM ('signup_bonus', 'deposit', 'withdrawal', 'trade', 'settlement', 'fee', 'bot_action', 'adjustment');
CREATE TYPE public.bot_mode AS ENUM ('off', 'suggest', 'approve', 'auto');
CREATE TYPE public.bot_strategy AS ENUM ('mean_reversion', 'momentum', 'custom');
CREATE TYPE public.suggestion_status AS ENUM ('pending', 'accepted', 'rejected', 'executed', 'expired');

-- =========================================
-- PROFILES
-- =========================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Profiles viewable by everyone" ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- =========================================
-- USER ROLES
-- =========================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  UNIQUE (user_id, role)
);
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;

CREATE POLICY "Users see own roles" ON public.user_roles FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Admins manage roles" ON public.user_roles FOR ALL USING (public.has_role(auth.uid(), 'admin'));

-- =========================================
-- WALLETS
-- =========================================
CREATE TABLE public.wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  balance NUMERIC(20,4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own wallet" ON public.wallets FOR SELECT USING (auth.uid() = user_id);
-- writes only via SECURITY DEFINER functions

-- =========================================
-- LEDGER
-- =========================================
CREATE TABLE public.ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  amount NUMERIC(20,4) NOT NULL,
  reason public.ledger_reason NOT NULL,
  ref_type TEXT,
  ref_id UUID,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_user_idx ON public.ledger_entries (user_id, created_at DESC);
ALTER TABLE public.ledger_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own ledger" ON public.ledger_entries FOR SELECT USING (auth.uid() = user_id);

-- =========================================
-- MARKETS
-- =========================================
CREATE TABLE public.markets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  creator_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT,
  unit TEXT,
  trend_model public.trend_model NOT NULL DEFAULT 'linear',
  trend_params JSONB NOT NULL DEFAULT '{}'::jsonb,
  band_width NUMERIC(20,6) NOT NULL DEFAULT 0,
  band_is_pct BOOLEAN NOT NULL DEFAULT true,
  resolution_at TIMESTAMPTZ NOT NULL,
  status public.market_status NOT NULL DEFAULT 'open',
  final_value NUMERIC(20,6),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX markets_status_idx ON public.markets (status, resolution_at);
ALTER TABLE public.markets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Markets are public" ON public.markets FOR SELECT USING (true);
CREATE POLICY "Users create markets" ON public.markets FOR INSERT WITH CHECK (auth.uid() = creator_id);
CREATE POLICY "Creator updates open market" ON public.markets FOR UPDATE USING (auth.uid() = creator_id AND status = 'open');

-- =========================================
-- MARKET DATA POINTS
-- =========================================
CREATE TABLE public.market_data_points (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  ts TIMESTAMPTZ NOT NULL,
  value NUMERIC(20,6) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX mdp_market_ts_idx ON public.market_data_points (market_id, ts);
ALTER TABLE public.market_data_points ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Data points public" ON public.market_data_points FOR SELECT USING (true);
CREATE POLICY "Creator inserts data" ON public.market_data_points FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.markets m WHERE m.id = market_id AND m.creator_id = auth.uid()));
CREATE POLICY "Creator deletes data" ON public.market_data_points FOR DELETE
  USING (EXISTS (SELECT 1 FROM public.markets m WHERE m.id = market_id AND m.creator_id = auth.uid()));

-- =========================================
-- CONTRACTS (one per market+kind) with embedded AMM pool
-- =========================================
CREATE TABLE public.contracts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  kind public.contract_kind NOT NULL,
  reserve_yes NUMERIC(20,6) NOT NULL DEFAULT 1000,
  reserve_no NUMERIC(20,6) NOT NULL DEFAULT 1000,
  liquidity NUMERIC(20,6) NOT NULL DEFAULT 1000,
  fee_bps INTEGER NOT NULL DEFAULT 100,
  total_yes_outstanding NUMERIC(20,6) NOT NULL DEFAULT 0,
  total_no_outstanding NUMERIC(20,6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (market_id, kind)
);
ALTER TABLE public.contracts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Contracts public" ON public.contracts FOR SELECT USING (true);
-- writes only via SECURITY DEFINER functions

-- =========================================
-- POSITIONS
-- =========================================
CREATE TABLE public.positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  yes_shares NUMERIC(20,6) NOT NULL DEFAULT 0,
  no_shares NUMERIC(20,6) NOT NULL DEFAULT 0,
  cost_basis_yes NUMERIC(20,6) NOT NULL DEFAULT 0,
  cost_basis_no NUMERIC(20,6) NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, contract_id)
);
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own positions" ON public.positions FOR SELECT USING (auth.uid() = user_id);

-- =========================================
-- TRADES
-- =========================================
CREATE TABLE public.trades (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  side public.trade_side NOT NULL,
  shares NUMERIC(20,6) NOT NULL,
  price NUMERIC(20,6) NOT NULL,
  cost NUMERIC(20,6) NOT NULL,
  fee NUMERIC(20,6) NOT NULL DEFAULT 0,
  by_bot BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX trades_user_idx ON public.trades (user_id, created_at DESC);
CREATE INDEX trades_contract_idx ON public.trades (contract_id, created_at DESC);
ALTER TABLE public.trades ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own trades" ON public.trades FOR SELECT USING (auth.uid() = user_id);

-- =========================================
-- BOTS
-- =========================================
CREATE TABLE public.bots (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  mode public.bot_mode NOT NULL DEFAULT 'off',
  strategy public.bot_strategy NOT NULL DEFAULT 'mean_reversion',
  custom_prompt TEXT,
  max_position_size NUMERIC(20,4) NOT NULL DEFAULT 500,
  max_daily_loss NUMERIC(20,4) NOT NULL DEFAULT 1000,
  enabled_market_ids UUID[] NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.bots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users manage own bot" ON public.bots FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- =========================================
-- BOT SUGGESTIONS
-- =========================================
CREATE TABLE public.bot_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  market_id UUID NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  contract_id UUID NOT NULL REFERENCES public.contracts(id) ON DELETE CASCADE,
  side public.trade_side NOT NULL,
  shares NUMERIC(20,6) NOT NULL,
  est_cost NUMERIC(20,6) NOT NULL,
  rationale TEXT NOT NULL,
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5,
  status public.suggestion_status NOT NULL DEFAULT 'pending',
  trade_id UUID REFERENCES public.trades(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);
CREATE INDEX bs_user_idx ON public.bot_suggestions (user_id, status, created_at DESC);
ALTER TABLE public.bot_suggestions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users view own suggestions" ON public.bot_suggestions FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users update own suggestions" ON public.bot_suggestions FOR UPDATE USING (auth.uid() = user_id);

-- =========================================
-- TIMESTAMP TRIGGER
-- =========================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_wallets_updated BEFORE UPDATE ON public.wallets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_markets_updated BEFORE UPDATE ON public.markets FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_contracts_updated BEFORE UPDATE ON public.contracts FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_positions_updated BEFORE UPDATE ON public.positions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_bots_updated BEFORE UPDATE ON public.bots FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================
-- NEW USER HOOK: profile + wallet + signup bonus + bot
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');

  INSERT INTO public.wallets (user_id, balance) VALUES (NEW.id, 10000);

  INSERT INTO public.ledger_entries (user_id, amount, reason, note)
  VALUES (NEW.id, 10000, 'signup_bonus', 'Welcome paper-trading capital');

  INSERT INTO public.bots (user_id) VALUES (NEW.id);

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =========================================
-- HELPER: create contracts when a market is created
-- =========================================
CREATE OR REPLACE FUNCTION public.handle_new_market()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.contracts (market_id, kind) VALUES (NEW.id, 'distortion');
  INSERT INTO public.contracts (market_id, kind) VALUES (NEW.id, 'snapback');
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_market_created
  AFTER INSERT ON public.markets
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_market();

-- =========================================
-- TRADE EXECUTION (constant-product AMM, ledger-backed)
-- =========================================
CREATE OR REPLACE FUNCTION public.execute_trade(
  _contract_id UUID,
  _side public.trade_side,
  _shares NUMERIC,
  _by_bot BOOLEAN DEFAULT false
)
RETURNS public.trades LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user UUID := auth.uid();
  _c public.contracts;
  _m public.markets;
  _wallet public.wallets;
  _new_yes NUMERIC; _new_no NUMERIC; _k NUMERIC;
  _gross NUMERIC; _fee NUMERIC; _cost NUMERIC; _price NUMERIC;
  _trade public.trades;
  _pos public.positions;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _shares <= 0 THEN RAISE EXCEPTION 'shares must be positive'; END IF;

  SELECT * INTO _c FROM public.contracts WHERE id = _contract_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'contract not found'; END IF;

  SELECT * INTO _m FROM public.markets WHERE id = _c.market_id;
  IF _m.status <> 'open' THEN RAISE EXCEPTION 'market not open'; END IF;

  _k := _c.reserve_yes * _c.reserve_no;

  -- Constant-product AMM: shares are the asset removed from one side
  IF _side = 'buy_yes' THEN
    IF _shares >= _c.reserve_yes THEN RAISE EXCEPTION 'insufficient liquidity'; END IF;
    _new_yes := _c.reserve_yes - _shares;
    _new_no  := _k / _new_yes;
    _gross   := _new_no - _c.reserve_no; -- amount of numeraire pulled in
  ELSIF _side = 'buy_no' THEN
    IF _shares >= _c.reserve_no THEN RAISE EXCEPTION 'insufficient liquidity'; END IF;
    _new_no  := _c.reserve_no - _shares;
    _new_yes := _k / _new_no;
    _gross   := _new_yes - _c.reserve_yes;
  ELSIF _side = 'sell_yes' THEN
    SELECT * INTO _pos FROM public.positions WHERE user_id = _user AND contract_id = _contract_id FOR UPDATE;
    IF _pos.yes_shares < _shares THEN RAISE EXCEPTION 'not enough yes shares'; END IF;
    _new_yes := _c.reserve_yes + _shares;
    _new_no  := _k / _new_yes;
    _gross   := _c.reserve_no - _new_no; -- payout
  ELSIF _side = 'sell_no' THEN
    SELECT * INTO _pos FROM public.positions WHERE user_id = _user AND contract_id = _contract_id FOR UPDATE;
    IF _pos.no_shares < _shares THEN RAISE EXCEPTION 'not enough no shares'; END IF;
    _new_no  := _c.reserve_no + _shares;
    _new_yes := _k / _new_no;
    _gross   := _c.reserve_yes - _new_yes;
  END IF;

  _fee   := abs(_gross) * _c.fee_bps / 10000.0;
  _price := _gross / _shares;

  IF _side IN ('buy_yes','buy_no') THEN
    _cost := _gross + _fee;
    SELECT * INTO _wallet FROM public.wallets WHERE user_id = _user FOR UPDATE;
    IF _wallet.balance < _cost THEN RAISE EXCEPTION 'insufficient balance'; END IF;
    UPDATE public.wallets SET balance = balance - _cost WHERE user_id = _user;
    INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
      VALUES (_user, -_cost, CASE WHEN _by_bot THEN 'bot_action' ELSE 'trade' END, 'contract', _contract_id, _side::text);
  ELSE
    _cost := _gross - _fee;
    UPDATE public.wallets SET balance = balance + _cost WHERE user_id = _user;
    INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
      VALUES (_user, _cost, CASE WHEN _by_bot THEN 'bot_action' ELSE 'trade' END, 'contract', _contract_id, _side::text);
  END IF;

  -- Update reserves
  UPDATE public.contracts
    SET reserve_yes = _new_yes,
        reserve_no  = _new_no,
        total_yes_outstanding = total_yes_outstanding + CASE WHEN _side='buy_yes' THEN _shares WHEN _side='sell_yes' THEN -_shares ELSE 0 END,
        total_no_outstanding  = total_no_outstanding  + CASE WHEN _side='buy_no'  THEN _shares WHEN _side='sell_no'  THEN -_shares ELSE 0 END
  WHERE id = _contract_id;

  -- Upsert position
  INSERT INTO public.positions (user_id, contract_id, yes_shares, no_shares, cost_basis_yes, cost_basis_no)
  VALUES (
    _user, _contract_id,
    CASE WHEN _side='buy_yes' THEN _shares WHEN _side='sell_yes' THEN -_shares ELSE 0 END,
    CASE WHEN _side='buy_no'  THEN _shares WHEN _side='sell_no'  THEN -_shares ELSE 0 END,
    CASE WHEN _side='buy_yes' THEN _cost ELSE 0 END,
    CASE WHEN _side='buy_no'  THEN _cost ELSE 0 END
  )
  ON CONFLICT (user_id, contract_id) DO UPDATE SET
    yes_shares = positions.yes_shares + EXCLUDED.yes_shares,
    no_shares  = positions.no_shares  + EXCLUDED.no_shares,
    cost_basis_yes = positions.cost_basis_yes + EXCLUDED.cost_basis_yes,
    cost_basis_no  = positions.cost_basis_no  + EXCLUDED.cost_basis_no,
    updated_at = now();

  INSERT INTO public.trades (user_id, contract_id, side, shares, price, cost, fee, by_bot)
  VALUES (_user, _contract_id, _side, _shares, abs(_price), abs(_cost), _fee, _by_bot)
  RETURNING * INTO _trade;

  RETURN _trade;
END;
$$;

GRANT EXECUTE ON FUNCTION public.execute_trade(UUID, public.trade_side, NUMERIC, BOOLEAN) TO authenticated;

-- =========================================
-- RESOLVE MARKET (creator only) — pays out positions
-- =========================================
CREATE OR REPLACE FUNCTION public.resolve_market(_market_id UUID, _final_value NUMERIC)
RETURNS public.markets LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _m public.markets;
  _c public.contracts;
  _trend NUMERIC;
  _band NUMERIC;
  _distortion NUMERIC;          -- normalized 0..1
  _snap_yes_payout NUMERIC;
  _pos RECORD;
BEGIN
  SELECT * INTO _m FROM public.markets WHERE id = _market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'market not found'; END IF;
  IF _m.creator_id <> auth.uid() THEN RAISE EXCEPTION 'only creator can resolve'; END IF;
  IF _m.status = 'resolved' THEN RAISE EXCEPTION 'already resolved'; END IF;

  -- Compute final trend value from last data point as a simple v1 baseline
  SELECT value INTO _trend FROM public.market_data_points
    WHERE market_id = _market_id ORDER BY ts DESC LIMIT 1;
  _trend := COALESCE(_trend, _final_value);

  _band := CASE WHEN _m.band_is_pct THEN abs(_trend) * (_m.band_width/100.0) ELSE _m.band_width END;
  IF _band <= 0 THEN _band := abs(_trend) * 0.05 + 1; END IF;

  -- Distortion in 0..1: 0 = inside band, 1 = stretched 2x band or more
  _distortion := LEAST(1.0, GREATEST(0.0, (abs(_final_value - _trend) - _band) / (2*_band)));
  IF abs(_final_value - _trend) <= _band THEN _distortion := 0; END IF;

  -- snap-back YES = stayed inside the band
  _snap_yes_payout := CASE WHEN abs(_final_value - _trend) <= _band THEN 1.0 ELSE 0.0 END;

  -- Settle each contract
  FOR _c IN SELECT * FROM public.contracts WHERE market_id = _market_id LOOP
    FOR _pos IN
      SELECT * FROM public.positions WHERE contract_id = _c.id AND (yes_shares > 0 OR no_shares > 0)
    LOOP
      DECLARE
        _payout NUMERIC := 0;
        _yes_val NUMERIC; _no_val NUMERIC;
      BEGIN
        IF _c.kind = 'snapback' THEN
          _yes_val := _snap_yes_payout;       -- 0 or 1
          _no_val  := 1 - _snap_yes_payout;
        ELSE -- distortion: YES pays distortion, NO pays (1 - distortion)
          _yes_val := _distortion;
          _no_val  := 1 - _distortion;
        END IF;
        _payout := _pos.yes_shares * _yes_val + _pos.no_shares * _no_val;
        IF _payout > 0 THEN
          UPDATE public.wallets SET balance = balance + _payout WHERE user_id = _pos.user_id;
          INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
          VALUES (_pos.user_id, _payout, 'settlement', 'contract', _c.id,
                  format('settle %s yes=%s no=%s', _c.kind, _yes_val, _no_val));
        END IF;
      END;
    END LOOP;
  END LOOP;

  UPDATE public.markets
    SET status = 'resolved', final_value = _final_value, resolved_at = now()
    WHERE id = _market_id
    RETURNING * INTO _m;
  RETURN _m;
END;
$$;

GRANT EXECUTE ON FUNCTION public.resolve_market(UUID, NUMERIC) TO authenticated;
