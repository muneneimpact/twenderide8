import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  assertHireLifecycleTransition,
  type HireLifecycleState,
} from "./hire-lifecycle-rules";

export type { HireLifecycleState } from "./hire-lifecycle-rules";

export async function recordHireEvent(input: {
  quoteId: string;
  fromState?: string | null;
  toState: HireLifecycleState;
  eventType: string;
  actorId?: string | null;
  actorRole?: string | null;
  reason?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { error } = await (supabaseAdmin as any).from("hire_quote_events").insert({
    hire_quote_id: input.quoteId,
    from_state: input.fromState ?? null,
    to_state: input.toState,
    event_type: input.eventType,
    actor_id: input.actorId ?? null,
    actor_role: input.actorRole ?? null,
    reason: input.reason ?? null,
    metadata: input.metadata ?? {},
  } as never);
  if (error) throw new Error(`Could not record hire lifecycle event: ${error.message}`);
}

export async function transitionHireState(input: {
  quoteId: string;
  from: HireLifecycleState | HireLifecycleState[];
  to: HireLifecycleState;
  eventType: string;
  actorId?: string | null;
  actorRole?: string | null;
  reason?: string | null;
  patch?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}) {
  const fromStates = Array.isArray(input.from) ? input.from : [input.from];
  for (const fromState of fromStates) {
    assertHireLifecycleTransition(fromState, input.to);
  }
  const query = (supabaseAdmin as any)
    .from("hire_quotes")
    .update({ ...(input.patch ?? {}), lifecycle_state: input.to } as never)
    .eq("id", input.quoteId)
    .in("lifecycle_state", fromStates)
    .select("id, lifecycle_state")
    .maybeSingle();
  const { data, error } = await query;
  if (error) throw new Error(`Could not transition hire booking: ${error.message}`);
  if (!data) throw new Error("This hire booking changed state. Refresh and try again.");
  await recordHireEvent({
    quoteId: input.quoteId,
    fromState: fromStates.join("|") ,
    toState: input.to,
    eventType: input.eventType,
    ...(input.actorId !== undefined ? { actorId: input.actorId } : {}),
    ...(input.actorRole !== undefined ? { actorRole: input.actorRole } : {}),
    ...(input.reason !== undefined ? { reason: input.reason } : {}),
    ...(input.metadata !== undefined ? { metadata: input.metadata } : {}),
  });
  return data;
}
