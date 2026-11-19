const ALLOWED_ORIGIN = "https://ssreeramsetty11.github.io";
const EXPECTED_TURNSTILE_HOSTNAME = "ssreeramsetty11.github.io";
const EXPECTED_TURNSTILE_ACTION = "application_submit";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_BODY_BYTES = 32 * 1024;
const FETCH_TIMEOUT_MS = 7_000;
const RATE_LIMIT_RETRY_SECONDS = 15 * 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;

function safeHeaders(origin = "") {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
    "Referrer-Policy": "no-referrer",
    "Vary": "Origin",
    "X-Content-Type-Options": "nosniff",
  });
  if (origin === ALLOWED_ORIGIN) {
    headers.set("Access-Control-Allow-Origin", ALLOWED_ORIGIN);
    headers.set("Access-Control-Allow-Headers", "apikey, content-type");
    headers.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    headers.set("Access-Control-Max-Age", "300");
  }
  return headers;
}

function jsonResponse(status, error, message, origin, extraHeaders = {}) {
  const headers = safeHeaders(origin);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(JSON.stringify({ ok: status >= 200 && status < 300, ...(error ? { error } : {}), ...(message ? { message } : {}) }), {
    status,
    headers,
  });
}

function validationError(message) {
  const error = new Error(message);
  error.name = "ValidationError";
  return error;
}

function trimmedString(value, label, maxLength) {
  if (typeof value !== "string") throw validationError(`${label} is required.`);
  const result = value.trim();
  if (!result) throw validationError(`${label} is required.`);
  if (result.length > maxLength) throw validationError(`${label} is too long.`);
  return result;
}

function validMoney(value, label, allowZero) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw validationError(`${label} must be a valid amount.`);
  }
  if ((allowZero ? value < 0 : value <= 0) || value > 9_999_999_999.99) {
    throw validationError(`${label} is outside the allowed range.`);
  }
  const cents = value * 100;
  if (Math.abs(cents - Math.round(cents)) > 0.000001) {
    throw validationError(`${label} can have no more than two decimal places.`);
  }
  return Math.round(cents) / 100;
}

function validTestDate(value) {
  const raw = trimmedString(value, "Planned test date", 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw);
  if (!match) throw validationError("Select a valid planned test date.");
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    throw validationError("Select a valid planned test date.");
  }
  return raw;
}

function validCertificationUrl(value) {
  const raw = trimmedString(value, "Certification website URL", 2048);
  if (/\s/.test(raw)) throw validationError("Enter a valid HTTP or HTTPS certification website URL.");
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw validationError("Enter a valid HTTP or HTTPS certification website URL.");
  }
  const hostname = parsed.hostname.toLowerCase();
  const publicDomainPattern = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    !publicDomainPattern.test(hostname) ||
    parsed.port === "0"
  ) {
    throw validationError("Enter a valid HTTP or HTTPS certification website URL without credentials.");
  }
  return parsed.href;
}

/**
 * Validate only applicant-controlled fields and return the explicit database
 * allowlist. Review state and timestamps never come from the browser.
 */
export function validateApplicationPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("The application could not be read.");
  }

  const submissionKey = typeof payload.submissionKey === "string" ? payload.submissionKey.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(submissionKey)) throw validationError("Please reload the page and try again.");

  const captchaToken = typeof payload.captchaToken === "string" ? payload.captchaToken.trim() : "";
  if (!captchaToken) throw validationError("Please complete the security check.");
  if (captchaToken.length > 2048) throw validationError("Please complete the security check again.");

  const name = trimmedString(payload.name, "Full legal name", 120);
  const email = trimmedString(payload.email, "Email address", 254).toLowerCase();
  const atIndex = email.lastIndexOf("@");
  if (
    !EMAIL_PATTERN.test(email) ||
    atIndex < 1 ||
    email.indexOf("@") !== atIndex ||
    email.slice(0, atIndex).length > 64 ||
    email.slice(atIndex + 1).length > 253 ||
    email.startsWith(".") ||
    email.slice(0, atIndex).endsWith(".")
  ) {
    throw validationError("Enter a valid email address.");
  }

  const examProvider = trimmedString(payload.examProvider, "Certification administrator", 100);
  const exam = trimmedString(payload.exam, "Certification name", 160);
  const certificationUrl = validCertificationUrl(payload.certificationUrl);
  const testDate = validTestDate(payload.testDate);
  const essay = trimmedString(payload.essay, "Essay", 10_000);
  if (essay.split(/\s+/u).length >= 500) throw validationError("The essay must contain fewer than 500 words.");

  const requestedAmount = validMoney(payload.requestedAmount, "Requested amount", false);
  const householdIncome = validMoney(payload.householdIncome, "Annual household income", true);
  if (payload.agreement !== true) throw validationError("You must accept the Conditional Grant Agreement.");
  if (payload.ageConfirmed !== true) throw validationError("Applicants must confirm that they are at least 14 years old.");

  return {
    submissionKey,
    captchaToken,
    normalizedEmail: email,
    row: {
      submission_key: submissionKey,
      name,
      email,
      exam_provider: examProvider,
      certification: exam,
      certification_url: certificationUrl,
      test_date: testDate,
      essay,
      amount: requestedAmount,
      household_income: householdIncome,
      agreement: true,
      age_confirmed: true,
    },
  };
}

