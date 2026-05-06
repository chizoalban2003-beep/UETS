-- Migration: push_subscriptions, notification_prefs, lp_positions + LP incentive schema

-- ── push_subscriptions ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth_key text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, endpoint)
);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own push subs" ON public.push_subscriptions
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── notification_prefs ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notification_prefs (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  push_enabled boolean NOT NULL DEFAULT false,
  email_enabled boolean NOT NULL DEFAULT true,
  goal_alerts boolean NOT NULL DEFAULT true,
  market_resolving boolean NOT NULL DEFAULT true,
  payment_failed boolean NOT NULL DEFAULT true,
  agent_complete boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_prefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own prefs" ON public.notification_prefs
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ── email_sent_at column on notifications ────────────────────────────────────
ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS email_sent_at timestamptz;

-- ── lp_positions ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.lp_positions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  contract_id uuid NOT NULL,
  lp_shares numeric(20,6) NOT NULL DEFAULT 0,
  fees_earned numeric(20,6) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, contract_id)
);
ALTER TABLE public.lp_positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own lp positions" ON public.lp_positions
  FOR SELECT USING (auth.uid() = user_id);

-- ── LP incentive columns on markets ──────────────────────────────────────────
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS lp_incentive_apy numeric(5,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS lp_incentive_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS lp_incentive_cap_usd numeric(10,2) DEFAULT 0;

-- ── lp_total_shares column on contracts (needed for pool share calc) ─────────
ALTER TABLE public.contracts ADD COLUMN IF NOT EXISTS lp_total_shares numeric(20,6) NOT NULL DEFAULT 0;

-- ── View: LP incentive eligible positions ────────────────────────────────────
CREATE OR REPLACE VIEW public.lp_incentive_eligible AS
SELECT
  lp.id,
  lp.user_id,
  lp.contract_id,
  m.id AS market_id,
  m.lp_incentive_apy,
  m.lp_incentive_expires_at,
  (c.reserve_yes + c.reserve_no) AS pool_size,
  (lp.lp_shares / NULLIF(c.lp_total_shares, 0)) AS pool_share_pct
FROM lp_positions lp
JOIN contracts c ON c.id = lp.contract_id
JOIN markets m ON m.id = c.market_id
WHERE lp.lp_shares > 0
  AND m.lp_incentive_apy > 0
  AND (m.lp_incentive_expires_at IS NULL OR m.lp_incentive_expires_at > now());

-- ── Admin RPC: set LP incentive ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_lp_incentive(
  _market_id uuid,
  _apy numeric,
  _days int DEFAULT 30,
  _cap_usd numeric DEFAULT 500
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'admin only';
  END IF;
  UPDATE markets SET
    lp_incentive_apy = _apy,
    lp_incentive_expires_at = now() + (_days || ' days')::interval,
    lp_incentive_cap_usd = _cap_usd
  WHERE id = _market_id;
END;
$$;

-- ── RPC: credit LP incentive to a wallet ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.execute_lp_incentive_credit(
  _user_id uuid,
  _amount numeric,
  _market_id uuid
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE wallets SET balance = balance + _amount WHERE user_id = _user_id;
  INSERT INTO ledger_entries (user_id, amount, reason, ref_type, ref_id, note)
    VALUES (_user_id, _amount, 'fee', 'market', _market_id, 'LP incentive bonus');
END;
$$;
