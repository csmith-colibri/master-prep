-- One-time owner dashboard migration for the live Master Prep project.
-- Safe to run more than once in the Supabase SQL editor.

alter table public.profiles add column if not exists email text;
alter table public.profiles add column if not exists last_seen_at timestamptz;

create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.activity_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  event_type text not null check (event_type in ('app_open', 'quiz_started', 'quiz_completed', 'flashcards_opened')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists activity_events_user_created_idx
  on public.activity_events (user_id, created_at desc);

insert into public.profiles (user_id, email, display_name, created_at, updated_at, last_seen_at)
select id, email, coalesce(raw_user_meta_data ->> 'display_name', split_part(email, '@', 1)), created_at, now(), coalesce(last_sign_in_at, created_at)
from auth.users
on conflict (user_id) do update
set email = excluded.email,
    display_name = coalesce(public.profiles.display_name, excluded.display_name),
    last_seen_at = coalesce(public.profiles.last_seen_at, excluded.last_seen_at),
    updated_at = now();

insert into public.app_admins (user_id)
select id from auth.users where lower(email) = 'christinesmith.colibri@gmail.com'
on conflict (user_id) do nothing;

create or replace function public.is_app_admin(check_user uuid default auth.uid())
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.app_admins where user_id = check_user
  );
$$;

revoke all on function public.is_app_admin(uuid) from public;
grant execute on function public.is_app_admin(uuid) to authenticated;

create or replace function public.sync_master_prep_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (user_id, email, display_name, created_at, updated_at, last_seen_at)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)),
    coalesce(new.created_at, now()),
    now(),
    coalesce(new.last_sign_in_at, now())
  )
  on conflict (user_id) do update
  set email = excluded.email,
      display_name = coalesce(public.profiles.display_name, excluded.display_name),
      updated_at = now();

  if lower(new.email) = 'christinesmith.colibri@gmail.com' then
    insert into public.app_admins (user_id) values (new.id)
    on conflict (user_id) do nothing;
  end if;

  return new;
end;
$$;

drop trigger if exists sync_master_prep_user_trigger on auth.users;
create trigger sync_master_prep_user_trigger
  after insert or update of email on auth.users
  for each row execute function public.sync_master_prep_user();

alter table public.app_admins enable row level security;
alter table public.activity_events enable row level security;

drop policy if exists "app_admins_select_own" on public.app_admins;
create policy "app_admins_select_own" on public.app_admins for select
  to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "profiles_select_admin" on public.profiles;
create policy "profiles_select_admin" on public.profiles for select
  to authenticated using ((select public.is_app_admin()));

drop policy if exists "attempts_select_admin" on public.exam_attempts;
create policy "attempts_select_admin" on public.exam_attempts for select
  to authenticated using ((select public.is_app_admin()));

drop policy if exists "progress_select_admin" on public.study_progress;
create policy "progress_select_admin" on public.study_progress for select
  to authenticated using ((select public.is_app_admin()));

drop policy if exists "feedback_select_admin" on public.feedback;
create policy "feedback_select_admin" on public.feedback for select
  to authenticated using ((select public.is_app_admin()));

drop policy if exists "feedback_update_admin" on public.feedback;
create policy "feedback_update_admin" on public.feedback for update
  to authenticated using ((select public.is_app_admin()))
  with check ((select public.is_app_admin()));

drop policy if exists "activity_insert_own" on public.activity_events;
create policy "activity_insert_own" on public.activity_events for insert
  to authenticated with check ((select auth.uid()) = user_id);

drop policy if exists "activity_select_own" on public.activity_events;
create policy "activity_select_own" on public.activity_events for select
  to authenticated using ((select auth.uid()) = user_id);

drop policy if exists "activity_select_admin" on public.activity_events;
create policy "activity_select_admin" on public.activity_events for select
  to authenticated using ((select public.is_app_admin()));
