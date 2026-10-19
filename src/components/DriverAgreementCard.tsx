import { useState } from "react";
import {
  DRIVER_AGREEMENT_SECTIONS,
  DRIVER_AGREEMENT_TITLE,
  DRIVER_AGREEMENT_VERSION,
} from "@/lib/driver-agreement";

async function downloadAgreementPdf(signer: string) {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const clean = (s: string) => s.replace(/[^\x20-\x7E]/g, "-");
  const W = 595, H = 842, M = 50, maxW = W - M * 2;
  let page = doc.addPage([W, H]);
  let y = H - M;
  const write = (text: string, size: number, f = font, gap = 4) => {
    const words = clean(text).split(" ");
    let line = "";
    const flush = () => {
      if (y < M + size) { page = doc.addPage([W, H]); y = H - M; }
      page.drawText(line, { x: M, y, size, font: f, color: rgb(0.1, 0.1, 0.1) });
      y -= size + gap;
    };
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > maxW) { flush(); line = w; } else line = t;
    }
    if (line) flush();
  };
  page.drawRectangle({ x: 0, y: H - 12, width: W, height: 12, color: rgb(0.06, 0.46, 0.43) });
  write("Twende Rides", 18, bold, 8);
  write(DRIVER_AGREEMENT_TITLE, 13, bold, 10);
  write(`Version ${DRIVER_AGREEMENT_VERSION}`, 9, font, 12);
  for (const s of DRIVER_AGREEMENT_SECTIONS) {
    y -= 4;
    write(s.heading, 11, bold, 6);
    for (const p of s.body) { write(p, 9.5); y -= 3; }
  }
  y -= 10;
  write(`Accepted electronically by: ${signer || "(name not entered)"}`, 10, bold);
  write(`Date: ${new Date().toLocaleString("en-KE")}`, 10);
  const bytes = await doc.save();
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `twende-driver-agreement-${DRIVER_AGREEMENT_VERSION}.pdf`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function DriverAgreementCard({
  accepted,
  onAcceptedChange,
  signer,
  onSignerChange,
}: {
  accepted: boolean;
  onAcceptedChange: (v: boolean) => void;
  signer: string;
  onSignerChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [readToEnd, setReadToEnd] = useState(false);

  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">Driver Partner Agreement</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Read and accept the agreement before you submit your vehicle.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-full bg-secondary px-4 py-2 text-xs font-semibold text-secondary-foreground"
        >
          {readToEnd ? "Read again" : "Read agreement"}
        </button>
        <button
          type="button"
          onClick={() => void downloadAgreementPdf(signer)}
          className="rounded-full border border-input px-4 py-2 text-xs font-semibold text-foreground"
        >
          Download copy (PDF)
        </button>
      </div>
      <input
        value={signer}
        onChange={(e) => onSignerChange(e.target.value)}
        placeholder="Type your full name to sign"
        maxLength={120}
        className="mt-3 w-full rounded-2xl border border-input bg-background px-3.5 py-2.5 text-sm"
      />
      <label className="mt-3 flex items-start gap-2 text-xs text-foreground">
        <input
          type="checkbox"
          checked={accepted}
          disabled={!readToEnd}
          onChange={(e) => onAcceptedChange(e.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          I have read and agree to the Independent Driver Partner Agreement. I understand this is a
          binding electronic signature.
          {!readToEnd ? (
            <span className="block text-muted-foreground">Open and scroll to the end to enable this.</span>
          ) : null}
        </span>
      </label>

      {open ? (
        <div className="fixed inset-0 z-[80] flex items-end justify-center bg-foreground/50 sm:items-center" role="dialog" aria-modal="true">
          <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-t-3xl bg-background sm:rounded-3xl">
            <div className="border-b border-border p-4">
              <p className="text-sm font-semibold text-foreground">{DRIVER_AGREEMENT_TITLE}</p>
              <p className="text-[11px] text-muted-foreground">Version {DRIVER_AGREEMENT_VERSION}</p>
            </div>
            <div
              className="flex-1 overflow-y-auto p-4 text-xs leading-relaxed text-foreground"
              onScroll={(e) => {
                const el = e.currentTarget;
                if (el.scrollTop + el.clientHeight >= el.scrollHeight - 24) setReadToEnd(true);
              }}
            >
              {DRIVER_AGREEMENT_SECTIONS.map((s) => (
                <div key={s.heading} className="mb-4">
                  <p className="font-semibold">{s.heading}</p>
                  {s.body.map((p, i) => (
                    <p key={i} className="mt-1 text-muted-foreground">{p}</p>
                  ))}
                </div>
              ))}
            </div>
            <div className="border-t border-border p-4">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="w-full rounded-full bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground"
              >
                {readToEnd ? "I've read it" : "Close"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
