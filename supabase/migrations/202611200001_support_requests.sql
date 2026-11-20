-- Protected support-request inbox for the shared admin dashboard.
-- Run only after the protected application gateway is already live.
begin;

create table if not exists public.levelup_support_requests (
  id uuid primary key default gen_random_uuid(),
  submission_key uuid not null unique,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  name text not null check (length(trim(name)) between 1 and 120),
  email text not null check (length(email) between 3 and 254),
  category text not null check (category in (
    'Application question', 'Eligibility', 'Technical problem',
    'Privacy or data request', 'Other'
  )),
  subject text not null check (length(trim(subject)) between 1 and 160),
  message text not null check (length(trim(message)) between 10 and 4000),
  privacy_acknowledged boolean not null check (privacy_acknowledged),
  contact_eligibility_confirmed boolean not null check (contact_eligibility_confirmed),
  status text not null default 'Open' check (status in ('Open', 'In progress', 'Resolved')),
  admin_notes text not null default '' check (length(admin_notes) <= 2000)
);

alter table public.levelup_support_requests enable row level security;
revoke all on public.levelup_support_requests from public, anon, authenticated, service_role;

-- Public visitors never write directly. Only the protected Edge Function can
-- insert the public form's explicit allowlist of fields.
grant insert (
  submission_key, name, email, category, subject, message,
  privacy_acknowledged, contact_eligibility_confirmed
) on public.levelup_support_requests to service_role;

-- Signed-in admins can read the inbox, change only workflow fields, and delete
-- a request under the published retention/deletion policy.
grant select on public.levelup_support_requests to authenticated;
grant update (status, admin_notes) on public.levelup_support_requests to authenticated;
grant delete on public.levelup_support_requests to authenticated;

drop policy if exists support_admin_read on public.levelup_support_requests;
drop policy if exists support_admin_update on public.levelup_support_requests;
drop policy if exists support_admin_delete on public.levelup_support_requests;
create policy support_admin_read on public.levelup_support_requests
  for select to authenticated using ((select public.levelup_is_admin()));
create policy support_admin_update on public.levelup_support_requests
  for update to authenticated using ((select public.levelup_is_admin()))
  with check ((select public.levelup_is_admin()));
create policy support_admin_delete on public.levelup_support_requests
  for delete to authenticated using ((select public.levelup_is_admin()));

create or replace function public.levelup_validate_support_request()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.name !~ '[^[:space:]]' or new.subject !~ '[^[:space:]]'
     or length(trim(new.message)) < 10 then
    raise exception 'Support request fields must not be empty.';
  end if;
  if new.email !~ '^[^[:space:]@]+@[^[:space:]@]+$' then
    raise exception 'Enter a valid email address.';
  end if;
  return new;
end;
$$;
revoke all on function public.levelup_validate_support_request() from public;
drop trigger if exists levelup_validate_support_request on public.levelup_support_requests;
create trigger levelup_validate_support_request before insert on public.levelup_support_requests
  for each row execute function public.levelup_validate_support_request();

create or replace function public.levelup_touch_support_request()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := statement_timestamp();
  if new.status = 'Resolved' and old.status is distinct from 'Resolved' then
    new.resolved_at := statement_timestamp();
  elsif new.status <> 'Resolved' then
    new.resolved_at := null;
  end if;
  return new;
end;
$$;
revoke all on function public.levelup_touch_support_request() from public;
drop trigger if exists levelup_touch_support_request on public.levelup_support_requests;
create trigger levelup_touch_support_request before update on public.levelup_support_requests
  for each row execute function public.levelup_touch_support_request();

-- Reuse the private, expiring hashed-identifier rate-limit table. No raw IP or
-- email address is stored in the rate-limit data.
alter table private.levelup_submission_rate_limits
  drop constraint if exists levelup_submission_rate_limits_kind_check;
alter table private.levelup_submission_rate_limits
  add constraint levelup_submission_rate_limits_kind_check
  check (kind in ('ip', 'email', 'support_ip', 'support_email'));

create or replace function public.levelup_take_submission_slot(
  p_key_hash text,
  p_kind text
) returns boolean
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_limit integer;
  v_window_seconds integer;
  v_window_started_at timestamptz;
  v_attempts integer;
begin
  if p_key_hash is null or p_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid rate-limit key.';
  end if;

  case p_kind
    when 'ip' then v_limit := 12; v_window_seconds := 900;
    when 'email' then v_limit := 3; v_window_seconds := 86400;
    when 'support_ip' then v_limit := 8; v_window_seconds := 900;
    when 'support_email' then v_limit := 5; v_window_seconds := 86400;
    else raise exception 'Invalid rate-limit kind.';
  end case;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from statement_timestamp()) / v_window_seconds)
      * v_window_seconds
  );
  delete from private.levelup_submission_rate_limits
    where expires_at <= statement_timestamp();
  insert into private.levelup_submission_rate_limits (
    key_hash, kind, window_started_at, attempts, expires_at
  ) values (
    p_key_hash, p_kind, v_window_started_at, 1,
    v_window_started_at + (v_window_seconds * 2) * interval '1 second'
  )
  on conflict (key_hash, kind, window_started_at) do update
    set attempts = least(private.levelup_submission_rate_limits.attempts + 1, v_limit + 1),
        expires_at = greatest(private.levelup_submission_rate_limits.expires_at, excluded.expires_at)
  returning attempts into v_attempts;
  return v_attempts <= v_limit;
end;
$$;
revoke all on function public.levelup_take_submission_slot(text, text)
  from public, anon, authenticated;
grant execute on function public.levelup_take_submission_slot(text, text)
  to service_role;

commit;
