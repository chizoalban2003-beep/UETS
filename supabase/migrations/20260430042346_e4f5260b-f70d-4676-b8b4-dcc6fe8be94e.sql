-- Allow inserts to bot_suggestions for the owning user (also used by bot service running as that user)
CREATE POLICY "Users insert own suggestions"
ON public.bot_suggestions
FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- Helpful index for feed queries
CREATE INDEX IF NOT EXISTS idx_bot_suggestions_user_status_created
  ON public.bot_suggestions (user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_market_data_points_market_ts
  ON public.market_data_points (market_id, ts);
