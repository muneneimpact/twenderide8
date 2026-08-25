/**
 * Kenyan number plates are written with a space between the series and the
 * number, e.g. "KDG 568T". We store and display them that way so drivers,
 * customers and operations all read the same thing.
 */

/** Tidy whatever was typed into the canonical "KDG 568T" shape. */
export function formatKenyanPlate(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Standard civilian plate: three letters, three digits, one letter.
  const civilian = /^([A-Z]{3})(\d{1,3})([A-Z]?)$/.exec(cleaned);
  if (civilian) return `${civilian[1]} ${civilian[2]}${civilian[3]}`.trim();
  // Older / government style: letters then digits.
  const generic = /^([A-Z]{1,3})(\d{1,4})([A-Z]{0,2})$/.exec(cleaned);
  if (generic) return `${generic[1]} ${generic[2]}${generic[3]}`.trim();
  return cleaned;
}

/** Accepts the common Kenyan formats, with or without the space. */
export function isValidKenyanPlate(raw: string): boolean {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  return /^[A-Z]{1,3}\d{1,4}[A-Z]{0,2}$/.test(cleaned) && cleaned.length >= 5;
}

/** Rough hex swatch for a colour word so the UI can show the car's colour. */
export function colourSwatch(colour?: string | null): string {
  const key = (colour ?? "").trim().toLowerCase();
  const map: Record<string, string> = {
    white: "#f4f4f5",
    silver: "#c7cbd1",
    grey: "#8b9099",
    gray: "#8b9099",
    black: "#1b1c1e",
    blue: "#2563eb",
    navy: "#1e3a8a",
    red: "#dc2626",
    maroon: "#7f1d1d",
    green: "#16a34a",
    gold: "#d4a017",
    yellow: "#eab308",
    orange: "#ea580c",
    brown: "#78350f",
    beige: "#d8cbb2",
    purple: "#7c3aed",
    pink: "#ec4899",
  };
  for (const [name, hex] of Object.entries(map)) if (key.includes(name)) return hex;
  return "#9aa0a6";
}
