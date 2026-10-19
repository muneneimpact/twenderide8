import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  emailHireAgreement,
  getHireAgreement,
  INSPECTION_SIDES,
  saveHireInspection,
  type InspectionSide,
} from "@/lib/hire-agreement.functions";

export const Route = createFileRoute("/_authenticated/hire_/agreement/$quoteId")({
  head: () => ({
    meta: [
      { title: "Vehicle hire agreement — Twende Meru Rides" },
      { name: "description", content: "Your signed Twende Ride vehicle hire and rental agreement, ready to download or email." },
      { property: "og:title", content: "Vehicle hire agreement — Twende Meru Rides" },
      { property: "og:description", content: "Download your Twende Ride hire agreement with M-PESA receipt and walkaround photos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AgreementPage,
});

const kes = (n: number) => `KES ${n.toLocaleString("en-KE")}`;
const dt = (s: string | null | undefined) => (s ? new Date(s).toLocaleString("en-KE") : "—");

function AgreementPage() {
  const { quoteId } = Route.useParams();
  const fetchFn = useServerFn(getHireAgreement);
  const emailFn = useServerFn(emailHireAgreement);
  const q = useQuery({ queryKey: ["hire-agreement", quoteId], queryFn: () => fetchFn({ data: { quoteId } }) });
  const [email, setEmail] = useState("");
  const send = useMutation({ mutationFn: () => emailFn({ data: { quoteId, email: email.trim() || undefined } }) });

  if (q.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading agreement…</p>;
  if (q.isError) return <p className="p-6 text-sm text-destructive">{(q.error as Error).message}</p>;
  const { quote: b, renter, vehicle, owner, receipts, photos, canInspect } = q.data;
  const chauffeured = b.drive_mode !== "self_drive";
  const verified = Boolean(b.signature && b.signed_at);

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-4 print:hidden">
        <Link to="/hire" className="text-sm font-semibold text-primary">← Back to hire</Link>
        <div className="mt-3 flex flex-wrap gap-2 rounded-xl border border-border bg-card p-3">
          <button onClick={() => window.print()} className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
            Download agreement (PDF)
          </button>
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Email (optional, defaults to yours)" className="input-base min-w-0 flex-1" />
          <button onClick={() => send.mutate()} disabled={send.isPending} className="rounded-full border border-input px-4 py-2 text-xs font-semibold text-foreground disabled:opacity-50">
            {send.isPending ? "Sending…" : "Email agreement"}
          </button>
          {send.isSuccess ? <p className="w-full text-xs text-success">Sent to {send.data.to}.</p> : null}
          {send.isError ? <p className="w-full text-xs text-destructive">{(send.error as Error).message}</p> : null}
          <p className="w-full text-xs text-muted-foreground">On the print screen, choose "Save as PDF".</p>
        </div>
        {canInspect ? <InspectionForm quoteId={quoteId} done={Boolean(b.inspection_at)} /> : null}
      </div>

      <article className="agreement mx-auto max-w-3xl bg-card px-6 py-8 text-sm leading-relaxed text-foreground print:max-w-none print:px-0 print:py-0">
        <header className="flex items-start justify-between gap-4 border-b border-border pb-4">
          <div>
            <p className="font-display text-xl font-bold">Twende Ride</p>
            <h1 className="font-display text-lg font-semibold">Digital Vehicle Hire &amp; Rental Agreement</h1>
            <p className="text-xs text-muted-foreground">Booking {b.reference} · {chauffeured ? "Chauffeured" : "Self-drive"}</p>
          </div>
          <div className={`rounded-lg border-2 px-3 py-2 text-center text-xs font-semibold ${verified ? "border-success text-success" : "border-warning text-warning"}`}>
            {verified ? "✓ DIGITALLY SIGNED" : "AWAITING SIGNATURE"}
            <br />
            <span className="font-normal">Ref {b.reference}</span>
          </div>
        </header>

        <Section n={1} title="Parties to the Agreement">
          <Grid rows={[
            ["Owner / Fleet Partner", owner?.full_name ?? "Twende Ride Fleet Partner"],
            ["Owner phone", owner?.phone],
            ["Platform", "Twende Ride, Meru, Kenya"],
            ["Hirer", b.hirer_type === "company" ? `${b.organisation ?? ""} (represented by ${renter.name})` : renter.name],
            ["Hirer phone", renter.phone],
            ["Hirer email", b.business_email ?? renter.email],
            ["National ID / Passport", renter.id_number],
            ...(b.hirer_type === "company" ? ([["Company reg. no.", b.business_registration_number], ["Business address", b.business_address]] as [string, string | null][]) : []),
          ]} />
          <p>{chauffeured ? "The Owner provides a licensed driver who remains in control of the vehicle at all times." : "The Hirer is the sole Authorised Driver. Only persons named and approved by the Owner may drive."}</p>
        </Section>

        <Section n={2} title="Vehicle Details & Condition">
          <Grid rows={[
            ["Vehicle", vehicle?.name], ["Registration plate", vehicle?.plate], ["Colour", vehicle?.colour],
            ["Seats", vehicle?.seats ? String(vehicle.seats) : null],
            ["Odometer at pick-up", b.inspection_odometer != null ? `${b.inspection_odometer.toLocaleString("en-KE")} km` : "To be recorded at handover"],
            ["Fuel level at pick-up", b.inspection_fuel ?? "To be recorded at handover"],
            ["Pre-existing damage", b.inspection_notes ?? (b.inspection_at ? "None noted" : "To be recorded at handover")],
          ]} />
          <div className="mt-2 grid grid-cols-4 gap-2">
            {INSPECTION_SIDES.map((s) => (
              <figure key={s} className="text-center text-xs">
                {photos[s] ? <img src={photos[s]!} alt={`${s} of vehicle`} className="aspect-[4/3] w-full rounded border border-border object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center rounded border border-dashed border-border text-muted-foreground">No photo</div>}
                <figcaption className="mt-1 capitalize">{s}</figcaption>
              </figure>
            ))}
          </div>
          <p>Walkaround photos {b.inspection_at ? `taken ${dt(b.inspection_at)}` : "are taken at handover"} form part of this Agreement and are conclusive evidence of the vehicle's condition at pick-up.</p>
        </Section>

        <Section n={3} title="Rental Period, Pick-up & Return">
          <Grid rows={[["Start", dt(b.start_at)], ["End", dt(b.end_at)], ["Duration", `${b.days} day(s)`], ["Pick-up / delivery point", b.pickup], ["Passengers", String(b.passengers)]]} />
          <p>The vehicle must be returned at the agreed time and place. A grace period of 60 minutes applies. After that, a late fee of 10% of the daily rate is charged per hour, up to one full day's rate for each day or part of a day late.</p>
        </Section>

        <Section n={4} title="Pricing, Mileage & Fuel">
          <Grid rows={[
            ["Total hire charge", kes(b.total)], ["Paid to date", kes(b.paid)], ["Payment status", b.payment_status.replaceAll("_", " ")],
            ...(b.pay_later_method ? ([["Pay-later method", b.pay_later_method.replaceAll("_", " ")], ["Payment due", b.pay_later_due_date]] as [string, string | null][]) : []),
          ]} />
          {receipts.length ? (
            <table className="mt-2 w-full border-collapse text-xs">
              <thead><tr className="border-b border-border text-left"><th className="py-1">M-PESA code</th><th>Amount</th><th>Date</th></tr></thead>
              <tbody>{receipts.map((r, i) => <tr key={i} className="border-b border-border"><td className="py-1 font-mono">{r.code ?? "—"}</td><td>{kes(r.amount)}</td><td>{dt(r.at)}</td></tr>)}</tbody>
            </table>
          ) : null}
          <p>Each day includes 250 km. Extra distance is charged at KES 30 per km. {chauffeured ? "Fuel is provided by the Owner as quoted." : "The Hirer fuels the vehicle and must return it at the same fuel level; any shortfall is refuelled at pump price plus a 15% surcharge."}</p>
        </Section>

        <Section n={5} title="Security Deposit & Deductions">
          <p>Any deposit held may be applied to damage beyond fair wear, deep cleaning (smoking, spills, pet hair), unpaid fuel, late fees and traffic penalties. The balance is refunded to the Hirer's M-PESA within 7 days of return, with an itemised statement.</p>
        </Section>

        <Section n={6} title="Permitted Areas & Prohibited Uses">
          <p>The vehicle may be used on public roads within Kenya only. It must not be driven off-road, outside Kenya, sub-let or lent, used for racing, towing, carrying illegal goods, hire-and-reward without consent, or driven by anyone unlicensed, intoxicated or not approved by the Owner.</p>
          {vehicle?.rules ? <p><strong>Owner's rules:</strong> {vehicle.rules}</p> : null}
        </Section>

        <Section n={7} title="Hirer Obligations, Traffic Fines & NTSA">
          <p>The Hirer obeys the Traffic Act (Cap 403) and is liable for all speed-camera, parking, county clamping and NTSA penalties incurred during the hire, plus a KES 500 admin fee per notice handled by the Owner.</p>
        </Section>

        <Section n={8} title="Insurance, Loss, Theft & Accidents">
          <p>{vehicle?.insurance ? `Cover: ${vehicle.insurance}. ` : ""}The Hirer is liable for the insurance excess on any claim, and in full where loss arises from breach of this Agreement. Any accident or theft must be reported to the Owner within 2 hours and to the nearest police station, with a Kenya Police Abstract delivered within 24 hours.</p>
        </Section>

        <Section n={9} title="Breakdowns, Maintenance & Flat Tyres">
          <p>Mechanical breakdowns not caused by the Hirer are the Owner's responsibility, including towing and a replacement vehicle where available. Flat tyres and damage from misuse are repaired at the Hirer's cost. Call Twende support before arranging any repair.</p>
        </Section>

        <Section n={10} title="Default, Repossession & Termination">
          <p>The vehicle may carry a GPS tracker. On non-payment, a breach of permitted areas or prohibited use, the Owner may terminate this Agreement, remotely immobilise the vehicle where safe and repossess it without refund of the unused period.</p>
        </Section>

        <Section n={11} title="Governing Law & Disputes">
          <p>This Agreement is governed by the laws of Kenya, including the Law of Contract Act (Cap 23) and the Consumer Protection Act 2012. Parties first seek mediation in Meru or Nairobi; unresolved disputes go to the courts of Kenya.</p>
        </Section>

        <Section n={12} title="Electronic Signature & Execution">
          <p>Under the Kenya Information and Communications Act, this electronic Agreement and signature are binding. Acceptance was confirmed from the Hirer's verified Twende account{b.business_email ? " and a one-time code sent to the business email" : ""}, under booking reference {b.reference}.</p>
          <div className="mt-3 grid grid-cols-2 gap-4">
            <div className="rounded border border-border p-3">
              <p className="text-xs text-muted-foreground">Hirer signature</p>
              {b.signature?.startsWith("data:image") ? <img src={b.signature} alt="Hirer signature" className="h-16 object-contain" /> : <p className="font-display text-2xl italic">{b.signature?.replace(/^typed:/, "") ?? renter.name}</p>}
              <p className="text-xs">{b.signer ?? renter.name} · {dt(b.signed_at)}</p>
            </div>
            <div className="rounded border border-border p-3">
              <p className="text-xs text-muted-foreground">For the Owner / Twende Ride</p>
              <p className="font-display text-lg">{owner?.full_name ?? "Twende Ride"}</p>
              <p className="text-xs">Handed over: {dt(b.handed_over_at)}{b.returned_at ? ` · Returned: ${dt(b.returned_at)}` : ""}</p>
            </div>
          </div>
        </Section>
        <p className="mt-6 text-center text-xs text-muted-foreground">Verify this agreement at twenderides.lovable.app · Booking {b.reference}</p>
      </article>
    </div>
  );
}

function Section({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <section className="mt-5 space-y-2 break-inside-avoid">
      <h2 className="font-display text-base font-semibold">{n}. {title}</h2>
      {children}
    </section>
  );
}

function Grid({ rows }: { rows: [string, string | null | undefined][] }) {
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {rows.map(([k, v]) => (
        <div key={k} className="contents">
          <dt className="text-muted-foreground">{k}</dt>
          <dd className="font-medium">{v || "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

function InspectionForm({ quoteId, done }: { quoteId: string; done: boolean }) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveHireInspection);
  const [open, setOpen] = useState(!done);
  const [paths, setPaths] = useState<Partial<Record<InspectionSide, string>>>({});
  const [odo, setOdo] = useState("");
  const [fuel, setFuel] = useState("Full");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function upload(side: InspectionSide, file: File) {
    setBusy(side);
    setMsg(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setBusy(null);
    const path = `${auth.user.id}/inspection-${quoteId}-${side}-${Date.now()}.${file.name.split(".").pop() ?? "jpg"}`;
    const { error } = await supabase.storage.from("hire-documents").upload(path, file, { upsert: true, contentType: file.type });
    setBusy(null);
    if (error) return setMsg(error.message);
    setPaths((p) => ({ ...p, [side]: path }));
  }
  const save = useMutation({
    mutationFn: () =>
      saveFn({ data: { quoteId, photos: paths as Record<InspectionSide, string>, odometer: odo ? Number(odo) : null, fuel, notes: notes.trim() || null } }),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["hire-agreement", quoteId] });
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const ready = INSPECTION_SIDES.every((s) => paths[s]);

  return (
    <section className="mt-3 rounded-xl border border-border bg-card p-3 text-xs">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-foreground">Pre-hire walkaround {done ? "✓" : ""}</p>
        {done ? <button onClick={() => setOpen(!open)} className="font-semibold text-primary">{open ? "Close" : "Redo"}</button> : null}
      </div>
      {open ? (
        <>
          <p className="mt-1 text-muted-foreground">Take a photo of each side before handing over, so damage can't be disputed later.</p>
          <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {INSPECTION_SIDES.map((s) => (
              <label key={s} className={`flex cursor-pointer flex-col items-center rounded-lg border p-3 capitalize ${paths[s] ? "border-success text-success" : "border-dashed border-border text-foreground"}`}>
                {busy === s ? "Uploading…" : paths[s] ? `✓ ${s}` : `📷 ${s}`}
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => e.target.files?.[0] && void upload(s, e.target.files[0])} />
              </label>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))} inputMode="numeric" placeholder="Odometer (km)" className="input-base" />
            <select value={fuel} onChange={(e) => setFuel(e.target.value)} className="input-base">
              {["Full", "3/4", "1/2", "1/4", "Reserve"].map((f) => <option key={f}>{f}</option>)}
            </select>
          </div>
          <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Existing scratches or dents (optional)" className="input-base mt-2 w-full" rows={2} />
          <button onClick={() => save.mutate()} disabled={!ready || save.isPending} className="mt-2 rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50">
            {save.isPending ? "Saving…" : "Save walkaround"}
          </button>
        </>
      ) : null}
      {msg ? <p className="mt-1 text-destructive">{msg}</p> : null}
    </section>
  );
}
