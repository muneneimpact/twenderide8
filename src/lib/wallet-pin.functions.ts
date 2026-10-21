/** Customer wallet PIN: create once, change only through a phone OTP. */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const pinSchema = z.string().regex(/^\d{4}$/, "PIN must be 4 digits.");

export const getWalletPinStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data } = await supabaseAdmin.from("customer_wallet_pins").select("locked_until").eq("user_id", context.userId).maybeSingle();
    return { hasPin: Boolean(data), lockedUntil: data?.locked_until ?? null };
  });

export const createWalletPin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ pin: pinSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashPin } = await import("./wallet-pin.server");
    const { data: existing } = await supabaseAdmin.from("customer_wallet_pins").select("user_id").eq("user_id", context.userId).maybeSingle();
    if (existing) throw new Error("You already have a PIN. Use “Change PIN” to reset it with your phone.");
    const { error } = await supabaseAdmin.from("customer_wallet_pins").insert({ user_id: context.userId, pin_hash: await hashPin(data.pin, context.userId) });
    if (error) throw new Error("Could not save your PIN.");
    return { ok: true };
  });

/** Step 1 of changing the PIN: the phone must match the account's phone. */
export const requestWalletPinReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ phone: z.string().min(9).max(20) }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseKenyanPhone } = await import("./phone");
    const { hashOtp, randomOtp } = await import("./otp.server");
    const { sendTransactionalSms } = await import("./comms.server");
    const phone = normaliseKenyanPhone(data.phone);
    const { data: me } = await supabaseAdmin.from("profiles").select("phone").eq("id", context.userId).maybeSingle();
    if (!me?.phone || normaliseKenyanPhone(me.phone) !== phone) throw new Error("That is not the phone number on your account.");
    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { count } = await supabaseAdmin.from("wallet_pin_resets").select("id", { count: "exact", head: true }).eq("user_id", context.userId).gte("created_at", hourAgo);
    if ((count ?? 0) >= 5) throw new Error("Too many requests. Try again in an hour.");
    await supabaseAdmin.from("wallet_pin_resets").update({ consumed_at: new Date().toISOString() }).eq("user_id", context.userId).is("consumed_at", null);
    const code = randomOtp();
    const { data: row, error } = await supabaseAdmin.from("wallet_pin_resets").insert({
      user_id: context.userId, phone, code_hash: await hashOtp(code, context.userId),
      expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    }).select("id").single();
    if (error) throw new Error("Could not start PIN reset.");
    const sms = await sendTransactionalSms({
      to: phone,
      message: `Your Twende wallet PIN reset code is ${code}. It expires in 10 minutes. Never share it.`,
      eventType: "wallet_pin_reset", idempotencyKey: `pinreset:${row.id}`, context: { userId: context.userId },
    });
    if (!sms.sent) throw new Error(`We could not send your code: ${sms.detail ?? "SMS failed"}`);
    return { sent: true };
  });

/** Step 2: correct code + new PIN replaces the old PIN and clears any lock. */
export const confirmWalletPinReset = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i) => z.object({ code: z.string().regex(/^\d{6}$/), pin: pinSchema }).parse(i))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashOtp, safeEqual } = await import("./otp.server");
    const { hashPin } = await import("./wallet-pin.server");
    const { data: row } = await supabaseAdmin.from("wallet_pin_resets").select("*").eq("user_id", context.userId)
      .is("consumed_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (!row || new Date(row.expires_at).getTime() < Date.now()) throw new Error("Code expired. Request a new one.");
    if (row.attempts >= 5) throw new Error("Too many wrong codes. Request a new one.");
    if (!safeEqual(await hashOtp(data.code, context.userId), row.code_hash)) {
      await supabaseAdmin.from("wallet_pin_resets").update({ attempts: row.attempts + 1 }).eq("id", row.id);
      throw new Error("Wrong code.");
    }
    const now = new Date().toISOString();
    await supabaseAdmin.from("wallet_pin_resets").update({ verified_at: now, consumed_at: now }).eq("id", row.id);
    await supabaseAdmin.from("customer_wallet_pins").upsert({
      user_id: context.userId, pin_hash: await hashPin(data.pin, context.userId), failed_attempts: 0, locked_until: null, updated_at: now,
    });
    return { ok: true };
  });
