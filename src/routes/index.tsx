import { createFileRoute, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

/**
 * Twende Ride is a signed-in product: the entry point either sends you to the
 * sign-in screen or straight into the app.
 */
export const Route = createFileRoute("/")({
  ssr: false,
  head: () => ({
    meta: [
      { title: "Twende Ride — Taxis in Meru with fares you can see first" },
      {
        name: "description",
        content:
          "Sign in to Twende Ride to book taxis across Meru with a server-calculated fare shown before you request, M-PESA or cash payment and live driver tracking.",
      },
      { property: "og:title", content: "Twende Ride — Taxis in Meru" },
      {
        property: "og:description",
        content: "Sign in to see the full itemised fare before you request a taxi in Meru.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  beforeLoad: async () => {
    const { data } = await supabase.auth.getUser();
    if (!data.user) throw redirect({ to: "/auth", search: { redirect: "/book" } });
    throw redirect({ to: "/book" });
  },
  component: () => null,
});
