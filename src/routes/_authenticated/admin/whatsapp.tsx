import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";
import { MessageCircle, RefreshCw, Send, ShieldAlert } from "lucide-react";
import { AppShell, adminTabs } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import {
  getWhatsAppThread,
  listWhatsAppConversations,
  sendWhatsAppReply,
} from "@/lib/whatsapp.functions";

export const Route = createFileRoute("/_authenticated/admin/whatsapp")({
  head: () => ({
    meta: [
      { title: "WhatsApp inbox — Twende Meru Ops" },
      { name: "description", content: "Review and respond to saved WhatsApp conversations." },
    ],
  }),
  component: () => (
    <RoleGate allow={["ops_admin", "super_admin"]} title="WhatsApp inbox">
      <WhatsAppInbox />
    </RoleGate>
  ),
});

type Conversation = Awaited<ReturnType<typeof listWhatsAppConversations>>["conversations"][number];

function WhatsAppInbox() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listWhatsAppConversations);
  const threadFn = useServerFn(getWhatsAppThread);
  const sendFn = useServerFn(sendWhatsAppReply);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reply, setReply] = useState("");
  const [search, setSearch] = useState("");

  const inbox = useQuery({
    queryKey: ["admin-whatsapp-conversations"],
    queryFn: () => listFn(),
    refetchInterval: 10_000,
  });
  const conversations = useMemo(() => inbox.data?.conversations ?? [], [inbox.data?.conversations]);
  const visible = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return conversations;
    return conversations.filter(
      (item) =>
        item.customer_phone.toLowerCase().includes(query) ||
        (item.customer_name ?? "").toLowerCase().includes(query),
    );
  }, [conversations, search]);

  useEffect(() => {
    if (!selectedId && visible.length > 0) setSelectedId(visible[0]!.id);
    if (selectedId && !conversations.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [selectedId, visible, conversations]);

  const thread = useQuery({
    queryKey: ["admin-whatsapp-thread", selectedId],
    queryFn: () => threadFn({ data: { conversationId: selectedId! } }),
    enabled: Boolean(selectedId),
    refetchInterval: 8_000,
  });
  const send = useMutation({
    mutationFn: () => sendFn({ data: { conversationId: selectedId!, body: reply.trim() } }),
    onSuccess: () => setReply(""),
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-conversations"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-whatsapp-thread", selectedId] });
    },
  });

  const activeConversation =
    (conversations as Conversation[]).find((item) => item.id === selectedId) ?? null;
  const threadData = thread.data;
  const windowOpen =
    threadData?.serviceWindowOpen ?? activeConversation?.service_window_open ?? false;
  const canSend = Boolean(
    inbox.data?.sendConfigured && windowOpen && reply.trim() && !send.isPending,
  );

  return (
    <AppShell title="WhatsApp inbox" eyebrow="Twende Ops" tabs={adminTabs}>
      <div className="mx-auto grid max-w-6xl gap-4 px-4 py-5 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.6fr)]">
        <section className="surface-card overflow-hidden p-3">
          <div className="flex items-center justify-between gap-2 px-1">
            <div>
              <h2 className="font-display text-lg font-bold text-foreground">Conversations</h2>
              <p className="text-xs text-muted-foreground">
                {inbox.isPending ? "Loading…" : `${conversations.length} saved`}
              </p>
            </div>
            <button
              onClick={() => void inbox.refetch()}
              aria-label="Refresh inbox"
              className="rounded-full border border-input p-2 text-muted-foreground"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search name or phone"
            className="input-base mt-3"
          />
          <div className="mt-3 max-h-[68vh] space-y-1 overflow-y-auto">
            {visible.map((conversation) => (
              <ConversationRow
                key={conversation.id}
                conversation={conversation}
                selected={conversation.id === selectedId}
                onClick={() => setSelectedId(conversation.id)}
              />
            ))}
            {!inbox.isPending && visible.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-border p-5 text-center">
                <MessageCircle className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold text-foreground">
                  {search ? "No matching conversations" : "No WhatsApp messages yet"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Inbound chats will appear here after the Meta webhook is connected.
                </p>
              </div>
            ) : null}
          </div>
        </section>

        <section className="surface-card flex min-h-[65vh] flex-col overflow-hidden">
          {inbox.data && (!inbox.data.sendConfigured || !inbox.data.webhookConfigured) ? (
            <div className="border-b border-warning/30 bg-warning/10 px-4 py-3">
              <div className="flex gap-2 text-warning-foreground">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="text-xs">
                  <p className="font-semibold">WhatsApp connection setup required</p>
                  <p className="mt-1">
                    {inbox.data.sendConfigured
                      ? "Sending is configured."
                      : `Sending is disabled until the server has ${inbox.data.missing.join(", ")}. `}
                    {inbox.data.webhookConfigured
                      ? "Webhook verification is configured."
                      : "Inbound messages and delivery receipts need WHATSAPP_APP_SECRET and WHATSAPP_VERIFY_TOKEN."}
                  </p>
                  <p className="mt-1">
                    No secrets are shown in this admin screen. Set these in the deployment server
                    environment.
                  </p>
                </div>
              </div>
            </div>
          ) : null}

          {activeConversation && threadData ? (
            <>
              <header className="border-b border-border px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate font-display text-lg font-bold text-foreground">
                      {activeConversation.customer_name || "WhatsApp customer"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {activeConversation.customer_phone}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${
                      windowOpen
                        ? "bg-success/15 text-success"
                        : "bg-secondary text-muted-foreground"
                    }`}
                  >
                    {windowOpen ? "24h reply window open" : "Template required"}
                  </span>
                </div>
                {activeConversation.last_inbound_at ? (
                  <p className="mt-1 text-[10px] text-muted-foreground">
                    Last customer message{" "}
                    {new Date(activeConversation.last_inbound_at).toLocaleString("en-KE")}
                  </p>
                ) : null}
              </header>

              <div className="flex-1 space-y-2 overflow-y-auto bg-background/40 px-3 py-4 sm:px-5">
                {threadData.messages.map((message) => (
                  <div
                    key={message.id}
                    className={`max-w-[88%] rounded-2xl px-3 py-2 text-sm ${
                      message.direction === "inbound"
                        ? "bg-secondary text-secondary-foreground"
                        : "ml-auto bg-primary text-primary-foreground"
                    }`}
                  >
                    <p className="whitespace-pre-wrap break-words">{message.body}</p>
                    {message.message_type !== "text" ? (
                      <p className="mt-1 text-[10px] opacity-70">
                        {message.message_type} · attachment reference saved
                      </p>
                    ) : null}
                    <p className="mt-1 text-right text-[10px] opacity-70">
                      {message.direction === "inbound" ? "Customer" : "Twende"} ·{" "}
                      {formatTime(message.created_at)}
                      {message.direction === "outbound" ? ` · ${message.status}` : ""}
                    </p>
                    {message.error_message ? (
                      <p className="mt-1 text-[10px] text-destructive">{message.error_message}</p>
                    ) : null}
                  </div>
                ))}
                {threadData.messages.length === 0 ? (
                  <p className="py-10 text-center text-xs text-muted-foreground">
                    No saved messages in this conversation.
                  </p>
                ) : null}
              </div>

              <form
                className="border-t border-border p-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (canSend) send.mutate();
                }}
              >
                {!windowOpen ? (
                  <p className="mb-2 rounded-xl bg-secondary px-3 py-2 text-xs text-muted-foreground">
                    The last customer message was over 24 hours ago. WhatsApp requires an approved
                    template to restart the conversation; free-form replies are disabled.
                  </p>
                ) : null}
                <div className="flex items-end gap-2">
                  <textarea
                    value={reply}
                    onChange={(event) => setReply(event.target.value.slice(0, 4096))}
                    disabled={!inbox.data?.sendConfigured || !windowOpen}
                    maxLength={4096}
                    rows={2}
                    placeholder={
                      windowOpen
                        ? "Write a reply…"
                        : "Reply window closed — approved template required"
                    }
                    className="input-base min-h-12 flex-1 resize-y disabled:opacity-60"
                  />
                  <button
                    type="submit"
                    disabled={!canSend}
                    className="inline-flex h-11 items-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    <Send className="h-4 w-4" />
                    <span className="hidden sm:inline">{send.isPending ? "Sending…" : "Send"}</span>
                  </button>
                </div>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Replies and provider delivery statuses are saved in this thread. Media messages
                  save type and provider reference; media files are not downloaded.
                </p>
                {send.isError ? (
                  <p className="mt-1 text-xs text-destructive">{(send.error as Error).message}</p>
                ) : null}
              </form>
            </>
          ) : (
            <div className="grid flex-1 place-items-center p-8 text-center">
              <div>
                <MessageCircle className="mx-auto h-9 w-9 text-muted-foreground" />
                <p className="mt-2 text-sm font-semibold text-foreground">Select a conversation</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Message history will be kept here for future follow-up.
                </p>
              </div>
            </div>
          )}
          {inbox.error || thread.error ? (
            <p className="border-t border-destructive/20 bg-destructive/5 px-4 py-2 text-xs text-destructive">
              {((inbox.error ?? thread.error) as Error).message}
            </p>
          ) : null}
        </section>
      </div>
    </AppShell>
  );
}

function ConversationRow({
  conversation,
  selected,
  onClick,
}: {
  conversation: Conversation;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full rounded-2xl border p-3 text-left ${selected ? "border-primary bg-accent" : "border-transparent hover:bg-secondary/60"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-foreground">
            {conversation.customer_name || conversation.customer_phone}
          </p>
          <p className="truncate text-[11px] text-muted-foreground">
            {conversation.customer_phone}
          </p>
        </div>
        <span className="shrink-0 text-[10px] text-muted-foreground">
          {formatTime(conversation.last_message_at)}
        </span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
          {conversation.last_message_preview || "No message preview"}
        </p>
        {conversation.unread_count > 0 ? (
          <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[10px] font-bold text-primary-foreground">
            {conversation.unread_count > 99 ? "99+" : conversation.unread_count}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function formatTime(value: string) {
  return new Date(value).toLocaleString("en-KE", { dateStyle: "short", timeStyle: "short" });
}
