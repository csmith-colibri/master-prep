-- Run this once in the Supabase SQL editor for Master Prep.
-- Every policy below keeps each firefighter's records private.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
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

create index if not exists exam_attempts_user_completed_idx
  on public.exam_attempts (user_id, completed_at desc);

alter table public.profiles enable row level security;
alter table public.exam_attempts enable row level security;
alter table public.study_progress enable row level security;

create policy "profiles_select_own" on public.profiles for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "profiles_insert_own" on public.profiles for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "profiles_update_own" on public.profiles for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "attempts_select_own" on public.exam_attempts for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "attempts_insert_own" on public.exam_attempts for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "attempts_delete_own" on public.exam_attempts for delete
  to authenticated using ((select auth.uid()) = user_id);

create policy "progress_select_own" on public.study_progress for select
  to authenticated using ((select auth.uid()) = user_id);
create policy "progress_insert_own" on public.study_progress for insert
  to authenticated with check ((select auth.uid()) = user_id);
create policy "progress_update_own" on public.study_progress for update
  to authenticated using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
