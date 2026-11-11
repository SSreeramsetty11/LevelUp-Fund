-- Apply after 202611100001_shared_admin.sql. Existing entries remain nullable.
-- This is an attestation, not an independent verification of an applicant's age.
begin;
alter table public.levelup_applications add column if not exists age_confirmed boolean;
grant insert (age_confirmed) on public.levelup_applications to anon, authenticated;
drop policy if exists application_submit on public.levelup_applications;
create policy application_submit on public.levelup_applications
  for insert to anon, authenticated
  with check (status = 'Pending' and practice_score is null and notes = '' and age_confirmed is true);
commit;
