import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  approveFundingBatch,
  createFundingBatch,
  getWalletPromo,
  listFundingBatches,
  previewFundingCohort,
  searchWalletCustomers,
  setWalletPromo,
} from "@/lib/wallet-admin.functions";

const COHORTS = [
  { v: "first_ride", label: "New users who finished their first ride" },
  { v: "new_7d", label: "Signed up in the last 7 days" },
  { v: "active_30d", label: "Rode in the last 30 days" },
  { v: "inactive_60d", label: "No ride in 60+ days" },
  { v: "all_customers", label: "All customers" },
  { v: "selected", label: "Pick accounts" },
] as const;
type Cohort = (typeof COHORTS)[number]["v"];

const STATUS: Record<string, string> = {
  awaiting_payment: "Waiting for KES 1 M-PESA on 0723175181",
  awaiting_code: "Enter the code sent to 0723175181",
  approved: "Funded",
  failed: "Failed",
  expired: "Code expired",
  cancelled: "Cancelled",
};

export function WalletFundingBoard() {
  const qc = useQueryClient();
  const previewFn = useServerFn(previewFundingCohort);
  const searchFn = useServerFn(searchWalletCustomers);
  const createFn = useServerFn(createFundingBatch);
  const approveFn = useServerFn(approveFundingBatch);
  const listFn = useServerFn(listFundingBatches);
  const promoFn = useServerFn(getWalletPromo);
  const savePromoFn = useServerFn(setWalletPromo);

  const [cohort, setCohort] = useState<Cohort>("first_ride");
  const [selected, setSelected] = useState<Array<{ id: string; label: string }>>([]);
  const [q, setQ] = useState("");
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const ids = selected.map((s) => s.id);

  const preview = useQuery({
    queryKey: ["funding-preview", cohort, ids.join(",")],
    queryFn: () => previewFn({ data: { cohort, selected: ids } }),
  });
  const search = useQuery({
    queryKey: ["funding-search", q],
    enabled: cohort === "selected" && q.trim().length >= 2,
    queryFn: () => searchFn({ data: { q: q.trim() } }),
  });
  const batches = useQuery({
    queryKey: ["funding-batches"],
    queryFn: () => listFn(),
    refetchInterval: (s) => ((s.state.data ?? []).some((b) => b.status === "awaiting_payment") ? 4000 : false),
  });
  const create = useMutation({
    mutationFn: () => createFn({ data: { cohort, selected: ids, amountPerUser: amount, note } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["funding-batches"] }),
  });
  const approve = useMutation({
    mutationFn: (batchId: string) => approveFn({ data: { batchId, code: codes[batchId] ?? "" } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["funding-batches"] }),
  });

  const promo = useQuery({ queryKey: ["wallet-promo"], queryFn: () => promoFn() });
  const [pct, setPct] = useState(0);
  const [minT, setMinT] = useState(500);
  const [cap, setCap] = useState(500);
  useEffect(() => {
    if (promo.data) {
      setPct(promo.data.percent);
      setMinT(promo.data.minTopup);
      setCap(promo.data.cap);
    }
  }, [promo.data]);
  const savePromo = useMutation({
    mutationFn: () => savePromoFn({ data: { percent: pct, minTopup: minT, cap } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet-promo"] }),
  });

  const count = preview.data?.count ?? 0;
  const field = "rounded-md border border-input bg-background px-3 py-2 text-sm";

  return (
    <section className="surface-card space-y-4 p-4">
      <div>
        <h3 className="text-sm font-semibold text-foreground">Fund customer wallets</h3>
        <p className="text-xs text-muted-foreground">
          Gifts are promo credit: rides and car hire only, never refundable. Each batch needs a KES 1 M-PESA payment from 0723175181, then the code texted to that phone.
        </p>
      </div>

      <label className="block text-xs font-medium text-muted-foreground">
        Who gets it
        <select value={cohort} onChange={(e) => setCohort(e.target.value as Cohort)} className={`mt-1 w-full ${field}`}>
          {COHORTS.map((c) => (
            <option key={c.v} value={c.v}>{c.label}</option>
          ))}
        </select>
      </label>

      {cohort === "selected" && (
        <div className="space-y-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone" className={`w-full ${field}`} />
          {(search.data ?? []).map((u) => (
            <button
              key={u.id}
              onClick={() => !ids.includes(u.id) && setSelected([...selected, { id: u.id, label: u.full_name || u.phone || u.id.slice(0, 8) }])}
              className="block w-full rounded-md border border-border px-3 py-2 text-left text-sm"
            >
              {u.full_name || "No name"} · {u.phone ?? "no phone"}
            </button>
          ))}
          <div className="flex flex-wrap gap-1">
            {selected.map((s) => (
              <button key={s.id} onClick={() => setSelected(selected.filter((x) => x.id !== s.id))} className="rounded-full bg-secondary px-2 py-1 text-xs">
                {s.label} ✕
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex gap-2">
        <label className="flex-1 text-xs font-medium text-muted-foreground">
          KES per account
          <input type="number" value={amount} onChange={(e) => setAmount(Math.round(Number(e.target.value) || 0))} className={`mt-1 w-full ${field}`} />
        </label>
        <label className="flex-[2] text-xs font-medium text-muted-foreground">
          Message / campaign
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Welcome gift" className={`mt-1 w-full ${field}`} />
        </label>
      </div>
      <p className="text-sm text-foreground">
        {preview.isLoading ? "Counting…" : `${count} accounts · total KES ${(count * amount).toLocaleString("en-KE")}`}
      </p>
      <button
        onClick={() => create.mutate()}
        disabled={create.isPending || count === 0 || amount <= 0}
        className="w-full rounded-md bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {create.isPending ? "Sending KES 1 prompt…" : "Request approval (KES 1 to 0723175181)"}
      </button>
      {create.isError && <p className="text-sm text-destructive">{(create.error as Error).message}</p>}

      <ul className="space-y-2">
        {(batches.data ?? []).map((b) => (
          <li key={b.id} className="rounded-md border border-border p-3 text-sm">
            <div className="flex justify-between gap-2">
              <span className="font-semibold">{b.count} × KES {Number(b.amount_per_user).toLocaleString("en-KE")} = KES {Number(b.total_amount).toLocaleString("en-KE")}</span>
              <span className="text-xs text-muted-foreground">{new Date(b.created_at).toLocaleString("en-KE")}</span>
            </div>
            <p className="text-xs text-muted-foreground">
              {STATUS[b.status] ?? b.status}
              {b.mpesa_receipt && !b.mpesa_receipt.startsWith("intent:") ? ` · M-PESA ${b.mpesa_receipt}` : ""}
              {b.note ? ` · ${b.note}` : ""}
            </p>
            {b.status === "awaiting_code" && (
              <div className="mt-2 flex gap-2">
                <input value={codes[b.id] ?? ""} onChange={(e) => setCodes({ ...codes, [b.id]: e.target.value.replace(/\D/g, "").slice(0, 6) })} inputMode="numeric" placeholder="6-digit code" className={`flex-1 ${field}`} />
                <button onClick={() => approve.mutate(b.id)} disabled={approve.isPending || (codes[b.id] ?? "").length !== 6} className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60">
                  Approve & fund
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {approve.isError && <p className="text-sm text-destructive">{(approve.error as Error).message}</p>}
      {approve.isSuccess && <p className="text-sm text-primary">Funded {approve.data.credited} wallets.</p>}

      <div className="border-t border-border pt-4">
        <h3 className="text-sm font-semibold text-foreground">Wallet-only top-up promo</h3>
        <p className="text-xs text-muted-foreground">Bonus promo credit for customers who top up their wallet. 0% turns it off.</p>
        <div className="mt-2 grid grid-cols-3 gap-2">
          <label className="text-xs text-muted-foreground">Bonus %<input type="number" value={pct} onChange={(e) => setPct(Number(e.target.value) || 0)} className={`mt-1 w-full ${field}`} /></label>
          <label className="text-xs text-muted-foreground">Min top-up<input type="number" value={minT} onChange={(e) => setMinT(Number(e.target.value) || 0)} className={`mt-1 w-full ${field}`} /></label>
          <label className="text-xs text-muted-foreground">Max bonus<input type="number" value={cap} onChange={(e) => setCap(Number(e.target.value) || 0)} className={`mt-1 w-full ${field}`} /></label>
        </div>
        <button onClick={() => savePromo.mutate()} disabled={savePromo.isPending} className="mt-2 rounded-md border border-border px-4 py-2 text-sm font-semibold">
          {savePromo.isPending ? "Saving…" : "Save promo"}
        </button>
        {savePromo.isError && <p className="text-sm text-destructive">{(savePromo.error as Error).message}</p>}
        {savePromo.isSuccess && <p className="text-sm text-primary">Saved.</p>}
      </div>
    </section>
  );
}
