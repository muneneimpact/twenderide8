import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  listOwnerBookings,
  markHireHandover,
  requestHandoverDeposit,
  getOwnerCompanyKycDocument,
  ownerConfirmCompanyBooking,
  ownerDeclineHire,
  ownerApplySavedSignature,
  type OwnerBooking,
} from "@/lib/hire-owner.functions";
import { requestHirePaymentReminder } from "@/lib/hire.functions";
import {
  calculateFuelShortfall,
  HIRE_EXCESS_KM_RATE,
  HIRE_INCLUDED_KM_PER_DAY,
} from "@/lib/hire-rules";

const fmt = (iso: string) =>
  new Date(iso).toLocaleString("en-KE", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });

function stage(b: OwnerBooking) {
  if (b.lifecycle_state === "closed" || b.returned_at)
    return { label: "Completed", tone: "bg-secondary text-muted-foreground" };
  if (b.lifecycle_state === "on_hire" || b.handed_over_at)
    return { label: "On hire", tone: "bg-primary/15 text-primary" };
  if (b.lifecycle_state === "submitted" && b.pay_later)
    return { label: "Verify company", tone: "bg-warning/15 text-warning" };
  if (b.lifecycle_state === "ready_for_handover" || b.status === "confirmed")
    return { label: "Ready to hand over", tone: "bg-success/15 text-success" };
  if (b.lifecycle_state === "settlement_pending")
    return { label: "Settling return", tone: "bg-warning/15 text-warning" };
  return { label: "Awaiting payment", tone: "bg-warning/15 text-warning" };
}

function nextBookingAction(b: OwnerBooking) {
  if (b.lifecycle_state === "closed" || b.returned_at) return "Completed";
  if (b.lifecycle_state === "on_hire" || b.handed_over_at)
    return b.end_at && new Date(b.end_at).getTime() <= Date.now()
      ? "Record car return"
      : "Awaiting car return";
  if (b.lifecycle_state === "submitted" && b.pay_later && !b.company_verified) return "Verify company";
  if (b.lifecycle_state === "ready_for_handover" && b.deposit_policy === "handover" && b.deposit_amount > 0) {
    if (!b.deposit_requested) return "Request deposit";
    if (b.paid < b.total) return "Waiting for payment";
  }
  if (b.lifecycle_state === "ready_for_handover" || b.status === "confirmed") return "Hand over car";
  return "Waiting for payment";
}

