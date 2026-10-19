import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell, adminTabs } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import { getBranding, saveBranding } from "@/lib/documents.functions";
import { buildAgreementPdf, buildReceiptPdf, DEFAULT_BRANDING, downloadPdf, type Branding } from "@/lib/pdf-docs";

export const Route = createFileRoute("/_authenticated/admin/documents")({
  head: () => ({
    meta: [
      { title: "Receipts & agreement letterhead — Twende Meru Rides" },
      { name: "description", content: "Super admin editor for the logo, letterhead and wording on Twende receipts and hire agreements." },
      { property: "og:title", content: "Receipts & agreement letterhead — Twende Meru Rides" },
      { property: "og:description", content: "Edit Twende receipt and agreement letterheads and logos." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: () => (
    <RoleGate allow={["super_admin"]} title="Letterhead">
      <AppShell title="Receipts & agreements" tabs={adminTabs} eyebrow="Twende Admin">
        <BrandingEditor />
      </AppShell>
    </RoleGate>
  ),
});

async function fileToDataUrl(f: File): Promise<string> {
  if (!/image\/(png|jpeg)/.test(f.type)) throw new Error("Use a PNG or JPG logo.");
  if (f.size > 500_000) throw new Error("Logo must be under 500 KB.");
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(new Error("Could not read file"));
    r.readAsDataURL(f);
  });
}

function BrandingEditor() {
  const qc = useQueryClient();
  const getFn = useServerFn(getBranding);
  const saveFn = useServerFn(saveBranding);
  const q = useQuery({ queryKey: ["branding"], queryFn: () => getFn() });
  const [b, setB] = useState<Branding>(DEFAULT_BRANDING);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    if (q.data) setB({ ...DEFAULT_BRANDING, ...(q.data as Branding) });
  }, [q.data]);
  const extras = Array.isArray(b.extra_logos) ? (b.extra_logos as string[]) : [];
  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          company_name: b.company_name, tagline: b.tagline, address: b.address, phone: b.phone, email: b.email,
          kra_pin: b.kra_pin, website: b.website, logo_data_url: b.logo_data_url, extra_logos: extras,
          accent_color: b.accent_color, receipt_footer: b.receipt_footer, agreement_footer: b.agreement_footer,
          agreement_extra_terms: b.agreement_extra_terms,
        },
      }),
    onSuccess: () => {
      setMsg("Saved. New receipts and agreements use this letterhead.");
      void qc.invalidateQueries({ queryKey: ["branding"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });
  const field = (k: keyof Branding, label: string, multiline = false) => (
    <label className="block space-y-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {multiline ? (
        <textarea rows={4} value={(b[k] as string | null) ?? ""} onChange={(e) => setB({ ...b, [k]: e.target.value || null })} className="input-base w-full" />
      ) : (
        <input value={(b[k] as string | null) ?? ""} onChange={(e) => setB({ ...b, [k]: e.target.value || null })} className="input-base w-full" />
      )}
    </label>
  );

  async function sample(kind: "receipt" | "agreement") {
    const bytes =
      kind === "receipt"
        ? await buildReceiptPdf(b, {
            kind: "ride", reference: "TW-SAMPLE", customer: "Jane Wanjiku", phone: "0712 345 678",
            lines: [["From", "Makutano"], ["To", "Meru Town"], ["Distance", "4.2 km"]],
            total: 350, paid: 350, payments: [{ code: "SAMPLE123", amount: 350, at: new Date().toISOString(), method: "M-PESA" }],
            issuedAt: new Date().toISOString(),
          })
        : await buildAgreementPdf(b, {
            reference: "HR-SAMPLE", modeLabel: "Self-drive",
            sections: [{ title: "Sample section", rows: [["Vehicle", "Toyota Axio KDG 568T"]], paragraphs: ["This is how agreement text looks on your letterhead."] }],
            hirer: { name: "Jane Wanjiku", signature: "typed:Jane Wanjiku", at: new Date().toISOString() },
            owner: { name: "Owner", signature: "typed:Owner", at: new Date().toISOString() },
            photos: [],
          });
    downloadPdf(bytes, `sample-${kind}.pdf`);
  }

  if (q.isPending) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  return (
    <div className="mx-auto max-w-2xl space-y-4 px-4 py-4">
      <section className="surface-card space-y-3 p-4">
        <h2 className="text-sm font-semibold text-foreground">Logos</h2>
        <div className="flex flex-wrap items-center gap-3">
          {[b.logo_data_url, ...extras].filter(Boolean).map((l, i) => (
            <div key={i} className="relative rounded border border-border p-1">
              <img src={l!} alt="Logo" className="h-12 w-auto object-contain" />
              <button
                type="button"
                onClick={() => (i === 0 && b.logo_data_url ? setB({ ...b, logo_data_url: extras[0] ?? null, extra_logos: extras.slice(1) }) : setB({ ...b, extra_logos: extras.filter((_, j) => j !== i - (b.logo_data_url ? 1 : 0)) }))}
                className="absolute -right-2 -top-2 rounded-full bg-destructive px-1.5 text-xs text-destructive-foreground"
              >
                ×
              </button>
            </div>
          ))}
          <label className="cursor-pointer rounded-full border border-primary px-3 py-1.5 text-xs font-semibold text-primary">
            + Add logo
            <input
              type="file"
              accept="image/png,image/jpeg"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                try {
                  const url = await fileToDataUrl(f);
                  setB((cur) => (cur.logo_data_url ? { ...cur, extra_logos: [...(Array.isArray(cur.extra_logos) ? (cur.extra_logos as string[]) : []), url].slice(0, 3) } : { ...cur, logo_data_url: url }));
                } catch (err) {
                  setMsg((err as Error).message);
                }
              }}
            />
          </label>
        </div>
        <p className="text-xs text-muted-foreground">The first logo is the main Twende logo. Add partner or authorised logos after it (up to 3 shown).</p>
      </section>
      <section className="surface-card grid grid-cols-1 gap-3 p-4 sm:grid-cols-2">
        {field("company_name", "Company name")}
        {field("tagline", "Tagline")}
        {field("address", "Address")}
        {field("phone", "Phone")}
        {field("email", "Email")}
        {field("website", "Website")}
        {field("kra_pin", "KRA PIN")}
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Letterhead colour</span>
          <input type="color" value={b.accent_color} onChange={(e) => setB({ ...b, accent_color: e.target.value })} className="h-10 w-full rounded" />
        </label>
      </section>
      <section className="surface-card space-y-3 p-4">
        {field("receipt_footer", "Receipt footer note", true)}
        {field("agreement_footer", "Agreement footer note", true)}
        {field("agreement_extra_terms", "Extra agreement terms (added as a section)", true)}
      </section>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => save.mutate()} disabled={save.isPending} className="rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">
          {save.isPending ? "Saving…" : "Save"}
        </button>
        <button onClick={() => void sample("receipt")} className="rounded-full border border-input px-4 py-2 text-xs font-semibold">Sample receipt PDF</button>
        <button onClick={() => void sample("agreement")} className="rounded-full border border-input px-4 py-2 text-xs font-semibold">Sample agreement PDF</button>
      </div>
      {msg ? <p className="text-xs text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
