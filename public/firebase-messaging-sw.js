/* Twende Meru Rides — background push worker.
 * Config arrives in the query string because a worker cannot read import.meta.env.
 * This worker only handles messaging; it never caches the app shell.
 */
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js");

const config = Object.fromEntries(new URL(self.location).searchParams);
firebase.initializeApp(config);
const messaging = firebase.messaging();

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

async function show(payload) {
  const data = payload.data || {};
  const title = data.title || "Twende Meru Rides";
  await self.registration.showNotification(title, {
    body: data.body || "",
    icon: "/icons/icon-192.png",
    badge: "/icons/icon-192.png",
    // The tag collapses repeats of the same event into one notification,
    // but renotify makes the phone alert again for a genuinely new event.
    tag: data.dedupeKey || data.templateCode || "twende",
    renotify: true,
    silent: false,
    requireInteraction: data.templateCode === "ride_offer",
    vibrate: [220, 120, 220, 120, 320],
    data: { path: data.path || "/", dedupeKey: data.dedupeKey || null },
  });

  // If a tab or the installed app is still alive in the background, ask it to
  // ring the Twende alert so the person hears it, not just a silent banner.
  const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  for (const client of clients) {
    client.postMessage({ type: "twende-push", tone: data.templateCode === "ride_offer" ? "offer" : "status" });
  }
}

messaging.onBackgroundMessage((payload) => {
  self.registration && show(payload);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const path = (event.notification.data && event.notification.data.path) || "/";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    (async () => {
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        if (new URL(client.url).origin !== self.location.origin) continue;
        await client.focus();
        if ("navigate" in client) await client.navigate(target);
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});
