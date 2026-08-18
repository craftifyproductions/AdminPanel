-- Craftify AI Admin Panel activity logs (mirrors ../admin_activity_logs.sql).
-- Run this in Supabase Dashboard → SQL Editor if not using the CLI.

create table if not exists public.admin_activity_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  user_email text not null,
  action text not null,
  summary text,
  path text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on table public.admin_activity_logs is
  'Admin panel audit trail. Inserts/reads from the app use the service role key.';

comment on column public.admin_activity_logs.user_id is
  'Supabase Auth user id (auth.users.id), or a sentinel uuid for legacy admin.';

comment on column public.admin_activity_logs.action is
  'Short action key, e.g. login, logout, r2.folder.create, settings.model.update';

create index if not exists admin_activity_logs_user_id_idx
  on public.admin_activity_logs (user_id);

create index if not exists admin_activity_logs_created_at_idx
  on public.admin_activity_logs (created_at desc);

create index if not exists admin_activity_logs_user_email_idx
  on public.admin_activity_logs (user_email);

create index if not exists admin_activity_logs_user_email_created_at_idx
  on public.admin_activity_logs (user_email, created_at desc);

alter table public.admin_activity_logs enable row level security;

drop policy if exists "admin_activity_logs_select_own" on public.admin_activity_logs;
create policy "admin_activity_logs_select_own"
  on public.admin_activity_logs
  for select
  to authenticated
  using (auth.uid() = user_id);

revoke all on table public.admin_activity_logs from anon;
grant select on table public.admin_activity_logs to authenticated;
grant all on table public.admin_activity_logs to service_role;
