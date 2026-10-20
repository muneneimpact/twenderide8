import { describe, expect, it } from "vitest";
import { splitSpend, topupBonus, walletBalances, WALLET_FUNDING_APPROVER_PHONE } from "./wallet-rules";

describe("wallet rules", () => {
  it("admin/promo credit is not refundable cash", () => {
    const b = walletBalances([
      { amount: 500, status: "posted", refundable: true },
      { amount: 200, status: "posted", refundable: false },
    ]);
    expect(b).toEqual({ cash: 500, promo: 200, total: 700 });
  });

  it("rejected entries do not count", () => {
    expect(walletBalances([{ amount: -300, status: "rejected", refundable: true }]).cash).toBe(0);
  });

  it("spending burns promo credit before cash", () => {
    expect(splitSpend(500, 200, 300)).toEqual({ fromPromo: 200, fromCash: 100 });
  });

  it("cannot spend more than the wallet holds", () => {
    expect(() => splitSpend(100, 50, 200)).toThrow();
  });

  it("top-up bonus applies only from the minimum and respects the cap", () => {
    const cfg = { percent: 10, minTopup: 500, cap: 300 };
    expect(topupBonus(499, cfg)).toBe(0);
    expect(topupBonus(500, cfg)).toBe(50);
    expect(topupBonus(10000, cfg)).toBe(300);
  });

  it("funding approvals go to 0723175181", () => {
    expect(WALLET_FUNDING_APPROVER_PHONE).toBe("0723175181");
  });
});
