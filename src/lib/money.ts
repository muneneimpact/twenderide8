/**
 * Fixed-precision money and percentage arithmetic for Twende Ride.
 *
 * All amounts are handled as bigint "micro units" (1 KES = 1_000_000 units) so
 * fare, commission, and ledger maths never depend on binary floating point.
 */

export const SCALE = 1_000_000n;

export type Units = bigint;

export function units(value: number | string): Units {
  const text = typeof value === "number" ? value.toString() : value.trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) throw new Error(`Invalid decimal value: ${text}`);
  const negative = text.startsWith("-");
  const parts = text.replace("-", "").split(".");
  const whole = parts[0] ?? "0";
  const fraction = parts[1] ?? "";
  const padded = (fraction + "000000").slice(0, 6);
  const result = BigInt(whole || "0") * SCALE + BigInt(padded || "0");
  return negative ? -result : result;
}

export function mulUnits(a: Units, b: Units): Units {
  return divRound(a * b, SCALE);
}

/** Half-up rounding division that keeps sign semantics. */
export function divRound(numerator: bigint, denominator: bigint): bigint {
  if (denominator === 0n) throw new Error("Division by zero");
  const negative = numerator < 0n !== denominator < 0n;
  const n = numerator < 0n ? -numerator : numerator;
  const d = denominator < 0n ? -denominator : denominator;
  const q = n / d;
  const r = n % d;
  const rounded = r * 2n >= d ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** amount * percent / 100 with fixed precision. */
export function percentOf(amount: Units, percent: number | string): Units {
  return divRound(amount * units(percent), 100n * SCALE);
}

export function maxUnits(a: Units, b: Units): Units {
  return a > b ? a : b;
}

export function minUnits(a: Units, b: Units): Units {
  return a < b ? a : b;
}

/** Convert micro units to a Number with 2 decimals (safe for display and DB numeric). */
export function toAmount(value: Units): number {
  return Number(divRound(value, 10_000n)) / 100;
}

/** Round to 4 decimals, used to store the unrounded calculation. */
export function toPrecise(value: Units): number {
  return Number(divRound(value, 100n)) / 10_000;
}

export type RoundingRule = "none" | "nearest_1" | "nearest_5" | "nearest_10";

export function applyRounding(value: Units, rule: RoundingRule): Units {
  if (rule === "none") return value;
  const step = rule === "nearest_1" ? 1n : rule === "nearest_5" ? 5n : 10n;
  const stepUnits = step * SCALE;
  return divRound(value, stepUnits) * stepUnits;
}

export function formatKes(amount: number): string {
  return new Intl.NumberFormat("en-KE", {
    style: "currency",
    currency: "KES",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatKesShort(amount: number): string {
  return `KES ${new Intl.NumberFormat("en-KE", { maximumFractionDigits: 0 }).format(amount)}`;
}
