
-- Lock execute on internal helpers
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.handle_new_market() FROM PUBLIC;

-- Set search_path on trigger function that missed it
ALTER FUNCTION public.set_updated_at() SET search_path = public;

-- Make sure execute_trade and resolve_market are not callable by anon
REVOKE EXECUTE ON FUNCTION public.execute_trade(UUID, public.trade_side, NUMERIC, BOOLEAN) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_market(UUID, NUMERIC) FROM PUBLIC, anon;
