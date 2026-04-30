## Plan: Floating Caretaker, Goals page, Onboarding banner, SSE streaming

Polish the Caretaker experience so it feels like a true co-pilot present everywhere in the app, plus finish the loose ends from last round.

### 1. Floating Caretaker launcher (every page)
- New `src/components/CaretakerDock.tsx`: fixed bottom-right floating button (sparkle icon) + slide-out side panel (Sheet from shadcn).
- Panel embeds a compact version of the chat: last ~20 messages, input box, "Open full Caretaker" link to `/caretaker`.
- Mount in `src/components/Layout.tsx` so it appears on every authenticated route.
- Hidden on `/auth` and `/caretaker` (avoid duplication).
- Unread indicator: small dot when caretaker posts a message while panel is closed (tracked in local state + realtime subscription on `caretaker_messages`).

### 2. Dedicated Goals page (`/goals`)
- New `src/pages/Goals.tsx`: list of `user_goals` with status pills, target return %, max loss, deadline.
- "New goal" dialog: title, target return %, max loss, deadline, notes.
- Inline edit + status toggle (active / paused / achieved / abandoned).
- Progress bar per goal: computed from current portfolio P&L vs target (client-side from wallet + positions).
- Add "Goals" entry to `Layout.tsx` nav and a route in `src/App.tsx`.
- Caretaker `set_goal` tool already writes here — link from Caretaker chat to `/goals`.

### 3. Onboarding banner on `/bot`
- In `src/pages/Bot.tsx`, detect when `bots.enabled_market_ids` was auto-seeded (length > 0 AND user has zero trades).
- Show a dismissible banner: "We auto-subscribed you to N live markets. Bot is in Suggest mode — review and approve trades on the Suggestions tab."
- Buttons: "View markets" (scrolls to enabled list), "Switch to Auto" (updates `mode`), "Dismiss" (stored in `localStorage`).

### 4. SSE streaming for Caretaker chat
- Refactor `supabase/functions/caretaker-chat/index.ts` to stream from Lovable AI Gateway using `stream: true` and forward SSE chunks to the client.
- On the client (`Caretaker.tsx` and `CaretakerDock.tsx`): use `fetch` with a `ReadableStream` reader instead of `supabase.functions.invoke`, append tokens to the in-progress assistant message as they arrive.
- Tool-call chunks: buffer until complete, then either auto-execute (autopilot) or render an approval card (assist).
- Persist final assistant message + tool_calls to `caretaker_messages` once the stream ends.
- Handle 429 (rate limit) and 402 (credits) with friendly inline errors.

### 5. Small fixes discovered along the way
- Ensure `Layout.tsx` nav doesn't overflow on mobile with the new "Goals" link (collapse into a "More" menu if width < md, or use the existing pattern).
- Make sure `react-markdown` renders inside the floating dock (reuse the existing prose styles).

### Technical notes
- No DB migrations needed — `user_goals`, `caretaker_messages`, and `bots.enabled_market_ids` already exist.
- SSE: Lovable AI Gateway supports OpenAI-compatible streaming; the edge function will pipe `response.body` through to the caller with `Content-Type: text/event-stream` and CORS headers.
- Realtime: enable `caretaker_messages` on the `supabase_realtime` publication so the dock can light up its unread dot when a background tool produces a message (e.g. scheduled report ready).

### Files to create / edit
- create `src/components/CaretakerDock.tsx`
- create `src/pages/Goals.tsx`
- edit `src/components/Layout.tsx` (mount dock, add Goals nav)
- edit `src/App.tsx` (route `/goals`)
- edit `src/pages/Bot.tsx` (onboarding banner)
- edit `src/pages/Caretaker.tsx` (switch to streaming fetch)
- edit `supabase/functions/caretaker-chat/index.ts` (SSE streaming)
- migration: `ALTER PUBLICATION supabase_realtime ADD TABLE public.caretaker_messages;`
