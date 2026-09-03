/**
 * Browser-side push registration. Everything here runs only after a user
 * gesture (permission prompts are ignored otherwise) and only in a top-level
 * page — inside the Lovable preview iframe browsers silently refuse.
 */
import { registerPushToken, removePushToken } from "@/lib/push.functions";

const appId = import.meta.env["VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_APP_ID"] as string | undefined;
const vapidKey = import.meta.env["VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_VAPID_KEY"] as
  | string
  | undefined;

const firebaseConfig = {
  apiKey: import.meta.env["VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_WEB_API_KEY"] as string,
  projectId: import.meta.env["VITE_LOVABLE_CONNECTOR_FIREBASE_MESSAGING_PROJECT_ID"] as string,
  appId: appId ?? "",
  messagingSenderId: appId?.split(":")[1] ?? "",
};

export type PushStatus =
  | "registered"
  | "not-configured"
  | "unsupported"
  | "open-in-new-tab"
  | "denied"
  | "error";

export interface PushOutcome {
  status: PushStatus;
  token?: string;
  detail?: string;
}

export const PUSH_STATUS_COPY: Record<PushStatus, string> = {
  registered: "Push notifications are on for this device.",
  "not-configured": "Push notifications are not configured for this app yet.",
  unsupported: "This browser cannot receive push notifications.",
  "open-in-new-tab": "Open the app in its own tab (or install it) to turn on notifications.",
  denied: "Notifications are blocked. Allow them for this site in your browser settings.",
  error: "We could not turn on notifications on this device.",
};

function configured() {
  return Boolean(
    firebaseConfig.apiKey && firebaseConfig.projectId && appId && vapidKey && firebaseConfig.messagingSenderId,
  );
}

async function swRegistration() {
  const query = new URLSearchParams(firebaseConfig as Record<string, string>).toString();
  return navigator.serviceWorker.register(`/firebase-messaging-sw.js?${query}`, { scope: "/" });
}

/** Call from a click handler. Requests permission, mints a token and stores it. */
export async function enablePush(): Promise<PushOutcome> {
  if (typeof window === "undefined") return { status: "error" };
  if (!configured()) return { status: "not-configured" };
  if (!("Notification" in window) || !("serviceWorker" in navigator)) {
    return { status: "unsupported" };
  }

  try {
    const { isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return { status: "unsupported" };
    if (window.top !== window.self) return { status: "open-in-new-tab" };

    const permission =
      Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") return { status: "denied" };

    const token = await mintToken();
    if (!token) return { status: "denied" };

    await registerPushToken({
      data: { token, userAgent: navigator.userAgent.slice(0, 400) },
    });
    localStorage.setItem("twende:push-token", token);
    return { status: "registered", token };
  } catch (error) {
    console.error("enablePush failed", error);
    return error instanceof Error
      ? { status: "error" as const, detail: error.message }
      : { status: "error" as const };
  }
}

async function mintToken() {
  const { initializeApp, getApps, getApp } = await import("firebase/app");
  const { getMessaging, getToken } = await import("firebase/messaging");
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const registration = await swRegistration();
  await navigator.serviceWorker.ready;
  return getToken(getMessaging(app), { vapidKey: vapidKey!, serviceWorkerRegistration: registration });
}

/** Turns push off for this device and forgets the token server-side. */
export async function disablePush() {
  const token = typeof localStorage === "undefined" ? null : localStorage.getItem("twende:push-token");
  if (token) {
    try {
      await removePushToken({ data: { token } });
    } catch (error) {
      console.error("removePushToken failed", error);
    }
    localStorage.removeItem("twende:push-token");
  }
  if (typeof navigator !== "undefined" && "serviceWorker" in navigator) {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.allSettled(
      registrations
        .filter((r) => (r.active?.scriptURL ?? "").includes("firebase-messaging-sw.js"))
        .map((r) => r.unregister()),
    );
  }
}

/**
 * Silent refresh on app start: if permission is already granted we re-mint the
 * token (FCM rotates them) and re-register it against the current session.
 */
export async function refreshPushRegistration() {
  if (typeof window === "undefined" || !configured()) return;
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  if (window.top !== window.self) return;
  try {
    const { isSupported } = await import("firebase/messaging");
    if (!(await isSupported())) return;
    const token = await mintToken();
    if (!token) return;
    const previous = localStorage.getItem("twende:push-token");
    if (previous && previous !== token) {
      await removePushToken({ data: { token: previous } }).catch(() => undefined);
    }
    await registerPushToken({ data: { token, userAgent: navigator.userAgent.slice(0, 400) } });
    localStorage.setItem("twende:push-token", token);
  } catch (error) {
    console.error("push refresh failed", error);
  }
}

/**
 * Foreground alerts. FCM does not raise a system notification while the tab is
 * focused, so we show one ourselves — using the same tag as the worker so an
 * event never appears twice.
 */
export async function listenForForegroundPush(onNavigate: (path: string) => void) {
  if (typeof window === "undefined" || !configured()) return () => undefined;
  if (!("Notification" in window) || Notification.permission !== "granted") return () => undefined;
  try {
    const { isSupported, getMessaging, onMessage } = await import("firebase/messaging");
    if (!(await isSupported())) return () => undefined;
    const { initializeApp, getApps, getApp } = await import("firebase/app");
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

    return onMessage(getMessaging(app), (payload) => {
      const data = (payload.data ?? {}) as Record<string, string>;
      const title = data["title"] || "Twende Meru Rides";
      const path = data["path"] || "/";
      if (document.visibilityState === "visible") {
        const notification = new Notification(title, {
          body: data["body"] ?? "",
          icon: "/icons/icon-192.png",
          tag: data["dedupeKey"] || data["templateCode"] || "twende",
        });
        notification.onclick = () => {
          window.focus();
          onNavigate(path);
          notification.close();
        };
      }
    });
  } catch (error) {
    console.error("foreground push listener failed", error);
    return () => undefined;
  }
}
