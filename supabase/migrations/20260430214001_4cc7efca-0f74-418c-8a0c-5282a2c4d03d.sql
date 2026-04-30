ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS caretaker_name text NOT NULL DEFAULT 'Caretaker',
  ADD COLUMN IF NOT EXISTS caretaker_voice text NOT NULL DEFAULT 'calm',
  ADD COLUMN IF NOT EXISTS caretaker_language text NOT NULL DEFAULT 'en';

ALTER TABLE public.profiles
  ADD CONSTRAINT caretaker_voice_check
  CHECK (caretaker_voice IN ('calm','coach','quant','concise'));