import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "twende.install.dismissed";
let pendingInstallEvent: InstallEvent | null = null;
const installEventListeners = new Set<(event: InstallEvent | null) => void>();

function publishInstallEvent(event: InstallEvent | null) {
  pendingInstallEvent = event;
  installEventListeners.forEach((listener) => listener(event));
}

function subscribeToInstallEvent(listener: (event: InstallEvent | null) => void) {
  installEventListeners.add(listener);
  listener(pendingInstallEvent);
  return () => {
    installEventListeners.delete(listener);
  };
}

// Never interrupt sign-in or onboarding screens.
const QUIET_PREFIXES = ["/auth", "/driver/apply", "/hire_/agreement", "/hire/agreement"];

/**
 * Small home-screen install nudge. Hidden on sign-in/onboarding, appears only
 * after the person has been on the app a little while, and stays hidden once dismissed.
 */
export function InstallPrompt({
  showOnHome = false,
  inline = false,
}: {
  showOnHome?: boolean;
  inline?: boolean;
}) {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [installed, setInstalled] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setInstalled(standalone);
    if (!showOnHome && localStorage.getItem(DISMISS_KEY) === "1") return;
    const handler = (raw: Event) => {
      raw.preventDefault();
      publishInstallEvent(raw as InstallEvent);
    };
    const unsubscribeFromInstallEvent = subscribeToInstallEvent(setEvent);
    window.addEventListener("beforeinstallprompt", handler);
    const onInstalled = () => {
      setInstalled(true);
      publishInstallEvent(null);
    };
    window.addEventListener("appinstalled", onInstalled);
    const t = window.setTimeout(() => setReady(true), showOnHome ? 0 : 20_000);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", onInstalled);
      unsubscribeFromInstallEvent();
      window.clearTimeout(t);
    };
  }, [showOnHome]);

  const quiet =
    (!showOnHome && pathname === "/") || QUIET_PREFIXES.some((p) => pathname.startsWith(p));
  if (!ready || installed || quiet || !event) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setEvent(null);
  };

  if (inline) {
    return (
      <button
        onClick={async () => {
          await event.prompt();
          await event.userChoice;
          publishInstallEvent(null);
          dismiss();
        }}
        className="rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
      >
        Install app
      </button>
    );
  }

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-40">
      <div className="solid-panel pointer-events-auto flex items-center gap-2 rounded-full py-1 pl-3 pr-1 shadow-sm">
        <span className="text-xs font-medium text-foreground">Install app</span>
        <button
          onClick={async () => {
            await event.prompt();
            await event.userChoice;
            publishInstallEvent(null);
            dismiss();
          }}
          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
        >
          Install
        </button>
        <button
          onClick={dismiss}
          aria-label="Dismiss install prompt"
          className="rounded-full px-2 py-1 text-xs text-muted-foreground"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
