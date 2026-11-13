-- Stage 2: apply only after the updated application page is deployed.
-- Existing records remain unchanged, but new applications must include income.
begin;
drop policy if exists application_submit on public.levelup_applications;
create policy application_submit on public.levelup_applications
  for insert to anon, authenticated
  with check (
    age_confirmed is true and household_income is not null
    and status = case when household_income > 90000 then 'Rejected' else 'Pending' end
    and practice_score is null and notes = ''
  );
commit;
