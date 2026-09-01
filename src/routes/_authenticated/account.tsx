import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PlaceSearch } from "@/components/PlaceSearch";
import { getMe, updateProfile, getMyPhotoUrl } from "@/lib/account.functions";
import {
  createSupportCase,
  getAccountActivity,
  listMyPromotions,
  listMySupportCases,
  postSupportMessage,
  updateAccountPreferences,
} from "@/lib/support.functions";
import { validatePromoCode } from "@/lib/admin.functions";
import type { PromoState } from "@/lib/discounts";
import { reverseGeocode } from "@/lib/rides.functions";

import { supabase } from "@/integrations/supabase/client";


export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Your account — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Manage your Twende Meru Rides profile, verified phone number, saved places, promotions, support requests and recent activity.",
      },
      { property: "og:title", content: "Your account — Twende Meru Rides" },
      { property: "og:description", content: "Profile, places, promotions and support for your Meru trips." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AccountPage,
});

const field =
  "mt-1 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring";

function AccountPage() {
  const queryClient = useQueryClient();
  const meFn = useServerFn(getMe);
  const saveProfile = useServerFn(updateProfile);
  const savePreferences = useServerFn(updateAccountPreferences);
  const locate = useServerFn(reverseGeocode);
  const promosFn = useServerFn(listMyPromotions);
  const casesFn = useServerFn(listMySupportCases);
  const openCaseFn = useServerFn(createSupportCase);
  const replyFn = useServerFn(postSupportMessage);
  const activityFn = useServerFn(getAccountActivity);
  const checkPromo = useServerFn(validatePromoCode);
  const myPhotoFn = useServerFn(getMyPhotoUrl);
  const photoInput = useRef<HTMLInputElement | null>(null);

  const me = useQuery({ queryKey: ["me", "account"], queryFn: () => meFn() });
  const [fullName, setFullName] = useState("");
  const [placeLabel, setPlaceLabel] = useState("Home");
  const [place, setPlace] = useState<{ lat: number; lng: number; label: string; address: string | null } | null>(null);
  const [rideId, setRideId] = useState("");
  const [issue, setIssue] = useState("");

  const [paymentPref, setPaymentPref] = useState("stk_push");
  const [driverCodePref, setDriverCodePref] = useState("sms");
  const [promoInput, setPromoInput] = useState("");
  const [promoResult, setPromoResult] = useState<{ valid: boolean; state: PromoState; message?: string; discount_percent?: number; total_fare?: number } | null>(null);
  const [activeCaseId, setActiveCaseId] = useState<string | null>(null);
  const [replies, setReplies] = useState<Record<string, string>>({});

  const promotions = useQuery({ queryKey: ["account", "promotions"], queryFn: () => promosFn() });
  const supportCases = useQuery({ queryKey: ["account", "cases"], queryFn: () => casesFn() });
  const activityFeed = useQuery({ queryKey: ["account", "activity"], queryFn: () => activityFn() });
  const cases = supportCases.data ?? [];
  const activity = activityFeed.data ?? [];


  useEffect(() => {
    const p = me.data?.profile as
      | { full_name?: string | null; payment_preference?: string | null; share_driver_code?: boolean | null }
      | null
      | undefined;
    if (p?.full_name) setFullName(p.full_name);
    if (p?.payment_preference) setPaymentPref(p.payment_preference);
    if (p && typeof p.share_driver_code === "boolean") setDriverCodePref(p.share_driver_code ? "sms" : "email");
  }, [me.data?.profile]);

  useEffect(() => {
    if (!activeCaseId && cases.length > 0) setActiveCaseId(cases[0]!.id);
  }, [activeCaseId, cases]);

  // Live replies from the support team.
  useEffect(() => {
    const channel = supabase
      .channel("support-messages-customer")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "support_messages" }, () => {
        void supportCases.refetch();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  const places = useQuery({
    queryKey: ["saved-places"],
    queryFn: async () => {
      const { data, error } = await supabase.from("saved_places").select("id, label, address, lat, lng").order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const rides = useQuery({
    queryKey: ["account", "recent-rides"],
    queryFn: async () => {
      const { data } = await supabase.from("rides").select("id, reference, status, requested_at").order("requested_at", { ascending: false }).limit(10);
      return data ?? [];
    },
  });

  const profileMutation = useMutation({
    mutationFn: async () => {
      await saveProfile({ data: { full_name: fullName.trim() } });
      await savePreferences({
        data: {
          payment_preference: paymentPref === "cash" ? ("cash" as const) : ("stk_push" as const),
          share_driver_code: driverCodePref === "sms",
        },
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const photoUrl = useQuery({ queryKey: ["account", "photo"], queryFn: () => myPhotoFn() });

  const uploadPhoto = useMutation({
    mutationFn: async (file: File) => {
      const { data: session } = await supabase.auth.getUser();
      const userId = session.user?.id;
      if (!userId) throw new Error("Please sign in again.");
      const path = `${userId}/avatar-${Date.now()}-${file.name.replace(/[^\w.\-]/g, "")}`;
      const { error } = await supabase.storage.from("driver-documents").upload(path, file, { upsert: true });
      if (error) throw new Error(error.message);
      await savePreferences({ data: { avatar_path: path } });
    },
    onSuccess: () => {
      void photoUrl.refetch();
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    },
  });


  const addPlace = useMutation({
    mutationFn: async () => {
      if (!place) throw new Error("Search for the place first.");
      const { data: session } = await supabase.auth.getUser();
      const userId = session.user?.id;
      if (!userId) throw new Error("Please sign in again.");
      const { error } = await supabase.from("saved_places").insert({ user_id: userId, label: placeLabel.trim() || place.label, address: place.address, lat: place.lat, lng: place.lng });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setPlace(null);
      void places.refetch();
    },
  });

  const useHere = useMutation({
    mutationFn: async () => {
      if (typeof navigator === "undefined" || !navigator.geolocation) throw new Error("This device cannot share its location.");
      const position = await new Promise<GeolocationPosition>((resolve, reject) => navigator.geolocation.getCurrentPosition(resolve, reject, { enableHighAccuracy: true, timeout: 12000, maximumAge: 15000 }));
      const found = await locate({ data: { lat: position.coords.latitude, lng: position.coords.longitude } });
      setPlace({ lat: found.lat, lng: found.lng, label: found.label ?? "Current location", address: found.address });
    },
  });

  const removePlace = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("saved_places").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => void places.refetch(),
  });

  const support = useMutation({
    mutationFn: () =>
      openCaseFn({
        data: {
          category: "general" as const,
          description: issue.trim(),
          ...(rideId ? { rideId } : {}),
        },
      }),
    onSuccess: (created) => {
      setIssue("");
      setActiveCaseId(created.id);
      void supportCases.refetch();
      void activityFeed.refetch();
    },
  });

  const applyPromo = useMutation({
    mutationFn: () => checkPromo({ data: { code: promoInput.trim().toUpperCase(), totalFare: 450 } }),
    onSuccess: (result) => setPromoResult(result as typeof promoResult),
  });

  const sendReply = useMutation({
    mutationFn: (caseId: string) => replyFn({ data: { caseId, body: (replies[caseId] ?? "").trim() } }),
    onSuccess: (_r, caseId) => {
      setReplies((prev) => ({ ...prev, [caseId]: "" }));
      void supportCases.refetch();
    },
  });


  const profile = me.data?.profile;
  const verified = Boolean(profile?.phone_verified_at);
  const activeCase = cases.find((c) => c.id === activeCaseId) ?? null;

  return (
    <AppShell title="Your account">
      <div className="mx-auto max-w-md space-y-5 px-4 py-4">
        {/* Profile */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Profile</h2>
          <div className="mt-3 flex items-center gap-3">
            {photoUrl.data?.url ? (
              <img src={photoUrl.data.url} alt="Your profile" className="h-16 w-16 shrink-0 rounded-full object-cover" />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-secondary text-xl font-bold text-secondary-foreground">
                {(profile?.full_name ?? profile?.email ?? "U").charAt(0).toUpperCase()}
              </span>
            )}
            <div>
              <input
                ref={photoInput}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) uploadPhoto.mutate(file);
                }}
              />
              <button
                type="button"
                onClick={() => photoInput.current?.click()}
                disabled={uploadPhoto.isPending}
                className="rounded-full border border-input bg-secondary px-3.5 py-2 text-xs font-semibold text-foreground disabled:opacity-60"
              >
                {uploadPhoto.isPending ? "Uploading…" : photoUrl.data?.url ? "Change photo" : "Add a photo"}
              </button>
              {uploadPhoto.isError && <p className="mt-1 text-xs text-destructive">{(uploadPhoto.error as Error).message}</p>}
            </div>
          </div>

          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">Full name</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} className={field} />
          </label>
          <div className="mt-3 grid gap-1 text-sm">
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Email</span><span className="truncate text-foreground">{profile?.email ?? "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Phone (required)</span><span className="text-foreground">{profile?.phone ?? "—"}</span></div>
            <div className="flex justify-between gap-3"><span className="text-muted-foreground">Phone verified</span><span className={verified ? "font-semibold text-foreground" : "text-destructive"}>{verified ? "Verified" : "Not verified"}</span></div>
          </div>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">Preferred payment method</span>
            <select value={paymentPref} onChange={(e) => setPaymentPref(e.target.value)} className={field}>
              <option value="stk_push">M-PESA</option>
              <option value="cash">Cash</option>
            </select>
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">Driver verification code</span>
            <select value={driverCodePref} onChange={(e) => setDriverCodePref(e.target.value)} className={field}>
              <option value="sms">By SMS</option>
              <option value="email">By email</option>
            </select>
          </label>
          <button onClick={() => profileMutation.mutate()} disabled={profileMutation.isPending || fullName.trim().length < 2} className="mt-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {profileMutation.isPending ? "Saving…" : "Save profile"}
          </button>
          {profileMutation.isError && <p className="mt-2 text-xs text-destructive">{(profileMutation.error as Error).message}</p>}
        </section>

        {/* Saved places */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Saved places</h2>
          <div className="mt-3 space-y-2">
            {(places.data ?? []).map((saved) => (
              <div key={saved.id} className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-3.5 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{saved.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{saved.address ?? "Saved pin"}</span>
                </span>
                {/* TODO(lovable-backend): allow editing a saved place's label/address server-side. */}
                <button onClick={() => removePlace.mutate(saved.id)} className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground">Remove</button>
              </div>
            ))}
            {places.data?.length === 0 && <p className="text-xs text-muted-foreground">Add Home and Office to book them in one tap.</p>}
          </div>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">Name this place</span>
            <input value={placeLabel} onChange={(e) => setPlaceLabel(e.target.value)} placeholder="Home, Office, Mum's" className={field} />
          </label>
          <div className="mt-2">
            <PlaceSearch placeholder="Search the address" value={place?.label ?? null} onPick={(found) => setPlace({ lat: found.lat, lng: found.lng, label: found.label, address: found.address })} />
          </div>
          <button type="button" onClick={() => useHere.mutate()} disabled={useHere.isPending} className="mt-2 w-full rounded-full border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground disabled:opacity-60">
            {useHere.isPending ? "Finding you…" : "Use current location"}
          </button>
          {useHere.isError && <p className="mt-2 text-xs text-destructive">{(useHere.error as Error).message}</p>}
          <button onClick={() => addPlace.mutate()} disabled={!place || addPlace.isPending} className="mt-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {addPlace.isPending ? "Saving…" : "Save this place"}
          </button>
          {addPlace.isError && <p className="mt-2 text-xs text-destructive">{(addPlace.error as Error).message}</p>}
        </section>

        {/* Promotions & promo codes */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Promotions</h2>
          <ul className="mt-3 space-y-2">
            {(promotions.data?.promotions ?? []).map((promo) => (
              <li key={promo.code} className="rounded-2xl border border-border p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-foreground">{promo.code} · {promo.name}</p>
                  <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-secondary-foreground">
                    {promo.state === "active" ? "Live" : promo.state === "usage_exhausted" ? "Used up" : promo.state}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{promo.description ?? ""} · {promo.discount_percent}% off, capped at {promo.max_discount_percent}%{promo.used ? " · used" : ""}</p>
              </li>
            ))}
            {promotions.data?.promotions.length === 0 && (
              <li className="text-xs text-muted-foreground">No offers are live right now — check back soon.</li>
            )}
          </ul>
          {(promotions.data?.redemptions.length ?? 0) > 0 && (
            <div className="mt-3">
              <h3 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">Codes you have used</h3>
              <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                {(promotions.data?.redemptions ?? []).map((r) => (
                  <li key={`${r.code}-${r.created_at}`} className="flex justify-between gap-3">
                    <span>{r.code}</span>
                    <span>Saved KES {r.discount_amount.toFixed(2)} · {new Date(r.created_at).toLocaleDateString("en-KE")}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-3 space-y-2">
            <div className="flex gap-2">
              <input value={promoInput} onChange={(e) => setPromoInput(e.target.value)} placeholder="Enter a promo code" className={`${field} uppercase`} />
              <button onClick={() => applyPromo.mutate()} disabled={promoInput.trim().length < 2 || applyPromo.isPending} className="shrink-0 rounded-xl border border-input bg-secondary px-4 py-2.5 text-sm font-semibold disabled:opacity-60">{applyPromo.isPending ? "Checking…" : "Apply"}</button>
            </div>

            {promoResult && (
              <div className={promoResult.valid ? "rounded-xl bg-success/10 px-3 py-2.5 text-xs text-success" : "rounded-xl bg-destructive/10 px-3 py-2.5 text-xs text-destructive"}>
                {promoResult.valid ? (<><p className="font-semibold">Code applied — {promoResult.discount_percent}% off</p><p>New estimated fare: KES {Number(promoResult.total_fare ?? 0).toFixed(2)}</p></>) : (<p>{promoResult.message}</p>)}
              </div>
            )}
          </div>
        </section>

        {/* Support */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Support</h2>
          <p className="mt-1 text-xs text-muted-foreground">Select a trip and tell us what happened. Our team replies in the app.</p>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">Which trip? (optional)</span>
            <select value={rideId} onChange={(e) => setRideId(e.target.value)} className={field}>
              <option value="">Not about a specific trip</option>
              {(rides.data ?? []).map((ride) => (<option key={ride.id} value={ride.id}>{ride.reference} · {ride.status.replace(/_/g, " ")}</option>))}
            </select>
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">What happened?</span>
            <textarea value={issue} onChange={(e) => setIssue(e.target.value)} rows={4} maxLength={1000} className={field} />
          </label>
          <button onClick={() => support.mutate()} disabled={support.isPending || issue.trim().length < 10} className="mt-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60">
            {support.isPending ? "Sending…" : "Send to support"}
          </button>
          {support.isSuccess && <p className="mt-2 text-xs text-foreground">Thanks — our team has your request.</p>}
          {support.isError && <p className="mt-2 text-xs text-destructive">{(support.error as Error).message}</p>}

          <div className="mt-5">
            <h3 className="text-sm font-semibold text-foreground">Your support conversations</h3>
            <div className="mt-2 space-y-2">
              {cases.map((c) => (
                <button key={c.id} onClick={() => setActiveCaseId(c.id)} className={`block w-full rounded-2xl border p-3 text-left ${c.id === activeCaseId ? "border-primary bg-accent" : "border-border bg-background"}`}>
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-foreground">{c.subject}</p>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${c.status === "resolved" ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{c.status === "resolved" ? "Resolved" : c.status === "in_progress" ? "In progress" : "Open"}</span>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{c.trip_reference ?? "No trip"} · {new Date(c.created_at).toLocaleString("en-KE")}</p>
                </button>
              ))}
              {cases.length === 0 && <p className="text-xs text-muted-foreground">You have no support conversations yet.</p>}
            </div>
            {activeCase && (
              <div className="mt-3 rounded-2xl border border-border p-3">
                <div className="space-y-2">
                  {activeCase.messages.map((m) => (
                    <div key={m.id} className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.from === "customer" ? "ml-auto bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
                      <p>{m.body}</p>
                      <p className="mt-0.5 text-[10px] opacity-70">{new Date(m.created_at).toLocaleTimeString("en-KE")}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <input value={replies[activeCase.id] ?? ""} onChange={(e) => setReplies((prev) => ({ ...prev, [activeCase.id]: e.target.value }))} placeholder="Type a reply…" className={field} />
                  <button onClick={() => sendReply.mutate(activeCase.id)} disabled={!(replies[activeCase.id] ?? "").trim() || sendReply.isPending} className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60">Send</button>
                </div>
              </div>
            )}

          </div>
        </section>

        {/* Jijenge with Twende Meru */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Jijenge with Twende Meru</h2>
          <p className="mt-1 text-xs text-muted-foreground">Earn by driving with Twende Meru Rides. Register your vehicle and documents to get approved.</p>
          <Link to="/driver/apply" className="mt-3 block w-full rounded-full bg-primary px-4 py-3 text-center text-sm font-bold text-primary-foreground">Become a Driver</Link>
        </section>

        {/* Recent activity (newest first) */}
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Recent activity</h2>
          <ol className="mt-3 space-y-2">
            {activity.map((item) => (
              <li key={item.id} className="rounded-2xl border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{item.detail}</p>
                  </div>
                  <span className="shrink-0 text-[11px] text-muted-foreground">{new Date(item.created_at).toLocaleString("en-KE")}</span>
                </div>
                {item.payment_kind && <p className="mt-1 text-[11px] text-muted-foreground">Payment: {item.payment_kind === "mpesa" ? "M-PESA" : item.payment_kind === "cash" ? "Cash" : "Refund"}</p>}
              </li>
            ))}
            {activity.length === 0 && <li className="text-xs text-muted-foreground">Nothing here yet — your trips and payments will appear here.</li>}
          </ol>

        </section>
      </div>
    </AppShell>
  );
}