function normalizeIp(candidate) {
  if (typeof candidate !== "string") return "";
  let value = candidate.trim();
  if (!value || value.length > 64 || value.includes("%")) return "";
  if (value.startsWith("[") && value.endsWith("]")) value = value.slice(1, -1);

  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split(".").map(Number);
    if (parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return "";
    return parts.join(".");
  }

  if (!value.includes(":") || !/^[0-9a-f:.]+$/i.test(value)) return "";
  try {
    const hostname = new URL(`http://[${value}]/`).hostname;
    return hostname.slice(1, -1).toLowerCase();
  } catch {
    return "";
  }
}

export function getClientIp(headers) {
  const cloudflareIp = normalizeIp(headers.get("cf-connecting-ip"));
  if (cloudflareIp) return cloudflareIp;
  const realIp = normalizeIp(headers.get("x-real-ip"));
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for");
  if (!forwarded || forwarded.length > 512) return "";
  return normalizeIp(forwarded.split(",", 1)[0]);
}

export async function hmacIdentifier(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secretKeyFromEnvironment(getEnv) {
  const secretKeys = getEnv("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed && typeof parsed === "object") {
        if (typeof parsed.default === "string" && parsed.default) return parsed.default;
      }
    } catch { /* Fall back to the legacy hosted service-role variable. */ }
  }
  return getEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
}

