import { createFileRoute } from "@tanstack/react-router";
import { AuthForm } from "@/components/AuthForm";

export const Route = createFileRoute("/auth/admin")({
  head: () => ({
    meta: [
      { title: "Staff sign in — Twende Ride Meru" },
      {
        name: "description",
        content:
          "Twende Ride staff entrance: operations, finance and super admin sign-in for the Meru dispatch and pricing consoles.",
      },
      { property: "og:title", content: "Staff sign in — Twende Ride" },
      { property: "og:description", content: "Operations, finance and super admin access." },
      { property: "og:type", content: "website" },
      { name: "robots", content: "noindex" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AdminAuthPage,
});

function AdminAuthPage() {
  return (
    <AuthForm
      eyebrow="Twende Operations"
      heading="Staff sign in"
      blurb="Operations, finance and super admin accounts only. Staff access is granted by a super admin — there is no self sign-up here."
      destination="/admin"
      allowSignUp={false}
    />
  );
}
