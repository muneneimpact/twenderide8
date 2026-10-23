import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { ArrowLeft, Bike, Car, CheckCircle2 } from "lucide-react";
import { submitPartnerInterest } from "@/lib/partner-interest.functions";

export const Route = createFileRoute("/drive-or-list")({
  head: () => ({
    meta: [
      { title: "Drive or list your car — Twende Meru Rides" },
      {
        name: "description",
        content: "Tell Twende Operations whether you want to drive or list cars for hire.",
      },
    ],
  }),
  component: DriveOrListPage,
});

type InterestType = "driver" | "car_owner";
const input = "w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm";

function DriveOrListPage() {
  const submitFn = useServerFn(submitPartnerInterest);
  const [requestType, setRequestType] = useState<InterestType>("driver");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [town, setTown] = useState("");
  const [preferredWorkType, setPreferredWorkType] = useState("boda");
  const [ownsVehicle, setOwnsVehicle] = useState(false);
  const [licencePsvStatus, setLicencePsvStatus] = useState("");
  const [numberOfCars, setNumberOfCars] = useState("1");
  const [bestTime, setBestTime] = useState("");
  const [note, setNote] = useState("");
  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          requestType,
          fullName: fullName.trim(),
          phone: phone.trim(),
          town: town.trim(),
          bestTime: bestTime.trim(),
          ...(requestType === "driver"
            ? {
                preferredWorkType: preferredWorkType as "boda" | "e_boda" | "car_taxi" | "delivery",
                ownsVehicle,
                licencePsvStatus: licencePsvStatus.trim() || undefined,
              }
            : { numberOfCars: Number(numberOfCars) || 0 }),
          note: note.trim() || undefined,
        },
      }),
    onSuccess: () => undefined,
  });
  if (submit.isSuccess) {
    return (
      <main className="hero-gradient flex min-h-screen items-center px-4 py-8">
        <section className="glass-strong mx-auto w-full max-w-md p-6 text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-gold" />
          <h1 className="mt-4 font-display text-2xl font-extrabold text-brand-foreground">
            Interest received
          </h1>
          <p className="mt-2 text-sm text-brand-foreground/85">
            We have received your interest. Twende Operations will contact you.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-full bg-gold px-5 py-2.5 text-sm font-bold text-gold-foreground"
          >
            Back to Twende
          </Link>
        </section>
      </main>
    );
  }
  return (
    <main className="min-h-screen bg-background px-4 py-5 sm:py-8">
      <div className="mx-auto max-w-xl">
        <Link to="/" className="inline-flex items-center gap-2 text-sm font-semibold text-primary">
          <ArrowLeft className="h-4 w-4" /> Back home
        </Link>
        <header className="mt-5 rounded-3xl hero-gradient p-6 text-brand-foreground shadow-xl">
          <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-brand-foreground/75">
            Twende partner interest
          </p>
          <h1 className="mt-2 font-display text-3xl font-extrabold">Drive or list your car</h1>
          <p className="mt-2 text-sm text-brand-foreground/85">
            Start with a quick introduction. Operations will guide you through the full approved
            onboarding later.
          </p>
        </header>
        <section className="mt-4 rounded-3xl border border-border bg-card p-4 shadow-sm sm:p-6">
          <div className="grid grid-cols-2 gap-2 rounded-2xl bg-secondary p-1">
            <button
              type="button"
              onClick={() => setRequestType("driver")}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold ${requestType === "driver" ? "bg-primary text-primary-foreground" : "text-muted-foreground"}`}
            >
              <Bike className="h-4 w-4" /> Drive with Twende
            </button>
            <button
              type="button"
              onClick={() => setRequestType("car_owner")}
              className={`flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-sm font-bold ${requestType === "car_owner" ? "bg-sky text-sky-foreground" : "text-muted-foreground"}`}
            >
              <Car className="h-4 w-4" /> List cars for hire
            </button>
          </div>
          <div className="mt-5 space-y-3">
            <label className="block text-xs font-semibold">
              Full name
              <input
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                required
                maxLength={120}
                className={`${input} mt-1`}
                placeholder="Your full name"
              />
            </label>
            <label className="block text-xs font-semibold">
              Phone number
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                required
                maxLength={30}
                className={`${input} mt-1`}
                placeholder="0712 345 678"
                inputMode="tel"
              />
            </label>
            <label className="block text-xs font-semibold">
              Town / operating area
              <input
                value={town}
                onChange={(e) => setTown(e.target.value)}
                required
                maxLength={120}
                className={`${input} mt-1`}
                placeholder="Meru town, Nkubu…"
              />
            </label>
            {requestType === "driver" ? (
              <>
                <label className="block text-xs font-semibold">
                  Preferred work type
                  <select
                    value={preferredWorkType}
                    onChange={(e) => setPreferredWorkType(e.target.value)}
                    className={`${input} mt-1`}
                  >
                    <option value="boda">Boda</option>
                    <option value="e_boda">E-boda</option>
                    <option value="car_taxi">Car / taxi</option>
                    <option value="delivery">Delivery</option>
                  </select>
                </label>
                <label className="flex items-center gap-2 rounded-2xl border border-border p-3 text-sm">
                  <input
                    type="checkbox"
                    checked={ownsVehicle}
                    onChange={(e) => setOwnsVehicle(e.target.checked)}
                  />{" "}
                  I own a vehicle
                </label>
                <label className="block text-xs font-semibold">
                  Licence / PSV status
                  <input
                    value={licencePsvStatus}
                    onChange={(e) => setLicencePsvStatus(e.target.value)}
                    maxLength={160}
                    className={`${input} mt-1`}
                    placeholder="e.g. PSV ready, licence renewal…"
                  />
                </label>
              </>
            ) : (
              <label className="block text-xs font-semibold">
                Number of cars you have
                <input
                  value={numberOfCars}
                  onChange={(e) => setNumberOfCars(e.target.value.replace(/\D/g, ""))}
                  required
                  min={1}
                  max={100}
                  inputMode="numeric"
                  className={`${input} mt-1`}
                />
              </label>
            )}
            <label className="block text-xs font-semibold">
              Best time to contact you
              <input
                value={bestTime}
                onChange={(e) => setBestTime(e.target.value)}
                required
                maxLength={100}
                className={`${input} mt-1`}
                placeholder="Weekdays after 5pm"
              />
            </label>
            <label className="block text-xs font-semibold">
              Optional note
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                maxLength={1000}
                rows={3}
                className={`${input} mt-1`}
                placeholder="Anything Operations should know?"
              />
            </label>
            <button
              type="button"
              onClick={() => submit.mutate()}
              disabled={
                submit.isPending ||
                !fullName.trim() ||
                !phone.trim() ||
                !town.trim() ||
                !bestTime.trim()
              }
              className="w-full rounded-full bg-primary px-4 py-3 text-sm font-bold text-primary-foreground disabled:opacity-50"
            >
              {submit.isPending ? "Sending…" : "Submit interest"}
            </button>
            {submit.isError ? (
              <p className="text-sm text-destructive">{(submit.error as Error).message}</p>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
