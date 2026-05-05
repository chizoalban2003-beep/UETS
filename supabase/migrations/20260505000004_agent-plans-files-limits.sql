-- ============================================================
-- Agent plans, schedules, file ingestion, and tier agent limits
-- ============================================================

-- 1. Agent plans table
CREATE TABLE IF NOT EXISTS public.agent_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  title text NOT NULL,
  objective text,
  steps jsonb NOT NULL DEFAULT '[]',
  risk_notes text,
  expected_outcome text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','running','paused','completed','failed')),
  current_step int NOT NULL DEFAULT 0,
  mode text NOT NULL DEFAULT 'suggest' CHECK (mode IN ('suggest','autopilot')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own agent_plans" ON public.agent_plans USING (auth.uid() = user_id);
CREATE INDEX idx_agent_plans_user ON public.agent_plans(user_id, created_at DESC);

-- 2. Agent schedules table
CREATE TABLE IF NOT EXISTS public.agent_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.agent_plans(id) ON DELETE CASCADE,
  cron_expr text NOT NULL DEFAULT '*/5 * * * *',
  active boolean NOT NULL DEFAULT true,
  next_run_at timestamptz,
  last_run_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.agent_schedules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own agent_schedules" ON public.agent_schedules USING (auth.uid() = user_id);
CREATE INDEX idx_agent_schedules_next_run ON public.agent_schedules(next_run_at) WHERE active;

-- 3. Ingested files table
CREATE TABLE IF NOT EXISTS public.ingested_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text,
  size_bytes bigint,
  page_count int NOT NULL DEFAULT 1,
  row_count int,
  extracted_text text,
  ai_summary text,
  storage_path text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ingested_files ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own ingested_files" ON public.ingested_files USING (auth.uid() = user_id);
CREATE INDEX idx_ingested_files_user ON public.ingested_files(user_id, created_at DESC);

-- 4. Add agent limits columns to subscriptions
ALTER TABLE public.subscriptions
  ADD COLUMN IF NOT EXISTS agent_plans_limit int NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS file_pages_limit int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS scheduled_agents boolean NOT NULL DEFAULT false;

-- 5. set_tier_agent_limits function
CREATE OR REPLACE FUNCTION public.set_tier_agent_limits(
  _user_id uuid,
  _tier text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE subscriptions
  SET
    agent_plans_limit = CASE _tier
      WHEN 'pro_trader'     THEN 10
      WHEN 'creator_pro'    THEN 50
      WHEN 'creator_elite'  THEN 200
      ELSE 1
    END,
    file_pages_limit = CASE _tier
      WHEN 'pro_trader'     THEN 100
      WHEN 'creator_pro'    THEN 500
      WHEN 'creator_elite'  THEN 2000
      ELSE 0
    END,
    scheduled_agents = CASE _tier
      WHEN 'creator_pro'   THEN true
      WHEN 'creator_elite' THEN true
      ELSE false
    END,
    updated_at = now()
  WHERE user_id = _user_id;
END;
$$;
