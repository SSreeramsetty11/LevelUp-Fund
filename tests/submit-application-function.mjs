import assert from "node:assert/strict";
import fs from "node:fs";

const functionSource = fs.readFileSync("supabase/functions/submit-application/index.ts", "utf8");
const {
  createHandler,
  getClientIp,
  hmacIdentifier,
  insertApplication,
  readConfiguration,
  takeRateLimitSlot,
  validateApplicationPayload,
  verifyTurnstile,
} = await import("data:text/javascript;base64," + Buffer.from(functionSource).toString("base64"));

const ORIGIN = "https://ssreeramsetty11.github.io";
const ENDPOINT = "https://example.test/submit";
const SUBMISSION_KEY = "4d5969f4-a03f-4ee8-8c74-86f3f7352e60";
const secrets = {
  SUPABASE_URL: "https://project.supabase.co",
  SUPABASE_SECRET_KEYS: JSON.stringify({ default: "sb_secret_server_only" }),
  TURNSTILE_SECRET_KEY: "turnstile-secret-test-only",
  RATE_LIMIT_SECRET: "rate-limit-secret-at-least-32-bytes-long",
};

function payload(overrides = {}) {
  return {
    submissionKey: SUBMISSION_KEY,
    captchaToken: "valid-turnstile-token",
    honeypot: "",
    name: "Test Applicant",
    email: "Applicant@Example.com",
    examProvider: "Example Certification Board",
    exam: "Example Certification",
    certificationUrl: "https://certification.example/path",
    testDate: "2027-06-15",
    essay: "This is a test application essay.",
    requestedAmount: 250,
    householdIncome: 30_000,
    agreement: true,
    ageConfirmed: true,
    ...overrides,
  };
}

function request(body = payload(), overrides = {}) {
  const method = overrides.method || "POST";
  const headers = new Headers({
    Origin: ORIGIN,
    "Content-Type": "application/json",
    "X-Forwarded-For": "203.0.113.42",
    ...(overrides.headers || {}),
  });
  return new Request(ENDPOINT, {
    method,
    headers,
    body: method === "GET" || method === "HEAD" ? undefined : (typeof body === "string" ? body : JSON.stringify(body)),
  });
}

function dependencies(overrides = {}) {
  const calls = { rate: [], captcha: [], insert: [] };
  const options = {
    getEnv: (name) => secrets[name] || "",
    takeRateLimitSlot: async (input) => {
      calls.rate.push(input);
      return true;
    },
    verifyTurnstile: async (input) => {
      calls.captcha.push(input);
      return true;
    },
    insertApplication: async (input) => calls.insert.push(input),
    ...overrides,
  };
  return { calls, options };
}

async function bodyOf(response) {
  return JSON.parse(await response.text());
}

{
  const { calls, options } = dependencies();
  const handler = createHandler(options);
  const response = await handler(request(undefined, { method: "OPTIONS" }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get("access-control-allow-origin"), ORIGIN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(calls, { rate: [], captcha: [], insert: [] });
}

{
  const { calls, options } = dependencies();
  const handler = createHandler(options);
  const response = await handler(request(payload(), { headers: { Origin: `${ORIGIN}.evil.test` } }));
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("access-control-allow-origin"), null);
  assert.deepEqual(calls, { rate: [], captcha: [], insert: [] });
}

{
  const { options } = dependencies();
  const response = await createHandler(options)(request(undefined, { method: "GET" }));
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "POST, OPTIONS");
}

{
  const { options } = dependencies();
  const response = await createHandler(options)(request(payload(), { headers: { "Content-Type": "text/plain" } }));
  assert.equal(response.status, 415);
  const jsonp = await createHandler(options)(request(payload(), { headers: { "Content-Type": "application/jsonp" } }));
  assert.equal(jsonp.status, 415);
}

{
  const { options } = dependencies();
  const malformed = await createHandler(options)(request("not json"));
  assert.equal(malformed.status, 400);
  assert.equal((await bodyOf(malformed)).error, "invalid_request");
  const oversized = await createHandler(options)(request(`"${"x".repeat(32 * 1024)}"`));
  assert.equal(oversized.status, 413);
}

{
  const { options } = dependencies({ getEnv: () => "" });
  const response = await createHandler(options)(request());
  assert.equal(response.status, 503);
  assert.equal((await bodyOf(response)).error, "service_unavailable");
}

