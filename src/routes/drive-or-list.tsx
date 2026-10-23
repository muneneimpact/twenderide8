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
const towns = [
  "Meru town",
  "Makutano",
  "Maua",
  "Nkubu",
  "Mikinduri",
  "Timau",
  "Kiirua",
  "Kariene",
  "Igoji",
  "Chuka",
  "Kathwana",
  "Other",
] as const;
const contactTimes = [
  "Morning (8am–12pm)",
  "Afternoon (12pm–5pm)",
  "Evening (5pm–8pm)",
  "Weekdays",
  "Weekends",
] as const;

function DriveOrListPage() {
  const submitFn = useServerFn(submitPartnerInterest);
  const [requestType, setRequestType] = useState<InterestType>("driver");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [townSelection, setTownSelection] = useState<string>("Meru town");
  const [otherTown, setOtherTown] = useState("");
  const [preferredWorkType, setPreferredWorkType] = useState("boda");
  const [ownsVehicle, setOwnsVehicle] = useState(false);
  const [licencePsvStatus, setLicencePsvStatus] = useState("");
  const [numberOfCars, setNumberOfCars] = useState("1");
  const [selectedTimes, setSelectedTimes] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const town = townSelection === "Other" ? otherTown.trim() : townSelection;
  const bestTime = selectedTimes.includes("Anytime") ? "Anytime" : selectedTimes.join(", ");
  const toggleTime = (time: string) => {
    setSelectedTimes((current) =>
      current.includes(time) ? current.filter((item) => item !== time) : [...current, time],
    );
  };
  const submit = useMutation({
    mutationFn: () =>
      submitFn({
        data: {
          requestType,
          fullName: fullName.trim(),
          phone: phone.trim(),
          town,
          bestTime,
          ...(requestType === "driver"
            ? {
                preferredWorkType: preferredWorkType as "boda" | "e_boda" | "car_taxi" | "delivery",
                ownsVehicle,
                licencePsvStatus: licencePsvStatus || undefined,
              }
            : { numberOfCars: Number(numberOfCars) || 0 }),
          note: note.trim() || undefined,
        },
      }),
  });
  if (submit.isSuccess) {
    return (
      <main className="hero-gradient flex min-h-screen items-center overflow-hidden px-4 py-8">
        <style>{`@keyframes twende-drive { 0%, 100% { transform: translateX(-34px) rotate(-2deg); opacity: .55; } 50% { transform: translateX(34px) rotate(2deg); opacity: 1; } }`}</style>
        <section className="glass-strong mx-auto w-full max-w-md p-6 text-center">
          <div className="relative mx-auto h-20 max-w-[260px] overflow-hidden rounded-2xl bg-brand-foreground/10">
            <div className="absolute inset-x-4 bottom-3 border-b-2 border-dashed border-brand-foreground/40" />
            <Car
              className="absolute left-1/2 top-5 h-10 w-10 -translate-x-1/2 text-gold"
              style={{ animation: "twende-drive 2.4s ease-in-out infinite" }}
            />
          </div>
          <CheckCircle2 className="mx-auto mt-4 h-10 w-10 text-gold" />
          <h1 className="mt-3 font-display text-2xl font-extrabold text-brand-foreground">
            Your submission drove off!
          </h1>
          <p className="mt-2 text-sm text-brand-foreground/85">
            It has arrived at our station. We have received your interest and Twende Operations will
            contact you.
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
              <select
                value={townSelection}
                onChange={(e) => setTownSelection(e.target.value)}
                className={`${input} mt-1`}
              >
                {towns.map((townOption) => (
                  <option key={townOption}>{townOption}</option>
                ))}
              </select>
            </label>
            {townSelection === "Other" ? (
              <input
                value={otherTown}
                onChange={(e) => setOtherTown(e.target.value)}
                required
                maxLength={120}
                className={input}
                placeholder="Enter your town or operating area"
              />
            ) : null}
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
                  <select
                    value={licencePsvStatus}
                    onChange={(e) => setLicencePsvStatus(e.target.value)}
                    className={`${input} mt-1`}
                  >
                    <option value="">Select status</option>
                    <option>Licence and PSV ready</option>
                    <option>Licence ready, PSV in progress</option>
                    <option>Licence renewal needed</option>
                    <option>Not yet applied</option>
                    <option>Not sure — please advise</option>
                  </select>
                </label>
              </>
            ) : (
              <label className="block text-xs font-semibold">
                Cars you have
                <select
                  value={numberOfCars}
                  onChange={(e) => setNumberOfCars(e.target.value)}
                  className={`${input} mt-1`}
                >
                  {Array.from({ length: 10 }, (_, index) => (
                    <option key={index + 1} value={String(index + 1)}>
                      {index + 1}
                    </option>
                  ))}
                  <option value="11">10 and above</option>
                </select>
              </label>
            )}
            <fieldset>
              <legend className="text-xs font-semibold">
                Best time to contact you{" "}
                <span className="font-normal text-muted-foreground">(select all that work)</span>
              </legend>
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {[...contactTimes, "Anytime"].map((time) => (
                  <label
                    key={time}
                    className={`flex items-center gap-2 rounded-xl border p-2.5 text-xs ${selectedTimes.includes(time) ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <input
                      type="checkbox"
                      checked={selectedTimes.includes(time)}
                      onChange={() => toggleTime(time)}
                    />{" "}
                    {time}
                  </label>
                ))}
              </div>
            </fieldset>
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
              disabled={submit.isPending || !fullName.trim() || !phone.trim() || !town || !bestTime}
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
