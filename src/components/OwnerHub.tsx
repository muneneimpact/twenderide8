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
import { useMe } from "@/hooks/useMe";

type Section = "overview" | "vehicles" | "bookings" | "earnings" | "marketing" | "documents";

const sections: Array<{ key: Section; label: string }> = [
  { key: "overview", label: "Overview" },
  { key: "vehicles", label: "Cars" },
  { key: "bookings", label: "Bookings" },
  { key: "earnings", label: "Earnings" },
  { key: "marketing", label: "Marketing" },
  { key: "documents", label: "Documents" },
];

export function OwnerHub() {
  const { me } = useMe();
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
            heading="Owner and vehicle documents"
            includeDriverDocuments={false}
          />
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
