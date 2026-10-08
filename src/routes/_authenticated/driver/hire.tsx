import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell, driverTabs } from "@/components/AppShell";
import { AddVehicleForHire } from "@/components/AddVehicleForHire";
import { DriverComplianceDocuments } from "@/components/DriverComplianceDocuments";
import { HirePortfolioFinance } from "@/components/HirePortfolioFinance";
import { HireRequestsBoard } from "@/components/HireRequestsBoard";
import { HireVehicleManager } from "@/components/HireVehicleManager";
import { RoleGate } from "@/components/RoleGate";

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

function HireManagement({ hireOnly = false }: { hireOnly?: boolean }) {
  return (
    <div className="mx-auto max-w-md space-y-4 px-4 py-5">
      <section className="surface-card p-4">
        <h2 className="font-display text-lg font-semibold text-foreground">
          Manage your hire cars
        </h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Complete the steps below. Driver and vehicle approval are separate from the hire-listing
          inspection. Once Ops approves the hire listing, it is published on the customer Hire page
          automatically.
        </p>
        <Link to="/hire" className="mt-3 inline-flex text-sm font-semibold text-primary">
          View the customer Hire page →
        </Link>
      </section>
      <section className="surface-card p-4">
        <h2 className="text-sm font-semibold text-foreground">Step 1 · Register your vehicle</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Use a vehicle you own or add one here. Operations must approve the vehicle before a hire
          listing can go live.
        </p>
        <AddVehicleForHire hireOnly={hireOnly} label="Add a car for hire" />
      </section>
      <DriverComplianceDocuments
        {...(hireOnly ? { heading: "Step 2 · Owner and vehicle compliance" } : {})}
        includeDriverDocuments={!hireOnly}
      />
      <HireVehicleManager
        hireOnly={hireOnly}
        showAddVehicle={false}
        heading="Step 3 · Photos, listing details and payment terms"
      />
      <HireRequestsBoard />
      <HirePortfolioFinance />
    </div>
  );
}
