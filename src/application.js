import { evaluateIncomeEligibility, incomeClasses, incomeClassFor } from "./eligibility.js";
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.50.0/+esm";
import { createSharedAdmin } from "./shared-admin.js";
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "./supabase-config.js";
const backend = createSharedAdmin(createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY));
const grantForm = document.getElementById("grant-form");
const formError = document.getElementById("form-error");
const successDialog = document.getElementById("success-dialog");
const householdIncomeClass = document.getElementById("household-income-class");
const householdIncome = document.getElementById("household-income");
    function makeId() {
      if (window.crypto && crypto.randomUUID) {
        return crypto.randomUUID();
      }

      return Date.now() + "-" + Math.random().toString(36).slice(2);
    }

    function showFieldError(field, message) {
      const error = document.getElementById(field.id + "-error");

      field.setAttribute("aria-invalid", "true");
      field.setAttribute("aria-describedby", error.id);

      error.textContent = message;
      error.classList.remove("hidden");
    }

    function clearFieldError(field) {
      const error = document.getElementById(field.id + "-error");

      if (!error) return;

      field.removeAttribute("aria-invalid");
      field.removeAttribute("aria-describedby");
      field.removeAttribute("data-valid");

      error.textContent = "";
      error.classList.add("hidden");
    }

    grantForm.querySelectorAll("input, textarea, select").forEach((field) => {
      field.addEventListener("input", () => clearFieldError(field));
      field.addEventListener("change", () => clearFieldError(field));
    });

    const essayField = document.getElementById("student-info");
    const essayCount = document.getElementById("essay-count");
    function countEssayWords(value) {
      const text = value.trim();
      return text ? text.split(/\s+/).length : 0;
    }
    const essayFill = document.getElementById("essay-meter-fill");
    function updateEssayCount() {
      const words = countEssayWords(essayField.value);
      essayCount.textContent = `${words} / 499 words`;
      essayFill.style.transform = `scaleX(${Math.min(1, words / 499).toFixed(3)})`;
      essayFill.dataset.level = words >= 500 ? "over" : words >= 450 ? "near" : "ok";
    }
    essayField.addEventListener("input", updateEssayCount);

    // One source of truth for field rules: used on blur (inline) and on submit.
    function fieldMessage(field) {
      const v = field.value ? field.value.trim() : "";
      switch (field.id) {
        case "full-name": return v ? "" : "Enter a name.";
        case "email": return v && field.validity.valid ? "" : "Enter a valid email address.";
        case "candidate-id": return v ? "" : "Enter the organization that administers the certification.";
        case "exam-name": return v ? "" : "Enter the certification name.";
        case "certification-url": {
          let ok = false;
          try {
            const parsed = new URL(v);
            ok = /^https?:\/\//i.test(v) && (parsed.protocol === "http:" || parsed.protocol === "https:") && !!parsed.hostname && !parsed.username && !parsed.password && field.validity.valid;
          } catch (error) { /* malformed URLs fall through to the message */ }
          return ok ? "" : "Enter a valid certification website URL starting with http:// or https://, without a username or password.";
        }
        case "student-info": { const words = countEssayWords(field.value); return words > 0 && words < 500 ? "" : "Enter an essay of fewer than 500 words."; }
        case "household-income-class": return incomeClasses.some((range) => range.value === v) ? "" : "Select an annual household income range.";
        case "household-income": {
          const income = Number(field.value);
          if (field.value === "" || !field.validity.valid || !Number.isFinite(income) || income < 0 || income > 9999999999.99) {
            return "Enter a valid annual household income of zero or more, with up to two decimal places.";
          }
          if (incomeClasses.some((range) => range.value === householdIncomeClass.value) && incomeClassFor(income)?.value !== householdIncomeClass.value) {
            return "The annual household income must match the selected income range.";
          }
          return "";
        }
        case "grant-amount": return field.value !== "" && field.validity.valid && Number.isFinite(Number(field.value)) && Number(field.value) > 0 && Number(field.value) <= 9999999999.99 ? "" : "Enter a valid amount greater than zero, with up to two decimal places.";
        case "agreement": return field.checked ? "" : "Please agree to the grant terms.";
      }
      return "";
    }

    householdIncomeClass.addEventListener("change", () => {
      if (!householdIncome.value.trim()) return;
      const message = fieldMessage(householdIncome);
      if (message) showFieldError(householdIncome, message); else clearFieldError(householdIncome);
    });

    // Validate inline as people leave a field (empties wait for submit so tabbing past isn't scolded).
    grantForm.querySelectorAll("input[type=text], input[type=email], input[type=url], input[type=number], textarea").forEach((field) => {
      field.addEventListener("blur", () => {
        if (!field.value.trim()) return;
        const message = fieldMessage(field);
        if (message) showFieldError(field, message); else { clearFieldError(field); field.dataset.valid = "true"; }
      });
    });

    /* Application submission */
    grantForm.addEventListener("submit", async (event) => {
      event.preventDefault();

      formError.classList.add("hidden");
      formError.textContent = "";

      grantForm.querySelectorAll("input, textarea, select").forEach(clearFieldError);

      const fullName = document.getElementById("full-name");
      const email = document.getElementById("email");
      const candidateId = document.getElementById("candidate-id");
      const examName = document.getElementById("exam-name");
      const certificationUrl = document.getElementById("certification-url");
      const studentInfo = document.getElementById("student-info");
      const agreement = document.getElementById("agreement");
      const ageConfirmation = document.getElementById("age-confirmation");
      const amount = document.getElementById("grant-amount");

      let firstInvalid = null;

      function check(field, valid, message) {
        if (!valid) {
          showFieldError(field, message);

          if (!firstInvalid) {
            firstInvalid = field;
          }
        }
      }

      check(ageConfirmation, ageConfirmation.checked, "You must confirm that you are at least 14 years old to apply.");
      const urlValue = certificationUrl.value.trim();
      [fullName, email, candidateId, examName, certificationUrl, studentInfo, householdIncomeClass, householdIncome, amount, agreement].forEach((field) => {
        const message = fieldMessage(field);
        check(field, !message, message);
      });

      if (firstInvalid) {
        formError.textContent = "Please check the highlighted fields.";
        formError.classList.remove("hidden");
        firstInvalid.focus();
        return;
      }

      const application = {
        id: makeId(),
        name: fullName.value.trim(),
        email: email.value.trim(),
        examProvider: candidateId.value.trim(),
        exam: examName.value.trim(),
        certificationUrl: urlValue,
        essay: studentInfo.value.trim(),
        requestedAmount: Number(amount.value),
        householdIncome: Number(householdIncome.value),
        practiceScore: "",
        notes: "",
        status: "Pending",
        submittedAt: new Date().toISOString()
      };

      const submitButton = grantForm.querySelector('button[type="submit"]');
      submitButton.disabled = true;
      try {
        application.agreement = agreement.checked;
        application.ageConfirmed = ageConfirmation.checked;
        await backend.submitApplication(application);
      } catch (error) {
        formError.textContent = "Your application could not be submitted. Please try again later.";
        formError.classList.remove("hidden");
        return;
      } finally {
        submitButton.disabled = false;
      }

      const income = Number(householdIncome.value);
      const requested = Number(amount.value);
      const message = document.getElementById("success-message");
      const eligibility = evaluateIncomeEligibility(income, requested);
      if (eligibility === "over_income_limit") {
        document.getElementById("success-title").textContent = "Test application rejected";
        message.textContent = "This sample application was automatically rejected because the reported annual household income is over $90,000.";
      } else if (eligibility === "request_not_high_enough") {
        document.getElementById("success-title").textContent = "Test application submitted";
        message.textContent = "The requested amount does not exceed 0.75% of annual household income, so it cannot be approved at these values.";
      } else {
        document.getElementById("success-title").textContent = "Test application submitted";
        message.textContent = "The sample application was submitted for review. Meeting the income rules does not guarantee a grant.";
      }
      grantForm.reset();
      updateEssayCount();
      successDialog.showModal();
      document.getElementById("close-success").focus();
    });

    document.getElementById("close-success").addEventListener("click", () => {
      successDialog.close();
    });
