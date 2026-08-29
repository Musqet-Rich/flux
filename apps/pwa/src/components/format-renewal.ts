// A rate-limit window's `resetsAt` (ISO) as a short relative time for the status bar: minutes
// precision under an hour (`40m`), hours and minutes under a day (`2h10m`, or `11h` on the hour),
// whole days above (`2d`). `now` is injected so the caller's once-a-minute clock drives it and
// tests stay deterministic. A past or unparseable time collapses to `0m` / `''` rather than a
// negative or NaN string.

const minuteMs = 60_000;
const hourMinutes = 60;
const dayMinutes = 24 * 60;

export const formatRenewal = (resetsAt: string, now: number): string => {
  const ms = Date.parse(resetsAt) - now;
  if (Number.isNaN(ms)) return '';
  const minutes = Math.max(0, Math.floor(ms / minuteMs));
  if (minutes < hourMinutes) return `${minutes}m`;
  if (minutes < dayMinutes) {
    const hours = Math.floor(minutes / hourMinutes);
    const rest = minutes % hourMinutes;
    return rest === 0 ? `${hours}h` : `${hours}h${rest}m`;
  }
  return `${Math.floor(minutes / dayMinutes)}d`;
};
