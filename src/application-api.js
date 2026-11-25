export class ApplicationSubmissionError extends Error {
  constructor(code, status = 0, retryAfter = '') {
    super(code);
    this.name = 'ApplicationSubmissionError';
    this.code = code;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

function requestBody(application, captchaToken, honeypot) {
  return {
    submissionKey: application.id,
    captchaToken,
    honeypot,
    name: application.name,
    email: application.email,
    examProvider: application.examProvider,
    exam: application.exam,
    certificationUrl: application.certificationUrl,
    testDate: application.testDate,
    essay: application.essay,
    requestedAmount: application.requestedAmount,
    householdIncome: application.householdIncome,
    agreement: application.agreement === true,
    ageConfirmed: application.ageConfirmed === true
  };
}

export function createApplicationApi({ supabaseUrl, publishableKey, fetchImpl = fetch, timeoutMs = 15000 }) {
  const endpoint = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/submit-application`;

  async function submitApplication(application, captchaToken, honeypot = '') {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    let response;

    try {
      response = await fetchImpl(endpoint, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          apikey: publishableKey
        },
        body: JSON.stringify(requestBody(application, captchaToken, honeypot)),
        signal: controller.signal
      });
    } catch (error) {
      const code = error && error.name === 'AbortError' ? 'timeout' : 'network_error';
      throw new ApplicationSubmissionError(code);
    } finally {
      clearTimeout(timer);
    }

    let payload = null;
    try { payload = await response.json(); }
    catch (error) { payload = null; }

    if (!response.ok) {
      const safeCode = payload && typeof payload.error === 'string' ? payload.error : 'request_failed';
      throw new ApplicationSubmissionError(safeCode, response.status, response.headers.get('Retry-After') || '');
    }
    if (!payload || payload.ok !== true) {
      throw new ApplicationSubmissionError('invalid_response', response.status);
    }

    return payload;
  }

  return { submitApplication };
}

export function submissionErrorMessage(error) {
  if (error instanceof ApplicationSubmissionError) {
    if (error.status === 400) return 'The application or security check was not accepted. Review the form, complete a new security check, and try again.';
    if (error.status === 413) return 'The application is too large to submit. Shorten the essay and try again.';
    if (error.status === 429) return 'Too many submission attempts were made. Please wait before trying again.';
    if (error.status === 503) return 'The submission service is temporarily unavailable. Please try again later.';
    if (error.code === 'timeout') return 'The submission timed out. Check your connection and try again.';
    if (error.code === 'network_error') return 'The application could not reach the submission service. Check your connection and try again.';
  }
  return 'Your application could not be submitted. Please try again later.';
}
