create table public.assessment_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  stage text not null check (stage in ('quiz','sim')),
  score numeric not null,
  passed boolean not null,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.assessment_attempts enable row level security;
create policy "users manage own attempts" on public.assessment_attempts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create index idx_assessment_attempts_user on public.assessment_attempts(user_id, created_at desc);

create table public.user_capital_eligibility (
  user_id uuid primary key,
  quiz_passed_at timestamptz,
  sim_passed_at timestamptz,
  eligible boolean not null default false,
  tier text not null default 'pending',
  notes text,
  updated_at timestamptz not null default now()
);
alter table public.user_capital_eligibility enable row level security;
create policy "users read own eligibility" on public.user_capital_eligibility
  for select using (auth.uid() = user_id);

create or replace function public.touch_eligibility_updated_at()
returns trigger language plpgsql set search_path = public as $$
begin new.updated_at = now(); return new; end; $$;
create trigger trg_eligibility_updated_at
  before update on public.user_capital_eligibility
  for each row execute function public.touch_eligibility_updated_at();