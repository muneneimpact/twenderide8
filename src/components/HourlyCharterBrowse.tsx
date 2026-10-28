import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getPublicHireBrand, listHireVehicles } from "@/lib/hire.functions";
import { submitHourlyCharterRequest } from "@/lib/hourly-charter.functions";

type HourlyVehicle = {
  id: string;
  make: string | null;
  model: string | null;
  seats: number | null;
  vehicle_class: string;
  hire_mode: string;
  hire_hourly_available?: boolean;
  photo_link: string | null;
  photo_links: string[];
  hire_features: string | null;
};

type HourlyCharterBrowseProps = {
  ownerSlug: string | undefined;
  preselectedVehicleId?: string;
  initialStartAt?: string;
  initialHours?: number;
  onBack?: () => void;
  onSelectAnotherCar?: () => void;
  onSubmitted?: () => void;
};

const localDateTime = () => {
  const date = new Date(Date.now() + 60 * 60_000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};

export function HourlyCharterBrowse({
  ownerSlug,
  preselectedVehicleId,
  initialStartAt,
  initialHours,
  onBack,
  onSelectAnotherCar,
  onSubmitted,
}: HourlyCharterBrowseProps) {
  const qc = useQueryClient();
  const listFn = useServerFn(listHireVehicles);
  const submitFn = useServerFn(submitHourlyCharterRequest);
  const brandFn = useServerFn(getPublicHireBrand);
  const cars = useQuery({
    queryKey: ["hire-vehicles"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });
  const brand = useQuery({
    queryKey: ["public-hire-brand", ownerSlug],
    queryFn: () => brandFn({ data: { slug: ownerSlug! } }),
    enabled: Boolean(ownerSlug),
  });
  const [selected, setSelected] = useState<string | null>(preselectedVehicleId ?? null);
  const [startAt, setStartAt] = useState(initialStartAt ?? localDateTime);
  const [hours, setHours] = useState(String(Math.min(24, Math.max(1, initialHours ?? 2))));
  const [passengers, setPassengers] = useState("2");
  const [pickup, setPickup] = useState("");
  const [itinerary, setItinerary] = useState("");
  const [notes, setNotes] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const ownerCarIds = brand.data ? new Set(brand.data.vehicles.map((car) => car.id)) : null;
  const hourlyCars = ((cars.data ?? []) as unknown as HourlyVehicle[]).filter(
    (car) =>
      car.hire_hourly_available &&
      car.hire_mode !== "self_drive" &&
      (!ownerSlug || ownerCarIds?.has(car.id)) &&
      (!preselectedVehicleId || car.id === preselectedVehicleId),
  );
  const selectedCar = hourlyCars.find((car) => car.id === selected);
  const passengerCount = Number(passengers);
  const exceedsSeatCapacity = selectedCar?.seats != null && passengerCount > selectedCar.seats;
  const invalidPassengerCount =
    !Number.isInteger(passengerCount) || passengerCount < 1 || passengerCount > 12;

  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          vehicleId: selected!,
          startAt: new Date(startAt).toISOString(),
          durationHours: Number(hours),
          passengers: Number(passengers),
          pickupLabel: pickup,
          itinerary,
          notes,
        },
      }),
    onSuccess: async (result) => {
      setMessage(
        `Request ${result.reference} sent. The owner will send an offer here. Review the price and terms, then pay securely in Twende after accepting.`,
      );
      if (!preselectedVehicleId) {
        setSelected(null);
        setPickup("");
        setItinerary("");
        setNotes("");
      }
      onSubmitted?.();
      await qc.invalidateQueries({ queryKey: ["hire-quotes"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const standaloneStep = submit.isSuccess ? 3 : selected ? 2 : 1;

  return (
    <section className="mx-3 space-y-4 rounded-2xl border border-primary/25 bg-card p-4">
      {!preselectedVehicleId ? (
        <div aria-label="Hourly charter progress" className="rounded-xl border border-border p-3">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-semibold text-foreground">
              Step {standaloneStep} of 3 ·{" "}
              {standaloneStep === 1
                ? "Choose a car"
                : standaloneStep === 2
                  ? "Trip details"
                  : "Request sent"}
            </span>
            <span className="text-muted-foreground">Hourly hire</span>
          </div>
          <div
            className="mt-2 h-2 overflow-hidden rounded-full bg-secondary"
            role="progressbar"
            aria-valuemin={1}
            aria-valuemax={3}
            aria-valuenow={standaloneStep}
            aria-label={`Step ${standaloneStep} of 3`}
          >
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${(standaloneStep / 3) * 100}%` }}
            />
          </div>
        </div>
      ) : null}

      <div>
        <h2 className="font-display text-lg font-bold text-foreground">
          Car and driver · by the hour
        </h2>
        <p className="mt-1 text-xs text-muted-foreground">
          For appointments, waiting, multiple stops and return trips. Tell the owner when and where
          you need the car. The owner will send a price offer; you pay in Twende only after you
          accept it.
        </p>
      </div>

      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground"
        >
          Back to hire type
        </button>
      ) : null}

      {cars.isPending || brand.isPending ? (
        <p className="text-xs text-muted-foreground">Loading hourly cars…</p>
      ) : null}
      {cars.error || brand.error ? (
        <p className="text-xs text-destructive">{((cars.error ?? brand.error) as Error).message}</p>
      ) : null}
      {!cars.isPending &&
      !brand.isPending &&
      !cars.error &&
      !brand.error &&
      hourlyCars.length === 0 ? (
        <div className="space-y-2 rounded-xl bg-secondary p-3">
          <p className="text-xs text-muted-foreground">
            {preselectedVehicleId
              ? "This car is no longer accepting hourly requests. Choose another car or return to the day-hire option."
              : "No cars are accepting hourly charter requests right now. Owners can enable hourly trips for a car in their vehicle settings."}
          </p>
          {preselectedVehicleId && onSelectAnotherCar ? (
            <button
              type="button"
              onClick={onSelectAnotherCar}
              className="rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground"
            >
              Choose another car
            </button>
          ) : null}
        </div>
      ) : null}

      {!preselectedVehicleId ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {hourlyCars.map((car) => (
            <button
              type="button"
              key={car.id}
              onClick={() => {
                submit.reset();
                setSelected(car.id);
                setMessage(null);
              }}
              className={`overflow-hidden rounded-xl border-2 text-left ${selected === car.id ? "border-primary" : "border-border"}`}
            >
              {car.photo_link ? (
                <img
                  src={car.photo_link}
                  alt={`${car.make ?? "Car"} ${car.model ?? ""}`}
                  className="h-36 w-full object-cover"
                />
              ) : null}
              <span className="block p-3">
                <span className="block text-sm font-bold text-foreground">
                  {[car.make, car.model].filter(Boolean).join(" ") || "Car with a driver"}
                </span>
                <span className="text-xs text-muted-foreground">
                  {car.seats ?? "—"} seats · Driver included · Price by offer
                </span>
                {car.hire_features ? (
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {car.hire_features}
                  </span>
                ) : null}
                <span className="mt-1 block text-xs font-semibold text-primary">
                  {selected === car.id ? "Selected" : "Choose this car"}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : selectedCar ? (
        <div className="flex items-center gap-3 rounded-xl border border-border p-3">
          {selectedCar.photo_link ? (
            <img
              src={selectedCar.photo_link}
              alt=""
              className="size-16 shrink-0 rounded-lg object-cover"
            />
          ) : null}
          <div>
            <p className="text-sm font-semibold text-foreground">
              {[selectedCar.make, selectedCar.model].filter(Boolean).join(" ") ||
                "Car with a driver"}
            </p>
            <p className="text-xs text-muted-foreground">
              {selectedCar.seats ?? "—"} seats · Price by offer
            </p>
          </div>
        </div>
      ) : null}

      {selected && selectedCar ? (
        <form
          className="space-y-3 rounded-xl border border-border p-3"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            submit.mutate();
          }}
        >
          <h3 className="text-sm font-semibold text-foreground">Tell us about your trip</h3>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-muted-foreground">
              Pickup date and time
              <input
                required
                type="datetime-local"
                min={localDateTime()}
                value={startAt}
                onChange={(event) => setStartAt(event.target.value)}
                className="input-base mt-1"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Hours needed
              <input
                required
                type="number"
                min={1}
                max={24}
                value={hours}
                onChange={(event) => setHours(event.target.value)}
                className="input-base mt-1"
              />
            </label>
            <label className="text-xs text-muted-foreground">
              Passengers{selectedCar?.seats != null ? ` (max ${selectedCar.seats})` : ""}
              <input
                required
                type="number"
                min={1}
                max={Math.min(12, selectedCar?.seats ?? 12)}
                value={passengers}
                onChange={(event) => setPassengers(event.target.value)}
                className="input-base mt-1"
              />
            </label>
            {exceedsSeatCapacity ? (
              <p className="col-span-full text-xs text-destructive">
                This car has {selectedCar?.seats} seats. Enter no more than that number of
                passengers.
              </p>
            ) : null}
            <label className="text-xs text-muted-foreground">
              Pickup location
              <input
                required
                maxLength={200}
                value={pickup}
                onChange={(event) => setPickup(event.target.value)}
                placeholder="Where should the driver meet you?"
                className="input-base mt-1"
              />
            </label>
          </div>
          <label className="block text-xs text-muted-foreground">
            Stops, waiting and return plan
            <textarea
              required
              maxLength={1200}
              rows={3}
              value={itinerary}
              onChange={(event) => setItinerary(event.target.value)}
              placeholder="List destinations and how long you expect to wait. Include where you need to return."
              className="input-base mt-1"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Other details (optional)
            <textarea
              maxLength={1000}
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className="input-base mt-1"
            />
          </label>
          <p className="text-[11px] text-muted-foreground">
            This sends a request, not a booking or payment. The owner replies with a total price and
            terms. You can counteroffer if needed; only pay in Twende after accepting the offer.
          </p>
          <button
            disabled={
              submit.isPending ||
              submit.isSuccess ||
              !pickup.trim() ||
              !itinerary.trim() ||
              invalidPassengerCount ||
              exceedsSeatCapacity
            }
            className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {submit.isPending
              ? "Sending request…"
              : submit.isSuccess
                ? "Request sent"
                : "Request an offer"}
          </button>
        </form>
      ) : null}

      {message ? (
        <p role="status" className="rounded-xl bg-primary/5 p-3 text-xs text-foreground">
          {message}
        </p>
      ) : null}
    </section>
  );
}
