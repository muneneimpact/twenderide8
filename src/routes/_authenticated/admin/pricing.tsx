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
  listPromotions,
  savePromotion,
  togglePromotion,
  deletePromotion,
} from "@/lib/admin.functions";
import { promoState, type PromoState } from "@/lib/discounts";

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

type VehicleClass = "boda" | "e_boda" | "go" | "plus" | "comfort" | "xl";

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

  const [vehicleClass, setVehicleClass] = useState<VehicleClass>("go");
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
            {(["boda", "e_boda", "go", "plus", "comfort", "xl"] as const).map((key) => (
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

        <PromotionsBoard />
      </div>
    </AppShell>
  );
}

interface PromoForm {
  id?: string;
  code: string;
  name: string;
  description: string;
  discount_percent: string;
  max_discount_percent: string;
  max_discount_amount: string;
  min_fare: string;
  valid_from: string;
  valid_until: string;
  usage_limit: string;
  applies_to: VehicleClass[];
  active: boolean;
}

const emptyPromo = (): PromoForm => ({
  code: "",
  name: "",
  description: "",
  discount_percent: "10",
  max_discount_percent: "20",
  max_discount_amount: "",
  min_fare: "",
  valid_from: new Date().toISOString().slice(0, 16),
  valid_until: "",
  usage_limit: "",
  applies_to: [],
  active: true,
});

const promoStateLabel: Record<PromoState, { label: string; className: string }> = {
  active: { label: "Live", className: "bg-success/15 text-success" },
  expired: { label: "Expired", className: "bg-destructive/15 text-destructive" },
  not_started: { label: "Scheduled", className: "bg-warning/15 text-warning" },
  usage_exhausted: { label: "Used up", className: "bg-muted text-muted-foreground" },
  invalid: { label: "Inactive", className: "bg-muted text-muted-foreground" },
};

function PromotionsBoard() {
  const queryClient = useQueryClient();
  const fetchPromos = useServerFn(listPromotions);
  const saveFn = useServerFn(savePromotion);
  const toggleFn = useServerFn(togglePromotion);
  const deleteFn = useServerFn(deletePromotion);

  const [editing, setEditing] = useState<PromoForm | null>(null);
  const [creating, setCreating] = useState(false);

  const promos = useQuery({ queryKey: ["promotions"], queryFn: () => fetchPromos({}) });
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["promotions"] });

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          ...(editing?.id ? { id: editing.id } : {}),
          code: editing!.code,
          name: editing!.name,
          description: editing!.description.trim() || null,
          discount_percent: Number(editing!.discount_percent) || 0,
          max_discount_percent: Number(editing!.max_discount_percent) || 0,
          max_discount_amount: editing!.max_discount_amount ? Number(editing!.max_discount_amount) : null,
          min_fare: editing!.min_fare ? Number(editing!.min_fare) : null,
          valid_from: editing!.valid_from,
          valid_until: editing!.valid_until || null,
          usage_limit: editing!.usage_limit ? Number(editing!.usage_limit) : null,
          applies_to: editing!.applies_to,
          active: editing!.active,
        },
      }),
    onSuccess: () => {
      setEditing(null);
      setCreating(false);
      invalidate();
    },
  });

  const toggle = useMutation({
    mutationFn: (vars: { id: string; active: boolean }) => toggleFn({ data: vars }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: invalidate,
  });

  const list = promos.data ?? [];

  return (
    <section className="surface-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">Offers & promotions</h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Create codes with a hard maximum discount. A code can never reduce a fare beyond its configured cap.
          </p>
        </div>
        <button
          onClick={() => {
            setEditing(emptyPromo());
            setCreating(true);
          }}
          className="shrink-0 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground"
        >
          New offer
        </button>
      </div>

      {promos.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading offers…</p>
      ) : list.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">No offers yet. Create one to start offering discounts.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {list.map((promo) => {
            const state = promoState(promo);
            const meta = promoStateLabel[state];
            return (
              <li key={promo.id} className="rounded-2xl border border-border p-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-foreground">
                      {promo.code} · {promo.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {Number(promo.discount_percent)}% off, capped at {Number(promo.max_discount_percent)}% ·{" "}
                      {promo.usage_count}
                      {promo.usage_limit ? `/${promo.usage_limit}` : ""} used
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${meta.className}`}>
                    {meta.label}
                  </span>
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <button
                    onClick={() => {
                      setEditing({
                        id: promo.id,
                        code: promo.code,
                        name: promo.name,
                        description: promo.description ?? "",
                        discount_percent: String(promo.discount_percent),
                        max_discount_percent: String(promo.max_discount_percent),
                        max_discount_amount: promo.max_discount_amount != null ? String(promo.max_discount_amount) : "",
                        min_fare: promo.min_fare != null ? String(promo.min_fare) : "",
                        valid_from: promo.valid_from.slice(0, 16),
                        valid_until: promo.valid_until ? promo.valid_until.slice(0, 16) : "",
                        usage_limit: promo.usage_limit != null ? String(promo.usage_limit) : "",
                        applies_to: (promo.applies_to ?? []) as VehicleClass[],
                        active: promo.active,
                      });
                      setCreating(false);
                    }}
                    className="rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => toggle.mutate({ id: promo.id, active: !promo.active })}
                    disabled={toggle.isPending}
                    className="rounded-full border border-input px-3 py-1.5 text-xs font-medium text-foreground disabled:opacity-60"
                  >
                    {promo.active ? "Pause" : "Activate"}
                  </button>
                  <button
                    onClick={() => remove.mutate(promo.id)}
                    disabled={remove.isPending}
                    className="rounded-full border border-destructive px-3 py-1.5 text-xs font-medium text-destructive disabled:opacity-60"
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {creating || editing ? (
        <div className="mt-4 rounded-2xl border border-border bg-secondary/40 p-4">
          <h4 className="text-sm font-semibold text-foreground">{creating ? "New offer" : "Edit offer"}</h4>
          <div className="mt-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Code</span>
                <input
                  value={editing!.code}
                  onChange={(e) => setEditing({ ...editing!, code: e.target.value.toUpperCase() })}
                  placeholder="MERU20"
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm uppercase"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Name</span>
                <input
                  value={editing!.name}
                  onChange={(e) => setEditing({ ...editing!, name: e.target.value })}
                  placeholder="Meru launch"
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Description</span>
              <input
                value={editing!.description}
                onChange={(e) => setEditing({ ...editing!, description: e.target.value })}
                placeholder="Shown to customers when they apply this code"
                className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Discount %</span>
                <input
                  value={editing!.discount_percent}
                  onChange={(e) => setEditing({ ...editing!, discount_percent: e.target.value })}
                  inputMode="decimal"
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] font-semibold text-foreground">Max discount %</span>
                <input
                  value={editing!.max_discount_percent}
                  onChange={(e) => setEditing({ ...editing!, max_discount_percent: e.target.value })}
                  inputMode="decimal"
                  className="mt-0.5 w-full rounded-xl border border-primary bg-primary/5 px-2.5 py-2 text-sm font-semibold"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Max amount (KES)</span>
                <input
                  value={editing!.max_discount_amount}
                  onChange={(e) => setEditing({ ...editing!, max_discount_amount: e.target.value })}
                  inputMode="decimal"
                  placeholder="optional"
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Min fare (KES)</span>
                <input
                  value={editing!.min_fare}
                  onChange={(e) => setEditing({ ...editing!, min_fare: e.target.value })}
                  inputMode="decimal"
                  placeholder="optional"
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Valid from</span>
                <input
                  type="datetime-local"
                  value={editing!.valid_from}
                  onChange={(e) => setEditing({ ...editing!, valid_from: e.target.value })}
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="text-[11px] text-muted-foreground">Valid until (blank = never)</span>
                <input
                  type="datetime-local"
                  value={editing!.valid_until}
                  onChange={(e) => setEditing({ ...editing!, valid_until: e.target.value })}
                  className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
                />
              </label>
            </div>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Usage limit (blank = unlimited)</span>
              <input
                value={editing!.usage_limit}
                onChange={(e) => setEditing({ ...editing!, usage_limit: e.target.value })}
                inputMode="numeric"
                placeholder="optional"
                className="mt-0.5 w-full rounded-xl border border-input bg-background px-2.5 py-2 text-sm"
              />
            </label>
            <div>
              <span className="text-[11px] text-muted-foreground">Applies to</span>
              <div className="mt-1 flex flex-wrap gap-1.5">
                {(["boda", "e_boda", "go", "plus", "comfort", "xl"] as const).map((vc) => {
                  const selected = editing!.applies_to.includes(vc);
                  return (
                    <button
                      key={vc}
                      type="button"
                      onClick={() =>
                        setEditing({
                          ...editing!,
                          applies_to: selected
                            ? editing!.applies_to.filter((x) => x !== vc)
                            : [...editing!.applies_to, vc],
                        })
                      }
                      className={`rounded-full px-3 py-1.5 text-xs font-medium ${
                        selected ? "bg-primary text-primary-foreground" : "border border-input text-muted-foreground"
                      }`}
                    >
                      {vc}
                    </button>
                  );
                })}
              </div>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editing!.active}
                onChange={(e) => setEditing({ ...editing!, active: e.target.checked })}
                className="h-4 w-4"
              />
              <span className="text-foreground">Active</span>
            </label>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => save.mutate()}
                disabled={save.isPending || !editing!.code.trim() || !editing!.name.trim()}
                className="flex-1 rounded-full bg-primary px-3 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-60"
              >
                {save.isPending ? "Saving…" : creating ? "Create offer" : "Save changes"}
              </button>
              <button
                onClick={() => {
                  setEditing(null);
                  setCreating(false);
                }}
                className="rounded-full border border-input px-3 py-2.5 text-sm font-medium text-foreground"
              >
                Cancel
              </button>
            </div>
            {save.isError ? (
              <p className="text-xs text-destructive">{(save.error as Error).message}</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {save.isSuccess && <p className="mt-2 text-xs text-success">Offer saved.</p>}
      {toggle.isError ? (
        <p className="mt-2 text-xs text-destructive">{(toggle.error as Error).message}</p>
      ) : null}
      {remove.isError ? (
        <p className="mt-2 text-xs text-destructive">{(remove.error as Error).message}</p>
      ) : null}
    </section>
  );
}
