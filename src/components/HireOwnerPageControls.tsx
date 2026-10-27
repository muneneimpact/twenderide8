import { useServerFn } from "@tanstack/react-start";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Button } from "@/components/ui/button";
import { prepareBrandImage } from "@/lib/brand-image";
import { CheckCircle2, Circle, Copy, Download, Globe, Palette, QrCode, Sparkles, Trash2, Upload } from "lucide-react";
import {
  createOfflineHire,
  deleteOfflineHire,
  getMyHireBrand,
  listMyTrustedBrands,
  listMyVehicles,
  requestTrustedBrand,
  saveMyHireBrand,
} from "@/lib/hire.functions";
import {
  generateHireOwnerMarketingCopy,
  getHireMarketingQuota,
  type HireMarketingPost,
} from "@/lib/hire-marketing.functions";

type BrandForm = {
  profileType: "person" | "company";
  brandName: string;
  logoDataUrl: string | null;
  coverImageDataUrl: string | null;
  accentColor: string;
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
  profileType: "person",
  brandName: "",
  logoDataUrl: null,
  coverImageDataUrl: null,
  accentColor: "#22a35b",
  ownerBio: "",
  businessInfo: "",
  marketingContent: "",
};

function savedPosts(value: unknown): HireMarketingPost[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is HireMarketingPost => {
    if (!item || typeof item !== "object") return false;
    const post = item as Record<string, unknown>;
    return ["whatsapp", "facebook", "sms"].includes(String(post["channel"])) &&
      typeof post["label"] === "string" && typeof post["text"] === "string";
  });
}

