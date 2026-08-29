import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { PlaceSearch } from "@/components/PlaceSearch";
import { getMe, reportIncident, updateProfile } from "@/lib/account.functions";
import { reverseGeocode } from "@/lib/rides.functions";

import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/account")({
  head: () => ({
    meta: [
      { title: "Your account — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Manage your Twende Meru Rides profile, verified phone number, saved places such as Home and Office, and open a support request about a trip.",
      },
      { property: "og:title", content: "Your account — Twende Meru Rides" },
      { property: "og:description", content: "Profile, saved places and support for your Meru trips." },
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
  const raiseIncident = useServerFn(reportIncident);
  const locate = useServerFn(reverseGeocode);


  const me = useQuery({ queryKey: ["me", "account"], queryFn: () => meFn() });
  const [fullName, setFullName] = useState("");
  const [placeLabel, setPlaceLabel] = useState("Home");
  const [place, setPlace] = useState<{ lat: number; lng: number; label: string; address: string | null } | null>(
    null,
  );
  const [rideId, setRideId] = useState("");
  const [issue, setIssue] = useState("");

  useEffect(() => {
    if (me.data?.profile?.full_name) setFullName(me.data.profile.full_name);
  }, [me.data?.profile?.full_name]);

  const places = useQuery({
    queryKey: ["saved-places"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("saved_places")
        .select("id, label, address, lat, lng")
        .order("created_at", { ascending: true });
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const rides = useQuery({
    queryKey: ["account", "recent-rides"],
    queryFn: async () => {
      const { data } = await supabase
        .from("rides")
        .select("id, reference, status, requested_at")
        .order("requested_at", { ascending: false })
        .limit(10);
      return data ?? [];
    },
  });

  const profileMutation = useMutation({
    mutationFn: () => saveProfile({ data: { full_name: fullName.trim() } }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["me"] }),
  });

  const addPlace = useMutation({
    mutationFn: async () => {
      if (!place) throw new Error("Search for the place first.");
      const { data: session } = await supabase.auth.getUser();
      const userId = session.user?.id;
      if (!userId) throw new Error("Please sign in again.");
      const { error } = await supabase.from("saved_places").insert({
        user_id: userId,
        label: placeLabel.trim() || place.label,
        address: place.address,
        lat: place.lat,
        lng: place.lng,
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      setPlace(null);
      void places.refetch();
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
      raiseIncident({
        data: {
          category: "other" as const,
          description: issue.trim(),
          ...(rideId ? { rideId } : {}),
        },
      }),
    onSuccess: () => setIssue(""),
  });

  const profile = me.data?.profile;
  const verified = Boolean(profile?.phone_verified_at);

  return (
    <AppShell title="Your account">
      <div className="mx-auto max-w-md space-y-5 px-4 py-4">
        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Profile</h2>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">Full name</span>
            <input value={fullName} onChange={(event) => setFullName(event.target.value)} className={field} />
          </label>
          <div className="mt-3 grid gap-1 text-sm">
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Phone</span>
              <span className="text-foreground">{profile?.phone ?? "—"}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Phone verified</span>
              <span className={verified ? "font-semibold text-foreground" : "text-destructive"}>
                {verified ? "Verified" : "Not verified"}
              </span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-muted-foreground">Email</span>
              <span className="truncate text-foreground">{profile?.email ?? "—"}</span>
            </div>
          </div>
          <button
            onClick={() => profileMutation.mutate()}
            disabled={profileMutation.isPending || fullName.trim().length < 2}
            className="mt-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {profileMutation.isPending ? "Saving…" : "Save profile"}
          </button>
          {profileMutation.isError && (
            <p className="mt-2 text-xs text-destructive">{(profileMutation.error as Error).message}</p>
          )}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Saved places</h2>
          <div className="mt-3 space-y-2">
            {(places.data ?? []).map((saved) => (
              <div
                key={saved.id}
                className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-background px-3.5 py-2.5"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-foreground">{saved.label}</span>
                  <span className="block truncate text-xs text-muted-foreground">{saved.address ?? "Saved pin"}</span>
                </span>
                <button
                  onClick={() => removePlace.mutate(saved.id)}
                  className="shrink-0 rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground"
                >
                  Remove
                </button>
              </div>
            ))}
            {places.data?.length === 0 ? (
              <p className="text-xs text-muted-foreground">Add Home and Office to book them in one tap.</p>
            ) : null}
          </div>

          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">Name this place</span>
            <input
              value={placeLabel}
              onChange={(event) => setPlaceLabel(event.target.value)}
              placeholder="Home, Office, Mum's"
              className={field}
            />
          </label>
          <div className="mt-2">
            <PlaceSearch
              placeholder="Search the address"
              value={place?.label ?? null}
              onPick={(found) =>
                setPlace({ lat: found.lat, lng: found.lng, label: found.label, address: found.address })
              }
            />
          </div>
          <button
            onClick={() => addPlace.mutate()}
            disabled={!place || addPlace.isPending}
            className="mt-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {addPlace.isPending ? "Saving…" : "Save this place"}
          </button>
          {addPlace.isError && <p className="mt-2 text-xs text-destructive">{(addPlace.error as Error).message}</p>}
        </section>

        <section className="rounded-2xl border border-border bg-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">Support</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Tell us what happened and our team replies in the app.
          </p>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">Which trip? (optional)</span>
            <select value={rideId} onChange={(event) => setRideId(event.target.value)} className={field}>
              <option value="">Not about a specific trip</option>
              {(rides.data ?? []).map((ride) => (
                <option key={ride.id} value={ride.id}>
                  {ride.reference} · {ride.status.replace(/_/g, " ")}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-3 block">
            <span className="text-xs font-medium text-muted-foreground">What went wrong?</span>
            <textarea
              value={issue}
              onChange={(event) => setIssue(event.target.value)}
              rows={4}
              maxLength={1000}
              className={field}
            />
          </label>
          <button
            onClick={() => support.mutate()}
            disabled={support.isPending || issue.trim().length < 10}
            className="mt-3 w-full rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-60"
          >
            {support.isPending ? "Sending…" : "Send to support"}
          </button>
          {support.isSuccess && <p className="mt-2 text-xs text-foreground">Thanks — our team has your request.</p>}
          {support.isError && <p className="mt-2 text-xs text-destructive">{(support.error as Error).message}</p>}
        </section>
      </div>
    </AppShell>
  );
}
