import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { getMyCompanyBilling, getRideEtr, listEtrRequests, requestRideEtr, uploadEtrDocument } from "@/lib/etr.functions";
import { pdfToBase64 } from "@/lib/pdf-docs";
import { listHireEtrQueue, uploadHireEtr } from "@/lib/company.functions";

/** Customer side: request a KRA ETR for a completed ride; company details are reused from the account. */
export function RideEtrRequest({ rideId }: { rideId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(getRideEtr);
  const billingFn = useServerFn(getMyCompanyBilling);
  const requestFn = useServerFn(requestRideEtr);
  const etr = useQuery({ queryKey: ["ride-etr", rideId], queryFn: () => getFn({ data: { rideId } }) });
  const billing = useQuery({ queryKey: ["company-billing"], queryFn: () => billingFn() });
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ companyName: "", kraPin: "", billingEmail: "" });
  useEffect(() => {
    if (billing.data) setF((c) => ({
      companyName: c.companyName || billing.data.companyName,
      kraPin: c.kraPin || billing.data.kraPin,
      billingEmail: c.billingEmail || billing.data.billingEmail,
    }));
  }, [billing.data]);
  const send = useMutation({
    mutationFn: () => requestFn({ data: f }),
    onSuccess: () => {
      setOpen(false);
      void qc.invalidateQueries({ queryKey: ["ride-etr", rideId] });
      void qc.invalidateQueries({ queryKey: ["company-billing"] });
    },
  });
  const saved = Boolean(billing.data?.kraPin);

  return (
    <section className="mt-4 rounded-xl border border-border bg-card p-4 print:hidden">
      <h3 className="text-sm font-semibold text-foreground">Company ETR receipt</h3>
      {etr.data ? (
        etr.data.status === "sent" && etr.data.url ? (
          <a href={etr.data.url} target="_blank" rel="noreferrer" className="mt-2 inline-flex rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">
            Download ETR (PDF)
          </a>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">ETR requested for {etr.data.companyName}. We will text you when it is attached.</p>
        )
      ) : open ? (
        <div className="mt-2 space-y-2">
          <input className="input-base w-full" placeholder="Company name" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
          <input className="input-base w-full uppercase" placeholder="KRA PIN e.g. P051234567X" value={f.kraPin} onChange={(e) => setF({ ...f, kraPin: e.target.value })} />
          <input className="input-base w-full" type="email" placeholder="Billing email (optional)" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} />
          <p className="text-[11px] text-muted-foreground">Saved to your account so next time it is one tap.</p>
          <button onClick={() => send.mutate()} disabled={send.isPending || !f.companyName || !f.kraPin} className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
            {send.isPending ? "Sending…" : "Request ETR"}
          </button>
          {send.isError ? <p className="text-xs text-destructive">{(send.error as Error).message}</p> : null}
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap gap-2">
          {saved ? (
            <button onClick={() => send.mutate()} disabled={send.isPending} className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">
              Request ETR for {billing.data!.companyName}
            </button>
          ) : null}
          <button onClick={() => setOpen(true)} className="rounded-full border border-input px-4 py-2 text-xs font-semibold text-foreground">
            {saved ? "Change details" : "Request ETR"}
          </button>
          {send.isError ? <p className="w-full text-xs text-destructive">{(send.error as Error).message}</p> : null}
        </div>
      )}
    </section>
  );
}

/** Finance / admin: attach the ETR PDF to each request. */
export function EtrQueue() {
  const qc = useQueryClient();
  const listFn = useServerFn(listEtrRequests);
  const uploadFn = useServerFn(uploadEtrDocument);
  const list = useQuery({ queryKey: ["etr-queue"], queryFn: () => listFn() });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function attach(id: string, file: File) {
    setErr(null);
    if (file.type !== "application/pdf") return setErr("Attach a PDF file.");
    if (file.size > 10 * 1024 * 1024) return setErr("PDF must be 10 MB or smaller.");
    setBusy(id);
    try {
      await uploadFn({ data: { requestId: id, pdfBase64: pdfToBase64(new Uint8Array(await file.arrayBuffer())) } });
      void qc.invalidateQueries({ queryKey: ["etr-queue"] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  }
  const pending = (list.data ?? []).filter((r) => r.status !== "sent");
  return (
    <section id="etr" className="surface-card scroll-mt-20 p-4">
      <h3 className="text-sm font-semibold text-foreground">ETR requests ({pending.length} waiting)</h3>
      {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
      <ul className="mt-2 divide-y divide-border">
        {(list.data ?? []).map((r) => (
          <li key={r.id} className="py-2.5 text-xs">
            <p className="font-semibold text-foreground">{r.company_name} · KRA {r.kra_pin}</p>
            <p className="text-muted-foreground">Ride {r.reference} · KES {r.fare.toLocaleString()} · requested {new Date(r.created_at).toLocaleString("en-KE")}</p>
            {r.status === "sent" ? (
              <p className="mt-1 font-semibold text-success">Sent {r.uploaded_at ? new Date(r.uploaded_at).toLocaleString("en-KE") : ""}</p>
            ) : (
              <label className="mt-1 inline-flex cursor-pointer rounded-full bg-primary px-3 py-1.5 font-semibold text-primary-foreground">
                {busy === r.id ? "Uploading…" : "Attach ETR PDF"}
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const file = e.target.files?.[0]; if (file) void attach(r.id, file); }} />
              </label>
            )}
          </li>
        ))}
        {list.isSuccess && !list.data.length ? <li className="py-2 text-xs text-muted-foreground">No ETR requests yet.</li> : null}
      </ul>
    </section>
  );
}

/** Finance / admin: ETR requests for company car hires. */
export function HireEtrQueue() {
  const qc = useQueryClient();
  const listFn = useServerFn(listHireEtrQueue);
  const uploadFn = useServerFn(uploadHireEtr);
  const list = useQuery({ queryKey: ["hire-etr-queue"], queryFn: () => listFn() });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function attach(id: string, file: File) {
    setErr(null);
    if (file.type !== "application/pdf") return setErr("Attach a PDF file.");
    setBusy(id);
    try {
      await uploadFn({ data: { requestId: id, pdfBase64: pdfToBase64(new Uint8Array(await file.arrayBuffer())) } });
      void qc.invalidateQueries({ queryKey: ["hire-etr-queue"] });
    } catch (e) { setErr((e as Error).message); } finally { setBusy(null); }
  }
  const rows = list.data ?? [];
  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Car hire ETR requests ({rows.filter((r) => r.status !== "sent").length} waiting)</h3>
      {err ? <p className="mt-1 text-xs text-destructive">{err}</p> : null}
      <ul className="mt-2 divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="py-2.5 text-xs">
            <p className="font-semibold text-foreground">{r.company_name} · KRA {r.kra_pin}</p>
            <p className="text-muted-foreground">Hire {r.reference} · KES {r.paid.toLocaleString()} paid · requested {new Date(r.created_at).toLocaleString("en-KE")}</p>
            {r.status === "sent" ? (
              <p className="mt-1 font-semibold text-success">Sent</p>
            ) : (
              <label className="mt-1 inline-flex cursor-pointer rounded-full bg-primary px-3 py-1.5 font-semibold text-primary-foreground">
                {busy === r.id ? "Uploading…" : "Attach ETR PDF"}
                <input type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) void attach(r.id, f); }} />
              </label>
            )}
          </li>
        ))}
        {list.isSuccess && !rows.length ? <li className="py-2 text-xs text-muted-foreground">No car hire ETR requests yet.</li> : null}
      </ul>
    </section>
  );
}
