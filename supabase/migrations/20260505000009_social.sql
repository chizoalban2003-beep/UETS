-- Social layer: follow system + market comments.

-- ── user_follows ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.user_follows (
  follower_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  following_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, following_id)
);
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users manage own follows" ON public.user_follows
  FOR ALL USING (auth.uid() = follower_id)
  WITH CHECK (auth.uid() = follower_id);

-- ── market_comments ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.market_comments (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id  uuid        NOT NULL REFERENCES public.markets(id) ON DELETE CASCADE,
  user_id    uuid        NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  body       text        NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.market_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "public read comments" ON public.market_comments FOR SELECT USING (true);
CREATE POLICY "users insert own comments" ON public.market_comments
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_market_comments
  ON public.market_comments(market_id, created_at DESC);

-- ── leaderboard opt-in ────────────────────────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS leaderboard_public boolean NOT NULL DEFAULT true;
