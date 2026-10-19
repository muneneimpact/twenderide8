import { useEffect, useRef, useState } from "react";

/** Draw-or-type signature. Emits "data:image/png..." or "typed:Name", or "" when empty. */
export function SignaturePad({ onChange, initialTyped = "" }: { onChange: (sig: string) => void; initialTyped?: string }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(initialTyped);
  const [drawn, setDrawn] = useState<string | null>(null);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const drawing = useRef(false);

  useEffect(() => {
    onChange(mode === "type" ? (typed.trim().length >= 2 ? `typed:${typed.trim()}` : "") : drawn ?? "");
  }, [mode, typed, drawn, onChange]);

  function pos(e: React.PointerEvent<HTMLCanvasElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 600, ((e.clientY - r.top) / r.height) * 180] as const;
  }

  return (
    <div className="space-y-2">
      <div className="flex gap-1 rounded-full bg-secondary p-1 text-xs">
        {(["draw", "type"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded-full px-3 py-1.5 font-semibold ${mode === m ? "bg-card text-foreground shadow" : "text-muted-foreground"}`}
          >
            {m === "draw" ? "Sign by hand" : "Type signature"}
          </button>
        ))}
      </div>
      {mode === "draw" ? (
        <div>
          <canvas
            ref={canvas}
            width={600}
            height={180}
            className="h-36 w-full touch-none rounded-lg border border-dashed border-border bg-card"
            onPointerDown={(e) => {
              drawing.current = true;
              const ctx = canvas.current!.getContext("2d")!;
              const [x, y] = pos(e);
              ctx.lineWidth = 3;
              ctx.lineCap = "round";
              ctx.strokeStyle = "#111827";
              ctx.beginPath();
              ctx.moveTo(x, y);
            }}
            onPointerMove={(e) => {
              if (!drawing.current) return;
              const ctx = canvas.current!.getContext("2d")!;
              const [x, y] = pos(e);
              ctx.lineTo(x, y);
              ctx.stroke();
            }}
            onPointerUp={() => {
              drawing.current = false;
              setDrawn(canvas.current!.toDataURL("image/png"));
            }}
          />
          <button
            type="button"
            onClick={() => {
              canvas.current!.getContext("2d")!.clearRect(0, 0, 600, 180);
              setDrawn(null);
            }}
            className="mt-1 text-xs font-semibold text-primary"
          >
            Clear
          </button>
        </div>
      ) : (
        <input value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Type your full name" className="input-base w-full font-display text-lg italic" />
      )}
    </div>
  );
}