{
  const { options } = dependencies();
  const noIp = request();
  noIp.headers.delete("x-forwarded-for");
  const response = await createHandler(options)(noIp);
  assert.equal(response.status, 503);
}

{
  const { calls, options } = dependencies();
  const response = await createHandler(options)(request({ honeypot: "bot-filled-this" }));
  assert.equal(response.status, 200);
  assert.equal(calls.rate.length, 1);
  assert.equal(calls.rate[0].kind, "ip");
  assert.equal(calls.captcha.length, 0);
  assert.equal(calls.insert.length, 0);
}

{
  const { calls, options } = dependencies({ takeRateLimitSlot: async (input) => {
    calls.rate.push(input);
    return false;
  } });
  const response = await createHandler(options)(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "900");
  assert.equal(calls.captcha.length, 0);
  assert.equal(calls.insert.length, 0);
}

{
  const { calls, options } = dependencies();
  const response = await createHandler(options)(request(payload({ ageConfirmed: "true" })));
  assert.equal(response.status, 400);
  assert.equal((await bodyOf(response)).error, "validation_failed");
  assert.equal(calls.captcha.length, 0);
  assert.equal(calls.insert.length, 0);
}

{
  const { calls, options } = dependencies({ verifyTurnstile: async (input) => {
    calls.captcha.push(input);
    return false;
  } });
  const response = await createHandler(options)(request());
  assert.equal(response.status, 400);
  assert.equal((await bodyOf(response)).error, "captcha_invalid");
  assert.equal(calls.insert.length, 0);
}

{
  const { calls, options } = dependencies({ verifyTurnstile: async () => {
    throw new Error("secret detail that must not leak");
  } });
  const response = await createHandler(options)(request());
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /secret detail|turnstile-secret-test-only|Applicant@/i);
  assert.equal(calls.insert.length, 0);
}

{
  const calls = { rate: [], captcha: [], insert: [] };
  const { options } = dependencies({
    takeRateLimitSlot: async (input) => {
      calls.rate.push(input);
      return input.kind !== "email";
    },
    verifyTurnstile: async (input) => {
      calls.captcha.push(input);
      return true;
    },
    insertApplication: async (input) => calls.insert.push(input),
  });
  const response = await createHandler(options)(request());
  assert.equal(response.status, 429);
  assert.equal(response.headers.get("retry-after"), "86400");
  assert.deepEqual(calls.rate.map(({ kind }) => kind), ["ip", "email"]);
  assert.equal(calls.insert.length, 0);
}

{
  const { calls, options } = dependencies();
  const response = await createHandler(options)(request(payload({ status: "Approved", notes: "attacker value", practiceScore: 100 })));
  assert.equal(response.status, 200);
  assert.deepEqual(await bodyOf(response), { ok: true, message: "Application received." });
  assert.deepEqual(calls.rate.map(({ kind }) => kind), ["ip", "email"]);
  assert.equal(calls.captcha.length, 1);
  assert.equal(calls.insert.length, 1);
  assert.deepEqual(Object.keys(calls.insert[0].row).sort(), [
    "age_confirmed",
    "agreement",
    "amount",
    "certification",
    "certification_url",
    "email",
    "essay",
    "exam_provider",
    "household_income",
    "name",
    "submission_key",
    "test_date",
  ]);
  assert.equal(calls.insert[0].row.email, "applicant@example.com");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
}

