import { useEffect, useState } from "react";

interface InstallEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const DISMISS_KEY = "twende.install.dismissed";

/**
 * Home-screen install nudge. Only shows when the browser actually offers an
 * install, and stays hidden once the person waves it away.
 */
export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null);

  useEffect(() => {
    if (localStorage.getItem(DISMISS_KEY) === "1") return;
    const handler = (raw: Event) => {
      raw.preventDefault();
      setEvent(raw as InstallEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!event) return null;

  return (
    <div className="fixed inset-x-0 bottom-24 z-50 px-3">
      <div className="glass-strong mx-auto flex max-w-md items-center gap-3 rounded-2xl p-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">Install Twende Ride</p>
          <p className="truncate text-xs text-muted-foreground">Install the app for faster booking, full screen.</p>
        </div>
        <button
          onClick={async () => {
            await event.prompt();
            await event.userChoice;
            setEvent(null);
          }}
          className="rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground"
        >
          Install
        </button>
        <button
          onClick={() => {
            localStorage.setItem(DISMISS_KEY, "1");
            setEvent(null);
          }}
          aria-label="Dismiss install prompt"
          className="rounded-full px-2 py-2 text-xs text-muted-foreground"
        >
          ✕
        </button>
      </div>
    </div>
  );
}
