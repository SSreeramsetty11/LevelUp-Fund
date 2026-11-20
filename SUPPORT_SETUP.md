# Protected support inbox setup

The support page, policies, admin inbox, database migration, and Edge Function are included in the repository. The public support form is deliberately disabled until the server pieces pass these checks. The grant application remains available and unchanged.

Keep the website in **test mode** and use made-up information throughout setup.

## Stage 1: install the support inbox migration

1. Open `supabase/migrations/202611200001_support_requests.sql` in VS Code.
2. Copy the entire file.
3. Open the LevelUp Fund Supabase project → **SQL Editor → New query**.
4. Paste the file and click **Run** once.
5. Confirm **Success. No rows returned**.

The migration creates a locked support table, admin-only read/update/delete policies, and separate expiring support rate limits. It does not reopen public application or support-table inserts.

## Stage 2: deploy the support Edge Function

No new secret is needed. The function securely reuses the existing `TURNSTILE_SECRET_KEY` and `RATE_LIMIT_SECRET` hosted in Supabase.

In the VS Code terminal, on the branch containing these files, run:

```powershell
npx supabase functions deploy submit-support-request --project-ref waxwxtsgkarisigrfncp --no-verify-jwt
```

Choose **Yes** when asked to deploy to production. The Docker warning can be ignored for a hosted deployment. Confirm that `submit-support-request` was deployed.

## Stage 3: prove a fake security token is rejected

Run these PowerShell commands one at a time. The key below is the public browser key, not a private secret.

```powershell
$headers = @{ Origin = 'https://ssreeramsetty11.github.io'; apikey = 'sb_publishable_tzUtJTh-lJMS1M1qk459VA_JwTgRRvN' }
```

```powershell
$body = @{ submissionKey = '00000000-0000-4000-8000-000000000002'; captchaToken = 'not-a-real-token'; honeypot = ''; name = 'Support Test Person'; email = 'support-test@example.com'; category = 'Other'; subject = 'Gateway test'; message = 'This is made-up information for the support gateway test.'; privacyAcknowledged = $true; contactEligibilityConfirmed = $true } | ConvertTo-Json -Compress
```

```powershell
$response = Invoke-WebRequest -Uri 'https://waxwxtsgkarisigrfncp.supabase.co/functions/v1/submit-support-request' -Method Post -Headers $headers -ContentType 'application/json' -Body $body -SkipHttpErrorCheck
$response.StatusCode
$response.Content
```

Expected result:

```text
400
{"ok":false,"error":"captcha_invalid","message":"Please complete the security check again."}
```

Confirm that **Support Test Person** does not appear in the admin support inbox.

## Stage 4: enable and test the live support form

Only after Stage 3 passes:

1. Change `SUPPORT_REQUESTS_ENABLED` in `src/supabase-config.js` from `false` to `true`.
2. Run `npm run test:security` and `npm run check:security`.
3. Commit, push, and wait for GitHub Pages to deploy.
4. Open `https://ssreeramsetty11.github.io/LevelUp-Fund/support.html`.
5. Submit one made-up support question and complete Turnstile.
6. Confirm it appears exactly once for both administrators.
7. Change its status and save an admin note.
8. Test **Prepare reply**, then delete the sample request.

## Stage 5: prove direct public writes remain blocked

```powershell
$directSupport = Invoke-WebRequest -Uri 'https://waxwxtsgkarisigrfncp.supabase.co/rest/v1/levelup_support_requests' -Method Post -Headers @{ apikey = 'sb_publishable_tzUtJTh-lJMS1M1qk459VA_JwTgRRvN' } -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck
$directSupport.StatusCode
$directSupport.Content
```

The status must be `401` or `403`. A `200` or `201` means the support table is not locked and the form must remain disabled.

## Final checks

- Support records are visible only to authorized admins.
- Non-admin accounts cannot read, update, or delete support requests.
- A fake or missing Turnstile token creates no record.
- A valid protected request appears once.
- Direct REST insertion returns `401` or `403`.
- The application form still submits successfully.
- The Privacy Policy and Data Policy have been reviewed with Hack Club Bank.
