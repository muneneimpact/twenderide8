import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { deleteCompanyDocument, deleteCompanyProfile, getCompanyProfile, updateCompanyProfile } from "@/lib/company.functions";

const KIND: Record<string, string> = {
  certificate: "Certificate of incorporation",
  kra_pin: "KRA PIN certificate",
  cr12: "CR12",
  other: "Other document",
};

/** Saved company details & documents: view, edit, delete (stored on the account). */
export function CompanyProfileCard() {
  const qc = useQueryClient();
  const getFn = useServerFn(getCompanyProfile);
  const saveFn = useServerFn(updateCompanyProfile);
  const delDocFn = useServerFn(deleteCompanyDocument);
  const delAllFn = useServerFn(deleteCompanyProfile);
  const profile = useQuery({ queryKey: ["company-profile"], queryFn: () => getFn() });
  const [editing, setEditing] = useState(false);
  const [f, setF] = useState({ companyName: "", kraPin: "", billingEmail: "", registrationNumber: "" });
  useEffect(() => {
    if (profile.data) setF({
      companyName: profile.data.companyName, kraPin: profile.data.kraPin,
      billingEmail: profile.data.billingEmail, registrationNumber: profile.data.registrationNumber,
    });
  }, [profile.data]);
  const refresh = () => {
    for (const k of ["company-profile", "company-billing", "my-business-kyc"]) void qc.invalidateQueries({ queryKey: [k] });
  };
  const save = useMutation({ mutationFn: () => saveFn({ data: f }), onSuccess: () => { setEditing(false); refresh(); } });
  const delDoc = useMutation({ mutationFn: (kind: string) => delDocFn({ data: { kind: kind as never } }), onSuccess: refresh });
  const delAll = useMutation({ mutationFn: () => delAllFn(), onSuccess: refresh });
  const p = profile.data;
  if (!p) return null;
  const has = Boolean(p.companyName || p.documents.length);
  if (!has && !editing) return null;
  const err = (save.error ?? delDoc.error ?? delAll.error) as Error | null;

  return (
    <section className="surface-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-display text-base font-semibold text-foreground">Company details</h2>
        {!editing ? (
          <button type="button" onClick={() => setEditing(true)} className="rounded-full border border-input px-3 py-1 text-xs font-semibold text-foreground">Edit</button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-3 space-y-2">
          <input className="input-base w-full" placeholder="Company name" value={f.companyName} onChange={(e) => setF({ ...f, companyName: e.target.value })} />
          <input className="input-base w-full" placeholder="Registration number" value={f.registrationNumber} onChange={(e) => setF({ ...f, registrationNumber: e.target.value })} />
          <input className="input-base w-full uppercase" placeholder="KRA PIN e.g. P051234567X" value={f.kraPin} onChange={(e) => setF({ ...f, kraPin: e.target.value })} />
          <input className="input-base w-full" type="email" placeholder="Billing email" value={f.billingEmail} onChange={(e) => setF({ ...f, billingEmail: e.target.value })} />
          <div className="flex gap-2">
            <button type="button" onClick={() => save.mutate()} disabled={save.isPending || f.companyName.trim().length < 2} className="flex-1 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">
              {save.isPending ? "Saving…" : "Save"}
            </button>
            <button type="button" onClick={() => setEditing(false)} className="rounded-full border border-input px-4 py-2 text-sm font-semibold text-foreground">Cancel</button>
          </div>
        </div>
      ) : (
        <dl className="mt-3 grid grid-cols-2 gap-2 text-xs">
          {[["Company", p.companyName], ["Reg. number", p.registrationNumber], ["KRA PIN", p.kraPin], ["Billing email", p.billingEmail]].map(([k, v]) => (
            <div key={k} className="rounded-lg bg-secondary/60 p-2">
              <dt className="text-muted-foreground">{k}</dt>
              <dd className="break-all font-medium text-foreground">{v || "—"}</dd>
            </div>
          ))}
        </dl>
      )}
      <h3 className="mt-4 text-xs font-semibold text-foreground">Saved documents</h3>
      {p.documents.length === 0 ? <p className="mt-1 text-xs text-muted-foreground">No saved documents.</p> : null}
      <ul className="mt-1 divide-y divide-border">
        {p.documents.map((d) => (
          <li key={d.kind} className="flex items-center justify-between gap-2 py-2 text-xs">
            <div>
              <p className="font-medium text-foreground">{KIND[d.kind] ?? d.kind}</p>
              <p className="text-muted-foreground">Saved {new Date(d.uploadedAt).toLocaleDateString("en-KE")}</p>
            </div>
            <div className="flex gap-2">
              {d.url ? <a href={d.url} target="_blank" rel="noreferrer" className="rounded-full border border-input px-3 py-1 font-semibold text-foreground">View</a> : null}
              <button type="button" onClick={() => { if (confirm("Delete this saved document?")) delDoc.mutate(d.kind); }} className="rounded-full border border-destructive/40 px-3 py-1 font-semibold text-destructive">Delete</button>
            </div>
          </li>
        ))}
      </ul>
      {err ? <p className="mt-2 text-xs text-destructive">{err.message}</p> : null}
      <button type="button" disabled={delAll.isPending} onClick={() => { if (confirm("Delete all saved company details and documents from your account? Past bookings keep their copies.")) delAll.mutate(); }} className="mt-3 text-xs font-semibold text-destructive underline">
        {delAll.isPending ? "Deleting…" : "Delete company details"}
      </button>
    </section>
  );
}
