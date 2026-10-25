import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Copy, Globe, Trash2, Upload } from "lucide-react";
import {
  createOfflineHire,
  deleteOfflineHire,
  getMyHireBrand,
  saveMyHireBrand,
} from "@/lib/hire.functions";

type BrandForm = {
  brandName: string;
  logoDataUrl: string | null;
  ownerBio: string;
  businessInfo: string;
  marketingContent: string;
};
type OfflineHire = {
  id: string;
  start_date: string;
  end_date: string;
  note: string;
  created_at: string;
};

const emptyBrand: BrandForm = {
  brandName: "",
  logoDataUrl: null,
  ownerBio: "",
  businessInfo: "",
  marketingContent: "",
};

function todayKey() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function formatDate(value: string) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-KE", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function HireOwnerBrandCard() {
  const queryClient = useQueryClient();
  const getFn = useServerFn(getMyHireBrand);
  const saveFn = useServerFn(saveMyHireBrand);
  const brand = useQuery({ queryKey: ["my-hire-brand"], queryFn: () => getFn() });
  const [form, setForm] = useState<BrandForm>(emptyBrand);
  const [origin, setOrigin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!brand.data) return;
    setForm({
      brandName: brand.data.brand_name,
      logoDataUrl: brand.data.logo_data_url,
      ownerBio: brand.data.owner_bio,
      businessInfo: brand.data.business_info,
      marketingContent: brand.data.marketing_content,
    });
  }, [brand.data]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          brandName: form.brandName,
          logoDataUrl: form.logoDataUrl,
          ownerBio: form.ownerBio,
          businessInfo: form.businessInfo,
          marketingContent: form.marketingContent,
        },
      }),
    onSuccess: async (saved) => {
      setMessage("Your public owner page is ready to share.");
      await queryClient.invalidateQueries({ queryKey: ["my-hire-brand"] });
      setForm({
        brandName: saved.brand_name,
        logoDataUrl: saved.logo_data_url,
        ownerBio: saved.owner_bio,
        businessInfo: saved.business_info,
        marketingContent: saved.marketing_content,
      });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const shareUrl = brand.data?.slug && origin ? `${origin}/${brand.data.slug}` : "";
  const selectLogo = (file?: File) => {
    if (!file) return;
    if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
      setMessage("Choose a PNG, JPG or WebP logo image.");
      return;
    }
    if (file.size > 300 * 1024) {
      setMessage("Keep the logo image under 300 KB.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        setForm((current) => ({ ...current, logoDataUrl: reader.result as string }));
        setMessage(null);
      }
    };
    reader.onerror = () => setMessage("Could not read that logo image. Please try again.");
    reader.readAsDataURL(file);
  };

  return (
    <section className="mt-4 rounded-2xl border border-primary/20 bg-primary/5 p-4">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Globe className="h-5 w-5" />
        </span>
        <div>
          <h4 className="font-display text-base font-bold text-foreground">
            Your public owner page
          </h4>
          <p className="mt-1 text-xs text-muted-foreground">
            Build a branded page with only your available hire cars. Brand names must be unique; the
            page address is made from your brand name.
          </p>
        </div>
      </div>
      {brand.isPending ? (
        <p className="mt-3 text-xs text-muted-foreground">Loading brand settings…</p>
      ) : null}
      {brand.isError ? (
        <p className="mt-3 text-xs text-destructive">
          Could not load brand settings: {(brand.error as Error).message}
        </p>
      ) : null}
      {!brand.isPending && !brand.isError ? (
        <div className="mt-4 space-y-3">
          {shareUrl ? (
            <div className="rounded-xl border border-border bg-background p-3">
              <p className="text-[11px] font-semibold text-muted-foreground">
                Your shareable booking and marketing link
              </p>
              <div className="mt-2 flex gap-2">
                <input
                  readOnly
                  value={shareUrl}
                  aria-label="Public owner page link"
                  className="input-base min-w-0 flex-1"
                  onFocus={(event) => event.currentTarget.select()}
                />
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(shareUrl);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    } catch {
                      setMessage("Select and copy the link from the box.");
                    }
                  }}
                  className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
                >
                  <Copy className="h-3.5 w-3.5" /> {copied ? "Copied" : "Copy link"}
                </button>
              </div>
              <a
                href={shareUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs font-semibold text-primary"
              >
                Preview public page →
              </a>
            </div>
          ) : null}

          <label className="block">
            <span className="text-xs font-semibold text-foreground">Unique brand name</span>
            <input
              value={form.brandName}
              maxLength={80}
              required
              placeholder="e.g. Meru Highlands Cars"
              onChange={(event) =>
                setForm((current) => ({ ...current, brandName: event.target.value }))
              }
              className="input-base mt-1"
            />
            <span className="mt-1 block text-[10px] text-muted-foreground">
              Your web address uses this name, for example {origin || "your-site"}
              /meru-highlands-cars.
            </span>
          </label>

          <div className="flex items-center gap-3">
            {form.logoDataUrl ? (
              <img
                src={form.logoDataUrl}
                alt="Brand logo preview"
                className="h-14 w-14 rounded-xl border border-border bg-background object-contain p-1"
              />
            ) : null}
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-input bg-background px-3 py-2 text-xs font-semibold text-foreground">
              <Upload className="h-4 w-4" /> {form.logoDataUrl ? "Change logo" : "Upload logo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(event) => selectLogo(event.target.files?.[0])}
              />
            </label>
            {form.logoDataUrl ? (
              <button
                type="button"
                className="text-xs font-medium text-destructive"
                onClick={() => setForm((current) => ({ ...current, logoDataUrl: null }))}
              >
                Remove logo
              </button>
            ) : null}
            <span className="text-[10px] text-muted-foreground">PNG/JPG/WebP · max 300 KB</span>
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-foreground">Owner profile</span>
            <textarea
              value={form.ownerBio}
              maxLength={1200}
              rows={3}
              placeholder="Introduce yourself and your experience caring for these cars."
              onChange={(event) =>
                setForm((current) => ({ ...current, ownerBio: event.target.value }))
              }
              className="input-base mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-foreground">Business information</span>
            <textarea
              value={form.businessInfo}
              maxLength={1000}
              rows={2}
              placeholder="Service area, opening hours, delivery options, or business details customers should know."
              onChange={(event) =>
                setForm((current) => ({ ...current, businessInfo: event.target.value }))
              }
              className="input-base mt-1"
            />
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-foreground">
              Marketing, services and promotions
            </span>
            <textarea
              value={form.marketingContent}
              maxLength={1500}
              rows={3}
              placeholder="Describe your service, current promotions, or what makes your cars special."
              onChange={(event) =>
                setForm((current) => ({ ...current, marketingContent: event.target.value }))
              }
              className="input-base mt-1"
            />
          </label>
          <button
            type="button"
            onClick={() => {
              setMessage(null);
              save.mutate();
            }}
            disabled={save.isPending || !form.brandName.trim()}
            className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {save.isPending
              ? "Saving brand page…"
              : brand.data
                ? "Save brand page"
                : "Create public brand page"}
          </button>
        </div>
      ) : null}
      {message ? (
        <p
          role="status"
          className={`mt-2 text-xs ${save.isError ? "text-destructive" : "text-muted-foreground"}`}
        >
          {message}
        </p>
      ) : null}
    </section>
  );
}

