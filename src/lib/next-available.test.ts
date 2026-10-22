import { describe, expect, it } from "vitest";
import { nextAvailableLabel } from "./next-available";

const now = new Date(2026, 9, 22, 12);
const iso = (y: number, m: number, d: number) => new Date(y, m, d).toISOString();

describe("nextAvailableLabel", () => {
  it("free today", () => {
    expect(nextAvailableLabel([], now).label).toBe("Available today");
  });
  it("booked today until tomorrow", () => {
    expect(nextAvailableLabel([{ start: iso(2026, 9, 21), end: iso(2026, 9, 23) }], now).label).toBe("Available tomorrow");
  });
  it("booked until 27 Oct", () => {
    expect(nextAvailableLabel([{ start: iso(2026, 9, 21), end: iso(2026, 9, 27) }], now).label).toBe("Available 27 Oct 2026");
  });
});
