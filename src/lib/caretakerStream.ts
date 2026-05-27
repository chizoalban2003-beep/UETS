// SSE client for the caretaker-chat edge function.
// Emits typed events as they arrive from the stream.

import { supabase } from "@/integrations/supabase/client";

export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "tool_call"; id: string; name: string; status: "running" | "done" }
  | { type: "pending"; items: { id: string; name: string; args: any }[] }
  | { type: "error"; error: string }
  | { type: "done" };

export interface StreamOptions {
  message: string;
  fileAttachmentIds?: string[];
  onEvent: (e: StreamEvent) => void;
  signal?: AbortSignal;
}

export async function streamCaretaker(options: StreamOptions): Promise<void> {
  const { message, fileAttachmentIds, onEvent, signal } = options;
  const { data: { session } } = await supabase.auth.getSession();
  const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caretaker-chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session?.access_token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    },
    body: JSON.stringify({ message, file_attachment_ids: fileAttachmentIds ?? [] }),
    signal,
  });

  if (!resp.ok || !resp.body) {
    let err = "Request failed";
    try { const j = await resp.json(); err = j?.error || err; } catch (_) { /* ignore parse errors */ }
    onEvent({ type: "error", error: err });
    onEvent({ type: "done" });
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf("\n")) !== -1) {
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line || line.startsWith(":")) continue;
        if (!line.startsWith("data: ")) continue;
        const payload = line.slice(6).trim();
        if (!payload) continue;
        try {
          const evt = JSON.parse(payload) as StreamEvent;
          onEvent(evt);
        } catch {
          // partial JSON — push back
          buf = line + "\n" + buf;
          break;
        }
      }
    }
  } catch (e: any) {
    if (e?.name !== "AbortError") {
      onEvent({ type: "error", error: String(e?.message || e) });
    }
  }
  onEvent({ type: "done" });
}
