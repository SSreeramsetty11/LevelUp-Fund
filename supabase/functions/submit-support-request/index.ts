const ALLOWED_ORIGIN = "https://ssreeramsetty11.github.io";
const EXPECTED_TURNSTILE_HOSTNAME = "ssreeramsetty11.github.io";
const EXPECTED_TURNSTILE_ACTION = "support_submit";
const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const MAX_BODY_BYTES = 16 * 1024;
const FETCH_TIMEOUT_MS = 7_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+$/;
const CATEGORIES = new Set([
  "Application question",
  "Eligibility",
  "Technical problem",
  "Privacy or data request",
  "Other",
]);

function responseHeaders(origin = "") {
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
  const headers = responseHeaders(origin);
  for (const [name, value] of Object.entries(extraHeaders)) headers.set(name, value);
  return new Response(JSON.stringify({
    ok: status >= 200 && status < 300,
    ...(error ? { error } : {}),
    ...(message ? { message } : {}),
  }), { status, headers });
}

function validationError(message) {
  const error = new Error(message);
  error.name = "ValidationError";
  return error;
}

function trimmedString(value, label, minimum, maximum) {
  if (typeof value !== "string") throw validationError(`${label} is required.`);
  const result = value.trim();
  if (result.length < minimum) throw validationError(`${label} is required.`);
  if (result.length > maximum) throw validationError(`${label} is too long.`);
  return result;
}

export function validateSupportPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    throw validationError("The support request could not be read.");
  }
  const submissionKey = typeof payload.submissionKey === "string" ? payload.submissionKey.trim().toLowerCase() : "";
  if (!UUID_PATTERN.test(submissionKey)) throw validationError("Please reload the page and try again.");
  const captchaToken = typeof payload.captchaToken === "string" ? payload.captchaToken.trim() : "";
  if (!captchaToken || captchaToken.length > 2048) throw validationError("Please complete the security check.");

  const name = trimmedString(payload.name, "Name", 1, 120);
  const email = trimmedString(payload.email, "Email address", 3, 254).toLowerCase();
  const atIndex = email.lastIndexOf("@");
  if (
    !EMAIL_PATTERN.test(email) || atIndex < 1 || email.indexOf("@") !== atIndex ||
    email.slice(0, atIndex).length > 64 || email.slice(atIndex + 1).length > 253 ||
    email.startsWith(".") || email.slice(0, atIndex).endsWith(".")
  ) throw validationError("Enter a valid email address.");

  const category = trimmedString(payload.category, "Category", 1, 40);
  if (!CATEGORIES.has(category)) throw validationError("Select a valid support category.");
  const subject = trimmedString(payload.subject, "Subject", 1, 160);
  const message = trimmedString(payload.message, "Message", 10, 4000);
  if (payload.privacyAcknowledged !== true) {
    throw validationError("Accept the privacy and data policies before submitting.");
  }
  if (payload.contactEligibilityConfirmed !== true) {
    throw validationError("Confirm that you are at least 14 or a parent or guardian.");
  }

  return {
    submissionKey,
    captchaToken,
    normalizedEmail: email,
    row: {
      submission_key: submissionKey,
      name,
      email,
      category,
      subject,
      message,
      privacy_acknowledged: true,
      contact_eligibility_confirmed: true,
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
  } catch { return ""; }
}

export function getClientIp(headers) {
  const cloudflareIp = normalizeIp(headers.get("cf-connecting-ip"));
  if (cloudflareIp) return cloudflareIp;
  const realIp = normalizeIp(headers.get("x-real-ip"));
  if (realIp) return realIp;
  const forwarded = headers.get("x-forwarded-for");
  return !forwarded || forwarded.length > 512 ? "" : normalizeIp(forwarded.split(",", 1)[0]);
}

export async function hmacIdentifier(secret, value) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function secretKeyFromEnvironment(getEnv) {
  const secretKeys = getEnv("SUPABASE_SECRET_KEYS");
  if (secretKeys) {
    try {
      const parsed = JSON.parse(secretKeys);
      if (parsed && typeof parsed === "object" && typeof parsed.default === "string" && parsed.default) return parsed.default;
    } catch { /* Fall back to the legacy hosted variable. */ }
  }
  return getEnv("SUPABASE_SERVICE_ROLE_KEY") || "";
}

export function readConfiguration(getEnv) {
  const supabaseUrl = (getEnv("SUPABASE_URL") || "").replace(/\/$/, "");
  const serviceKey = secretKeyFromEnvironment(getEnv);
  const turnstileSecret = getEnv("TURNSTILE_SECRET_KEY") || "";
  const rateLimitSecret = getEnv("RATE_LIMIT_SECRET") || "";
  let validUrl = false;
  try {
    const parsed = new URL(supabaseUrl);
    validUrl = parsed.protocol === "https:" && parsed.pathname === "/";
  } catch { validUrl = false; }
  return validUrl && serviceKey && turnstileSecret && rateLimitSecret.length >= 32
    ? { supabaseUrl, serviceKey, turnstileSecret, rateLimitSecret }
    : null;
}

function serviceHeaders(serviceKey) {
  const headers = { apikey: serviceKey, "Content-Type": "application/json" };
  if (serviceKey.startsWith("eyJ")) headers.Authorization = `Bearer ${serviceKey}`;
  return headers;
}

