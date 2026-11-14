-- Stage 2 of the protected application-submission gateway.
--
-- Apply ONLY after the Edge Function is deployed, the protected frontend is
-- live, and one real Turnstile-protected sample submission has succeeded.
-- This removes the old direct-to-database submission path permanently.
begin;

-- Revoke both table-level and every current column-level INSERT grant. A
-- table-level revoke alone does not remove PostgreSQL column grants.
revoke insert on public.levelup_applications from anon, authenticated;
revoke insert (
  id, created_at, name, email, exam_provider, certification,
  certification_url, test_date, essay, amount, agreement, status, practice_score, notes,
  age_confirmed, household_income, submission_key
) on public.levelup_applications from anon, authenticated;

drop policy if exists application_submit on public.levelup_applications;

-- The server-only Edge Function retains only the INSERT fields it needs.
revoke insert on public.levelup_applications from service_role;
revoke insert (
  id, created_at, name, email, exam_provider, certification,
  certification_url, test_date, essay, amount, agreement, status, practice_score, notes,
  age_confirmed, household_income, submission_key
) on public.levelup_applications from service_role;
grant insert (submission_key, name, email, exam_provider, certification,
  certification_url, test_date, essay, amount, agreement, age_confirmed, household_income)
  on public.levelup_applications to service_role;

-- Existing applications remain nullable, but every new protected submission
-- must include the applicant's planned test date.
create or replace function public.levelup_require_test_date()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.test_date is null then
    raise exception 'A planned test date is required.';
  end if;
  return new;
end;
$$;
revoke all on function public.levelup_require_test_date() from public;
drop trigger if exists levelup_require_test_date on public.levelup_applications;
create trigger levelup_require_test_date before insert on public.levelup_applications
  for each row execute function public.levelup_require_test_date();

commit;
