# Twende Meru Rides — WhatsApp Template Review Pack

**Status:** Drafts for internal review only. Nothing in this pack has been created in WhatsApp Manager, submitted to Meta, or enabled for sending.

**Repository reviewed:** `muneneimpact/twendemeruride2` (`main`, clean at start of audit)

**Prepared:** 8 October 2026

## Executive summary

- The app currently has **no WhatsApp sender, WhatsApp Business API configuration, WhatsApp consent/preference field, or WhatsApp delivery log**. Existing channels are in-app, web push/FCM, TextSMS Kenya, and Resend email.
- `notify()` persists every called event to the in-app notification outbox, attempts web push (subject to push settings/tokens), and sends SMS only when the call marks the event `critical` and SMS is enabled. Direct OTP and milestone SMS calls bypass that helper and its preference check.
- The code contains **20 active utility-message scenarios**, **one authentication template** for both OTP paths, and **one milestone relationship message** drafted as marketing because Meta may classify relationship-building content as marketing. That is **22 draft template requests** in `whatsapp-template-api-payloads.json`.
- The template drafts are deliberately separate from implementation. Do not send a WhatsApp message until the recipient has opted in, a verified WhatsApp-capable number is available, the template is approved, and the provider/channel integration is implemented and tested.

## Scope and method

Reviewed notification delivery and callsites in `src/lib/notifications.server.ts`, `comms.server.ts`, `push.server.ts`, `email-templates.server.ts`, `otp.functions.ts`, `phone-auth.functions.ts`, `milestones.server.ts`, `rides.functions.ts`, `driver.functions.ts`, `dispatch.server.ts`, `payments.server.ts`, `hire.functions.ts`, `admin.functions.ts`, `account.functions.ts`, `push.functions.ts`, `sms-admin.functions.ts`, payment callback/reconciliation routes, Supabase migrations, and generated database types. Searched for notification, template, push, SMS, email, WhatsApp, trigger, cron, webhook, and delivery callsites. Environment values were not inspected or included.

## Active event/trigger inventory and proposed template mapping

