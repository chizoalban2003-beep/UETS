-- Performance indexes for frequently-queried tables.
-- Covers the patterns identified in the audit (section 9).

-- trades
CREATE INDEX IF NOT EXISTS idx_trades_user_created
  ON public.trades (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_trades_contract_created
  ON public.trades (contract_id, created_at DESC);

-- positions
CREATE INDEX IF NOT EXISTS idx_positions_user
  ON public.positions (user_id);

CREATE INDEX IF NOT EXISTS idx_positions_contract
  ON public.positions (contract_id);

-- notifications: partial index for unread rows only
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
  ON public.notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

-- agent_plans
CREATE INDEX IF NOT EXISTS idx_agent_plans_user_created
  ON public.agent_plans (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_agent_plans_scheduled_draft
  ON public.agent_plans (scheduled_at)
  WHERE status = 'draft';

-- caretaker_messages
CREATE INDEX IF NOT EXISTS idx_caretaker_messages_user_created
  ON public.caretaker_messages (user_id, created_at DESC);

-- market_data_points
CREATE INDEX IF NOT EXISTS idx_market_data_points_market_ts
  ON public.market_data_points (market_id, ts DESC);

-- file_attachments
CREATE INDEX IF NOT EXISTS idx_file_attachments_user_created
  ON public.file_attachments (user_id, created_at DESC);
