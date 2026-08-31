# Backend catch-up for the latest code

I compared the current code with the live database. The new front-end work (promotions, customer account, support workflows) is in place, but several pieces it depends on do not exist in the backend yet — so those screens run on placeholder data or would fail at runtime.

## What is missing today (verified)

- **Promotions table does not exist.** `listPromotions`, `savePromotion`, `togglePromotion`, `deletePromotion`, `validatePromoCode` and the booking quote all read/write a `promotions` table. The database has 38 tables and none of them is `promotions`, so every promo action fails and the admin Pricing → Promotions tab cannot save.
- **No promo redemption tracking.** The code reads `usage_count` and enforces `usage_limit`, but nothing records or increments a redemption anywhere.
- **Support cases are entirely mock data.** `admin/support.tsx` and the Support section of `account.tsx` hold hard-coded arrays with notes that the server functions are still to be built. `comms_log` already has a `support_case_id` column pointing at a table that was never created; the only real table is `incidents`, which has no messaging or assignment-with-replies model.
- **Account preferences are not stored.** Payment preference and the driver-verification-code preference are kept in component state only; `profiles` has no columns for them.
- **Account promotions + activity feed are mock.** The page shows invented promos and an invented timeline rather than the customer's real offers, redemptions and ride/payment history.
- **Profile photo upload for customers** is a placeholder note on the account page (drivers already upload through the private documents bucket).

## Plan

### 1. Database migration
- `promotions` — code, name, description, discount_percent, max_discount_percent, max_discount_amount, min_fare, valid_from, valid_until, usage_limit, usage_count, applies_to, active, created_by, timestamps + updated-at trigger. Exact column set matches `PromoRow` in `src/lib/discounts.ts`. Read access for signed-in users limited to active codes; all writes staff-only; full access for backend jobs.
- `promotion_redemptions` — promotion, customer, ride, discount amount, timestamp; unique per promotion+ride. Customers read their own; staff read all.
- `support_cases` — customer, optional ride, subject, category, status (open / pending / resolved / closed), priority, assigned staff, timestamps.
- `support_messages` — case, sender, sender role (customer / agent / system), body, read flag, timestamp; realtime enabled so replies appear instantly on both sides.
- `profiles` gains `payment_preference` and `share_driver_code`.
- Every new table gets grants plus row-level rules: a customer only ever sees their own cases, messages and redemptions; operations staff see everything.

### 2. Server functions
- Increment `usage_count` and insert a redemption row when a ride is booked with a valid promo (idempotent per ride).
- `listMyPromotions` — active offers plus this customer's redemption history.
- `getAccountActivity` — merged feed of rides, status events, payments and support cases sorted newest first.
- `updateAccountPreferences` — persists payment preference, driver-code preference and avatar path.
- Support: `listSupportCases` (staff) / `listMyCases` (customer), `createSupportCase`, `postSupportMessage`, `setCaseStatus`, `assignCase` — all role-checked server-side.

### 3. Wire the screens
- `account.tsx`: replace the mock promo list, activity feed, support cases and preference toggles with the new server functions; add customer avatar upload; keep the existing saved-places behaviour and add editing.
- `admin/support.tsx`: replace mock cases with real data, persist status/assignment/replies, subscribe to realtime so agent and customer see each other's messages live.
- Drop the `as "profiles"` type casts in `admin.functions.ts` once the generated types include `promotions`.

### 4. Verify
- Typecheck and build, then a browser pass over admin promotions, the account page and the support thread on both sides.

## Notes
- Existing security-linter findings (one table with row-level security but no policy — the payment webhook event log, which is intentionally backend-only — and the SECURITY DEFINER execute warnings on helper functions) are unchanged by this work; I can tackle them separately if you want.
