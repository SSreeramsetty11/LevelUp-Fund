# Household-income rollout (test mode only)

The requested policy is based on the annual income reported by the whole household and the grant amount requested. An income over $90,000 is rejected on submission. An application at or below $90,000 remains pending for review, but it cannot be approved unless the requested amount is strictly more than 0.75% of the reported income. Exactly $90,000 is below the automatic-rejection cutoff; exactly 0.75% does not qualify for approval. A zero income is permitted. No qualifying application is automatically approved.

The form also asks applicants to select a labeled annual household income range and requires it to match the exact amount. These labels and ranges are defined for this form, not official income classes. The exact amount is still necessary for the 0.75% calculation and is the value stored in the database. The dashboard derives the class from that amount, including for older records that already have income; records with no income show “Not provided.” No new database column or migration is needed for the dropdown.

The site and project are still for **sample data only**. Household income is sensitive. Before using this for real applications, test database permissions for authenticated non-admin users, finalize the privacy and retention process, and consult the fiscal sponsor about eligibility and minors. Self-reported income and age are not independently verified. Existing records retain their old statuses; those without income cannot be newly approved, though already approved legacy records remain editable.

## Staged database changes

The initial shared-admin and age-confirmation migrations must already be installed. Run the following in the Supabase SQL Editor **once per stage**, in order. If any step fails, stop and inspect the error; do not remove row-level security.

1. **Before deploying the updated form**, run `supabase/migrations/202611130001_household_income.sql`. It adds the income column and server-side checks while still allowing the current test form to submit without income. During this temporary stage, callers can still omit income, so the eligibility policy is not fully enforced. Continue using sample data only.
2. Deploy the updated site and test sample applications, the admin dashboard, and the original shared-admin functions. Above $90,000 must show as rejected. Exactly $90,000 with a $675 request must remain pending and cannot be approved; $675.01 passes the income rule but still needs review. Old records should remain accessible.
3. Once the new form is live, run `supabase/migrations/202611130002_require_household_income.sql`. This blocks new submissions that omit income; older rows remain unchanged. Test that missing income and an attempted approval that does not meet the rule are rejected by the database, including for direct API calls and all authorized administrators.

The two migrations must both be applied for the final rule to be fully enforced. Email notifications are not automatic. Do not enter real household income during testing.
