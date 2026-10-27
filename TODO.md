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

## Validation

- [x] Run the project build and lint/type diagnostics after implementation. The production build and `npx tsc --noEmit` pass. Repository-wide `npm run lint` remains blocked by 7,100+ pre-existing Prettier errors in untouched files.
- [x] Confirm `/manus-routes.json` includes all page routes, including `/owner`.
