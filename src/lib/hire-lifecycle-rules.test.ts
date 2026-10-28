import { describe, expect, it } from "vitest";
import {
  assertHireLifecycleTransition,
  canTransitionHireState,
  type HireLifecycleState,
} from "./hire-lifecycle-rules";

describe("hire lifecycle transition policy", () => {
  it("allows the normal payment-to-handover-to-close path", () => {
    const path: Array<[HireLifecycleState, HireLifecycleState]> = [
      ["payment_pending", "ready_for_handover"],
      ["ready_for_handover", "on_hire"],
      ["on_hire", "settlement_pending"],
      ["settlement_pending", "closed"],
    ];
    for (const [from, to] of path) expect(canTransitionHireState(from, to)).toBe(true);
  });

  it("allows the company review path to confirm a booking", () => {
    expect(canTransitionHireState("submitted", "ready_for_handover")).toBe(true);
  });

  it("rejects skipping handover or reopening terminal bookings", () => {
    expect(canTransitionHireState("ready_for_handover", "closed")).toBe(false);
    expect(canTransitionHireState("closed", "on_hire")).toBe(false);
    expect(canTransitionHireState("declined", "ready_for_handover")).toBe(false);
  });

  it("throws an actionable error for an invalid transition", () => {
    expect(() => assertHireLifecycleTransition("settlement_pending", "on_hire")).toThrow(
      "Invalid hire lifecycle transition",
    );
  });

  it("allows idempotent writes to the same state", () => {
    expect(() => assertHireLifecycleTransition("on_hire", "on_hire")).not.toThrow();
  });
});
