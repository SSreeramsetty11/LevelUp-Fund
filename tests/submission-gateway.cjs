const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const assert = require('node:assert/strict');

const migrations = [
  '202611100001_shared_admin.sql',
  '202611110001_age_confirmation.sql',
  '202611130001_household_income.sql',
  '202611130003_security_hardening.sql',
  '202611130002_require_household_income.sql',
  '202611130004_submission_gateway.sql'
];

function readMigration(name) {
  return fs.readFileSync(`supabase/migrations/${name}`, 'utf8');
}

async function expectDenied(db, sql, pattern = /permission denied|row-level security/i) {
  let error;
  try {
    await db.exec(sql);
  } catch (caught) {
    error = caught;
  } finally {
    await db.exec('reset role;');
  }
  assert.ok(error, 'expected the statement to be denied');
  assert.match(error.message, pattern);
}

(async () => {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable
      as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated, service_role;
  `);

  for (const migration of migrations) {
    await db.exec(readMigration(migration));
  }

  // The setup migration is safe to reapply.
  await db.exec(readMigration('202611130004_submission_gateway.sql'));

  const ipHash = 'a'.repeat(64);
  const emailHash = 'b'.repeat(64);

  await expectDenied(
    db,
    `set role anon; select * from private.levelup_submission_rate_limits;`,
    /permission denied/i
  );
  await expectDenied(
    db,
    `set role authenticated; select public.levelup_take_submission_slot('${ipHash}', 'ip');`,
    /permission denied/i
  );
  await expectDenied(
    db,
    `set role service_role; select * from private.levelup_submission_rate_limits;`,
    /permission denied/i
  );

  await db.exec('set role service_role;');
  for (let attempt = 1; attempt <= 12; attempt += 1) {
    const result = await db.query(
      `select public.levelup_take_submission_slot('${ipHash}', 'ip') as allowed`
    );
    assert.equal(result.rows[0].allowed, true, `IP attempt ${attempt} should pass`);
  }
  let result = await db.query(
    `select public.levelup_take_submission_slot('${ipHash}', 'ip') as allowed`
  );
  assert.equal(result.rows[0].allowed, false, 'thirteenth IP attempt should be denied');

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    result = await db.query(
      `select public.levelup_take_submission_slot('${emailHash}', 'email') as allowed`
    );
    assert.equal(result.rows[0].allowed, true, `email attempt ${attempt} should pass`);
  }
  result = await db.query(
    `select public.levelup_take_submission_slot('${emailHash}', 'email') as allowed`
  );
  assert.equal(result.rows[0].allowed, false, 'fourth email attempt should be denied');
  await db.exec('reset role;');

  await expectDenied(
    db,
    `set role service_role; select public.levelup_take_submission_slot('raw@example.com', 'email');`,
    /Invalid rate-limit key/i
  );
  await expectDenied(
    db,
    `set role service_role; select public.levelup_take_submission_slot('${ipHash}', 'custom');`,
    /Invalid rate-limit kind/i
  );

  const baseValues = `
    '11111111-1111-4111-8111-111111111111', 'Sample', 'sample@example.com',
    'Board', 'Certification', 'https://example.com/certification',
    '2027-06-15', 'A short sample essay.', 500, true, true, 50000
  `;
  const insertColumns = `submission_key, name, email, exam_provider,
    certification, certification_url, test_date, essay, amount, agreement,
    age_confirmed, household_income`;

  // The Edge service role can insert the allowlisted record, and the unique
  // submission key prevents a retry from creating a second application.
  await db.exec(`set role service_role;
    insert into public.levelup_applications (${insertColumns}) values (${baseValues});
    reset role;`);
  await expectDenied(
    db,
    `set role service_role;
      insert into public.levelup_applications (${insertColumns}, status)
      values (${baseValues}, 'Approved');`,
    /permission denied/i
  );
  await expectDenied(
    db,
    `set role service_role;
      insert into public.levelup_applications (${insertColumns}) values (${baseValues});`,
    /unique|duplicate/i
  );

  // Stage 1 intentionally preserves the old public path during deployment.
  await db.exec(`set role anon;
    insert into public.levelup_applications (
      name, email, exam_provider, certification, certification_url, essay,
      amount, agreement, age_confirmed, household_income
    ) values (
      'Transition test', 'transition@example.com', 'Board', 'Certification',
      'https://example.com/certification', 'A short sample essay.',
      500, true, true, 50000
    );
    reset role;`);

  await db.exec(readMigration('202611130005_lock_direct_submissions.sql'));
  await db.exec(readMigration('202611130005_lock_direct_submissions.sql'));

  // After cutover, neither an anonymous nor a signed-in non-admin caller can
  // write directly, while the Edge service role still can.
  await expectDenied(
    db,
    `set role anon;
      insert into public.levelup_applications (
        name, email, exam_provider, certification, certification_url, essay,
        amount, agreement, age_confirmed, household_income
      ) values (
        'Blocked', 'blocked@example.com', 'Board', 'Certification',
        'https://example.com/certification', 'A short essay.',
        500, true, true, 50000
      );`,
    /permission denied/i
  );
  await expectDenied(
    db,
    `set role authenticated;
      insert into public.levelup_applications (
        name, email, exam_provider, certification, certification_url, essay,
        amount, agreement, age_confirmed, household_income
      ) values (
        'Blocked', 'blocked2@example.com', 'Board', 'Certification',
        'https://example.com/certification', 'A short essay.',
        500, true, true, 50000
      );`,
    /permission denied/i
  );

  await db.exec(`set role service_role;
    insert into public.levelup_applications (${insertColumns}) values (
      '22222222-2222-4222-8222-222222222222', 'Second sample',
      'sample2@example.com', 'Board', 'Certification',
      'https://example.com/certification', '2027-08-20', 'A short sample essay.',
      500, true, true, 50000
    );
    reset role;`);

  await expectDenied(
    db,
    `set role service_role;
      insert into public.levelup_applications (
        submission_key, name, email, exam_provider, certification,
        certification_url, essay, amount, agreement, age_confirmed, household_income
      ) values (
        '33333333-3333-4333-8333-333333333333', 'Missing date',
        'missing-date@example.com', 'Board', 'Certification',
        'https://example.com/certification', 'A short sample essay.',
        500, true, true, 50000
      );`,
    /planned test date/i
  );

  const rows = await db.query('select count(*)::integer as count from public.levelup_applications');
  assert.equal(rows.rows[0].count, 3);

  console.log('Submission gateway passed: private atomic limits, idempotency, staged public lock, and service-role inserts.');
  await db.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
