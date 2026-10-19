import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { sendBusinessEmailCode, verifyBusinessEmailCode } from "@/lib/hire-owner.functions";
import { isBusinessEmail } from "@/lib/hire-rules";

export interface CorporateTerms {
  payLaterMethod: "cheque" | "bank_transfer" | "mpesa" | "invoice";
  payLaterDueDate: string;
  businessEmail: string;
  registrationNumber?: string;
  businessAddress?: string;
  signerName: string;
  signature: string;
}

/** Company pay-later, verified business email and a hand/typed signed agreement. */
export function CorporateHireTerms({
  organisation,
  summary,
  onChange,
}: {
  organisation: string;
  summary: string;
  onChange: (terms: CorporateTerms | null) => void;
}) {
  const sendFn = useServerFn(sendBusinessEmailCode);
  const verifyFn = useServerFn(verifyBusinessEmailCode);
  const [method, setMethod] = useState<CorporateTerms["payLaterMethod"]>("bank_transfer");
  const [due, setDue] = useState("");
  const [email, setEmail] = useState("");
  const [reg, setReg] = useState("");
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [verified, setVerified] = useState(false);
  const [signer, setSigner] = useState("");
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState("");
  const [drawn, setDrawn] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  const signature = mode === "type" ? (typed.trim().length >= 3 ? `typed:${typed.trim()}` : "") : drawn ?? "";
  useEffect(() => {
    onChange(
      verified && due && signer.trim().length >= 3 && signature.length > 0
        ? {
            payLaterMethod: method,
            payLaterDueDate: due,
            businessEmail: email.trim(),
            registrationNumber: reg.trim() || undefined,
            businessAddress: address.trim() || undefined,
            signerName: signer.trim(),
            signature: signature.padEnd(20, " "),
          }
        : null,
    );
  }, [verified, due, signer, signature, method, email, reg, address, mode, onChange]);

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const c = canvas.current!;
    const r = c.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * c.width, y: ((e.clientY - r.top) / r.height) * c.height };
  }

  async function send() {
    setBusy(true);
    setMsg(null);
    try {
      await sendFn({ data: { email: email.trim() } });
      setSent(true);
      setMsg("Code sent. Check the business inbox.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    try {
      await verifyFn({ data: { email: email.trim(), code } });
      setVerified(true);
      setMsg("Business email verified.");
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-border p-3 text-xs">
      <p className="text-sm font-semibold text-foreground">Company booking — pay later</p>
      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className="text-muted-foreground">Payment method</span>
          <select value={method} onChange={(e) => setMethod(e.target.value as CorporateTerms["payLaterMethod"])} className="input-base">
            <option value="bank_transfer">Bank transfer</option>
            <option value="cheque">Cheque</option>
            <option value="mpesa">M-Pesa</option>
            <option value="invoice">Invoice (LPO)</option>
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Date you will pay</span>
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} className="input-base" />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Registration no. (optional)</span>
          <input value={reg} onChange={(e) => setReg(e.target.value)} className="input-base" />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">Business address (optional)</span>
          <input value={address} onChange={(e) => setAddress(e.target.value)} className="input-base" />
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-muted-foreground">Business email (name@company.co.ke, .com, .org, .ac.ke, .go.ke…)</span>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setVerified(false);
              setSent(false);
            }}
            type="email"
            className="input-base flex-1"
          />
          <button onClick={send} disabled={busy || verified || !isBusinessEmail(email)} className="rounded-full border border-input px-3 font-semibold disabled:opacity-50">
            {sent ? "Resend" : "Send code"}
          </button>
        </div>
      </label>
      {sent && !verified ? (
        <div className="flex gap-2">
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder="6-digit code" className="input-base flex-1" />
          <button onClick={verify} disabled={busy || code.length !== 6} className="rounded-full bg-primary px-3 font-semibold text-primary-foreground disabled:opacity-50">
            Verify
          </button>
        </div>
      ) : null}
      {verified ? <p className="font-semibold text-success">✓ {email} verified</p> : null}

      <div className="rounded-lg bg-secondary/50 p-2 text-muted-foreground">
        <p className="font-semibold text-foreground">Hire agreement</p>
        <p className="mt-1">
          {organisation || "The company"} agrees to hire {summary}, to pay the full amount by {method.replace("_", " ")} on or before {due || "the chosen date"}, to follow the owner's rules, and to return the vehicle in the condition received. Late payment may suspend future bookings.
        </p>
      </div>
      <label className="block space-y-1">
        <span className="text-muted-foreground">Authorised signatory (full name)</span>
        <input value={signer} onChange={(e) => setSigner(e.target.value)} className="input-base" />
      </label>
      <div className="flex gap-2">
        {(["draw", "type"] as const).map((m) => (
          <button key={m} onClick={() => setMode(m)} className={`rounded-full px-3 py-1.5 font-semibold ${mode === m ? "bg-primary text-primary-foreground" : "border border-border"}`}>
            {m === "draw" ? "Sign by hand" : "Type signature"}
          </button>
        ))}
      </div>
      {mode === "draw" ? (
        <div>
          <canvas
            ref={canvas}
            width={600}
            height={160}
            className="h-28 w-full touch-none rounded-lg border border-dashed border-border bg-card"
            onPointerDown={(e) => {
              drawing.current = true;
              const ctx = canvas.current!.getContext("2d")!;
              const p = point(e);
              ctx.lineWidth = 3;
              ctx.lineCap = "round";
              ctx.strokeStyle = getComputedStyle(canvas.current!).color;
              ctx.beginPath();
              ctx.moveTo(p.x, p.y);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = canvas.current!.getContext("2d")!;
              const p = point(e);
              ctx.lineTo(p.x, p.y);
              ctx.stroke();
            }}
            onPointerUp={() => {
              drawing.current = false;
              setDrawn(canvas.current!.toDataURL("image/png"));
            }}
          />
          <button
            onClick={() => {
              canvas.current!.getContext("2d")!.clearRect(0, 0, 600, 160);
              setDrawn(null);
            }}
            className="mt-1 text-muted-foreground underline"
          >
            Clear
          </button>
        </div>
      ) : (
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name as signature" className="input-base font-display italic" />
      )}
      {msg ? <p className="text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
