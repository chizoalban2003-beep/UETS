-- New default for newly created markets
ALTER TABLE public.markets ALTER COLUMN status SET DEFAULT 'draft'::market_status;

-- ============== submit_market ==============
CREATE OR REPLACE FUNCTION public.submit_market(_market_id uuid, _stake numeric)
RETURNS public.markets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _m public.markets;
  _w public.wallets;
  _seed numeric;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF _stake < 400 THEN RAISE EXCEPTION 'minimum stake is 400'; END IF;

  SELECT * INTO _m FROM public.markets WHERE id = _market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'market not found'; END IF;
  IF _m.creator_id <> _user THEN RAISE EXCEPTION 'only creator can submit'; END IF;
  IF _m.status <> 'draft' THEN RAISE EXCEPTION 'market not in draft'; END IF;
  IF _m.resolution_at <= now() THEN RAISE EXCEPTION 'resolution_at must be in the future'; END IF;
  IF length(coalesce(_m.rules_md,'')) < 20 THEN RAISE EXCEPTION 'rules_md too short (min 20 chars)'; END IF;

  SELECT * INTO _w FROM public.wallets WHERE user_id = _user FOR UPDATE;
  IF _w.balance < _stake THEN RAISE EXCEPTION 'insufficient balance for stake'; END IF;

  UPDATE public.wallets SET balance = balance - _stake WHERE user_id = _user;
  INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
    VALUES (_user, -_stake, 'creator_stake', 'market', _market_id, 'creator stake locked');

  -- Seed AMM reserves on both contracts proportional to stake (split 50/50)
  _seed := _stake / 2.0;
  UPDATE public.contracts
    SET reserve_yes = _seed,
        reserve_no  = _seed,
        liquidity   = _seed
    WHERE market_id = _market_id;

  UPDATE public.markets
    SET status = 'open',
        creator_stake = _stake,
        submitted_at = now()
    WHERE id = _market_id
    RETURNING * INTO _m;
  RETURN _m;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.submit_market(uuid, numeric) FROM anon;

-- ============== cancel_market ==============
CREATE OR REPLACE FUNCTION public.cancel_market(_market_id uuid)
RETURNS public.markets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _m public.markets;
  _other_trades int;
  _penalty numeric := 0;
  _refund numeric;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _m FROM public.markets WHERE id = _market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'market not found'; END IF;
  IF _m.creator_id <> _user THEN RAISE EXCEPTION 'only creator can cancel'; END IF;
  IF _m.status NOT IN ('draft','open') THEN RAISE EXCEPTION 'cannot cancel in status %', _m.status; END IF;

  IF _m.status = 'open' THEN
    SELECT count(*) INTO _other_trades
      FROM public.trades t
      JOIN public.contracts c ON c.id = t.contract_id
      WHERE c.market_id = _market_id AND t.user_id <> _user;
    IF _other_trades > 0 THEN
      RAISE EXCEPTION 'cannot cancel: % external trades exist', _other_trades;
    END IF;
    _penalty := _m.creator_stake * 0.05;
  END IF;

  _refund := _m.creator_stake - _penalty;
  IF _refund > 0 THEN
    UPDATE public.wallets SET balance = balance + _refund WHERE user_id = _user;
    INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
      VALUES (_user, _refund, 'creator_stake_refund', 'market', _market_id,
              format('cancel refund (penalty %s)', _penalty));
  END IF;

  UPDATE public.markets SET status = 'cancelled' WHERE id = _market_id RETURNING * INTO _m;
  RETURN _m;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.cancel_market(uuid) FROM anon;

