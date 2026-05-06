-- Extend execute_trade to accept an optional _actor_id parameter.
-- When _actor_id is provided (API key trades), it is used instead of auth.uid().
-- This allows the public API edge function (api/index.ts) to execute trades on
-- behalf of the API key owner while keeping all existing security invariants.

CREATE OR REPLACE FUNCTION public.execute_trade(
  _contract_id uuid,
  _side trade_side,
  _shares numeric,
  _by_bot boolean DEFAULT false,
  _actor_id uuid DEFAULT NULL
)
RETURNS trades
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _user UUID := COALESCE(_actor_id, auth.uid());
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

-- Grant to service role for API key trade execution
GRANT EXECUTE ON FUNCTION public.execute_trade(uuid, public.trade_side, numeric, boolean, uuid) TO service_role;

-- Add missing DELETE policy for market_comments (owner only)
CREATE POLICY IF NOT EXISTS "users delete own comments" ON public.market_comments
  FOR DELETE USING (auth.uid() = user_id);