export function VehicleOfflineDates({
  vehicleId,
  vehicleName,
  entries,
}: {
  vehicleId: string;
  vehicleName: string;
  entries: OfflineHire[];
}) {
  const queryClient = useQueryClient();
  const addFn = useServerFn(createOfflineHire);
  const deleteFn = useServerFn(deleteOfflineHire);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const refreshAvailability = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["my-vehicles"] }),
      queryClient.invalidateQueries({ queryKey: ["hire-vehicles"] }),
      queryClient.invalidateQueries({ queryKey: ["public-hire-cars"] }),
    ]);
  };
  const add = useMutation({
    mutationFn: () => addFn({ data: { vehicleId, startDate, endDate, note } }),
    onSuccess: async () => {
      setStartDate("");
      setEndDate("");
      setNote("");
      setMessage(
        "Offline dates saved. Customers will still see the car and its next available date.",
      );
      await refreshAvailability();
    },
    onError: (error) => setMessage((error as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => deleteFn({ data: { id } }),
    onSuccess: async () => {
      setMessage("Offline dates removed; the car can be booked for those dates again.");
      await refreshAvailability();
    },
    onError: (error) => setMessage((error as Error).message),
  });

  return (
    <details className="mt-3 rounded-xl border border-border bg-background">
      <summary className="cursor-pointer list-none px-3 py-2.5 text-xs font-semibold text-foreground">
        Offline hires · manage unavailable dates for {vehicleName}
      </summary>
      <div className="space-y-3 border-t border-border p-3">
        <p className="text-[11px] text-muted-foreground">
          Use this when the car is hired directly/offline. Customers can still open the listing and
          check dates; blocked dates show the next available date.
        </p>
        <form
          className="grid gap-2 sm:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault();
            setMessage(null);
            add.mutate();
          }}
        >
          <label className="text-[11px] font-medium text-muted-foreground">
            Unavailable from
            <input
              type="date"
              min={todayKey()}
              required
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              className="input-base mt-1"
            />
          </label>
          <label className="text-[11px] font-medium text-muted-foreground">
            Through (inclusive)
            <input
              type="date"
              min={startDate || todayKey()}
              required
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              className="input-base mt-1"
            />
          </label>
          <label className="text-[11px] font-medium text-muted-foreground sm:col-span-2">
            Private note for your records (optional)
            <input
              value={note}
              maxLength={200}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. Weekend hire arranged directly"
              className="input-base mt-1"
            />
          </label>
          <button
            type="submit"
            disabled={add.isPending || !startDate || !endDate}
            className="rounded-full bg-primary px-4 py-2.5 text-xs font-semibold text-primary-foreground disabled:opacity-50 sm:col-span-2"
          >
            {add.isPending ? "Saving unavailable dates…" : "Mark dates unavailable"}
          </button>
        </form>
        <div>
          <h5 className="text-xs font-semibold text-foreground">Your offline hire dates</h5>
          {entries.length ? (
            <ul className="mt-1 divide-y divide-border">
              {entries.map((entry) => (
                <li key={entry.id} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="min-w-0 text-muted-foreground">
                    <strong className="text-foreground">
                      {formatDate(entry.start_date)} – {formatDate(entry.end_date)}
                    </strong>
                    {entry.note ? <span className="block truncate">{entry.note}</span> : null}
                  </span>
                  <button
                    type="button"
                    aria-label={`Remove offline dates for ${vehicleName}`}
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(entry.id)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-full border border-input px-2.5 py-1.5 font-semibold text-destructive disabled:opacity-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" /> Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-1 text-[11px] text-muted-foreground">
              No offline-unavailable dates added.
            </p>
          )}
        </div>
        {message ? (
          <p role="status" className="text-xs text-muted-foreground">
            {message}
          </p>
        ) : null}
      </div>
    </details>
  );
}