{
  assert.throws(() => validateApplicationPayload(payload({ certificationUrl: "javascript:alert(1)" })), /HTTP or HTTPS/);
  assert.throws(() => validateApplicationPayload(payload({ certificationUrl: "https://user:pass@example.com" })), /without credentials/);
  assert.throws(() => validateApplicationPayload(payload({ certificationUrl: "https://localhost/path" })), /without credentials/);
  assert.throws(() => validateApplicationPayload(payload({ certificationUrl: "https://127.0.0.1/path" })), /without credentials/);
  assert.throws(() => validateApplicationPayload(payload({ certificationUrl: "https://[::1]/path" })), /without credentials/);
  assert.throws(() => validateApplicationPayload(payload({ certificationUrl: "https://example.com.:443" })), /without credentials/);
  assert.throws(() => validateApplicationPayload(payload({ testDate: "" })), /planned test date/i);
  assert.throws(() => validateApplicationPayload(payload({ testDate: "2027-02-29" })), /valid planned test date/i);
  assert.equal(validateApplicationPayload(payload({ testDate: "2028-02-29" })).row.test_date, "2028-02-29");
  assert.throws(() => validateApplicationPayload(payload({ requestedAmount: "250" })), /valid amount/);
  assert.throws(() => validateApplicationPayload(payload({ requestedAmount: 1.001 })), /decimal places/);
  assert.throws(() => validateApplicationPayload(payload({ householdIncome: -1 })), /allowed range/);
  assert.throws(() => validateApplicationPayload(payload({ essay: Array(500).fill("word").join(" ") })), /fewer than 500/);
  assert.equal(validateApplicationPayload(payload({ essay: Array(499).fill("word").join(" ") })).row.essay.split(" ").length, 499);
}

{
  assert.equal(getClientIp(new Headers({ "x-forwarded-for": "203.0.113.004, 10.0.0.1" })), "203.0.113.4");
  assert.equal(getClientIp(new Headers({ "x-forwarded-for": "2001:0db8::1" })), "2001:db8::1");
  assert.equal(getClientIp(new Headers({ "x-forwarded-for": "not-an-ip" })), "");
  const first = await hmacIdentifier(secrets.RATE_LIMIT_SECRET, "email:applicant@example.com");
  const second = await hmacIdentifier(secrets.RATE_LIMIT_SECRET, "email:applicant@example.com");
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(first, second);
  assert.doesNotMatch(first, /applicant|example/);
}

{
  const config = readConfiguration((name) => secrets[name] || "");
  assert.equal(config.serviceKey, "sb_secret_server_only");
  const legacyConfig = readConfiguration((name) => {
    if (name === "SUPABASE_SECRET_KEYS") return "not-json";
    if (name === "SUPABASE_SERVICE_ROLE_KEY") return "eyJlegacy-test-only";
    return secrets[name] || "";
  });
  assert.equal(legacyConfig.serviceKey, "eyJlegacy-test-only");
  assert.equal(readConfiguration((name) => name === "RATE_LIMIT_SECRET" ? "short" : (secrets[name] || "")), null);

  let captured;
  const allowed = await takeRateLimitSlot({
    keyHash: "a".repeat(64),
    kind: "ip",
    config,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response("true", { status: 200, headers: { "Content-Type": "application/json" } });
    },
  });
  assert.equal(allowed, true);
  assert.match(captured.url, /\/rest\/v1\/rpc\/levelup_take_submission_slot$/);
  assert.equal(captured.init.headers.apikey, "sb_secret_server_only");
  assert.equal(captured.init.headers.Authorization, undefined);

  await insertApplication({
    row: { submission_key: SUBMISSION_KEY },
    config,
    fetchImpl: async (url, init) => {
      captured = { url, init };
      return new Response(null, { status: 201 });
    },
  });
  assert.match(captured.url, /on_conflict=submission_key$/);
  assert.equal(captured.init.headers.Prefer, "resolution=ignore-duplicates,return=minimal");
}

{
  const config = readConfiguration((name) => secrets[name] || "");
  const results = [
    { success: true, hostname: "ssreeramsetty11.github.io", action: "application_submit" },
    { success: true, hostname: "ssreeramsetty11.github.io.evil.test", action: "application_submit" },
    { success: true, hostname: "ssreeramsetty11.github.io", action: "login" },
  ];
  const verdicts = [];
  for (const result of results) {
    let requestBody;
    verdicts.push(await verifyTurnstile({
      token: "sample-token",
      remoteIp: "203.0.113.42",
      submissionKey: SUBMISSION_KEY,
      config,
      fetchImpl: async (_url, init) => {
        requestBody = init.body;
        return Response.json(result);
      },
    }));
    assert.equal(requestBody.get("secret"), secrets.TURNSTILE_SECRET_KEY);
    assert.equal(requestBody.get("response"), "sample-token");
    assert.equal(requestBody.get("idempotency_key"), SUBMISSION_KEY);
  }
  assert.deepEqual(verdicts, [true, false, false]);
}

console.log("Protected submission Edge Function tests passed.");