async function brandedQrDataUrl(value: string) {
  const qrUrl = await QRCode.toDataURL(value, {
    width: 520,
    margin: 2,
    errorCorrectionLevel: "H",
    color: { dark: "#163c2b", light: "#ffffff" },
  });
  return new Promise<string>((resolve, reject) => {
    const canvas = document.createElement("canvas");
    canvas.width = 520;
    canvas.height = 520;
    const context = canvas.getContext("2d");
    const qrImage = new Image();
    qrImage.onload = () => {
      if (!context) return reject(new Error("Could not create the QR image."));
      context.drawImage(qrImage, 0, 0, 520, 520);
      const markSize = 86;
      const markX = (520 - markSize) / 2;
      context.fillStyle = "#ffffff";
      context.beginPath();
      context.arc(260, 260, 54, 0, Math.PI * 2);
      context.fill();
      const logo = new Image();
      logo.onload = () => {
        context.drawImage(logo, markX, markX, markSize, markSize);
        resolve(canvas.toDataURL("image/png"));
      };
      logo.onerror = () => resolve(canvas.toDataURL("image/png"));
      logo.src = "/twende-meru-logo.png";
    };
    qrImage.onerror = () => reject(new Error("Could not create the QR image."));
    qrImage.src = qrUrl;
  });
}

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
  const vehiclesFn = useServerFn(listMyVehicles);
  const generateFn = useServerFn(generateHireOwnerMarketingCopy);
  const quotaFn = useServerFn(getHireMarketingQuota);
  const brand = useQuery({ queryKey: ["my-hire-brand"], queryFn: () => getFn() });
  const vehicles = useQuery({ queryKey: ["my-vehicles"], queryFn: () => vehiclesFn() });
  const trustedBrandsFn = useServerFn(listMyTrustedBrands);
  const requestTrustedBrandFn = useServerFn(requestTrustedBrand);
  const trustedBrands = useQuery({ queryKey: ["my-trusted-brands"], queryFn: () => trustedBrandsFn() });
  const quota = useQuery({ queryKey: ["hire-marketing-quota"], queryFn: () => quotaFn() });
  const [form, setForm] = useState<BrandForm>(emptyBrand);
  const [origin, setOrigin] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [posts, setPosts] = useState<HireMarketingPost[]>([]);
  const [qrImages, setQrImages] = useState<Record<string, string>>({});
  const [copyFocus, setCopyFocus] = useState<"executive" | "family" | "value" | "safari">("value");
  const [trustedBrandName, setTrustedBrandName] = useState("");
  const [permissionConfirmed, setPermissionConfirmed] = useState(false);
  const [preparingImage, setPreparingImage] = useState(false);

  useEffect(() => setOrigin(window.location.origin), []);
  useEffect(() => {
    if (!brand.data) return;
    setForm({
      profileType: brand.data.profile_type === "company" ? "company" : "person",
      brandName: brand.data.brand_name,
      logoDataUrl: brand.data.logo_data_url,
      coverImageDataUrl: brand.data.cover_image_data_url ?? null,
      accentColor: brand.data.accent_color ?? "#22a35b",
      ownerBio: brand.data.owner_bio,
      businessInfo: brand.data.business_info,
      marketingContent: brand.data.marketing_content,
    });
    setPosts(savedPosts(brand.data.marketing_posts));
  }, [brand.data]);

  const save = useMutation({
    mutationFn: () =>
      saveFn({
        data: {
          profileType: form.profileType,
          brandName: form.brandName,
          logoDataUrl: form.logoDataUrl,
          coverImageDataUrl: form.coverImageDataUrl,
          accentColor: form.accentColor,
          marketingPosts: posts,
          ownerBio: form.ownerBio,
          businessInfo: form.businessInfo,
          marketingContent: form.marketingContent,
        },
      }),
    onSuccess: async (saved) => {
      setMessage(brand.data ? "Saved. Your changes are live on your page." : "Saved. Your public owner page is ready to share.");
      await queryClient.invalidateQueries({ queryKey: ["my-hire-brand"] });
      setForm({
        profileType: saved.profile_type === "company" ? "company" : "person",
        brandName: saved.brand_name,
        logoDataUrl: saved.logo_data_url,
        coverImageDataUrl: saved.cover_image_data_url ?? null,
        accentColor: saved.accent_color ?? "#22a35b",
        ownerBio: saved.owner_bio,
        businessInfo: saved.business_info,
        marketingContent: saved.marketing_content,
      });
      setPosts(savedPosts(saved.marketing_posts));
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const generateCopy = useMutation({
    mutationFn: async () => {
      const vehicle = vehicles.data?.find((item) => item.status === "approved") ?? vehicles.data?.[0];
      if (!vehicle) throw new Error("Add a hire vehicle before generating marketing copy.");
      return generateFn({
        data: {
          brandName: form.brandName,
          ownerBio: form.ownerBio,
          businessInfo: form.businessInfo,
          focus: copyFocus,
          vehicle: {
            make: vehicle.make,
            model: vehicle.model,
            seats: vehicle.seats,
            dailyRate: vehicle.hire_daily_rate == null ? null : Number(vehicle.hire_daily_rate),
            hireMode: (vehicle.hire_mode ?? "both") as "self_drive" | "chauffeured" | "both",
            features: vehicle.hire_features,
          },
        },
      });
    },
    onSuccess: (copy) => {
      setForm((current) => ({
        ...current,
        marketingContent: `${copy.headline}\n\n${copy.intro}\n\n${copy.highlights.map((item) => `• ${item}`).join("\n")}`,
      }));
      setPosts(copy.posts);
      void queryClient.invalidateQueries({ queryKey: ["hire-marketing-quota"] });
      setMessage("Your monthly marketing post is ready. Review it, then save your brand page.");
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const trustedBrandRequest = useMutation({
    mutationFn: () => requestTrustedBrandFn({ data: { brandName: trustedBrandName, permissionConfirmed: true } }),
    onSuccess: () => {
      setTrustedBrandName("");
      setPermissionConfirmed(false);
      setMessage("Brand permission request sent. Twende will review it before it appears publicly.");
      void queryClient.invalidateQueries({ queryKey: ["my-trusted-brands"] });
    },
    onError: (error) => setMessage((error as Error).message),
  });

  const shareUrl = brand.data?.slug && origin ? `${origin}/${brand.data.slug}` : "";
  const trackedUrl = (channel: string) =>
    shareUrl ? `${shareUrl}?ref=${encodeURIComponent(`${brand.data?.slug}-${channel}`)}` : "";
  const registeredVehicle = Boolean(vehicles.data?.length);
  const vehicleApproved = Boolean(vehicles.data?.some((vehicle) => vehicle.status === "approved"));
  const bookableListing = Boolean(
    vehicles.data?.some(
      (vehicle) =>
        vehicle.status === "approved" &&
        vehicle.hire_approval_status === "approved" &&
        vehicle.hire_available,
    ),
  );
  const hasBrandName = form.brandName.trim().length >= 2;
  const hasMarketingContent = Boolean(
    form.logoDataUrl || form.ownerBio.trim() || form.businessInfo.trim() || form.marketingContent.trim(),
  );
  const setupSteps = [
    { label: "Register at least one vehicle", detail: "Add its number plate and vehicle class in Vehicles.", done: registeredVehicle },
    { label: "Complete vehicle approval", detail: "Operations approves the vehicle before a hire listing can be reviewed.", done: vehicleApproved },
    { label: "Publish a bookable hire listing", detail: "Add clear photos, a daily rate and hire details, then submit the listing for review.", done: bookableListing },
    { label: "Name and personalise your storefront", detail: "Add a brand name; a logo, owner introduction, service area and promotion help customers choose you.", done: hasBrandName && hasMarketingContent },
    { label: "Save and share your unique page", detail: "Create the page to generate its public brand-name link.", done: Boolean(shareUrl) },
  ];
  const selectImage = async (kind: "logo" | "cover", file?: File) => {
    if (!file) return;
    setPreparingImage(true);
    setMessage("Preparing photo…");
    try {
      const result = await prepareBrandImage(file, kind);
      setForm((current) => ({ ...current, [kind === "cover" ? "coverImageDataUrl" : "logoDataUrl"]: result }));
      setMessage("Photo ready. Save your brand page to keep it.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not prepare that photo.");
    } finally {
      setPreparingImage(false);
    }
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
          <div className="rounded-2xl border border-primary/20 bg-background p-3 sm:p-4">
            <div className="flex items-start gap-2">
              <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div>
                <p className="text-xs font-bold text-foreground">Set up your car-hire storefront</p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                  Your link is also your marketing page. Complete these steps to turn views into bookable listings.
                </p>
              </div>
            </div>
            {vehicles.isError ? (
              <p className="mt-2 text-xs text-destructive">Could not check vehicles: {(vehicles.error as Error).message}</p>
            ) : (
              <ol className="mt-3 space-y-2">
                {setupSteps.map((step, index) => (
                  <li key={step.label} className="flex items-start gap-2.5">
                    {step.done ? (
                      <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    )}
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold text-foreground">{index + 1}. {step.label}</p>
                      <p className="text-[10px] leading-relaxed text-muted-foreground">{step.detail}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {vehicles.isPending ? <p className="mt-2 text-[10px] text-muted-foreground">Checking your vehicle setup…</p> : null}
          </div>
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

          <fieldset>
            <legend className="text-xs font-semibold text-foreground">How should your page present your profile?</legend>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {([
                ["person", "As a person", "Show your name and personal profile."],
                ["company", "As a company", "Lead with your company name and brand."],
              ] as const).map(([value, title, hint]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={form.profileType === value}
                  onClick={() => setForm((current) => ({ ...current, profileType: value }))}
                  className={`rounded-xl border p-3 text-left ${form.profileType === value ? "border-primary bg-primary/10" : "border-border bg-background"}`}
                >
                  <span className="block text-xs font-bold text-foreground">{title}</span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">{hint}</span>
                </button>
              ))}
            </div>
            <p className="mt-1 text-[10px] text-muted-foreground">
              Company pages use your account’s company name, or your brand name if no company name is on file.
            </p>
          </fieldset>

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
              <Upload className="h-4 w-4" /> {form.logoDataUrl ? "Change logo" : form.profileType === "company" ? "Upload company logo" : "Upload brand logo"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                disabled={preparingImage || save.isPending}
                onChange={(event) => { void selectImage("logo", event.target.files?.[0]); event.target.value = ""; }}
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
            <span className="text-[10px] text-muted-foreground">PNG / JPG / WebP</span>
          </div>

          <div className="grid gap-3 rounded-2xl border border-border bg-background p-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div>
              <p className="inline-flex items-center gap-1.5 text-xs font-semibold text-foreground"><Palette className="h-3.5 w-3.5 text-primary" /> Storefront look</p>
              <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Choose an accent colour and optional cover image. Twende still provides the secure booking layer.</p>
              <label className="mt-2 inline-flex items-center gap-2 text-[11px] font-medium text-muted-foreground">
                Accent colour
                <input type="color" value={form.accentColor} onChange={(event) => setForm((current) => ({ ...current, accentColor: event.target.value }))} className="h-8 w-12 cursor-pointer rounded border border-border bg-background p-0.5" />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {form.coverImageDataUrl ? <img src={form.coverImageDataUrl} alt="Storefront cover preview" className="h-14 w-24 rounded-xl object-cover" /> : null}
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-input px-3 py-2 text-xs font-semibold text-foreground">
                <Upload className="h-3.5 w-3.5" /> {form.coverImageDataUrl ? "Change cover" : "Add cover"}
                <input aria-label="Cover image" type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={preparingImage || save.isPending} onChange={(event) => { void selectImage("cover", event.target.files?.[0]); event.target.value = ""; }} />
              </label>
              {form.coverImageDataUrl ? <button type="button" className="text-xs font-medium text-destructive" onClick={() => setForm((current) => ({ ...current, coverImageDataUrl: null }))}>Remove cover</button> : null}
            </div>
          </div>

          <div className="rounded-2xl border border-border bg-background p-3">
            <p className="text-xs font-semibold text-foreground">Trusted brands you have worked with</p>
            <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Ask each brand for permission first. Twende Operations must approve the request before the name appears on your public page.</p>
            <div className="mt-3 flex gap-2">
              <input value={trustedBrandName} onChange={(event) => setTrustedBrandName(event.target.value)} placeholder="Brand name" className="input-base min-w-0 flex-1" />
              <button type="button" onClick={() => trustedBrandRequest.mutate()} disabled={!trustedBrandName.trim() || !permissionConfirmed || trustedBrandRequest.isPending} className="rounded-full bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50">Request approval</button>
            </div>
            <label className="mt-2 flex items-start gap-2 text-[11px] text-muted-foreground"><input type="checkbox" checked={permissionConfirmed} onChange={(event) => setPermissionConfirmed(event.target.checked)} className="mt-0.5" /> I confirm I have permission from this brand to request its display.</label>
            {trustedBrands.data?.length ? <div className="mt-3 flex flex-wrap gap-2">{trustedBrands.data.map((item: { id: string; brand_name: string; status: string }) => <span key={item.id} className="rounded-full bg-secondary px-2.5 py-1 text-[11px] text-foreground">{item.brand_name} · {item.status}</span>)}</div> : null}
          </div>

          <label className="block">
            <span className="text-xs font-semibold text-foreground">
              {form.profileType === "company" ? "About the company" : "About you"}
            </span>
            <textarea
              value={form.ownerBio}
              maxLength={1200}
              rows={3}
              placeholder={form.profileType === "company"
                ? "Introduce your company, its service standards and the team behind the fleet."
                : "Introduce yourself and your experience caring for these cars."}
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
          <div className="rounded-2xl border border-primary/20 bg-primary/5 p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-bold text-foreground">Generate this month’s marketing post</p>
                <p className="mt-1 text-[10px] text-muted-foreground">One AI-generated post per month. It includes ready-to-share text for WhatsApp, Facebook and SMS.</p>
              </div>
              <select value={copyFocus} onChange={(event) => setCopyFocus(event.target.value as typeof copyFocus)} className="input-base w-auto text-xs">
                <option value="executive">Executive / corporate</option>
                <option value="family">Family trips</option>
                <option value="value">Budget & transparent</option>
                <option value="safari">Safari / rugged 4x4</option>
              </select>
            </div>
            <p className="mt-2 text-[10px] font-semibold text-primary">
              {quota.isPending ? "Checking monthly allowance…" : quota.data?.remaining ? "1 post available this month" : "This month’s post has already been used"}
            </p>
            <button type="button" onClick={() => generateCopy.mutate()} disabled={generateCopy.isPending || vehicles.isPending || quota.data?.remaining === 0} className="mt-2 rounded-full border border-primary/30 px-3 py-1.5 text-xs font-semibold text-primary disabled:opacity-50">
              {generateCopy.isPending ? "Generating…" : quota.data?.remaining === 0 ? "Available next month" : "Generate and apply"}
            </button>
          </div>
          {posts.length ? (
            <section className="rounded-2xl border border-border bg-background p-3">
              <div className="flex items-start gap-2">
                <QrCode className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div>
                  <p className="text-xs font-bold text-foreground">Your tracked sharing texts</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">Each channel gets its own link parameter, so Twende can tell which message brought people to your page. QR codes include a Twende logo mark. Poster and image packages are not included here and can be added to your invoice separately later.</p>
                </div>
              </div>
              <div className="mt-3 space-y-3">
                {posts.map((post) => {
                  const url = trackedUrl(post.channel);
                  const text = url ? `${post.text}\n${url}` : post.text;
                  return (
                    <article key={post.channel} className="rounded-xl border border-border p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-bold text-foreground">{post.label}</p>
                        <span className="rounded-full bg-primary/10 px-2 py-1 text-[9px] font-bold uppercase tracking-wide text-primary">ref: {post.channel}</span>
                      </div>
                      <textarea readOnly value={text} rows={3} className="input-base mt-2 text-xs leading-relaxed" onFocus={(event) => event.currentTarget.select()} />
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={() => void navigator.clipboard.writeText(text).then(() => setMessage(`${post.label} copied with its tracked link.`)).catch(() => setMessage("Select the text and copy it."))} className="inline-flex items-center gap-1.5 rounded-full border border-input px-3 py-1.5 text-[11px] font-semibold text-foreground"><Copy className="h-3.5 w-3.5" /> Copy text</button>
                        <button type="button" disabled={!url || Boolean(qrImages[post.channel])} onClick={() => void brandedQrDataUrl(url).then((image) => setQrImages((current) => ({ ...current, [post.channel]: image }))).catch((error) => setMessage((error as Error).message))} className="inline-flex items-center gap-1.5 rounded-full border border-primary/30 px-3 py-1.5 text-[11px] font-semibold text-primary disabled:opacity-50"><QrCode className="h-3.5 w-3.5" /> {qrImages[post.channel] ? "QR ready" : "Create QR code"}</button>
                        {qrImages[post.channel] ? <a href={qrImages[post.channel]} download={`twende-${brand.data?.slug ?? "owner"}-${post.channel}-qr.png`} className="inline-flex items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-[11px] font-semibold text-primary-foreground"><Download className="h-3.5 w-3.5" /> Download QR</a> : null}
                      </div>
                      {qrImages[post.channel] ? <img src={qrImages[post.channel]} alt={`${post.label} tracked Twende QR code`} className="mt-3 h-36 w-36 rounded-xl border border-border bg-white p-2" /> : null}
                    </article>
                  );
                })}
              </div>
            </section>
          ) : null}
          <Button
            type="button"
            onClick={() => {
              setMessage(null);
              save.mutate();
            }}
            disabled={save.isPending || preparingImage || !form.brandName.trim()}
            className="w-full rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {save.isPending
              ? "Saving brand page…"
              : brand.data
                ? "Save brand page"
                : "Create public brand page"}
          </Button>
        </div>
      ) : null}
      {message ? (
        <p
          role="status"
          className={`mt-2 text-xs ${
            save.isError || generateCopy.isError ? "text-destructive" : "text-muted-foreground"
          }`}
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
