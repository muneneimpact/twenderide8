# Corporate car hire: date blocking, pay-later, KYC, multi-booking

## The bugs found

1. **Company pay-later bookings don't block dates.** The double-booking guard only blocks dates when a booking is paid or has a live 1-hour payment hold. Company pay-later bookings are saved with no hold and no payment, so the same car can be booked again for the same days.
2. **Pay-later bookings are confirmed instantly** with no owner check, and owners can't opt out.
3. **No company KYC** — businesses never submit registration documents, and nothing is saved for future hires.

## What will change

### 1. Dates are blocked for company bookings (migration + listing fix)
- Update the double-booking guard so a **confirmed pay-later booking blocks its dates** just like a paid one.
- Show those dates as "Booked" on the car's calendar and in the owner's booking calendar, so companies see the real availability before picking dates.

### 2. Owner opt-in for company pay-later
- New setting per car: **"Allow verified companies to pay later"** (off by default) in the owner's car listing form.
- When a company picks "Pay later" on a car whose owner hasn't allowed it, the booking is refused with: *"This owner allows immediate payments only — pay now by M-PESA."* The pay-later option is also greyed out on that car with the same note.
- Owners and their assigned drivers get a switch in their hire settings to turn this on or off per car.

### 3. Company KYC documents, saved for future hires
- Companies must upload **business documents** (certificate of registration, KRA PIN certificate, CR12/directors list — at least one required) before a pay-later booking is accepted.
- A "Save these documents for future hires" tick (on by default) stores them on the company account, like the existing ID/licence saving. Next hire, they're pre-filled.
- The owner sees the company's documents (private, time-limited links) on the booking.

### 4. Owner verifies the company, then the booking holds
- New flow: company submits pay-later booking → status **"Waiting for owner verification"** → owner sees it in Bookings & handovers with the KYC documents and the signed terms, and taps **"Verify company & confirm"** or **Decline**.
- Only after the owner confirms do the dates become blocked and the booking is confirmed. The company gets an SMS either way.
- Owner decline window rules stay as they are.

### 5. Multi-booking for companies
- After a company books, the page shows success and a **"Book another car"** button that keeps all company details, KYC documents and verified email, and clears only the car and dates — so they can book several cars quickly.
- Each booking goes to **sign the agreement** right after booking (the agreement screen opens automatically), and the signature is saved to the account for reuse.

### 6. Agreement PDF downloadable only after the hire is done
- The agreement can be viewed and signed any time after booking, but the **Download PDF** button unlocks only once the car is returned (hire completed). Until then it shows "Available after the hire is completed."

### 7. Payments unified on the new system
- Company pay-later bookings now use the **same payment system as everything else**: the owner can send an M-PESA payment request from the booking (any amount up to the balance), the company pays in the app, and every payment gets a receipt, owner earnings and commission — no more separate legacy handling.
- When the pay-later due date passes with a balance still open, the company gets an SMS reminder (daily, max 3), and the owner sees "Overdue" on the booking.

## Technical notes
- Migration `0007_corporate_hire_kyc_paylater`: recreate `prevent_hire_overlap` to also block confirmed pay-later rows; add `vehicles.hire_pay_later_allowed boolean not null default false`; new table `public.business_kyc_documents` (user_id, document_kind, file_path, saved_for_future, timestamps) with RLS (owner read/write own, staff read all) + grants; add `hire_quotes.company_verified_at/company_verified_by`.
- New server functions: `saveBusinessKycDocument`, `getMyBusinessKyc`, `ownerConfirmCompanyBooking` (in hire-owner.functions.ts); extend `requestHirePaymentReminder` to confirmed pay-later bookings.
- UI: `HireVehicleManager` pay-later toggle; `hire.tsx` KYC upload + multi-booking reset + agreement redirect + per-car pay-later gating; `OwnerHireBookings` verify/decline + KYC links + payment request on pay-later; agreement route locks PDF download until `returned_at`.
- Payment reminders for overdue pay-later reuse the existing SMS/payment infrastructure (no new cron; reminder is owner-triggered + due-date SMS via existing notification path).

## Not in scope
- Platform-level (Twende staff) company verification badge — owner verification only, per the request.
- Changing ride (non-hire) payments — "shift to this from the older" is applied to corporate hire payments.
