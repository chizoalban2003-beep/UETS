## Plan: Convert Caretaker chat to true SSE streaming

Refactor the existing `caretaker-chat` edge function and both clients (full page + floating dock) to stream tokens as they're generated, with live tool-call indicators and the existing approval flow preserved.

### Edge function (`supabase/functions/caretaker-chat/index.ts`)
- Replace the synchronous JSON response with a `ReadableStream` returning `text/event-stream`.
- Call Lovable AI Gateway with `stream: true` and parse the upstream OpenAI-compatible SSE.
- Emit these client events:
  - `{type:"text", delta}` — streamed assistant text
  - `{type:"tool_call", id, name, status:"running"|"done"}` — live tool indicators
  - `{type:"pending", items:[...]}` — mutating tools awaiting user approval (assist mode)
  - `{type:"error", error}` — friendly messages for 429 / 402 / upstream errors
  - `{type:"done"}` — stream complete
- Accumulate streamed `tool_calls` deltas by `index`, then run the same execute/approve/loop logic as today (read-only inline, autopilot inline, assist returns pending).
- Persist assistant + tool messages to `caretaker_messages` after each step (so the realtime dock badge still works).

### Clients (`src/pages/Caretaker.tsx` and `src/components/CaretakerDock.tsx`)
- Replace `await fetch().then(r=>r.json())` with a streaming `fetch` that reads `response.body` via a `ReadableStreamDefaultReader`.
- Maintain an in-progress assistant message in local state; append `text` deltas to it for token-by-token rendering.
- Show a small chip per `tool_call` event ("running calc…", "✓ ran calc").
- On `pending`, render the existing approval cards.
- On `error`, toast and stop.
- On `done`, do a final `load()` to reconcile with persisted DB rows.

### Edge cases / safety
- Abort controller wired to component unmount so closing the dock cancels the stream.
- Rate-limit (429) and credits-exhausted (402) shown inline as a system bubble, not just a toast.
- If the stream ends without `done` (network drop), still flush the partial assistant message.

### Files
- edit `supabase/functions/caretaker-chat/index.ts`
- edit `src/pages/Caretaker.tsx`
- edit `src/components/CaretakerDock.tsx`

No DB changes, no new packages.
