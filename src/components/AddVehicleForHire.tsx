import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { addVehicleForDriver, addVehicleForHire } from "@/lib/account.functions";

const vehicleClasses = ["boda", "e_boda", "go", "plus", "comfort", "xl"] as const;

export function AddVehicleForHire({ hireOnly = false }: { hireOnly?: boolean }) {
  const queryClient = useQueryClient();
  const addDriverVehicleFn = useServerFn(addVehicleForDriver);
  const addHireVehicleFn = useServerFn(addVehicleForHire);
  const [open, setOpen] = useState(false);
  const [plate, setPlate] = useState("");
  const [vehicleClass, setVehicleClass] = useState<(typeof vehicleClasses)[number]>("go");
  const [make, setMake] = useState("");
  const [model, setModel] = useState("");
  const [colour, setColour] = useState("");
  const [year, setYear] = useState("");
  const add = useMutation({
    mutationFn: () => {
      const input = {
        data: {
          plate_number: plate,
          vehicle_class: vehicleClass,
          ...(make.trim() ? { make: make.trim() } : {}),
          ...(model.trim() ? { model: model.trim() } : {}),
          ...(colour.trim() ? { colour: colour.trim() } : {}),
          ...(year.trim() ? { year: Number(year) } : {}),
        },
      };
      return hireOnly ? addHireVehicleFn(input) : addDriverVehicleFn(input);
    },
    onSuccess: () => {
      setPlate("");
      setMake("");
      setModel("");
      setColour("");
      setYear("");
      void queryClient.invalidateQueries({ queryKey: ["my-vehicles"] });
      void queryClient.invalidateQueries({ queryKey: ["driver-onboarding"] });
      void queryClient.invalidateQueries({ queryKey: ["ops-board"] });
    },
  });

  return (
    <div className="mt-4 rounded-2xl border border-dashed border-border p-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="w-full rounded-full border border-input px-4 py-2.5 text-sm font-semibold text-foreground"
      >
        {open ? "Close vehicle form" : hireOnly ? "Add a vehicle for hire" : "Add another vehicle"}
      </button>
      {open ? (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-muted-foreground">
            {hireOnly
              ? "Ops must approve the vehicle and inspect the hire listing separately. This does not register you as a ride driver."
              : "New vehicles are checked by Ops before they can be used or listed for hire."}
          </p>
          <input
            value={plate}
            onChange={(event) => setPlate(event.target.value.toUpperCase())}
            placeholder="Number plate"
            maxLength={16}
            className="input-base"
          />
          <select
            value={vehicleClass}
            onChange={(event) => setVehicleClass(event.target.value as typeof vehicleClass)}
            className="input-base"
          >
            {vehicleClasses.map((item) => (
              <option key={item} value={item}>
                {item.replace("_", " ").toUpperCase()}
              </option>
            ))}
          </select>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={make}
              onChange={(event) => setMake(event.target.value)}
              placeholder="Make"
              maxLength={40}
              className="input-base"
            />
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="Model"
              maxLength={40}
              className="input-base"
            />
            <input
              value={colour}
              onChange={(event) => setColour(event.target.value)}
              placeholder="Colour"
              maxLength={24}
              className="input-base"
            />
            <input
              value={year}
              onChange={(event) => setYear(event.target.value.replace(/\D/g, ""))}
              placeholder="Year"
              inputMode="numeric"
              maxLength={4}
              className="input-base"
            />
          </div>
          <button
            type="button"
            onClick={() => add.mutate()}
            disabled={add.isPending || plate.trim().length < 4}
            className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {add.isPending
              ? "Adding vehicle…"
              : hireOnly
                ? "Submit vehicle for Ops approval"
                : "Submit vehicle for approval"}
          </button>
          {add.isError ? (
            <p className="text-xs text-destructive">{(add.error as Error).message}</p>
          ) : null}
          {add.isSuccess ? (
            <p className="text-xs text-success">
              {hireOnly
                ? "Vehicle sent for Ops approval. Hire listing review is a separate step."
                : "Vehicle added and sent to Ops for review."}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
