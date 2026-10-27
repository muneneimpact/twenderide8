<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Provision founding administrators only through privileged maintenance; the public bootstrap route stays disabled to prevent unauthorized account creation and credential resets.
- Driver applications must record acceptance of the current DRIVER_AGREEMENT_VERSION server-side (driver_agreement_acceptances); bump the version when agreement text changes so drivers re-accept.
- Outgoing SMS action links are built with src/lib/links.server.ts (appLink/textUserWithLink) so every message points at the published app screen to act on.
- Customer wallet money moves only through the customer_wallet_move DB function (locked, idempotent, splits promo vs refundable cash); M-PESA wallet intents are recognised by idempotency_key prefixes wtopup:/fundauth: in payments.server.
- Wallet spending (rides, car hire) must pass assertWalletPin (src/lib/wallet-pin.server.ts); PIN changes only via phone OTP — keeps stolen sessions from draining wallets.
- Dispatch order uses rankByEtaAndRating (src/lib/dispatch-rank.ts): ETA first, rating as a small tie-break bonus — closeness must stay dominant.
- Lost & found photos live privately in driver-documents/lost-found/; never return them or driver descriptions to passengers (blind claim).
- Company detail autosaves use the shared company-profile schema and authenticated account storage; serialize saves and preserve newer edits so refetches cannot overwrite typing.
- Brand photos are resized in the browser before account saving so camera uploads fit the existing server payload limits and remain persistent.
