import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

// GitHub Pages cannot add custom HTTP headers. Its CSP is therefore delivered
// by a meta tag; only inline scripts whose hashes appear here may execute.
const pages = ['index.html', 'apply.html', 'team.html', 'reset-password.html'];
const write = process.argv.includes('--update');
const config = JSON.parse(readFileSync('package.json', 'utf8'));
const supabase = config.dependencies['@supabase/supabase-js'];
const tailwind = config.dependencies.tailwindcss;
const gsap = config.dependencies.gsap;
let failed = false;
for (const path of pages) {
  let html = readFileSync(path, 'utf8');
  const inlineScripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)]
    .filter((match) => !/\bsrc\s*=/i.test(match[1]))
    .map((match) => "'sha256-" + createHash('sha256').update(match[2], 'utf8').digest('base64') + "'");
  if (!inlineScripts.length) throw new Error(`${path}: no inline scripts found`);
  const policy = [
    "default-src 'self'",
    `script-src 'self' https://cdn.tailwindcss.com https://cdn.jsdelivr.net https://challenges.cloudflare.com ${inlineScripts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data: https:",
    "connect-src 'self' https://waxwxtsgkarisigrfncp.supabase.co wss://waxwxtsgkarisigrfncp.supabase.co https://challenges.cloudflare.com",
    "frame-src https://challenges.cloudflare.com",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'"
  ].join('; ');
  const tag = `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
  const tagPattern = /<meta\s+http-equiv="Content-Security-Policy"\s+content="[^"]*">/i;
  const current = html.match(tagPattern)?.[0];
  if (current !== tag) {
    if (write) {
      html = current ? html.replace(tagPattern, tag) : html.replace(/<head>/i, `<head>\n  ${tag}`);
      writeFileSync(path, html);
      console.log(`Updated ${path} CSP.`);
    } else {
      console.error(`${path}: CSP is missing or does not match the inline scripts. Run npm run update:csp.`);
      failed = true;
    }
  }
  const expectedSupabase = `@supabase/supabase-js@${supabase}/+esm`;
  if (html.includes('@supabase/supabase-js@') && !html.includes(expectedSupabase)) {
    console.error(`${path}: Supabase CDN version does not match package.json.`); failed = true;
  }
  const tailwindScripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']https:\/\/cdn\.tailwindcss\.com(?:\/([^"']*))?["']/gi)];
  if (tailwindScripts.some((match) => match[1] !== tailwind)) {
    console.error(`${path}: Tailwind CDN version does not match package.json.`); failed = true;
  }
  if (html.includes('/npm/gsap@') && !html.includes(`/npm/gsap@${gsap}/`)) {
    console.error(`${path}: GSAP CDN version does not match package.json.`); failed = true;
  }
}
const application = readFileSync('src/application.js', 'utf8');
if (!application.includes(`@supabase/supabase-js@${supabase}/+esm`)) {
  console.error('src/application.js: Supabase CDN version does not match package.json.'); failed = true;
}
const publicConfig = readFileSync('src/supabase-config.js', 'utf8');
if (!/TURNSTILE_SITE_KEY\s*=\s*['"]0x[A-Za-z0-9_-]+['"]/.test(publicConfig)) {
  console.error('src/supabase-config.js: a public Cloudflare Turnstile site key is required.'); failed = true;
}
if (!/PROTECTED_SUBMISSION_ENABLED\s*=\s*(?:true|false)\s*;/.test(publicConfig)) {
  console.error('src/supabase-config.js: protected submission staging flag must be an explicit boolean.'); failed = true;
}
if (/SUPABASE_(?:SERVICE_ROLE|SECRET)_KEY\s*=|TURNSTILE_SECRET_KEY\s*=|RATE_LIMIT_SECRET\s*=/.test(publicConfig)) {
  console.error('src/supabase-config.js: private server secrets must never be placed in browser configuration.'); failed = true;
}
const submissionFunction = readFileSync('supabase/functions/submit-application/index.ts', 'utf8');
for (const requiredBoundary of [
  'https://ssreeramsetty11.github.io',
  'ssreeramsetty11.github.io',
  'application_submit',
  'levelup_take_submission_slot',
  'resolution=ignore-duplicates,return=minimal'
]) {
  if (!submissionFunction.includes(requiredBoundary)) {
    console.error(`submit-application Edge Function: missing required boundary ${requiredBoundary}.`); failed = true;
  }
}
const functionConfig = readFileSync('supabase/config.toml', 'utf8');
if (!/\[functions\.submit-application\][\s\S]*?verify_jwt\s*=\s*false/.test(functionConfig)) {
  console.error('supabase/config.toml: the public submission function must use its own Turnstile verification.'); failed = true;
}
for (const [path, detectSession] of [['index.html', false], ['team.html', false], ['src/application.js', false], ['reset-password.html', true]]) {
  const source = readFileSync(path, 'utf8');
  const authSettings = new RegExp(`persistSession:\\s*false[\\s\\S]{0,120}autoRefreshToken:\\s*false[\\s\\S]{0,120}detectSessionInUrl:\\s*${detectSession}`);
  if (!authSettings.test(source)) {
    console.error(`${path}: Supabase client must use the expected non-persistent auth settings.`); failed = true;
  }
}
if (failed) process.exitCode = 1;
else console.log('Content security policies and tracked CDN versions match.');
