import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { RoleGate } from "@/components/RoleGate";
import {
  getPricingWorkspace,
  previewDistancePolicy,
  publishDistancePolicy,
  saveDistancePolicy,
  saveFareConfig,
  setModifier,
  setSystemSetting,
} from "@/lib/admin.functions";

export const Route = createFileRoute("/_authenticated/admin/pricing")({
  head: () => ({
    meta: [
      { title: "Pricing controls — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Super admin pricing workspace: edit fare configuration, build progressive long-distance reduction bands, preview them and publish when they are correct.",
      },
      { property: "og:title", content: "Pricing controls — Twende Meru Rides" },
      { property: "og:description", content: "Fare configuration, long-distance bands, modifiers and settings." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: () => (
    <RoleGate allow={["super_admin"]} title="Pricing">
      <PricingWorkspace />
    </RoleGate>
  ),
});

type VehicleClass = "boda" | "economy" | "comfort" | "xl";

interface BandDraft {
  sort_order: number;
  admin_label: string;
  customer_explanation?: string | null;
  lower_km: number;
  upper_km: number | null;
  start_reduction_percent: number;
  end_reduction_percent: number;
  mode: "linear" | "fixed";
}

const emptyBand = (order: number): BandDraft => ({
  sort_order: order,
  admin_label: `Band ${order}`,
  customer_explanation: null,
  lower_km: 0,
  upper_km: null,
  start_reduction_percent: 0,
  end_reduction_percent: 0,
  mode: "linear",
});

function PricingWorkspace() {
  const queryClient = useQueryClient();
  const fetchWorkspace = useServerFn(getPricingWorkspace);
  const previewFn = useServerFn(previewDistancePolicy);
  const saveFn = useServerFn(saveDistancePolicy);
  const publishFn = useServerFn(publishDistancePolicy);
  const fareFn = useServerFn(saveFareConfig);
  const modifierFn = useServerFn(setModifier);
  const settingFn = useServerFn(setSystemSetting);

  const workspace = useQuery({ queryKey: ["pricing-workspace"], queryFn: () => fetchWorkspace({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["pricing-workspace"] });

  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("economy");
  const [policyName, setPolicyName] = useState("Long-distance reduction");
  const [maxReduction, setMaxReduction] = useState(35);
  const [bands, setBands] = useState<BandDraft[]>([
    { ...emptyBand(1), lower_km: 0, upper_km: 10 },
    { ...emptyBand(2), lower_km: 10, upper_km: 40, start_reduction_percent: 0, end_reduction_percent: 20 },
    { ...emptyBand(3), lower_km: 40, upper_km: null, start_reduction_percent: 20, end_reduction_percent: 30 },
  ]);
  const [fare, setFare] = useState<Record<string, string>>({});
  const [settingKey, setSettingKey] = useState("");
  const [settingValue, setSettingValue] = useState("");

  const preview = useMutation({
    mutationFn: () =>
      previewFn({ data: { vehicleClass, maxTotalReductionPercent: maxReduction, bands } }),
  });
  const savePolicy = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          name: policyName,
          vehicleClass: null,
          maxTotalReductionPercent: maxReduction,
          bands,
        },
      }),
    onSuccess: invalidate,
  });
  const publish = useMutation({
    mutationFn: (policyId: string) => publishFn({ data: { policyId } }),
    onSuccess: invalidate,
  });
  const saveFare = useMutation({
    mutationFn: (publishNow: boolean) => {
      const current = workspace.data!.configs.find(
        (c) => c.vehicle_class === vehicleClass && c.state === "published",
      );
      const num = (key: string, fallback: unknown) =>
        fare[key] !== undefined && fare[key] !== "" ? Number(fare[key]) : Number(fallback ?? 0);
      return fareFn({
        data: {
          vehicleClass,
          base_fare: num("base_fare", current?.base_fare),
          per_km: num("per_km", current?.per_km),
          per_minute: num("per_minute", current?.per_minute),
          minimum_fare: num("minimum_fare", current?.minimum_fare),
          booking_fee: num("booking_fee", current?.booking_fee),
          waiting_per_minute: num("waiting_per_minute", current?.waiting_per_minute),
          free_waiting_minutes: num("free_waiting_minutes", current?.free_waiting_minutes),
          cancellation_fee: num("cancellation_fee", current?.cancellation_fee),
          cancellation_free_seconds: num("cancellation_free_seconds", current?.cancellation_free_seconds),
          commission_percent: num("commission_percent", current?.commission_percent),
          rounding_rule: (fare["rounding_rule"] ?? current?.rounding_rule ?? "nearest_5") as
            | "nearest_1"
            | "nearest_5"
            | "nearest_10"
            | "up_5"
            | "up_10",
          modifier_combination: (fare["modifier_combination"] ??
            current?.modifier_combination ??
            "additive") as "additive" | "compounded",
          max_surcharge_percent: num("max_surcharge_percent", current?.max_surcharge_percent),
          publish: publishNow,
        },
      });
    },
    onSuccess: () => {
      setFare({});
      invalidate();
    },
  });
  const modifier = useMutation({
    mutationFn: (vars: { id: string; active?: boolean; percent?: number }) => modifierFn({ data: vars }),
    onSuccess: invalidate,
  });
  const setting = useMutation({
    mutationFn: () => settingFn({ data: { key: settingKey.trim(), value: settingValue.trim() } }),
    onSuccess: () => {
      setSettingKey("");
      setSettingValue("");
      invalidate();
    },
  });

  if (workspace.isPending) {
    return (
      <AppShell title="Pricing" eyebrow="Twende Super Admin">
        <p className="px-4 py-6 text-sm text-muted-foreground">Loading pricing…</p>
      </AppShell>
    );
  }
  if (workspace.error) {
    return (
      <AppShell title="Pricing" eyebrow="Twende Super Admin">
        <p className="px-4 py-6 text-sm text-destructive">{(workspace.error as Error).message}</p>
      </AppShell>
    );
  }

  const w = workspace.data!;
  const published = w.configs.find((c) => c.vehicle_class === vehicleClass && c.state === "published");
  const fareFields: { key: string; label: string; value: unknown }[] = [
    { key: "base_fare", label: "Base fare", value: published?.base_fare },
    { key: "per_km", label: "Per km", value: published?.per_km },
    { key: "per_minute", label: "Per minute", value: published?.per_minute },
    { key: "minimum_fare", label: "Minimum fare", value: published?.minimum_fare },
    { key: "booking_fee", label: "Booking fee", value: published?.booking_fee },
    { key: "waiting_per_minute", label: "Waiting per minute", value: published?.waiting_per_minute },
    { key: "free_waiting_minutes", label: "Free waiting minutes", value: published?.free_waiting_minutes },
    { key: "cancellation_fee", label: "Cancellation fee", value: published?.cancellation_fee },
    {
      key: "cancellation_free_seconds",
      label: "Free cancellation seconds",
      value: published?.cancellation_free_seconds,
    },
    { key: "commission_percent", label: "Commission %", value: published?.commission_percent },
    { key: "max_surcharge_percent", label: "Max surcharge %", value: published?.max_surcharge_percent },
  ];

  return (
    <AppShell title="Pricing" eyebrow="Twende Super Admin">
      <div className="hero-gradient px-4 pb-6 pt-5">
        <div className="mx-auto max-w-md">
          <div className="glass flex gap-1 p-1.5">
            {(["boda", "economy", "comfort", "xl"] as const).map((key) => (
              <button
                key={key}
                onClick={() => setVehicleClass(key)}
                className={`flex-1 rounded-full px-3 py-2 text-xs font-semibold capitalize ${
                  vehicleClass === key
                    ? "bg-primary text-primary-foreground"
                    : "text-brand-foreground/80"
                }`}
              >
                {key}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-md space-y-4 px-4 py-5">
        {/* Fare configuration */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">
            Fare configuration · {vehicleClass}
            {published ? ` (v${published.version})` : " (none published)"}
          </h3>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {fareFields.map((field) => (
              <label key={field.key} className="block">
                <span className="text-[11px] text-muted-foreground">{field.label}</span>
                <input
                  value={fare[field.key] ?? String(field.value ?? "")}
                  onChange={(e) => setFare({ ...fare, [field.key]: e.target.value })}
                  inputMode="decimal"
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
            ))}
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Rounding</span>
              <select
                value={fare["rounding_rule"] ?? published?.rounding_rule ?? "nearest_5"}
                onChange={(e) => setFare({ ...fare, rounding_rule: e.target.value })}
                className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
              >
                {["nearest_1", "nearest_5", "nearest_10", "up_5", "up_10"].map((rule) => (
                  <option key={rule} value={rule}>
                    {rule}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Modifiers</span>
              <select
                value={fare["modifier_combination"] ?? published?.modifier_combination ?? "additive"}
                onChange={(e) => setFare({ ...fare, modifier_combination: e.target.value })}
                className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
              >
                <option value="additive">additive</option>
                <option value="compounded">compounded</option>
              </select>
            </label>
          </div>
          <div className="mt-3 space-y-2">
            <button
              onClick={() => saveFare.mutate(true)}
              disabled={saveFare.isPending}
              className="w-full rounded-full bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              {saveFare.isPending ? "Saving…" : `Save & activate ${vehicleClass} pricing now`}
            </button>
            <button
              onClick={() => saveFare.mutate(false)}
              disabled={saveFare.isPending}
              className="w-full rounded-full border border-input px-3 py-2.5 text-xs font-medium text-muted-foreground disabled:opacity-60"
            >
              Save as draft instead (not charged to customers)
            </button>
          </div>
          {saveFare.isSuccess ? (
            <p className="mt-2 text-xs text-success">
              Saved. Activated prices apply to every new quote immediately.
            </p>
          ) : null}
          {saveFare.isError ? (
            <p className="mt-2 text-xs text-destructive">{(saveFare.error as Error).message}</p>
          ) : null}
        </section>


        {/* Distance bands */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Long-distance reduction bands</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Bands apply to the distance charge only, must start at 0 km and stay contiguous. Nothing affects
            customers until you publish.
          </p>
          <div className="mt-3 space-y-2">
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Policy name</span>
              <input
                value={policyName}
                onChange={(e) => setPolicyName(e.target.value)}
                className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
              />
            </label>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Maximum total reduction %</span>
              <input
                value={maxReduction}
                onChange={(e) => setMaxReduction(Number(e.target.value) || 0)}
                inputMode="decimal"
                className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
              />
            </label>
          </div>

          <ul className="mt-3 space-y-3">
            {bands.map((band, index) => (
              <li key={index} className="rounded-2xl border border-border p-3">
                <input
                  value={band.admin_label}
                  onChange={(e) => {
                    const next = [...bands];
                    next[index] = { ...band, admin_label: e.target.value };
                    setBands(next);
                  }}
                  className="w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm font-medium"
                />
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {(
                    [
                      ["lower_km", "From km"],
                      ["upper_km", "To km (blank = ∞)"],
                      ["start_reduction_percent", "Start %"],
                      ["end_reduction_percent", "End %"],
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} className="block">
                      <span className="text-[11px] text-muted-foreground">{label}</span>
                      <input
                        value={band[key] === null ? "" : String(band[key])}
                        onChange={(e) => {
                          const raw = e.target.value;
                          const next = [...bands];
                          next[index] = {
                            ...band,
                            [key]: key === "upper_km" && raw.trim() === "" ? null : Number(raw) || 0,
                          } as BandDraft;
                          setBands(next);
                        }}
                        inputMode="decimal"
                        className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <select
                    value={band.mode}
                    onChange={(e) => {
                      const next = [...bands];
                      next[index] = { ...band, mode: e.target.value as "linear" | "fixed" };
                      setBands(next);
                    }}
                    className="flex-1 rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                  >
                    <option value="linear">linear ramp</option>
                    <option value="fixed">fixed</option>
                  </select>
                  <button
                    onClick={() =>
                      setBands(
                        bands
                          .filter((_, i) => i !== index)
                          .map((b, i) => ({ ...b, sort_order: i + 1 })),
                      )
                    }
                    className="rounded-full border border-destructive px-3 py-2 text-xs text-destructive"
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <button
            onClick={() => setBands([...bands, emptyBand(bands.length + 1)])}
            className="mt-3 w-full rounded-full border border-input px-3 py-2.5 text-sm font-medium text-foreground"
          >
            Add band
          </button>

          <div className="mt-3 flex gap-2">
            <button
              onClick={() => preview.mutate()}
              disabled={preview.isPending}
              className="flex-1 rounded-full border border-input px-3 py-2.5 text-sm font-medium text-foreground disabled:opacity-60"
            >
              Preview
            </button>
            <button
              onClick={() => savePolicy.mutate()}
              disabled={savePolicy.isPending}
              className="flex-1 rounded-full bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              Save draft
            </button>
          </div>

          {preview.data?.issues?.length ? (
            <ul className="mt-3 space-y-1 text-xs text-destructive">
              {preview.data.issues.map((issue, i) => (
                <li key={i}>{issue.band ? `${issue.band}: ${issue.message}` : issue.message}</li>
              ))}
            </ul>

          ) : null}
          {preview.data?.rows?.length ? (
            <table className="mt-3 w-full text-xs">
              <thead>
                <tr className="text-muted-foreground">
                  <th className="text-left font-medium">km</th>
                  <th className="text-right font-medium">fare</th>
                  <th className="text-right font-medium">saving</th>
                </tr>
              </thead>
              <tbody>
                {preview.data.rows.map((row, i) => (
                  <tr key={i} className="text-foreground">
                    <td>{row.distance_km}</td>
                    <td className="text-right">{row.total.toFixed(2)}</td>
                    <td className="text-right">{row.saving.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : null}
          {savePolicy.data && !savePolicy.data.saved ? (
            <ul className="mt-3 space-y-1 text-xs text-destructive">
              {savePolicy.data.issues.map((issue, i) => (
                <li key={i}>{issue.band ? `${issue.band}: ${issue.message}` : issue.message}</li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* Policy versions */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Policy versions</h3>
          <ul className="mt-2 divide-y divide-border">
            {w.policies.map((policy) => (
              <li key={policy.id} className="flex items-center justify-between gap-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-foreground">
                    v{policy.version} · {policy.name}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {policy.state} · max {Number(policy.max_total_reduction_percent)}% ·{" "}
                    {w.bands.filter((b) => b.policy_id === policy.id).length} bands
                  </p>
                </div>
                {policy.state !== "published" ? (
                  <button
                    onClick={() => publish.mutate(policy.id)}
                    disabled={publish.isPending}
                    className="rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    Publish
                  </button>
                ) : (
                  <span className="text-xs font-medium text-foreground">Live</span>
                )}
              </li>
            ))}
          </ul>
          {publish.data && !publish.data.published ? (
            <ul className="mt-2 space-y-1 text-xs text-destructive">
              {publish.data.issues.map((issue, i) => (
                <li key={i}>{issue.band ? `${issue.band}: ${issue.message}` : issue.message}</li>
              ))}
            </ul>
          ) : null}
        </section>

        {/* Modifiers */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">Pricing modifiers</h3>
          <ul className="mt-2 divide-y divide-border">
            {w.modifiers.map((m) => (
              <li key={m.id} className="py-3">
                <p className="text-sm font-medium text-foreground">{m.customer_label}</p>
                <p className="text-xs text-muted-foreground">
                  {m.code} · {m.activation} · {m.state}
                </p>
                <div className="mt-2 flex items-center gap-2">
                  <input
                    defaultValue={String(Number(m.percent))}
                    onBlur={(e) => modifier.mutate({ id: m.id, percent: Number(e.target.value) || 0 })}
                    inputMode="decimal"
                    className="w-24 rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                  />
                  <button
                    onClick={() => modifier.mutate({ id: m.id, active: !m.active })}
                    className={`rounded-full px-3 py-2 text-xs font-medium ${
                      m.active ? "bg-primary text-primary-foreground" : "border border-input text-foreground"
                    }`}
                  >
                    {m.active ? "Active" : "Paused"}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>

        {/* Settings */}
        <section className="surface-card p-4">
          <h3 className="text-sm font-semibold text-foreground">System settings</h3>
          <ul className="mt-2 divide-y divide-border">
            {w.settings.map((s) => (
              <li key={s.key} className="py-2 text-xs">
                <button
                  onClick={() => {
                    setSettingKey(s.key);
                    setSettingValue(typeof s.value === "string" ? s.value : JSON.stringify(s.value));
                  }}
                  className="text-left"
                >
                  <span className="font-medium text-foreground">{s.key}</span>
                  <span className="block text-muted-foreground">{JSON.stringify(s.value)}</span>
                </button>
              </li>
            ))}
          </ul>
          <div className="mt-3 space-y-2">
            <input
              value={settingKey}
              onChange={(e) => setSettingKey(e.target.value)}
              placeholder="setting key"
              className="w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
            />
            <input
              value={settingValue}
              onChange={(e) => setSettingValue(e.target.value)}
              placeholder="value"
              className="w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
            />
            <button
              onClick={() => setting.mutate()}
              disabled={settingKey.trim().length < 2 || setting.isPending}
              className="w-full rounded-full bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
            >
              Save setting
            </button>
            {setting.isError ? (
              <p className="text-xs text-destructive">{(setting.error as Error).message}</p>
            ) : null}
          </div>
        </section>
      </div>
    </AppShell>
  );
}
