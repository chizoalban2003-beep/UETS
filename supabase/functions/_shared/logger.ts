// Centralised error logging for all edge functions.
// Logs to stderr (visible in Supabase Edge Function logs) and optionally
// perserts a row into the error_logs table when a service-role client is available.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.95.0";

export interface LogContext {
  function_name: string;
  user_id?: string;
  [key: string]: unknown;
}

export async function logError(
  err: unknown,
  context: LogContext,
): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  const stack = err instanceof Error ? err.stack : undefined;

  console.error(
    JSON.stringify({
      level: "error",
      function: context.function_name,
      message,
      stack,
      ...context,
      ts: new Date().toISOString(),
    }),
  );

  // Best-effort persistence to error_logs table (if available)
  try {
    const url = Deno.env.get("SUPABASE_URL");
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (url && key) {
      const sb = createClient(url, key);
      await sb.from("error_logs").insert({
        function_name: context.function_name,
        message,
        context: context as unknown as Record<string, unknown>,
      });
    }
  } catch {
    // Silently swallow — don't let logging failures mask the original error
  }
}
