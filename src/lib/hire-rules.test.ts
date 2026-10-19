import { describe, expect, it } from "vitest";
import { canOwnerDecline, isBusinessEmail } from "./hire-rules";

const H = 3_600_000;
const now = new Date("2026-10-20T10:00:00Z");

describe("owner decline window", () => {
  it("allows declining when pickup is 12+ hours away", () => {
    expect(canOwnerDecline({ startAt: new Date(now.getTime() + 13 * H), bookedAt: new Date(now.getTime() - 48 * H), now })).toBe(true);
  });
  it("blocks declining under 12 hours when booked long ago", () => {
    expect(canOwnerDecline({ startAt: new Date(now.getTime() + 5 * H), bookedAt: new Date(now.getTime() - 48 * H), now })).toBe(false);
  });
  it("allows within 3 hours of a short-notice booking", () => {
    expect(canOwnerDecline({ startAt: new Date(now.getTime() + 6 * H), bookedAt: new Date(now.getTime() - 2 * H), now })).toBe(true);
  });
  it("blocks after 3 hours of a short-notice booking", () => {
    expect(canOwnerDecline({ startAt: new Date(now.getTime() + 4 * H), bookedAt: new Date(now.getTime() - 4 * H), now })).toBe(false);
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
