const STORAGE_KEY = "twende:selected-hire-vehicle";

export function rememberHireVehicle(vehicleId: string) {
  if (typeof window !== "undefined") window.sessionStorage.setItem(STORAGE_KEY, vehicleId);
}

export function readRememberedHireVehicle() {
  if (typeof window === "undefined") return null;
  return window.sessionStorage.getItem(STORAGE_KEY);
}

export function clearRememberedHireVehicle() {
  if (typeof window !== "undefined") window.sessionStorage.removeItem(STORAGE_KEY);
}
