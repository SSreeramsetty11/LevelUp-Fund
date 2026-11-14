// Public project configuration. Never put service_role or secret keys here.
// Leave the publishable key empty until the project owner supplies it.
export const SUPABASE_URL = 'https://waxwxtsgkarisigrfncp.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_tzUtJTh-lJMS1M1qk459VA_JwTgRRvN';
// Public Cloudflare Turnstile site key. Never put the secret key here.
export const TURNSTILE_SITE_KEY = '0x4AAAAAAF_MmFhbWQ4Tpg9i';

// Leave this off until the submit-application Edge Function has been deployed
// and tested. Turning it on routes the public form through the protected server
// endpoint instead of allowing a direct browser-to-database insert.
export const PROTECTED_SUBMISSION_ENABLED = false;
