import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import {
  getApproachFeeSettings,
  updateApproachFeeSettings,
} from "@/lib/admin.functions";

export function ApproachFeeSettingsCard() {
  const queryClient = useQueryClient();
  const getSettingsFn = useServerFn(getApproachFeeSettings);
  const updateSettingsFn = useServerFn(updateApproachFeeSettings);
  const settings = useQuery({
    queryKey: ["approach-fee-settings"],
    queryFn: () => getSettingsFn({}),
  });
  const [shortPercent, setShortPercent] = useState("50");
  const [longPercent, setLongPercent] = useState("30");

  useEffect(() => {
    if (!settings.data) return;
    setShortPercent(String(settings.data.shortPercent));
    setLongPercent(String(settings.data.longPercent));
  }, [settings.data]);

  const save = useMutation({
    mutationFn: () =>
      updateSettingsFn({
        data: {
          shortPercent: Number(shortPercent),
          longPercent: Number(longPercent),
        },
      }),
    onSuccess: (result) => {
      setShortPercent(String(result.shortPercent));
      setLongPercent(String(result.longPercent));
      void queryClient.invalidateQueries({ queryKey: ["approach-fee-settings"] });
      void queryClient.invalidateQueries({ queryKey: ["pricing-workspace"] });
    },
  });

  const validPercent = (value: string) =>
    value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;
  const canSave =
    validPercent(shortPercent) &&
    validPercent(longPercent) &&
    !save.isPending &&
    !settings.isPending &&
    !settings.isError;

  return (
    <section className="surface-card p-4">
      <h2 className="text-sm font-semibold text-foreground">Distant pickup driver fee</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Set the share of the estimated empty-drive cost added to a customer’s fare and paid to the
        driver. The fee is zero within 0.5 km, uses the short-approach share through 1.5 km, and
        tapers linearly to the long-approach share at 5 km and beyond. Changes affect new quotes;
        existing quotes keep their saved fare.
      </p>
      {settings.error ? (
        <p className="mt-2 text-xs text-destructive">{(settings.error as Error).message}</p>
      ) : null}
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-xs font-medium text-foreground">
          Short approach share (0.5–1.5 km) %
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            inputMode="decimal"
            value={shortPercent}
            onChange={(event) => setShortPercent(event.target.value)}
            className="input-base mt-1"
          />
        </label>
        <label className="text-xs font-medium text-foreground">
          Long approach share (5+ km) %
          <input
            type="number"
            min={0}
            max={100}
            step="0.1"
            inputMode="decimal"
            value={longPercent}
            onChange={(event) => setLongPercent(event.target.value)}
            className="input-base mt-1"
          />
        </label>
      </div>
      <button
        type="button"
        onClick={() => save.mutate()}
        disabled={!canSave}
        className="mt-3 w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
      >
        {settings.isPending ? "Loading…" : save.isPending ? "Saving…" : "Save pickup fee shares"}
      </button>
      {save.isError ? (
        <p className="mt-2 text-xs text-destructive">{(save.error as Error).message}</p>
      ) : null}
      {save.isSuccess ? (
        <p className="mt-2 text-xs text-success">Pickup fee shares saved.</p>
      ) : null}
    </section>
  );
}
