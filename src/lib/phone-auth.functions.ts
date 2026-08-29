/**
 * Phone-first sign in.
 *
 * A customer types their Kenyan number, receives a six-digit SMS code and is
 * signed in with it. The same call registers the account the first time, so
 * registration and phone verification happen in one step and every account is
 * bound to exactly one verified phone number.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const OTP_TTL_SECONDS = 300;
const RESEND_COOLDOWN_SECONDS = 60;
const MAX_SENDS_PER_HOUR = 5;
const MAX_ATTEMPTS = 5;
/** Placeholder mailbox for accounts that only ever sign in with a phone. */
const PHONE_EMAIL_DOMAIN = "phone.twenderides.app";

function syntheticEmail(phone: string) {
  return `${phone.replace(/\D/g, "")}@${PHONE_EMAIL_DOMAIN}`;
}

export const startPhoneLogin = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ phone: z.string().min(9).max(20) }).parse(input))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseKenyanPhone } = await import("./phone");
    const { textSmsConfigured } = await import("./adapters/textsms.server");
    const { sendTransactionalSms } = await import("./comms.server");
    const { hashOtp, randomOtp } = await import("./otp.server");

    const phone = normaliseKenyanPhone(data.phone);
    if (!textSmsConfigured()) {
      throw new Error("SMS sign in is unavailable right now. Please contact support.");
    }

    const hourAgo = new Date(Date.now() - 3600_000).toISOString();
    const { data: recent } = await supabaseAdmin
      .from("phone_login_otps")
      .select("id, last_sent_at")
      .eq("phone", phone)
      .gte("created_at", hourAgo)
      .order("created_at", { ascending: false });

    if ((recent?.length ?? 0) >= MAX_SENDS_PER_HOUR) {
      throw new Error("Too many codes requested for this number. Please try again in an hour.");
    }
    const latest = recent?.[0];
    if (latest) {
      const since = (Date.now() - new Date(latest.last_sent_at).getTime()) / 1000;
      if (since < RESEND_COOLDOWN_SECONDS) {
        throw new Error(
          `Please wait ${Math.ceil(RESEND_COOLDOWN_SECONDS - since)} seconds before requesting a new code.`,
        );
      }
    }

    await supabaseAdmin
      .from("phone_login_otps")
      .update({ consumed_at: new Date().toISOString() })
      .eq("phone", phone)
      .is("consumed_at", null);

    const code = randomOtp();
    const { data: record, error } = await supabaseAdmin
      .from("phone_login_otps")
      .insert({
        phone,
        code_hash: await hashOtp(code, phone),
        expires_at: new Date(Date.now() + OTP_TTL_SECONDS * 1000).toISOString(),
      })
      .select("id")
      .single();
    if (error) throw new Error("Could not start sign in. Please try again.");

    const sms = await sendTransactionalSms({
      to: phone,
      message: `Your Twende Meru Rides code is ${code}. It expires in 5 minutes. Do not share this code.`,
      eventType: "phone_login",
      idempotencyKey: `login-otp:${record.id}`,
    });

    if (!sms.sent) {
      await supabaseAdmin
        .from("phone_login_otps")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", record.id);
      throw new Error(`We could not send your code: ${sms.detail ?? "SMS provider unavailable."}`);
    }

    return { sent: true, phone, expiresInSeconds: OTP_TTL_SECONDS, resendAfterSeconds: RESEND_COOLDOWN_SECONDS };
  });

/**
 * Verifies the code, creates the account on first use and returns a one-time
 * token the browser exchanges for a session. The phone is stored verified and
 * is unique across the platform, so the same number can never hold two accounts.
 */
export const verifyPhoneLogin = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        phone: z.string().min(9).max(20),
        code: z.string().regex(/^\d{6}$/),
        fullName: z.string().max(120).optional(),
        email: z.string().email().max(160).optional(),
      })
      .parse(input),
  )

  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { normaliseKenyanPhone } = await import("./phone");
    const { hashOtp, safeEqual } = await import("./otp.server");

    const phone = normaliseKenyanPhone(data.phone);
    const { data: record } = await supabaseAdmin
      .from("phone_login_otps")
      .select("*")
      .eq("phone", phone)
      .is("consumed_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!record) throw new Error("Request a new code.");
    if (new Date(record.expires_at).getTime() < Date.now()) {
      await supabaseAdmin
        .from("phone_login_otps")
        .update({ consumed_at: new Date().toISOString() })
        .eq("id", record.id);
      throw new Error("That code has expired. Request a new one.");
    }
    if (record.attempts >= (record.max_attempts ?? MAX_ATTEMPTS)) {
      throw new Error("Too many wrong attempts. Request a new code.");
    }

    const matches = safeEqual(await hashOtp(data.code, phone), record.code_hash);
    if (!matches) {
      await supabaseAdmin
        .from("phone_login_otps")
        .update({ attempts: record.attempts + 1 })
        .eq("id", record.id);
      return {
        verified: false as const,
        attemptsLeft: Math.max(0, (record.max_attempts ?? MAX_ATTEMPTS) - record.attempts - 1),
      };
    }

    const now = new Date().toISOString();
    await supabaseAdmin.from("phone_login_otps").update({ consumed_at: now }).eq("id", record.id);

    // One phone, one account: an existing verified profile always wins.
    const { data: existing } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name")
      .eq("phone", phone)
      .maybeSingle();

    const contactEmail = data.email?.trim().toLowerCase() || null;
    let userId = existing?.id ?? null;
    // The auth mailbox the one-time token is minted against.
    let authEmail = existing?.email ?? null;

    if (!userId) {
      // An email is optional; without one we mint a placeholder mailbox.
      authEmail = contactEmail ?? syntheticEmail(phone);
      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email: authEmail,
        email_confirm: true,
        phone,
        phone_confirm: true,
        user_metadata: { full_name: data.fullName?.trim() || null, phone },
      });
      if (createError || !created.user) {
        throw new Error(
          createError?.message?.toLowerCase().includes("already")
            ? "That email is already linked to another account. Leave it blank or use a different one."
            : (createError?.message ?? "Could not create your account. Please try again."),
        );
      }
      userId = created.user.id;
    }

    if (!authEmail) {
      const { data: authUser } = await supabaseAdmin.auth.admin.getUserById(userId);
      authEmail = authUser.user?.email ?? syntheticEmail(phone);
      if (!authUser.user?.email) {
        await supabaseAdmin.auth.admin.updateUserById(userId, { email: authEmail, email_confirm: true });
      }
    }

    const { error: profileError } = await supabaseAdmin
      .from("profiles")
      .upsert({
        id: userId,
        phone,
        phone_verified_at: now,
        email: contactEmail ?? authEmail,
        ...(data.fullName?.trim() ? { full_name: data.fullName.trim() } : {}),
      });
    if (profileError) {
      throw new Error("This phone number is already linked to another account.");
    }
    const email = authEmail;


    // A single-use token the browser swaps for a session — no password is moved.
    const { data: link, error: linkError } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email,
    });
    if (linkError || !link.properties?.hashed_token) {
      throw new Error("Could not complete sign in. Please try again.");
    }

    return { verified: true as const, phone, tokenHash: link.properties.hashed_token };
  });
