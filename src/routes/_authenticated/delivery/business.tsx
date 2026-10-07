import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { getMyDeliveryBusiness, submitDeliveryBusiness } from "@/lib/delivery.functions";

export const Route = createFileRoute("/_authenticated/delivery/business")({
  component: DeliveryBusinessPage,
});

function DeliveryBusinessPage() {
  const queryClient = useQueryClient();
  const fetchBusiness = useServerFn(getMyDeliveryBusiness);
  const submitBusiness = useServerFn(submitDeliveryBusiness);
  const business = useQuery({ queryKey: ["my-delivery-business"], queryFn: () => fetchBusiness() });
  const [businessName, setBusinessName] = useState("");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [baseFee, setBaseFee] = useState("");
  const [perKm, setPerKm] = useState("");
  const [perMinute, setPerMinute] = useState("");
  const [minimumFee, setMinimumFee] = useState("");
  const [vehicleIds, setVehicleIds] = useState<string[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const fleet = business.data?.fleet;
    if (!fleet) return;
    setBusinessName(fleet.delivery_business_name ?? fleet.business_name ?? "");
    setRegistrationNumber(fleet.registration_number ?? "");
    setContactPhone(fleet.contact_phone ?? "");
    setContactEmail(fleet.contact_email ?? "");
    const proposal = business.data?.latestRateProposal;
    setBaseFee(String(proposal?.base_fee ?? fleet.delivery_base_fee ?? ""));
    setPerKm(String(proposal?.per_km ?? fleet.delivery_per_km ?? ""));
    setPerMinute(String(proposal?.per_minute ?? fleet.delivery_per_minute ?? ""));
    setMinimumFee(String(proposal?.minimum_fee ?? fleet.delivery_minimum_fee ?? ""));
    setVehicleIds(
      (business.data?.vehicles ?? [])
        .filter((vehicle) => vehicle.fleet_id === fleet.id)
        .map((vehicle) => vehicle.id),
    );
  }, [business.data]);

  const submit = useMutation({
    mutationFn: () =>
      submitBusiness({
        data: {
          businessName,
          registrationNumber: registrationNumber.trim() || null,
          contactPhone: contactPhone.trim() || null,
          contactEmail: contactEmail.trim() || null,
          baseFee: Number(baseFee),
          perKm: Number(perKm),
          perMinute: Number(perMinute),
          minimumFee: Number(minimumFee),
          vehicleIds,
        },
      }),
    onSuccess: (result) => {
      setMessage(
        result.pendingRateProposal
          ? "Company details and vehicles saved. Your existing rate-card proposal is still awaiting Ops review."
          : result.fleetStatus === "approved"
            ? "Your update and proposed rates were submitted. Current rates stay live until Ops reviews the new proposal."
            : "Application submitted. Ops must approve your business and rate card before customers can book it.",
      );
      void queryClient.invalidateQueries({ queryKey: ["my-delivery-business"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-board"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const availableVehicles = business.data?.vehicles ?? [];
  const pendingRate = business.data?.latestRateProposal?.status === "pending";
  const toggleVehicle = (id: string, checked: boolean) =>
    setVehicleIds((current) =>
      checked ? [...new Set([...current, id])] : current.filter((item) => item !== id),
    );

  return (
    <AppShell title="Delivery business" eyebrow="Twende Delivery">
      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        <section className="surface-card p-4">
          <h2 className="font-display text-lg font-bold text-foreground">
            Register your delivery company
          </h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Companies propose their own base, distance and time rates. Ops reviews the company and
            rate card before they appear to customers. Customer quotes are calculated on the server
            from the approved rate card and actual route.
          </p>
          {business.isPending ? (
            <p className="mt-3 text-sm text-muted-foreground">Loading…</p>
          ) : null}
          {business.isError ? (
            <p className="mt-3 text-sm text-destructive">{(business.error as Error).message}</p>
          ) : null}
          {business.data?.fleet ? (
            <p className="mt-3 rounded-xl bg-secondary px-3 py-2 text-xs text-secondary-foreground">
              Business review: <strong>{business.data.fleet.status}</strong> · rate card:{" "}
              <strong>{business.data.fleet.delivery_rate_status.replaceAll("_", " ")}</strong>
            </p>
          ) : null}
          {pendingRate ? (
            <p className="mt-2 text-xs text-warning-foreground">
              A rate-card proposal is awaiting Ops review. Wait for the decision before submitting
              another rate card.
            </p>
          ) : null}

          <div className="mt-3 space-y-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Business name</span>
              <input
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                maxLength={120}
                className="input-base"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">
                Business registration number (optional)
              </span>
              <input
                value={registrationNumber}
                onChange={(e) => setRegistrationNumber(e.target.value)}
                maxLength={80}
                className="input-base"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Contact phone</span>
                <input
                  value={contactPhone}
                  onChange={(e) => setContactPhone(e.target.value)}
                  maxLength={24}
                  inputMode="tel"
                  className="input-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Contact email</span>
                <input
                  value={contactEmail}
                  onChange={(e) => setContactEmail(e.target.value)}
                  maxLength={160}
                  type="email"
                  className="input-base"
                />
              </label>
            </div>
          </div>
        </section>

        <section className="surface-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Proposed delivery rates (KES)</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Fee = base + route kilometres × per-km rate + route minutes × per-minute rate, subject
            to the minimum.
          </p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Base fee</span>
              <input
                value={baseFee}
                disabled={pendingRate}
                onChange={(e) => setBaseFee(e.target.value)}
                inputMode="decimal"
                className="input-base"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Per kilometre</span>
              <input
                value={perKm}
                disabled={pendingRate}
                onChange={(e) => setPerKm(e.target.value)}
                inputMode="decimal"
                className="input-base"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Per minute</span>
              <input
                value={perMinute}
                disabled={pendingRate}
                onChange={(e) => setPerMinute(e.target.value)}
                inputMode="decimal"
                className="input-base"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Minimum fee</span>
              <input
                value={minimumFee}
                disabled={pendingRate}
                onChange={(e) => setMinimumFee(e.target.value)}
                inputMode="decimal"
                className="input-base"
              />
            </label>
          </div>
        </section>

        <section className="surface-card p-4">
          <h2 className="text-sm font-semibold text-foreground">Add approved vehicles</h2>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Only vehicles you own and that Ops has approved can join this delivery fleet. Customers
            see a safe vehicle description and estimated approach time, not the driver's exact
            location or plate.
          </p>
          <div className="mt-2 space-y-2">
            {availableVehicles
              .filter((vehicle) => vehicle.status === "approved")
              .map((vehicle) => {
                const assignedElsewhere = Boolean(
                  vehicle.fleet_id && vehicle.fleet_id !== business.data?.fleet?.id,
                );
                return (
                  <label
                    key={vehicle.id}
                    className="flex items-center gap-3 rounded-xl border border-border p-3"
                  >
                    <input
                      type="checkbox"
                      checked={vehicleIds.includes(vehicle.id)}
                      disabled={assignedElsewhere || vehicle.fleet_id === business.data?.fleet?.id}
                      onChange={(event) => toggleVehicle(vehicle.id, event.target.checked)}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-foreground">
                        {[vehicle.make, vehicle.model, vehicle.colour].filter(Boolean).join(" ") ||
                          vehicle.vehicle_class}
                      </span>
                      <span className="block text-[10px] text-muted-foreground">
                        {vehicle.vehicle_class.replace("_", " ").toUpperCase()} ·{" "}
                        {vehicle.plate_number}
                        {assignedElsewhere
                          ? " · already assigned to another fleet"
                          : vehicle.fleet_id === business.data?.fleet?.id
                            ? " · already assigned to this fleet"
                            : ""}
                      </span>
                    </span>
                  </label>
                );
              })}
            {!availableVehicles.some((vehicle) => vehicle.status === "approved") ? (
              <p className="text-xs text-muted-foreground">
                No approved owner vehicles yet. Add and get a vehicle approved first.
              </p>
            ) : null}
          </div>
        </section>

        <button
          type="button"
          onClick={() => {
            setMessage(null);
            submit.mutate();
          }}
          disabled={
            submit.isPending ||
            businessName.trim().length < 2 ||
            (!pendingRate &&
              ![baseFee, perKm, perMinute, minimumFee].every(
                (value) => value !== "" && Number.isFinite(Number(value)) && Number(value) >= 0,
              ))
          }
          className="w-full rounded-full bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground disabled:opacity-50"
        >
          {submit.isPending
            ? "Submitting…"
            : pendingRate
              ? "Save company details and vehicles"
              : "Submit business and rate card"}
        </button>
        {message ? (
          <p
            className="rounded-xl bg-secondary p-3 text-xs text-secondary-foreground"
            role="status"
          >
            {message}
          </p>
        ) : null}
        {business.data?.latestRateProposal ? (
          <p className="text-[10px] text-muted-foreground">
            Latest rate proposal: {business.data.latestRateProposal.status} · submitted{" "}
            {new Date(business.data.latestRateProposal.submitted_at).toLocaleString("en-KE")}
            {business.data.latestRateProposal.review_note
              ? ` · ${business.data.latestRateProposal.review_note}`
              : ""}
          </p>
        ) : null}
      </div>
    </AppShell>
  );
}
