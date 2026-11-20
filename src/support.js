import { createAuthCaptcha } from "./auth-captcha.js";
import { createSupportApi, supportErrorMessage } from "./support-api.js";
import {
  SUPPORT_REQUESTS_ENABLED,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  TURNSTILE_SITE_KEY
} from "./supabase-config.js";

const form = document.getElementById("support-form");
const formError = document.getElementById("support-error");
const setupNotice = document.getElementById("support-setup-notice");
const successDialog = document.getElementById("support-success-dialog");
const submitButton = form.querySelector('button[type="submit"]');
const messageField = document.getElementById("support-message");
const messageCount = document.getElementById("support-message-count");
const api = createSupportApi({ supabaseUrl: SUPABASE_URL, publishableKey: SUPABASE_PUBLISHABLE_KEY });
const captcha = createAuthCaptcha({
  siteKey: SUPPORT_REQUESTS_ENABLED ? TURNSTILE_SITE_KEY : "",
  container: document.getElementById("support-turnstile"),
  status: document.getElementById("support-turnstile-status"),
  action: "support_submit"
});

function makeId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

let submissionId = makeId();

function updateCount() {
  messageCount.textContent = `${messageField.value.length} / 4000 characters`;
}
messageField.addEventListener("input", updateCount);
updateCount();

function showError(message, field) {
  formError.textContent = message;
  formError.classList.remove("hidden");
  if (field) field.focus();
}

if (!SUPPORT_REQUESTS_ENABLED) {
  setupNotice.hidden = false;
  submitButton.disabled = true;
  submitButton.textContent = "Support form is being set up";
} else {
  captcha.prepare();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  formError.classList.add("hidden");
  formError.textContent = "";
  if (!SUPPORT_REQUESTS_ENABLED) {
    showError("The support form is still being set up. Please try again later.");
    return;
  }

  const name = document.getElementById("support-name");
  const email = document.getElementById("support-email");
  const category = document.getElementById("support-category");
  const subject = document.getElementById("support-subject");
  const privacy = document.getElementById("support-privacy");
  const eligibility = document.getElementById("support-contact-eligibility");

  if (!name.value.trim()) return showError("Enter your name.", name);
  if (!email.value.trim() || !email.validity.valid) return showError("Enter a valid email address.", email);
  if (!category.value) return showError("Select a support category.", category);
  if (!subject.value.trim()) return showError("Enter a subject.", subject);
  if (messageField.value.trim().length < 10) return showError("Enter a message with at least 10 characters.", messageField);
  if (!eligibility.checked) return showError("Confirm that you are at least 14 or a parent or guardian.", eligibility);
  if (!privacy.checked) return showError("Accept the privacy and data policies.", privacy);

  const challenge = captcha.consume();
  if (!challenge.ok) return showError("Complete the security check before submitting.");

  submitButton.disabled = true;
  submitButton.textContent = "Sending…";
  try {
    await api.submitSupportRequest({
      id: submissionId,
      name: name.value.trim(),
      email: email.value.trim(),
      category: category.value,
      subject: subject.value.trim(),
      message: messageField.value.trim(),
      privacyAcknowledged: privacy.checked,
      contactEligibilityConfirmed: eligibility.checked
    }, challenge.token, document.getElementById("support-company-website").value);
    form.reset();
    submissionId = makeId();
    updateCount();
    successDialog.showModal();
    document.getElementById("close-support-success").focus();
  } catch (error) {
    showError(supportErrorMessage(error));
  } finally {
    captcha.reset();
    submitButton.disabled = false;
    submitButton.textContent = "Send support request";
  }
});

document.getElementById("close-support-success").addEventListener("click", () => successDialog.close());
