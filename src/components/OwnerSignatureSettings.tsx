import { useCallback, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getMySignature, saveMySignature } from "@/lib/documents.functions";
import { SignaturePad } from "./SignaturePad";

/** Owner's saved signature + choice: auto-sign every accepted hire, or sign each one. */
export function OwnerSignatureSettings() {
  const qc = useQueryClient();
  const getFn = useServerFn(getMySignature);
  const saveFn = useServerFn(saveMySignature);
  const q = useQuery({ queryKey: ["my-signature"], queryFn: () => getFn() });
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("");
  const [sig, setSig] = useState("");
  const onSig = useCallback((s: string) => setSig(s), []);
  const save = useMutation({
    mutationFn: (v: { signer_name: string; signature: string; auto_sign: boolean }) => saveFn({ data: v }),
    onSuccess: () => {
      setEditing(false);
      void qc.invalidateQueries({ queryKey: ["my-signature"] });
    },
  });
  const cur = q.data;

  return (
    <section className="surface-card p-4 text-sm">
      <h2 className="font-semibold text-foreground">Your signature for hire agreements</h2>
      {cur && !editing ? (
        <div className="mt-2 space-y-3">
          <div className="rounded-lg border border-border bg-card p-2">
            {cur.signature.startsWith("data:image") ? (
              <img src={cur.signature} alt="Your signature" className="h-14 object-contain" />
            ) : (
              <p className="font-display text-xl italic">{cur.signature.replace(/^typed:/, "")}</p>
            )}
            <p className="text-xs text-muted-foreground">{cur.signer_name}</p>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {[
              { v: true, t: "Auto-sign", d: "Sign every hire for my cars automatically once it is booked." },
              { v: false, t: "Sign each hire", d: "I review and sign every agreement myself." },
            ].map((o) => (
              <button
                key={o.t}
                type="button"
                onClick={() => save.mutate({ signer_name: cur.signer_name, signature: cur.signature, auto_sign: o.v })}
                className={`rounded-xl border p-3 text-left ${cur.auto_sign === o.v ? "border-primary bg-primary/5" : "border-border"}`}
              >
                <p className="font-semibold text-foreground">{cur.auto_sign === o.v ? "● " : "○ "}{o.t}</p>
                <p className="text-xs text-muted-foreground">{o.d}</p>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setEditing(true)} className="text-xs font-semibold text-primary">Change signature</button>
        </div>
      ) : (
        <div className="mt-2 space-y-2">
          <p className="text-xs text-muted-foreground">Create your signature once. It is placed on agreements you accept.</p>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" className="input-base w-full" />
          <SignaturePad onChange={onSig} />
          <button
            type="button"
            disabled={name.trim().length < 2 || !sig || save.isPending}
            onClick={() => save.mutate({ signer_name: name.trim(), signature: sig, auto_sign: cur?.auto_sign ?? false })}
            className="rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save signature"}
          </button>
        </div>
      )}
      {save.isError ? <p className="mt-1 text-xs text-destructive">{(save.error as Error).message}</p> : null}
    </section>
  );
}
