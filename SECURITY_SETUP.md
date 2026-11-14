# Security setup and launch status

This is a test site. Do not collect real applications or household income until the remaining items below have been completed and tested with the fiscal sponsor. This document describes what the code does and what still needs configuration; it is not a claim that the site is safe for production.

## Apply the database hardening

The first household-income migration (`202611130001_household_income.sql`) must already have succeeded. Then:

1. Open your Supabase project and select **SQL Editor** → **New query**.
2. Open `supabase/migrations/202611130003_security_hardening.sql` in VS Code, copy the entire file into the query, and click **Run**. If there is an error, stop and keep the error message; do not disable row-level security.
3. Using sample data, test submitting an application and using each administrator account to review it. Verify a signed-in non-admin cannot read or change applications through the API. The migration allows admins to update only status, practice score and notes; it does not delete previous applications.
4. The separate `202611130002_require_household_income.sql` migration is required after the income fields are deployed. See `HOUSEHOLD_INCOME_SETUP.md` for the order and verify the migration succeeded in the actual project.

The new validation checks email format, certification URL, essay length and image content on the database side. Profile images must be PNG, JPEG or WebP, have the matching file signature and be at most 500 KB. Signature checks do not fully decode or sanitize an image. Existing unchanged legacy images and application records are preserved.

## Set up free CAPTCHA for administrator sign-in

The site contains Cloudflare Turnstile support for administrator login and password-reset requests. The public site key is now configured in the website. Supabase verification becomes active only after its bot-protection setting is enabled with the private secret key.

1. Create a free Cloudflare account, open **Turnstile**, and add a widget for `ssreeramsetty11.github.io`. For temporary local testing, Cloudflare allows `localhost` and `127.0.0.1` in the widget's hostname list; use a separate development widget or remove local hostnames before production.
2. The **site key** is public and is stored as `TURNSTILE_SITE_KEY` in `src/supabase-config.js`. The **secret key is private**: do not put it in the repository, website code, screenshots or chat.
3. Confirm the security check appears on the live site. Then open Supabase **Authentication → Bot and Abuse Protection**, select **Cloudflare Turnstile**, enter the secret key there, enable CAPTCHA and save.
4. Test successful login, rejected login and password-reset emails on the actual HTTPS site. A failed or expired challenge must not sign anyone in. If it prevents login, a Supabase project owner can turn off CAPTCHA in the dashboard while troubleshooting.

Turnstile on Supabase Auth protects sign-in and password recovery only. The repository now also contains a separate protected application endpoint, server-side Turnstile verification, input validation, rate limiting, idempotency, and a final database lock. Those protections are deliberately inactive until their staged deployment and live verification are complete. Follow `SUBMISSION_PROTECTION_SETUP.md` exactly before accepting any real application.

## Review of the 20 requested checks

| Check | Current state |
| --- | --- |
| 1–3. Keys and Git history | The browser uses a Supabase **publishable** key, which is meant to be public. Never add a service-role key, database password, Turnstile secret, or other private credential to the site. A Gitleaks scan of the available Git history and working tree found one match: the intentional publishable key. A scan cannot prove no secret exists. No history rewrite was needed. |
| 4, 6–8. Row security, authorization and tampering | Existing Supabase policies restrict application reads and changes to the admin allowlist. The hardening migration reasserts RLS, validates submissions, and limits admins to review fields. The staged gateway adds a private server path; its final lock removes direct public inserts. These changes must be run and verified in the actual project because local tests do not prove the deployed configuration. All authorized admins intentionally have access to all applications. |
| 5. Encryption | Hosted Supabase provides encryption in transit and at rest. The site does not add application-level encryption or a separate customer-managed key. Confirm project settings, data retention, backups and who can access income and essays before collecting real data. |
| 9–10. Sessions and passwords | Supabase Auth handles password storage; the site never stores password hashes. All pages disable persistent and automatically refreshed browser sessions; the admin page requires signing in after a reload. It also clears this project's old persisted browser session on the home page, but does not revoke older tokens at the server. This static site does **not** use server-managed `HttpOnly` session cookies; a backend would be needed for those. Password recovery still detects the one-time recovery URL while keeping the resulting session out of persistent storage. |
| 11. Login rate limiting | Supabase Auth has configurable server-side rate limits; check **Authentication → Rate Limits** in the project. The earlier 429 confirmed a recovery-email limit, not necessarily the desired login limit. A browser cooldown would not protect the direct Auth API. |
| 12. Bot protection | The public Turnstile site key is configured. Supabase Auth must verify login and recovery challenges, and the separate `submit-application` Edge Function must verify application challenges. The application function and private rate limits exist in the repository but are not active until every stage in `SUBMISSION_PROTECTION_SETUP.md` passes. |
| 13. Parameterized queries | The Supabase client sends structured PostgREST requests; the application does not concatenate applicant input into SQL. |
| 14–16. Validation, escaping and uploads | New database validation and file restrictions require migration `202611130003_security_hardening.sql`. The UI creates elements with `textContent` for user-provided text and restricts link protocols; application data is not intentionally inserted as HTML. |
| 17. API responses | Application, sponsor and team queries now request the fields the interface uses instead of `select('*')`. An authorized admin still receives all details required for review. |
| 18–19. Browser policy and HTTPS | GitHub Pages is configured to enforce HTTPS and currently returns HSTS. The pages add a hash-based CSP and no-referrer meta policy. GitHub Pages does not let this repository set arbitrary HTTP response headers: full `frame-ancestors`, `X-Content-Type-Options`, `Permissions-Policy` and other headers require a hosting service or proxy that supports them. A meta CSP has limitations. |
| 20. Dependencies | The static site pins Tailwind, GSAP and Supabase client versions. The lockfile, scheduled GitHub Actions audit and Dependabot configuration are included; run `npm audit` and `npm run check:security`. At the time of the scan, npm reported no known vulnerabilities in the lockfile. The CDN builds and Cloudflare's hosted challenge script are not fully covered by npm's scan. GitHub dependency alerts were disabled and could not be enabled with the available repository integration; a repository admin can enable **Dependabot alerts** in GitHub's code-security settings. |

## Maintaining the browser policy

The site's HTML is static, so the CSP contains hashes of its inline scripts. After changing an inline script, run `npm run update:csp`, then `npm run check:security` and review the generated changes. Updating a dependency requires updating both `package.json`/the lockfile and its pinned CDN references. Password-reset URLs and tokens must never be shared or placed in logs.
