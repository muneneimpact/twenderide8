/**
 * Branded responsive HTML + plain-text email templates (server-only).
 * Brand: Twende Meru Rides — highland green with matatu gold accents.
 */

const GREEN = "#14532d";
const ACCENT = "#3faa35";
const INK = "#111827";
const MUTED = "#6b7280";
const SUPPORT = "ride@twendemeru.co.ke";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function shell(title: string, bodyHtml: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${escapeHtml(title)}</title></head>
<body style="margin:0;padding:0;background:#ffffff;font-family:Arial,Helvetica,sans-serif;color:${INK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
<tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border:1px solid #e5e7eb;border-radius:16px;overflow:hidden;">
<tr><td style="background:${GREEN};padding:20px 24px;">
<span style="color:#ffffff;font-size:20px;font-weight:bold;letter-spacing:1px;">TWENDE <span style="color:${ACCENT};">MERU</span></span>
<div style="color:#d1fae5;font-size:11px;letter-spacing:2px;margin-top:4px;">DISCOVER &bull; CONNECT &bull; GROW</div>
</td></tr>
<tr><td style="padding:24px;">${bodyHtml}</td></tr>
<tr><td style="padding:16px 24px;background:#f9fafb;color:${MUTED};font-size:12px;">
Need help? Reply to this email or write to <a href="mailto:${SUPPORT}" style="color:${GREEN};">${SUPPORT}</a>.<br/>
Twende Meru Rides, Meru, Kenya.
</td></tr>
</table></td></tr></table></body></html>`;
}

function heading(text: string): string {
  return `<h1 style="margin:0 0 12px;font-size:20px;color:${INK};">${escapeHtml(text)}</h1>`;
}

function para(text: string): string {
  return `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${INK};">${escapeHtml(text)}</p>`;
}

function rows(pairs: [string, string | null | undefined][]): string {
  const body = pairs
    .filter(([, value]) => value !== null && value !== undefined && String(value).length > 0)
    .map(
      ([label, value]) =>
        `<tr><td style="padding:8px 0;color:${MUTED};font-size:13px;">${escapeHtml(label)}</td>
         <td style="padding:8px 0;text-align:right;font-size:14px;font-weight:bold;color:${INK};">${escapeHtml(String(value))}</td></tr>`,
    )
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #e5e7eb;border-bottom:1px solid #e5e7eb;margin:8px 0 16px;">${body}</table>`;
}

function textRows(pairs: [string, string | null | undefined][]): string {
  return pairs
    .filter(([, value]) => value !== null && value !== undefined && String(value).length > 0)
    .map(([label, value]) => `${label}: ${value}`)
    .join("\n");
}

export interface ReceiptData {
  customerName: string;
  reference: string;
  when: string;
  pickup: string;
  dropoff: string;
  distanceKm: number;
  fare: string;
  paymentMethod: string;
  mpesaReceipt?: string | null;
  driverName?: string | null;
  vehicle?: string | null;
  plate?: string | null;
}

export type EmailTemplate =
  | { code: "welcome"; data: { name: string } }
  | { code: "ride_confirmed"; data: { name: string; reference: string; pickup: string; dropoff: string; fare: string; when: string } }
  | { code: "payment_receipt"; data: ReceiptData }
  | { code: "trip_receipt"; data: ReceiptData }
  | { code: "ride_cancelled"; data: { name: string; reference: string; reason: string; fee?: string | null } }
  | { code: "support_reply"; data: { name: string; reference?: string | null; message: string } }
  | { code: "driver_onboarding"; data: { name: string; status: string; note?: string | null } }
  | { code: "phone_verification"; data: { code: string; phone: string; minutes: number } }
  | { code: "milestone_thanks"; data: { name: string; trips: number } };

