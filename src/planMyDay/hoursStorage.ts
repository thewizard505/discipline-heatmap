const KEY = "tunnelvision_plan_my_day_hours_v1";

export function loadPreferredWorkHours(): number | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(KEY);
    if (raw == null) return null;
    const n = parseFloat(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 16) return null;
    return n;
  } catch {
    return null;
  }
}

export function savePreferredWorkHours(hours: number): void {
  try {
    localStorage.setItem(KEY, String(hours));
  } catch {
    /* ignore */
  }
}
