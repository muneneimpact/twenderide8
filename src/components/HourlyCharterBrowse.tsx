import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getPublicHireBrand, listHireVehicles } from "@/lib/hire.functions";
import { submitHourlyCharterRequest } from "@/lib/hourly-charter.functions";

type HourlyVehicle = {
  id: string; make: string | null; model: string | null; seats: number | null;
  vehicle_class: string; hire_mode: string; hire_hourly_available?: boolean;
  photo_link: string | null; photo_links: string[]; hire_features: string | null;
};
const localDateTime = () => {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function HourlyCharterBrowse({ ownerSlug }: { ownerSlug: string | undefined }) {
  const qc = useQueryClient();
  const listFn = useServerFn(listHireVehicles);
  const submitFn = useServerFn(submitHourlyCharterRequest);
  const brandFn = useServerFn(getPublicHireBrand);
  const cars = useQuery({ queryKey: ["hire-vehicles"], queryFn: () => listFn(), refetchInterval: 30_000 });
  const brand = useQuery({ queryKey: ["public-hire-brand", ownerSlug], queryFn: () => brandFn({ data: { slug: ownerSlug! } }), enabled: Boolean(ownerSlug) });
  const [selected, setSelected] = useState<string | null>(null);
  const [startAt, setStartAt] = useState(localDateTime);
  const [hours, setHours] = useState("2");
  const [passengers, setPassengers] = useState("2");
  const [pickup, setPickup] = useState("");
  const [itinerary, setItinerary] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const ownerCarIds = brand.data ? new Set(brand.data.vehicles.map((car) => car.id)) : null;
  const hourlyCars = ((cars.data ?? []) as unknown as HourlyVehicle[]).filter((car) => car.hire_hourly_available && car.hire_mode !== "self_drive" && (!ownerSlug || ownerCarIds?.has(car.id)));
  const submit = useMutation({
    mutationFn: () => submitFn({ data: { vehicleId: selected!, startAt: new Date(startAt).toISOString(), durationHours: Number(hours), passengers: Number(passengers), pickupLabel: pickup, itinerary, notes } }),
    onSuccess: async (result) => {
      setMessage(`Request ${result.reference} sent. The owner will send an offer here; you will review the price and pay in Twende only after accepting.`);
      setSelected(null); setPickup(""); setItinerary(""); setNotes("");
      await qc.invalidateQueries({ queryKey: ["hire-quotes"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });
  return (
    <section className="mx-3 space-y-4 rounded-2xl border border-primary/25 bg-card p-4">
      <div>
        <h2 className="font-display text-lg font-bold text-foreground">Chauffeured charter · by the hour</h2>
        <p className="mt-1 text-xs text-muted-foreground">For appointments, waiting, multiple stops, and return trips. Choose a car, request the hours and itinerary, then negotiate the total with its owner. No daily rate or automatic per-kilometre charge applies.</p>
      </div>
      {cars.isPending ? <p className="text-xs text-muted-foreground">Loading hourly charter cars…</p> : null}
      {cars.error ? <p className="text-xs text-destructive">{(cars.error as Error).message}</p> : null}
      {!cars.isPending && hourlyCars.length === 0 ? <p className="rounded-xl bg-secondary p-3 text-xs text-muted-foreground">No cars are accepting hourly charter requests right now. Owners can enable this per car in Driver → Hire cars → Vehicles.</p> : null}
      <div className="grid gap-2 sm:grid-cols-2">
        {hourlyCars.map((car) => <button type="button" key={car.id} onClick={() => setSelected(car.id)} className={`overflow-hidden rounded-xl border-2 text-left ${selected === car.id ? "border-primary" : "border-border"}`}>
          {car.photo_link ? <img src={car.photo_link} alt={`${car.make ?? "Car"} ${car.model ?? ""}`} className="h-36 w-full object-cover" /> : null}
          <span className="block p-3"><span className="block text-sm font-bold text-foreground">{[car.make, car.model].filter(Boolean).join(" ") || "Chauffeured car"}</span><span className="text-xs text-muted-foreground">{car.seats ?? "—"} seats · Driver included · Price by offer</span>{car.hire_features ? <span className="mt-1 block text-xs text-muted-foreground">{car.hire_features}</span> : null}<span className="mt-1 block text-xs font-semibold text-primary">{selected === car.id ? "Selected" : "Request this car"}</span></span>
        </button>)}
      </div>
      {selected ? <form className="space-y-3 rounded-xl border border-border p-3" onSubmit={(event) => { event.preventDefault(); setMessage(null); submit.mutate(); }}>
        <h3 className="text-sm font-semibold text-foreground">Request an hourly charter offer</h3>
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">Pickup date and time<input required type="datetime-local" min={localDateTime()} value={startAt} onChange={(event) => setStartAt(event.target.value)} className="input-base mt-1" /></label>
          <label className="text-xs text-muted-foreground">Hours<input required type="number" min={1} max={24} value={hours} onChange={(event) => setHours(event.target.value)} className="input-base mt-1" /></label>
          <label className="text-xs text-muted-foreground">Passengers<input required type="number" min={1} max={12} value={passengers} onChange={(event) => setPassengers(event.target.value)} className="input-base mt-1" /></label>
          <label className="text-xs text-muted-foreground">Pickup location<input required maxLength={200} value={pickup} onChange={(event) => setPickup(event.target.value)} placeholder="Where should the driver meet you?" className="input-base mt-1" /></label>
        </div>
        <label className="block text-xs text-muted-foreground">Stops, waiting and return plan<textarea required maxLength={1200} rows={3} value={itinerary} onChange={(event) => setItinerary(event.target.value)} placeholder="List destinations and how long you expect to wait. Include where you need to return." className="input-base mt-1" /></label>
        <label className="block text-xs text-muted-foreground">Other details (optional)<textarea maxLength={1000} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="input-base mt-1" /></label>
        <p className="text-[11px] text-muted-foreground">This sends a request, not a booking or payment. The owner replies with a total price and terms. You can counteroffer if needed; only pay in Twende after accepting agreed terms.</p>
        <button disabled={submit.isPending || !pickup.trim() || !itinerary.trim()} className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{submit.isPending ? "Sending request…" : "Request an offer"}</button>
      </form> : null}
      {message ? <p role="status" className="rounded-xl bg-primary/5 p-3 text-xs text-foreground">{message}</p> : null}
    </section>
  );
}
