# Twende Ride Owner Experience Plan

## Approved scope

Build the approved owner-first experience without changing the two public home choices: **Get a ride** and **Car hire** remain the primary buttons. The owner interest flow stays team-assisted: Twende Operations contacts the owner and helps complete the remaining onboarding.

Deliver a dedicated signed-in Owner Hub, stronger owner positioning, public owner storefront improvements, OG/social preview metadata, owner marketing text generation capped at one generated post per owner per calendar month, QR codes for each generated sharing text with a Twende-branded centre mark, and referral parameter capture.

Owner public pages must not collect or expose owner WhatsApp numbers or owner contact emails. No owner-facing "Ask about this car", "WhatsApp the hire team", or "Check availability" contact actions are added. Existing secure booking and date selection remain the conversion path. Any future poster/image creation packages are out of scope for this implementation and may be invoiced separately later.

## Implementation approach

- Add an authenticated `/owner` route that assembles the existing hire-owner components into an Owner Hub rather than using `/driver` as the primary owner destination.
- Extend the authenticated identity response with managed hire vehicles and expose an `isHireOwner` capability to navigation.
- Add an Owner Hub navigation item and update the account entry point to route owners to `/owner`.
- Add a monthly AI-generation usage table and enforce the one-post-per-calendar-month limit server-side before calling the AI gateway. Store the generated share texts on the owner brand record.
- Add a client-only referral capture effect in the root route. A `ref` query parameter is saved as `traffic_ref` for 30 days, with an expiry timestamp.
- Generate tracked owner-page links with channel-specific `ref` values. Render QR codes client-side and place the Twende logo in the centre; provide per-text copy and PNG download actions.
- Add a storefront OG image using the first available approved vehicle image, with the Twende logo as fallback. Keep public page CTAs limited to browse, car details, dates/book securely and the existing platform trust messaging.
- Add the route manifest for all page routes and keep it synchronized with the new `/owner` route.

## Project structure

- `src/routes/_authenticated/owner.tsx`: Owner Hub shell and section navigation.
- `src/components/OwnerHub.tsx`: reusable Owner Hub dashboard composition and personalized owner guidance.
- `src/components/HireOwnerPageControls.tsx`: owner brand form, monthly marketing post generator, tracked links and QR tools.
- `src/lib/account.functions.ts` and `src/hooks/useMe.ts`: hire-owner capability detection.
- `src/lib/hire-marketing.functions.ts`: server-side monthly quota and structured share-post generation.
- `src/lib/traffic-ref.ts` and `src/routes/__root.tsx`: 30-day referral capture.
- `src/routes/$brandSlug.tsx`: public owner storefront OG metadata and trust copy.
- `drizzle/migrations/0016_owner_marketing_posts_and_usage.sql`: persisted generated posts and monthly usage limit.
- `public/manus-routes.json`: page route declarations.

## Design

### Alternative styles considered

- Mobile-first owner command centre with bold trust panels — 0.06
- Editorial local marketplace storefront — 0.04
- Minimal finance dashboard with utility-first cards — 0.08

### Chosen design movement

Mobile-first owner command centre with bold trust panels, using the existing Twende green, sky and warm coral system.

### Core principles

1. Make the owner's next useful action obvious.
2. Use plain operational language instead of internal workflow labels.
3. Keep Twende as the safety and payment trust layer while giving the owner a recognizable storefront.
4. Treat every share link as a measurable marketing asset.

### Color philosophy

Twende green signals dependable operations and secure payment. Sky blue separates car-hire discovery from ride booking. Warm coral highlights owner opportunity and action without changing the existing public brand hierarchy.

### Layout paradigm

A compact dashboard with an action-first top panel followed by a two-column desktop workspace and stacked mobile sections. Public storefronts retain their existing editorial hero and card layout.

### Signature elements

- “Your cars are ready to earn” owner headline.
- Action-needed cards with clear next-step buttons.
- Small tracked-link QR cards with a Twende logo mark in the centre.

### Interaction and animation

Use existing rounded cards, subtle hover/active transitions and no new distracting motion. QR generation, copy and download actions should provide short inline success feedback.

### Typography

Keep Plus Jakarta Sans and the existing display hierarchy. Use large, compact numeric emphasis for owner earnings and short bold labels for actions.

### Brand essence and voice

Twende is a secure local operating and marketing platform for Kenyan car owners who want to earn from their vehicles with help from a real operations team. Voice: practical, encouraging, trustworthy.

Example lines:

- “Your cars are ready to earn.”
- “Share one link. Let Twende handle the booking and payment journey.”

### Wordmark and logo

Keep the existing Twende Meru logo assets. Use the existing logo as the QR centre mark and as the public storefront fallback OG image.

### Signature brand color

Twende green remains the ownable action and trust color; sky blue stays the hire-discovery accent.
