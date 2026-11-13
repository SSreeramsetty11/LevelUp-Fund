// These ranges are labels used by the application form, not official income classes.
// Each upper limit is exclusive, so the ranges also cover amounts with cents.
export const incomeClasses = [
  { value: 'lower-lower', label: 'Lower-lower', upperLimit: 20000 },
  { value: 'lower-middle', label: 'Lower-middle', upperLimit: 40000 },
  { value: 'lower-upper', label: 'Lower-upper', upperLimit: 60000 },
  { value: 'middle-lower', label: 'Middle-lower', upperLimit: 75000 },
  { value: 'middle-middle', label: 'Middle-middle', upperLimit: 90000 },
  { value: 'middle-upper', label: 'Middle-upper', upperLimit: 120000 },
  { value: 'upper-lower', label: 'Upper-lower', upperLimit: 150000 },
  { value: 'upper-middle', label: 'Upper-middle', upperLimit: 200000 },
  { value: 'upper-upper', label: 'Upper-upper', upperLimit: Infinity }
];

export function incomeClassFor(income) {
  if (!Number.isFinite(income) || income < 0) return null;
  return incomeClasses.find((range) => income < range.upperLimit) || null;
}

export function isValidCertificationUrl(value) {
  try {
    const parsed = new URL(value);
    const labels = parsed.hostname.split('.');
    const publicHostname = labels.length >= 2
      && labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))
      && /[a-z]/i.test(labels.at(-1));
    return /^https?:\/\//i.test(value)
      && (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && publicHostname
      && !parsed.username
      && !parsed.password;
  } catch (error) {
    return false;
  }
}

// The requested amount must be strictly greater than 0.75% of annual household income.
// Dollar amounts are limited to two decimal places and converted to integer cents.
export function evaluateIncomeEligibility(income, amount) {
  if (!Number.isFinite(income) || income < 0 || !Number.isFinite(amount) || amount <= 0) {
    return 'invalid';
  }
  if (income > 90000) return 'over_income_limit';
  const incomeCents = Math.round(income * 100);
  const amountCents = Math.round(amount * 100);
  return amountCents * 10000 > incomeCents * 75 ? 'eligible' : 'request_not_high_enough';
}