export function renderEmail(template: EmailTemplate): RenderedEmail {
  switch (template.code) {
    case "welcome": {
      const d = template.data;
      return {
        subject: "Welcome to Twende Meru Rides",
        html: shell(
          "Welcome",
          heading(`Karibu, ${d.name}`) +
            para("Your Twende Meru Rides account is ready. Set your pickup, tell us where to, and we will match you with a nearby driver in Meru.") +
            para("Verify your phone number in the app so we can send you ride alerts by SMS."),
        ),
        text: `Karibu ${d.name}.\n\nYour Twende Meru Rides account is ready. Verify your phone number in the app so we can send you ride alerts by SMS.\n\nSupport: ${SUPPORT}`,
      };
    }
    case "ride_confirmed": {
      const d = template.data;
      return {
        subject: `Ride confirmed - ${d.reference}`,
        html: shell(
          "Ride confirmed",
          heading("Your ride is confirmed") +
            para(`Hi ${d.name}, your driver is on the way.`) +
            rows([
              ["Trip reference", d.reference],
              ["When", d.when],
              ["Pickup", d.pickup],
              ["Destination", d.dropoff],
              ["Fare", d.fare],
            ]),
        ),
        text: `Your ride is confirmed.\n\n${textRows([
          ["Trip reference", d.reference],
          ["When", d.when],
          ["Pickup", d.pickup],
          ["Destination", d.dropoff],
          ["Fare", d.fare],
        ])}\n\nSupport: ${SUPPORT}`,
      };
    }
    case "payment_receipt":
    case "trip_receipt": {
      const d = template.data;
      const isPayment = template.code === "payment_receipt";
      const pairs: [string, string | null | undefined][] = [
        ["Customer", d.customerName],
        ["Trip reference", d.reference],
        ["Date and time", d.when],
        ["Pickup", d.pickup],
        ["Destination", d.dropoff],
        ["Distance", `${d.distanceKm.toFixed(1)} km`],
        ["Fare paid", d.fare],
        ["Payment method", d.paymentMethod],
        ["M-PESA receipt", d.mpesaReceipt ?? null],
        ["Driver", d.driverName ?? null],
        ["Vehicle", d.vehicle ?? null],
        ["Registration", d.plate ?? null],
      ];
      return {
        subject: `${isPayment ? "Payment receipt" : "Trip receipt"} - ${d.reference}`,
        html: shell(
          isPayment ? "Payment receipt" : "Trip receipt",
          heading(isPayment ? "Payment received" : "Thanks for riding with us") +
            para(isPayment ? "Here is your M-PESA payment receipt." : "Here is the summary of your completed trip.") +
            rows(pairs) +
            para(`Questions about this trip? Write to ${SUPPORT} quoting ${d.reference}.`),
        ),
        text: `${isPayment ? "Payment receipt" : "Trip receipt"}\n\n${textRows(pairs)}\n\nSupport: ${SUPPORT}`,
      };
    }
    case "ride_cancelled": {
      const d = template.data;
      return {
        subject: `Ride cancelled - ${d.reference}`,
        html: shell(
          "Ride cancelled",
          heading("Your ride was cancelled") +
            para(`Hi ${d.name}, trip ${d.reference} has been cancelled.`) +
            rows([
              ["Reason", d.reason],
              ["Cancellation fee", d.fee ?? "None"],
            ]),
        ),
        text: `Trip ${d.reference} was cancelled.\nReason: ${d.reason}\nCancellation fee: ${d.fee ?? "None"}\n\nSupport: ${SUPPORT}`,
      };
    }
    case "support_reply": {
      const d = template.data;
      return {
        subject: d.reference ? `Twende Meru Support - ${d.reference}` : "Twende Meru Support",
        html: shell(
          "Support reply",
          heading("Reply from Twende Meru Support") +
            para(`Hi ${d.name},`) +
            `<div style="padding:12px 14px;background:#f0fdf4;border-left:3px solid ${ACCENT};border-radius:8px;font-size:15px;line-height:1.55;white-space:pre-wrap;">${escapeHtml(d.message)}</div>` +
            para("You can continue the conversation in the app."),
        ),
        text: `Reply from Twende Meru Support:\n\n${d.message}\n\nSupport: ${SUPPORT}`,
      };
    }
    case "driver_onboarding": {
      const d = template.data;
      return {
        subject: `Driver onboarding update - ${d.status}`,
        html: shell(
          "Driver onboarding",
          heading("Your driver application") +
            para(`Hi ${d.name}, your application status is now: ${d.status}.`) +
            (d.note ? para(d.note) : ""),
        ),
        text: `Your driver application status is now: ${d.status}.${d.note ? `\n\n${d.note}` : ""}\n\nSupport: ${SUPPORT}`,
      };
    }
    case "phone_verification": {
      const d = template.data;
      return {
        subject: `${d.code} is your Twende Meru verification code`,
        html: shell(
          "Verify your phone number",
          heading("Verify your phone number") +
            para(`Enter this code in the app to confirm ${d.phone}. It expires in ${d.minutes} minutes.`) +
            `<div style="margin:16px 0;padding:16px;text-align:center;background:#f0fdf4;border-radius:12px;font-size:30px;letter-spacing:8px;font-weight:700;color:${ACCENT};">${escapeHtml(d.code)}</div>` +
            para("If you did not request this code, ignore this email and do not share it with anyone."),
        ),
        text: `Your Twende Meru Rides verification code is ${d.code}. It expires in ${d.minutes} minutes. Do not share this code.\n\nSupport: ${SUPPORT}`,
      };
    }
    case "milestone_thanks": {
      const d = template.data;
      return {
        subject: `Asante ${d.name} - ${d.trips} trips with Twende Meru Rides`,
        html: shell(
          "Thank you for riding with us",
          heading(`Asante sana, ${d.name}`) +
            para(`You have now completed ${d.trips} trips with Twende Meru Rides. Thank you for trusting us with your journeys around Meru.`) +
            para("Our drivers appreciate every trip you book. Karibu tena."),
        ),
        text: `Asante sana ${d.name}. You have completed ${d.trips} trips with Twende Meru Rides. Thank you for riding with us.\n\nSupport: ${SUPPORT}`,
      };
    }
  }
}

