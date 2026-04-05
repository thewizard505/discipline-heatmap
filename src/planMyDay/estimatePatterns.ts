/** Reuse same storage shape as App estimate patterns for keyword averages */

const ESTIMATE_PATTERNS_KEY = "tunnelvision_estimate_patterns_v1";

type EstimatePatternRow = { sum: number; count: number };

function loadPatterns(): Record<string, EstimatePatternRow> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(ESTIMATE_PATTERNS_KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, EstimatePatternRow>;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

export function normalizeEstimateKeyword(text: string): string {
  return text.trim().toLowerCase().slice(0, 80);
}

/** Average minutes from prior estimates for similar titles, or null */
export function patternEstimateMinutes(text: string): number | null {
  const key = normalizeEstimateKeyword(text);
  if (!key) return null;
  const row = loadPatterns()[key];
  if (!row || row.count <= 0) return null;
  return Math.round(row.sum / row.count);
}
