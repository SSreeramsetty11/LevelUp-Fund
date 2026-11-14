import fs from 'node:fs';
import assert from 'node:assert/strict';

const source = fs.readFileSync('src/application-api.js', 'utf8');
const { ApplicationSubmissionError, createApplicationApi, submissionErrorMessage } = await import(
  'data:text/javascript;base64,' + Buffer.from(source).toString('base64')
);

const application = {
  id: '42a08e0a-df1a-42f4-82ac-48f657ca5a9c',
  name: 'Sample Student',
  email: 'student@example.com',
  examProvider: 'Sample Provider',
  exam: 'Sample Certification',
  certificationUrl: 'https://example.com/certification',
  testDate: '2027-06-15',
  essay: 'A sample essay.',
  requestedAmount: 250,
  householdIncome: 30000,
  agreement: true,
  ageConfirmed: true,
  status: 'Accepted',
  notes: 'must not leave the browser',
  practiceScore: 100,
  submittedAt: 'must not leave the browser'
};

let captured;
const api = createApplicationApi({
  supabaseUrl: 'https://project.supabase.co/',
  publishableKey: 'public-key',
  fetchImpl: async (url, options) => {
    captured = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  }
});

await api.submitApplication(application, 'one-use-token', '');
assert.equal(captured.url, 'https://project.supabase.co/functions/v1/submit-application');
assert.equal(captured.options.method, 'POST');
assert.equal(captured.options.headers.apikey, 'public-key');
assert.equal(captured.options.headers.Authorization, undefined);
const body = JSON.parse(captured.options.body);
assert.deepEqual(body, {
  submissionKey: application.id,
  captchaToken: 'one-use-token',
  honeypot: '',
  name: application.name,
  email: application.email,
  examProvider: application.examProvider,
  exam: application.exam,
  certificationUrl: application.certificationUrl,
  testDate: application.testDate,
  essay: application.essay,
  requestedAmount: application.requestedAmount,
  householdIncome: application.householdIncome,
  agreement: true,
  ageConfirmed: true
});
assert.equal('status' in body, false);
assert.equal('notes' in body, false);
assert.equal('practiceScore' in body, false);
assert.equal('submittedAt' in body, false);

const limited = createApplicationApi({
  supabaseUrl: 'https://project.supabase.co', publishableKey: 'public-key',
  fetchImpl: async () => new Response(JSON.stringify({ error: 'rate_limited' }), {
    status: 429,
    headers: { 'Content-Type': 'application/json', 'Retry-After': '900' }
  })
});
await assert.rejects(limited.submitApplication(application, 'token'), (error) => {
  assert.ok(error instanceof ApplicationSubmissionError);
  assert.equal(error.code, 'rate_limited');
  assert.equal(error.status, 429);
  assert.equal(error.retryAfter, '900');
  assert.match(submissionErrorMessage(error), /Too many/i);
  return true;
});

const malformed = createApplicationApi({
  supabaseUrl: 'https://project.supabase.co', publishableKey: 'public-key',
  fetchImpl: async () => new Response('not json', { status: 200 })
});
await assert.rejects(malformed.submitApplication(application, 'token'), { code: 'invalid_response' });

const offline = createApplicationApi({
  supabaseUrl: 'https://project.supabase.co', publishableKey: 'public-key',
  fetchImpl: async () => { throw new TypeError('private network detail'); }
});
await assert.rejects(offline.submitApplication(application, 'token'), (error) => {
  assert.equal(error.code, 'network_error');
  assert.doesNotMatch(submissionErrorMessage(error), /private network detail/);
  return true;
});

const sharedAdminSource = fs.readFileSync('src/shared-admin.js', 'utf8');
const { createSharedAdmin } = await import(
  'data:text/javascript;base64,' + Buffer.from(sharedAdminSource).toString('base64')
);
let insertedRow;
let selectedColumns;
const adminAdapter = createSharedAdmin({
  from(table) {
    assert.equal(table, 'levelup_applications');
    return {
      insert(row) {
        insertedRow = row;
        return Promise.resolve({ data: null, error: null });
      },
      select(columns) {
        selectedColumns = columns;
        return {
          order: async () => ({
            data: [
              {
                id: 'one', created_at: '2027-01-01T00:00:00Z', name: 'New', email: 'new@example.com',
                exam_provider: 'Board', certification: 'Certification', certification_url: 'https://example.com',
                test_date: '2027-06-15', essay: 'Essay', amount: 250, household_income: 30000,
                age_confirmed: true, status: 'Pending', practice_score: null, notes: ''
              },
              {
                id: 'old', created_at: '2026-01-01T00:00:00Z', name: 'Old', email: 'old@example.com',
                exam_provider: 'Board', certification: 'Certification', certification_url: 'https://example.com',
                essay: 'Essay', amount: 250, household_income: 30000,
                age_confirmed: true, status: 'Pending', practice_score: null, notes: ''
              }
            ],
            error: null
          })
        };
      }
    };
  }
});
await adminAdapter.submitApplication(application);
assert.equal(insertedRow.test_date, '2027-06-15');
const savedApplications = await adminAdapter.listApplications();
assert.match(selectedColumns, /test_date/);
assert.equal(savedApplications[0].testDate, '2027-06-15');
assert.equal(savedApplications[1].testDate, undefined);

console.log('Protected application API checks passed: allowlisted payload, planned date mapping, public-key header, safe responses, rate-limit handling and network errors.');
