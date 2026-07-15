-- One-time feedback migration for the live Master Prep project.
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

create index if not exists feedback_status_created_idx
  on public.feedback (status, created_at desc);

alter table public.feedback enable row level security;

do $$ begin
  create policy "feedback_insert_own" on public.feedback for insert
    to authenticated with check ((select auth.uid()) = user_id);
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "feedback_select_own" on public.feedback for select
    to authenticated using ((select auth.uid()) = user_id);
exception when duplicate_object then null;
end $$;
