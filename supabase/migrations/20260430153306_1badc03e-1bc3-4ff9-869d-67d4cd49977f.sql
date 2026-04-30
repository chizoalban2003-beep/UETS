-- Extend market_status enum
ALTER TYPE market_status ADD VALUE IF NOT EXISTS 'draft';
ALTER TYPE market_status ADD VALUE IF NOT EXISTS 'pending_review';
ALTER TYPE market_status ADD VALUE IF NOT EXISTS 'pending_resolution';
ALTER TYPE market_status ADD VALUE IF NOT EXISTS 'disputable';
ALTER TYPE market_status ADD VALUE IF NOT EXISTS 'cancelled';

-- Extend ledger_reason enum
ALTER TYPE ledger_reason ADD VALUE IF NOT EXISTS 'creator_stake';
ALTER TYPE ledger_reason ADD VALUE IF NOT EXISTS 'creator_stake_refund';
ALTER TYPE ledger_reason ADD VALUE IF NOT EXISTS 'creator_payout';
ALTER TYPE ledger_reason ADD VALUE IF NOT EXISTS 'dispute_bond';
ALTER TYPE ledger_reason ADD VALUE IF NOT EXISTS 'dispute_refund';
ALTER TYPE ledger_reason ADD VALUE IF NOT EXISTS 'cancel_refund';

-- Extend markets table
ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS rules_md text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS creator_stake numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS fees_accrued numeric NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS final_posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS payout_claimed_at timestamptz;

-- Disputes table
CREATE TABLE IF NOT EXISTS public.market_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id uuid NOT NULL,
  raised_by uuid NOT NULL,
  reason text NOT NULL,
  bond numeric NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','upheld','rejected')),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.market_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone reads disputes" ON public.market_disputes
  FOR SELECT USING (true);

CREATE POLICY "users raise own disputes" ON public.market_disputes
  FOR INSERT WITH CHECK (auth.uid() = raised_by);

CREATE INDEX IF NOT EXISTS idx_market_disputes_market ON public.market_disputes(market_id);