async function fetchWithTimeout(fetchImpl, url, init, timeoutMs = FETCH_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetchImpl(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
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
  try { result = await response.json(); } catch { throw new Error("Turnstile response unreadable"); }
  return Boolean(result && result.success === true && result.hostname === EXPECTED_TURNSTILE_HOSTNAME && result.action === EXPECTED_TURNSTILE_ACTION);
}

export async function takeRateLimitSlot({ keyHash, kind, config, fetchImpl }) {
  const response = await fetchWithTimeout(fetchImpl, `${config.supabaseUrl}/rest/v1/rpc/levelup_take_submission_slot`, {
    method: "POST",
    headers: serviceHeaders(config.serviceKey),
    body: JSON.stringify({ p_key_hash: keyHash, p_kind: kind }),
  });
  if (!response.ok) throw new Error("Rate limiter unavailable");
  let allowed;
  try { allowed = await response.json(); } catch { throw new Error("Rate limiter response unreadable"); }
  if (typeof allowed !== "boolean") throw new Error("Rate limiter response invalid");
  return allowed;
}

export async function insertSupportRequest({ row, config, fetchImpl }) {
  const response = await fetchWithTimeout(fetchImpl, `${config.supabaseUrl}/rest/v1/levelup_support_requests?on_conflict=submission_key`, {
    method: "POST",
    headers: { ...serviceHeaders(config.serviceKey), Prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(row),
  });
  if (!response.ok) throw new Error("Support insert failed");
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
  } finally { reader.releaseLock(); }
}

function defaultEnvironmentReader(name) {
  return typeof Deno !== "undefined" ? (Deno.env.get(name) || "") : (globalThis.process?.env?.[name] || "");
}

export function createHandler(options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const getEnv = options.getEnv || defaultEnvironmentReader;
  const verifyCaptcha = options.verifyTurnstile || verifyTurnstile;
  const takeSlot = options.takeRateLimitSlot || takeRateLimitSlot;
  const insert = options.insertSupportRequest || insertSupportRequest;

  return async function handleRequest(request) {
    const origin = request.headers.get("origin") || "";
    if (origin !== ALLOWED_ORIGIN) return jsonResponse(403, "origin_not_allowed", "This request is not allowed.", origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders(origin) });
    if (request.method !== "POST") return jsonResponse(405, "method_not_allowed", "Only support requests are accepted.", origin, { Allow: "POST, OPTIONS" });
    const contentType = (request.headers.get("content-type") || "").toLowerCase();
    if (!/^application\/json(?:\s*;|$)/.test(contentType)) return jsonResponse(415, "content_type_required", "Send the request as JSON.", origin);
    const declaredLength = Number(request.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return jsonResponse(413, "payload_too_large", "The support request is too large.", origin);

    let payload;
    try {
      const bodyText = await readBodyWithLimit(request, MAX_BODY_BYTES);
      payload = JSON.parse(bodyText);
      if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new Error("Invalid object");
    } catch (error) {
      if (error?.name === "PayloadTooLargeError") return jsonResponse(413, "payload_too_large", "The support request is too large.", origin);
      return jsonResponse(400, "invalid_request", "The support request could not be read.", origin);
    }

    const config = readConfiguration(getEnv);
    const remoteIp = getClientIp(request.headers);
    if (!config || !remoteIp) return jsonResponse(503, "service_unavailable", "Support is temporarily unavailable.", origin);

    try {
      const ipHash = await hmacIdentifier(config.rateLimitSecret, `support-ip:${remoteIp}`);
      if (!await takeSlot({ keyHash: ipHash, kind: "support_ip", config, fetchImpl })) {
        return jsonResponse(429, "rate_limited", "Too many attempts. Please wait before trying again.", origin, { "Retry-After": "900" });
      }
    } catch { return jsonResponse(503, "service_unavailable", "Support is temporarily unavailable.", origin); }

    if (payload.honeypot !== undefined && payload.honeypot !== null && String(payload.honeypot).trim()) {
      return jsonResponse(200, "", "Support request received.", origin);
    }

    let validated;
    try { validated = validateSupportPayload(payload); }
    catch (error) {
      const message = error?.name === "ValidationError" ? error.message : "Check the request and try again.";
      return jsonResponse(400, /security check/i.test(message) ? "captcha_required" : "validation_failed", message, origin);
    }

    try {
      if (!await verifyCaptcha({ token: validated.captchaToken, remoteIp, submissionKey: validated.submissionKey, config, fetchImpl })) {
        return jsonResponse(400, "captcha_invalid", "Please complete the security check again.", origin);
      }
    } catch { return jsonResponse(503, "service_unavailable", "The security check is temporarily unavailable.", origin); }

    try {
      const emailHash = await hmacIdentifier(config.rateLimitSecret, `support-email:${validated.normalizedEmail}`);
      if (!await takeSlot({ keyHash: emailHash, kind: "support_email", config, fetchImpl })) {
        return jsonResponse(429, "rate_limited", "Too many requests were submitted for this email address.", origin, { "Retry-After": "86400" });
      }
    } catch { return jsonResponse(503, "service_unavailable", "Support is temporarily unavailable.", origin); }

    try { await insert({ row: validated.row, config, fetchImpl }); }
    catch { return jsonResponse(503, "service_unavailable", "The support request could not be saved.", origin); }
    return jsonResponse(200, "", "Support request received.", origin);
  };
}

if (typeof Deno !== "undefined" && import.meta.main) {
  Deno.serve(createHandler());
}
