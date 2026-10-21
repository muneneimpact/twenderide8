import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CompanyProfileCard } from "@/components/CompanyProfileCard";
import { supabase } from "@/integrations/supabase/client";
import { getCompanyProfile, updateCompanyProfile } from "@/lib/company.functions";
import { saveBusinessKycDocument } from "@/lib/hire.functions";

export const Route = createFileRoute("/_authenticated/hire/company")({
  head: () => ({
    meta: [
      { title: "Register your company for car hire | Twende Meru Rides" },
      {
        name: "description",
        content:
          "Add your company details and KYC documents once, reuse them on every business car hire, and edit them later with a full change history.",
      },
      { property: "og:title", content: "Register your company for car hire | Twende Meru Rides" },
      {
        property: "og:description",
        content: "Company KYC for business car hire in Meru — saved to your account on any phone.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CompanyKycPage,
});

const KYC_SLOTS: Array<{ kind: "certificate" | "kra_pin" | "cr12" | "other"; label: string; hint: string }> = [
  { kind: "certificate", label: "Certificate of registration", hint: "Proof the company is registered" },
  { kind: "kra_pin", label: "KRA PIN certificate", hint: "Needed for ETR receipts" },
  { kind: "cr12", label: "CR12 / directors list", hint: "Who owns or directs the company" },
  { kind: "other", label: "Other supporting document", hint: "Anything else that helps approval" },
];

function CompanyKycPage() {
  const qc = useQueryClient();
  const getFn = useServerFn(getCompanyProfile);
  const saveFn = useServerFn(updateCompanyProfile);
  const saveDocFn = useServerFn(saveBusinessKycDocument);
  const profile = useQuery({ queryKey: ["company-profile"], queryFn: () => getFn() });

  const [f, setF] = useState({ companyName: "", kraPin: "", billingEmail: "", registrationNumber: "" });
  const [uploading, setUploading] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data) {
      setF({
        companyName: profile.data.companyName,
        kraPin: profile.data.kraPin,
        billingEmail: profile.data.billingEmail,
        registrationNumber: profile.data.registrationNumber,
      });
    }
  }, [profile.data]);

  const save = useMutation({
    mutationFn: () => saveFn({ data: f }),
    onSuccess: () => {
      setMessage("Company details saved to your account.");
      void qc.invalidateQueries({ queryKey: ["company-profile"] });
    },
    onError: (e) => setMessage((e as Error).message),
  });

  async function uploadDoc(kind: string, file: File) {
    if (file.size > 10 * 1024 * 1024) {
      setMessage("Each document must be 10 MB or smaller.");
      return;
    }
    if (file.type && !file.type.startsWith("image/") && file.type !== "application/pdf") {
      setMessage("Upload a photo or PDF of the document.");
      return;
    }
    setUploading(kind);
    setMessage(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) {
      setUploading(null);
      return;
    }
    const path = `${auth.user.id}/biz-${kind}-${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
    const { error } = await supabase.storage
      .from("hire-documents")
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) {
      setUploading(null);
      setMessage(error.message);
      return;
    }
    try {
      await saveDocFn({ data: { kind: kind as never, filePath: path, remember: true } });
      setMessage("Document saved to your account — it will be reviewed for approval.");
      void qc.invalidateQueries({ queryKey: ["company-profile"] });
      void qc.invalidateQueries({ queryKey: ["my-business-kyc"] });
    } catch (e) {
      await supabase.storage.from("hire-documents").remove([path]);
      setMessage((e as Error).message);
    } finally {
      setUploading(null);
    }
  }

  const isNew = profile.isSuccess && !profile.data?.companyName && profile.data.documents.length === 0;

  return (
    <AppShell title="Company account">
      <div className="space-y-4 pb-24">
        {isNew ? (
          <section className="surface-card border-primary/30 p-4">
            <h2 className="font-display text-lg font-bold text-foreground">Hiring as a company?</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Register your company once: add its details and KYC documents below. They are saved to
              your account, pre-fill every future business booking on any phone, and let owners
              verify you for pay-later hires.
            </p>
          </section>
        ) : null}

        <section className="surface-card p-4">
          <h2 className="font-display text-base font-semibold text-foreground">Company details</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Used on bookings, agreements and ETR receipts. You can edit these later — every change
            is recorded and visible to our admin team.
          </p>
          <div className="mt-3 space-y-2">
            <input
              className="input-base w-full"
              placeholder="Company name"
              value={f.companyName}
              onChange={(e) => setF({ ...f, companyName: e.target.value })}
            />
            <input
              className="input-base w-full"
              placeholder="Registration number"
              value={f.registrationNumber}
              onChange={(e) => setF({ ...f, registrationNumber: e.target.value })}
            />
            <input
              className="input-base w-full uppercase"
              placeholder="KRA PIN e.g. P051234567X"
              value={f.kraPin}
              onChange={(e) => setF({ ...f, kraPin: e.target.value })}
            />
            <input
              className="input-base w-full"
              type="email"
              placeholder="Billing email"
              value={f.billingEmail}
              onChange={(e) => setF({ ...f, billingEmail: e.target.value })}
            />
            <button
              type="button"
              onClick={() => save.mutate()}
              disabled={save.isPending || f.companyName.trim().length < 2}
              className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
            >
              {save.isPending ? "Saving…" : "Save company details"}
            </button>
          </div>
        </section>

        <section className="surface-card p-4">
          <h2 className="font-display text-base font-semibold text-foreground">KYC documents</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            All documents are optional — upload the ones you have and we will review and approve
            them. They stay on your account for future hires.
          </p>
          <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
            {KYC_SLOTS.map((slot) => {
              const saved = profile.data?.documents.find((d) => d.kind === slot.kind);
              return (
                <label
                  key={slot.kind}
                  className="flex cursor-pointer flex-col gap-1 rounded-xl border border-dashed border-input px-3 py-3 text-xs"
                >
                  <span className="font-medium text-foreground">{slot.label}</span>
                  <span className="text-[10px] text-muted-foreground">{slot.hint}</span>
                  <span className={saved ? "font-semibold text-primary" : "text-muted-foreground"}>
                    {uploading === slot.kind
                      ? "Uploading…"
                      : saved
                        ? "Saved · tap to replace"
                        : "Upload photo or PDF"}
                  </span>
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) void uploadDoc(slot.kind, file);
                      e.target.value = "";
                    }}
                  />
                </label>
              );
            })}
          </div>
        </section>

        {message ? <p className="mx-4 text-xs text-muted-foreground">{message}</p> : null}

        <CompanyProfileCard />

        <p className="mx-4 text-center text-xs text-muted-foreground">
          Ready to book?{" "}
          <Link to="/hire" className="font-semibold text-primary underline">
            Browse hire cars
          </Link>{" "}
          ·{" "}
          <Link to="/hire/bookings" className="font-semibold text-primary underline">
            Your bookings
          </Link>
        </p>
      </div>
    </AppShell>
  );
}
