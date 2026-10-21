import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Star } from "lucide-react";
import { rateRide } from "@/lib/rides.functions";
import { getRideDriverRating } from "@/lib/ratings.functions";
import { createSupportCase } from "@/lib/support.functions";

export function DriverRatingBadge({ rideId }: { rideId: string }) {
  const fn = useServerFn(getRideDriverRating);
  const q = useQuery({ queryKey: ["ride-driver-rating", rideId], queryFn: () => fn({ data: { rideId } }) });
  if (!q.data || q.data.reviews === 0) return null;
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold text-foreground">
      <Star className="h-3.5 w-3.5 fill-gold text-gold" /> {q.data.average.toFixed(1)}
      <span className="font-normal text-muted-foreground">({q.data.reviews})</span>
    </span>
  );
}

export function RateTrip({ rideId }: { rideId: string }) {
  const qc = useQueryClient();
  const fn = useServerFn(getRideDriverRating);
  const rateFn = useServerFn(rateRide);
  const info = useQuery({ queryKey: ["ride-driver-rating", rideId], queryFn: () => fn({ data: { rideId } }) });
  const [score, setScore] = useState(5);
  const [comment, setComment] = useState("");
  const rate = useMutation({
    mutationFn: () => rateFn({ data: { rideId, score, comment: comment || undefined } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["ride-driver-rating", rideId] }),
  });
  const mine = info.data?.mine;
  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">{mine ? "Your rating" : "Rate your driver"}</h3>
        <DriverRatingBadge rideId={rideId} />
      </div>
      {mine ? (
        <p className="mt-2 text-sm text-foreground">{"★".repeat(mine.score)}{"☆".repeat(5 - mine.score)} {mine.comment ? `— “${mine.comment}”` : ""}</p>
      ) : (
        <>
          <div className="mt-2 flex gap-1" role="radiogroup" aria-label="Stars">
            {[1, 2, 3, 4, 5].map((v) => (
              <button key={v} onClick={() => setScore(v)} aria-label={`${v} star`} className="flex-1 py-1">
                <Star className={`mx-auto h-8 w-8 ${score >= v ? "fill-gold text-gold" : "text-muted-foreground"}`} />
              </button>
            ))}
          </div>
          <textarea value={comment} onChange={(e) => setComment(e.target.value.slice(0, 400))} rows={2} placeholder="Add a comment (optional)" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <button onClick={() => rate.mutate()} disabled={rate.isPending} className="mt-2 w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60">
            {rate.isPending ? "Sending…" : "Submit rating"}
          </button>
          {rate.isError && <p className="mt-2 text-sm text-destructive">{(rate.error as Error).message}</p>}
        </>
      )}
    </section>
  );
}

const CATEGORIES = [
  ["driver_conduct", "Driver behaviour"],
  ["safety", "Safety"],
  ["fare", "Fare / overcharge"],
  ["payment", "Payment"],
  ["vehicle", "Vehicle condition"],
  ["other", "Something else"],
] as const;

export function TripComplaint({ rideId, reference }: { rideId: string; reference: string }) {
  const fn = useServerFn(createSupportCase);
  const [open, setOpen] = useState(false);
  const [category, setCategory] = useState<(typeof CATEGORIES)[number][0]>("driver_conduct");
  const [text, setText] = useState("");
  const send = useMutation({ mutationFn: () => fn({ data: { rideId, category, description: text, subject: `Complaint on trip ${reference}` } }) });
  if (send.isSuccess)
    return (
      <section className="mt-4 rounded-xl border border-border bg-card p-4 text-sm">
        Complaint received. Our team will review trip {reference} and reply. <Link to="/account" className="font-semibold text-primary">Track it</Link>
      </section>
    );
  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4">
      {!open ? (
        <button onClick={() => setOpen(true)} className="w-full text-left text-sm font-semibold text-destructive">Report a problem with this trip</button>
      ) : (
        <>
          <h3 className="text-sm font-semibold text-foreground">Lodge a complaint · {reference}</h3>
          <div className="mt-2 flex flex-wrap gap-2">
            {CATEGORIES.map(([v, l]) => (
              <button key={v} onClick={() => setCategory(v)} className={`rounded-full border px-3 py-1.5 text-xs ${category === v ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>{l}</button>
            ))}
          </div>
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder="Tell us what happened (at least 10 characters)" className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm" />
          <div className="mt-2 flex gap-2">
            <button onClick={() => setOpen(false)} className="rounded-md border border-border px-4 py-2 text-sm">Cancel</button>
            <button onClick={() => send.mutate()} disabled={send.isPending || text.trim().length < 10} className="flex-1 rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">{send.isPending ? "Sending…" : "Send complaint"}</button>
          </div>
          {send.isError && <p className="mt-2 text-sm text-destructive">{(send.error as Error).message}</p>}
        </>
      )}
    </section>
  );
}
