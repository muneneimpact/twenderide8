import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { AppShell } from "@/components/AppShell";
import { AddVehicleForHire } from "@/components/AddVehicleForHire";
import { DriverComplianceDocuments } from "@/components/DriverComplianceDocuments";
import { HireAttentionSummary } from "@/components/HireAttentionSummary";
import { HirePortfolioFinance } from "@/components/HirePortfolioFinance";
import { HireRequestsBoard } from "@/components/HireRequestsBoard";
import { HireVehicleManager } from "@/components/HireVehicleManager";
import { OwnerHireBookings } from "@/components/OwnerHireBookings";
import { OwnerSignatureSettings } from "@/components/OwnerSignatureSettings";
import { HireOwnerBrandCard } from "@/components/HireOwnerPageControls";
import { VehicleTeamBoard } from "@/components/VehicleTeamBoard";
import { useMe } from "@/hooks/useMe";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { createOwnerPromotion, listOwnerCustomers, listOwnerPromotions } from "@/lib/owner-rewards.functions";
type Section = "overview" | "vehicles" | "bookings" | "customers" | "earnings" | "marketing" | "documents" | "lost-found";

const sections: Array<{ key: Section; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "vehicles", label: "Cars" },
  { key: "bookings", label: "Bookings" },
  { key: "customers", label: "Customers & promos" },
  { key: "earnings", label: "Earnings" },
  { key: "marketing", label: "Marketing" },
  { key: "documents", label: "Documents" },
  { key: "lost-found", label: "Lost & found" },
];

