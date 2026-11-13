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
