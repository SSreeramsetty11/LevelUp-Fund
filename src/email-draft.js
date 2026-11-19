function text(value) {
  return value == null ? "" : String(value).trim();
}

export function createEmailDraft(application, type) {
  const name = text(application.name) || "there";
  const certification = text(application.exam) || "your certification";
  const to = text(application.email);
  let subject;
  let body;

  if (type === "practice") {
    subject = "Your LevelUp Fund practice test";
    body =
      `Hi ${name},\n\n` +
      `Thank you for applying to The LevelUp Fund for ${certification}.\n\n` +
      "Here are the next steps for your practice test:\n\n" +
      "[Add practice-test instructions or link here]\n\n" +
      "Please reply with your results when complete.\n\n" +
      "Best,\nThe LevelUp Fund";
  } else if (type === "approved") {
    subject = "Your LevelUp Fund application";
    body =
      `Hi ${name},\n\n` +
      `We're pleased to let you know that your application for ${certification} has been approved.\n\n` +
      "We'll follow up with the next steps for arranging your certification.\n\n" +
      "Best,\nThe LevelUp Fund";
  } else if (type === "rejected") {
    subject = "Your LevelUp Fund application";
    body =
      `Hi ${name},\n\n` +
      "Thank you for applying to The LevelUp Fund. " +
      "After reviewing your application, we're unable to offer a grant at this time.\n\n" +
      "We appreciate your interest and wish you the best with your certification goals.\n\n" +
      "Best,\nThe LevelUp Fund";
  } else {
    throw new TypeError("Unknown email draft type.");
  }

  return { to, subject, body };
}

export function createMailtoLink(draft) {
  return (
    "mailto:" + encodeURIComponent(draft.to) +
    "?subject=" + encodeURIComponent(draft.subject) +
    "&body=" + encodeURIComponent(draft.body)
  );
}

export function createGmailComposeLink(draft) {
  const parameters = new URLSearchParams({
    view: "cm",
    fs: "1",
    to: draft.to,
    su: draft.subject,
    body: draft.body
  });
  return "https://mail.google.com/mail/?" + parameters.toString();
}

export function formatEmailDraft(draft) {
  return `To: ${draft.to}\nSubject: ${draft.subject}\n\n${draft.body}`;
}
