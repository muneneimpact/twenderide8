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
  "gmail.com", "yahoo.com", "yahoo.co.uk", "hotmail.com", "outlook.com", "live.com",
  "icloud.com", "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "ymail.com",
]);

/** Business emails look like name@company.tld (com, org, co.ke, ac.ke, go.ke …), not free mail. */
export function isBusinessEmail(email: string): boolean {
  const m = /^[a-z0-9._%+-]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i.exec(email.trim());
  if (!m) return false;
  const domain = m[1]!.toLowerCase();
  if (FREE_MAIL.has(domain)) return false;
  return /\.[a-z]{2,}$/.test(domain);
}
