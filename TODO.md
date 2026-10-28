# Twende Ride Owner Experience TODO

## Owner Hub and team-assisted positioning

- [x] Keep the public home page's two primary buttons unchanged: **Get a ride** and **Car hire**.
- [x] Keep the owner interest route team-assisted: the owner submits a short introduction and Twende Operations contacts them and helps complete the remaining onboarding.
- [x] Add an authenticated `/owner` Owner Hub that reuses the existing owner hire components and presents a personalized greeting, owner actions, vehicles, bookings, finances, documents and storefront tools.
- [x] Add Owner Hub navigation for accounts that manage hire vehicles or fleets, and route the account's “Manage hire vehicles” entry to `/owner`.

## Public owner storefront

- [x] Keep owner public pages free of owner WhatsApp numbers and owner contact emails.
- [x] Do not add “Ask about this car”, “WhatsApp the hire team”, or “Check availability” contact actions; retain secure Twende booking and date selection as the conversion path.
- [x] Add a social preview image using the first available approved vehicle image, with the Twende logo as fallback.
- [x] Keep the public page's Twende trust messaging and existing browse, details and booking actions.

## Owner marketing and QR tracking

- [x] Allow one generated owner marketing post per owner per calendar month, enforced server-side.
- [x] Store the generated sharing texts on the owner's brand record so they remain available after refresh or device change.
- [x] Do not create poster/image packages in this implementation; future poster/image creation packages remain a separate invoiced offering.
- [x] Give the owner a tracked link parameter for each sharing text/channel and a QR code for each text.
- [x] Put a Twende logo mark in the centre of each generated QR code and provide copy/download actions.

## Referral capture

- [x] On landing, read `ref` from `window.location.search`.
- [x] If `ref` exists, save it as `traffic_ref` in local storage for 30 days, with an expiry timestamp and safe expiry cleanup.
- [x] Generate owner marketing links using channel-specific `ref` values so the captured parameter can distinguish sources.

## Owner, driver, admin and hire workflow improvements

- [x] Remove Hire cars from the driver navigation and keep the Drive console focused on ride work.
- [x] Move owner driver assignment and onboarding into the Owner Hub, with plain-English guidance for ID, certificate of good conduct and driving licence.
- [x] Keep owner documents and vehicle compliance visible as separate operational concepts; vehicle document records remain tied to the selected car.
- [x] Replace user-facing “chauffeured” labels with “with a driver” where the customer or owner is choosing a service.
- [x] Consolidate hire fee visibility into the owner balance summary; booking cards show payment status and owner earnings rather than repeating platform-fee language.
- [x] Keep payment reminders connected to the verified M-Pesa flow so balances change only after successful settlement, and retain full-balance payment for customers.
- [x] Make unsigned agreements visibly pending and tell hirers to read the agreement carefully before signing.
- [x] Keep handover odometer, fuel and photo capture in the agreement workflow, with the full photo gallery rendered in the agreement page.
- [x] Give the admin board the same command-centre framing as the Owner Hub while retaining existing approval, payment, document and incident actions.

## Validation

- [x] Run the project build and lint/type diagnostics after implementation. The production build and `npx tsc --noEmit` pass. Repository-wide `npm run lint` remains blocked by 7,100+ pre-existing Prettier errors in untouched files.
- [x] Confirm `/manus-routes.json` includes all page routes, including `/owner`.

## Step-by-step customer car-hire booking

- [x] On the car-hire booking page, show a progress bar and split the journey into manageable steps instead of asking for many details at once.
- [x] After a customer clicks a car, show its details before booking. Let them choose **Select this car** or go back to choose another car.
- [x] After the customer selects a car, show a calendar to choose the pickup and return dates and times.
- [x] If the selected car offers both hourly charter (taxi hire) and hire by the day, show a step after date/time selection where the customer chooses which service they need; take each choice to the suitable next step.
- [x] For hire by the day, let the customer choose **Drive it myself** or **With a driver** when the car supports both options; use common, clear wording.
- [x] Split renter contact details from pickup, trip and document details so customers do not have to complete all personal, location and upload fields on one page.
- [x] Move the customer to their details after the service and drive choices, and allow manual typing of the pickup location as well as place search/current location.
- [x] Give the customer a review/confirm-details step before starting the M-Pesa payment flow.
- [x] If the car owner's payment policy allows day-by-day payment, let the customer choose between paying the full booking total now and paying only the one-day minimum now; if the owner requires full payment, do not offer the one-day option. Enforce the amount from the server-side owner policy.
- [x] Preserve the selected first-payment option across M-Pesa retries, restart payment polling for each accepted retry, and prevent a second quote from being created after the first request is saved.
- [x] Reject a passenger count above the selected car's seats for both daily hire and hourly hire, in the customer form and on the server.
- [x] Keep hourly charter on its existing request-an-offer path, with clear notice that the customer reviews the owner's offer and pays through Twende after accepting it.
