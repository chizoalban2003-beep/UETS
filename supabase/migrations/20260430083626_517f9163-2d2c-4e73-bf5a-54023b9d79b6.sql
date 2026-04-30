alter table public.profiles
  add column if not exists skill_level text not null default 'beginner'
    check (skill_level in ('beginner','intermediate','advanced')),
  add column if not exists caretaker_mode text not null default 'suggest'
    check (caretaker_mode in ('teach','suggest','copilot','autopilot'));

create table if not exists public.caretaker_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  market_id uuid,
  kind text not null check (kind in ('pre_event','during_event','post_event','action_taken','lesson')),
  title text not null,
  body_md text not null,
  metrics jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.caretaker_events enable row level security;

create policy "users read own events" on public.caretaker_events
  for select using (auth.uid() = user_id);

create policy "users update own events" on public.caretaker_events
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

create index if not exists caretaker_events_user_created_idx
  on public.caretaker_events (user_id, created_at desc);

create index if not exists caretaker_events_user_market_kind_idx
  on public.caretaker_events (user_id, market_id, kind, created_at desc);