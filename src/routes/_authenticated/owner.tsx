import { createFileRoute } from "@tanstack/react-router";
import { OwnerHub } from "@/components/OwnerHub";

export const Route = createFileRoute("/_authenticated/owner")({
  head: () => ({
    meta: [
      { title: "Owner Hub — Twende Meru Rides" },
      {
        name: "description",
        content:
          "Manage your hire cars, bookings, earnings, storefront and tracked owner marketing links with Twende.",
      },
      { property: "og:title", content: "Owner Hub — Twende Meru Rides" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      {
        property: "og:description",
        content: "Your Twende owner workspace for car hire operations and marketing.",
      },
    ],
  }),
  component: OwnerHub,
});
