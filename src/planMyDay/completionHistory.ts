/** Rolling completion durations (minutes) per task id for Plan My Day estimates */

const KEY = "tunnelvision_plan_my_day_completion_v1";
const MAX_SAMPLES = 5;

function load(): Record<string, number[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const p = JSON.parse(raw) as Record<string, number[]>;
    return p && typeof p === "object" ? p : {};
  } catch {
    return {};
  }
}

function save(data: Record<string, number[]>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function appendPlanMyDayCompletion(
  taskId: number,
  minutes: number,
): void {
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) return;
  const id = String(taskId);
  const data = load();
  const prev = data[id] ?? [];
  const next = [...prev, minutes].slice(-MAX_SAMPLES);
  data[id] = next;
  save(data);
}

export function averageCompletionMinutes(taskId: number): number | null {
  const arr = load()[String(taskId)];
  if (!arr || arr.length === 0) return null;
  const n = Math.min(5, arr.length);
  const slice = arr.slice(-n);
  const sum = slice.reduce((a, b) => a + b, 0);
  return Math.round((sum / slice.length) * 10) / 10;
}
