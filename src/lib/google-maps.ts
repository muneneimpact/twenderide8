/**
 * Browser loader for the Google Maps JavaScript API.
 * Only ever imported from client-only components (see MapPanel).
 */
declare global {
  interface Window {
    google?: typeof google;
    __twendeMapsReady?: () => void;
  }
}

let pending: Promise<typeof google.maps> | null = null;

export function loadGoogleMaps(): Promise<typeof google.maps> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in the browser"));
  }
  if (window.google?.maps) return Promise.resolve(window.google.maps);
  if (pending) return pending;

  const key = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_BROWSER_KEY"] as
    | string
    | undefined;
  const channel = import.meta.env["VITE_LOVABLE_CONNECTOR_GOOGLE_MAPS_TRACKING_ID"] as
    | string
    | undefined;

  pending = new Promise((resolve, reject) => {
    if (!key) {
      reject(new Error("Google Maps browser key is not configured"));
      return;
    }
    window.__twendeMapsReady = () => resolve(window.google!.maps);
    const script = document.createElement("script");
    script.src =
      `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}` +
      `&loading=async&callback=__twendeMapsReady` +
      (channel ? `&channel=${encodeURIComponent(channel)}` : "");
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps failed to load"));
    document.head.appendChild(script);
  });
  return pending;
}
