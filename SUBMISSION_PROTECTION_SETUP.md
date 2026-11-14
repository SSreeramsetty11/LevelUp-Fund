# Protected application submission setup

The repository contains a server-protected application path, but it is deliberately introduced in stages. This prevents the public form from breaking while the Supabase Edge Function is being configured.

The site is still in **test mode**. Use obviously fake sample information only. Do not collect real names, email addresses, essays, or household income until every verification in this guide passes and Hack Club Bank has approved the privacy, retention, eligibility, and applicant-support process.

## What this protection does

When it is fully enabled, a submission follows this path:

1. The browser validates the form and obtains a one-time Cloudflare Turnstile token.
2. The browser sends the application to the `submit-application` Supabase Edge Function.
3. The function verifies the token with Cloudflare, checks the exact website origin and all fields, and applies IP and email rate limits.
4. Only the function's private server credential inserts the allowlisted fields into Supabase.
5. The final database migration blocks visitors from bypassing the function and inserting directly.

The Turnstile **site key** in the website is public. The Turnstile secret, the Supabase server key, and the rate-limit secret must never be placed in this repository, website code, screenshots, chat, or support messages.

## Before starting

- Confirm `202611130001_household_income.sql`, `202611130002_require_household_income.sql`, and `202611130003_security_hardening.sql` have already succeeded in Supabase.
- Work from the current LevelUp Fund repository in VS Code.
- Open the VS Code terminal with **Terminal → New Terminal**. The prompt should be inside the `LevelUp-Fund` folder.
- Check Node.js with `node --version`. Use Node.js 20 or newer. If the command is missing or the number is below 20, install the current LTS release from <https://nodejs.org/> and reopen VS Code.

Stop at the first unexpected error. Do not skip a failed step, turn off row-level security, or restore public database access as a shortcut.

## Stage 1: install the gateway database objects

This stage adds the planned test-date column, unique retry key, and private rate-limit table/function. It does **not** block the current test form yet.

1. In VS Code, open `supabase/migrations/202611130004_submission_gateway.sql`.
2. Select and copy the entire file.
3. Open the Supabase project at <https://supabase.com/dashboard/project/waxwxtsgkarisigrfncp>.
4. Select **SQL Editor → New query**, paste the file, and click **Run** once.
5. The result should say **Success**. If it does not, stop and keep the error message. Do not run the final lock migration.

## Stage 2: add the two private Edge Function secrets

Open the project's secrets page directly:

<https://supabase.com/dashboard/project/waxwxtsgkarisigrfncp/functions/secrets>

Add these two names:

- `TURNSTILE_SECRET_KEY`: paste the private secret shown for the application widget in Cloudflare Turnstile. This is not the public site key.
- `RATE_LIMIT_SECRET`: create a new, unrelated random value with at least 32 random bytes (a password manager can generate a 43-character-or-longer random password). Do not reuse a password, the Turnstile secret, or a Supabase key.

Click **Save**. Enter both values directly in Supabase; do not send them to anyone. Supabase makes saved Edge Function secrets available without another code change.

Do not add `SUPABASE_SECRET_KEYS` yourself. Supabase provides that server-only value to hosted Edge Functions automatically.

## Stage 3: deploy the Edge Function

In the VS Code terminal, run these commands one at a time:

```bash
npm install
npx supabase login
npx supabase functions deploy submit-application --project-ref waxwxtsgkarisigrfncp --no-verify-jwt
```

The login command opens Supabase in the browser. Approve the login using the account that owns the project. The last command should finish with a successful deployment for `submit-application`.

`--no-verify-jwt` is intentional for this one function because applicants are not signed in. It does not make the submission unprotected: the function itself requires the exact site origin, Turnstile verification, validation, and rate limits. Do not disable JWT verification globally or for unrelated functions.

## Stage 4: prove a fake challenge is rejected

This check confirms that the function is deployed and fails closed. It must not create an application.

1. In `src/supabase-config.js`, copy the value of `SUPABASE_PUBLISHABLE_KEY`. It is a public browser key, not a private server key.
2. In the terminal, replace `PASTE_PUBLIC_KEY_HERE` below with that value and run the two commands. Do not replace `not-a-real-token` with a real token.

