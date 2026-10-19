import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, driverTabs } from "@/components/AppShell";
import { AddVehicleForHire } from "@/components/AddVehicleForHire";
import { DriverComplianceDocuments } from "@/components/DriverComplianceDocuments";
import { HirePortfolioFinance } from "@/components/HirePortfolioFinance";
import { HireRequestsBoard } from "@/components/HireRequestsBoard";
import { HireVehicleManager } from "@/components/HireVehicleManager";
import { RoleGate } from "@/components/RoleGate";
import { OwnerHireBookings } from "@/components/OwnerHireBookings";
import { OwnerSignatureSettings } from "@/components/OwnerSignatureSettings";

export const Route = createFileRoute("/_authenticated/driver/hire")({
  head: () => ({
    meta: [
      { title: "Manage hire cars — Twende Meru Rides" },
      {
        name: "description",
        content: "Manage your hire-car listings, photos, bookings and owner earnings.",
      },
      { property: "og:title", content: "Manage hire cars — Twende Meru Rides" },
      {
        property: "og:description",
        content: "Manage hire-car details, inspection status, bookings and earnings.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DriverHirePage,
});

function DriverHirePage() {
  return (
    <RoleGate
      allow={["driver"]}
      title="Hire cars"
      hint="Hire-car management is available to approved drivers and vehicle owners."
      fallback={<HireOwnerPage />}
    >
      <AppShell title="Hire cars" tabs={driverTabs} eyebrow="Twende Driver">
        <HireManagement />
      </AppShell>
    </RoleGate>
  );
}

function HireOwnerPage() {
  return (
    <AppShell title="Manage hire cars">
      <HireManagement hireOnly />
    </AppShell>
  );
}

const SECTIONS = [
  { key: "bookings", label: "Bookings" },
  { key: "finances", label: "Finances" },
  { key: "vehicles", label: "Vehicles" },
  { key: "documents", label: "Documents" },
] as const;
type SectionKey = (typeof SECTIONS)[number]["key"];

function HireManagement({ hireOnly = false }: { hireOnly?: boolean }) {
  const [section, setSection] = useState<SectionKey>("bookings");
  return (
    <div className="mx-auto w-full max-w-md space-y-4 px-3 py-4 sm:px-4">
      <div className="sticky top-[60px] z-30 -mx-3 bg-background/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4">
        <div role="tablist" className="grid grid-cols-4 gap-1 rounded-2xl border border-border bg-card p-1">
          {SECTIONS.map((s) => (
            <button
              key={s.key}
              role="tab"
              aria-selected={section === s.key}
              onClick={() => setSection(s.key)}
              className={`min-h-10 rounded-xl px-1 text-xs font-semibold ${
                section === s.key ? "bg-primary text-primary-foreground" : "text-muted-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {section === "bookings" && (
        <>
          <OwnerHireBookings />
          <OwnerSignatureSettings />
          <HireRequestsBoard />
          <Link to="/hire" className="inline-flex text-sm font-semibold text-primary">
            View the customer Hire page →
          </Link>
        </>
      )}
      {section === "finances" && <HirePortfolioFinance />}
      {section === "vehicles" && (
        <>
          <section className="surface-card p-4">
            <h2 className="text-sm font-semibold text-foreground">Add a vehicle</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Operations approve the vehicle before its hire listing goes live.
            </p>
            <AddVehicleForHire hireOnly={hireOnly} label="Add a car for hire" />
          </section>
          <HireVehicleManager
            hireOnly={hireOnly}
            showAddVehicle={false}
            heading="Your cars · photos, prices and terms"
          />
        </>
      )}
      {section === "documents" && (
        <DriverComplianceDocuments
          heading="Owner and vehicle documents"
          includeDriverDocuments={!hireOnly}
        />
      )}
    </div>
  );
}
