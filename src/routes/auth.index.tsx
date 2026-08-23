import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { AuthForm } from "@/components/AuthForm";

const searchSchema = z.object({ redirect: z.string().optional() });

export const Route = createFileRoute("/auth/")({
  validateSearch: (search) => searchSchema.parse(search),
  head: () => ({
    meta: [
      { title: "Sign in — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Sign in or create a Twende Ride account to book taxis in Meru with the fare shown before you request.",
      },
      { property: "og:title", content: "Sign in — Twende Ride" },
      { property: "og:description", content: "Create an account to book taxis in Meru with upfront fares." },
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
    <AuthForm
      eyebrow="Twende Ride"
      heading="Welcome back"
      blurb="Sign in to book a taxi in Meru and keep your trips and receipts in one place."
      destination={safePath(redirect)}
      allowSignUp
      signUpCta="Create account"
    />
  );
}