```bash
LEVELUP_PUBLIC_KEY='PASTE_PUBLIC_KEY_HERE'
curl -i -X POST 'https://waxwxtsgkarisigrfncp.supabase.co/functions/v1/submit-application' \
  -H 'Origin: https://ssreeramsetty11.github.io' \
  -H 'Content-Type: application/json' \
  -H "apikey: $LEVELUP_PUBLIC_KEY" \
  --data '{"submissionKey":"00000000-0000-4000-8000-000000000001","captchaToken":"not-a-real-token","honeypot":"","name":"Gateway Test Applicant","email":"gateway-test@example.com","examProvider":"Example Provider","exam":"Example Certification","certificationUrl":"https://example.com/certification","testDate":"2027-06-15","essay":"This is fake sample information used only to test that an invalid security token is rejected.","requestedAmount":500,"householdIncome":50000,"agreement":true,"ageConfirmed":true}'
```

The expected result is HTTP `400` with:

```json
{"ok":false,"error":"captcha_invalid","message":"Please complete the security check again."}
```

Open the admin dashboard and confirm there is **no** `Gateway Test Applicant` record. If the response is `401`, `404`, `500`, or `503`, or a record appears, stop. Do not enable the protected form or run the final lock migration. Recheck the function deployment and secrets. Avoid repeating the probe many times because attempts are intentionally rate-limited.

## Stage 5: enable and test the protected website path

Only continue after Stage 4 passes.

1. Change `PROTECTED_SUBMISSION_ENABLED` in `src/supabase-config.js` from `false` to `true`.
2. Run the repository tests:

   ```bash
   npm run test:security
   npm run check:security
   ```

   Do not deploy with a failing test.
3. Commit and push the change, wait for GitHub Pages to finish deploying, and open <https://ssreeramsetty11.github.io/LevelUp-Fund/apply.html>.
4. Submit one application using clearly fake sample information. Complete the Turnstile challenge normally.
5. Confirm the success message appears and the sample is visible exactly once in the admin dashboard. Confirm another administrator can see the same sample.
6. Retry only if necessary. A retry must not create a duplicate record.

Do not continue if the protected sample is missing, duplicated, or submitted without a completed security challenge.

## Stage 6: block direct public inserts

This is the final cutover. Run it only after the protected live sample in Stage 5 works.

1. In VS Code, open `supabase/migrations/202611130005_lock_direct_submissions.sql` and copy the entire file.
2. In Supabase, select **SQL Editor → New query**, paste the file, and click **Run** once.
3. Confirm the result says **Success**.

Now prove a browser key cannot insert directly. The terminal still has `LEVELUP_PUBLIC_KEY` from Stage 4; if the terminal was closed, set it again first. Run:

```bash
curl -i -X POST 'https://waxwxtsgkarisigrfncp.supabase.co/rest/v1/levelup_applications' \
  -H "apikey: $LEVELUP_PUBLIC_KEY" \
  -H 'Content-Type: application/json' \
  -H 'Prefer: return=minimal' \
  --data '{}'
```

The request must fail with HTTP `401` or `403` and a permission error. A `200` or `201` result means direct inserts are still open; stop accepting applications.

Finally, submit one more fake Turnstile-protected application from the live form. It should still appear exactly once for every authorized administrator. This proves the Edge Function can insert while the public key cannot.

## Final checks before considering a launch

- A missing, expired, or fake Turnstile challenge is rejected without creating a record.
- A valid protected sample works after the final lock migration.
- A direct REST insert using the publishable key returns `401` or `403`.
- Anonymous application reads remain blocked.
- A signed-in non-admin cannot read or change applications.
- Each authorized administrator can see pending, accepted, and denied applications.
- Sponsor and team public displays still load, and administrators can still edit them.
- HTTPS is enforced on the live site.
- GitHub Actions and the local security tests pass.
- The fund has a reviewed privacy notice, retention/deletion procedure, incident contact, and applicant support process.
- Hack Club Bank has approved the final application wording, eligibility policy, handling of applicants age 14 and older, and collection of household-income information.

Turnstile, validation, and rate limits reduce automated abuse; they do not prove an applicant's identity, age, income, essay authorship, or eligibility.

## Safe rollback rules

- **Before Stage 5:** leave `PROTECTED_SUBMISSION_ENABLED` set to `false` while the function is fixed. Do not run the final lock migration.
- **After Stage 5 but before Stage 6:** revert the feature flag to `false` if the new path has a problem, then fix and retest the function.
- **After Stage 6:** never restore anonymous database inserts to work around an outage. Pause the application form, keep the database lock in place, repair or redeploy the Edge Function from the reviewed repository version, and repeat the fake-token, protected-sample, and direct-insert checks.

The migrations preserve existing application rows. Do not delete old applications or rewrite Git history as part of this rollout.