export function OwnerHub() {
  const { me } = useMe();
  const queryClient = useQueryClient();
  const customersFn = useServerFn(listOwnerCustomers);
  const promotionsFn = useServerFn(listOwnerPromotions);
  const createPromotionFn = useServerFn(createOwnerPromotion);
  const customers = useQuery({ queryKey: ["owner-customers"], queryFn: () => customersFn() });
  const promotions = useQuery({ queryKey: ["owner-promotions"], queryFn: () => promotionsFn() });
  const [promoTitle, setPromoTitle] = useState("");
  const [promoDescription, setPromoDescription] = useState("");
  const [promoDiscount, setPromoDiscount] = useState("0");
  const [promoPoints, setPromoPoints] = useState("1");
  const [promoMerchandise, setPromoMerchandise] = useState("");
  const createPromotion = useMutation({
    mutationFn: () => createPromotionFn({ data: { title: promoTitle, description: promoDescription, discountPercent: Number(promoDiscount), rewardPoints: Number(promoPoints), merchandise: promoMerchandise || undefined } }),
    onSuccess: () => { setPromoTitle(""); setPromoDescription(""); setPromoDiscount("0"); setPromoPoints("1"); setPromoMerchandise(""); void queryClient.invalidateQueries({ queryKey: ["owner-promotions"] }); },
  });
  const [section, setSection] = useState<Section>("overview");
  const profile = me?.profile as { full_name?: string | null } | null | undefined;
  const firstName = profile?.full_name?.trim().split(/\s+/)[0] || "Owner";

  return (
    <AppShell title="Owner Hub" eyebrow="Twende Owner Hub">
      <div className="mx-auto w-full max-w-5xl space-y-4 px-3 py-4 sm:px-5 sm:py-6">
        <section className="relative overflow-hidden rounded-3xl bg-primary p-5 text-primary-foreground shadow-lg sm:p-7">
          <div
            className="pointer-events-none absolute -right-12 -top-20 h-52 w-52 rounded-full bg-primary-foreground/15 blur-3xl"
            aria-hidden="true"
          />
          <div className="relative max-w-2xl">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-primary-foreground/75">
              Your car business, supported by Twende
            </p>
            <h2 className="mt-2 font-display text-2xl font-extrabold sm:text-4xl">
              Good day, {firstName}
            </h2>
            <p className="mt-2 max-w-xl text-sm leading-relaxed text-primary-foreground/85 sm:text-base">
              Your cars are ready to earn. Twende helps you present your vehicles, manage bookings,
              keep payments secure and share one professional page.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setSection("vehicles")}
                className="rounded-full bg-background px-4 py-2.5 text-xs font-bold text-primary"
              >
                Add or manage a car
              </button>
              <button
                type="button"
                onClick={() => setSection("marketing")}
                className="rounded-full border border-primary-foreground/30 px-4 py-2.5 text-xs font-bold text-primary-foreground"
              >
                Share my page
              </button>
            </div>
          </div>
        </section>

        <div
          role="tablist"
          aria-label="Owner Hub sections"
          className="flex gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        >
          {sections.map((item) => (
            <button
              key={item.key}
              type="button"
              role="tab"
              aria-selected={section === item.key}
              onClick={() => setSection(item.key)}
              className={`shrink-0 rounded-xl px-3 py-2.5 text-xs font-bold transition ${section === item.key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary"}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {section === "overview" ? (
          <div className="space-y-4">
            <HireAttentionSummary />
            <section className="grid gap-3 sm:grid-cols-3">
              <ActionCard
                title="List a car"
                detail="Add a vehicle and let Twende help you finish the approved setup."
                action="Open cars"
                onClick={() => setSection("vehicles")}
              />
              <ActionCard
                title="Manage bookings"
                detail="Review pickups, deposits, handovers and returns in one place."
                action="View bookings"
                onClick={() => setSection("bookings")}
              />
              <ActionCard
                title="Market your page"
                detail="Create one monthly post, then copy tracked text or download branded QR codes."
                action="Open marketing"
                onClick={() => setSection("marketing")}
              />
            </section>
            <OwnerHireBookings />
            <HirePortfolioFinance />
            <VehicleTeamBoard />
          </div>
        ) : null}

        {section === "vehicles" ? (
          <div className="space-y-4">
            <section className="surface-card p-4">
              <h2 className="font-display text-lg font-bold text-foreground">Your cars</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Add the car details you have. Twende Operations will contact you and help complete
                the remaining documents, inspection and listing setup.
              </p>
              <AddVehicleForHire hireOnly label="Add a car for hire" />
            </section>
            <HireVehicleManager
              hireOnly
              showAddVehicle={false}
              heading="Photos, prices and hire terms"
            />
            <VehicleTeamBoard />
          </div>
        ) : null}

        {section === "bookings" ? (
          <div className="space-y-4">
            <HireAttentionSummary />
            <OwnerHireBookings />
            <OwnerSignatureSettings />
            <HireRequestsBoard />
          </div>
        ) : null}

        {section === "customers" ? (
          <div className="space-y-4">
            <section className="surface-card p-4">
              <h2 className="font-display text-lg font-bold text-foreground">Your customers</h2>
              <p className="mt-1 text-sm text-muted-foreground">Customers earn one point for each eligible paid hire from your cars. Points are calculated from confirmed bookings.</p>
              {customers.data?.length ? <div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead><tr className="border-b border-border text-muted-foreground"><th className="py-2">Customer</th><th className="py-2">Hires</th><th className="py-2">Points</th><th className="py-2">Last hire</th></tr></thead><tbody>{customers.data.map((customer) => <tr key={customer.id} className="border-b border-border/60"><td className="py-2.5 font-semibold text-foreground">{customer.name}<span className="block text-[10px] font-normal text-muted-foreground">{customer.phone ?? customer.email ?? ""}</span></td><td className="py-2.5 text-foreground">{customer.hires}</td><td className="py-2.5 font-bold text-primary">{customer.points}</td><td className="py-2.5 text-muted-foreground">{customer.lastHireAt ? new Date(customer.lastHireAt).toLocaleDateString("en-KE") : "—"}</td></tr>)}</tbody></table></div> : <p className="mt-3 text-xs text-muted-foreground">Your customer points list will appear after eligible hires.</p>}
            </section>
            <section className="surface-card p-4">
              <h2 className="font-display text-lg font-bold text-foreground">Discounts and merchandise promos</h2>
              <p className="mt-1 text-sm text-muted-foreground">Create an offer for your customer community. Customers will see that the promo comes from your owner page.</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2"><input value={promoTitle} onChange={(e) => setPromoTitle(e.target.value)} placeholder="Promo title" className="input-base" /><input value={promoMerchandise} onChange={(e) => setPromoMerchandise(e.target.value)} placeholder="Merchandise reward (optional)" className="input-base" /><textarea value={promoDescription} onChange={(e) => setPromoDescription(e.target.value)} placeholder="Explain the offer" rows={3} className="input-base sm:col-span-2" /><input type="number" min="0" max="100" value={promoDiscount} onChange={(e) => setPromoDiscount(e.target.value)} placeholder="Discount %" className="input-base" /><input type="number" min="0" value={promoPoints} onChange={(e) => setPromoPoints(e.target.value)} placeholder="Points required" className="input-base" /></div>
              <button type="button" onClick={() => createPromotion.mutate()} disabled={!promoTitle.trim() || !promoDescription.trim() || createPromotion.isPending} className="mt-3 rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground disabled:opacity-50">{createPromotion.isPending ? "Saving…" : "Publish promo"}</button>
              {promotions.data?.length ? <div className="mt-4 space-y-2">{promotions.data.map((promo: { id: string; title: string; description: string; status: string; discount_percent: number; reward_points: number; merchandise: string | null }) => <div key={promo.id} className="rounded-xl border border-border p-3"><div className="flex justify-between gap-2"><p className="text-sm font-semibold text-foreground">{promo.title}</p><span className="text-xs text-primary">{promo.status}</span></div><p className="mt-1 text-xs text-muted-foreground">{promo.description}</p><p className="mt-1 text-[11px] font-semibold text-primary">{Number(promo.discount_percent)}% discount · {promo.reward_points} points{promo.merchandise ? ` · ${promo.merchandise}` : ""}</p></div>)}</div> : null}
            </section>
          </div>
        ) : null}

        {section === "earnings" ? <HirePortfolioFinance /> : null}

        {section === "marketing" ? (
          <div className="space-y-3">
            <section className="surface-card p-4">
              <h2 className="font-display text-lg font-bold text-foreground">
                Market your own car-hire page
              </h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                Twende keeps booking and payment secure while you share one page with your
                customers. No owner contact number or email is shown publicly.
              </p>
            </section>
            <HireOwnerBrandCard />
          </div>
        ) : null}

        {section === "documents" ? (
          <DriverComplianceDocuments
            heading="Your owner documents"
            includeDriverDocuments={false}
          />
        ) : null}

        {section === "lost-found" ? (
          <section className="surface-card p-4">
            <h2 className="font-display text-lg font-bold text-foreground">Lost &amp; found</h2>
            <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
              Report an item found in one of your cars or follow up on a customer report through the
              secure Twende lost-and-found workspace.
            </p>
            <Link to="/lost-found" className="mt-4 inline-flex rounded-full bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground">
              Open Lost &amp; found →
            </Link>
          </section>
        ) : null}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3 text-xs text-muted-foreground">
          <span>
            Need help filling the rest? Twende Operations will contact you after your interest or
            vehicle submission.
          </span>
          <Link to="/hire" className="font-semibold text-primary">
            View customer car hire →
          </Link>
        </div>
      </div>
    </AppShell>
  );
}

function ActionCard({
  title,
  detail,
  action,
  onClick,
}: {
  title: string;
  detail: string;
  action: string;
  onClick: () => void;
}) {
  return (
    <article className="surface-card p-4">
      <p className="text-sm font-bold text-foreground">{title}</p>
      <p className="mt-1 min-h-10 text-xs leading-relaxed text-muted-foreground">{detail}</p>
      <button
        type="button"
        onClick={onClick}
        className="mt-3 rounded-full border border-primary/30 px-3 py-2 text-xs font-bold text-primary"
      >
        {action} →
      </button>
    </article>
  );
}
