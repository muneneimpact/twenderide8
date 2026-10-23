import { normaliseKenyanPhone } from "@/lib/phone";

export type PartnerInterestType = "driver" | "car_owner";
export type PartnerInterestStatus = "new" | "contacted" | "approved" | "declined";

function typeLabel(requestType: PartnerInterestType) {
  return requestType === "driver" ? "driver" : "car-listing";
}

function statusLabel(status: PartnerInterestStatus) {
  return status === "approved" ? "approved for onboarding" : status;
}

export async function notifyPartnerInterest(input: {
  id: string;
  name: string;
  phone: string;
  requestType: PartnerInterestType;
  status: PartnerInterestStatus;
  whatsappOptIn: boolean;
  event: "submitted" | "updated";
}) {
  let phone: string;
  try {
    phone = normaliseKenyanPhone(input.phone);
  } catch {
    return { sms: "invalid_phone", whatsapp: "invalid_phone" } as const;
  }
  const body =
    input.event === "submitted"
      ? `Hi ${input.name}, Twende has received your ${typeLabel(input.requestType)} interest request. Twende Operations will contact you soon. Thank you for choosing Twende.`
      : `Hi ${input.name}, your Twende ${typeLabel(input.requestType)} interest request is now ${statusLabel(input.status)}. Twende Operations will contact you with the next step.`;
  const key = `partner-interest:${input.id}:${input.event}:${input.status}`;
  const smsPromise = (async () => {
    const { sendTransactionalSms } = await import("@/lib/comms.server");
    const result = await sendTransactionalSms({
      to: phone,
      message: body,
      eventType: `partner_interest_${input.event}`,
      idempotencyKey: `${key}:sms`,
    });
    return result.status;
  })().catch((error) => {
    console.error("partner interest SMS failed", error);
    return "failed";
  });
  const whatsappPromise = (async () => {
    if (!input.whatsappOptIn) return "not_selected";
    const { whatsappGatewayConfigured, whatsappGatewaySend } =
      await import("@/lib/whatsapp-gateway.server");
    if (!whatsappGatewayConfigured()) return "not_configured";
    await whatsappGatewaySend({
      recipient_type: "individual",
      to: phone.replace(/\D/g, ""),
      type: "text",
      text: { body },
    });
    return "sent";
  })().catch((error) => {
    console.error("partner interest WhatsApp failed", error);
    return "failed";
  });
  const [sms, whatsapp] = await Promise.all([smsPromise, whatsappPromise]);
  return { sms, whatsapp };
}
