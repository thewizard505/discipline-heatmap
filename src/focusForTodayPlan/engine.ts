import type {
  EnergyLevel,
  FocusPlanUserInput,
  GeneratedFocusPlan,
  PlanTask,
  ScoredPlanTask,
} from "./types";
import { PLAN_TASK_LIBRARY } from "./taskLibrary";
import {
  pickVariation,
  resolveAvoid,
  resolveMainFocus,
  resolveWhy,
} from "./messageVariations";

function norm(s: string): string {
  return s.trim().toLowerCase();
}

/** Merge mainFocus / tennis follow-up so `tennis` can earn the +3 priority match */
function effectivePriorities(input: FocusPlanUserInput): string[] {
  const raw = [...input.priorities];
  const mf = norm(input.mainFocus);
  if (mf === "tennis" || mf.includes("tennis")) raw.push("tennis");
  if (input.tennisImprove?.trim()) raw.push("tennis");
  return [...new Set(raw.map((s) => s.trim()).filter(Boolean))];
}

/** Priority match: task.type matches any user priority string */
function priorityMatches(taskType: string, priorities: string[]): boolean {
  const t = norm(taskType);
  for (const p of priorities) {
    const n = norm(p);
    if (!n) continue;
    if (t === n || t.includes(n) || n.includes(t)) return true;
  }
  return false;
}

export function scoreTask(
  task: PlanTask,
  input: FocusPlanUserInput,
): number {
  let score = 0;
  if (task.hasDeadline) score += 5;
  if (priorityMatches(task.type, effectivePriorities(input))) score += 3;
  if (input.energy === "low" && task.difficulty === "hard") score -= 2;
  return score;
}

export function getMaxTaskCount(
  timeAvailable: number,
  energy: EnergyLevel,
): number {
  if (timeAvailable <= 2) return 2;
  if (timeAvailable <= 4) {
    return energy === "low" ? 3 : 4;
  }
  return energy === "high" ? 6 : 5;
}

export function scoreAndSortTasks(
  input: FocusPlanUserInput,
  library: PlanTask[] = PLAN_TASK_LIBRARY,
): ScoredPlanTask[] {
  const scored: ScoredPlanTask[] = library.map((t) => ({
    ...t,
    score: scoreTask(t, input),
  }));
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return a.name.localeCompare(b.name);
  });
  return scored;
}

/**
 * Tie-break jitter: re-run with different seed to reshuffle equal scores slightly
 */
function applySeedTieBreak(
  tasks: ScoredPlanTask[],
  seed: number,
): ScoredPlanTask[] {
  return [...tasks].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const ha = (a.id.charCodeAt(0) ^ Math.floor(seed * 1000)) % 7;
    const hb = (b.id.charCodeAt(0) ^ Math.floor(seed * 1000)) % 7;
    if (ha !== hb) return hb - ha;
    return a.name.localeCompare(b.name);
  });
}

export function generateFocusPlan(
  input: FocusPlanUserInput,
  options?: { variationSeed?: number; library?: PlanTask[] },
): GeneratedFocusPlan {
  const variationSeed =
    options?.variationSeed ??
    (typeof performance !== "undefined"
      ? performance.now() % 1
      : Date.now() % 1000 / 1000);
  const lib = options?.library ?? PLAN_TASK_LIBRARY;

  const sorted = applySeedTieBreak(scoreAndSortTasks(input, lib), variationSeed);
  const max = getMaxTaskCount(input.timeAvailable, input.energy);
  const priorityTasks = sorted.slice(0, max);

  let stretchTask: ScoredPlanTask | null = null;
  if (input.energy === "high" && sorted.length > max) {
    stretchTask = sorted[max] ?? null;
  }

  return {
    mainFocus: resolveMainFocus(input, variationSeed),
    priorityTasks,
    stretchTask,
    avoid: resolveAvoid(input, variationSeed),
    whyThisPlan: resolveWhy(input, variationSeed),
    variationSeed,
  };
}

/** Which adaptive fields are required for this base input */
export function getRequiredAdaptiveFields(
  input: Pick<
    FocusPlanUserInput,
    | "timeAvailable"
    | "energy"
    | "hasDeadlines"
    | "mainFocus"
  >,
): {
  needOneMustFinish: boolean;
  needDueFirst: boolean;
  needDueMinutes: boolean;
  needEasyOrBalanced: boolean;
  needTennis: boolean;
} {
  const mf = norm(input.mainFocus);
  return {
    needOneMustFinish: input.timeAvailable < 2,
    needDueFirst: input.hasDeadlines,
    needDueMinutes: input.hasDeadlines,
    needEasyOrBalanced: input.energy === "low",
    needTennis: mf === "tennis" || mf.includes("tennis"),
  };
}

function synthetic(
  id: string,
  name: string,
  score: number,
): ScoredPlanTask {
  return {
    id,
    name,
    type: "user",
    difficulty: "medium",
    hasDeadline: true,
    score,
  };
}

/**
 * Pin user-stated anchors (must-finish, due-first) to the top of the checklist
 * without changing underlying library scores for remaining slots.
 */
export function prependUserAnchorTasks(
  plan: GeneratedFocusPlan,
  input: FocusPlanUserInput,
): GeneratedFocusPlan {
  const max = getMaxTaskCount(input.timeAvailable, input.energy);
  const anchors: ScoredPlanTask[] = [];
  if (input.oneMustFinish?.trim()) {
    anchors.push(synthetic("user-must-finish", input.oneMustFinish.trim(), 1000));
  }
  if (input.dueFirst?.trim()) {
    const mins =
      input.dueFirstMinutes != null && input.dueFirstMinutes > 0
        ? ` (~${input.dueFirstMinutes}m)`
        : "";
    anchors.push(
      synthetic(
        "user-due-first",
        `Due first: ${input.dueFirst.trim()}${mins}`,
        999,
      ),
    );
  }
  if (anchors.length === 0) return plan;

  const anchorIds = new Set(anchors.map((a) => a.id));
  const rest = plan.priorityTasks.filter((t) => !anchorIds.has(t.id));
  return {
    ...plan,
    priorityTasks: [...anchors, ...rest].slice(0, max),
  };
}
