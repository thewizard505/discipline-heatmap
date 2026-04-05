import {
  SYS_LIST_INBOX,
  SYS_LIST_LONGTERM,
  SYS_LIST_OVERDUE,
  SYS_LIST_PROJECTS,
  SYS_LIST_TESTS,
  SYS_LIST_TODAY,
} from "./constants";
import { averageCompletionMinutes } from "./completionHistory";
import { patternEstimateMinutes } from "./estimatePatterns";

export type PlanMyDayPick = {
  listId: string;
  taskId: number;
  daysLeft: number;
  displayTitle: string;
  urgency: "overdue" | "critical" | "soon" | "steady";
};

export type TaskLite = {
  id: number;
  text: string;
  estimatedMinutes?: number | null;
  priority?: 1 | 2 | 3 | 4;
};

export type SessionAnswers = {
  workHours: number | null;
  /** taskId -> minutes for one-off estimates collected in flow */
  taskEstimates: Record<number, number>;
};

export type PlanLine = {
  listId: string;
  taskId: number;
  title: string;
  minutes: number;
};

export type PlanMyDayResult = {
  focus: PlanLine[];
  extra: PlanLine[];
  /** For debugging / tests — UI hides */
  _usedMinutes: number;
  _budgetMinutes: number;
};

function listCategory(listId: string): string {
  switch (listId) {
    case SYS_LIST_TESTS:
    case SYS_LIST_LONGTERM:
      return "school";
    case SYS_LIST_PROJECTS:
      return "work";
    case SYS_LIST_OVERDUE:
    case SYS_LIST_TODAY:
    case SYS_LIST_INBOX:
    default:
      return "general";
  }
}

function importanceWeight(listId: string): number {
  switch (listId) {
    case SYS_LIST_OVERDUE:
      return 1.25;
    case SYS_LIST_TESTS:
      return 1.2;
    case SYS_LIST_PROJECTS:
      return 1.12;
    case SYS_LIST_LONGTERM:
      return 1.08;
    case SYS_LIST_TODAY:
    case SYS_LIST_INBOX:
      return 1;
    default:
      return 1;
  }
}

export function isHighPriorityTask(
  pick: PlanMyDayPick,
  task: TaskLite | undefined,
): boolean {
  if (pick.listId === SYS_LIST_OVERDUE) return true;
  if (pick.daysLeft <= 0) return true;
  if (pick.urgency === "overdue" || pick.urgency === "critical") return true;
  const pr = task?.priority ?? 4;
  return pr <= 2;
}

export function resolveTaskMinutes(
  pick: PlanMyDayPick,
  task: TaskLite | undefined,
  session: SessionAnswers,
): { minutes: number; needsEstimate: boolean } {
  const fromSession = session.taskEstimates[pick.taskId];
  if (fromSession != null && fromSession > 0) {
    return { minutes: Math.round(fromSession), needsEstimate: false };
  }
  const hist = averageCompletionMinutes(pick.taskId);
  if (hist != null && hist > 0) {
    return { minutes: Math.round(hist), needsEstimate: false };
  }
  const est = task?.estimatedMinutes;
  if (est != null && est > 0) {
    return { minutes: Math.round(est), needsEstimate: false };
  }
  const pat = patternEstimateMinutes(task?.text ?? pick.displayTitle);
  if (pat != null && pat > 0) {
    return { minutes: pat, needsEstimate: false };
  }
  return { minutes: 30, needsEstimate: true };
}

/** First high-priority task that still needs a user estimate this session */
export function findCriticalEstimateQuestion(
  picks: PlanMyDayPick[],
  tasksById: Map<number, TaskLite>,
  session: SessionAnswers,
): { pick: PlanMyDayPick; task: TaskLite | undefined } | null {
  for (const pick of picks) {
    const task = tasksById.get(pick.taskId);
    if (!isHighPriorityTask(pick, task)) continue;
    const { needsEstimate } = resolveTaskMinutes(pick, task, session);
    if (needsEstimate) return { pick, task };
  }
  return null;
}

