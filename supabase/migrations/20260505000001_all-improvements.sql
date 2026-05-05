-- ============================================================
-- IMPROVEMENT BATCH: All schema additions
-- ============================================================

-- 1. Wallet equity snapshots (daily balance history for portfolio chart)
CREATE TABLE IF NOT EXISTS public.wallet_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  balance numeric(20,4) NOT NULL,
  snapped_at date NOT NULL DEFAULT CURRENT_DATE,
  UNIQUE (user_id, snapped_at)
);
ALTER TABLE public.wallet_snapshots ENABLE ROW LEVEL SECURITY;
CREATE POLICY "users read own snapshots" ON public.wallet_snapshots
  FOR SELECT USING (auth.uid() = user_id);
CREATE INDEX idx_wallet_snapshots_user_date ON public.wallet_snapshots(user_id, snapped_at DESC);

-- Function to record today's snapshot (called by cron or on login)
CREATE OR REPLACE FUNCTION public.record_wallet_snapshot(_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bal numeric;
BEGIN
  SELECT balance INTO _bal FROM wallets WHERE user_id = _user_id;
  INSERT INTO wallet_snapshots (user_id, balance, snapped_at)
  VALUES (_user_id, COALESCE(_bal, 0), CURRENT_DATE)
  ON CONFLICT (user_id, snapped_at) DO UPDATE SET balance = EXCLUDED.balance;
END;
$$;

-- 2. Assessment questions table (no more hardcoded questions)
CREATE TABLE IF NOT EXISTS public.assessment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  stage text NOT NULL DEFAULT 'quiz',
  question text NOT NULL,
  options jsonb NOT NULL,          -- array of strings
  answer_index int NOT NULL,       -- 0-based correct option
  explanation text NOT NULL,
  position int NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.assessment_questions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "questions public read" ON public.assessment_questions FOR SELECT USING (true);
CREATE INDEX idx_assessment_questions_stage ON public.assessment_questions(stage, position) WHERE active;

-- Seed with the 10 existing questions
INSERT INTO public.assessment_questions (stage, question, options, answer_index, explanation, position) VALUES
('quiz', 'What does a Distortion contract pay out at resolution?',
  '["A fixed §1 if the value is above the trend","An amount proportional to how far the final value is OUTSIDE the band","Always zero unless the band is breached by exactly 5%","The same as a Snap-back contract"]',
  1, 'Distortion is scalar: 0 inside the band, scaling toward 1 as the breach grows.', 1),
('quiz', 'What does Snap-back YES pay if the final value stays inside the band?',
  '["0","0.5","1","Same as Distortion YES"]',
  2, 'Snap-back is binary: YES = stayed inside (1), NO = breached (0).', 2),
('quiz', 'Pricing on each contract uses…',
  '["An order book matched by the platform","A constant-product (x·y=k) automated market maker","A Black-Scholes options model","A fixed price set by the creator"]',
  1, 'Each contract is a CPMM with reserves of YES and NO shares.', 3),
('quiz', 'What is the trading fee per trade?',
  '["0%","0.1%","1% (100 bps)","5%"]',
  2, 'fee_bps defaults to 100 = 1%, taken on the gross numeraire amount.', 4),
('quiz', 'When the bot is in ''Suggest'' mode, it…',
  '["Auto-executes trades up to the daily loss cap","Posts ideas you must approve before any trade is placed","Only watches; never proposes anything","Liquidates your portfolio every night"]',
  1, 'Suggest = ideas only. Approve = one-click confirm. Auto = autopilot within risk caps.', 5),
('quiz', 'Holding long Snap-back on two highly correlated markets is…',
  '["A natural hedge — risks cancel out","Effectively a doubled bet on the same outcome","Required by the platform","Lower risk than a single Snap-back"]',
  1, 'Correlated bets compound — they don''t hedge. Hedge with offsetting sides or uncorrelated markets.', 6),
('quiz', 'If the AMM reserves are reserve_yes=600 and reserve_no=400, the implied probability of YES is closest to…',
  '["60%","50%","40%","Cannot be computed"]',
  2, 'Price_YES ≈ reserve_NO / (reserve_YES + reserve_NO) = 400/1000 = 40%.', 7),
('quiz', 'Driftworks paper capital is…',
  '["Convertible 1:1 to USD on withdrawal","A virtual balance for risk-free testing — real-capital staking requires passing the assessment","Capped at §100","Backed by a custodian"]',
  1, 'Paper-only today. Real capital unlocks after passing both assessment stages.', 8),
('quiz', 'The Caretaker bot, when asked to place a trade in ''assist'' mode, will…',
  '["Place the trade silently","Refuse — you must do it manually","Stage the trade as a pending approval card you click to confirm","Email your broker"]',
  2, 'Assist = pending-approval cards. Autopilot = direct execution under risk caps.', 9),
('quiz', 'Max daily loss on the bot is enforced…',
  '["Client-side only, easy to bypass","Server-side per user, blocking new bot trades once breached","Once a year","Only for the Auto mode"]',
  1, 'Risk caps are enforced server-side in the bot run / trade RPC.', 10)
ON CONFLICT DO NOTHING;

-- 3. Leaderboard view (public, opt-in display_name)
CREATE OR REPLACE VIEW public.leaderboard AS
SELECT
  p.id AS user_id,
  COALESCE(p.display_name, 'Anon') AS display_name,
  w.balance,
  (w.balance - 10000) AS pnl,
  ROUND(((w.balance - 10000) / 10000.0) * 100, 2) AS pnl_pct,
  COALESCE(t.trade_count, 0) AS trade_count,
  COALESCE(e.eligible, false) AS real_capital_eligible
FROM profiles p
JOIN wallets w ON w.user_id = p.id
LEFT JOIN (
  SELECT user_id, COUNT(*) AS trade_count FROM trades GROUP BY user_id
) t ON t.user_id = p.id
LEFT JOIN user_capital_eligibility e ON e.user_id = p.id
ORDER BY w.balance DESC
LIMIT 100;

-- 4. Goal auto-status trigger: mark goals achieved/failed when balance changes
CREATE OR REPLACE FUNCTION public.check_goals_on_wallet_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _start_balance numeric := 10000;
  _current numeric;
  g record;
BEGIN
  _current := NEW.balance;
  FOR g IN
    SELECT * FROM user_goals
    WHERE user_id = NEW.user_id AND status = 'active'
  LOOP
    -- Check max loss breach
    IF g.max_loss IS NOT NULL AND (_start_balance - _current) >= g.max_loss THEN
      UPDATE user_goals SET status = 'failed' WHERE id = g.id;
      INSERT INTO notifications (user_id, kind, title, body, payload)
      VALUES (NEW.user_id, 'goal_failed', 'Goal failed: ' || g.title,
        'Your max loss limit of $' || g.max_loss || ' was breached.',
        jsonb_build_object('goal_id', g.id));
    -- Check target achieved
    ELSIF g.target_return_pct IS NOT NULL AND
      _current >= _start_balance * (1 + g.target_return_pct / 100.0) THEN
      UPDATE user_goals SET status = 'achieved' WHERE id = g.id;
      INSERT INTO notifications (user_id, kind, title, body, payload)
      VALUES (NEW.user_id, 'goal_achieved', 'Goal achieved: ' || g.title,
        'You reached your target return of ' || g.target_return_pct || '%!',
        jsonb_build_object('goal_id', g.id));
    END IF;
  END LOOP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_goals_on_wallet ON public.wallets;
CREATE TRIGGER trg_goals_on_wallet
  AFTER UPDATE OF balance ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.check_goals_on_wallet_change();

-- 5. Notification on dispute raised (trigger on market_disputes)
CREATE OR REPLACE FUNCTION public.notify_creator_on_dispute()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _creator uuid;
BEGIN
  SELECT creator_id INTO _creator FROM markets WHERE id = NEW.market_id;
  IF _creator IS NOT NULL AND _creator <> NEW.user_id THEN
    INSERT INTO notifications (user_id, kind, title, body, payload)
    VALUES (_creator, 'dispute_raised', 'Dispute raised on your market',
      'A trader raised a dispute. Review and respond within 24 hours.',
      jsonb_build_object('market_id', NEW.market_id, 'dispute_id', NEW.id));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_dispute_notify ON public.market_disputes;
CREATE TRIGGER trg_dispute_notify
  AFTER INSERT ON public.market_disputes
  FOR EACH ROW EXECUTE FUNCTION public.notify_creator_on_dispute();

-- 6. Notify on market pending resolution
CREATE OR REPLACE FUNCTION public.notify_on_market_resolving()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status = 'pending_resolution' AND OLD.status <> 'pending_resolution' THEN
    -- Notify all position holders
    INSERT INTO notifications (user_id, kind, title, body, payload)
    SELECT DISTINCT p.user_id, 'market_resolving', 'Market resolving: ' || NEW.name,
      'Post the final value to start the dispute window.',
      jsonb_build_object('market_id', NEW.id)
    FROM positions p
    JOIN contracts c ON c.id = p.contract_id
    WHERE c.market_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_market_resolving_notify ON public.markets;
CREATE TRIGGER trg_market_resolving_notify
  AFTER UPDATE OF status ON public.markets
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_market_resolving();

-- 7. Enable realtime on wallet_snapshots
ALTER PUBLICATION supabase_realtime ADD TABLE public.wallet_snapshots;