| Trigger / source | Recipient and existing behavior | Existing code(s) | Proposed WhatsApp template | Classification / review note |
|---|---|---|---|---|
| Ride request finds no driver (`rides.functions.ts`) | Customer; critical in-app/push/SMS | `no_driver` | `no_driver_available` | Utility; tied to the ride request; confirms no payment was requested. |
| Dispatch sends a targeted offer (`dispatch.server.ts`) | Selected driver; in-app/push, not critical SMS | `ride_offer` | `ride_offer` | Utility; high-frequency operational alert. Send only to opted-in drivers and avoid redundant alerts. |
| Dispatch publishes an open-board alert (`dispatch.server.ts`) | Nearby available drivers; in-app/push, not critical SMS | `ride_open` | `ride_open` | Utility; high-frequency operational alert. Consider keeping this push-only. |
| Driver accepts a ride (`driver.functions.ts`) | Customer receives assignment; driver receives acceptance confirmation | `driver_assigned`, `ride_accepted_driver` | `driver_assigned`, `ride_accepted_driver` | Utility. Assignment copy avoids falsely claiming immediate travel where the driver is finishing another trip. |
| Driver completes a previous ride and starts queued ride (`driver.functions.ts`) | Next customer; critical in-app/push/SMS | `driver_assigned` | `driver_assigned` | Utility; same generic assignment template as above. |
| Driver approaches / arrives (`driver.functions.ts`) | Customer; approaching is not critical, arrived is critical | `driver_arriving`, `driver_arrived` | `driver_approaching`, `driver_arrived` | Utility; frequent status changes should not be duplicated across channels. |
| Customer cancels an assigned ride (`rides.functions.ts`) | Driver; critical in-app/push/SMS | `ride_cancelled` | `ride_cancelled_by_customer` | Utility; separate draft because the same existing code is also used for a different audience/event. |
| Driver cancels (`driver.functions.ts`) | Customer; critical in-app/push/SMS | `ride_cancelled` | `ride_cancelled_by_driver` | Utility; says another taxi can be requested at no charge, matching current copy. |
| Ride is completed (`driver.functions.ts`) | Customer; critical in-app/push/SMS, followed by detailed email receipt and milestone check | `trip_completed`; email `trip_receipt` | `trip_completed`; canonical `trip_receipt` | Utility. The app also sends a trip receipt from payment settlement; see audit finding below before wiring WhatsApp to avoid duplicate receipts. |
| Payment settles (`payments.server.ts`, reached by callback or scheduled reconciliation) | Customer; critical in-app/push/SMS, plus email receipt | `payment_confirmed`; email `trip_receipt` | `payment_confirmed`; canonical `trip_receipt` | Utility; include the provider receipt only when a real receipt value exists. |
| Driver/platform dues settle (`payments.server.ts`) | Driver/actor; in-app/push, not critical SMS | `dues_settled` | `dues_settled` | Utility; payment-specific confirmation. |
| Customer submits a hire request (`hire.functions.ts`) | Requester; critical in-app/push/SMS | `hire_quote_submitted` | `hire_request_submitted` | Utility; request-specific estimate and duration. |
| Ops updates hire quote status (`hire.functions.ts`) | Requester; critical in-app/push/SMS | `hire_quote_submitted`, `hire_quote_quoted`, `hire_quote_confirmed`, `hire_quote_declined` | `hire_quote_update`, `hire_quote_unavailable` | Utility; `submitted`/`quoted`/`confirmed` map to status update; `declined` maps to unavailable. Arbitrary admin notes are intentionally excluded from a fixed template. |
| Owner/provider submits a hire offer (`hire.functions.ts`) | Requester; critical in-app/push/SMS | `hire_offer_received` | `hire_offer_received` | Utility; offer and request reference are specific. |
| Requester accepts or declines an offer (`hire.functions.ts`) | Offer-making owner/provider; critical in-app/push/SMS | `hire_offer_accepted`, `hire_offer_declined` | `hire_offer_accepted`, `hire_offer_declined` | Utility; two outcomes need distinct wording. |
| Admin reviews a driver (`admin.functions.ts`) | Driver; critical in-app/push/SMS | `driver_review` | `driver_application_update` | Utility; status is dynamic. Review notes are left in-app rather than placed in a freeform template parameter. |
| Phone login or phone verification requests an OTP (`phone-auth.functions.ts`, `otp.functions.ts`) | Phone owner; transactional SMS now, and sometimes email | `phone_login`, `phone_verification` | `verification_code` | Authentication; one Meta-authentication template can serve both OTP journeys. Use the fixed authentication format, not an ordinary utility template. Current code validity is 5 minutes. |
| Customer completes trip 20 (`milestones.server.ts`) | Customer; direct SMS and email | `milestone_thanks` | `trip_milestone_thanks` | Drafted as **marketing** (relationship-building content may be categorized as marketing). Do not send without the corresponding WhatsApp opt-in/marketing preference. |

### Message paths reviewed but not represented as active events

- `email-templates.server.ts` defines `welcome`, `ride_confirmed`, `payment_receipt`, `ride_cancelled`, `support_reply`, `driver_onboarding`, and `phone_verification` email renderers. A search found no active callsites for several of these definitions; this pack maps active send paths rather than inventing triggers for dormant templates.
- `emailReceipt()` currently renders a generic `support_reply` email but has no callsite in the reviewed repository.
- `sendBulkSms()` is a privileged, freeform SMS campaign tool. Arbitrary bulk content cannot safely be represented by one generic WhatsApp template; each WhatsApp campaign must have a specific purpose, category, reviewed copy, and appropriate consent.
- No database trigger creates a notification. SQL triggers found are timestamp/bookkeeping or hire-overlap constraints. There is a cron-authenticated payment reconciliation endpoint, but the calling schedule/cadence is external to this repository. Payment callbacks and reconciliation can both reach the payment settlement/notification path.

## Audit findings and recommended implementation gates