function urgencyScore(daysLeft: number): number {
  if (daysLeft < 0) return 1 + Math.min(0.5, -daysLeft * 0.05);
  return 1 / (1 + Math.max(0, daysLeft));
}

function effortBoost(minutes: number): number {
  const m = Math.max(5, minutes);
  return 1 / Math.sqrt(m);
}

export function buildTodayPlan(
  picks: PlanMyDayPick[],
  tasksById: Map<number, TaskLite>,
  session: SessionAnswers,
  options?: { tieSeed?: number },
): PlanMyDayResult {
  const workHours = session.workHours ?? 4;
  const budgetMinutes = Math.max(30, workHours * 60);

  if (picks.length === 0) {
    return {
      focus: [],
      extra: [],
      _usedMinutes: 0,
      _budgetMinutes: budgetMinutes,
    };
  }

  const categories = picks.map((p) => listCategory(p.listId));
  const freq: Record<string, number> = {};
  for (const c of categories) freq[c] = (freq[c] ?? 0) + 1;
  let topCat = "general";
  let topN = 0;
  for (const [c, n] of Object.entries(freq)) {
    if (n > topN) {
      topN = n;
      topCat = c;
    }
  }

  type Row = {
    pick: PlanMyDayPick;
    task: TaskLite | undefined;
    minutes: number;
    score: number;
  };

  const rows: Row[] = picks.map((pick) => {
    const task = tasksById.get(pick.taskId);
    const { minutes } = resolveTaskMinutes(pick, task, session);
    const u = urgencyScore(pick.daysLeft);
    const imp = importanceWeight(pick.listId);
    const effort = effortBoost(minutes);
    const cat = listCategory(pick.listId);
    const focusMatch = cat === topCat ? 1.15 : 1;
    const pr = task?.priority ?? 4;
    const priorityBoost = pr <= 2 ? 1.12 : pr === 3 ? 1.04 : 1;
    const raw =
      u * 0.38 +
      imp * 0.22 +
      effort * 0.18 +
      focusMatch * 0.12 +
      priorityBoost * 0.1;
    const tie = ((pick.taskId * 13) % 100) * 0.0001 * (options?.tieSeed ?? 0.5);
    return { pick, task, minutes, score: raw + tie };
  });

  rows.sort((a, b) => b.score - a.score);

  const toLine = (r: (typeof rows)[0]): PlanLine => ({
    listId: r.pick.listId,
    taskId: r.pick.taskId,
    title: r.pick.displayTitle,
    minutes: r.minutes,
  });

  const focus: PlanLine[] = [];
  let used = 0;

  const pushIfNew = (r: (typeof rows)[0]) => {
    if (focus.some((f) => f.taskId === r.pick.taskId)) return false;
    focus.push(toLine(r));
    used += r.minutes;
    return true;
  };

  for (const r of rows) {
    if (focus.length >= 3) break;
    if (used + r.minutes <= budgetMinutes) pushIfNew(r);
  }

  if (focus.length === 0 && rows.length > 0) {
    pushIfNew(rows[0]!);
  }

  for (const r of rows) {
    if (focus.length >= 3) break;
    if (used + r.minutes <= budgetMinutes * 1.12) pushIfNew(r);
  }

  for (const r of rows) {
    if (focus.length >= 3) break;
    pushIfNew(r);
  }

  const focusTrimmed = focus.slice(0, 3);
  const focusIds = new Set(focusTrimmed.map((f) => f.taskId));
  const extra = rows
    .filter((r) => !focusIds.has(r.pick.taskId))
    .map((r) => toLine(r))
    .slice(0, 8);

  return {
    focus: focusTrimmed,
    extra,
    _usedMinutes: focusTrimmed.reduce((s, f) => s + f.minutes, 0),
    _budgetMinutes: budgetMinutes,
  };
}
