import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getRideReceipt } from "@/lib/documents.functions";
import { getHireReceipt } from "@/lib/hire-agreement.functions";
import { buildReceiptPdf, downloadPdf, type Branding } from "@/lib/pdf-docs";

/** One-tap real PDF receipt for a trip or a car hire. */
export function ReceiptDownload({
  kind,
  id,
  className,
  label = "Download receipt (PDF)",
}: {
  kind: "ride" | "hire";
  id: string;
  className?: string;
  label?: string;
}) {
  const rideFn = useServerFn(getRideReceipt);
  const hireFn = useServerFn(getHireReceipt);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true);
    setErr(null);
    try {
      const res = kind === "ride" ? await rideFn({ data: { rideId: id } }) : await hireFn({ data: { quoteId: id } });
      const bytes = await buildReceiptPdf(res.branding as Branding | null, res.receipt);
      downloadPdf(bytes, `Twende-receipt-${res.receipt.reference}.pdf`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <span className="inline-flex flex-col">
      <button
        type="button"
        onClick={() => void go()}
        disabled={busy}
        className={className ?? "rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"}
      >
        {busy ? "Preparing…" : label}
      </button>
      {err ? <span className="mt-1 text-xs text-destructive">{err}</span> : null}
    </span>
  );
}
