const REF_KEY = "traffic_ref";
const EXPIRY_KEY = "traffic_ref_expires_at";
const REF_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Capture the first-party referral parameter for 30 days without blocking SSR. */
export function captureTrafficRef(search = window.location.search) {
  if (typeof window === "undefined") return;

  const params = new URLSearchParams(search);
  const ref = params.get("ref")?.trim();
  const now = Date.now();

  try {
    const expiresAt = Number(window.localStorage.getItem(EXPIRY_KEY) ?? "0");
    if (expiresAt > 0 && expiresAt <= now) {
      window.localStorage.removeItem(REF_KEY);
      window.localStorage.removeItem(EXPIRY_KEY);
    }

    if (ref) {
      window.localStorage.setItem(REF_KEY, ref.slice(0, 120));
      window.localStorage.setItem(EXPIRY_KEY, String(now + REF_TTL_MS));
    }
  } catch {
    // Storage can be disabled or full; referral capture is helpful but non-critical.
  }
}

export function readTrafficRef() {
  if (typeof window === "undefined") return null;
  try {
    const expiresAt = Number(window.localStorage.getItem(EXPIRY_KEY) ?? "0");
    if (expiresAt > 0 && expiresAt <= Date.now()) {
      window.localStorage.removeItem(REF_KEY);
      window.localStorage.removeItem(EXPIRY_KEY);
      return null;
    }
    return window.localStorage.getItem(REF_KEY);
  } catch {
    return null;
  }
}
