export const HIRE_LIFECYCLE_STATES = [
  "submitted",
  "quoted",
  "payment_pending",
  "confirmed",
  "ready_for_handover",
  "on_hire",
  "return_pending",
  "settlement_pending",
  "closed",
  "declined",
  "cancelled",
] as const;

export type HireLifecycleState = (typeof HIRE_LIFECYCLE_STATES)[number];

const ALLOWED_TRANSITIONS: Record<HireLifecycleState, readonly HireLifecycleState[]> = {
  submitted: ["quoted", "payment_pending", "confirmed", "ready_for_handover", "declined", "cancelled"],
  quoted: ["payment_pending", "confirmed", "ready_for_handover", "declined", "cancelled"],
  payment_pending: ["ready_for_handover", "declined", "cancelled"],
  confirmed: ["ready_for_handover", "declined", "cancelled"],
  ready_for_handover: ["on_hire", "declined", "cancelled"],
  on_hire: ["return_pending", "settlement_pending"],
  return_pending: ["settlement_pending", "cancelled"],
  settlement_pending: ["closed"],
  closed: [],
  declined: [],
  cancelled: [],
};

export function canTransitionHireState(from: HireLifecycleState, to: HireLifecycleState) {
  return from === to || ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertHireLifecycleTransition(from: HireLifecycleState, to: HireLifecycleState) {
  if (!canTransitionHireState(from, to)) {
    throw new Error(`Invalid hire lifecycle transition: ${from} → ${to}.`);
  }
}
