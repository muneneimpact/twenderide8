import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";

const OTP_TTL_SECONDS = 300;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;

/**
 * Sends a six-digit phone verification code by SMS. The plaintext code is never
 * stored, logged or returned. No code is generated when the SMS provider is not
 * configured — we never pretend a verification message was sent.
 */
export const requestPhoneOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ phone: z.string().min(9).max(20) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseKenyanPhone } = await import("./phone");
    const { textSmsConfigured } = await import("./adapters/textsms.server");
    const { sendTransactionalSms, sendTransactionalEmail, resendConfigured } = await import("./comms.server");
    const { hashOtp, randomOtp } = await import("./otp.server");

    const phone = normaliseKenyanPhone(data.phone);
    const email = (context.claims as { email?: string } | null)?.email ?? null;
    const canSms = textSmsConfigured();
    const canEmail = resendConfigured() && Boolean(email);

    if (!canSms && !canEmail) {
      throw new Error(
        "Phone verification is unavailable: no SMS or email provider is configured yet. Please contact support.",
      );
    }

    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("phone_verifications")
      .select("id, last_sent_at")
      .eq("user_id", context.userId)
      .gte("created_at", hourAgo)
      .order("created_at", { ascending: false });

    if ((recent?.length ?? 0) >= MAX_SENDS_PER_HOUR) {
      throw new Error("Too many verification requests. Please try again in an hour.");
    }
    const latest = recent?.[0];
    if (latest) {
      const since = (Date.now() - new Date(latest.last_sent_at).getTime()) / 1000;
      if (since < RESEND_COOLDOWN_SECONDS) {
        throw new Error(`Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - since)} seconds before requesting a new code.`);
      }
    }

    // A new code always invalidates every earlier live code.
    await supabaseAdmin
      .from("phone_verifications")
      .update({ consumed_at: new Date().toISOString() })
      .eq("user_id", context.userId)
      .is("consumed_at", null);

    const code = randomOtp();
    const { data: record, error } = await supabaseAdmin
      .from("phone_verifications")
      .insert({
        user_id: context.userId,
        phone,
        code_hash: await hashOtp(code, context.userId),
        expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error("Could not start phone verification. Please try again.");

    const smsResult = canSms
      ? await sendTransactionalSms({
          to: phone,
          message: `Your Twende Meru Rides verification code is ${code}. It expires in 5 minutes. Do not share this code.`,
          eventType: "phone_verification",
          idempotencyKey: `otp:${record.id}`,
          context: { userId: context.userId },
        })
      : null;

    const emailResult =
      canEmail && email
        ? await sendTransactionalEmail({
            to: email,
            template: {
              code: "phone_verification",
              data: { code, phone, minutes: Math.round(OTP_TTL_SECONDS / 60) },
            },
            eventType: "phone_verification",
            idempotencyKey: `otp-email:${record.id}`,
            context: { userId: context.userId },
          })
        : null;

    const sentBySms = Boolean(smsResult?.sent);
    const sentByEmail = Boolean(emailResult?.sent);

    if (!sentBySms && !sentByEmail) {
      await supabaseAdmin
        .from("phone_verifications")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", record.id);
      const detail = smsResult?.detail ?? emailResult?.detail ?? "No delivery channel available.";
      throw new Error(`We could not send your verification code: ${detail}`);
    }

    return {
      sent: true,
      phone,
      sentBySms,
      sentByEmail,
      email: sentByEmail ? email : null,
      expiresInSeconds: OTP_TTL_SECONDS,
      resendAfterSeconds: RESEND_COOLDOWN_SECONDS,
    };
  });


/** Checks a code and marks the phone verified only on an exact, unexpired match. */
export const verifyPhoneOtp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) => z.object({ code: z.string().regex(/^\d{6}$/) }).parse(input))
  .handler(async ({ data, context }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { hashOtp, safeEqual } = await import("./otp.server");

    const { data: record } = await supabaseAdmin
      .from("phone_verifications")
      .select("*")
      .eq("user_id", context.userId)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!record) throw new Error("Request a new verification code.");
    if (new Date(record.expires_at).getTime() < Date.now()) {
      await supabaseAdmin
        .from("phone_verifications")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", record.id);
      throw new Error("That code has expired. Request a new one.");
    }
    if (record.attempts >= record.max_attempts) {
      throw new Error("Too many incorrect attempts. Request a new code.");
    }

    const matches = safeEqual(await hashOtp(data.code, context.userId), record.code_hash);
    if (!matches) {
      await supabaseAdmin
        .from("phone_verifications")
        .update({ attempts: record.attempts + 1 })
        .eq("id", record.id);
      return { verified: false, attemptsLeft: Math.max(0, record.max_attempts - record.attempts - 1) };
    }

    // One number, one account: a verified phone can never be claimed twice.
    const { data: taken } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("phone", record.phone)
      .neq("id", context.userId)
      .maybeSingle();
    if (taken) {
      throw new Error("That number already belongs to another Twende account.");
    }

    const now = new Date().toISOString();
    await supabaseAdmin.from("phone_verifications").update({ consumed_at: now }).eq("id", record.id);
    const { error: saveError } = await supabaseAdmin
      .from("profiles")
      .update({ phone: record.phone, phone_verified_at: now })
      .eq("id", context.userId);
    if (saveError) {
      // The partial unique index is the final arbiter under concurrency.
      throw new Error("That number already belongs to another Twende account.");
    }

    return { verified: true, phone: record.phone };
  });

/** Verification state for the account page. */
export const getPhoneStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { textSmsConfigured } = await import("./adapters/textsms.server");
    const { data: profile } = await context.supabase
      .from("profiles")
      .select("phone, phone_verified_at")
      .eq("id", context.userId)
      .maybeSingle();
    return {
      phone: profile?.phone ?? null,
      verified: Boolean(profile?.phone_verified_at),
      smsAvailable: textSmsConfigured(),
    };
  });
