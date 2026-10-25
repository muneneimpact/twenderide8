/** Pure booking rules shared by server and UI. */

const HOUR = 3_600_000;

/**
 * An owner/driver may decline a booked hire after due diligence when:
 * - pickup is at least 12 hours away, or
 * - the booking was made with less than 12 hours to pickup, and they decline
 *   within 3 hours of the booking being made (and before pickup).
 */
export function canOwnerDecline(input: { startAt: Date; bookedAt: Date; now?: Date }): boolean {
  const now = input.now ?? new Date();
  const toPickup = input.startAt.getTime() - now.getTime();
  if (toPickup <= 0) return false;
  if (toPickup >= 12 * HOUR) return true;
  const bookedLead = input.startAt.getTime() - input.bookedAt.getTime();
  if (bookedLead >= 12 * HOUR) return false;
  return now.getTime() - input.bookedAt.getTime() <= 3 * HOUR;
}

const FREE_MAIL = new Set([
  "gmail.com",
  "yahoo.com",
  "yahoo.co.uk",
  "hotmail.com",
  "outlook.com",
  "live.com",
  "icloud.com",
  "aol.com",
  "proton.me",
  "protonmail.com",
  "gmx.com",
  "mail.com",
  "ymail.com",
]);

/** Business emails look like name@company.tld (com, org, co.ke, ac.ke, go.ke …), not free mail. */
export function isBusinessEmail(email: string): boolean {
  const m = /^[a-z0-9._%+-]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i.exec(email.trim());
  if (!m) return false;
  const domain = m[1]!.toLowerCase();
  if (FREE_MAIL.has(domain)) return false;
  return /\.[a-z]{2,}$/.test(domain);
}

/** Daily included mileage and excess rate for car hire. */
export const HIRE_INCLUDED_KM_PER_DAY = 300;
export const HIRE_EXCESS_KM_RATE = 30;

const FUEL_LEVEL_PERCENT: Record<string, number> = {
  full: 100,
  "3/4": 75,
  "1/2": 50,
  "1/4": 25,
  reserve: 0,
  empty: 0,
};

/** Fuel gauge levels use the labels shown in pickup/return inspection screens. */
export function fuelLevelPercent(level: string | null | undefined): number | null {
  if (!level) return null;
  return FUEL_LEVEL_PERCENT[level.trim().toLowerCase()] ?? null;
}

export function calculateFuelShortfall(
  pickup: string | null | undefined,
  returned: string | null | undefined,
) {
  const pickupPercent = fuelLevelPercent(pickup);
  const returnPercent = fuelLevelPercent(returned);
  if (pickupPercent == null || returnPercent == null) return null;
  return Math.max(0, pickupPercent - returnPercent);
}

/** Split the refundable deposit at return: what is kept, returned, and still owed. */
export function settleHireReturn(input: {
  deposit: number;
  days: number;
  kmDriven: number;
  fuelCharge: number;
  penalties: number;
  waiveExcessKm?: boolean;
  waiveFuel?: boolean;
}) {
  const allowance = HIRE_INCLUDED_KM_PER_DAY * Math.max(1, input.days);
  const excessKm = Math.max(0, Math.round(input.kmDriven - allowance));
  const excessCharge = input.waiveExcessKm ? 0 : excessKm * HIRE_EXCESS_KM_RATE;
  const fuelCharge = input.waiveFuel ? 0 : Math.max(0, input.fuelCharge);
  const deductions = excessCharge + fuelCharge + Math.max(0, input.penalties);
  const deposit = Math.max(0, input.deposit);
  const kept = Math.min(deposit, deductions);
  return {
    allowance,
    excessKm,
    excessCharge,
    fuelCharge,
    deductions,
    kept,
    returned: deposit - kept,
    balanceDue: deductions - kept,
  };
}
