-- Allow the protected support Edge Function to check only its retry key.
-- PostgreSQL ON CONFLICT needs SELECT on the conflict-target column. Granting
-- that single column preserves idempotent retries without exposing support
-- names, email addresses, messages, statuses, or admin notes.
begin;

revoke select on public.levelup_support_requests from service_role;
revoke select (
  id, submission_key, created_at, updated_at, resolved_at,
  name, email, category, subject, message,
  privacy_acknowledged, contact_eligibility_confirmed, status, admin_notes
) on public.levelup_support_requests from service_role;

grant select (submission_key)
  on public.levelup_support_requests to service_role;

commit;
