import { describe, expect, it } from "vitest";
import { computeApproachFee } from "./approach-fee";

describe("approach fee", () => {
  it("is free within 500 m", () => {
    expect(computeApproachFee(0.5, 45).fee).toBe(0);
  });
  it("charges 50% of per-km on short approaches", () => {
    expect(computeApproachFee(1, 40)).toMatchObject({ percent: 50, fee: 20 });
  });
  it("charges 30% of per-km on long approaches", () => {
    expect(computeApproachFee(5, 40)).toMatchObject({ percent: 30, fee: 60 });
  });
  it("uses Ops-configured short and long approach shares", () => {
    expect(computeApproachFee(1, 40, { shortPercent: 80, longPercent: 20 })).toMatchObject({
      percent: 80,
      fee: 32,
    });
    expect(computeApproachFee(5, 40, { shortPercent: 80, longPercent: 20 })).toMatchObject({
      percent: 20,
      fee: 40,
    });
  });
  it("tapers between the configured percentages", () => {
    expect(computeApproachFee(3.25, 40, { shortPercent: 80, longPercent: 20 }).percent).toBe(50);
  });
});
