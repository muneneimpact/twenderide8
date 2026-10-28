export const ACTIVE_PAYMENT_INTENT_STATUSES = [
  "initiating",
  "pending",
  "awaiting_confirmation",
  "processing",
] as const;

export function hireWalletIdempotencyKey(
  quoteId: string,
  paidTotal: number,
  amount: number,
): string {
  return `hirewallet:${quoteId}:${paidTotal.toFixed(2)}:${amount.toFixed(2)}`;
}

export function validateWalletHirePayment(input: {
  total: number;
  paid: number;
  amount: number;
  policy: string;
  minimum: number;
}) {
  const total = Number(input.total);
  const paid = Number(input.paid);
  const amount = Number(input.amount);
  const minimum = Number(input.minimum);
  if (![total, paid, amount, minimum].every(Number.isFinite)) {
    throw new Error("Payment amount is invalid.");
  }
  if (total <= 0 || paid < 0 || paid > total) throw new Error("Hire payment balance is invalid.");
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Payment amount must be a whole KES amount greater than zero.");
  const remaining = total - paid;
  if (amount > remaining) throw new Error("Payment amount cannot exceed the remaining hire balance.");
  if (paid < minimum && amount < minimum - paid) {
    throw new Error(
      input.policy === "full"
        ? "This vehicle requires full payment before the owner can see the booking."
        : `Pay at least KES ${Math.ceil(minimum - paid).toLocaleString("en-KE")} before the owner can see the booking.`,
    );
  }
  if (input.policy === "full" && amount !== remaining) {
    throw new Error("This vehicle requires the full remaining hire amount in one payment.");
  }
  return { amount, remaining };
}

export function validateWalletRidePayment(totalFare: number) {
  const amount = Number(totalFare);
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Ride fare is invalid.");
  return amount;
}
