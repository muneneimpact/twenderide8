/** Pure Twende wallet rules (shared by server code and tests). */

/** The phone that must approve every admin wallet funding batch. */
export const WALLET_FUNDING_APPROVER_PHONE = "0723175181";
/** The approval M-PESA prompt is exactly KES 1. */
export const FUNDING_APPROVAL_AMOUNT = 1;
export const FUNDING_CODE_TTL_MINUTES = 10;
export const FUNDING_CODE_MAX_ATTEMPTS = 5;
export const FUNDING_MAX_PER_USER = 5000;
export const FUNDING_MAX_BATCH_TOTAL = 200000;
export const TOPUP_MIN = 10;
export const TOPUP_MAX = 70000;

export interface WalletEntryLike {
  amount: number | string;
  status: string;
  refundable?: boolean | null;
}

/** Cash = refundable money (top-ups, paid rides with no driver). Promo = rides/hire only. */
export function walletBalances(rows: WalletEntryLike[]) {
  let cash = 0;
  let promo = 0;
  for (const r of rows) {
    if (r.status === "rejected") continue;
    if (r.refundable === false) promo += Number(r.amount);
    else cash += Number(r.amount);
  }
  const round = (n: number) => Number(n.toFixed(2));
  return { cash: round(cash), promo: round(promo), total: round(cash + promo) };
}

/** Spending uses promo credit first, then cash. */
export function splitSpend(cash: number, promo: number, need: number) {
  if (cash + promo < need) throw new Error("Not enough wallet balance.");
  const fromPromo = Math.min(Math.max(promo, 0), need);
  return { fromPromo, fromCash: Number((need - fromPromo).toFixed(2)) };
}

/** Wallet-only promo: bonus credit for topping up at least `minTopup`. */
export function topupBonus(amount: number, cfg: { percent: number; minTopup: number; cap: number }) {
  if (cfg.percent <= 0 || amount < cfg.minTopup) return 0;
  return Math.min(cfg.cap > 0 ? cfg.cap : Infinity, Math.floor((amount * cfg.percent) / 100));
}
