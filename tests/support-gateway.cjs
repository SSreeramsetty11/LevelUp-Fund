const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const migrations = [
  '202611100001_shared_admin.sql', '202611110001_age_confirmation.sql',
  '202611130001_household_income.sql', '202611130003_security_hardening.sql',
  '202611130002_require_household_income.sql', '202611130004_submission_gateway.sql',
  '202611130005_lock_direct_submissions.sql', '202611200001_support_requests.sql'
];
const read = (name) => fs.readFileSync('supabase/migrations/' + name, 'utf8');
async function denied(db, sql, pattern = /permission denied|row-level security/i) {
  let error;
  try { await db.exec(sql); } catch (caught) { error = caught; }
  finally { await db.exec('reset role;'); }
  assert.ok(error, 'expected denial');
  assert.match(error.message, pattern);
}
(async () => {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    grant usage on schema auth to anon,authenticated; grant execute on function auth.uid() to anon,authenticated;
    grant usage on schema public to anon,authenticated,service_role;`);
  for (const migration of migrations) await db.exec(read(migration));
  await db.exec(read('202611200001_support_requests.sql'));
  const admin = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  const other = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  await db.exec(`insert into auth.users(id) values ('${admin}'),('${other}'); insert into public.levelup_admins(user_id) values ('${admin}');`);
  const columns = 'submission_key,name,email,category,subject,message,privacy_acknowledged,contact_eligibility_confirmed';
  const values = "'11111111-1111-4111-8111-111111111111','Sample','sample@example.com','Application question','Help','This is a sample support message.',true,true";
  await denied(db, `set role anon; insert into public.levelup_support_requests(${columns}) values (${values});`);
  await denied(db, `set role anon; select * from public.levelup_support_requests;`);
  await db.exec(`set role service_role; insert into public.levelup_support_requests(${columns}) values (${values}); reset role;`);
  await denied(db, `set role service_role; insert into public.levelup_support_requests(${columns},status) values ('22222222-2222-4222-8222-222222222222','Bad','bad@example.com','Other','Bad','This message should be blocked.',true,true,'Resolved');`);
  await denied(db, `set role service_role; insert into public.levelup_support_requests(${columns}) values ('33333333-3333-4333-8333-333333333333','Bad','invalid','Other','Bad','This message has an invalid email.',true,true);`, /email/i);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${other}',false);`);
  let rows = await db.query('select id from public.levelup_support_requests'); assert.equal(rows.rows.length, 0);
  rows = await db.query("update public.levelup_support_requests set status='Resolved' returning id"); assert.equal(rows.rows.length, 0); await db.exec('reset role;');
  await denied(db, `set role authenticated; select set_config('request.jwt.claim.sub','${admin}',false); update public.levelup_support_requests set message='changed';`, /permission denied/i);
  await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub','${admin}',false); update public.levelup_support_requests set status='Resolved',admin_notes='done'; reset role;`);
  rows = await db.query('select status,resolved_at from public.levelup_support_requests'); assert.equal(rows.rows[0].status, 'Resolved'); assert.ok(rows.rows[0].resolved_at);
  const ipHash = 'c'.repeat(64), emailHash = 'd'.repeat(64);
  await db.exec('set role service_role;');
  for (let n = 1; n <= 8; n++) assert.equal((await db.query(`select public.levelup_take_submission_slot('${ipHash}','support_ip') allowed`)).rows[0].allowed, true);
  assert.equal((await db.query(`select public.levelup_take_submission_slot('${ipHash}','support_ip') allowed`)).rows[0].allowed, false);
  for (let n = 1; n <= 5; n++) assert.equal((await db.query(`select public.levelup_take_submission_slot('${emailHash}','support_email') allowed`)).rows[0].allowed, true);
  assert.equal((await db.query(`select public.levelup_take_submission_slot('${emailHash}','support_email') allowed`)).rows[0].allowed, false);
  await db.exec('reset role;');
  console.log('Support gateway passed: locked public access, admin-only workflow fields, validation, idempotency and hashed rate limits.');
  await db.close();
})().catch((error) => { console.error(error); process.exit(1); });
