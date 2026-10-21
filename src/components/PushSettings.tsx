import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { getNotificationPreferences, updateNotificationPreferences } from "@/lib/account.functions";
import { sendTestPush } from "@/lib/push.functions";
import { disablePush, enablePush, PUSH_STATUS_COPY, type PushStatus } from "@/lib/push";

/** Notification preferences the rider or driver controls themselves. */
export function PushSettings() {
  const queryClient = useQueryClient();
  const prefsFn = useServerFn(getNotificationPreferences);
  const saveFn = useServerFn(updateNotificationPreferences);
  const testFn = useServerFn(sendTestPush);

  const prefs = useQuery({ queryKey: ["notification-prefs"], queryFn: () => prefsFn() });
  const [message, setMessage] = useState<string | null>(null);
  const [permission, setPermission] = useState<NotificationPermission | "unavailable">(
    "unavailable",
  );

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setPermission(Notification.permission);
    }
  }, []);

  const save = useMutation({
    mutationFn: (patch: {
      sms_enabled?: boolean;
      email_enabled?: boolean;
      whatsapp_enabled?: boolean;
      push_enabled?: boolean;
    }) => saveFn({ data: patch }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["notification-prefs"] }),
  });

  const togglePush = useMutation({
    mutationFn: async (next: boolean) => {
      if (!next) {
        await disablePush();
        await saveFn({ data: { push_enabled: false } });
        return "off" as const;
      }
      const outcome = await enablePush();
      if (outcome.status !== "registered") {
        await saveFn({
          data: { push_permission: outcome.status === "denied" ? "denied" : "default" },
        });
      }
      return outcome.status as PushStatus;
    },
    onSuccess: (result) => {
      setMessage(
        result === "off" ? "Push notifications are off on this device." : PUSH_STATUS_COPY[result],
      );
      if (typeof window !== "undefined" && "Notification" in window)
        setPermission(Notification.permission);
      queryClient.invalidateQueries({ queryKey: ["notification-prefs"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const test = useMutation({
    mutationFn: () => testFn(),
    onSuccess: (result) =>
      setMessage(
        result.delivered > 0
          ? `Test alert sent to ${result.delivered} device${result.delivered === 1 ? "" : "s"}.`
          : result.skipped === "no_tokens"
            ? "No devices registered yet — turn push on first."
            : "Nothing was delivered. Check that push is on for this device.",
      ),
  });

  const pushOn = prefs.data?.push_enabled === true && permission === "granted";

  return (
    <section className="rounded-2xl border border-border bg-card p-4">
      <h2 className="font-display text-lg font-bold text-foreground">Notifications</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Choose how we reach you about trips, drivers and payments.
      </p>

      <div className="mt-3 space-y-2">
        <Row
          label="Push notifications"
          hint="Trip alerts on this phone or browser, even when the app is closed."
          checked={pushOn}
          onChange={(next) => togglePush.mutate(next)}
          busy={togglePush.isPending}
        />
        <Row
          label="SMS"
          hint="Critical trip and payment messages by text."
          checked={prefs.data?.sms_enabled !== false}
          onChange={(next) => save.mutate({ sms_enabled: next })}
          busy={save.isPending}
        />
        <Row
          label="Email"
          hint="Receipts and account updates."
          checked={prefs.data?.email_enabled !== false}
          onChange={(next) => save.mutate({ email_enabled: next })}
          busy={save.isPending}
        />
        <Row
          label="Twende Meru Rides WhatsApp service consent"
          hint={`I agree Twende Meru Rides may send hire payment reminders and important account updates to my profile number. No marketing. ${prefs.data?.phone ? `Number: ${prefs.data.phone}.` : "Add a mobile number to your profile first."}`}
          checked={prefs.data?.whatsapp_enabled !== false}
          onChange={(next) => save.mutate({ whatsapp_enabled: next })}
          busy={save.isPending || !prefs.data?.phone}
        />
      </div>

      {pushOn ? (
        <button
          onClick={() => test.mutate()}
          disabled={test.isPending}
          className="mt-3 w-full rounded-full border border-input px-4 py-2.5 text-sm font-medium text-foreground disabled:opacity-60"
        >
          {test.isPending ? "Sending…" : "Send a test notification"}
        </button>
      ) : null}

      {message ? <p className="mt-2 text-xs text-muted-foreground">{message}</p> : null}
    </section>
  );
}

function Row({
  label,
  hint,
  checked,
  onChange,
  busy,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (next: boolean) => void;
  busy: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-2xl border border-border p-3">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-foreground">{label}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={busy}
        onClick={() => onChange(!checked)}
        className={`mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors disabled:opacity-60 ${
          checked ? "bg-primary" : "bg-secondary"
        }`}
      >
        <span
          className={`block h-5 w-5 rounded-full bg-background transition-transform ${
            checked ? "translate-x-[22px]" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
