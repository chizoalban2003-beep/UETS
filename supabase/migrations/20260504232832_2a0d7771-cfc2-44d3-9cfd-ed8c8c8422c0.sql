
-- Caretaker alerts
CREATE TABLE public.caretaker_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  market_id uuid,
  condition jsonb NOT NULL DEFAULT '{}'::jsonb,
  label text,
  active boolean NOT NULL DEFAULT true,
  last_fired_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.caretaker_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own alerts" ON public.caretaker_alerts
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_caretaker_alerts_user_active ON public.caretaker_alerts(user_id, active);

-- Caretaker memory
CREATE TABLE public.caretaker_memory (
  user_id uuid NOT NULL,
  key text NOT NULL,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, key)
);
ALTER TABLE public.caretaker_memory ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own memory" ON public.caretaker_memory
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- Notifications
CREATE TABLE public.notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  kind text NOT NULL,
  title text NOT NULL,
  body text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own notifications" ON public.notifications
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users update own notifications" ON public.notifications
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read_at);

-- Persona on profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS caretaker_persona text NOT NULL DEFAULT 'coach';

-- Realtime for notifications
ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
