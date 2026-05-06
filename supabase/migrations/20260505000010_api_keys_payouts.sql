-- API keys table for developer public API
CREATE TABLE IF NOT EXISTS public.api_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key_hash text NOT NULL UNIQUE,
  label text NOT NULL,
  tier text NOT NULL DEFAULT 'free',
  requests_today int NOT NULL DEFAULT 0,
  last_used_at timestamptz,
  last_reset_at date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.api_keys ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own keys" ON public.api_keys
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON public.api_keys(key_hash);

-- Stripe Connect columns on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS stripe_connect_account_id text,
  ADD COLUMN IF NOT EXISTS stripe_connect_onboarded boolean NOT NULL DEFAULT false;

-- Payout history for creator Stripe transfers
CREATE TABLE IF NOT EXISTS public.payout_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  market_id uuid REFERENCES public.markets(id),
  amount numeric(20,4) NOT NULL,
  stripe_transfer_id text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payout_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own payouts" ON public.payout_history
  FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_payout_history_user ON public.payout_history(user_id, created_at DESC);

-- AML cron scheduling (run manually in Supabase SQL editor after enabling pg_cron):
-- SELECT cron.schedule('aml-daily', '0 2 * * *', $$SELECT public.run_aml_scan()$$);
-- SELECT cron.schedule('game-final-resolve', '*/5 * * * *', $$SELECT public.auto_resolve_game_final()$$);