1. **No WhatsApp capability exists yet (blocking).** There is no WhatsApp provider adapter, sender configuration, template-name registry, webhook/status handling, or `whatsapp` channel in the communication log. A connector/config scan found no enabled WhatsApp messaging provider. The JSON below is a draft request set, not proof of submission or approval.
2. **Consent and preferences need a product/data change before sending.** `notification_preferences` currently has only SMS, email, and push flags; it has no WhatsApp opt-in timestamp/source/scope or WhatsApp preference. Meta requires opt-in before messaging, clear business identity, and compliant local-law permissions. Add a consent capture and auditable opt-out path; do not infer consent from a saved phone number or SMS permission.
3. **Verify WhatsApp number ownership.** OTP flows currently verify a mobile number through SMS; no WhatsApp-number verification state is modeled. Meta recommends confirming the number before delivering authentication codes there. Choose and explain the OTP channel to the user.
4. **Possible duplicate trip receipts.** `driver.functions.ts` sends a trip receipt at completion with `trip-receipt:${ride.id}`; `payments.server.ts` also sends one on payment confirmation with `payment-receipt:${tx.id}`. These distinct idempotency keys can permit two receipts for one ride. Select a canonical receipt event (or deliberately distinguish trip summary from payment receipt) before mirroring either to WhatsApp.
5. **Cancellation event code conflates two opposite audiences.** Customer-cancelled-to-driver and driver-cancelled-to-customer both use `ride_cancelled`. Give them distinct event identifiers before template dispatch to avoid choosing the wrong copy.
6. **Some preference flags are not consistently enforced.** `notify()` checks `sms_enabled` before its critical SMS, and push checks `push_enabled`. Direct milestone SMS is sent outside `notify()` without checking `sms_enabled`; email send helpers similarly do not consult `email_enabled`. Decide whether these settings are intended to govern those direct messages, and enforce the desired semantics consistently. Authentication/security messages may require separate treatment.
7. **High-frequency messages should be selective.** Dispatch offers, open-board alerts, driver approaching/arrived, and ride assignment may produce multiple messages close together. Prefer push/in-app for realtime activity and WhatsApp only for opted-in, user-important state changes; deduplicate per ride/event.
8. **Dynamic admin notes and freeform campaigns are not in fixed templates.** Do not insert arbitrary text into an approved template. Link users to the app for the note/details; create separately reviewed, purpose-specific templates for any future campaigns.

## Template draft files

- [`whatsapp-template-api-payloads.json`](./whatsapp-template-api-payloads.json) — 22 template request payloads, with names, `en_GB`, category, exact body text, named parameters and realistic examples; OTP uses Meta's authentication component format. These are **not submitted**.
- Review each message, intended audience, category, variable/value mapping, and whether WhatsApp is an appropriate channel before approving.

## Meta review and sending checklist

- Confirm the business display name is **Twende Meru Rides** and that the WhatsApp Business Account/phone number is controlled by the business.
- Obtain an affirmative, recorded opt-in that identifies the business and message scope; honor opt-outs. Keep service updates and marketing/relationship messages distinguishable.
- Submit each draft to WhatsApp Manager/Cloud API only after content approval. Meta automatically reviews templates and may reject or recategorize them; status must be `APPROVED` before sending.
- Keep the auth message in Meta's special authentication category with its fixed OTP body, security recommendation, five-minute expiry footer, and copy-code button. Do not put marketing copy or a URL in it.
- Before enabling sends, wire a provider adapter, stable template-code-to-name mapping, variables, idempotency, permission checks, delivery-status webhooks/logs, retry handling, and an environment gate. Test on an opted-in test number first.
- Utility templates are non-promotional and tied to a specific request/account/transaction. The milestone message is separated as marketing because Meta can classify customer-relationship messages as marketing. Meta's final category decision controls.

## Official references

- [Meta — Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview) (updated 21 May 2026): categories, name format, languages, named parameters, and approval status.
- [Meta — Template categorization](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/template-categorization) (updated 15 September 2026): utility must be non-promotional and tied to a user action/request or be critical; mixed/relationship content can be marketing.
- [Meta — Utility templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/utility-templates/utility-templates) (updated 17 June 2026): supported components and API shape.
- [Meta — Authentication templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/authentication-templates) (updated 17 June 2026): OTP preset text and authentication guidance.
- [Meta — Copy-code authentication templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/authentication-templates/copy-code-button-authentication-templates) (updated 24 June 2026): copy-code API components and expiry constraints.
- [Meta — Supported template languages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages) (updated 21 May 2026): `en_GB` is supported.
- [Meta — Getting opt-in](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in) (updated 16 June 2026): opt-in, business identity, and user-expectation guidance.
