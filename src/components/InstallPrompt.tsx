import { useEffect, useState } from "react";
import { useRouterState } from "@tanstack/react-router";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "twende.install.dismissed";
// Never interrupt sign-in or onboarding screens.
const QUIET_PREFIXES = ["/auth", "/driver/apply", "/hire_/agreement", "/hire/agreement"];

/**
 * Small home-screen install nudge. Hidden on sign-in/onboarding, appears only
 * after the person has been on the app a little while, and stays hidden once dismissed.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);
  const [ready, setReady] = useState(false);
  const pathname = useRouterState({ select: (s) => s.location.pathname });

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    const handler = (raw: Event) => {
      raw.preventDefault();
      setEvent(raw as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    const t = window.setTimeout(() => setReady(true), 20_000);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.clearTimeout(t);
    };
  }, []);

  const quiet = pathname === "/" || QUIET_PREFIXES.some((p) => pathname.startsWith(p));
  if (!event || !ready || quiet) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setEvent(null);
  };

  return (
    <div className="pointer-events-none fixed right-3 top-3 z-40">
      <div className="solid-panel pointer-events-auto flex items-center gap-2 rounded-full py-1 pl-3 pr-1 shadow-sm">
        <span className="text-xs font-medium text-foreground">Install app</span>
        <button
          onClick={async () => {
            await event.prompt();
            await event.userChoice;
            dismiss();
          }}
          className="rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground"
        >
          Install
        </button>
        <button onClick={dismiss} aria-label="Dismiss install prompt" className="rounded-full px-2 py-1 text-xs text-muted-foreground">
          ✕
        </button>
      </div>
    </div>
  );
}
