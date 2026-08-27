/** One-time code helpers (server-only). Plaintext codes are never persisted. */

/** Cryptographically secure six-digit code, uniformly distributed. */
export function randomOtp(): string {
  const bytes = new Uint32Array(1);
  crypto.getRandomValues(bytes);
  return String(100000 + ((bytes[0] ?? 0) % 900000));
}

/** SHA-256 of code + per-user salt + server pepper. */
export async function hashOtp(code: string, userId: string): Promise<string> {
  const pepper = process.env["SUPABASE_SERVICE_ROLE_KEY"] ?? "twende-otp";
  const encoded = new TextEncoder().encode(`${userId}:${code}:${pepper}`);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Length-safe constant-time comparison for hex digests. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Six-digit ride verification code shown to the driver and typed by the customer. */
export function randomDriverCode(): string {
  return randomOtp();
}
