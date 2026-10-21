/** Wallet PIN checks (server-only). PINs are stored only as salted hashes. */
import { hashOtp, safeEqual } from "./otp.server";

export const PIN_MAX_TRIES = 5;
export const PIN_LOCK_MINUTES = 15;

export function validPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

export async function hashPin(pin: string, userId: string) {
  return hashOtp(`pin:${pin}`, userId);
}

/** Throws unless the caller has a PIN and typed it correctly. Locks after repeated misses. */
export async function assertWalletPin(userId: string, pin: string | undefined) {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: row } = await supabaseAdmin.from("customer_wallet_pins").select("*").eq("user_id", userId).maybeSingle();
  if (!row) throw new Error("Create your wallet PIN first.");
  if (row.locked_until && new Date(row.locked_until).getTime() > Date.now())
    throw new Error("Wallet PIN locked after too many wrong tries. Try later or reset it with your phone.");
  if (!pin || !validPin(pin)) throw new Error("Enter your 4-digit wallet PIN.");
  if (safeEqual(await hashPin(pin, userId), row.pin_hash)) {
    if (row.failed_attempts) await supabaseAdmin.from("customer_wallet_pins").update({ failed_attempts: 0, locked_until: null }).eq("user_id", userId);
    return;
  }
  const tries = row.failed_attempts + 1;
  await supabaseAdmin.from("customer_wallet_pins").update({
    failed_attempts: tries >= PIN_MAX_TRIES ? 0 : tries,
    locked_until: tries >= PIN_MAX_TRIES ? new Date(Date.now() + PIN_LOCK_MINUTES * 60_000).toISOString() : null,
  }).eq("user_id", userId);
  throw new Error(tries >= PIN_MAX_TRIES ? "Wrong PIN. Wallet locked for 15 minutes." : `Wrong PIN. ${PIN_MAX_TRIES - tries} tries left.`);
}
