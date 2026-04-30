-- 1. Caretaker mode enum + column
DO $$ BEGIN
  CREATE TYPE caretaker_mode AS ENUM ('chat','assist','autopilot');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.bots ADD COLUMN IF NOT EXISTS caretaker_mode caretaker_mode NOT NULL DEFAULT 'assist';

-- 2. Goals
DO $$ BEGIN
  CREATE TYPE goal_status AS ENUM ('active','achieved','failed','cancelled');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_goals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  title TEXT NOT NULL,
  target_return_pct NUMERIC,
  max_loss NUMERIC,
  deadline TIMESTAMPTZ,
  notes TEXT,
  status goal_status NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.user_goals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own goals" ON public.user_goals
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE TRIGGER user_goals_set_updated_at
  BEFORE UPDATE ON public.user_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Caretaker messages
DO $$ BEGIN
  CREATE TYPE caretaker_role AS ENUM ('system','user','assistant','tool');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.caretaker_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  role caretaker_role NOT NULL,
  content TEXT,
  tool_calls JSONB,
  tool_call_id TEXT,
  pending_approval BOOLEAN NOT NULL DEFAULT false,
  approved BOOLEAN,
  result JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.caretaker_messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own messages" ON public.caretaker_messages
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own messages" ON public.caretaker_messages
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users update own messages" ON public.caretaker_messages
  FOR UPDATE USING (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_caretaker_messages_user ON public.caretaker_messages(user_id, created_at);

-- 4. Reports
DO $$ BEGIN
  CREATE TYPE report_kind AS ENUM ('daily','weekly','monthly','on_demand');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  kind report_kind NOT NULL,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  title TEXT NOT NULL,
  content_md TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users view own reports" ON public.reports
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users insert own reports" ON public.reports
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE INDEX IF NOT EXISTS idx_reports_user ON public.reports(user_id, created_at DESC);

-- 5. Top live markets helper
CREATE OR REPLACE FUNCTION public.pick_top_live_markets(_limit int DEFAULT 5)
RETURNS uuid[]
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT COALESCE(ARRAY_AGG(id), '{}'::uuid[]) FROM (
    SELECT m.id, COALESCE(t.cnt, 0) AS cnt, m.created_at
    FROM public.markets m
    LEFT JOIN (
      SELECT c.market_id, COUNT(*) AS cnt
      FROM public.trades tr
      JOIN public.contracts c ON c.id = tr.contract_id
      WHERE tr.created_at > now() - interval '7 days'
      GROUP BY c.market_id
    ) t ON t.market_id = m.id
    WHERE m.status = 'open' AND m.data_source_id IS NOT NULL
    ORDER BY cnt DESC, m.created_at DESC
    LIMIT _limit
  ) ranked;
$$;

-- 6. Update handle_new_user to seed bot with top live markets
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1)));

  INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'user');

  INSERT INTO public.wallets (user_id, balance) VALUES (NEW.id, 10000);

  INSERT INTO public.ledger_entries (user_id, amount, reason, note)
  VALUES (NEW.id, 10000, 'signup_bonus', 'Welcome paper-trading capital');

  INSERT INTO public.bots (user_id, mode, enabled_market_ids)
  VALUES (NEW.id, 'suggest', public.pick_top_live_markets(5));

  RETURN NEW;
END;
$$;