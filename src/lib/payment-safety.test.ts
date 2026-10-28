import { describe, expect, it } from "vitest";
import {
  hireWalletIdempotencyKey,
  validateWalletHirePayment,
  validateWalletRidePayment,
} from "./payment-safety";

describe("Phase 1 wallet payment safety", () => {
  it("uses the same key for concurrent retries of the same balance snapshot", () => {
    expect(hireWalletIdempotencyKey("quote", 1000, 500)).toBe(
      hireWalletIdempotencyKey("quote", 1000, 500),
    );
    expect(hireWalletIdempotencyKey("quote", 1000, 500)).not.toBe(
      hireWalletIdempotencyKey("quote", 1500, 500),
    );
  });

  it("rejects an overpayment instead of silently clamping it", () => {
    expect(() =>
      validateWalletHirePayment({ total: 1000, paid: 0, amount: 1001, policy: "daily_flexible", minimum: 100 }),
    ).toThrow("cannot exceed");
  });

  it("enforces full-payment and first-payment minimums", () => {
    expect(() =>
      validateWalletHirePayment({ total: 1000, paid: 0, amount: 500, policy: "full", minimum: 1000 }),
    ).toThrow("full payment");
    expect(() =>
      validateWalletHirePayment({ total: 1000, paid: 0, amount: 99, policy: "daily_flexible", minimum: 100 }),
    ).toThrow("at least");
  });

  it("accepts the exact remaining balance and validates ride fares", () => {
    expect(validateWalletHirePayment({ total: 1000, paid: 400, amount: 600, policy: "full", minimum: 1000 })).toEqual({ amount: 600, remaining: 600 });
    expect(validateWalletRidePayment(850)).toBe(850);
    expect(() => validateWalletRidePayment(0)).toThrow("invalid");
  });
});
