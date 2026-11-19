import assert from "node:assert/strict";
import {
  createEmailDraft,
  createGmailComposeLink,
  createMailtoLink,
  formatEmailDraft
} from "../src/email-draft.js";

const application = {
  name: "Sample Student",
  email: "student+test@example.com",
  exam: "Example Certification"
};

for (const type of ["practice", "approved", "rejected"]) {
  const draft = createEmailDraft(application, type);
  assert.equal(draft.to, application.email);
  assert.match(draft.body, /Sample Student/);
  assert.match(draft.body, /The LevelUp Fund/);
  assert.match(decodeURIComponent(createMailtoLink(draft)), /^mailto:student\+test@example\.com\?subject=/);
  const gmail = new URL(createGmailComposeLink(draft));
  assert.equal(gmail.origin, "https://mail.google.com");
  assert.equal(gmail.searchParams.get("to"), application.email);
  assert.equal(gmail.searchParams.get("su"), draft.subject);
  assert.equal(gmail.searchParams.get("body"), draft.body);
  assert.match(formatEmailDraft(draft), /^To: student\+test@example\.com\nSubject: /);
}

assert.throws(() => createEmailDraft(application, "unknown"), /Unknown email draft type/);
console.log("Email draft checks passed: preview, copy text, Gmail and default-app links.");
