/**
 * Occasional customer discounts.
 *
 * The draw is deterministic for a customer + vehicle class + calendar day, so
 * the price a customer sees on the comparison cards is exactly the price they
 * are quoted and charged. It never depends on the browser.
 */

function hash(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i += 1) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967295;
}

export function nairobiDayKey(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Nairobi" }).format(now);
}

export interface CustomerDiscount {
  percent: number;
  label: string;
}

/** Returns a discount of 5–maxPercent %, or null when the customer misses out today. */
export function drawDiscount(
  seed: string,
  maxPercent = 20,
  chancePercent = 35,
): CustomerDiscount | null {
  const capped = Math.max(0, Math.min(50, maxPercent));
  if (capped < 5) return null;
  if (hash(`chance:${seed}`) * 100 >= Math.max(0, Math.min(100, chancePercent))) return null;
  const steps = Math.floor(capped / 5);
  const step = 1 + Math.floor(hash(`size:${seed}`) * steps);
  const percent = Math.min(capped, step * 5);
  return { percent, label: `${percent}% off — today's Twende treat` };
}

export interface DiscountedTotal {
  discount_percent: number;
  discount_amount: number;
  total_before_discount: number;
  total_fare: number;
}

export function applyDiscount(total: number, percent: number): DiscountedTotal {
  const amount = Math.round(total * percent) / 100;
  return {
    discount_percent: percent,
    discount_amount: Number(amount.toFixed(2)),
    total_before_discount: Number(total.toFixed(2)),
    total_fare: Number(Math.max(0, total - amount).toFixed(2)),
  };
}

/* ------------------------------ PROMOTIONS ------------------------------ */

export type PromoState = "active" | "expired" | "not_started" | "usage_exhausted" | "invalid";

export interface PromoRow {
  id: string;
  code: string;
  name: string;
  description: string | null;
  discount_percent: number;
  max_discount_percent: number;
  max_discount_amount: number | null;
  min_fare: number | null;
  valid_from: string;
  valid_until: string | null;
  usage_limit: number | null;
  usage_count: number;
  applies_to: string[];
  active: boolean;
}

/**
 * Server-side state check for a promo. The browser can render the labels, but
 * the server is the only authority that decides whether a code may be used.
 */
export function promoState(
  promo: Pick<PromoRow, "active" | "valid_from" | "valid_until" | "usage_limit" | "usage_count">,
  now = new Date(),
): PromoState {
  if (!promo.active) return "invalid";
  if (now < new Date(promo.valid_from)) return "not_started";
  if (promo.valid_until && now > new Date(promo.valid_until)) return "expired";
  if (promo.usage_limit !== null && promo.usage_count >= promo.usage_limit) return "usage_exhausted";
  return "active";
}

/**
 * Applies a promo to a fare, honouring both the offer's percentage cap and its
 * optional absolute cap. The effective discount is the smallest of the
 * headline percent, the configured max percent, and any KES cap.
 */
export function applyPromo(
  total: number,
  promo: Pick<
    PromoRow,
    "discount_percent" | "max_discount_percent" | "max_discount_amount" | "min_fare"
  >,
): { discount_percent: number; discount_amount: number; total_fare: number; blocked_min_fare: boolean } {
  if (promo.min_fare !== null && total < promo.min_fare) {
    return { discount_percent: 0, discount_amount: 0, total_fare: total, blocked_min_fare: true };
  }
  const headline = Math.max(0, Number(promo.discount_percent));
  const capPercent = Math.max(0, Math.min(100, Number(promo.max_discount_percent)));
  const effectivePercent = Math.min(headline, capPercent);
  let amount = Math.round(total * effectivePercent) / 100;
  if (promo.max_discount_amount !== null) {
    amount = Math.min(amount, Number(promo.max_discount_amount));
  }
  return {
    discount_percent: effectivePercent,
    discount_amount: Number(amount.toFixed(2)),
    total_fare: Number(Math.max(0, total - amount).toFixed(2)),
    blocked_min_fare: false,
  };
}