-- ============== raise_dispute ==============
CREATE OR REPLACE FUNCTION public.raise_dispute(_market_id uuid, _reason text)
RETURNS public.market_disputes
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _m public.markets;
  _w public.wallets;
  _existing int;
  _bond numeric := 50;
  _d public.market_disputes;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  IF length(coalesce(_reason,'')) < 10 THEN RAISE EXCEPTION 'reason too short (min 10 chars)'; END IF;

  SELECT * INTO _m FROM public.markets WHERE id = _market_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'market not found'; END IF;
  IF _m.status <> 'disputable' THEN RAISE EXCEPTION 'market not in dispute window'; END IF;

  SELECT count(*) INTO _existing FROM public.market_disputes
    WHERE market_id = _market_id AND raised_by = _user AND status = 'open';
  IF _existing > 0 THEN RAISE EXCEPTION 'you already have an open dispute on this market'; END IF;

  SELECT * INTO _w FROM public.wallets WHERE user_id = _user FOR UPDATE;
  IF _w.balance < _bond THEN RAISE EXCEPTION 'insufficient balance for dispute bond'; END IF;

  UPDATE public.wallets SET balance = balance - _bond WHERE user_id = _user;
  INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
    VALUES (_user, -_bond, 'dispute_bond', 'market', _market_id, 'dispute bond locked');

  INSERT INTO public.market_disputes (market_id, raised_by, reason, bond)
    VALUES (_market_id, _user, _reason, _bond)
    RETURNING * INTO _d;
  RETURN _d;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.raise_dispute(uuid, text) FROM anon;

-- ============== payout_creator ==============
CREATE OR REPLACE FUNCTION public.payout_creator(_market_id uuid)
RETURNS public.markets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid := auth.uid();
  _m public.markets;
  _payout numeric;
  _stake_back numeric;
BEGIN
  IF _user IS NULL THEN RAISE EXCEPTION 'not authenticated'; END IF;
  SELECT * INTO _m FROM public.markets WHERE id = _market_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'market not found'; END IF;
  IF _m.creator_id <> _user THEN RAISE EXCEPTION 'only creator can claim'; END IF;
  IF _m.status <> 'resolved' THEN RAISE EXCEPTION 'market not resolved'; END IF;
  IF _m.payout_claimed_at IS NOT NULL THEN RAISE EXCEPTION 'payout already claimed'; END IF;

  _payout := _m.fees_accrued * 0.5;
  _stake_back := _m.creator_stake;

  UPDATE public.wallets SET balance = balance + _stake_back + _payout WHERE user_id = _user;
  IF _stake_back > 0 THEN
    INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
      VALUES (_user, _stake_back, 'creator_stake_refund', 'market', _market_id, 'stake returned at resolve');
  END IF;
  IF _payout > 0 THEN
    INSERT INTO public.ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
      VALUES (_user, _payout, 'creator_payout', 'market', _market_id,
              format('50%% of accrued fees %s', _m.fees_accrued));
  END IF;

  UPDATE public.markets SET payout_claimed_at = now() WHERE id = _market_id RETURNING * INTO _m;
  RETURN _m;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.payout_creator(uuid) FROM anon;

-- ============== patch execute_trade ==============
CREATE OR REPLACE FUNCTION public.execute_trade(_contract_id uuid, _side trade_side, _shares numeric, _by_bot boolean DEFAULT false)
 RETURNS trades
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  IF _m.creator_id = _user THEN RAISE EXCEPTION 'creator cannot trade own market'; END IF;

  _k := _c.reserve_yes * _c.reserve_no;

  IF _side = 'buy_yes' THEN
    IF _shares >= _c.reserve_yes THEN RAISE EXCEPTION 'insufficient liquidity'; END IF;
    _new_yes := _c.reserve_yes - _shares;
    _new_no  := _k / _new_yes;
    _gross   := _new_no - _c.reserve_no;
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
    _gross   := _c.reserve_no - _new_no;
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

  UPDATE public.contracts
    SET reserve_yes = _new_yes,
        reserve_no  = _new_no,
        total_yes_outstanding = total_yes_outstanding + CASE WHEN _side='buy_yes' THEN _shares WHEN _side='sell_yes' THEN -_shares ELSE 0 END,
        total_no_outstanding  = total_no_outstanding  + CASE WHEN _side='buy_no'  THEN _shares WHEN _side='sell_no'  THEN -_shares ELSE 0 END
  WHERE id = _contract_id;

  -- Accumulate fees on the market for creator payout
  UPDATE public.markets SET fees_accrued = fees_accrued + _fee WHERE id = _c.market_id;

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
$function$;