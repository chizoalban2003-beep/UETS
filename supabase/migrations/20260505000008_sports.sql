-- Sports markets: resolution_type, live_data_feed, game event linkage, dispute window override.

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS resolution_type text NOT NULL DEFAULT 'manual'
  CHECK (resolution_type IN ('manual', 'oracle_auto', 'game_final', 'live'));

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS game_event_id text,
  ADD COLUMN IF NOT EXISTS live_data_feed boolean NOT NULL DEFAULT false;

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS dispute_window_hours int NOT NULL DEFAULT 24;

-- Auto-resolve game_final markets: transition to pending_resolution when resolution_at is near
-- and the oracle has posted a final value. Called by pg_cron every 5 minutes.
CREATE OR REPLACE FUNCTION public.auto_resolve_game_final()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE m RECORD; latest_val numeric;
BEGIN
  FOR m IN
    SELECT * FROM markets
    WHERE resolution_type = 'game_final'
    AND status = 'open'
    AND resolution_at < now() + interval '2 hours'
  LOOP
    SELECT value INTO latest_val
    FROM market_data_points
    WHERE market_id = m.id
    ORDER BY ts DESC LIMIT 1;

    IF latest_val IS NOT NULL THEN
      UPDATE markets SET
        status = 'pending_resolution',
        final_value = latest_val
      WHERE id = m.id;
    END IF;
  END LOOP;
END;
$$;

-- Schedule (uncomment after enabling pg_cron):
-- SELECT cron.schedule('game-final-resolve', '*/5 * * * *',
--   $$SELECT public.auto_resolve_game_final()$$);
-- SELECT cron.schedule('aml-daily', '0 2 * * *', $$SELECT public.run_aml_scan()$$);