export function readConfiguration(getEnv) {
  const supabaseUrl = (getEnv("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = secretKeyFromEnvironment(getEnv);
  const turnstileSecret = getEnv("TURNSTILE_SECRET_KEY") || "";
  const rateLimitSecret = getEnv("RATE_LIMIT_SECRET") || "";
  let validSupabaseUrl = false;
  try {
    const parsed = new URL(supabaseUrl);
    validSupabaseUrl = parsed.protocol === "https:" && parsed.pathname === "/";
  } catch {
    validSupabaseUrl = false;
  }
  if (!validSupabaseUrl || !serviceKey || !turnstileSecret || rateLimitSecret.length < 32) return null;
  return { supabaseUrl, serviceKey, turnstileSecret, rateLimitSecret };
}

function serviceHeaders(serviceKey) {
  const headers = {
    apikey: serviceKey,
    "Content-Type": "application/json",
  };
  // Legacy service-role keys are JWTs. New sb_secret_ keys must not be sent as
  // Bearer tokens; their `apikey` header is sufficient for the data API.
  if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;
  return headers;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

export async function verifyTurnstile({ token, remoteIp, submissionKey, config, fetchImpl }) {
  const form = new URLSearchParams({
    secret: config.turnstileSecret,
    response: token,
    remoteip: remoteIp,
    idempotency_key: submissionKey,
  });
  const response = await fetchWithTimeout(fetchImpl, TURNSTILE_VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form,
  });
  if (!response.ok) throw new Error("Turnstile unavailable");
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("Turnstile response unreadable");
  }
  return Boolean(
    result &&
    result.success === true &&
    result.hostname === EXPECTED_TURNSTILE_HOSTNAME &&
    result.action === EXPECTED_TURNSTILE_ACTION
  );
}

export async function takeRateLimitSlot({ keyHash, kind, config, fetchImpl }) {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${config.supabaseUrl}/rest/v1/rpc/levelup_take_submission_slot`,
    {
      method: "POST",
      headers: serviceHeaders(config.serviceKey),
      body: JSON.stringify({ p_key_hash: keyHash, p_kind: kind }),
    },
  );
  if (!response.ok) throw new Error("Rate limiter unavailable");
  let allowed;
  try {
    allowed = await response.json();
  } catch {
    throw new Error("Rate limiter response unreadable");
  }
  if (typeof allowed !== "boolean") throw new Error("Rate limiter response invalid");
  return allowed;
}

export async function insertApplication({ row, config, fetchImpl }) {
  const response = await fetchWithTimeout(
    fetchImpl,
    `${config.supabaseUrl}/rest/v1/levelup_applications?on_conflict=submission_key`,
    {
      method: "POST",
      headers: {
        ...serviceHeaders(config.serviceKey),
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    },
  );
  if (!response.ok) throw new Error("Application insert failed");
}

async function readBodyWithLimit(request, maximumBytes) {
  if (!request.body) return "";
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytesRead += value.byteLength;
      if (bytesRead > maximumBytes) {
        await reader.cancel();
        const error = new Error("Payload too large");
        error.name = "PayloadTooLargeError";
        throw error;
      }
      text += decoder.decode(value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

function defaultEnvironmentReader(name) {
  return typeof Deno !== "undefined" ? (Deno.env.get(name) || "") : (globalThis.process?.env?.[name] || "");
}

/** Create an independently testable Edge Function handler. */
export function createHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const getEnv = options.getEnv || defaultEnvironmentReader;
  const verifyCaptcha = options.verifyTurnstile || verifyTurnstile;
  const takeSlot = options.takeRateLimitSlot || takeRateLimitSlot;
  const insert = options.insertApplication || insertApplication;

  return async function handleRequest(request) {
    const origin = request.headers.get("origin") || "";
    if (origin !== ALLOWED_ORIGIN) {
      return jsonResponse(403, "origin_not_allowed", "This request is not allowed.", origin);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: safeHeaders(origin) });
    }
    if (request.method !== "POST") {
      return jsonResponse(405, "method_not_allowed", "Only application submissions are accepted.", origin, { Allow: "POST, OPTIONS" });
    }

    const contentType = (request.headers.get("content-type") || "").toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) {
      return jsonResponse(415, "content_type_required", "Send the application as JSON.", origin);
    }
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return jsonResponse(413, "payload_too_large", "The application is too large to submit.", origin);
    }

    let payload;
    try {
      const bodyText = await readBodyWithLimit(request, MAX_BODY_BYTES);
      payload = JSON.parse(bodyText);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid object");
    } catch (error) {
      if (error?.name === "PayloadTooLargeError") {
        return jsonResponse(413, "payload_too_large", "The application is too large to submit.", origin);
      }
      return jsonResponse(400, "invalid_request", "The application could not be read.", origin);
    }

    const config = readConfiguration(getEnv);
    if (!config) {
      return jsonResponse(503, "service_unavailable", "Applications are temporarily unavailable. Please try again later.", origin);
    }
    const remoteIp = getClientIp(request.headers);
    if (!remoteIp) {
      return jsonResponse(503, "service_unavailable", "Applications are temporarily unavailable. Please try again later.", origin);
    }

    let ipAllowed;
    try {
      const ipHash = await hmacIdentifier(config.rateLimitSecret, `ip:${remoteIp}`);
      ipAllowed = await takeSlot({ keyHash: ipHash, kind: "ip", config, fetchImpl });
    } catch {
      return jsonResponse(503, "service_unavailable", "Applications are temporarily unavailable. Please try again later.", origin);
    }
    if (!ipAllowed) {
      return jsonResponse(429, "rate_limited", "Too many attempts. Please wait before trying again.", origin, {
        "Retry-After": String(RATE_LIMIT_RETRY_SECONDS),
      });
    }

    // A hidden field that people never see. Bots that fill it receive the same
    // minimal success response, but no CAPTCHA call or database write occurs.
    if (payload.honeypot !== undefined && payload.honeypot !== null && String(payload.honeypot).trim()) {
      return jsonResponse(200, "", "Application received.", origin);
    }

    let validated;
    try {
      validated = validateApplicationPayload(payload);
    } catch (error) {
      const message = error?.name === "ValidationError" ? error.message : "Check the application and try again.";
      const code = /security check/i.test(message) ? "captcha_required" : "validation_failed";
      return jsonResponse(400, code, message, origin);
    }

    let captchaValid;
    try {
      captchaValid = await verifyCaptcha({
        token: validated.captchaToken,
        remoteIp,
        submissionKey: validated.submissionKey,
        config,
        fetchImpl,
      });
    } catch {
      return jsonResponse(503, "service_unavailable", "The security check is temporarily unavailable. Please try again.", origin);
    }
    if (!captchaValid) {
      return jsonResponse(400, "captcha_invalid", "Please complete the security check again.", origin);
    }

    let emailAllowed;
    try {
      const emailHash = await hmacIdentifier(config.rateLimitSecret, `email:${validated.normalizedEmail}`);
      emailAllowed = await takeSlot({ keyHash: emailHash, kind: "email", config, fetchImpl });
    } catch {
      return jsonResponse(503, "service_unavailable", "Applications are temporarily unavailable. Please try again later.", origin);
    }
    if (!emailAllowed) {
      return jsonResponse(429, "rate_limited", "Too many applications were submitted for this email address. Please try again later.", origin, {
        "Retry-After": "86400",
      });
    }

    try {
      await insert({ row: validated.row, config, fetchImpl });
    } catch {
      return jsonResponse(503, "service_unavailable", "The application could not be saved. Please try again later.", origin);
    }
    return jsonResponse(200, "", "Application received.", origin);
  };
}

if (typeof Deno !== "undefined" && import.meta.main) {
  Deno.serve(createHandler());
}
