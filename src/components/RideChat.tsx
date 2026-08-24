import { useEffect, useRef, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { listRideMessages, sendRideMessage } from "@/lib/chat.functions";
import { playAlert } from "@/lib/audio";

/**
 * Chat + call panel shared by the customer ride screen and the driver console.
 * Calling is a plain phone dial so it works on every handset without needing a
 * voice provider.
 */
export function RideChat({
  rideId,
  counterpartName,
  counterpartPhone,
  closed,
}: {
  rideId: string;
  counterpartName: string;
  counterpartPhone?: string | null;
  closed?: boolean;
}) {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listRideMessages);
  const sendFn = useServerFn(sendRideMessage);
  const [draft, setDraft] = useState("");
  const endRef = useRef<HTMLDivElement | null>(null);
  const seen = useRef(0);

  const thread = useQuery({
    queryKey: ["ride-chat", rideId],
    queryFn: () => listFn({ data: { rideId } }),
    refetchInterval: 8000,
  });

  useEffect(() => {
    const channel = supabase
      .channel(`ride-chat:${rideId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "ride_messages", filter: `ride_id=eq.${rideId}` },
        () => queryClient.invalidateQueries({ queryKey: ["ride-chat", rideId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [queryClient, rideId]);

  const messages = thread.data?.messages ?? [];

  useEffect(() => {
    if (messages.length > seen.current) {
      const latest = messages[messages.length - 1];
      if (seen.current > 0 && latest && !latest.mine) playAlert("status");
      seen.current = messages.length;
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [messages]);

  const sending = useMutation({
    mutationFn: (body: string) => sendFn({ data: { rideId, body } }),
    onSuccess: () => {
      setDraft("");
      void queryClient.invalidateQueries({ queryKey: ["ride-chat", rideId] });
    },
  });

  return (
    <section className="surface-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">Message {counterpartName}</h3>
          <p className="truncate text-xs text-muted-foreground">
            {closed ? "This trip is closed — messages are read only." : "Chat stays inside this trip."}
          </p>
        </div>
        {counterpartPhone ? (
          <a
            href={`tel:${counterpartPhone}`}
            className="shrink-0 rounded-full bg-success px-4 py-2 text-xs font-semibold text-white"
          >
            Call
          </a>
        ) : (
          <span className="shrink-0 text-xs text-muted-foreground">No number yet</span>
        )}
      </div>

      <div className="mt-3 max-h-64 space-y-2 overflow-y-auto rounded-2xl bg-secondary/40 p-3">
        {thread.isPending ? (
          <p className="text-xs text-muted-foreground">Loading messages…</p>
        ) : messages.length === 0 ? (
          <p className="text-xs text-muted-foreground">No messages yet. Say hello or share a landmark.</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.mine ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm ${
                  message.mine
                    ? "bg-primary text-primary-foreground"
                    : "border border-border bg-card text-foreground"
                }`}
              >
                <p className="whitespace-pre-wrap break-words">{message.body}</p>
                <p
                  className={`mt-0.5 text-[10px] ${
                    message.mine ? "text-primary-foreground/70" : "text-muted-foreground"
                  }`}
                >
                  {new Date(message.createdAt).toLocaleTimeString("en-KE", {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      {!closed && (
        <form
          className="mt-3 flex gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const body = draft.trim();
            if (body) sending.mutate(body);
          }}
        >
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Type a message…"
            maxLength={1000}
            className="min-w-0 flex-1 rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            type="submit"
            disabled={sending.isPending || draft.trim().length === 0}
            className="shrink-0 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {sending.isPending ? "…" : "Send"}
          </button>
        </form>
      )}
      {sending.isError && (
        <p className="mt-2 text-xs text-destructive">{(sending.error as Error).message}</p>
      )}
    </section>
  );
}
