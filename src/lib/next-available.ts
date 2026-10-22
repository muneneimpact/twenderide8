const DAY = 86_400_000;

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

/** Earliest day (from today) not covered by any booking, as a friendly label. */
export function nextAvailableLabel(
  bookings: Array<{ start: string; end: string }>,
  now: Date = new Date(),
): { today: boolean; label: string } {
  const ranges = bookings.map((b) => [new Date(b.start).getTime(), new Date(b.end).getTime()] as const);
  const today = startOfDay(now);
  for (let i = 0; i < 366; i++) {
    const dayStart = today.getTime() + i * DAY;
    const probe = i === 0 ? Math.max(dayStart, now.getTime()) : dayStart;
    const busy = ranges.some(([s, e]) => s < dayStart + DAY && e > probe && s <= probe);
    if (!busy) {
      if (i === 0) return { today: true, label: "Available today" };
      if (i === 1) return { today: false, label: "Available tomorrow" };
      const d = new Date(dayStart);
      return {
        today: false,
        label: `Available ${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })} ${d.getFullYear()}`,
      };
    }
  }
  return { today: false, label: "Fully booked" };
}
