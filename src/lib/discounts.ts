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
