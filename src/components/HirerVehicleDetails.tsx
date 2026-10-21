import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { saveHirerVehicleDetails } from "@/lib/hire-agreement.functions";

type Reading = { odometer: number; fuel: string; notes: string | null; photos: { name: string; path: string }[]; at: string };
type Stage = "pickup" | "return";
const FUEL = ["Full", "3/4", "1/2", "1/4", "Reserve"];

/** Hirer's own odometer, fuel, notes and camera photos at pickup and return. */
export function HirerVehicleDetails({
  quoteId,
  saved,
  ownerOdometer,
  ownerFuel,
}: {
  quoteId: string;
  saved: { pickup?: Reading; return?: Reading } | null;
  ownerOdometer: number | null;
  ownerFuel: string | null;
}) {
  const qc = useQueryClient();
  const saveFn = useServerFn(saveHirerVehicleDetails);
  const [stage, setStage] = useState<Stage>(saved?.pickup ? "return" : "pickup");
  const current = saved?.[stage];
  const [odo, setOdo] = useState(current ? String(current.odometer) : "");
  const [fuel, setFuel] = useState(current?.fuel ?? "Full");
  const [notes, setNotes] = useState(current?.notes ?? "");
  const [photos, setPhotos] = useState<{ name: string; path: string }[]>([]);
  const [photoName, setPhotoName] = useState("Odometer");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  function pick(s: Stage) {
    setStage(s);
    const r = saved?.[s];
    setOdo(r ? String(r.odometer) : "");
    setFuel(r?.fuel ?? "Full");
    setNotes(r?.notes ?? "");
    setPhotos([]);
    setMsg(null);
  }

  async function upload(file: File) {
    const name = photoName.trim() || "Photo";
    setBusy(true);
    setMsg(null);
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) return setBusy(false);
    const path = `${auth.user.id}/hirer-${quoteId}-${stage}-${Date.now()}.${file.name.split(".").pop() ?? "jpg"}`;
    const { error } = await supabase.storage.from("hire-documents").upload(path, file, { upsert: false, contentType: file.type });
    setBusy(false);
    if (error) return setMsg(error.message);
    setPhotos((p) => [...p, { name, path }]);
    setPhotoName("");
  }

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          quoteId,
          stage,
          odometer: Number(odo),
          fuel,
          notes: notes.trim() || null,
          photos,
          device: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 300) : null,
        },
      }),
    onSuccess: () => {
      setMsg(stage === "pickup" ? "Pickup details saved." : "Return details saved.");
      setPhotos([]);
      void qc.invalidateQueries({ queryKey: ["hire-quotes"] });
    },
    onError: (e) => setMsg((e as Error).message),
  });

  const pickup = saved?.pickup;
  const driven = stage === "return" && pickup && odo ? Number(odo) - pickup.odometer : null;

  return (
    <div className="mt-2 rounded-xl border border-border p-3 text-xs">
      <p className="text-sm font-semibold text-foreground">Car details</p>
      <p className="mt-0.5 text-muted-foreground">Record what you see so nothing can be disputed later.</p>
      <div className="mt-2 flex gap-2">
        {(["pickup", "return"] as const).map((s) => (
          <button
            key={s}
            onClick={() => pick(s)}
            className={`rounded-full px-3 py-1.5 font-semibold ${stage === s ? "bg-primary text-primary-foreground" : "border border-input text-foreground"}`}
          >
            {s === "pickup" ? "At pickup" : "At return"} {saved?.[s] ? "✓" : ""}
          </button>
        ))}
      </div>
      {stage === "pickup" && ownerOdometer != null ? (
        <p className="mt-2 text-muted-foreground">
          Owner recorded {ownerOdometer.toLocaleString("en-KE")} km{ownerFuel ? `, fuel ${ownerFuel}` : ""}.
        </p>
      ) : null}
      {current ? (
        <p className="mt-2 text-muted-foreground">
          Last saved {new Date(current.at).toLocaleString("en-KE")}: {current.odometer.toLocaleString("en-KE")} km, fuel {current.fuel}
          {current.photos.length ? `, ${current.photos.length} photo(s)` : ""}.
        </p>
      ) : null}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <label className="font-medium text-foreground">
          Odometer (km)
          <input value={odo} onChange={(e) => setOdo(e.target.value.replace(/\D/g, ""))} inputMode="numeric" className="input-base mt-1" />
        </label>
        <label className="font-medium text-foreground">
          Fuel level
          <select value={fuel} onChange={(e) => setFuel(e.target.value)} className="input-base mt-1">
            {FUEL.map((f) => <option key={f}>{f}</option>)}
          </select>
        </label>
      </div>
      {driven != null && driven >= 0 ? (
        <p className="mt-1 text-muted-foreground">Distance driven: {driven.toLocaleString("en-KE")} km</p>
      ) : null}
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Scratches, dents, missing items, warning lights…"
        className="input-base mt-2 w-full"
        rows={2}
      />
      <div className="mt-2">
        {photos.length ? (
          <ul className="mb-1 space-y-0.5">
            {photos.map((p, i) => (
              <li key={p.path} className="flex justify-between text-success">
                <span>✓ {p.name}</span>
                <button onClick={() => setPhotos((x) => x.filter((_, j) => j !== i))} className="text-destructive">Remove</button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex gap-2">
          <input value={photoName} onChange={(e) => setPhotoName(e.target.value)} maxLength={60} placeholder="Photo name, e.g. Fuel gauge" className="input-base min-w-0 flex-1" />
          <label className="shrink-0 cursor-pointer rounded-lg border border-primary px-3 py-2 font-semibold text-primary">
            {busy ? "Uploading…" : "📷 Take photo"}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (f) void upload(f);
              }}
            />
          </label>
        </div>
      </div>
      <button
        onClick={() => save.mutate()}
        disabled={!odo || busy || save.isPending}
        className="mt-2 rounded-full bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-50"
      >
        {save.isPending ? "Saving…" : stage === "pickup" ? "Save pickup details" : "Save return details"}
      </button>
      {msg ? <p className="mt-1 text-muted-foreground">{msg}</p> : null}
    </div>
  );
}
