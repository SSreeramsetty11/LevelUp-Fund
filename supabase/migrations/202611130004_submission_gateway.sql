-- Stage 1 of the protected application-submission gateway.
--
-- Apply this migration before deploying the submit-application Edge Function.
-- It deliberately leaves the existing anonymous insert policy in place so the
-- currently deployed form keeps working during the staged rollout. Apply the
-- separate lock migration only after a protected test submission succeeds.
begin;

-- A client-generated UUID makes retries idempotent. Existing applications keep
-- a NULL value and are not changed.
alter table public.levelup_applications
  add column if not exists submission_key uuid;
alter table public.levelup_applications
  add column if not exists test_date date;

-- Keep the transition compatible with the currently deployed form. The final
-- lock migration requires this value for every new protected submission.
grant insert (test_date) on public.levelup_applications to anon, authenticated;

create unique index if not exists levelup_applications_submission_key_key
  on public.levelup_applications (submission_key);

-- The Edge Function inserts an explicit allowlist of applicant fields. Keep
-- submission_key unavailable to public callers during the transition.
revoke insert on public.levelup_applications from service_role;
revoke insert (
  id, created_at, name, email, exam_provider, certification,
  certification_url, test_date, essay, amount, agreement, status, practice_score, notes,
  age_confirmed, household_income, submission_key
) on public.levelup_applications from service_role;
grant insert (submission_key, name, email, exam_provider, certification,
  certification_url, test_date, essay, amount, agreement, age_confirmed, household_income)
  on public.levelup_applications to service_role;

-- Rate-limit buckets are kept outside the exposed public schema. Identifiers
-- stored here are HMAC-SHA-256 digests produced by the Edge Function; raw IP
-- addresses and email addresses must never be stored.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create table if not exists private.levelup_submission_rate_limits (
  key_hash text not null check (key_hash ~ '^[0-9a-f]{64}$'),
  kind text not null check (kind in ('ip', 'email')),
  window_started_at timestamptz not null,
  attempts integer not null check (attempts between 1 and 13),
  expires_at timestamptz not null,
  primary key (key_hash, kind, window_started_at),
  check (expires_at > window_started_at)
);

create index if not exists levelup_submission_rate_limits_expires_at_idx
  on private.levelup_submission_rate_limits (expires_at);

alter table private.levelup_submission_rate_limits enable row level security;
alter table private.levelup_submission_rate_limits force row level security;
revoke all on private.levelup_submission_rate_limits
  from public, anon, authenticated, service_role;

-- Atomically consumes one fixed-window slot. Limits are intentionally fixed in
-- database code so a caller cannot weaken them through RPC parameters:
--   ip:    12 attempts per 15 minutes
--   email:  3 verified attempts per 24 hours
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
    when 'ip' then
      v_limit := 12;
      v_window_seconds := 900;
    when 'email' then
      v_limit := 3;
      v_window_seconds := 86400;
    else
      raise exception 'Invalid rate-limit kind.';
  end case;

  v_window_started_at := to_timestamp(
    floor(extract(epoch from statement_timestamp()) / v_window_seconds)
      * v_window_seconds
  );

  -- Retain at most one additional window so abuse metadata expires quickly.
  delete from private.levelup_submission_rate_limits
    where expires_at <= statement_timestamp();

  insert into private.levelup_submission_rate_limits (
    key_hash, kind, window_started_at, attempts, expires_at
  ) values (
    p_key_hash,
    p_kind,
    v_window_started_at,
    1,
    v_window_started_at + (v_window_seconds * 2) * interval '1 second'
  )
  on conflict (key_hash, kind, window_started_at) do update
    set attempts = least(
          private.levelup_submission_rate_limits.attempts + 1,
          v_limit + 1
        ),
        expires_at = greatest(
          private.levelup_submission_rate_limits.expires_at,
          excluded.expires_at
        )
  returning attempts into v_attempts;

  return v_attempts <= v_limit;
end;
$$;

revoke all on function public.levelup_take_submission_slot(text, text)
  from public, anon, authenticated;
grant execute on function public.levelup_take_submission_slot(text, text)
  to service_role;

commit;
