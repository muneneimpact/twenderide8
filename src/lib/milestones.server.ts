/**
 * Customer loyalty milestones (server-only).
 *
 * After a trip completes we count how many rides that customer has actually
 * finished. On the 20th completed trip we thank them by SMS and email. The
 * comms_log idempotency key is derived from the customer and the milestone, so
 * the thank-you can never go out twice.
 */
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { sendTransactionalSms, sendTransactionalEmail } from "./comms.server";

export const TRIP_MILESTONE = 20;

export async function checkTripMilestone(customerId: string) {
  const { count, error } = await supabaseAdmin
    .from("rides")
    .select("id", { count: "exact", head: true })
    .eq("customer_id", customerId)
    .eq("status", "trip_completed");
  if (error || count === null) return { milestone: false as const };
  if (count !== TRIP_MILESTONE) return { milestone: false as const };

  const { data: profile } = await supabaseAdmin
    .from("profiles")
    .select("full_name, phone, phone_verified_at, email")
    .eq("id", customerId)
    .maybeSingle();

  const name = profile?.full_name?.split(" ")[0] ?? "rafiki";
  const message = `Asante ${name}! You have completed ${TRIP_MILESTONE} trips with Twende Meru Rides. Thank you for riding with us. Karibu tena.`;

  const results: Record<string, unknown> = {};

  if (profile?.phone) {
    results["sms"] = await sendTransactionalSms({
      to: profile.phone,
      message,
      eventType: "milestone_thanks",
      idempotencyKey: `milestone:${customerId}:${TRIP_MILESTONE}`,
      context: { userId: customerId },
    });
  }

  if (profile?.email) {
    results["email"] = await sendTransactionalEmail({
      to: profile.email,
      template: { code: "milestone_thanks", data: { name, trips: TRIP_MILESTONE } },
      eventType: "milestone_thanks",
      idempotencyKey: `milestone-email:${customerId}:${TRIP_MILESTONE}`,
      context: { userId: customerId },
    });
  }

  return { milestone: true as const, trips: count, results };
}
