import { createFileRoute, Link } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";

export const Route = createFileRoute("/auth/drivers")({
  head: () => ({
    meta: [
      { title: "Driver sign in — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Twende Ride drivers: sign in to go online, accept trips in Meru and track your earnings, or register to start onboarding.",
      },
      { property: "og:title", content: "Driver sign in — Twende Ride" },
      { property: "og:description", content: "Go online, take trips and track earnings with Twende Ride." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DriverAuthPage,
});

function DriverAuthPage() {
  return (
    <AuthForm
      eyebrow="Twende Driver"
      heading="Driver sign in"
      blurb="Sign in to go online and take trips. New drivers register here, then submit vehicle and licence details for approval."
      destination="/driver"
      allowSignUp
      signUpCta="Register as a driver"
      footer={
        <p>
          Booking a ride instead?{" "}
          <Link to="/auth" className="font-medium text-primary">
            Customer sign in
          </Link>
        </p>
      }
    />
  );
}
