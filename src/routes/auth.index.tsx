import { Link } from "@tanstack/react-router";
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AuthForm } from "@/components/AuthForm";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth/")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Sign in — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Sign in or create a Twende Meru Rides account to book taxis in Meru with the fare shown before you request.",
      },
      { property: "og:title", content: "Sign in — Twende Meru Rides" },
      {
        property: "og:description",
        content: "Create an account to book taxis in Meru with upfront fares.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: CustomerAuthPage,
});

function safePath(value: string | undefined) {
  if (!value) return "/book";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/book";
}

function CustomerAuthPage() {
  const { redirect } = Route.useSearch();
  return (
    <>
      <AuthForm
        eyebrow="Twende Meru Rides"
        heading="Welcome back"
        blurb="Sign in to book a taxi in Meru and keep your trips and receipts in one place."
        destination={safePath(redirect)}
        allowSignUp
        signUpCta="Create account"
        footer={
          <p>
            Looking to hire a car?{" "}
            <Link to="/cars" className="font-semibold text-primary">
              Browse cars for hire
            </Link>
          </p>
        }
      />
    </>
  );
}
