import { describe, expect, it } from "vitest";
import { canOwnerDecline, isBusinessEmail } from "./hire-rules";

const H = 3_600_000;
const now = new Date("2026-10-20T10:00:00Z");

describe("owner decline window", () => {
  it("allows declining when pickup is 12+ hours away", () => {
    expect(
      canOwnerDecline({
        startAt: new Date(now.getTime() + 13 * H),
        bookedAt: new Date(now.getTime() - 48 * H),
        now,
      }),
    ).toBe(true);
  });
  it("blocks declining under 12 hours when booked long ago", () => {
    expect(
      canOwnerDecline({
        startAt: new Date(now.getTime() + 5 * H),
        bookedAt: new Date(now.getTime() - 48 * H),
        now,
      }),
    ).toBe(false);
  });
  it("allows within 3 hours of a short-notice booking", () => {
    expect(
      canOwnerDecline({
        startAt: new Date(now.getTime() + 6 * H),
        bookedAt: new Date(now.getTime() - 2 * H),
        now,
      }),
    ).toBe(true);
  });
  it("blocks after 3 hours of a short-notice booking", () => {
    expect(
      canOwnerDecline({
        startAt: new Date(now.getTime() + 4 * H),
        bookedAt: new Date(now.getTime() - 4 * H),
        now,
      }),
    ).toBe(false);
  });
});

describe("business email", () => {
  it("accepts company domains", () => {
    expect(isBusinessEmail("jane@tukuzeafrika.org")).toBe(true);
    expect(isBusinessEmail("ops@meru.go.ke")).toBe(true);
    expect(isBusinessEmail("a@uni.ac.ke")).toBe(true);
  });
  it("rejects free mail", () => {
    expect(isBusinessEmail("jane@gmail.com")).toBe(false);
  });
});

import { calculateFuelShortfall, settleHireReturn } from "./hire-rules";
describe("hire return deposit settlement", () => {
  it("charges KES 30 per km above 300 km a day", () => {
    const r = settleHireReturn({
      deposit: 10000,
      days: 2,
      kmDriven: 700,
      fuelCharge: 0,
      penalties: 0,
    });
    expect(r.excessCharge).toBe(3000);
    expect(r.returned).toBe(7000);
  });
  it("returns the whole deposit when nothing is owed", () => {
    expect(
      settleHireReturn({ deposit: 5000, days: 1, kmDriven: 250, fuelCharge: 0, penalties: 0 })
        .returned,
    ).toBe(5000);
  });
  it("keeps the whole deposit and records the balance still owed", () => {
    const r = settleHireReturn({
      deposit: 2000,
      days: 1,
      kmDriven: 300,
      fuelCharge: 1500,
      penalties: 1000,
    });
    expect(r.kept).toBe(2000);
    expect(r.balanceDue).toBe(500);
  });
  it("lets the owner waive excess kilometres without waiving fuel or fines", () => {
    const r = settleHireReturn({
      deposit: 10000,
      days: 1,
      kmDriven: 500,
      fuelCharge: 1200,
      penalties: 300,
      waiveExcessKm: true,
    });
    expect(r.excessKm).toBe(200);
    expect(r.excessCharge).toBe(0);
    expect(r.deductions).toBe(1500);
  });
  it("lets the owner waive missing fuel independently", () => {
    const r = settleHireReturn({
      deposit: 10000,
      days: 1,
      kmDriven: 500,
      fuelCharge: 1200,
      penalties: 0,
      waiveFuel: true,
    });
    expect(r.excessCharge).toBe(6000);
    expect(r.fuelCharge).toBe(0);
  });
  it("calculates fuel shortfall from pickup and return gauge levels", () => {
    expect(calculateFuelShortfall("Full", "1/2")).toBe(50);
    expect(calculateFuelShortfall("1/2", "3/4")).toBe(0);
    expect(calculateFuelShortfall("unknown", "Reserve")).toBeNull();
  });
});
