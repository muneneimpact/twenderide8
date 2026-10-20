import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ReceiptDownload } from "@/components/ReceiptDownload";
import { SignaturePad } from "@/components/SignaturePad";
import { buildAgreementPdf, DEFAULT_BRANDING, downloadPdf, type AgreementSection, type Branding } from "@/lib/pdf-docs";
import { supabase } from "@/integrations/supabase/client";
import {
  emailHireAgreement,
  getHireAgreement,
  INSPECTION_SIDES,
  saveHireInspection,
  signHireAgreement,
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

type AgreementData = Awaited<ReturnType<typeof getHireAgreement>>;

function buildSections(d: AgreementData, extraTerms: string | null): AgreementSection[] {
  const { quote: b, renter, vehicle, owner } = d;
  const chauffeured = b.drive_mode !== "self_drive";
  const r = (k: string, v: string | null | undefined): [string, string] => [k, v || "—"];
  const sections: AgreementSection[] = [
    {
      title: "Parties to the Agreement",
      rows: [
        r("Owner / Fleet Partner", owner?.full_name ?? "Twende Ride Fleet Partner"),
        r("Owner phone", owner?.phone),
        r("Platform", "Twende Ride, Meru, Kenya"),
        r("Hirer", b.hirer_type === "company" ? `${b.organisation ?? ""} (represented by ${renter.name})` : renter.name),
        r("Hirer phone", renter.phone),
        r("Hirer email", b.business_email ?? renter.email),
        r("National ID / Passport", renter.id_number),
        ...(b.hirer_type === "company" ? [r("Company reg. no.", b.business_registration_number), r("Business address", b.business_address)] : []),
      ],
      paragraphs: [chauffeured ? "The Owner provides a licensed driver who remains in control of the vehicle at all times." : "The Hirer is the sole Authorised Driver. Only persons named and approved by the Owner may drive."],
    },
    {
      title: "Vehicle Details & Condition",
      rows: [
        r("Vehicle", vehicle?.name), r("Registration plate", vehicle?.plate), r("Colour", vehicle?.colour),
        r("Seats", vehicle?.seats ? String(vehicle.seats) : null),
        r("Odometer at pick-up", b.inspection_odometer != null ? `${b.inspection_odometer.toLocaleString("en-KE")} km` : "To be recorded at handover"),
        r("Fuel level at pick-up", b.inspection_fuel ?? "To be recorded at handover"),
        r("Pre-existing damage", b.inspection_notes ?? (b.inspection_at ? "None noted" : "To be recorded at handover")),
      ],
      paragraphs: [`Walkaround photos ${b.inspection_at ? `taken ${dt(b.inspection_at)}` : "are taken at handover"} form part of this Agreement and are conclusive evidence of the vehicle's condition at pick-up.`],
    },
    {
      title: "Rental Period, Pick-up & Return",
      rows: [r("Start", dt(b.start_at)), r("End", dt(b.end_at)), r("Duration", `${b.days} day(s)`), r("Pick-up / delivery point", b.pickup), r("Passengers", String(b.passengers))],
      paragraphs: ["The vehicle must be returned at the agreed time and place. A grace period of 60 minutes applies. After that, a late fee of 10% of the daily rate is charged per hour, up to one full day's rate for each day or part of a day late."],
    },
    {
      title: "Pricing, Mileage & Fuel",
      rows: [
        r("Total hire charge", kes(b.total)), r("Paid to date", kes(b.paid)), r("Payment status", b.payment_status.replaceAll("_", " ")),
        ...(b.pay_later_method ? [r("Pay-later method", b.pay_later_method.replaceAll("_", " ")), r("Payment due", b.pay_later_due_date)] : []),
        ...d.receipts.map((x) => r(`M-PESA ${x.code ?? ""}`.trim(), `${kes(x.amount)} on ${dt(x.at)}`)),
      ],
      paragraphs: [`The hire includes a maximum of 300 km in total. Extra distance is charged at KES 30 per km. ${chauffeured ? "Fuel is provided by the Owner as quoted." : "The Hirer fuels the vehicle and returns it at the same fuel level; any shortfall is charged at the pump price of the missing fuel only."}`],
    },
    { title: "Security Deposit & Deductions", paragraphs: ["Any deposit held may be applied to damage beyond fair wear, deep cleaning (smoking, spills, pet hair), unpaid fuel, extra kilometres, late fees and traffic penalties. The balance is refunded to the Hirer's M-PESA within 7 days of return, with an itemised statement."] },
    { title: "Permitted Areas & Prohibited Uses", paragraphs: ["The vehicle may be used on public roads within Kenya only. It must not be driven off-road, outside Kenya, sub-let or lent, used for racing, towing, carrying illegal goods, hire-and-reward without consent, or driven by anyone unlicensed, intoxicated or not approved by the Owner.", ...(vehicle?.rules ? [`Owner's rules: ${vehicle.rules}`] : [])] },
    { title: "Hirer Obligations, Traffic Fines & NTSA", paragraphs: ["The Hirer obeys the Traffic Act (Cap 403) and pays all speed-camera, parking, county clamping and NTSA penalties incurred during the hire, plus a KES 500 handling fee to the Owner for each fine notice the Owner has to deal with."] },
    { title: "Insurance, Loss, Theft & Accidents", paragraphs: [`${vehicle?.insurance ? `Cover: ${vehicle.insurance}. ` : ""}The Hirer is liable for the insurance excess on any claim, and in full where loss arises from breach of this Agreement. Any accident or theft must be reported to the Owner within 2 hours and to the nearest police station, with a Kenya Police Abstract delivered within 24 hours.`] },
    { title: "Breakdowns, Maintenance & Flat Tyres", paragraphs: ["Mechanical breakdowns not caused by the Hirer are the Owner's responsibility, including towing and a replacement vehicle where available. Flat tyres and damage from misuse are repaired at the Hirer's cost. Call Twende support before arranging any repair."] },
    { title: "Default, Repossession & Termination", paragraphs: ["The vehicle may carry a GPS tracker. On non-payment, a breach of permitted areas or prohibited use, the Owner may terminate this Agreement, remotely immobilise the vehicle where safe and repossess it without refund of the unused period."] },
    { title: "Governing Law & Disputes", paragraphs: ["This Agreement is governed by the laws of Kenya, including the Law of Contract Act (Cap 23) and the Consumer Protection Act 2012. Parties first seek mediation in Meru or Nairobi; unresolved disputes go to the courts of Kenya."] },
  ];
  if (extraTerms?.trim()) sections.push({ title: "Additional Terms", paragraphs: extraTerms.split(/\n{2,}/) });
  sections.push({
    title: "Electronic Signature & Execution",
    paragraphs: [`Under the Kenya Information and Communications Act, this electronic Agreement and both signatures are binding. Signatures were made from verified Twende accounts${b.business_email ? " and a one-time code sent to the business email" : ""}, under booking reference ${b.reference}. Every signing step is logged.`],
  });
  return sections;
}

function AgreementPage() {
  const { quoteId } = Route.useParams();
  const fetchFn = useServerFn(getHireAgreement);
  const emailFn = useServerFn(emailHireAgreement);
  const q = useQuery({ queryKey: ["hire-agreement", quoteId], queryFn: () => fetchFn({ data: { quoteId } }) });
  const [email, setEmail] = useState("");
  const [pdfBusy, setPdfBusy] = useState(false);
  const [pdfErr, setPdfErr] = useState<string | null>(null);
  const send = useMutation({ mutationFn: (pdfBase64: string) => emailFn({ data: { quoteId, email: email.trim() || undefined, pdfBase64 } }) });
  const needsSign = Boolean(q.data && (q.data.role.canSignAsHirer || q.data.role.canSignAsOwner));

  useEffect(() => {
    if (!needsSign) return;
    const t = setTimeout(() => document.getElementById("sign")?.scrollIntoView({ behavior: "smooth", block: "start" }), 250);
    return () => clearTimeout(t);
  }, [needsSign]);

  if (q.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading agreement…</p>;
  if (q.isError) return <p className="p-6 text-sm text-destructive">{(q.error as Error).message}</p>;
  const d = q.data;
  const { quote: b, renter, owner, photos, canInspect, role } = d;
  const extraPhotos = d.extraPhotos ?? [];
  const brand = (d.branding as Branding | null) ?? DEFAULT_BRANDING;
  const chauffeured = b.drive_mode !== "self_drive";
  const complete = Boolean(b.completed_at);
  const sections = buildSections(d, brand.agreement_extra_terms);

  async function emailWithPdf() {
    try {
      send.mutate(toBase64(await agreementBytes()));
    } catch (e) {
      setPdfErr((e as Error).message);
    }
  }

  function agreementBytes() {
    return buildAgreementPdf(brand, {
        reference: b.reference,
        modeLabel: chauffeured ? "Chauffeured" : "Self-drive",
        sections,
        hirer: { name: b.signer ?? renter.name, signature: b.signature, at: b.signed_at },
        owner: { name: b.owner_signer ?? owner?.full_name ?? "Owner", signature: b.owner_signature, at: b.owner_signed_at },
        photos: [...INSPECTION_SIDES.map((s) => ({ label: s.charAt(0).toUpperCase() + s.slice(1), url: photos[s] ?? null })), ...extraPhotos.map((e) => ({ label: e.name, url: e.url }))],
      });
  }

  async function downloadAgreement() {
    setPdfBusy(true);
    setPdfErr(null);
    try {
      const bytes = await agreementBytes();
      downloadPdf(bytes, `Twende-hire-agreement-${b.reference}.pdf`);
    } catch (e) {
      setPdfErr((e as Error).message);
    } finally {
      setPdfBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-3xl px-4 py-4">
        <Link to="/hire" className="text-sm font-semibold text-primary">← Back to hire</Link>
        <div id="agreement-actions" className="mt-3 scroll-mt-4 space-y-2 rounded-xl border border-border bg-card p-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge ok={Boolean(b.signature)} label="Hirer signed" />
            <Badge ok={Boolean(b.owner_signed_at)} label="Owner signed" />
          </div>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => void downloadAgreement()} disabled={!complete || pdfBusy} className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              {pdfBusy ? "Preparing PDF…" : "Download agreement (PDF)"}
            </button>
            {Number(b.paid) > 0 ? <ReceiptDownload kind="hire" id={quoteId} label="Receipt (PDF)" className="rounded-full border border-input px-4 py-2 text-xs font-semibold text-foreground disabled:opacity-50" /> : null}
          </div>
          {!complete ? <p className="text-xs text-muted-foreground">Download unlocks once both the hirer and the owner have signed. A copy is then emailed to both automatically.</p> : null}
          {pdfErr ? <p className="text-xs text-destructive">{pdfErr}</p> : null}
          {complete ? (
            <div className="flex flex-wrap gap-2">
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" placeholder="Send another copy to (optional)" className="input-base min-w-0 flex-1" />
              <button onClick={() => void emailWithPdf()} disabled={send.isPending} className="rounded-full border border-input px-4 py-2 text-xs font-semibold text-foreground disabled:opacity-50">
                {send.isPending ? "Sending…" : "Email agreement"}
              </button>
              {send.isSuccess ? <p className="w-full text-xs text-success">Sent to {send.data.to}.</p> : null}
              {send.isError ? <p className="w-full text-xs text-destructive">{(send.error as Error).message}</p> : null}
            </div>
          ) : null}
        </div>
        {canInspect ? <InspectionForm quoteId={quoteId} done={Boolean(b.inspection_at)} /> : null}
      </div>

      <article className="mx-auto max-w-3xl bg-card px-4 py-6 text-sm leading-relaxed text-foreground sm:px-6">
        <header className="flex items-start justify-between gap-4 border-b-2 pb-4" style={{ borderColor: brand.accent_color }}>
          <div className="flex items-center gap-3">
            {brand.logo_data_url ? <img src={brand.logo_data_url} alt={brand.company_name} className="h-12 w-auto object-contain" /> : null}
            <div>
              <p className="font-display text-xl font-bold" style={{ color: brand.accent_color }}>{brand.company_name}</p>
              <p className="text-xs text-muted-foreground">{[brand.tagline, brand.phone, brand.email].filter(Boolean).join(" · ")}</p>
            </div>
          </div>
          <div className={`rounded-lg border-2 px-3 py-2 text-center text-xs font-semibold ${complete ? "border-success text-success" : "border-warning text-warning"}`}>
            {complete ? "✓ SIGNED BY BOTH" : "AWAITING SIGNATURES"}
          </div>
        </header>
        <h1 className="mt-3 font-display text-lg font-semibold">Digital Vehicle Hire &amp; Rental Agreement</h1>
        <p className="text-xs text-muted-foreground">Booking {b.reference} · {chauffeured ? "Chauffeured" : "Self-drive"}</p>

        {sections.map((s, i) => (
          <Section key={s.title} n={i + 1} title={s.title}>
            {s.rows ? <Grid rows={s.rows} /> : null}
            {i === 1 ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {INSPECTION_SIDES.map((side) => (
                  <figure key={side} className="text-center text-xs">
                    {photos[side] ? <img src={photos[side]!} alt={`${side} of vehicle`} className="aspect-[4/3] w-full rounded border border-border object-cover" /> : <div className="flex aspect-[4/3] items-center justify-center rounded border border-dashed border-border text-muted-foreground">No photo</div>}
                    <figcaption className="mt-1 capitalize">{side}</figcaption>
                  </figure>
                ))}
                {extraPhotos.map((e, k) => (
                  <figure key={`x${k}`} className="text-center text-xs">
                    {e.url ? <img src={e.url} alt={e.name} className="aspect-[4/3] w-full rounded border border-border object-cover" /> : null}
                    <figcaption className="mt-1">{e.name}</figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
            {s.paragraphs.map((p, j) => <p key={j}>{p}</p>)}
          </Section>
        ))}
        <div className="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <SigView label="Hirer signature" sig={b.signature} name={b.signer ?? renter.name} at={b.signed_at} />
          <SigView label="Owner / Twende signature" sig={b.owner_signature} name={b.owner_signer ?? owner?.full_name ?? "Owner"} at={b.owner_signed_at} />
        </div>
        {role.canSignAsHirer || role.canSignAsOwner ? (
          <SignBox quoteId={quoteId} as={role.canSignAsHirer ? "hirer" : "owner"} defaultName={role.canSignAsHirer ? renter.name : owner?.full_name ?? ""} />
        ) : null}
        {d.logs.length ? (
          <details className="mt-6 text-xs text-muted-foreground">
            <summary className="cursor-pointer font-semibold">Signing log ({d.logs.length})</summary>
            <ul className="mt-2 space-y-1">
              {d.logs.map((l, i) => <li key={i}>{dt(l.created_at)} — {l.action.replaceAll("_", " ")}</li>)}
            </ul>
          </details>
        ) : null}
        {brand.agreement_footer ? <p className="mt-6 text-center text-xs text-muted-foreground">{brand.agreement_footer}</p> : null}
      </article>
    </div>
  );
}

function Badge({ ok, label }: { ok: boolean; label: string }) {
  return <span className={`rounded-full px-2.5 py-1 font-semibold ${ok ? "bg-success/15 text-success" : "bg-warning/15 text-warning"}`}>{ok ? "✓" : "…"} {label}</span>;
}

function SigView({ label, sig, name, at }: { label: string; sig: string | null; name: string; at: string | null }) {
  return (
    <div className="rounded border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      {sig?.startsWith("data:image") ? <img src={sig} alt={label} className="h-16 object-contain" /> : sig ? <p className="font-display text-2xl italic">{sig.replace(/^typed:/, "")}</p> : <p className="py-4 text-xs text-muted-foreground">Not signed yet</p>}
      <p className="text-xs">{name} · {dt(at)}</p>
    </div>
  );
}

function SignBox({ quoteId, as, defaultName }: { quoteId: string; as: "hirer" | "owner"; defaultName: string }) {
  const qc = useQueryClient();
  const signFn = useServerFn(signHireAgreement);
  const [name, setName] = useState(defaultName);
  const [sig, setSig] = useState("");
  const [agree, setAgree] = useState(false);
  const [save, setSave] = useState(true);
  const [auto, setAuto] = useState(false);
  const onSig = useCallback((s: string) => setSig(s), []);
  const m = useMutation({
    mutationFn: () => signFn({ data: { quoteId, as, signerName: name.trim(), signature: sig, saveForLater: as === "owner" && save, autoSign: auto } }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["hire-agreement", quoteId] });
      setTimeout(() => document.getElementById("agreement-actions")?.scrollIntoView({ behavior: "smooth", block: "start" }), 150);
    },
  });
  return (
    <section id="sign" className="mt-3 scroll-mt-20 rounded-xl border-2 border-primary bg-card p-3 text-sm">
      <p className="font-semibold text-foreground">Your signature is needed {as === "owner" ? "(as vehicle owner)" : "(as hirer)"}</p>
      <p className="mt-1 text-xs text-muted-foreground">Read the agreement below, then sign here.</p>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="input-base mt-2 w-full" />
      <div className="mt-2"><SignaturePad onChange={onSig} /></div>
      {as === "owner" ? (
        <div className="mt-2 space-y-1 text-xs">
          <label className="flex items-center gap-2"><input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} /> Save this signature for future hires</label>
          {save ? <label className="flex items-center gap-2"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Auto-sign future hires for my cars</label> : null}
        </div>
      ) : null}
      <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} className="mt-0.5" /> I have read and accept this agreement.</label>
      <button onClick={() => m.mutate()} disabled={!agree || !sig || name.trim().length < 2 || m.isPending} className="mt-2 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
        {m.isPending ? "Signing…" : "Sign agreement"}
      </button>
      {m.isError ? <p className="mt-1 text-xs text-destructive">{(m.error as Error).message}</p> : null}
    </section>
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

function Grid({ rows }: { rows: [string, string][] }) {
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
  const [extras, setExtras] = useState<Array<{ name: string; path: string }>>([]);
  const [extraName, setExtraName] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function uploadExtra(file: File) {
    const name = extraName.trim();
    if (!name) return setMsg("Name the photo first, e.g. \"Rear bumper scratch\".");
    setBusy("extra");
    setMsg(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setBusy(null);
    const path = `${auth.user.id}/inspection-${quoteId}-extra-${Date.now()}.${file.name.split(".").pop() ?? "jpg"}`;
    const { error } = await supabase.storage.from("hire-documents").upload(path, file, { upsert: true, contentType: file.type });
    setBusy(null);
    if (error) return setMsg(error.message);
    setExtras((x) => [...x, { name, path }]);
    setExtraName("");
  }
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
      saveFn({ data: { quoteId, photos: paths as Record<InspectionSide, string>, extras, odometer: odo ? Number(odo) : null, fuel, notes: notes.trim() || null } }),
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
          <div className="mt-3 rounded-lg border border-border p-2">
            <p className="font-semibold text-foreground">More photos (optional)</p>
            <p className="text-muted-foreground">Add close-ups of scratches, interior, tyres, etc. Name each one.</p>
            {extras.length ? (
              <ul className="mt-1 space-y-1">
                {extras.map((e, k) => (
                  <li key={k} className="flex items-center justify-between text-success">
                    <span>✓ {e.name}</span>
                    <button type="button" onClick={() => setExtras((x) => x.filter((_, j) => j !== k))} className="text-destructive">Remove</button>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 flex gap-2">
              <input value={extraName} onChange={(e) => setExtraName(e.target.value)} maxLength={60} placeholder="Photo name, e.g. Dashboard" className="input-base min-w-0 flex-1" />
              <label className={`shrink-0 cursor-pointer rounded-lg border px-3 py-2 font-semibold ${extraName.trim() ? "border-primary text-primary" : "border-border text-muted-foreground"}`}>
                {busy === "extra" ? "Uploading…" : "📷 Add"}
                <input type="file" accept="image/*" capture="environment" className="hidden" disabled={!extraName.trim()} onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void uploadExtra(f); }} />
              </label>
            </div>
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

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
