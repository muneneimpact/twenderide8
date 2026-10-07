# WhatsApp Admin Inbox — Setup and Operating Notes

## What is included

The Ops WhatsApp page stores inbound messages and Meta delivery receipts, keeps a conversation history, tracks unread messages, and sends free-form text replies while the 24-hour customer-service window is open. Access is restricted to `ops_admin` and `super_admin`. The inbox tables are not directly accessible to browser users; authenticated server functions and the signed Meta webhook use the service role.

The customer-facing hire flow shows each vehicle's unavailable booking dates and disables start dates whose requested hire duration overlaps a pending, quoted, or confirmed booking. A confirmed rental removes the car from driver dispatch and nearby rider supply; database guards also block starting a ride assignment or going online with a currently hired vehicle. The driver console displays the return time. A rental does not interrupt a ride already in progress.

## Meta Cloud API configuration

Set these as **server-side deployment secrets**, never as browser/Vite variables:

| Variable                     | Purpose                                                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `WHATSAPP_ACCESS_TOKEN`      | Meta Cloud API bearer token for outgoing messages and future media retrieval                                                          |
| `WHATSAPP_PHONE_NUMBER_ID`   | Phone number ID used by the `/messages` endpoint                                                                                      |
| `WHATSAPP_GRAPH_API_VERSION` | Graph API version such as `v26.0`; set a currently supported version before production and update it before Meta retires that version |
| `WHATSAPP_APP_SECRET`        | Meta app secret used to verify `X-Hub-Signature-256` on webhook POSTs                                                                 |
| `WHATSAPP_VERIFY_TOKEN`      | Random verification string configured in Meta and checked during webhook subscription                                                 |

Configure the HTTPS callback URL as `https://<deployed-app-host>/api/public/whatsapp/webhook`, enter the same verification token, and subscribe the WhatsApp Business Account to the `messages` webhook field. The GET handshake echoes the verified challenge; POST requests are HMAC-verified against the raw request body. The callback returns an error when required secrets are absent rather than accepting unsigned events.

The inbox page shows whether sending and webhook verification are configured, but never shows secret values. Apply the migration in `supabase/migrations/20261008090000_whatsapp_inbox_and_hire_lockout.sql` before opening the page.

## Sending rules and template gate

Meta's Cloud API allows free-form service replies only within the 24-hour customer-service window following the customer's message. The composer is disabled when that window has closed. Restarting the conversation then requires an approved WhatsApp message template and applicable user opt-in. The repository's template documents remain drafts for review; this inbox does **not** submit templates to Meta or send templates before approval.

Official references: [Meta send messages](https://developers.facebook.com/documentation/business-messaging/whatsapp/messages/send-messages), [webhook endpoint setup](https://developers.facebook.com/documentation/business-messaging/whatsapp/webhooks/create-webhook-endpoint/), and [template overview](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview).

## Message retention and media

Text messages, phone, display name (when supplied by WhatsApp), message type, provider IDs, delivery state, and relevant media reference metadata are stored in the WhatsApp inbox tables. Image/audio/video/document binaries are not downloaded; the thread shows an explanatory placeholder and stores the provider reference. Add a controlled media download/storage flow before relying on the app as an attachment archive.
