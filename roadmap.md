# Roadmap

## Done this round
- Hire page split: /hire clean browse, /hire/bookings (requests + company bookings + payments), /hire/company (company KYC registration, editable, cross-device).
- ETR requests missing company details now link straight to /hire/company.
- Company KYC edit trail (business_kyc_edits) logged on every change; staff see it on the Finance page.
- Car Hire dock tab bold and emphasized like Book.

## Verified (no change needed)
- M-PESA payments are only marked paid on a provider SUCCESS — via the token-verified callback or a direct server-side status check with the provider. No client claim can mark paid.
- Driver "Confirm cash collected" already exists for cash rides (driver page, during the trip).

## Open from earlier
- Wallet cohort multi-select (tags + select-all) for admin funding — awaiting go-ahead.
- Unpaid company bookings blocking dates: HQ-69F55911, HQ-6829680D; HQ-96D5350F partially paid.
- App not published — M-PESA callbacks still target the old address until publish.
- NEW: Companies can book rides for their people (staff ride bookings billed to the company).
