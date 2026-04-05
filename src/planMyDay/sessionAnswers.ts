import type { SessionAnswers } from "./engine";
import { loadPreferredWorkHours, savePreferredWorkHours } from "./hoursStorage";

const KEY = "planMyDay_flow_answers_v1";

export function loadFlowSessionAnswers(): SessionAnswers {
  if (typeof window === "undefined") {
    return { workHours: null, taskEstimates: {} };
  }
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) {
      const h = loadPreferredWorkHours();
      return { workHours: h, taskEstimates: {} };
    }
    const p = JSON.parse(raw) as {
      workHours?: number | null;
      taskEstimates?: Record<string, number>;
    };
    const taskEstimates: Record<number, number> = {};
    if (p.taskEstimates && typeof p.taskEstimates === "object") {
      for (const [k, v] of Object.entries(p.taskEstimates)) {
        const id = parseInt(k, 10);
        if (Number.isFinite(id) && typeof v === "number" && v > 0) {
          taskEstimates[id] = v;
        }
      }
    }
    let workHours =
      p.workHours != null && Number.isFinite(p.workHours) && p.workHours > 0
        ? p.workHours
        : null;
    if (workHours == null) workHours = loadPreferredWorkHours();
    return { workHours, taskEstimates };
  } catch {
    return { workHours: loadPreferredWorkHours(), taskEstimates: {} };
  }
}

export function saveFlowSessionAnswers(s: SessionAnswers): void {
  try {
    sessionStorage.setItem(
      KEY,
      JSON.stringify({
        workHours: s.workHours,
        taskEstimates: s.taskEstimates,
      }),
    );
  } catch {
    /* ignore */
  }
  if (s.workHours != null && s.workHours > 0) {
    savePreferredWorkHours(s.workHours);
  }
}
