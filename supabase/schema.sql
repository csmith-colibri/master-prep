-- Run this once in the Supabase SQL editor for Master Prep.
-- Every policy below keeps each firefighter's records private.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.exam_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  quiz_kind text not null check (quiz_kind in ('baseline', 'practice', 'timed')),
  score integer not null,
  total integer not null,
  percent integer not null check (percent between 0 and 100),
  answers jsonb not null default '{}'::jsonb,
  question_ids integer[] not null,
  missed_topics jsonb not null default '[]'::jsonb,
  completed_at timestamptz not null default now()
);

create table if not exists public.study_progress (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active_exam jsonb,
  flashcard_index integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null check (category in ('content_error', 'unclear', 'source_question', 'feature_idea', 'technical')),
  message text not null check (char_length(message) between 4 and 1200),
  origin text not null,
  question_id integer,
  content_prompt text,
  source text,
  app_version text,
  status text not null default 'new' check (status in ('new', 'reviewing', 'resolved', 'declined')),
  created_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('app_open', 'quiz_started', 'quiz_completed', 'flashcards_opened')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists exam_attempts_user_completed_idx
  on public.exam_attempts (user_id, completed_at desc);
create index if not exists feedback_status_created_idx
  on public.feedback (status, created_at desc);
create index if not exists activity_events_user_created_idx
  on public.activity_events (user_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.app_admins enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.study_progress enable row level security;
alter table public.feedback enable row level security;
alter table public.activity_events enable row level security;

create or replace function public.is_app_admin(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.app_admins where user_id = check_user);
$$;

revoke all on function public.is_app_admin(uuid) from public;
grant execute on function public.is_app_admin(uuid) to authenticated;

create policy "profiles_select_own" on public.profiles for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "profiles_select_admin" on public.profiles for select
  to authenticated using ((select public.is_app_admin()));

create policy "app_admins_select_own" on public.app_admins for select
  to authenticated using ((select auth.uid()) = user_id);

create policy "attempts_select_own" on public.exam_attempts for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "attempts_insert_own" on public.exam_attempts for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "attempts_delete_own" on public.exam_attempts for delete
  to authenticated using ((select auth.uid()) = user_id);
create policy "attempts_select_admin" on public.exam_attempts for select
  to authenticated using ((select public.is_app_admin()));

create policy "progress_select_own" on public.study_progress for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "progress_insert_own" on public.study_progress for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "progress_update_own" on public.study_progress for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "progress_select_admin" on public.study_progress for select
  to authenticated using ((select public.is_app_admin()));

create policy "feedback_insert_own" on public.feedback for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "feedback_select_own" on public.feedback for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "feedback_select_admin" on public.feedback for select
  to authenticated using ((select public.is_app_admin()));
create policy "feedback_update_admin" on public.feedback for update
  to authenticated using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

create policy "activity_insert_own" on public.activity_events for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "activity_select_own" on public.activity_events for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "activity_select_admin" on public.activity_events for select
  to authenticated using ((select public.is_app_admin()));
