export class SupportSubmissionError extends Error {
  constructor(code, status = 0) {
    super(code);
    this.name = "SupportSubmissionError";
    this.code = code;
    this.status = status;
  }
}

export function createSupportApi({ supabaseUrl, publishableKey, fetchImpl = fetch, timeoutMs = 15000 }) {
  const endpoint = `${supabaseUrl.replace(/\/$/, "")}/functions/v1/submit-support-request`;

  async function submitSupportRequest(request, captchaToken, honeypot = "") {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;
    try {
      response = await fetchImpl(endpoint, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          apikey: publishableKey
        },
        body: JSON.stringify({
          submissionKey: request.id,
          captchaToken,
          honeypot,
          name: request.name,
          email: request.email,
          category: request.category,
          subject: request.subject,
          message: request.message,
          privacyAcknowledged: request.privacyAcknowledged === true,
          contactEligibilityConfirmed: request.contactEligibilityConfirmed === true
        }),
        signal: controller.signal
      });
    } catch (error) {
      throw new SupportSubmissionError(error && error.name === "AbortError" ? "timeout" : "network_error");
    } finally {
      clearTimeout(timer);
    }

    let payload;
    try { payload = await response.json(); } catch { payload = null; }
    if (!response.ok) {
      throw new SupportSubmissionError(payload && typeof payload.error === "string" ? payload.error : "request_failed", response.status);
    }
    if (!payload || payload.ok !== true) throw new SupportSubmissionError("invalid_response", response.status);
    return payload;
  }

  return { submitSupportRequest };
}

export function supportErrorMessage(error) {
  if (error instanceof SupportSubmissionError) {
    if (error.status === 400) return "Review the form, complete a new security check, and try again.";
    if (error.status === 413) return "Your message is too large. Shorten it and try again.";
    if (error.status === 429) return "Too many support requests were submitted. Please wait before trying again.";
    if (error.status === 503) return "Support is temporarily unavailable. Please try again later.";
    if (error.code === "timeout") return "The request timed out. Check your connection and try again.";
    if (error.code === "network_error") return "The support service could not be reached. Check your connection and try again.";
  }
  return "Your support request could not be submitted. Please try again later.";
}
