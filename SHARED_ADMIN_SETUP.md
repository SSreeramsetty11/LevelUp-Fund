# Shared admin setup (test mode)

This branch is for testing. The application and dashboard use Supabase only after the database migration below is installed. Do not collect real applications until authentication, row-level security, and the full workflow have been tested.

## Database

1. In your Supabase project, open **SQL Editor** and create a new query.
2. Copy the complete contents of `supabase/migrations/202611100001_shared_admin.sql` into the editor and run it **once**. If you see an error, stop; do not keep rerunning it or disable row-level security.
3. In Authentication settings, disable public sign-ups. Invite each administrator through **Authentication → Users** so each person controls their own password.
4. To authorize an invited account as an administrator, replace the example email below and run this in SQL Editor after the invitation creates the user. Run it once for each administrator:

```sql
insert into public.levelup_admins (user_id)
select id from auth.users where lower(email) = lower('ADMIN_EMAIL_HERE')
on conflict (user_id) do nothing;
```

This command should report one inserted row for a new administrator. Zero rows can mean the account is missing or already authorized; check the user list before continuing. Do not share or put the database password, service role key, or secret API keys into the site or chat.

The site uses only a public publishable key. The database's row-level security—not that key—restricts application records and editing to authorized admin accounts. A person who can create their own account is not automatically an admin.

## Verification before use

- Test with sample data only. Sign in as two separately invited and authorized admins; check that they can view and update the same pending, approved, and rejected applications and the same sponsors and team profiles.
- Confirm an unauthenticated visitor and an authenticated non-admin cannot read or change application records or modify sponsors and team profiles. Confirm a public visitor can only submit an application and read public sponsor and team information.
- Confirm logout and a reload prevent access until the admin signs in again, and check failures are shown rather than silently reported as successful.
- The current demo stores old sample records in each browser. Those records are not automatically migrated into the shared database.
- Test the public submission path, spam controls, backup and retention settings, privacy notice, admin onboarding and recovery, and error handling before accepting real applications. The current branch does not provide automated decision emails, an abuse-prevention system, or a migration tool.
