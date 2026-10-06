import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { listMyVehicles, updateVehicleHire } from "@/lib/hire.functions";

/**
 * Lets an owner manage every car they have: photo, seats, daily price and
 * whether it is free for hire right now.
 */
export function HireVehicleManager() {
  const queryClient = useQueryClient();
  const listFn = useServerFn(listMyVehicles);
  const updateFn = useServerFn(updateVehicleHire);
  const vehicles = useQuery({ queryKey: ["my-vehicles"], queryFn: () => listFn() });
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const update = useMutation({
    mutationFn: (vars: {
      vehicleId: string;
      hireAvailable?: boolean;
      hireMode?: "self_drive" | "chauffeured" | "both";
      dailyRate?: number | null;
      seats?: number | null;
      description?: string | null;
      photoPath?: string | null;
      addPhotoPath?: string;
      removePhotoPath?: string;
      rules?: string | null;
    }) => updateFn({ data: vars }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-vehicles"] }),
    onError: (error) => setNotice((error as Error).message),
  });

  async function uploadPhoto(vehicleId: string, file: File) {
    setBusyId(vehicleId);
    setNotice(null);
    const path = `${vehicleId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9.]/g, "")}`;
    const { error } = await supabase.storage.from("vehicle-photos").upload(path, file, {
      upsert: true,
      contentType: file.type,
    });
    setBusyId(null);
    if (error) {
      setNotice(error.message);
      return;
    }
    update.mutate({ vehicleId, addPhotoPath: path });
  }

  return (
    <section className="surface-card p-4">
      <h3 className="text-sm font-semibold text-foreground">My vehicles for hire</h3>
      <p className="mt-1 text-xs text-muted-foreground">
        Add a photo and a daily price, then switch a car on when it is free to be hired.
      </p>

      {vehicles.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading your vehicles…</p>
      ) : null}
      {!vehicles.isPending && (vehicles.data ?? []).length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">
          You have no approved vehicles yet. Add one first and we will list it here.
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {(vehicles.data ?? []).map((vehicle) => (
          <article key={vehicle.id} className="rounded-2xl border border-border p-3">
            <div className="flex gap-3">
              {vehicle.photo_link ? (
                <img
                  src={vehicle.photo_link}
                  alt={`${vehicle.make ?? "Vehicle"} ${vehicle.model ?? ""} ${vehicle.plate_number}`}
                  loading="lazy"
                  className="h-20 w-28 shrink-0 rounded-xl object-cover"
                />
              ) : (
                <div className="grid h-20 w-28 shrink-0 place-items-center rounded-xl bg-secondary text-[10px] text-muted-foreground">
                  No photo
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">
                  {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Vehicle"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {vehicle.plate_number} · {vehicle.vehicle_class} · {vehicle.status}
                </p>
                <label className="mt-2 inline-flex cursor-pointer items-center gap-2 rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground">
                  {busyId === vehicle.id ? "Uploading…" : "Add photos"}
                  <input
                    type="file"
                    accept="image/*"
                    multiple
                    className="hidden"
                    onChange={async (event) => {
                      for (const file of Array.from(event.target.files ?? [])) {
                        await uploadPhoto(vehicle.id, file);
                      }
                    }}
                  />
                </label>
              </div>
            </div>

            <div className="mt-3 grid gap-2 sm:grid-cols-3">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Daily price (KES)</span>
                <input
                  defaultValue={vehicle.hire_daily_rate ?? ""}
                  inputMode="decimal"
                  onBlur={(event) =>
                    update.mutate({
                      vehicleId: vehicle.id,
                      dailyRate: event.target.value === "" ? null : Number(event.target.value) || 0,
                    })
                  }
                  className="input-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Seats</span>
                <input
                  defaultValue={vehicle.seats ?? ""}
                  inputMode="numeric"
                  onBlur={(event) =>
                    update.mutate({
                      vehicleId: vehicle.id,
                      seats: event.target.value === "" ? null : Number(event.target.value) || 1,
                    })
                  }
                  className="input-base"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Hire type</span>
                <select
                  defaultValue={vehicle.hire_mode ?? "self_drive"}
                  onChange={(event) =>
                    update.mutate({
                      vehicleId: vehicle.id,
                      hireMode: event.target.value as "self_drive" | "chauffeured" | "both",
                    })
                  }
                  className="input-base"
                >
                  <option value="self_drive">Customer drives</option>
                  <option value="chauffeured">With a driver</option>
                  <option value="both">Either</option>
                </select>
              </label>
            </div>

            <label className="mt-2 block">
              <span className="text-[11px] text-muted-foreground">Short description</span>
              <input
                defaultValue={vehicle.hire_description ?? ""}
                placeholder="Clean, fuel-efficient, ideal for upcountry trips"
                onBlur={(event) =>
                  update.mutate({ vehicleId: vehicle.id, description: event.target.value || null })
                }
                className="input-base"
              />
            </label>

            {vehicle.photo_links.length > 1 ? (
              <div className="mt-2 flex gap-2 overflow-x-auto">
                {vehicle.photo_links.map((src, i) => (
                  <div key={src} className="relative shrink-0">
                    <img src={src} alt={`Vehicle photo ${i + 1}`} className="h-14 w-20 rounded-lg object-cover" />
                    {vehicle.photo_urls?.[i] ? (
                      <button
                        aria-label="Remove photo"
                        onClick={() => update.mutate({ vehicleId: vehicle.id, removePhotoPath: vehicle.photo_urls?.[i] ?? "" })}
                        className="absolute right-0.5 top-0.5 rounded-full bg-card px-1.5 text-[10px] text-destructive"
                      >
                        ✕
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <label className="mt-2 block">
              <span className="text-[11px] text-muted-foreground">Your rules for hirers</span>
              <textarea
                defaultValue={vehicle.hire_rules ?? ""}
                rows={3}
                placeholder="No smoking. No carrying livestock or heavy goods. Return with the same fuel level."
                onBlur={(event) => update.mutate({ vehicleId: vehicle.id, rules: event.target.value || null })}
                className="input-base"
              />
            </label>

            <button
              onClick={() =>
                update.mutate({ vehicleId: vehicle.id, hireAvailable: !vehicle.hire_available })
              }
              className={`mt-3 w-full rounded-full px-3 py-2 text-xs font-semibold ${
                vehicle.hire_available
                  ? "bg-primary text-primary-foreground"
                  : "border border-input bg-secondary text-secondary-foreground"
              }`}
            >
              {vehicle.hire_available ? "Available for hire" : "Not available"}
            </button>
          </article>
        ))}
      </div>
      {notice ? <p className="mt-2 text-xs text-destructive">{notice}</p> : null}
    </section>
  );
}