/** Owner/driver view of booked days with one-tap handover and return. */
export function OwnerHireBookings() {
  const qc = useQueryClient();
  const listFn = useServerFn(listOwnerBookings);
  const handFn = useServerFn(markHireHandover);
  const declineFn = useServerFn(ownerDeclineHire);
  const signFn = useServerFn(ownerApplySavedSignature);
  const depositFn = useServerFn(requestHandoverDeposit);
  const verifyFn = useServerFn(ownerConfirmCompanyBooking);
  const kycFn = useServerFn(getOwnerCompanyKycDocument);
  const depositReq = useMutation({
    mutationFn: (quoteId: string) => depositFn({ data: { quoteId } }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["owner-hire-bookings"] }),
    onError: (e: Error) => setErr(e.message),
  });
  const q = useQuery({
    queryKey: ["owner-hire-bookings"],
    queryFn: () => listFn(),
    refetchInterval: 30_000,
  });
  const [declining, setDeclining] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [returning, setReturning] = useState<string | null>(null);
  const [selectedBooking, setSelectedBooking] = useState<string | null>(null);
  const [ret, setRet] = useState({
    deposit: "",
    odometer: "",
    fuelLevel: "Full" as "Full" | "3/4" | "1/2" | "1/4" | "Reserve",
    fuel: "0",
    fines: "0",
    waiveKm: false,
    waiveFuel: false,
    notes: "",
  });
  const [err, setErr] = useState<string | null>(null);
  const refresh = () => void qc.invalidateQueries({ queryKey: ["owner-hire-bookings"] });
  const hand = useMutation({
    mutationFn: (v: {
      quoteId: string;
      step: "handed_over" | "returned";
      settlement?: {
        deposit: number;
        odometer: number;
        fuelLevel: "Full" | "3/4" | "1/2" | "1/4" | "Reserve";
        fuelCharge: number;
        penalties: number;
        waiveExcessKm: boolean;
        waiveFuel: boolean;
        notes?: string | undefined;
      };
    }) => handFn({ data: v }),
    onSuccess: (_result, vars) => {
      if (vars.step === "returned") setSelectedBooking(null);
      setReturning(null);
      refresh();
    },
    onError: (e) => setErr((e as Error).message),
  });
  const decline = useMutation({
    mutationFn: (quoteId: string) => declineFn({ data: { quoteId, reason } }),
    onSuccess: () => {
      setSelectedBooking(null);
      setDeclining(null);
      setReason("");
      refresh();
    },
    onError: (e) => setErr((e as Error).message),
  });

  const sign = useMutation({
    mutationFn: (quoteId: string) => signFn({ data: { quoteId } }),
    onSuccess: refresh,
    onError: (e) => setErr((e as Error).message),
  });
  const verify = useMutation({
    mutationFn: (quoteId: string) => verifyFn({ data: { quoteId } }),
    onSuccess: refresh,
    onError: (e) => setErr((e as Error).message),
  });
  const openKyc = useMutation({
    mutationFn: (input: { quoteId: string; kind: "certificate" | "kra_pin" | "cr12" | "other" }) =>
      kycFn({ data: input }),
    onSuccess: ({ url }) => window.open(url, "_blank", "noopener,noreferrer"),
    onError: (e) => setErr((e as Error).message),
  });
  const remindFn = useServerFn(requestHirePaymentReminder);
  const remind = useMutation({
    mutationFn: (vars: { quoteId: string; amount: number }) =>
      remindFn({ data: { ...vars, channels: ["sms", "email", "whatsapp"] } }),
    onSuccess: (r) => {
      setErr(null);
      refresh();
      if (!r.accepted) setErr(r.message);
    },
    onError: (e) => setErr((e as Error).message),
  });
  const SignTick = ({ b }: { b: OwnerBooking }) => (
    <label className="mt-2 flex items-center gap-2 rounded-lg bg-secondary/50 p-2">
      <input
        type="checkbox"
        checked={b.owner_signed}
        disabled={b.owner_signed || sign.isPending}
        onChange={() => sign.mutate(b.id)}
        className="h-4 w-4 accent-primary"
      />
      <span className="font-medium text-foreground">
        {b.owner_signed
          ? "✓ Your signature is on the agreement"
          : "Tick to add your saved signature"}
      </span>
      <span className="ml-auto text-muted-foreground">
        Hirer {b.hirer_signed ? "✓" : "—"}
        {b.agreement_completed ? " · Complete" : ""}
      </span>
    </label>
  );

  const rows = q.data ?? [];
  const upcoming = rows.filter((b) => !b.returned_at);
  const past = rows.filter((b) => b.returned_at);

  return (
    <section id="owner-bookings" className="surface-card scroll-mt-20 p-4">
      <h2 className="font-display text-lg font-semibold text-foreground">Bookings & handovers</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Upcoming pickups and returns for your cars.
      </p>
      {q.isPending ? <p className="mt-3 text-xs text-muted-foreground">Loading…</p> : null}
      {q.isSuccess && !upcoming.length ? (
        <p className="mt-3 text-xs text-muted-foreground">No upcoming hires.</p>
      ) : null}
      <ul className={`mt-3 space-y-3 ${selectedBooking ? "fixed inset-0 z-50 overflow-y-auto bg-background p-4 pb-10" : ""}`}>
        {upcoming.map((b) => {
          const s = stage(b);
          return (
            <li key={b.id} className={`${selectedBooking && selectedBooking !== b.id ? "hidden" : ""} ${selectedBooking === b.id ? "mx-auto max-w-2xl rounded-2xl border border-border bg-card p-4 text-xs shadow-xl" : "rounded-xl border border-border p-3 text-xs"}`}>
              <button type="button" onClick={() => setSelectedBooking(b.id)} className={`w-full rounded-xl bg-secondary/50 p-3 text-left ${selectedBooking ? "hidden" : ""}`}>
                <span className="flex items-start justify-between gap-2"><span><span className="block text-sm font-semibold text-foreground">{b.vehicle}</span><span className="mt-0.5 block text-xs text-muted-foreground">{b.reference} · {b.renter} · {fmt(b.start_at)}</span></span><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${s.tone}`}>{s.label}</span></span>
                <span className="mt-2 block text-xs text-muted-foreground">{b.days} day(s) · KES {b.total.toLocaleString("en-KE")} · paid KES {b.paid.toLocaleString("en-KE")}</span>
                <span className="mt-2 inline-flex rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground">{nextBookingAction(b)} →</span>
              </button>
              {selectedBooking === b.id ? <button type="button" onClick={() => { setSelectedBooking(null); setReturning(null); setDeclining(null); }} className="mb-3 rounded-full border border-border px-3 py-1.5 text-xs font-semibold text-foreground">← All bookings</button> : null}
              <div className={selectedBooking === b.id ? "" : "hidden"}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-foreground">{b.vehicle}</p>
                  <p className="text-muted-foreground">
                    {b.reference} · {b.renter}
                    {b.hirer_type === "company" ? " (company)" : ""}
                  </p>
                </div>
                <span className={`shrink-0 rounded-full px-2 py-0.5 font-semibold ${s.tone}`}>
                  {s.label}
                </span>
              </div>
              <div className="mt-2 grid grid-cols-2 gap-2 rounded-lg bg-secondary/50 p-2">
                <div>
                  <p className="text-muted-foreground">Pickup</p>
                  <p className="font-medium text-foreground">{fmt(b.start_at)}</p>
                </div>
                <div>
                  <p className="text-muted-foreground">Return</p>
                  <p className="font-medium text-foreground">
                    {b.end_at ? fmt(b.end_at) : `${b.days} day(s)`}
                  </p>
                </div>
              </div>
              <p className="mt-2 text-muted-foreground">
                {b.days} day(s) · {b.drive_mode === "self_drive" ? "Self drive" : "Chauffeured"} ·
                KES {b.total.toLocaleString("en-KE")} · paid KES {b.paid.toLocaleString("en-KE")}
                {b.pay_later ? ` · pays ${b.pay_later}` : ""}
                {b.has_documents ? " · ID on file" : ""}
              </p>
              {b.pay_later ? (
                <details className="mt-2 rounded-xl border border-border bg-secondary/40 p-2">
                  <summary className="cursor-pointer font-semibold text-foreground">
                    Company details {b.company_verified ? "· verified ✓" : "· needs your check"}
                  </summary>
                  {b.business_email ? (
                    <p className="mt-1 text-muted-foreground">Email: {b.business_email}</p>
                  ) : null}
                  {b.business_registration ? (
                    <p className="text-muted-foreground">Reg. no: {b.business_registration}</p>
                  ) : null}
                  {b.kyc.length ? (
                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1">
                      {b.kyc.map((doc) => (
                        <button
                          key={doc.kind}
                          type="button"
                          onClick={() =>
                            openKyc.mutate({
                              quoteId: b.id,
                              kind: doc.kind as "certificate" | "kra_pin" | "cr12" | "other",
                            })
                          }
                          disabled={openKyc.isPending}
                          className="font-semibold text-primary underline disabled:opacity-50"
                        >
                          {doc.label}
                        </button>
                      ))}
                    </p>
                  ) : (
                    <p className="mt-1 text-destructive">No business documents uploaded yet.</p>
                  )}
                </details>
              ) : null}
              {b.renter_phone ? (
                <a
                  href={`tel:${b.renter_phone}`}
                  className="mt-1 inline-block font-semibold text-primary"
                >
                  Call {b.renter_phone}
                </a>
              ) : null}
              <p className="mt-1 font-medium text-foreground">
                {b.deposit_policy === "none" || b.deposit_amount <= 0
                  ? "No deposit"
                  : b.deposit_policy === "upfront"
                    ? `Refundable deposit KES ${b.deposit_amount.toLocaleString("en-KE")} — paid at booking`
                    : b.deposit_requested
                      ? b.paid >= b.total
                        ? `Refundable deposit KES ${b.deposit_amount.toLocaleString("en-KE")} — paid`
                        : `Waiting for hirer to pay the KES ${b.deposit_amount.toLocaleString("en-KE")} deposit`
                      : `Refundable deposit KES ${b.deposit_amount.toLocaleString("en-KE")} — due at pickup`}
              </p>
              <SignTick b={b} />
              <div className="mt-2 flex flex-wrap gap-2">
                {b.status === "submitted" && b.pay_later ? (
                  <button
                    onClick={() => verify.mutate(b.id)}
                    disabled={verify.isPending || b.kyc.length === 0}
                    className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    {verify.isPending ? "Verifying…" : "Verify company & confirm booking"}
                  </button>
                ) : null}
                <Link
                  to="/hire/agreement/$quoteId"
                  params={{ quoteId: b.id }}
                  hash="sign"
                  className="rounded-full border border-primary px-3 py-2 font-semibold text-primary"
                >
                  {b.status === "confirmed" && !b.handed_over_at
                    ? "Walkaround, sign & agreement"
                    : "Sign / agreement"}
                </Link>
                {b.status === "confirmed" &&
                !b.handed_over_at &&
                b.deposit_policy === "handover" &&
                b.deposit_amount > 0 &&
                !b.deposit_requested ? (
                  <button
                    onClick={() => depositReq.mutate(b.id)}
                    disabled={depositReq.isPending}
                    className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Ask hirer to pay KES {b.deposit_amount.toLocaleString("en-KE")} deposit
                  </button>
                ) : null}
                {b.status === "confirmed" &&
                !b.handed_over_at &&
                !(
                  b.deposit_policy === "handover" &&
                  b.deposit_amount > 0 &&
                  (!b.deposit_requested || b.paid < b.total)
                ) ? (
                  <button
                    onClick={() => hand.mutate({ quoteId: b.id, step: "handed_over" })}
                    disabled={hand.isPending}
                    className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Hand over car
                  </button>
                ) : null}
                {b.handed_over_at && !b.returned_at ? (
                  <button
                    onClick={() => {
                      setReturning(returning === b.id ? null : b.id);
                      setRet((r) => ({
                        ...r,
                        deposit: b.deposit_policy === "none" ? "0" : String(b.deposit_amount),
                        odometer: "",
                        fuelLevel: b.pickup_fuel === "Reserve" ? "Reserve" : "Full",
                        fuel: "0",
                        fines: "0",
                        waiveKm: false,
                        waiveFuel: false,
                      }));
                    }}
                    disabled={hand.isPending}
                    className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Car returned
                  </button>
                ) : null}
                {b.pay_later && b.status === "confirmed" && b.paid < b.total ? (
                  <button
                    onClick={() => remind.mutate({ quoteId: b.id, amount: b.total - b.paid })}
                    disabled={remind.isPending}
                    className="rounded-full border border-primary px-3 py-2 font-semibold text-primary disabled:opacity-50"
                  >
                    {remind.isPending
                      ? "Sending…"
                      : `Request payment (KES ${(b.total - b.paid).toLocaleString("en-KE")})`}
                  </button>
                ) : null}
                {b.can_decline ? (
                  <button
                    onClick={() => setDeclining(declining === b.id ? null : b.id)}
                    className="rounded-full border border-destructive px-3 py-2 font-semibold text-destructive"
                  >
                    Decline hire
                  </button>
                ) : null}
              </div>
              {returning === b.id ? (
                <div className="mt-2 grid gap-2 rounded-xl border border-border p-3">
                  <p className="font-semibold">
                    Return inspection — the renter gets the readings, calculation and any waived
                    charges
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Pickup reading:{" "}
                    {b.pickup_odometer == null
                      ? "not recorded"
                      : `${b.pickup_odometer.toLocaleString("en-KE")} km`}
                    , fuel {b.pickup_fuel ?? "not recorded"}. Record pickup readings in the
                    walkaround/customer details first if they are missing.
                  </p>
                  <label className="grid gap-1 text-sm">
                    Return odometer (km)
                    <input
                      inputMode="numeric"
                      value={ret.odometer}
                      onChange={(e) =>
                        setRet({ ...ret, odometer: e.target.value.replace(/\D/g, "") })
                      }
                      className="input-base"
                      placeholder="Reading on the dashboard"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Return fuel level
                    <select
                      value={ret.fuelLevel}
                      onChange={(e) =>
                        setRet({ ...ret, fuelLevel: e.target.value as typeof ret.fuelLevel })
                      }
                      className="input-base"
                    >
                      {["Full", "3/4", "1/2", "1/4", "Reserve"].map((level) => (
                        <option key={level}>{level}</option>
                      ))}
                    </select>
                  </label>
                  {(() => {
                    const odometer = ret.odometer === "" ? null : Number(ret.odometer);
                    const driven =
                      odometer != null && b.pickup_odometer != null
                        ? odometer - b.pickup_odometer
                        : null;
                    const fuelMissing = calculateFuelShortfall(b.pickup_fuel, ret.fuelLevel);
                    const allowance = HIRE_INCLUDED_KM_PER_DAY * Math.max(1, b.days);
                    const excess =
                      driven == null ? null : Math.max(0, Math.round(driven - allowance));
                    return (
                      <div className="rounded-lg bg-secondary/60 p-2 text-xs">
                        {driven != null && driven >= 0 ? (
                          <p>
                            Calculated distance:{" "}
                            <strong>{driven.toLocaleString("en-KE")} km</strong>
                            {excess != null
                              ? ` (${allowance.toLocaleString("en-KE")} km included; ${excess.toLocaleString("en-KE")} km extra)`
                              : ""}
                          </p>
                        ) : (
                          <p>
                            Enter a return odometer at or above the pickup reading to calculate
                            distance.
                          </p>
                        )}
                        {fuelMissing != null ? (
                          <p className="mt-1">
                            Calculated fuel change:{" "}
                            <strong>{fuelMissing}% below pickup level</strong>
                            {fuelMissing > 0
                              ? " · record the actual pump cost below if charging for the shortfall"
                              : " · no missing fuel"}
                          </p>
                        ) : (
                          <p className="mt-1">
                            Pickup fuel level is missing or unrecognized, so the fuel difference
                            cannot be calculated.
                          </p>
                        )}
                      </div>
                    );
                  })()}
                  <label className="grid gap-1 text-sm">
                    Actual cost to restore missing fuel (KES)
                    <input
                      inputMode="decimal"
                      value={ret.fuel}
                      onChange={(e) =>
                        setRet({ ...ret, fuel: e.target.value.replace(/[^0-9.]/g, "") })
                      }
                      className="input-base"
                    />
                    <span className="text-xs text-muted-foreground">
                      Enter the pump receipt amount; the system calculates the fuel-level shortfall
                      above.
                    </span>
                  </label>
                  <label className="grid gap-1 text-sm">
                    Traffic / parking fines (KES)
                    <input
                      inputMode="decimal"
                      value={ret.fines}
                      onChange={(e) =>
                        setRet({ ...ret, fines: e.target.value.replace(/[^0-9.]/g, "") })
                      }
                      className="input-base"
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    Deposit held (KES)
                    <input
                      inputMode="decimal"
                      value={ret.deposit}
                      onChange={(e) =>
                        setRet({ ...ret, deposit: e.target.value.replace(/[^0-9.]/g, "") })
                      }
                      className="input-base"
                    />
                  </label>
                  <fieldset className="grid gap-2 rounded-lg border border-border p-2">
                    <legend className="px-1 text-sm font-semibold">
                      Charges the owner agrees to waive
                    </legend>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={ret.waiveKm}
                        onChange={(e) => setRet({ ...ret, waiveKm: e.target.checked })}
                        className="mt-0.5 accent-primary"
                      />
                      <span>
                        Do not charge excess kilometres (KES {HIRE_EXCESS_KM_RATE} per km above the
                        included limit).
                      </span>
                    </label>
                    <label className="flex items-start gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={ret.waiveFuel}
                        onChange={(e) => setRet({ ...ret, waiveFuel: e.target.checked })}
                        className="mt-0.5 accent-primary"
                      />
                      <span>Do not charge for missing fuel.</span>
                    </label>
                  </fieldset>
                  <input
                    value={ret.notes}
                    onChange={(e) => setRet({ ...ret, notes: e.target.value })}
                    placeholder="Notes (optional)"
                    className="input-base"
                  />
                  <button
                    disabled={
                      hand.isPending ||
                      ret.deposit === "" ||
                      ret.odometer === "" ||
                      b.pickup_odometer == null ||
                      !b.pickup_fuel ||
                      Number(ret.odometer) < (b.pickup_odometer ?? 0)
                    }
                    onClick={() =>
                      hand.mutate({
                        quoteId: b.id,
                        step: "returned",
                        settlement: {
                          deposit: Number(ret.deposit),
                          odometer: Number(ret.odometer),
                          fuelLevel: ret.fuelLevel,
                          fuelCharge: Number(ret.fuel || 0),
                          penalties: Number(ret.fines || 0),
                          waiveExcessKm: ret.waiveKm,
                          waiveFuel: ret.waiveFuel,
                          notes: ret.notes || undefined,
                        },
                      })
                    }
                    className="rounded-full bg-primary px-3 py-2 font-semibold text-primary-foreground disabled:opacity-50"
                  >
                    Confirm return & send summary
                  </button>
                </div>
              ) : null}
              {declining === b.id ? (
                <div className="mt-2 flex gap-2">
                  <input
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Reason (shared with Twende)"
                    className="input-base flex-1"
                  />
                  <button
                    onClick={() => decline.mutate(b.id)}
                    disabled={reason.trim().length < 5 || decline.isPending}
                    className="rounded-full bg-destructive px-3 py-2 font-semibold text-destructive-foreground disabled:opacity-50"
                  >
                    Confirm
                  </button>
                </div>
              ) : null}
              </div>
            </li>
          );
        })}
      </ul>
      {past.length ? (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-semibold text-foreground">
            Completed hires ({past.length})
          </summary>
          <ul className="mt-2 space-y-2 text-muted-foreground">
            {past.map((b) => (
              <li key={b.id} className="rounded-lg border border-border p-2">
                <p>
                  {b.vehicle} · {b.renter} · {fmt(b.start_at)} · KES{" "}
                  {b.total.toLocaleString("en-KE")}
                </p>
                {b.returned_at ? (
                  <p className="mt-1">
                    Return: {b.return_odometer?.toLocaleString("en-KE") ?? "—"} km ·{" "}
                    {b.return_km_driven?.toLocaleString("en-KE") ?? "—"} km driven · fuel{" "}
                    {b.return_fuel_level ?? "—"} ({b.return_fuel_missing_percent ?? 0}% below
                    pickup)
                    {b.return_excess_km_waived ? " · excess-km charge waived" : ""}
                    {b.return_fuel_waived ? " · fuel charge waived" : ""}
                  </p>
                ) : null}
                {b.deposit_status !== "not_requested" && b.deposit_status !== "requested" ? (
                  <p className="mt-1">
                    Deposit: {b.deposit_returned > 0 ? `returned KES ${b.deposit_returned.toLocaleString("en-KE")}` : "none returned"}
                    {b.deposit_retained > 0 ? ` · retained KES ${b.deposit_retained.toLocaleString("en-KE")}` : ""}
                    {b.deposit_balance_due > 0 ? ` · balance due KES ${b.deposit_balance_due.toLocaleString("en-KE")}` : ""}
                  </p>
                ) : null}
                <SignTick b={b} />
                <Link
                  to="/hire/agreement/$quoteId"
                  params={{ quoteId: b.id }}
                  className="mt-1 inline-block font-semibold text-primary"
                >
                  Open agreement
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
      {err ? <p className="mt-2 text-xs text-destructive">{err}</p> : null}
    </section>
  );
}
