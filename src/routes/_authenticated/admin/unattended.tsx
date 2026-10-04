import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/_authenticated/admin/unattended')({
  head: () => ({
    meta: [
      { title: 'Unattended rides — Twende Meru Rides' },
      { name: 'description', content: 'Review unattended ride requests in Twende Meru Rides.' },
      { property: 'og:title', content: 'Unattended rides — Twende Meru Rides' },
      { property: 'og:description', content: 'Review unattended ride requests in Twende Meru Rides.' },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
  }),
  component: RouteComponent,
})

function RouteComponent() {
  return <div>Hello "/_authenticated/admin/unattended"!</div>
}
