-- Preparatory schema: this migration does not connect the website or create accounts.
-- Apply only to a project controlled by the fund after configuring authentication.
create table public.levelup_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.levelup_admins enable row level security;
revoke all on public.levelup_admins from anon, authenticated;

-- SECURITY DEFINER is needed to consult the private allowlist from RLS policies.
create function public.levelup_is_admin() returns boolean
language sql stable security definer set search_path = ''
as $$ select exists (select 1 from public.levelup_admins where user_id = (select auth.uid())); $$;
revoke all on function public.levelup_is_admin() from public;
grant execute on function public.levelup_is_admin() to anon, authenticated;

create table public.levelup_applications (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null check (length(email) between 3 and 254),
  exam_provider text not null check (length(trim(exam_provider)) between 1 and 100),
  certification text not null check (length(trim(certification)) between 1 and 160),
  certification_url text not null check (length(certification_url) <= 2048 and certification_url ~* '^https?://[^/[:space:]]+'),
  essay text not null check (length(trim(essay)) between 1 and 10000),
  amount numeric(12,2) not null check (amount > 0),
  agreement boolean not null check (agreement),
  status text not null default 'Pending' check (status in ('Pending', 'Practice test sent', 'In review', 'Approved', 'Rejected')),
  practice_score numeric check (practice_score between 0 and 100),
  notes text not null default '' check (length(notes) <= 2000)
);
alter table public.levelup_applications enable row level security;
revoke all on public.levelup_applications from anon, authenticated;
-- Applicants can supply only application fields; IDs, timestamps and review fields are server-controlled.
grant insert (name, email, exam_provider, certification, certification_url, essay, amount, agreement) on public.levelup_applications to anon, authenticated;
grant select, update, delete on public.levelup_applications to authenticated;
create policy application_submit on public.levelup_applications for insert to anon, authenticated with check (status = 'Pending' and practice_score is null and notes = '');
create policy application_admin_read on public.levelup_applications for select to authenticated using ((select public.levelup_is_admin()));
create policy application_admin_update on public.levelup_applications for update to authenticated using ((select public.levelup_is_admin())) with check ((select public.levelup_is_admin()));
create policy application_admin_delete on public.levelup_applications for delete to authenticated using ((select public.levelup_is_admin()));

create table public.levelup_sponsors (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  website_url text not null default '' check (length(website_url) <= 500 and (website_url = '' or website_url ~* '^https?://[^/[:space:]]+')),
  image text not null check (length(image) <= 700000),
  created_at timestamptz not null default now()
);
create table public.levelup_team (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  role text not null check (length(trim(role)) between 1 and 100),
  bio text not null check (length(trim(bio)) between 1 and 1200),
  image text not null default '' check (length(image) <= 700000),
  created_at timestamptz not null default now()
);
alter table public.levelup_sponsors enable row level security;
alter table public.levelup_team enable row level security;
revoke all on public.levelup_sponsors, public.levelup_team from anon, authenticated;
grant select on public.levelup_sponsors, public.levelup_team to anon, authenticated;
grant insert, update, delete on public.levelup_sponsors, public.levelup_team to authenticated;
create policy sponsors_public_read on public.levelup_sponsors for select to anon, authenticated using (true);
create policy sponsors_admin_write on public.levelup_sponsors for all to authenticated using ((select public.levelup_is_admin())) with check ((select public.levelup_is_admin()));
create policy team_public_read on public.levelup_team for select to anon, authenticated using (true);
create policy team_admin_write on public.levelup_team for all to authenticated using ((select public.levelup_is_admin())) with check ((select public.levelup_is_admin()));
