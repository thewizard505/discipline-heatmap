import React from "react";
import { Analytics } from "@vercel/analytics/react";
import {
  useState,
  useEffect,
  useMemo,
  useRef,
  useCallback,
  useLayoutEffect,
} from "react";

/**
 * TUNNEL VISION - DISCIPLINE OPERATING SYSTEM
 * -----------------------------------------
 * FEATURES: Heatmap, Beat Yesterday, Stats, Advanced Linear Graph.
 * UPDATE: Precise real-time date mapping for Discipline Log.
 * Sessions stack on the current day's box (March 7th) instead of incrementing indices.
 */

/* --- SYSTEM CONSTANTS --- */
const RADIUS = 135;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Typing simulation: updates setText with one more character every msPerChar. */
async function typeText(
  setText: (value: React.SetStateAction<string>) => void,
  text: string,
  msPerChar: number = 50,
): Promise<void> {
  for (let i = 0; i <= text.length; i++) {
    setText(text.slice(0, i));
    if (i < text.length) await new Promise((r) => setTimeout(r, msPerChar));
  }
}

/* --- DATA MODELS --- */
type Task = {
  id: number;
  text: string;
  description: string;
  removing: boolean;
  createdAt: number;
  workMode: "inside" | "external";
  completed?: boolean;
  /** YYYY-MM-DD — Today list sets to current day; Tests/Projects/Long-Term via picker */
  dueDate?: string | null;
  /** User-provided quick estimate (Focus for today), minutes */
  estimatedMinutes?: number | null;
  /** User skipped or answered inline estimate prompt — do not ask again */
  estimatePromptDismissed?: boolean;
};

const SYS_LIST_OVERDUE = "sys-overdue";
const SYS_LIST_INBOX = "sys-inbox";
const SYS_LIST_TODAY = "sys-today";
const SYS_LIST_PROJECTS = "sys-projects";
const SYS_LIST_TESTS = "sys-tests";
const SYS_LIST_LONGTERM = "sys-longterm";

/** Lists that use elastic checkbox + “move to Completed” flow (excludes Overdue). */
const ELASTIC_COMPLETE_SYS_LIST_IDS = new Set<string>([
  SYS_LIST_INBOX,
  SYS_LIST_TODAY,
  SYS_LIST_TESTS,
  SYS_LIST_PROJECTS,
  SYS_LIST_LONGTERM,
]);

const OVERDUE_SOURCE_LIST_IDS: readonly string[] = [
  SYS_LIST_INBOX,
  SYS_LIST_TODAY,
  SYS_LIST_TESTS,
  SYS_LIST_PROJECTS,
  SYS_LIST_LONGTERM,
];

const DUE_DATE_PICKER_LIST_IDS = new Set<string>([
  SYS_LIST_TESTS,
  SYS_LIST_PROJECTS,
  SYS_LIST_LONGTERM,
]);

/** Lists in the Focus task picker (right panel), display order. */
const FOCUS_PICKER_LIST_IDS: readonly string[] = [
  SYS_LIST_OVERDUE,
  SYS_LIST_INBOX,
  SYS_LIST_TODAY,
  SYS_LIST_PROJECTS,
  SYS_LIST_TESTS,
  SYS_LIST_LONGTERM,
];

const FOCUS_PICKER_LABELS: Record<string, string> = {
  [SYS_LIST_OVERDUE]: "Overdue",
  [SYS_LIST_INBOX]: "Inbox",
  [SYS_LIST_TODAY]: "Today",
  [SYS_LIST_PROJECTS]: "Projects",
  [SYS_LIST_TESTS]: "Tests",
  [SYS_LIST_LONGTERM]: "Long-Term Assignments",
};

/** Short labels for the Focus for today row tags (Todoist-like). */
const FOCUS_FOR_TODAY_TAG_LABELS: Record<string, string> = {
  [SYS_LIST_OVERDUE]: "Overdue",
  [SYS_LIST_INBOX]: "Inbox",
  [SYS_LIST_TODAY]: "Today",
  [SYS_LIST_PROJECTS]: "Project",
  [SYS_LIST_TESTS]: "Test",
  [SYS_LIST_LONGTERM]: "Long-term",
};

type FocusSessionEntry = { listId: string; taskId: number };

/**
 * Completing a session task for these lists only removes it from the focus
 * queue; the source task in Tasks/Projects/Tests/Long-Term stays.
 */
const FOCUS_SESSION_PRESERVE_SOURCE_LIST_IDS = new Set<string>([
  SYS_LIST_TESTS,
  SYS_LIST_PROJECTS,
  SYS_LIST_LONGTERM,
]);

/** Session-only label shown under the timer (prefixed intent to study/work). */
function getFocusSessionDisplayLabel(listId: string, taskText: string): string {
  const s = taskText.trim();
  if (listId === SYS_LIST_TESTS) return `Study ${s}`;
  if (listId === SYS_LIST_PROJECTS || listId === SYS_LIST_LONGTERM) {
    return `Work on ${s}`;
  }
  return s;
}

/** Smart picks for the Today view “Focus for today” strip (Tests / Projects / Long-Term). */
type FocusForTodayPick = {
  listId: string;
  taskId: number;
  daysLeft: number;
  displayTitle: string;
  timeLabel: string;
  urgency: "overdue" | "critical" | "soon" | "steady";
};

const FOCUS_FOR_TODAY_LIST_RANK = new Map<string, number>([
  [SYS_LIST_INBOX, 0],
  [SYS_LIST_TESTS, 0],
  [SYS_LIST_PROJECTS, 1],
  [SYS_LIST_LONGTERM, 2],
]);

function formatFocusTimeRemaining(daysLeft: number): string {
  if (daysLeft < 0) {
    const n = Math.abs(daysLeft);
    return n === 1 ? "1 day overdue" : `${n} days overdue`;
  }
  if (daysLeft === 0) return "Due today";
  if (daysLeft === 1) return "1 day left";
  return `${daysLeft} days left`;
}

function focusUrgencyFromDays(daysLeft: number): FocusForTodayPick["urgency"] {
  if (daysLeft < 0) return "overdue";
  if (daysLeft === 0) return "critical";
  if (daysLeft <= 2) return "soon";
  return "steady";
}

function buildFocusForTodayPicks(
  tasksByListId: Record<string, Task[]>,
  todayIso: string,
): FocusForTodayPick[] {
  const overduePicks: FocusForTodayPick[] = [];
  for (const t of tasksByListId[SYS_LIST_OVERDUE] ?? []) {
    if (t.completed || t.removing || !t.dueDate) continue;
    const daysLeft = calendarDaysUntilDue(todayIso, t.dueDate);
    if (daysLeft >= 0) continue;
    const raw = (t.text || "").trim() || "Untitled";
    overduePicks.push({
      listId: SYS_LIST_OVERDUE,
      taskId: t.id,
      daysLeft,
      displayTitle: raw,
      timeLabel: formatFocusTimeRemaining(daysLeft),
      urgency: "overdue",
    });
  }
  overduePicks.sort((a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return a.displayTitle.localeCompare(b.displayTitle);
  });

  const todayListPicks: FocusForTodayPick[] = [];
  for (const t of tasksByListId[SYS_LIST_TODAY] ?? []) {
    if (t.completed || t.removing) continue;
    const daysLeft = t.dueDate
      ? calendarDaysUntilDue(todayIso, t.dueDate)
      : 0;
    const raw = (t.text || "").trim() || "Untitled";
    todayListPicks.push({
      listId: SYS_LIST_TODAY,
      taskId: t.id,
      daysLeft,
      displayTitle: raw,
      timeLabel: formatFocusTimeRemaining(daysLeft),
      urgency: focusUrgencyFromDays(daysLeft),
    });
  }
  for (const t of tasksByListId[SYS_LIST_INBOX] ?? []) {
    if (t.completed || t.removing) continue;
    const daysLeft = t.dueDate
      ? calendarDaysUntilDue(todayIso, t.dueDate)
      : 0;
    const raw = (t.text || "").trim() || "Untitled";
    todayListPicks.push({
      listId: SYS_LIST_INBOX,
      taskId: t.id,
      daysLeft,
      displayTitle: raw,
      timeLabel: formatFocusTimeRemaining(daysLeft),
      urgency: focusUrgencyFromDays(daysLeft),
    });
  }
  todayListPicks.sort((a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return a.displayTitle.localeCompare(b.displayTitle);
  });

  const bigCandidates: FocusForTodayPick[] = [];
  for (const listId of [
    SYS_LIST_TESTS,
    SYS_LIST_PROJECTS,
    SYS_LIST_LONGTERM,
  ] as const) {
    for (const t of tasksByListId[listId] ?? []) {
      if (t.completed || t.removing || !t.dueDate) continue;
      const daysLeft = calendarDaysUntilDue(todayIso, t.dueDate);
      const raw = (t.text || "").trim() || "Untitled";
      bigCandidates.push({
        listId,
        taskId: t.id,
        daysLeft,
        displayTitle: getFocusSessionDisplayLabel(listId, raw),
        timeLabel: formatFocusTimeRemaining(daysLeft),
        urgency: focusUrgencyFromDays(daysLeft),
      });
    }
  }

  const dueTodayBig = bigCandidates.filter((x) => x.daysLeft === 0);
  const otherBig = bigCandidates.filter((x) => x.daysLeft !== 0);
  otherBig.sort((a, b) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    const ra = FOCUS_FOR_TODAY_LIST_RANK.get(a.listId) ?? 9;
    const rb = FOCUS_FOR_TODAY_LIST_RANK.get(b.listId) ?? 9;
    return ra - rb || a.displayTitle.localeCompare(b.displayTitle);
  });
  dueTodayBig.sort((a, b) => {
    const ra = FOCUS_FOR_TODAY_LIST_RANK.get(a.listId) ?? 9;
    const rb = FOCUS_FOR_TODAY_LIST_RANK.get(b.listId) ?? 9;
    return ra - rb || a.displayTitle.localeCompare(b.displayTitle);
  });

  let bigPicks: FocusForTodayPick[];
  if (dueTodayBig.length > 0) {
    bigPicks = [...dueTodayBig, ...otherBig.slice(0, 2)];
  } else {
    bigPicks = otherBig.slice(0, 2);
  }

  return [...overduePicks, ...todayListPicks, ...bigPicks];
}

const ESTIMATE_PATTERNS_KEY = "tunnelvision_estimate_patterns_v1";
const ESTIMATE_SESSION_ACTIONS_KEY = "tunnelvision_estimate_session_actions_v1";

type EstimatePatternRow = { sum: number; count: number };

function loadEstimatePatterns(): Record<string, EstimatePatternRow> {
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

function saveEstimatePatterns(p: Record<string, EstimatePatternRow>) {
  try {
    localStorage.setItem(ESTIMATE_PATTERNS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

function normalizeEstimateKeyword(text: string): string {
  return text.trim().toLowerCase().slice(0, 80);
}

function recordEstimatePattern(keyword: string, minutes: number) {
  if (!keyword) return;
  const p = loadEstimatePatterns();
  const row = p[keyword] ?? { sum: 0, count: 0 };
  row.sum += minutes;
  row.count += 1;
  p[keyword] = row;
  saveEstimatePatterns(p);
}

function isVagueTaskTitle(raw: string): boolean {
  const t = raw.trim().toLowerCase();
  if (t.length < 2) return false;
  if (/^(study|test|read|write|work|review|prep)$/.test(t)) return true;
  if (/^work on (project|this|it|stuff|things?)$/.test(t)) return true;
  if (/^work on\s+\w+$/.test(t) && t.split(/\s+/).length <= 3) return true;
  return false;
}

/** Internal: task could use a quick estimate (no modal). */
function taskNeedsEstimate(task: Task | undefined, listId: string): boolean {
  if (!task || task.completed || task.removing) return false;
  if (task.estimatePromptDismissed) return false;
  if (task.estimatedMinutes != null && task.estimatedMinutes > 0) return false;
  const raw = (task.text || "").trim();
  if (!raw) return false;
  if (isVagueTaskTitle(raw)) return true;
  if (listId === SYS_LIST_PROJECTS || listId === SYS_LIST_LONGTERM) {
    const words = raw.split(/\s+/).length;
    return words <= 4 && raw.length <= 36;
  }
  return false;
}

function getTaskForPick(
  tasksByListId: Record<string, Task[]>,
  pick: FocusForTodayPick,
): Task | undefined {
  return (tasksByListId[pick.listId] ?? []).find((t) => t.id === pick.taskId);
}

function estimateMinutesForSort(task: Task | undefined): number | null {
  const m = task?.estimatedMinutes;
  if (m == null || m <= 0) return null;
  return m;
}

/**
 * Soft tie-break only: same segment + same primary sort keys → shorter estimate first.
 * Does not change which tasks are selected (buildFocusForTodayPicks is unchanged).
 */
function applySoftEstimateReorder(
  picks: FocusForTodayPick[],
  tasksByListId: Record<string, Task[]>,
): FocusForTodayPick[] {
  if (picks.length === 0) return picks;
  const overdue = picks.filter((p) => p.listId === SYS_LIST_OVERDUE);
  const today = picks.filter((p) => p.listId === SYS_LIST_TODAY);
  const big = picks.filter((p) =>
    [SYS_LIST_TESTS, SYS_LIST_PROJECTS, SYS_LIST_LONGTERM].includes(p.listId),
  );
  const tieEst = (a: FocusForTodayPick, b: FocusForTodayPick) => {
    const ea = estimateMinutesForSort(getTaskForPick(tasksByListId, a));
    const eb = estimateMinutesForSort(getTaskForPick(tasksByListId, b));
    if (ea != null && eb != null && ea !== eb) return ea - eb;
    if (ea != null && eb == null) return -1;
    if (ea == null && eb != null) return 1;
    return a.displayTitle.localeCompare(b.displayTitle);
  };
  const sortOverdue = (a: FocusForTodayPick, b: FocusForTodayPick) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    return tieEst(a, b);
  };
  const sortToday = sortOverdue;
  const sortBig = (a: FocusForTodayPick, b: FocusForTodayPick) => {
    if (a.daysLeft !== b.daysLeft) return a.daysLeft - b.daysLeft;
    const ra = FOCUS_FOR_TODAY_LIST_RANK.get(a.listId) ?? 9;
    const rb = FOCUS_FOR_TODAY_LIST_RANK.get(b.listId) ?? 9;
    if (ra !== rb) return ra - rb;
    return tieEst(a, b);
  };
  return [
    ...[...overdue].sort(sortOverdue),
    ...[...today].sort(sortToday),
    ...[...big].sort(sortBig),
  ];
}

function formatMinutesLabel(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function formatFocusTimeLine(
  pick: FocusForTodayPick,
  task: Task | undefined,
): string {
  const base = pick.timeLabel;
  const m = task?.estimatedMinutes;
  if (m != null && m > 0) return `${base} • ${formatMinutesLabel(m)}`;
  return base;
}

function focusForTodayRowVisuals(
  urgency: FocusForTodayPick["urgency"],
): { bar: string } {
  switch (urgency) {
    case "overdue":
      return { bar: "bg-red-100" };
    case "critical":
      return { bar: "bg-red-50" };
    case "soon":
      return { bar: "bg-amber-50" };
    default:
      return { bar: "bg-[#F8FAFC]" };
  }
}

/** Due-date reminders (Tests / Projects / Long-Term) + overdue (Overdue list). */
type AppNotificationItem = {
  id: string;
  type: "test" | "project" | "longterm" | "overdue";
  title: string;
  dueDate: string;
  message: string;
  daysRemaining: number;
  read: boolean;
};

const NOTIFICATION_READS_STORAGE_KEY = "tunnelvision_notification_reads_v1";
const CAL_DAY_MS = 24 * 60 * 60 * 1000;

function calendarDaysUntilDue(todayIso: string, dueIso: string): number {
  const a = parseISODate(todayIso);
  const b = parseISODate(dueIso);
  a.setHours(0, 0, 0, 0);
  b.setHours(0, 0, 0, 0);
  return Math.round((b.getTime() - a.getTime()) / CAL_DAY_MS);
}

function loadNotificationReadIds(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = localStorage.getItem(NOTIFICATION_READS_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as string[];
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function formatOverdueNotificationAgo(daysUntil: number): string {
  const n = Math.abs(daysUntil);
  if (n === 1) return "yesterday";
  return `${n} days ago`;
}

function buildOverdueNotifications(
  tasksByListId: Record<string, Task[]>,
  todayIso: string,
): Omit<AppNotificationItem, "read">[] {
  const out: Omit<AppNotificationItem, "read">[] = [];
  for (const t of tasksByListId[SYS_LIST_OVERDUE] ?? []) {
    if (t.completed || t.removing || !t.dueDate) continue;
    const days = calendarDaysUntilDue(todayIso, t.dueDate);
    if (days >= 0) continue;
    const title = (t.text || "").trim() || "Untitled";
    const ago = formatOverdueNotificationAgo(days);
    out.push({
      id: `notif:overdue:${t.id}:${todayIso}`,
      type: "overdue",
      title,
      dueDate: t.dueDate,
      message: `URGENT❗${title} was due ${ago}.`,
      daysRemaining: days,
    });
  }
  out.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title),
  );
  return out;
}

function buildDueDateNotifications(
  tasksByListId: Record<string, Task[]>,
  todayIso: string,
): Omit<AppNotificationItem, "read">[] {
  const out: Omit<AppNotificationItem, "read">[] = [];
  const configs: {
    listId: string;
    type: "test" | "project" | "longterm";
    maxDays: number;
  }[] = [
    { listId: SYS_LIST_TESTS, type: "test", maxDays: 3 },
    { listId: SYS_LIST_PROJECTS, type: "project", maxDays: 3 },
    { listId: SYS_LIST_LONGTERM, type: "longterm", maxDays: 7 },
  ];
  for (const { listId, type, maxDays } of configs) {
    const tasks = tasksByListId[listId] ?? [];
    for (const t of tasks) {
      if (t.completed || t.removing || !t.dueDate) continue;
      const days = calendarDaysUntilDue(todayIso, t.dueDate);
      if (days < 0 || days > maxDays) continue;
      if (type !== "longterm" && days === 3) continue;
      const title = (t.text || "").trim() || "Untitled";
      const message =
        days === 0
          ? `⏳ ACTION REQUIRED ${title} is due today.`
          : `⚠️ Upcoming Deadline ${title} is approaching. Plan your work today.`;
      out.push({
        id: `notif:${listId}:${t.id}:${todayIso}`,
        type,
        title,
        dueDate: t.dueDate,
        message,
        daysRemaining: days,
      });
    }
  }
  out.sort(
    (a, b) =>
      a.dueDate.localeCompare(b.dueDate) || a.title.localeCompare(b.title),
  );
  return out;
}

function buildAllNotificationPayloads(
  tasksByListId: Record<string, Task[]>,
  todayIso: string,
): Omit<AppNotificationItem, "read">[] {
  return [
    ...buildOverdueNotifications(tasksByListId, todayIso),
    ...buildDueDateNotifications(tasksByListId, todayIso),
  ];
}

function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(iso: string): Date {
  const [yy, mm, dd] = iso.split("-").map((x) => parseInt(x, 10));
  return new Date(yy, mm - 1, dd);
}

function formatDueButtonLabel(iso: string): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/** Overdue row: “Yesterday” when due was calendar yesterday, else short date */
function formatOverdueRowDue(iso: string, now = new Date()): string {
  const due = parseISODate(iso);
  const todayStart = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const yesterdayStart = new Date(todayStart);
  yesterdayStart.setDate(yesterdayStart.getDate() - 1);
  const dueStart = new Date(
    due.getFullYear(),
    due.getMonth(),
    due.getDate(),
  );
  if (dueStart.getTime() === yesterdayStart.getTime()) return "Yesterday";
  return due.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function migrateOverdueTasks(
  prev: Record<string, Task[]>,
  today: string,
): Record<string, Task[]> {
  const next: Record<string, Task[]> = { ...prev };
  const overdueIds = new Set((next[SYS_LIST_OVERDUE] ?? []).map((t) => t.id));
  let overdue = [...(next[SYS_LIST_OVERDUE] ?? [])];
  let changed = false;

  for (const listId of OVERDUE_SOURCE_LIST_IDS) {
    const cur = [...(next[listId] ?? [])];
    const stay: Task[] = [];
    for (const t of cur) {
      if (!t.completed && t.dueDate && t.dueDate < today) {
        if (!overdueIds.has(t.id)) {
          overdue.push(t);
          overdueIds.add(t.id);
          changed = true;
        }
      } else {
        stay.push(t);
      }
    }
    if (stay.length !== cur.length) {
      changed = true;
      next[listId] = stay;
    }
  }

  const prevOd = prev[SYS_LIST_OVERDUE] ?? [];
  if (overdue.length !== prevOd.length) changed = true;
  next[SYS_LIST_OVERDUE] = overdue;

  if (!changed) return prev;
  return next;
}

type MiniDueDatePopoverProps = {
  open: boolean;
  anchor: DOMRect | null;
  selectedIso: string | null;
  onSelect: (iso: string) => void;
  onClose: () => void;
};

function MiniDueDatePopover({
  open,
  anchor,
  selectedIso,
  onSelect,
  onClose,
}: MiniDueDatePopoverProps) {
  const [cursor, setCursor] = useState(() => {
    const d = selectedIso ? parseISODate(selectedIso) : new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });

  useEffect(() => {
    if (!open) return;
    const d = selectedIso ? parseISODate(selectedIso) : new Date();
    setCursor(new Date(d.getFullYear(), d.getMonth(), 1));
  }, [open, selectedIso]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = document.getElementById("mini-due-date-popover");
      if (el && !el.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  if (!open || !anchor) return null;

  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const todayIso = toISODate(new Date());
  const top = Math.min(anchor.bottom + 6, window.innerHeight - 300);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 276));

  const monthLabel = cursor.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });

  const shiftMonth = (delta: number) => {
    setCursor((c) => new Date(c.getFullYear(), c.getMonth() + delta, 1));
  };

  return (
    <div
      id="mini-due-date-popover"
      className="fixed w-[268px] rounded-lg border border-[#E5E7EB] bg-white shadow-sm p-3 z-[500]"
      style={{ top, left }}
      role="dialog"
      aria-label="Choose due date"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="w-8 h-8 rounded-lg text-[#6B7280] hover:text-[#111827] hover:bg-[#F8FAFC] text-sm"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-[13px] font-semibold text-[#111827] tabular-nums">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="w-8 h-8 rounded-lg text-[#6B7280] hover:text-[#111827] hover:bg-[#F8FAFC] text-sm"
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[10px] font-medium text-[#6B7280] uppercase tracking-wide mb-1">
        {["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map((d) => (
          <div key={d}>{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (d == null) {
            return <div key={`e-${i}`} className="h-8" />;
          }
          const iso = toISODate(new Date(year, month, d));
          const isSelected = selectedIso === iso;
          const isToday = iso === todayIso;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelect(iso)}
              className={`h-8 rounded-lg text-[12px] font-medium transition-colors ${
                isSelected
                  ? "bg-[#6366F1] text-white"
                  : isToday
                    ? "text-[#6366F1] hover:bg-[#F8FAFC]"
                    : "text-[#111827] hover:bg-[#F8FAFC]"
              }`}
            >
              {d}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function taskInputPlaceholder(listId: string | null): string {
  if (!listId) return "Select a list to add tasks";
  if (listId === SYS_LIST_PROJECTS) return "Add project";
  if (listId === SYS_LIST_TESTS) return "Add test";
  if (listId === SYS_LIST_LONGTERM) return "Add long-term assignment";
  if (listId === SYS_LIST_INBOX) return "Add task";
  return "Add task";
}

function listEmptyHeadline(listId: string, isUserList: boolean): string {
  if (listId === SYS_LIST_INBOX) return "No tasks";
  if (listId === SYS_LIST_TODAY) return "No tasks";
  if (listId === SYS_LIST_PROJECTS) return "No projects";
  if (listId === SYS_LIST_TESTS) return "No Tests";
  if (listId === SYS_LIST_LONGTERM) return "No Long-Term Assignments";
  if (isUserList) return "No Items";
  return "No tasks";
}

/** Shared checklist-style illustration for system lists (not Overdue). */
function DefaultTasksEmptyIllustration() {
  return (
    <div className="relative w-[220px] h-[150px] mb-6">
      <div
        className="absolute inset-0 rounded-lg opacity-95"
        style={{
          background: "#F8FAFC",
        }}
      />
      <svg
        className="relative z-[1] w-full h-full drop-shadow-md"
        viewBox="0 0 220 150"
        fill="none"
        aria-hidden
      >
        <rect
          x="44"
          y="36"
          width="88"
          height="102"
          rx="8"
          fill="#e4e4e7"
          opacity="0.95"
        />
        <rect x="52" y="48" width="72" height="8" rx="2" fill="#d4d4d8" />
        <circle
          cx="62"
          cy="72"
          r="7"
          stroke="#22c55e"
          strokeWidth="2.5"
          fill="none"
        />
        <path
          d="M58 72 L61 76 L68 68"
          stroke="#22c55e"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line
          x1="78"
          y1="72"
          x2="112"
          y2="70"
          stroke="#a1a1aa"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <rect
          x="56"
          y="88"
          width="10"
          height="10"
          rx="2"
          stroke="#a1a1aa"
          strokeWidth="1.5"
        />
        <line
          x1="74"
          y1="90"
          x2="108"
          y2="88"
          stroke="#d4d4d8"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <line
          x1="74"
          y1="98"
          x2="96"
          y2="97"
          stroke="#d4d4d8"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M138 42 C168 52 178 88 152 108"
          stroke="#6366f1"
          strokeWidth="2.5"
          strokeLinecap="round"
          fill="none"
          opacity="0.85"
        />
        <polygon
          points="154,38 162,48 152,52 144,46"
          fill="#818cf8"
          opacity="0.9"
        />
        <rect
          x="158"
          y="64"
          width="36"
          height="48"
          rx="4"
          fill="#4f46e5"
          opacity="0.9"
        />
        <rect x="166" y="72" width="20" height="3" rx="1" fill="#c7d2fe" />
        <rect
          x="166"
          y="80"
          width="14"
          height="3"
          rx="1"
          fill="#a5b4fc"
          opacity="0.8"
        />
        <path
          d="M32 58 L36 52 L40 58"
          stroke="#71717a"
          strokeWidth="1.5"
          strokeLinecap="round"
          fill="none"
        />
        <path
          d="M178 118 L182 124 L186 118"
          stroke="#52525b"
          strokeWidth="1.2"
          fill="none"
        />
      </svg>
    </div>
  );
}

/** Modern “dog ate the homework” empty state for Overdue. */
function DogHomeworkOverdueIllustration() {
  return (
    <div className="w-[240px] h-[168px] mb-8 flex items-center justify-center">
      <svg
        viewBox="0 0 240 168"
        className="w-full h-full max-w-[240px]"
        fill="none"
        aria-hidden
      >
        <ellipse cx="120" cy="152" rx="72" ry="8" fill="#27272a" opacity="0.45" />
        <path
          d="M38 128 L52 118 L48 132 Z"
          fill="#3f3f46"
          stroke="#52525b"
          strokeWidth="1"
        />
        <rect
          x="40"
          y="122"
          width="28"
          height="18"
          rx="2"
          transform="rotate(-18 54 131)"
          fill="#d4d4d8"
          stroke="#a1a1aa"
          strokeWidth="1"
        />
        <line
          x1="46"
          y1="128"
          x2="62"
          y2="130"
          stroke="#71717a"
          strokeWidth="1"
        />
        <rect
          x="168"
          y="124"
          width="32"
          height="20"
          rx="2"
          transform="rotate(14 184 134)"
          fill="#e4e4e7"
          stroke="#a1a1aa"
          strokeWidth="1"
        />
        <path
          d="M174 130h16M176 134h12"
          stroke="#71717a"
          strokeWidth="1"
          strokeLinecap="round"
        />
        <ellipse cx="118" cy="108" rx="38" ry="24" fill="#52525b" />
        <ellipse cx="108" cy="102" rx="22" ry="20" fill="#71717a" />
        <ellipse cx="98" cy="98" rx="8" ry="9" fill="#3f3f46" />
        <circle cx="92" cy="94" r="2.5" fill="#18181b" />
        <circle cx="100" cy="92" r="2.5" fill="#18181b" />
        <path
          d="M88 104 Q96 108 104 104"
          stroke="#3f3f46"
          strokeWidth="1.5"
          strokeLinecap="round"
        />
        <ellipse cx="132" cy="100" rx="14" ry="10" fill="#d4d4d8" />
        <rect
          x="124"
          y="94"
          width="20"
          height="14"
          rx="1.5"
          fill="#f4f4f5"
          stroke="#a1a1aa"
          strokeWidth="0.8"
        />
        <line
          x1="128"
          y1="98"
          x2="140"
          y2="98"
          stroke="#d4d4d8"
          strokeWidth="1"
        />
        <line
          x1="128"
          y1="102"
          x2="136"
          y2="102"
          stroke="#d4d4d8"
          strokeWidth="1"
        />
        <path
          d="M78 108 Q70 96 82 88 Q90 82 100 88"
          stroke="#52525b"
          strokeWidth="3"
          strokeLinecap="round"
        />
        <ellipse cx="142" cy="118" rx="10" ry="6" fill="#52525b" />
        <path
          d="M150 112 L168 98 L172 108 L154 118 Z"
          fill="#52525b"
        />
      </svg>
    </div>
  );
}

type CalendarPlacedTask = {
  id: number;
  text: string;
  listId: string;
  /** List name for display (e.g. Tests, Today). */
  categoryLabel: string;
};

const CALENDAR_TASKS_VISIBLE_CAP = 4;

/** Solid category fills (month view) — flat opaque colors, no gradient overlay. */
function calendarTaskChipClassForList(listId: string): string {
  const base =
    "w-full text-left rounded-[3px] px-2 py-1.5 min-w-0 border transition-colors duration-150 active:scale-[0.99] [background-image:none]";
  const byList: Record<string, string> = {
    [SYS_LIST_OVERDUE]:
      "!border-[#7a3040] !bg-[#4a1c26] hover:!bg-[#5c2430]",
    [SYS_LIST_TODAY]:
      "!border-[#556987] !bg-[#3d4a63] hover:!bg-[#465673]",
    [SYS_LIST_PROJECTS]:
      "!border-[#9a7828] !bg-[#6b4a18] hover:!bg-[#7d5520]",
    [SYS_LIST_TESTS]:
      "!border-[#3d7a7a] !bg-[#1f4d4d] hover:!bg-[#265c5c]",
    [SYS_LIST_LONGTERM]:
      "!border-[#6b5a8a] !bg-[#3f3658] hover:!bg-[#4a4065]",
  };
  return `${base} ${byList[listId] ?? "!border-[#5c5c66] !bg-[#3f3f46] hover:!bg-[#52525b]"}`;
}

type CalendarGridCell =
  | { kind: "outside"; key: string; displayDay: number }
  | { kind: "inside"; key: string; iso: string; day: number };

function TasksDueCalendarMonth({
  monthStart,
  tasksByDate,
  todayIso,
  onPrevMonth,
  onNextMonth,
  onTodayMonth,
  onTaskPick,
}: {
  monthStart: Date;
  tasksByDate: Record<string, CalendarPlacedTask[]>;
  todayIso: string;
  onPrevMonth: () => void;
  onNextMonth: () => void;
  onTodayMonth: () => void;
  onTaskPick: (listId: string, taskId: number) => void;
}) {
  const y = monthStart.getFullYear();
  const m = monthStart.getMonth();
  const firstDow = new Date(y, m, 1).getDay();
  const daysInMonth = new Date(y, m + 1, 0).getDate();
  const daysInPrevMonth = new Date(y, m, 0).getDate();

  const cells: CalendarGridCell[] = [];
  for (let i = 0; i < firstDow; i++) {
    const displayDay = daysInPrevMonth - firstDow + 1 + i;
    cells.push({ kind: "outside", key: `pre-${y}-${m}-${i}`, displayDay });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({
      kind: "inside",
      key: toISODate(new Date(y, m, d)),
      iso: toISODate(new Date(y, m, d)),
      day: d,
    });
  }
  let post = 0;
  while (cells.length % 7 !== 0) {
    cells.push({
      kind: "outside",
      key: `post-${y}-${m}-${post}`,
      displayDay: post + 1,
    });
    post += 1;
  }

  const rowCount = cells.length / 7;

  const monthTitle = monthStart.toLocaleDateString("en-US", {
    month: "long",
  });
  const yearTitle = monthStart.toLocaleDateString("en-US", {
    year: "numeric",
  });

  return (
    <div className="flex flex-col flex-1 min-h-0 w-full h-full bg-white antialiased [text-rendering:optimizeLegibility]">
      <header className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 pt-3.5 pb-3 border-b border-[#E5E7EB]">
        <div className="min-w-0 flex items-baseline gap-2.5 flex-wrap">
          <h2 className="text-xl sm:text-2xl font-semibold text-[#111827] tracking-[-0.02em] tabular-nums">
            {monthTitle}
          </h2>
          <span className="text-lg sm:text-xl font-medium text-[#6B7280] tabular-nums">
            {yearTitle}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onTodayMonth}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-[#111827] bg-white border border-[#E5E7EB] hover:bg-[#F8FAFC] transition-all duration-150 active:scale-[0.98]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onPrevMonth}
            className="w-9 h-9 rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111827] hover:bg-[#F8FAFC] text-lg leading-none transition-all duration-150 flex items-center justify-center active:scale-[0.97]"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="w-9 h-9 rounded-lg border border-[#E5E7EB] bg-white text-[#6B7280] hover:text-[#111827] hover:bg-[#F8FAFC] text-lg leading-none transition-all duration-150 flex items-center justify-center active:scale-[0.97]"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="grid grid-cols-7 shrink-0 border-b border-[#E5E7EB] bg-[#F8FAFC]">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((wd) => (
            <div
              key={wd}
              className="py-2 text-center text-[11px] font-medium text-[#6B7280] tracking-tight"
            >
              {wd}
            </div>
          ))}
        </div>

        <div
          className="flex-1 min-h-0 grid grid-cols-7 gap-px bg-[#E5E7EB]"
          style={{
            gridTemplateRows: `repeat(${rowCount}, minmax(80px, 1fr))`,
          }}
        >
          {cells.map((cell) => {
            if (cell.kind === "outside") {
              return (
                <div
                  key={cell.key}
                  className="bg-[#F8FAFC] min-h-[100px] p-1.5 flex flex-col min-w-0"
                  aria-hidden
                >
                  <div className="text-[11px] font-medium tabular-nums text-[#D1D5DB] mb-1 shrink-0">
                    {cell.displayDay}
                  </div>
                </div>
              );
            }

            const dayTasks = tasksByDate[cell.iso] ?? [];
            const visible = dayTasks.slice(0, CALENDAR_TASKS_VISIBLE_CAP);
            const more = dayTasks.length - visible.length;
            const isToday = cell.iso === todayIso;
            const dayLabel =
              cell.day === 1
                ? monthStart.toLocaleDateString("en-US", {
                    month: "short",
                    day: "numeric",
                  })
                : String(cell.day);

            return (
              <div
                key={cell.key}
                className={`relative bg-white min-h-[100px] p-1.5 flex flex-col min-w-0 ${
                  isToday
                    ? "ring-1 ring-inset ring-[#6366F1]/30 bg-[#EEF2FF]"
                    : ""
                }`}
              >
                <div className="mb-1 shrink-0">
                  {isToday ? (
                    <span
                      className="inline-flex min-w-[1.75rem] h-7 px-1.5 items-center justify-center rounded-full bg-[#6366F1] text-[11px] font-semibold text-white tabular-nums"
                      title="Today"
                    >
                      {cell.day}
                    </span>
                  ) : (
                    <span className="inline-flex text-[11px] font-semibold tabular-nums text-[#6B7280] pl-0.5">
                      {dayLabel}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:rgba(209,213,219,0.6)_transparent]">
                  {visible.map((t) => (
                    <button
                      key={`${t.listId}-${t.id}`}
                      type="button"
                      onClick={() => onTaskPick(t.listId, t.id)}
                      className={calendarTaskChipClassForList(t.listId)}
                      title={`${t.categoryLabel} — ${t.text}`}
                    >
                      <span className="flex items-baseline gap-1 min-w-0 w-full">
                        <span className="shrink-0 max-w-[42%] truncate text-[10px] font-semibold text-[#6B7280] leading-tight">
                          {t.categoryLabel}
                        </span>
                        <span
                          className="shrink-0 text-[11px] text-[#D1D5DB] font-light select-none"
                          aria-hidden
                        >
                          ·
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-[#111827] leading-snug">
                          {t.text}
                        </span>
                      </span>
                    </button>
                  ))}
                  {more > 0 ? (
                    <div className="text-[10px] font-medium text-[#6B7280] pl-0.5 pt-0.5 tracking-tight">
                      +{more} more
                    </div>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

type HistoryPoint = { value: number; date: string };
type HistoryData = { [taskName: string]: HistoryPoint[] };

/** Canonical key for task speed graphs (case-insensitive, trimmed). */
function normalizeTaskKey(text: string): string {
  return text.trim().toLowerCase();
}

/** Title-style label for displaying normalized task keys in analytics. */
function formatTaskTitleForGraph(key: string): string {
  const t = key.trim();
  if (!t) return "";
  return t
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/** Merge task history keys that differ only by capitalization/whitespace. */
function mergeTaskHistoryByNormalizedKeys(
  raw: Record<string, HistoryPoint[]>,
): Record<string, HistoryPoint[]> {
  const out: Record<string, HistoryPoint[]> = {};
  for (const [k, points] of Object.entries(raw)) {
    if (!Array.isArray(points)) continue;
    const nk = normalizeTaskKey(k);
    out[nk] = [...(out[nk] || []), ...points];
  }
  for (const nk of Object.keys(out)) {
    out[nk].sort((a, b) => a.date.localeCompare(b.date));
  }
  return out;
}

/** Unified log for Completed view (list check-offs + focus session completes) */
type CompletedActivityEntry = {
  id: string;
  taskName: string;
  dateStr: string;
  minutes: number;
  listId: string | null;
  listLabel: string;
};

const TT_MAIN_GREY = "#F8FAFC";
const TT_INPUT_ROW = "#FFFFFF";
const TT_ACCENT_BLUE = "#6366F1";

/** Swatches for new lists (matches TickTick-style picker); `null` = no accent color */
const LIST_COLOR_SWATCHES: (string | null)[] = [
  null,
  "#eab308",
  "#f97316",
  "#ef4444",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
  "#14b8a6",
  "#64748b",
];

function listAccentDotClass(color: string | null) {
  if (!color)
    return "border border-[#E5E7EB] bg-[#F8FAFC]";
  return "";
}

/** Monochrome outline icons for system task categories (TickTick-style nav). */
function TaskSystemNavIcon({
  listId,
  className,
  dayOfMonth,
}: {
  listId: string;
  className?: string;
  dayOfMonth?: number;
}) {
  const day = String(dayOfMonth ?? new Date().getDate());
  const sw = 1.65;
  const base = className ?? "w-[19px] h-[19px] shrink-0";

  if (listId === "sys-overdue") {
    return (
      <svg
        className={base}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <circle cx="12" cy="12" r="7.5" />
        <polyline points="12 8 12 12 15 14" />
      </svg>
    );
  }
  if (listId === "sys-today") {
    return (
      <svg
        className={base}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3.5" y="5" width="17" height="15" rx="2" />
        <path d="M8 3.5v3.5M16 3.5v3.5M3.5 10.5h17" />
        <text
          x="12"
          y="18.25"
          textAnchor="middle"
          fill="currentColor"
          fontSize="9.5"
          fontWeight="600"
          fontFamily="system-ui, -apple-system, BlinkMacSystemFont, sans-serif"
        >
          {day}
        </text>
      </svg>
    );
  }
  if (listId === "sys-projects") {
    return (
      <svg
        className={base}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M4 20h16V9.5a1 1 0 0 0-1-1h-5.5L11 6.5H5a1 1 0 0 0-1 1V20z" />
      </svg>
    );
  }
  if (listId === "sys-tests") {
    return (
      <svg
        className={base}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M9 3.5h6l1 2.5h3a1 1 0 0 1 1 1V20a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h3l1-2.5z" />
        <path d="M9 11.5h6M9 15h6M9 18.5h4" />
      </svg>
    );
  }
  if (listId === "sys-longterm") {
    return (
      <svg
        className={base}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={sw}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <path d="M3.5 10h17M8 3.5v3.5M16 3.5v3.5" />
        <path d="M7 14h10M7 17.5h6" />
      </svg>
    );
  }
  return null;
}

/** Predefined “system” lists — same task behavior as user lists, no delete menu */
type TodayList = {
  id: string;
  label: string;
  icon: string;
  color: string | null;
  system?: boolean;
};

const TASK_CATEGORY_LISTS: TodayList[] = [
  { id: "sys-overdue", label: "Overdue", icon: "", color: null, system: true },
  { id: SYS_LIST_INBOX, label: "Inbox", icon: "", color: null, system: true },
  { id: "sys-today", label: "Today", icon: "", color: null, system: true },
  { id: "sys-projects", label: "Projects", icon: "", color: null, system: true },
  { id: "sys-tests", label: "Tests", icon: "", color: null, system: true },
  { id: "sys-longterm", label: "Long-Term", icon: "", color: null, system: true },
];

/** Sidebar primary list rows (same order as TASK_CATEGORY_LISTS for system lists). */
const SIDEBAR_PRIMARY_LIST_NAV: { id: string; label: string }[] = [
  { id: SYS_LIST_OVERDUE, label: "Overdue" },
  { id: SYS_LIST_TODAY, label: "Today" },
  { id: SYS_LIST_PROJECTS, label: "Projects" },
  { id: SYS_LIST_TESTS, label: "Tests" },
  { id: SYS_LIST_LONGTERM, label: "Long-Term" },
];

const SIDEBAR_RED = "#db4c3f";
/** Wireframe nav icons (Todoist secondary). */
const SIDEBAR_ICON_OUTLINE = "#666666";
/** Todoist-like list icons: muted outline when idle, solid red when active. */
function SidebarPrimaryListIcon({
  listId,
  active,
  className = "h-[18px] w-[18px] shrink-0",
}: {
  listId: string;
  active: boolean;
  className?: string;
}) {
  const stroke = active ? "none" : SIDEBAR_ICON_OUTLINE;
  const sw = active ? 0 : 1.5;
  if (listId === SYS_LIST_INBOX) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        {active ? (
          <path
            fill={SIDEBAR_RED}
            fillRule="evenodd"
            d="M5 3a2 2 0 00-2 2v1h18V5a2 2 0 00-2-2H5zm16 6H3v10a2 2 0 002 2h14a2 2 0 002-2V9z"
            clipRule="evenodd"
          />
        ) : (
          <path
            d="M5 3h14a2 2 0 012 2v1H3V5a2 2 0 012-2zm-2 5h18v10a2 2 0 01-2 2H5a2 2 0 01-2-2V8z"
            stroke={stroke}
            strokeWidth={sw}
            fill="none"
            strokeLinejoin="round"
          />
        )}
      </svg>
    );
  }
  if (listId === SYS_LIST_OVERDUE) {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        {active ? (
          <>
            <circle cx="12" cy="13" r="8" fill={SIDEBAR_RED} />
            <path d="M12 9v4l2.5 1.5" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="12" cy="5" r="1.5" fill="white" />
          </>
        ) : (
          <>
            <circle cx="12" cy="13" r="8" stroke={stroke} strokeWidth={sw} />
            <path d="M12 9v4l2.5 1.5" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
            <circle cx="12" cy="5" r="1.5" stroke={stroke} strokeWidth={sw} />
          </>
        )}
      </svg>
    );
  }
  if (listId === SYS_LIST_TODAY) {
    const dayNum = new Date().getDate();
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        {active ? (
          <>
            <rect x="4" y="4" width="16" height="16" rx="1.5" fill={SIDEBAR_RED} />
            <text
              x="12"
              y="16"
              textAnchor="middle"
              fill="white"
              fontSize="11"
              fontWeight="600"
              fontFamily="Arial, Helvetica, sans-serif"
            >
              {dayNum}
            </text>
          </>
        ) : (
          <>
            <rect x="4" y="5" width="16" height="16" rx="1.5" stroke={stroke} strokeWidth={sw} fill="none" />
            <path d="M8 3v4M16 3v4M4 11h16" stroke={stroke} strokeWidth={sw} />
          </>
        )}
      </svg>
    );
  }
  if (listId === SYS_LIST_PROJECTS) {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        {active ? (
          <path
            fill={SIDEBAR_RED}
            d="M3 7a2 2 0 012-2h5l2 2h7a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V7z"
          />
        ) : (
          <path
            d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"
            stroke={stroke}
            strokeWidth={sw}
            fill="none"
            strokeLinejoin="round"
          />
        )}
      </svg>
    );
  }
  if (listId === SYS_LIST_TESTS) {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        {active ? (
          <path
            fill={SIDEBAR_RED}
            d="M9 2h6v2h4a1 1 0 011 1v15a2 2 0 01-2 2H6a2 2 0 01-2-2V5a1 1 0 011-1h4V2zm1 4v12h4V6h-4zm2-4V4h2V2h-2z"
          />
        ) : (
          <>
            <path
              d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
              stroke={stroke}
              strokeWidth={sw}
              fill="none"
              strokeLinejoin="round"
            />
            <path d="M14 2v6h6M10 12h4M10 16h4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          </>
        )}
      </svg>
    );
  }
  if (listId === SYS_LIST_LONGTERM) {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        {active ? (
          <path
            fill={SIDEBAR_RED}
            d="M6 2h12a2 2 0 012 2v16l-8-4-8 4V4a2 2 0 012-2z"
          />
        ) : (
          <path
            d="M19 21l-7-4-7 4V5a2 2 0 012-2h10a2 2 0 012 2v16z"
            stroke={stroke}
            strokeWidth={sw}
            fill="none"
            strokeLinejoin="round"
          />
        )}
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="10" stroke={SIDEBAR_ICON_OUTLINE} strokeWidth="1.5" />
    </svg>
  );
}

function SidebarSearchIcon({
  active,
  className = "h-5 w-5 shrink-0",
}: {
  active: boolean;
  className?: string;
}) {
  const c = active ? SIDEBAR_RED : SIDEBAR_ICON_OUTLINE;
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="11" cy="11" r="6" stroke={c} strokeWidth="1.5" />
      <path d="M20 20l-4.35-4.35" stroke={c} strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function SidebarCompletedIcon({
  active,
  className = "h-[18px] w-[18px] shrink-0",
}: {
  active: boolean;
  className?: string;
}) {
  const stroke = active ? "none" : SIDEBAR_ICON_OUTLINE;
  const sw = active ? 0 : 1.5;
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {active ? (
        <path
          fill={SIDEBAR_RED}
          d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1.5 14.5l-3.5-3.5 1.41-1.41L10.5 13.17l5.09-5.09L17 9.5l-6.5 6.5z"
        />
      ) : (
        <>
          <circle cx="12" cy="12" r="10" stroke={stroke} strokeWidth={sw} fill="none" />
          <path d="M9 12l2 2 4-4" stroke={stroke} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" />
        </>
      )}
    </svg>
  );
}

const DEFAULT_USER_TODAY_LISTS: TodayList[] = [
  { id: "work", label: "Work", icon: "🗂️", color: "#ef4444" },
  { id: "wishlist", label: "Wishlist", icon: "✨", color: "#c084fc" },
  { id: "shopping", label: "Shopping", icon: "🧾", color: "#e4e4e7" },
  { id: "exercise", label: "Exercise", icon: "🏃‍♂️", color: "#f97316" },
  { id: "packing", label: "Packing list", icon: "✈️", color: "#38bdf8" },
];

const TASKS_BY_LIST_STORAGE_KEY = "tunnelvision_tasks_by_list_v1";
const TODAY_LISTS_STORAGE_KEY = "tunnelvision_user_lists_v1";
const MOTION_PREF_STORAGE_KEY = "tunnelvision_motion_tier_v1";

function TaskListSkeletonRows() { return null; }

function loadTasksByListIdFromStorage(): Record<string, Task[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(TASKS_BY_LIST_STORAGE_KEY);
    if (!raw) return { [SYS_LIST_INBOX]: [] };
    const p = JSON.parse(raw) as Record<string, Task[]>;
    if (!p || typeof p !== "object") return { [SYS_LIST_INBOX]: [] };
    return { ...p, [SYS_LIST_INBOX]: p[SYS_LIST_INBOX] ?? [] };
  } catch {
    return { [SYS_LIST_INBOX]: [] };
  }
}

function hasStoredTasks(): boolean {
  const t = loadTasksByListIdFromStorage();
  return Object.values(t).some((arr) => Array.isArray(arr) && arr.length > 0);
}

function loadTodayListsFromStorage(): TodayList[] {
  if (typeof window === "undefined") return DEFAULT_USER_TODAY_LISTS;
  try {
    const raw = localStorage.getItem(TODAY_LISTS_STORAGE_KEY);
    if (!raw) return DEFAULT_USER_TODAY_LISTS;
    const p = JSON.parse(raw) as TodayList[];
    if (!Array.isArray(p) || p.length === 0) return DEFAULT_USER_TODAY_LISTS;
    return p;
  } catch {
    return DEFAULT_USER_TODAY_LISTS;
  }
}

type DayMetric = {
  date: string;
  focusIntegrity: number;
  tasksCompleted: number;
  totalFocusSeconds: number;
  score: number;
  symbol?: string;
};

/**
 * Main Application Layer
 */
export default function App() {
  /* ------------------- PRIMARY APPLICATION STATE ------------------- */
  const [isSimulation, setIsSimulation] = useState(
    () => typeof window === "undefined" || !hasStoredTasks(),
  );
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [name, setName] = useState("Alex");
  const [seconds, setSeconds] = useState(0);
  const [initialSeconds, setInitialSeconds] = useState(0);
  const secondsRef = useRef(0);
  const initialSecondsRef = useRef(0);
  secondsRef.current = seconds;
  initialSecondsRef.current = initialSeconds;
  const [running, setRunning] = useState(false);
  const [streak, setStreak] = useState(3);
  const [taskInput, setTaskInput] = useState("");
  const [tasksByListId, setTasksByListId] = useState<Record<string, Task[]>>(
    () => loadTasksByListIdFromStorage(),
  );
  const tasksByListIdRef = useRef<Record<string, Task[]>>({});
  tasksByListIdRef.current = tasksByListId;
  const [tasks, setTasks] = useState<Task[]>(() => {
    const tbl = loadTasksByListIdFromStorage();
    return tbl[SYS_LIST_TODAY] ?? [];
  });
  const isSwitchingListRef = useRef(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const selectedTaskIdRef = useRef<number | null>(null);
  selectedTaskIdRef.current = selectedTaskId;
  const tasksRef = useRef<Task[]>([]);
  const [isWorkModeModalOpen, setIsWorkModeModalOpen] = useState(false);
  const [pendingWorkModeTaskId, setPendingWorkModeTaskId] = useState<
    number | null
  >(null);
  const [pendingWorkModeListId, setPendingWorkModeListId] = useState<
    string | null
  >(null);
  /** Sequential work-mode prompts (single add = 1 item; add-all = N items). */
  const workModePromptQueueRef = useRef<
    Array<{ taskId: number; listId: string }>
  >([]);
  const [bestFocusIntegrity, setBestFocusIntegrity] = useState(0);

  const [selectedStat, setSelectedStat] = useState("Integrity");
  const [history, setHistory] = useState<HistoryData>({});
  const [taskHistory, setTaskHistory] = useState<{
    [task: string]: HistoryPoint[];
  }>({});
  const [selectedTaskGraph, setSelectedTaskGraph] = useState<string>("");
  const [analyticsChartHover, setAnalyticsChartHover] = useState<
    number | null
  >(null);
  const [analyticsTaskPickerOpen, setAnalyticsTaskPickerOpen] =
    useState(false);
  const analyticsTaskPickerRef = useRef<HTMLDivElement>(null);

  const [taskViewTab, setTaskViewTab] = useState<"list" | "board" | "calendar">("list");
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [categoryDropdownOpen, setCategoryDropdownOpen] = useState(false);
  const categoryDropdownRef = useRef<HTMLDivElement>(null);

  const [warning, setWarning] = useState<string | null>(null);
  const heroGraphData: HistoryPoint[] = [
    { value: 82, date: "Mon" },
    { value: 91, date: "Tue" },
    { value: 88, date: "Wed" },
    { value: 96, date: "Thu" },
    { value: 93, date: "Fri" },
  ];

  const [contractBroken, setContractBroken] = useState(false);

  /* --- PERFORMANCE & ANALYTICS --- */
  const [floatingTime, setFloatingTime] = useState<{
    text: string;
    id: number;
  } | null>(null);
  const [timerSessionStart, setTimerSessionStart] = useState<number | null>(
    null,
  );
  const [lastTaskCompletionTime, setLastTaskCompletionTime] = useState<
    number | null
  >(null);
  const [isVictory, setIsVictory] = useState(false);
  const [reflectionPrompt, setReflectionPrompt] = useState<string | null>(null);
  const [reflectionText, setReflectionText] = useState("");
  const [scrollY, setScrollY] = useState(0);

  const focusSessionTasksCompletedRef = useRef(0);
  const taskDoneToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const completionAnimTimersRef = useRef<number[]>([]);
  const focusFinaleSnapshotRef = useRef<{
    integrity: number;
    elapsedSecs: number;
    tasksDone: number;
  } | null>(null);

  const [taskCheckAnimatingId, setTaskCheckAnimatingId] = useState<
    number | null
  >(null);
  const [taskRowExitingId, setTaskRowExitingId] = useState<number | null>(
    null,
  );
  const [taskReappearId, setTaskReappearId] = useState<number | null>(null);
  const [taskDoneToast, setTaskDoneToast] = useState<null | {
    taskId: number;
    taskText: string;
    listId: string;
  }>(null);

  const [focusFinaleOpen, setFocusFinaleOpen] = useState(false);
  const [focusFinaleModalOpen, setFocusFinaleModalOpen] = useState(false);
  const [focusFinalePhase, setFocusFinalePhase] = useState<1 | 2 | 3>(1);
  const [focusFinaleSnapshot, setFocusFinaleSnapshot] = useState<{
    integrity: number;
    elapsedSecs: number;
    tasksDone: number;
  } | null>(null);

  /* --- Micro-interactions (Parts 1–4): task input, focus immersion, progress, nav --- */
  const taskListInputRef = useRef<HTMLInputElement | null>(null);
  const taskSearchInputRef = useRef<HTMLInputElement | null>(null);
  const focusSessionTaskInputRef = useRef<HTMLInputElement | null>(null);
  const [taskInputShellPress, setTaskInputShellPress] = useState(false);
  const [taskInputClearFlash, setTaskInputClearFlash] = useState(false);
  const [newListTaskAnimId, setNewListTaskAnimId] = useState<number | null>(
    null,
  );
  const [listEmptyExit, setListEmptyExit] = useState(false);
  const [listFirstTaskEnter, setListFirstTaskEnter] = useState(false);
  const [mainViewEnterAnim, setMainViewEnterAnim] = useState(false);
  const [focusImmerseIntro, setFocusImmerseIntro] = useState(false);
  const [focusRootShake, setFocusRootShake] = useState(false);
  const [stayLockedHint, setStayLockedHint] = useState(false);
  const [focusTimerNudge, setFocusTimerNudge] = useState(false);
  const [streakMicro, setStreakMicro] = useState<null | "up" | "down">(null);
  const streakPrevRef = useRef(streak);
  const [focusSessionNewRowId, setFocusSessionNewRowId] = useState<
    number | null
  >(null);

  const [tasksListSkeletonVisible, setTasksListSkeletonVisible] =
    useState(false);
  const [invalidInputTarget, setInvalidInputTarget] = useState<
    null | "list" | "focus"
  >(null);
  const [deleteUndoToast, setDeleteUndoToast] = useState<null | {
    task: Task;
    listId: string;
  }>(null);
  const deleteUndoToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [completionBurstTier, setCompletionBurstTier] = useState<
    null | "s" | "m" | "l"
  >(null);
  const [microRewardMsg, setMicroRewardMsg] = useState<string | null>(null);
  const microRewardTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const elasticCompleteDayRef = useRef("");
  const todayElasticCompleteCountRef = useRef(0);

  const flashInvalidInput = useCallback((target: "list" | "focus") => {
    setInvalidInputTarget(target);
    window.setTimeout(() => setInvalidInputTarget(null), 420);
  }, []);

  /* --- HERO PREVIEW SIMULATION STATE --- */
  const previewScrollRef = useRef<HTMLDivElement | null>(null);
  const feature1Ref = useRef<HTMLDivElement | null>(null);
  const feature2Ref = useRef<HTMLDivElement | null>(null);
  const [previewSection, setPreviewSection] = useState<"feature1" | "feature2">(
    "feature1",
  );
  const [previewParallax, setPreviewParallax] = useState(0);
  const [previewMaxScroll, setPreviewMaxScroll] = useState(0);
  const [demoTasks, setDemoTasks] = useState<string[]>([]);
  const [demoSeconds, setDemoSeconds] = useState(25 * 60);
  const [demoRunning, setDemoRunning] = useState(false);
  const [hasPlayedFeature1Demo, setHasPlayedFeature1Demo] = useState(false);
  const [demoInputText, setDemoInputText] = useState("");
  const feature1DemoStartedRef = useRef(false);

  /* --- NAV / DROPDOWNS STATE --- */
  const [openDropdown, setOpenDropdown] = useState<
    "madeFor" | "resources" | null
  >(null);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const madeForRef = useRef<HTMLDivElement | null>(null);
  const resourcesRef = useRef<HTMLDivElement | null>(null);
  const performanceRef = useRef<HTMLDivElement | null>(null);
  const habitRef = useRef<HTMLDivElement | null>(null);
  const timeRef = useRef<HTMLDivElement | null>(null);

  /* --- HEATMAP & SCORE STATE --- */
  const [heatmapData, setHeatmapData] = useState<DayMetric[]>([]);

  /* --- BEAT YESTERDAY FUNCTIONAL STATE --- */
  const [yesterdayTotalFocusMinutes, setYesterdayTotalFocusMinutes] =
    useState(0);
  const [todayTotalFocusMinutes, setTodayTotalFocusMinutes] = useState(0);
  const [timerAccumulator, setTimerAccumulator] = useState(0);
  const timerAccumulatorRef = useRef(0);
  timerAccumulatorRef.current = timerAccumulator;

  /* --- FOCUS INTEGRITY ENGINE --- */
  const [integrityPenalty, setIntegrityPenalty] = useState(0);
  const [isViolating, setIsViolating] = useState(false);
  const hiddenTimeRef = useRef<number | null>(null);
  const isSimAborted = useRef(false);

  const getTodayStr = () =>
    new Date().toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const getCurrentMonthName = () =>
    new Date().toLocaleString("default", { month: "long" });

  const formatFocusSeconds = (s: number) => {
    const clamped = Math.max(0, Math.floor(s));
    const mm = Math.floor(clamped / 60);
    const ss = clamped % 60;
    return `${mm.toString().padStart(2, "0")}:${ss.toString().padStart(2, "0")}`;
  };

  /* ------------------- STATIC CONTENT ------------------- */
  const greetings = [
    "What’s on your list today?",
    "Momentum is everything.",
    "Ready to beat yesterday?",
    "Progress compounds.",
    "Let’s build momentum.",
    "Discipline over motivation.",
  ];

  type AppView =
    | "tasks"
    | "calendar"
    | "analytics"
    | "notifications"
    | "settings";
  const [activeView, setActiveView] = useState<AppView>("tasks");

  /* --- Focus Session Mode STATE --- */
  const FOCUS_SESSION_DURATION_SECONDS = 25 * 60;
  const [isFocusSessionActive, setIsFocusSessionActive] = useState(false);
  const [isTodayPanelCollapsed, setIsTodayPanelCollapsed] = useState(false);
  const [isTodayPanelAnimatingOut, setIsTodayPanelAnimatingOut] = useState(false);
  const [focusSeconds, setFocusSeconds] = useState(
    FOCUS_SESSION_DURATION_SECONDS,
  );
  type FocusQuitPending =
    | { action: "view"; view: AppView }
    | { action: "list"; listId: string }
    | { action: "completed" }
    | { action: "addList" }
    | { action: "quitOnly" }
    | { action: "openTask"; listId: string; taskId: number }
    | { action: "search" }
    | { action: "inboxAndFocus" };
  type FocusSessionDialog =
    | null
    | { kind: "quit"; pending: FocusQuitPending }
    | { kind: "reset" };
  const [focusSessionDialog, setFocusSessionDialog] =
    useState<FocusSessionDialog>(null);
  /** True only while the task timer is running inside an active focus session. */
  const isFocusTimerRunning = isFocusSessionActive && running;
  /** Full-screen zen transition when entering Focus from the nav (dartboard). */
  const [focusEnterZenActive, setFocusEnterZenActive] = useState(false);
  /** After session UI appears, fade zen overlay so ripples linger over focus view. */
  const [focusZenFadeOut, setFocusZenFadeOut] = useState(false);
  const [zenOverlayOrigin, setZenOverlayOrigin] = useState<{
    x: number;
    y: number;
  } | null>(null);
  /** Blocks interaction with the shell until Focus UI is ready (then only mist remains). */
  const [focusEnterZenBlocking, setFocusEnterZenBlocking] = useState(false);
  /** Tasks queued for the current focus session (listId + taskId); source of truth below timer. */
  const [focusSessionEntries, setFocusSessionEntries] = useState<
    FocusSessionEntry[]
  >([]);
  /** Focus picker: which category pills are expanded to show tasks (default collapsed on enter). */
  const [focusPickerExpanded, setFocusPickerExpanded] = useState<
    Record<string, boolean>
  >({});
  const focusNavButtonRef = useRef<HTMLButtonElement>(null);
  const focusEnterTimeoutsRef = useRef<number[]>([]);
  /** When false, scheduled finishEnterFocusSession is skipped (user navigated away during zen). */
  const allowFocusEnterRef = useRef(true);
  /** Work-mode prompts queued from “Focus for today” — shown after zen ripple, not before. */
  const pendingWorkModeAfterZenRef = useRef<
    Array<{ taskId: number; listId: string }> | null
  >(null);

  const [notificationReadIds, setNotificationReadIds] = useState<Set<string>>(
    () => loadNotificationReadIds(),
  );
  const [notificationsPanelOpen, setNotificationsPanelOpen] = useState(false);
  const notificationsButtonRef = useRef<HTMLButtonElement>(null);
  const notificationsPanelRef = useRef<HTMLDivElement>(null);
  const sidebarUserMenuRef = useRef<HTMLDivElement>(null);
  const [notificationsPanelPos, setNotificationsPanelPos] = useState({
    left: 12,
    bottom: 88,
  });

  const DEFAULT_LIST_ICON = "≡";
  const [todayLists, setTodayLists] = useState<TodayList[]>(() =>
    loadTodayListsFromStorage(),
  );
  const [completedActivityLog, setCompletedActivityLog] = useState<
    CompletedActivityEntry[]
  >([]);
  const [openListMenuId, setOpenListMenuId] = useState<string | null>(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    if (typeof window === "undefined") return false;
    try {
      return localStorage.getItem("tunnelvision_sidebar_collapsed_v1") === "1";
    } catch {
      return false;
    }
  });
  const [sidebarUserMenuOpen, setSidebarUserMenuOpen] = useState(false);
  const [isAddListModalOpen, setIsAddListModalOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListColor, setNewListColor] = useState<string | null>("#eab308");
  const listMenuRef = useRef<HTMLDivElement | null>(null);

  const [selectedListId, setSelectedListId] = useState<string | null>(() =>
    typeof window !== "undefined" && hasStoredTasks() ? SYS_LIST_TODAY : null,
  );
  const selectedListIdRef = useRef<string | null>(null);
  selectedListIdRef.current = selectedListId;
  const skipNextTasksPersistRef = useRef(false);
  const [calendarDay, setCalendarDay] = useState(() => toISODate(new Date()));
  const [calendarMonthStart, setCalendarMonthStart] = useState(() => {
    const n = new Date();
    return new Date(n.getFullYear(), n.getMonth(), 1);
  });
  const [dueDatePopover, setDueDatePopover] = useState<null | {
    taskId: number;
    anchor: DOMRect;
  }>(null);

  const [todayMainMode, setTodayMainMode] = useState<
    "tasks" | "completed" | "search"
  >("tasks");
  const [collapsedCompletedDates, setCollapsedCompletedDates] = useState<
    Record<string, boolean>
  >({});
  const allListsForSelection = useMemo(
    () => [...TASK_CATEGORY_LISTS, ...todayLists],
    [todayLists],
  );

  const focusSessionKeySet = useMemo(
    () =>
      new Set(focusSessionEntries.map((e) => `${e.listId}:${e.taskId}`)),
    [focusSessionEntries],
  );

  const focusSidebarSections = useMemo(() => {
    return FOCUS_PICKER_LIST_IDS.map((listId) => ({
      listId,
      label: FOCUS_PICKER_LABELS[listId] ?? listId,
      tasks: (tasksByListId[listId] ?? []).filter(
        (t) => !t.completed && !t.removing,
      ),
    }));
  }, [tasksByListId]);

  /** Task name shown in the work-mode modal (add one / add-all queue). */
  const pendingWorkModeTaskTitle = useMemo(() => {
    if (pendingWorkModeTaskId == null || pendingWorkModeListId == null) {
      return null;
    }
    const list = tasksByListId[pendingWorkModeListId] ?? [];
    const raw = list.find((t) => t.id === pendingWorkModeTaskId)?.text?.trim();
    if (raw == null) return null;
    return getFocusSessionDisplayLabel(pendingWorkModeListId, raw);
  }, [pendingWorkModeTaskId, pendingWorkModeListId, tasksByListId]);

  /** First task in the focus session queue (for integrity / tab visibility). */
  const activeFocusTaskForIntegrity = useMemo(() => {
    for (const e of focusSessionEntries) {
      const t = (tasksByListId[e.listId] ?? []).find(
        (x) => x.id === e.taskId && !x.removing,
      );
      if (t) return t;
    }
    return tasks.find((task) => !task.removing) ?? null;
  }, [focusSessionEntries, tasksByListId, tasks]);

  const selectedList = useMemo(
    () => allListsForSelection.find((l) => l.id === selectedListId) ?? null,
    [allListsForSelection, selectedListId],
  );

  const isUserListSelected = useMemo(
    () =>
      !!(
        selectedListId &&
        todayLists.some((l) => l.id === selectedListId)
      ),
    [selectedListId, todayLists],
  );

  const listUsesElasticComplete = useMemo(() => {
    if (!selectedListId || selectedListId === SYS_LIST_OVERDUE) return false;
    if (ELASTIC_COMPLETE_SYS_LIST_IDS.has(selectedListId)) return true;
    return isUserListSelected;
  }, [selectedListId, isUserListSelected]);

  const tasksActiveNoRemoving = useMemo(
    () => tasks.filter((t) => !t.removing),
    [tasks],
  );
  const visibleTasksForList = useMemo(
    () =>
      tasksActiveNoRemoving.filter(
        (t) => !(listUsesElasticComplete && t.completed),
      ),
    [tasksActiveNoRemoving, listUsesElasticComplete],
  );
  const allElasticListTasksComplete =
    listUsesElasticComplete &&
    tasksActiveNoRemoving.length > 0 &&
    visibleTasksForList.length === 0;

  const taskInputLiveHints = useMemo(() => {
    const raw = taskInput.trim();
    if (raw.length < 2) return [];
    const s = raw.toLowerCase();
    const out: string[] = [];
    if (/\b(tomorrow|tmrw|tmr|next day)\b/.test(s)) {
      out.push("Mentioned a future day — set a due date in task details when available.");
    }
    if (/\b(test|exam|quiz|midterm)\b/.test(s)) {
      out.push("Tests list works well for exam prep.");
    }
    if (/\b(project|essay|paper|report)\b/.test(s)) {
      out.push("Projects list — good for bigger deliverables.");
    }
    if (/\b(long[-\s]?term|semester)\b/.test(s)) {
      out.push("Long-Term Assignments for deadlines further out.");
    }
    return out.slice(0, 2);
  }, [taskInput]);

  const dailyTaskProgress = useMemo(() => {
    const todayStr = getTodayStr();
    const done = completedActivityLog.filter(
      (e) => e.dateStr === todayStr,
    ).length;
    let open = 0;
    for (const arr of Object.values(tasksByListId)) {
      if (!Array.isArray(arr)) continue;
      for (const t of arr) {
        if (!t.removing && !t.completed) open += 1;
      }
    }
    const denom = Math.max(done + open, 1);
    const pct = Math.min(100, Math.round((100 * done) / denom));
    return { pct, done, open };
  }, [completedActivityLog, tasksByListId]);

  const selectedTask = useMemo(() => {
    if (selectedTaskId == null) return null;
    return tasks.find((t) => t.id === selectedTaskId) ?? null;
  }, [selectedTaskId, tasks]);

  const tasksByDueDate = useMemo(() => {
    if (isSimulation) return {};
    const allowedListIds = new Set<string>();
    const labelByListId = new Map<string, string>();
    for (const l of TASK_CATEGORY_LISTS) {
      allowedListIds.add(l.id);
      labelByListId.set(l.id, l.label);
    }
    for (const l of todayLists) {
      allowedListIds.add(l.id);
      labelByListId.set(l.id, l.label);
    }

    const map: Record<string, CalendarPlacedTask[]> = {};
    for (const [listId, arr] of Object.entries(tasksByListId)) {
      if (!allowedListIds.has(listId)) continue;
      if (!Array.isArray(arr)) continue;
      const categoryLabel = labelByListId.get(listId) ?? "Tasks";
      for (const t of arr) {
        if (t.removing || t.completed || !t.dueDate) continue;
        const k = t.dueDate;
        if (!map[k]) map[k] = [];
        map[k].push({
          id: t.id,
          text: t.text,
          listId,
          categoryLabel,
        });
      }
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const byCat = a.categoryLabel.localeCompare(b.categoryLabel);
        if (byCat !== 0) return byCat;
        return a.text.localeCompare(b.text);
      });
    }
    return map;
  }, [tasksByListId, isSimulation, todayLists]);

  const [notificationDay, setNotificationDay] = useState(() =>
    toISODate(new Date()),
  );
  useEffect(() => {
    setNotificationDay(toISODate(new Date()));
  }, [tasksByListId]);
  useEffect(() => {
    const id = window.setInterval(() => {
      setNotificationDay(toISODate(new Date()));
    }, 60_000);
    const bump = () => setNotificationDay(toISODate(new Date()));
    document.addEventListener("visibilitychange", bump);
    window.addEventListener("focus", bump);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", bump);
      window.removeEventListener("focus", bump);
    };
  }, []);

  const notificationItems = useMemo(() => {
    const built = buildAllNotificationPayloads(tasksByListId, notificationDay);
    return built.map((n) => ({
      ...n,
      read: notificationReadIds.has(n.id),
    }));
  }, [tasksByListId, notificationDay, notificationReadIds]);

  const hasUnreadNotifications = useMemo(
    () => notificationItems.some((n) => !n.read),
    [notificationItems],
  );

  const focusForTodayItems = useMemo(() => {
    const base = buildFocusForTodayPicks(tasksByListId, notificationDay);
    return applySoftEstimateReorder(base, tasksByListId);
  }, [tasksByListId, notificationDay]);

  const [estimateSessionActions, setEstimateSessionActions] = useState(() => {
    if (typeof window === "undefined") return 0;
    try {
      return parseInt(
        sessionStorage.getItem(ESTIMATE_SESSION_ACTIONS_KEY) || "0",
        10,
      );
    } catch {
      return 0;
    }
  });

  const focusTodaySections = useMemo(() => {
    const pinned = focusForTodayItems.filter((p) => p.daysLeft <= 0);
    const upNext = focusForTodayItems.filter((p) => p.daysLeft > 0);
    return { pinned, upNext };
  }, [focusForTodayItems]);

  const focusTodayFlatRows = useMemo(() => {
    const { pinned, upNext } = focusTodaySections;
    const out: Array<
      | { kind: "header"; label: string }
      | { kind: "row"; pick: FocusForTodayPick }
    > = [];
    if (pinned.length > 0) {
      out.push({ kind: "header", label: "Overdue & Due Today" });
      for (const p of pinned) out.push({ kind: "row", pick: p });
    }
    if (upNext.length > 0) {
      out.push({ kind: "header", label: "Up Next" });
      for (const p of upNext) out.push({ kind: "row", pick: p });
    }
    return out;
  }, [focusTodaySections]);

  const focusEstimatePromptKeys = useMemo(() => {
    if (estimateSessionActions >= 2) return new Set<string>();
    const scored = focusForTodayItems
      .map((p) => {
        const t = getTaskForPick(tasksByListId, p);
        return { p, t };
      })
      .filter(
        ({ t, p }) => t && taskNeedsEstimate(t, p.listId),
      )
      .sort((a, b) => {
        if (a.p.daysLeft !== b.p.daysLeft) return a.p.daysLeft - b.p.daysLeft;
        const ra = FOCUS_FOR_TODAY_LIST_RANK.get(a.p.listId) ?? 9;
        const rb = FOCUS_FOR_TODAY_LIST_RANK.get(b.p.listId) ?? 9;
        return ra - rb || a.p.displayTitle.localeCompare(b.p.displayTitle);
      });
    return new Set(
      scored.slice(0, 2).map((x) => `${x.p.listId}:${x.p.taskId}`),
    );
  }, [focusForTodayItems, tasksByListId, estimateSessionActions]);

  const bumpEstimateSessionAction = useCallback(() => {
    setEstimateSessionActions((n) => {
      const next = Math.min(n + 1, 99);
      try {
        sessionStorage.setItem(ESTIMATE_SESSION_ACTIONS_KEY, String(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }, []);

  const handleFocusEstimateInline = useCallback(
    (listId: string, taskId: number, minutes: number | "skip") => {
      setTasksByListId((prev) => {
        const arr = [...(prev[listId] ?? [])];
        const idx = arr.findIndex((t) => t.id === taskId);
        if (idx === -1) return prev;
        const t = arr[idx];
        const next: Task = {
          ...t,
          estimatePromptDismissed: true,
        };
        if (minutes !== "skip") {
          next.estimatedMinutes = minutes;
          recordEstimatePattern(normalizeEstimateKeyword(t.text), minutes);
        }
        arr[idx] = next;
        return { ...prev, [listId]: arr };
      });
      if (selectedListId === listId) {
        setTasks((prev) =>
          prev.map((tt) => {
            if (tt.id !== taskId) return tt;
            const u: Task = { ...tt, estimatePromptDismissed: true };
            if (minutes !== "skip") u.estimatedMinutes = minutes;
            return u;
          }),
        );
      }
      bumpEstimateSessionAction();
    },
    [bumpEstimateSessionAction, selectedListId],
  );

  useEffect(() => {
    try {
      localStorage.setItem(
        NOTIFICATION_READS_STORAGE_KEY,
        JSON.stringify([...notificationReadIds]),
      );
    } catch {
      /* ignore */
    }
  }, [notificationReadIds]);

  const updateNotificationsPanelPosition = useCallback(() => {
    const btn = notificationsButtonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    const gap = 6;
    const panelW = 320;
    const left = Math.max(
      8,
      Math.min(rect.right - panelW, window.innerWidth - panelW - 8),
    );
    const top = rect.bottom + gap;
    setNotificationsPanelPos({ left, bottom: top });
  }, []);

  useLayoutEffect(() => {
    if (!notificationsPanelOpen) return;
    updateNotificationsPanelPosition();
    window.addEventListener("resize", updateNotificationsPanelPosition);
    window.addEventListener("scroll", updateNotificationsPanelPosition, true);
    return () => {
      window.removeEventListener("resize", updateNotificationsPanelPosition);
      window.removeEventListener(
        "scroll",
        updateNotificationsPanelPosition,
        true,
      );
    };
  }, [notificationsPanelOpen, updateNotificationsPanelPosition]);

  useEffect(() => {
    if (!notificationsPanelOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (notificationsButtonRef.current?.contains(t)) return;
      if (notificationsPanelRef.current?.contains(t)) return;
      setNotificationsPanelOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [notificationsPanelOpen]);

  useEffect(() => {
    if (!sidebarUserMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (sidebarUserMenuRef.current?.contains(e.target as Node)) return;
      setSidebarUserMenuOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [sidebarUserMenuOpen]);

  useEffect(() => {
    try {
      localStorage.setItem(
        "tunnelvision_sidebar_collapsed_v1",
        sidebarCollapsed ? "1" : "0",
      );
    } catch {
      /* ignore */
    }
    if (sidebarCollapsed) {
      setNotificationsPanelOpen(false);
      setSidebarUserMenuOpen(false);
    }
  }, [sidebarCollapsed]);

  const handleNotificationsButtonClick = () => {
    setNotificationsPanelOpen((prev) => {
      if (!prev) {
        setNotificationReadIds((r) => {
          const s = new Set(r);
          for (const n of buildAllNotificationPayloads(
            tasksByListId,
            notificationDay,
          )) {
            s.add(n.id);
          }
          return s;
        });
        return true;
      }
      return false;
    });
  };

  const completedEntries = useMemo(() => {
    const entries = completedActivityLog.map((e) => ({
      key: e.id,
      taskName: e.taskName,
      dateStr: e.dateStr,
      minutes: e.minutes,
      listLabel: e.listLabel,
      listId: e.listId,
    }));

    const parseDate = (dateStr: string) => {
      const year = new Date().getFullYear();
      const dt = new Date(`${dateStr} ${year}`);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    entries.sort((a, b) => {
      const da = parseDate(a.dateStr);
      const db = parseDate(b.dateStr);
      if (da && db) return db.getTime() - da.getTime();
      if (da) return -1;
      if (db) return 1;
      return b.dateStr.localeCompare(a.dateStr);
    });

    return entries;
  }, [completedActivityLog]);

  const completedGroups = useMemo(() => {
    const todayStr = getTodayStr();

    const parseDate = (dateStr: string) => {
      const year = new Date().getFullYear();
      const dt = new Date(`${dateStr} ${year}`);
      return Number.isNaN(dt.getTime()) ? null : dt;
    };

    const formatGroupLabel = (dateStr: string) => {
      if (dateStr === todayStr) {
        const dt = parseDate(dateStr);
        const weekday = dt
          ? dt.toLocaleDateString(undefined, { weekday: "long" })
          : "";
        return weekday ? `${weekday}, Today` : "Today";
      }
      const dt = parseDate(dateStr);
      const weekday = dt
        ? dt.toLocaleDateString(undefined, { weekday: "long" })
        : "";
      return weekday ? `${weekday}, ${dateStr}` : dateStr;
    };

    const map = new Map<
      string,
      {
        dateStr: string;
        label: string;
        items: typeof completedEntries;
      }
    >();
    completedEntries.forEach((e) => {
      if (!map.has(e.dateStr)) {
        map.set(e.dateStr, {
          dateStr: e.dateStr,
          label: formatGroupLabel(e.dateStr),
          items: [],
        });
      }
      map.get(e.dateStr)!.items.push(e);
    });

    map.forEach((g) => {
      g.label = `${formatGroupLabel(g.dateStr)} ${g.items.length}`;
    });

    const groups = Array.from(map.values());
    // completedEntries are already sorted; preserve order of first appearance
    groups.sort((a, b) => {
      const da = parseDate(a.dateStr);
      const db = parseDate(b.dateStr);
      if (da && db) return db.getTime() - da.getTime();
      if (da) return -1;
      if (db) return 1;
      return b.dateStr.localeCompare(a.dateStr);
    });

    return groups;
  }, [completedEntries, getTodayStr]);

  const appendCompletedActivity = (
    taskName: string,
    minutes: number,
    listId: string | null,
    listLabel: string,
  ) => {
    const todayStr = getTodayStr();
    setCompletedActivityLog((prev) => [
      ...prev,
      {
        id: `c-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        taskName,
        dateStr: todayStr,
        minutes,
        listId,
        listLabel,
      },
    ]);
  };

  const removeLastCompletedForTaskOnList = (
    taskName: string,
    listId: string | null,
  ) => {
    const todayStr = getTodayStr();
    setCompletedActivityLog((prev) => {
      const copy = [...prev];
      for (let i = copy.length - 1; i >= 0; i--) {
        if (
          copy[i].taskName === taskName &&
          copy[i].listId === listId &&
          copy[i].dateStr === todayStr
        ) {
          copy.splice(i, 1);
          return copy;
        }
      }
      return prev;
    });
  };

  const clearTaskCompletionAnimTimers = useCallback(() => {
    completionAnimTimersRef.current.forEach((tid) =>
      window.clearTimeout(tid),
    );
    completionAnimTimersRef.current = [];
    setCompletionBurstTier(null);
  }, []);

  useEffect(() => {
    clearTaskCompletionAnimTimers();
    setTaskCheckAnimatingId(null);
    setTaskRowExitingId(null);
  }, [selectedListId, clearTaskCompletionAnimTimers]);

  function scheduleElasticListTaskComplete(
    task: Task,
    listId: string,
    listLabel: string,
  ) {
    clearTaskCompletionAnimTimers();
    const pushTimer = (fn: () => void, ms: number) => {
      const tid = window.setTimeout(() => {
        fn();
      }, ms);
      completionAnimTimersRef.current.push(tid);
    };

    const arr = tasksByListIdRef.current[listId] ?? [];
    const openBefore = arr.filter((x) => !x.completed && !x.removing).length;
    const listSupportsElasticComplete =
      listId !== SYS_LIST_OVERDUE &&
      (ELASTIC_COMPLETE_SYS_LIST_IDS.has(listId) ||
        todayLists.some((l) => l.id === listId));
    const isLastInElasticList =
      openBefore === 1 && listSupportsElasticComplete;

    const dayKey = calendarDay;
    if (elasticCompleteDayRef.current !== dayKey) {
      elasticCompleteDayRef.current = dayKey;
      todayElasticCompleteCountRef.current = 0;
    }
    todayElasticCompleteCountRef.current += 1;
    const n = todayElasticCompleteCountRef.current;

    let burstTier: "s" | "m" | "l" | null = null;
    if (isLastInElasticList) {
      burstTier = "l";
    } else if (n >= 3 && n <= 5) {
      burstTier = "m";
    } else if (n === 1) {
      burstTier = "s";
    }
    setCompletionBurstTier(burstTier);
    if (burstTier) {
      pushTimer(
        () => setCompletionBurstTier(null),
        burstTier === "l" ? 540 : burstTier === "m" ? 420 : 260,
      );
    }

    if (
      !isLastInElasticList &&
      n >= 2 &&
      Math.random() < 0.09
    ) {
      const msgs = [
        "Strong progress today.",
        "Solid pace.",
        "Stay consistent.",
        "Clear momentum.",
      ];
      const pick = msgs[Math.floor(Math.random() * msgs.length)]!;
      if (microRewardTimerRef.current) {
        clearTimeout(microRewardTimerRef.current);
        microRewardTimerRef.current = null;
      }
      setMicroRewardMsg(pick);
      microRewardTimerRef.current = setTimeout(() => {
        setMicroRewardMsg(null);
        microRewardTimerRef.current = null;
      }, 1400);
    }

    setTaskCheckAnimatingId(task.id);
    pushTimer(() => setTaskRowExitingId(task.id), 420);
    pushTimer(() => {
      appendCompletedActivity(task.text, 0, listId, listLabel);
      if (selectedListIdRef.current === listId) {
        setTasks((prev) =>
          prev.map((x) =>
            x.id === task.id ? { ...x, completed: true } : x,
          ),
        );
      } else {
        setTasksByListId((prev) => {
          const arr = prev[listId] ?? [];
          return {
            ...prev,
            [listId]: arr.map((x) =>
              x.id === task.id ? { ...x, completed: true } : x,
            ),
          };
        });
      }
      setTaskCheckAnimatingId(null);
      setTaskRowExitingId(null);
      if (selectedTaskIdRef.current === task.id) {
        setSelectedTaskId(null);
      }
      setTaskDoneToast({
        taskId: task.id,
        taskText: task.text,
        listId,
      });
      if (taskDoneToastTimerRef.current) {
        clearTimeout(taskDoneToastTimerRef.current);
      }
      taskDoneToastTimerRef.current = setTimeout(() => {
        setTaskDoneToast(null);
        taskDoneToastTimerRef.current = null;
      }, 8000);
    }, 420 + 300);
  }

  function undoTaskCompletionToast() {
    if (!taskDoneToast) return;
    const { taskId, taskText, listId } = taskDoneToast;
    removeLastCompletedForTaskOnList(taskText, listId);
    if (taskDoneToastTimerRef.current) {
      clearTimeout(taskDoneToastTimerRef.current);
      taskDoneToastTimerRef.current = null;
    }
    setTaskDoneToast(null);
    setTasksByListId((prev) => {
      const arr = [...(prev[listId] ?? [])];
      const i = arr.findIndex((x) => x.id === taskId);
      if (i === -1) return prev;
      arr[i] = { ...arr[i], completed: false };
      return { ...prev, [listId]: arr };
    });
    if (selectedListIdRef.current === listId) {
      setTasks((prev) =>
        prev.map((x) =>
          x.id === taskId ? { ...x, completed: false } : x,
        ),
      );
    }
    setTaskReappearId(taskId);
    window.setTimeout(() => setTaskReappearId(null), 650);
  }

  function undoDeleteTaskToast() {
    if (!deleteUndoToast) return;
    const { task, listId } = deleteUndoToast;
    if (deleteUndoToastTimerRef.current) {
      clearTimeout(deleteUndoToastTimerRef.current);
      deleteUndoToastTimerRef.current = null;
    }
    setDeleteUndoToast(null);
    setTasksByListId((prev) => ({
      ...prev,
      [listId]: [...(prev[listId] ?? []), task],
    }));
    if (selectedListIdRef.current === listId) {
      setTasks((prev) => [...prev, task]);
    }
    setTaskReappearId(task.id);
    setSelectedTaskId(task.id);
    window.setTimeout(() => setTaskReappearId(null), 650);
  }

  useEffect(() => {
    if (!focusFinaleOpen || !focusFinaleSnapshot) return;
    setFocusFinaleModalOpen(false);
    setFocusFinalePhase(1);
    const tModal = window.setTimeout(() => {
      setFocusFinaleModalOpen(true);
      setFocusFinalePhase(2);
    }, 700);
    const tStats = window.setTimeout(() => setFocusFinalePhase(3), 700 + 500);
    return () => {
      window.clearTimeout(tModal);
      window.clearTimeout(tStats);
    };
  }, [focusFinaleOpen, focusFinaleSnapshot]);

  useEffect(() => {
    const prev = streakPrevRef.current;
    if (prev !== streak) {
      if (streak > prev) setStreakMicro("up");
      else if (streak < prev) setStreakMicro("down");
      streakPrevRef.current = streak;
      const t = window.setTimeout(() => setStreakMicro(null), 420);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [streak]);

  useEffect(() => {
    setMainViewEnterAnim(true);
    const t = window.setTimeout(() => setMainViewEnterAnim(false), 240);
    return () => window.clearTimeout(t);
  }, [activeView]);

  useEffect(() => {
    if (!isFocusSessionActive) {
      setFocusImmerseIntro(false);
      return;
    }
    setFocusImmerseIntro(true);
    const t = window.setTimeout(() => setFocusImmerseIntro(false), 300);
    return () => window.clearTimeout(t);
  }, [isFocusSessionActive]);

  useEffect(() => {
    if (!isFocusSessionActive || !running) return;
    const onVis = () => {
      if (document.visibilityState !== "hidden") return;
      setStayLockedHint(true);
      setFocusRootShake(true);
      window.setTimeout(() => {
        setStayLockedHint(false);
        setFocusRootShake(false);
      }, 2200);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [isFocusSessionActive, running]);

  useEffect(() => {
    if (!running || !isFocusSessionActive) return;
    const id = window.setInterval(() => {
      setFocusTimerNudge(true);
      window.setTimeout(() => setFocusTimerNudge(false), 720);
    }, 150_000);
    return () => clearInterval(id);
  }, [running, isFocusSessionActive]);

  useEffect(() => {
    return () => {
      if (taskDoneToastTimerRef.current) {
        clearTimeout(taskDoneToastTimerRef.current);
      }
      if (deleteUndoToastTimerRef.current) {
        clearTimeout(deleteUndoToastTimerRef.current);
      }
      if (microRewardTimerRef.current) {
        clearTimeout(microRewardTimerRef.current);
      }
    };
  }, []);

  useLayoutEffect(() => {
    if (typeof document === "undefined") return;
    try {
      const raw = localStorage.getItem(MOTION_PREF_STORAGE_KEY);
      const tier =
        raw === "fast" || raw === "smooth" || raw === "normal"
          ? raw
          : "normal";
      document.documentElement.dataset.motionTier =
        tier === "normal" ? "" : tier;
    } catch {
      document.documentElement.dataset.motionTier = "";
    }
  }, []);

  useEffect(() => {
    const gaps: number[] = [];
    let lastTs = 0;
    const onDown = () => {
      const now = performance.now();
      if (lastTs > 0) gaps.push(Math.min(now - lastTs, 8000));
      lastTs = now;
      if (gaps.length > 18) gaps.shift();
      if (gaps.length < 6) return;
      const avg = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      let next: "fast" | "normal" | "smooth" = "normal";
      if (avg < 420) next = "fast";
      else if (avg > 1600) next = "smooth";
      document.documentElement.dataset.motionTier =
        next === "normal" ? "" : next;
      try {
        localStorage.setItem(MOTION_PREF_STORAGE_KEY, next);
      } catch {
        /* ignore */
      }
    };
    document.addEventListener("pointerdown", onDown, true);
    return () => document.removeEventListener("pointerdown", onDown, true);
  }, []);

  useEffect(() => {
    if (
      !selectedListId ||
      (todayMainMode !== "tasks" && todayMainMode !== "search") ||
      activeView !== "tasks"
    ) {
      setTasksListSkeletonVisible(false);
      return;
    }
    setTasksListSkeletonVisible(false);
    const t = window.setTimeout(() => setTasksListSkeletonVisible(false), 450);
    return () => clearTimeout(t);
  }, [selectedListId, todayMainMode, activeView]);

  useEffect(() => {
    if (!selectedListId) return;
    if (!allListsForSelection.some((l) => l.id === selectedListId)) {
      setSelectedListId(null);
      setTasks([]);
      setSelectedTaskId(null);
    }
  }, [allListsForSelection, selectedListId]);

  useEffect(() => {
    if (!openListMenuId) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (listMenuRef.current && !listMenuRef.current.contains(target)) {
        setOpenListMenuId(null);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openListMenuId]);

  useEffect(() => {
    if (!selectedListId) return;
    if (isSimulation) return;
    if (isSwitchingListRef.current) return;
    if (skipNextTasksPersistRef.current) return;
    setTasksByListId((prev) => ({
      ...prev,
      [selectedListId]: tasks,
    }));
  }, [tasks, selectedListId, isSimulation]);

  useEffect(() => {
    if (isSimulation) return;
    const id = window.setInterval(() => {
      const n = toISODate(new Date());
      setCalendarDay((c) => (c !== n ? n : c));
    }, 60_000);
    return () => clearInterval(id);
  }, [isSimulation]);

  useEffect(() => {
    const onVis = () => {
      if (document.visibilityState === "visible") {
        setCalendarDay(toISODate(new Date()));
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    if (isSimulation) return;
    const today = toISODate(new Date());
    setTasksByListId((prev) => {
      const next = migrateOverdueTasks(prev, today);
      if (next === prev) return prev;
      skipNextTasksPersistRef.current = true;
      const sel = selectedListIdRef.current;
      const needsSlice =
        !!sel &&
        (OVERDUE_SOURCE_LIST_IDS.includes(sel) || sel === SYS_LIST_OVERDUE);
      if (needsSlice && sel) {
        requestAnimationFrame(() => {
          setTasks(next[sel] ?? []);
          skipNextTasksPersistRef.current = false;
        });
      } else {
        skipNextTasksPersistRef.current = false;
      }
      return next;
    });
  }, [calendarDay, isSimulation]);

  useEffect(() => {
    setDueDatePopover(null);
  }, [selectedTaskId]);

  useEffect(() => {
    if (selectedTaskId == null) return;
    const stillVisible = tasks.some(
      (t) => t.id === selectedTaskId && !t.removing,
    );
    if (!stillVisible) setSelectedTaskId(null);
  }, [tasks, selectedTaskId]);

  useEffect(() => {
    tasksRef.current = tasks;
  }, [tasks]);

  const randomGreeting = useMemo(
    () => greetings[Math.floor(Math.random() * greetings.length)],
    [],
  );

  useEffect(() => {
    if (!isFocusSessionActive) return;
    const id = window.setInterval(() => {
      setFocusSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [isFocusSessionActive]);

  const heroVariant = useMemo(() => {
    const variants = [
      {
        lines: ["Most productivity apps are just glorified Google Calendars"],
      },
      {
        lines: ["Stop scheduling tasks,", "Start measuring focus."],
      },
      {
        lines: ["Planning isn’t productivity,", "Focused work is."],
      },
    ];
    const index = Math.floor(Math.random() * variants.length);
    return variants[index];
  }, []);

  /* -----------------------------------------------------------
     DYNAMIC ANALYTICS ENGINE
  ----------------------------------------------------------- */
  const stats = useMemo(() => {
    if (isSimulation)
      return [
        { label: "TOTAL FOCUS TIME", val: "14h 22m" },
        { label: "BEST INTEGRITY", val: "99.2%" },
        { label: "LONGEST SESSION", val: "3h 15m" },
        { label: "ALL-TIME TASKS", val: "482" },
        { label: "AVG COMPLETION", val: "12m 4s" },
        { label: "DAILY RITUALS", val: "24" },
      ];

    let totalSecs = 0;
    let maxIntegrity = 0;
    let maxSessionSecs = 0;
    let totalTasksCount = 0;
    let totalTaskDurationSecs = 0;

    heatmapData.forEach((day) => {
      totalSecs += day.totalFocusSeconds;
      if (day.focusIntegrity > maxIntegrity) maxIntegrity = day.focusIntegrity;
      if (day.totalFocusSeconds > maxSessionSecs)
        maxSessionSecs = day.totalFocusSeconds;
    });

    Object.values(taskHistory).forEach((points) => {
      points.forEach((p) => {
        totalTasksCount++;
        totalTaskDurationSecs += p.value;
      });
    });

    const hours = Math.floor(totalSecs / 3600);
    const mins = Math.floor((totalSecs % 3600) / 60);
    const avgSecs =
      totalTasksCount > 0 ? totalTaskDurationSecs / totalTasksCount : 0;
    const avgMins = Math.floor(avgSecs / 60);
    const avgRemainderSecs = Math.floor(avgSecs % 60);
    const longHours = Math.floor(maxSessionSecs / 3600);
    const longMins = Math.floor((maxSessionSecs % 3600) / 60);

    return [
      { label: "TOTAL FOCUS TIME", val: `${hours}h ${mins}m` },
      { label: "BEST INTEGRITY", val: `${maxIntegrity.toFixed(1)}%` },
      { label: "LONGEST SESSION", val: `${longHours}h ${longMins}m` },
      { label: "ALL-TIME TASKS", val: totalTasksCount.toString() },
      { label: "AVG COMPLETION", val: `${avgMins}m ${avgRemainderSecs}s` },
      {
        label: "DAILY RITUALS",
        val: heatmapData
          .filter((d) => d.totalFocusSeconds > 0)
          .length.toString(),
      },
    ];
  }, [heatmapData, taskHistory, isSimulation]);

  /* -----------------------------------------------------------
     DATA PERSISTENCE & COMPUTATION
  ----------------------------------------------------------- */
  const loadUserProgress = () => {
    const savedStreak = localStorage.getItem("efficiency_streak");
    const savedHistory = localStorage.getItem("efficiency_history");
    const savedTaskHistory = localStorage.getItem("tunnelvision_task_history");
    const savedHeatmap = localStorage.getItem(
      "tunnelvision_discipline_heatmap",
    );
    const savedTodayMins = localStorage.getItem("tunnelvision_today_mins");

    if (savedStreak) setStreak(parseInt(savedStreak));
    if (savedHistory) setHistory(JSON.parse(savedHistory));
    if (savedTodayMins) setTodayTotalFocusMinutes(parseInt(savedTodayMins));

    if (savedTaskHistory) {
      const parsed = JSON.parse(savedTaskHistory);
      const merged = mergeTaskHistoryByNormalizedKeys(parsed);
      setTaskHistory(merged);
      const taskKeys = Object.keys(merged);
      if (taskKeys.length > 0 && !selectedTaskGraph) {
        setSelectedTaskGraph(taskKeys[taskKeys.length - 1]);
      }
    }

    const savedCompleted = localStorage.getItem(
      "tunnelvision_completed_activity",
    );
    if (savedCompleted) {
      try {
        setCompletedActivityLog(JSON.parse(savedCompleted));
      } catch {
        setCompletedActivityLog([]);
      }
    } else if (savedTaskHistory) {
      const parsed = JSON.parse(savedTaskHistory) as Record<
        string,
        HistoryPoint[]
      >;
      const migrated: CompletedActivityEntry[] = [];
      Object.entries(parsed).forEach(([taskName, points]) => {
        points.forEach((p, idx) => {
          migrated.push({
            id: `mig-${taskName}-${p.date}-${idx}`,
            taskName,
            dateStr: p.date,
            minutes: p.value,
            listId: null,
            listLabel: "Focus",
          });
        });
      });
      setCompletedActivityLog(migrated);
    }

    if (savedHeatmap) {
      const data: DayMetric[] = JSON.parse(savedHeatmap);
      setHeatmapData(data);
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      const yesterdayEntry = data.find((d) => d.date === yesterdayStr);
      if (yesterdayEntry) {
        setYesterdayTotalFocusMinutes(
          Math.round(yesterdayEntry.totalFocusSeconds / 60),
        );
      }
    } else {
      const empty = [...Array(31)].map((_, i) => ({
        date: `${getCurrentMonthName().slice(0, 3)} ${i + 1}`,
        score: 0,
        focusIntegrity: 0,
        tasksCompleted: 0,
        totalFocusSeconds: 0,
        symbol: "⬜",
      }));
      setHeatmapData(empty);
    }
  };

  useEffect(() => {
    if (isSimulation) return;
    loadUserProgress();
  }, [isSimulation]);

  useEffect(() => {
    if (!isSimulation) {
      localStorage.setItem("efficiency_streak", streak.toString());
      localStorage.setItem("efficiency_history", JSON.stringify(history));
      localStorage.setItem(
        "tunnelvision_task_history",
        JSON.stringify(taskHistory),
      );
      localStorage.setItem(
        "tunnelvision_discipline_heatmap",
        JSON.stringify(heatmapData),
      );
      localStorage.setItem(
        "tunnelvision_today_mins",
        todayTotalFocusMinutes.toString(),
      );
      localStorage.setItem(
        "tunnelvision_completed_activity",
        JSON.stringify(completedActivityLog),
      );
      localStorage.setItem(
        TASKS_BY_LIST_STORAGE_KEY,
        JSON.stringify(tasksByListId),
      );
      localStorage.setItem(
        TODAY_LISTS_STORAGE_KEY,
        JSON.stringify(todayLists),
      );
    }
  }, [
    history,
    taskHistory,
    streak,
    isSimulation,
    heatmapData,
    todayTotalFocusMinutes,
    completedActivityLog,
    tasksByListId,
    todayLists,
  ]);

  useEffect(() => {
    if (!analyticsTaskPickerOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const el = analyticsTaskPickerRef.current;
      if (el && !el.contains(e.target as Node)) {
        setAnalyticsTaskPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [analyticsTaskPickerOpen]);

  useEffect(() => {
    if (activeView !== "analytics") setAnalyticsTaskPickerOpen(false);
  }, [activeView]);

  useEffect(() => {
    if (!categoryDropdownOpen) return;
    const h = (e: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(e.target as Node)) setCategoryDropdownOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [categoryDropdownOpen]);

  /* ------------------- FOCUS INTEGRITY ENGINE ------------------- */
  useEffect(() => {
    if (!running || isSimulation) return;
    const handleVisibilityChange = () => {
      const activeTask = activeFocusTaskForIntegrity;
      if (document.hidden) {
        if (!activeTask || activeTask.workMode !== "inside") {
          hiddenTimeRef.current = null;
          return;
        }
        hiddenTimeRef.current = Date.now();
      } else if (hiddenTimeRef.current) {
        if (!activeTask || activeTask.workMode !== "inside") {
          hiddenTimeRef.current = null;
          return;
        }
        const msAway = Date.now() - hiddenTimeRef.current;
        const secondsAway = Math.floor(msAway / 1000);
        if (secondsAway > 0) {
          const deduction = secondsAway * 0.2;
          setIntegrityPenalty((prev) => prev + deduction);
          setIsViolating(true);
          setContractBroken(true);
          setWarning(`Contract Broken: Penalty Applied`);
          setTimeout(() => {
            setWarning(null);
            setIsViolating(false);
          }, 3000);
        }
        hiddenTimeRef.current = null;
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [running, isSimulation, activeFocusTaskForIntegrity]);

  const integrityScoreNum = useMemo(
    () => Math.max(0, 100 - integrityPenalty),
    [integrityPenalty],
  );
  const integrityScore = useMemo(
    () => integrityScoreNum.toFixed(1),
    [integrityScoreNum],
  );

  /* ------------------- PRIMARY EVENT HANDLERS ------------------- */
  const handleGetStarted = () => {
    isSimAborted.current = true;
    setTaskInput("");
    setIsTransitioning(true);
    setTimeout(() => {
      setIsSimulation(false);
      setName("User");
      setStreak(0);
      loadUserProgress();
      setTasks([]);
      setTasksByListId({});
      setSelectedTaskId(null);
      setSelectedListId(SYS_LIST_TODAY);
      setSeconds(0);
      setRunning(false);
      setTaskInput("");
      setIsTransitioning(false);
      setFocusSessionEntries([]);
      window.scrollTo({ top: 0, behavior: "instant" });
    }, 600);
  };

  const cancelFocusEnterZen = () => {
    allowFocusEnterRef.current = false;
    clearFocusEnterTimers();
    pendingWorkModeAfterZenRef.current = null;
    setFocusEnterZenActive(false);
    setZenOverlayOrigin(null);
    setFocusEnterZenBlocking(false);
    setFocusZenFadeOut(false);
  };

  const handleSidebarNavClick = (view: AppView) => {
    if (isFocusTimerRunning) {
      setFocusSessionDialog({ kind: "quit", pending: { action: "view", view } });
      return;
    }
    if (focusEnterZenActive) {
      cancelFocusEnterZen();
    }
    if (isFocusSessionActive) {
      cleanupFocusSessionAfterQuit();
    }
    setActiveView(view);
  };

  /** Log current focus integrity when leaving a session early (no task time stored). */
  const logIntegrityOnFocusQuit = () => {
    if (isSimulation) return;
    const todayStr = getTodayStr();
    const v = Math.round(Math.max(0, Math.min(100, integrityScoreNum)));
    setBestFocusIntegrity((prev) => Math.max(prev, v));
    setHistory((prev) => ({
      ...prev,
      "Focus Integrity": [
        ...(prev["Focus Integrity"] || []),
        { value: v, date: todayStr },
      ],
    }));
    setHeatmapData((prev) => {
      const idx = prev.findIndex((d) => d.date === todayStr);
      if (idx === -1) return prev;
      const next = [...prev];
      const existing = next[idx];
      next[idx] = {
        ...existing,
        focusIntegrity:
          existing.focusIntegrity > 0
            ? (existing.focusIntegrity + v) / 2
            : v,
      };
      return next;
    });
  };

  const cleanupFocusSessionAfterQuit = () => {
    setFocusFinaleOpen(false);
    setFocusFinaleModalOpen(false);
    setFocusFinaleSnapshot(null);
    focusFinaleSnapshotRef.current = null;
    setFocusFinalePhase(1);
    setTimerAccumulator(0);
    setRunning(false);
    setIsFocusSessionActive(false);
    setIsTodayPanelCollapsed(false);
    setIsTodayPanelAnimatingOut(false);
    setTodayMainMode("tasks");
    setFocusSeconds(FOCUS_SESSION_DURATION_SECONDS);
    setIsAddListModalOpen(false);
    setOpenListMenuId(null);
    setFocusSessionEntries([]);
    setFocusPickerExpanded({});
    workModePromptQueueRef.current = [];
    pendingWorkModeAfterZenRef.current = null;
    setPendingWorkModeTaskId(null);
    setPendingWorkModeListId(null);
    setIsWorkModeModalOpen(false);
  };

  const applyListSelection = (listId: string) => {
    isSwitchingListRef.current = true;
    if (selectedListId) {
      setTasksByListId((prev) => ({
        ...prev,
        [selectedListId]: tasks,
      }));
    }
    setSelectedListId(listId);
    setSelectedTaskId(null);
    setTodayMainMode("tasks");
    setOpenListMenuId(null);
    setTasks(tasksByListId[listId] ?? []);
    isSwitchingListRef.current = false;
  };

  const performOpenTaskInList = (listId: string, taskId: number) => {
    isSwitchingListRef.current = true;
    const merged = { ...tasksByListId };
    if (selectedListId) {
      merged[selectedListId] = tasks;
    }
    const slice = [...(merged[listId] ?? [])];
    setTasksByListId(merged);
    setSelectedListId(listId);
    setTasks(slice);
    setSelectedTaskId(taskId);
    setTodayMainMode("tasks");
    setOpenListMenuId(null);
    setActiveView("tasks");
    setIsTodayPanelCollapsed(false);
    setIsTodayPanelAnimatingOut(false);
    isSwitchingListRef.current = false;
  };

  const openTaskFromCalendar = (listId: string, taskId: number) => {
    if (isFocusTimerRunning) {
      setFocusSessionDialog({
        kind: "quit",
        pending: { action: "openTask", listId, taskId },
      });
      return;
    }
    if (focusEnterZenActive) {
      cancelFocusEnterZen();
    }
    if (isFocusSessionActive) {
      cleanupFocusSessionAfterQuit();
    }
    performOpenTaskInList(listId, taskId);
  };

  const applyPendingAfterQuit = (pending: FocusQuitPending) => {
    if (pending.action === "quitOnly") return;
    if (pending.action === "view") {
      setActiveView(pending.view);
    } else if (pending.action === "list") {
      applyListSelection(pending.listId);
    } else if (pending.action === "completed") {
      setCollapsedCompletedDates({});
      setTodayMainMode("completed");
    } else if (pending.action === "addList") {
      setNewListName("");
      setNewListColor("#eab308");
      setIsAddListModalOpen(true);
    } else if (pending.action === "openTask") {
      performOpenTaskInList(pending.listId, pending.taskId);
    } else if (pending.action === "search") {
      setActiveView("tasks");
      setTodayMainMode("search");
      queueMicrotask(() => {
        taskSearchInputRef.current?.focus();
        taskSearchInputRef.current?.select();
      });
    } else if (pending.action === "inboxAndFocus") {
      setActiveView("tasks");
      applyListSelection(SYS_LIST_INBOX);
      queueMicrotask(() => taskListInputRef.current?.focus());
    }
  };

  const confirmFocusQuitYes = (pending: FocusQuitPending) => {
    logIntegrityOnFocusQuit();
    cleanupFocusSessionAfterQuit();
    applyPendingAfterQuit(pending);
    setFocusSessionDialog(null);
  };

  const handleResetSessionConfirm = () => {
    setFocusSeconds(FOCUS_SESSION_DURATION_SECONDS);
    setSeconds(0);
    setRunning(false);
    setIntegrityPenalty(0);
    setTimerAccumulator(0);
    setTimerSessionStart(null);
    setReflectionPrompt(null);
    setReflectionText("");
    setWarning(null);
    setFocusSessionDialog(null);
  };

  const clearFocusEnterTimers = () => {
    focusEnterTimeoutsRef.current.forEach((id) => window.clearTimeout(id));
    focusEnterTimeoutsRef.current = [];
  };

  useEffect(() => {
    return () => clearFocusEnterTimers();
  }, []);

  const finishEnterFocusSession = () => {
    const pending = pendingWorkModeAfterZenRef.current;
    pendingWorkModeAfterZenRef.current = null;

    setIsFocusSessionActive(true);
    setFocusPickerExpanded({});
    setIsAddListModalOpen(false);
    setOpenListMenuId(null);
    setTodayMainMode("tasks");
    setFocusSeconds(FOCUS_SESSION_DURATION_SECONDS);
    setActiveView("tasks");

    setIsTodayPanelAnimatingOut(true);
    window.setTimeout(() => {
      setIsTodayPanelCollapsed(true);
      setIsTodayPanelAnimatingOut(false);
    }, 220);

    if (pending && pending.length > 0 && !isSimulation) {
      queueMicrotask(() => {
        workModePromptQueueRef.current = pending;
        setPendingWorkModeTaskId(pending[0].taskId);
        setPendingWorkModeListId(pending[0].listId);
        setIsWorkModeModalOpen(true);
      });
    }
  };

  /** Zen transition when tapping the Focus (dartboard) nav — then reveal the focus page. */
  const runFocusEnterZenTransition = () => {
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion) {
      finishEnterFocusSession();
      return;
    }
    clearFocusEnterTimers();
    allowFocusEnterRef.current = true;
    setFocusZenFadeOut(false);
    setZenOverlayOrigin({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    setFocusEnterZenActive(true);
    setFocusEnterZenBlocking(true);
    const ENTER_MS = 3000;
    const UNBLOCK_MS = 3180;
    const CLEAR_MS = 6200;
    const t0 = window.setTimeout(() => {
      if (!allowFocusEnterRef.current) return;
      finishEnterFocusSession();
      setFocusZenFadeOut(true);
    }, ENTER_MS);
    const t1 = window.setTimeout(() => setFocusEnterZenBlocking(false), UNBLOCK_MS);
    const t2 = window.setTimeout(() => {
      setFocusEnterZenActive(false);
      setZenOverlayOrigin(null);
      setFocusEnterZenBlocking(false);
      setFocusZenFadeOut(false);
    }, CLEAR_MS);
    focusEnterTimeoutsRef.current.push(t0, t1, t2);
  };

  const handleStartFocusSession = () => {
    if (focusEnterZenActive) return;
    if (isFocusSessionActive) {
      if (isFocusTimerRunning) {
        setFocusSessionDialog({ kind: "reset" });
      } else {
        handleResetSessionConfirm();
      }
      return;
    }
    runFocusEnterZenTransition();
  };

  const handleQuitFocusSession = () => {
    if (isFocusTimerRunning) {
      setFocusSessionDialog({ kind: "quit", pending: { action: "quitOnly" } });
    } else {
      cleanupFocusSessionAfterQuit();
      setFocusSessionDialog(null);
    }
  };

  const handleSelectList = (listId: string) => {
    if (isFocusTimerRunning) {
      setFocusSessionDialog({
        kind: "quit",
        pending: { action: "list", listId },
      });
      return;
    }
    if (focusEnterZenActive) {
      cancelFocusEnterZen();
    }
    if (isFocusSessionActive) {
      cleanupFocusSessionAfterQuit();
    }
    applyListSelection(listId);
  };

  useEffect(() => {
    if (!selectedListId) return;
    if (TASK_CATEGORY_LISTS.some((l) => l.id === selectedListId)) return;
    if (todayLists.some((l) => l.id === selectedListId)) {
      applyListSelection(SYS_LIST_TODAY);
    }
  }, [selectedListId, todayLists]);

  const triggerTaskInputPress = () => {
    setTaskInputShellPress(true);
    window.setTimeout(() => setTaskInputShellPress(false), 230);
  };

  /** Add task from the list input bar (Enter only); selects the new task for the detail pane. */
  const addTaskFromListInput = (opts?: { fromEnter?: boolean }) => {
    if (!selectedListId) return;
    if (selectedListId === SYS_LIST_OVERDUE) return;
    const trimmed = taskInput.trim();
    if (!trimmed) {
      if (opts?.fromEnter) flashInvalidInput("list");
      return;
    }
    const id = Date.now();
    let dueDate: string | null = null;
    if (selectedListId === SYS_LIST_TODAY || selectedListId === SYS_LIST_INBOX) {
      dueDate = toISODate(new Date());
    } else if (DUE_DATE_PICKER_LIST_IDS.has(selectedListId)) {
      dueDate = null;
    }
    const newTask: Task = {
      id,
      text: trimmed,
      description: "",
      removing: false,
      createdAt: Date.now(),
      workMode: "inside",
      completed: false,
      dueDate,
    };
    const flushAdd = () => {
      setTasks((prev) => [...prev, newTask]);
      setSelectedTaskId(id);
      setNewListTaskAnimId(id);
      window.setTimeout(() => setNewListTaskAnimId(null), 280);
      setTaskInputClearFlash(true);
      setTaskInput("");
      window.setTimeout(() => setTaskInputClearFlash(false), 200);
      queueMicrotask(() => taskListInputRef.current?.focus());
    };
    const wasEmptyFirst =
      visibleTasksForList.length === 0 && !allElasticListTasksComplete;
    if (opts?.fromEnter) triggerTaskInputPress();
    if (wasEmptyFirst) {
      setListEmptyExit(true);
      window.setTimeout(() => {
        flushAdd();
        setListEmptyExit(false);
        setListFirstTaskEnter(true);
        window.setTimeout(() => setListFirstTaskEnter(false), 300);
      }, 170);
      return;
    }
    flushAdd();
  };

  const resetAllData = () => {
    localStorage.clear();
    setHistory({});
    setTaskHistory({});
    setCompletedActivityLog([]);
    setHeatmapData([]);
    setTodayTotalFocusMinutes(0);
    setYesterdayTotalFocusMinutes(0);
    setStreak(0);
    setTasks([]);
    setTasksByListId({});
    setSelectedTaskId(null);
    setSeconds(0);
    setRunning(false);
    setIsVictory(false);
    setIntegrityPenalty(0);
    setFocusSessionEntries([]);
    workModePromptQueueRef.current = [];
    setPendingWorkModeTaskId(null);
    setPendingWorkModeListId(null);
    setIsWorkModeModalOpen(false);
    setWarning("System Purged");
    setTimeout(() => setWarning(null), 3000);
  };

  const handleReflectionSubmit = (options?: { tasksCompleted?: number }) => {
    const todayStr = getTodayStr();
    const sessionSecs = todayTotalFocusMinutes * 60;
    const tasksDone = options?.tasksCompleted ?? tasks.length;

    setHeatmapData((prev) => {
      const newData = [...prev];
      const todayIndex = newData.findIndex((d) => d.date === todayStr);

      // FIXED: Stack data onto the specific existing date box for today
      if (todayIndex !== -1) {
        const existingDay = newData[todayIndex];
        const newTotalSecs = existingDay.totalFocusSeconds + sessionSecs;
        const totalMins = Math.floor(newTotalSecs / 60);

        let symbol = "⬜";
        if (totalMins > 0 && totalMins <= 12) symbol = "🔹";
        else if (totalMins > 12 && totalMins <= 24) symbol = "🔷";
        else if (totalMins > 24 && totalMins <= 36) symbol = "🔵";
        else if (totalMins > 36) symbol = "🔥";

        newData[todayIndex] = {
          ...existingDay,
          focusIntegrity: (existingDay.focusIntegrity + integrityScoreNum) / 2,
          tasksCompleted: existingDay.tasksCompleted + tasksDone,
          totalFocusSeconds: newTotalSecs,
          score: integrityScoreNum,
          symbol: symbol,
        };
      }
      return newData;
    });

    setHistory((prev) => ({
      ...prev,
      "Focus Integrity": [
        ...(prev["Focus Integrity"] || []),
        { value: Math.round(integrityScoreNum), date: todayStr },
      ],
    }));

    setTodayTotalFocusMinutes(0);
    setReflectionPrompt(null);
    setReflectionText("");
    setWarning("Focus Synced");
    setTimeout(() => setWarning(null), 3000);
  };

  /* ------------------- HERO PAGE SIMULATION LOGIC ------------------- */
  useEffect(() => {
    if (!isSimulation) return;
    isSimAborted.current = false;
    const runSim = async () => {
      const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
      const demoTasks = [
        "Calculus homework",
        "Practice guitar",
        "Read Ch20 Mice and Men",
      ];
      await wait(1000);
      for (const t of demoTasks) {
        setTaskInput("");
        for (let i = 0; i <= t.length; i++) {
          if (isSimAborted.current) {
            setTaskInput("");
            return;
          }
          setTaskInput(t.slice(0, i));
          await wait(80);
        }
        if (isSimAborted.current) {
          setTaskInput("");
          return;
        }
        setTasks((prev) => [
          ...prev,
          {
            id: Date.now(),
            text: t,
            description: "",
            removing: false,
            createdAt: Date.now(),
            workMode: "inside",
            completed: false,
          },
        ]);
        setTaskInput("");
        await wait(600);
      }
      for (let i = 0; i < 4; i++) {
        if (isSimAborted.current) return;
        setSeconds((s) => s + 900);
        setInitialSeconds((s) => s + 900);
        await wait(800);
      }
      if (isSimAborted.current) return;
      setRunning(true);
    };
    runSim();
    return () => {
      isSimAborted.current = true;
    };
  }, [isSimulation]);

  /* ------------------- TIMER & TASK LOGIC ------------------- */
  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  /* ------------------- HERO PREVIEW SCROLL LOGIC ------------------- */
  useEffect(() => {
    if (!isSimulation) return;

    const handlePreviewScroll = () => {
      if (!feature1Ref.current || !feature2Ref.current) return;
      const viewportMid = window.innerHeight / 2;
      const rect1 = feature1Ref.current.getBoundingClientRect();
      const rect2 = feature2Ref.current.getBoundingClientRect();

      const feature2InView =
        rect2.top < viewportMid && rect2.bottom > viewportMid;

      setPreviewSection(feature2InView ? "feature2" : "feature1");

      const sectionStart = rect1.top;
      const sectionEnd = rect2.bottom;
      const total = sectionEnd - sectionStart || 1;
      const progressRaw = (viewportMid - sectionStart) / total;
      const progress = Math.min(1, Math.max(0, progressRaw));
      setPreviewParallax(progress);
    };

    handlePreviewScroll();
    window.addEventListener("scroll", handlePreviewScroll, { passive: true });
    return () => window.removeEventListener("scroll", handlePreviewScroll);
  }, [isSimulation]);

  useEffect(() => {
    if (!isSimulation || !previewScrollRef.current) return;
    const el = previewScrollRef.current;
    const compute = () => {
      const max = el.scrollHeight - el.clientHeight;
      setPreviewMaxScroll(max > 0 ? max : 0);
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, [isSimulation]);

  /* ------------------- NAVBAR DROPDOWN LOGIC ------------------- */
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        madeForRef.current &&
        !madeForRef.current.contains(target) &&
        resourcesRef.current &&
        !resourcesRef.current.contains(target)
      ) {
        setOpenDropdown(null);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const scrollToSection = (
    sectionRef: React.RefObject<HTMLDivElement | null>,
  ) => {
    const el = sectionRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const absoluteY = window.scrollY + rect.top - 96;
    window.scrollTo({ top: absoluteY, behavior: "smooth" });
    setIsMobileMenuOpen(false);
  };

  const handleHeroMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (window.innerWidth < 768) return;
    const el = e.currentTarget;
    const rect = el.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * 100;
    const y = ((e.clientY - rect.top) / rect.height) * 100;

    window.requestAnimationFrame(() => {
      el.style.setProperty("--mouse-x", `${x}%`);
      el.style.setProperty("--mouse-y", `${y}%`);
    });
  };

  /* --- Feature 1 demo: typing simulation when Step 1 scrolls into view (once) --- */
  useEffect(() => {
    if (!isSimulation || !feature1Ref.current) return;

    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || feature1DemoStartedRef.current) return;
        feature1DemoStartedRef.current = true;

        setHasPlayedFeature1Demo(true);
        setDemoTasks([]);
        setDemoInputText("");
        setDemoSeconds(25 * 60);
        setDemoRunning(false);

        (async () => {
          const addTask = (task: string) => {
            if (cancelled) return;
            setDemoTasks((prev) => [...prev, task]);
            setDemoInputText("");
          };

          const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

          const msPerChar = 40 + Math.random() * 20;

          await typeText(setDemoInputText, "calculus homework", msPerChar);
          if (cancelled) return;
          addTask("calculus homework");
          await delay(700);

          await typeText(setDemoInputText, "take bins down", msPerChar);
          if (cancelled) return;
          addTask("take bins down");
          await delay(700);

          await typeText(
            setDemoInputText,
            "Read Ch20 Of Mice and Men",
            msPerChar,
          );
          if (cancelled) return;
          addTask("Read Ch20 Of Mice and Men");

          if (!cancelled) setDemoRunning(true);
        })();
      },
      { threshold: 0.2, rootMargin: "0px" },
    );

    observer.observe(feature1Ref.current);
    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [isSimulation]);

  useEffect(() => {
    if (!demoRunning) return;
    const id = window.setInterval(() => {
      setDemoSeconds((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [demoRunning]);

  useEffect(() => {
    if (!running || (seconds <= 0 && isSimulation)) return;
    const id = setInterval(() => {
      setSeconds((s) => s - 1);
      if (!isSimulation) {
        setTimerAccumulator((prev) => prev + 1);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [running, seconds, isSimulation]);

  useEffect(() => {
    if (timerAccumulator >= 300) {
      setTodayTotalFocusMinutes((prev) => prev + 5);
      setTimerAccumulator(0);
    }
  }, [timerAccumulator]);

  function startTimer() {
    if (focusSessionEntries.length === 0) {
      setWarning("Add tasks from the sidebar or list first!");
      setTimeout(() => setWarning(null), 3000);
      return;
    }
    setRunning(true);
    setIntegrityPenalty(0);
    setTimerSessionStart(Date.now());
    setLastTaskCompletionTime(Date.now());
    setTimerAccumulator(0);
    focusSessionTasksCompletedRef.current = 0;
    setIsVictory(false);
    setFocusFinaleOpen(false);
    setFocusFinaleModalOpen(false);
    setFocusFinaleSnapshot(null);
    focusFinaleSnapshotRef.current = null;
    setFocusFinalePhase(1);
  }

  function addTaskToFocusSession(
    listId: string,
    taskId: number,
    options?: { promptWorkMode?: boolean },
  ) {
    const promptWorkMode = options?.promptWorkMode !== false;
    setFocusSessionEntries((prev) => {
      if (prev.some((e) => e.listId === listId && e.taskId === taskId)) {
        return prev;
      }
      if (promptWorkMode && !isSimulation) {
        queueMicrotask(() => {
          workModePromptQueueRef.current = [{ taskId, listId }];
          setPendingWorkModeTaskId(taskId);
          setPendingWorkModeListId(listId);
          setIsWorkModeModalOpen(true);
        });
      }
      return [...prev, { listId, taskId }];
    });
  }

  function addTaskFromFocusBar(
    _opts?: { fromEnter?: boolean; fromButtonClick?: boolean },
  ) {
    if (isSimulation) return;
    const trimmed = taskInput.trim();
    if (!trimmed) {
      if (_opts?.fromEnter || _opts?.fromButtonClick) {
        flashInvalidInput("focus");
      }
      return;
    }
    const targetListId = selectedListId ?? SYS_LIST_TODAY;
    if (targetListId === SYS_LIST_OVERDUE) return;
    triggerTaskInputPress();
    const id = Date.now();
    let dueDate: string | null = null;
    if (targetListId === SYS_LIST_TODAY) {
      dueDate = toISODate(new Date());
    } else if (DUE_DATE_PICKER_LIST_IDS.has(targetListId)) {
      dueDate = null;
    }
    const newTask: Task = {
      id,
      text: trimmed,
      description: "",
      removing: false,
      createdAt: Date.now(),
      workMode: "inside",
      completed: false,
      dueDate,
    };
    setTasksByListId((prev) => ({
      ...prev,
      [targetListId]: [...(prev[targetListId] ?? []), newTask],
    }));
    if (selectedListId === targetListId) {
      setTasks((prev) => [...prev, newTask]);
    }
    addTaskToFocusSession(targetListId, id);
    setFocusSessionNewRowId(id);
    window.setTimeout(() => setFocusSessionNewRowId(null), 280);
    setTaskInputClearFlash(true);
    setTaskInput("");
    window.setTimeout(() => setTaskInputClearFlash(false), 200);
    queueMicrotask(() => focusSessionTaskInputRef.current?.focus());
  }

  function advanceWorkModePromptQueue() {
    workModePromptQueueRef.current = workModePromptQueueRef.current.slice(1);
    const next = workModePromptQueueRef.current;
    if (next.length > 0) {
      setPendingWorkModeTaskId(next[0].taskId);
      setPendingWorkModeListId(next[0].listId);
    } else {
      setPendingWorkModeTaskId(null);
      setPendingWorkModeListId(null);
      setIsWorkModeModalOpen(false);
    }
  }

  function addAllTasksToFocusSession(listId: string) {
    setFocusSessionEntries((prev) => {
      const list = tasksByListId[listId] ?? [];
      const keys = new Set(prev.map((e) => `${e.listId}:${e.taskId}`));
      const added: FocusSessionEntry[] = [];
      for (const t of list) {
        if (t.completed || t.removing) continue;
        const key = `${listId}:${t.id}`;
        if (keys.has(key)) continue;
        keys.add(key);
        added.push({ listId, taskId: t.id });
      }
      if (!added.length) return prev;
      if (!isSimulation) {
        queueMicrotask(() => {
          const queue = added.map((e) => ({
            taskId: e.taskId,
            listId: e.listId,
          }));
          workModePromptQueueRef.current = queue;
          setPendingWorkModeTaskId(queue[0].taskId);
          setPendingWorkModeListId(queue[0].listId);
          setIsWorkModeModalOpen(true);
        });
      }
      return [...prev, ...added];
    });
  }

  function completeFocusTask(listId: string, taskId: number) {
    if (isSimulation) return;
    const list = tasksByListId[listId] ?? [];
    const task = list.find((t) => t.id === taskId && !t.removing);
    if (!task) return;
    const preserveSource =
      FOCUS_SESSION_PRESERVE_SOURCE_LIST_IDS.has(listId);
    const sessionLabel = getFocusSessionDisplayLabel(listId, task.text);
    const now = Date.now();
    const today = getTodayStr();
    const analyticsName = preserveSource ? sessionLabel : task.text;
    const taskKey = normalizeTaskKey(analyticsName);
    const listLabel =
      allListsForSelection.find((l) => l.id === listId)?.label ?? "Focus";

    if (running) {
      focusSessionTasksCompletedRef.current += 1;
      const refPoint = lastTaskCompletionTime || timerSessionStart || now;
      const durationSecs = Math.max(1, Math.floor((now - refPoint) / 1000));
      setFloatingTime({ text: `${durationSecs}s`, id: Date.now() });
      setTimeout(() => setFloatingTime(null), 1500);
      const mins = Math.round(durationSecs / 60);
      setTaskHistory((prev) => ({
        ...prev,
        [taskKey]: [...(prev[taskKey] || []), { value: durationSecs, date: today }],
      }));
      appendCompletedActivity(analyticsName, mins, listId, listLabel);
      setBestFocusIntegrity((prev) =>
        Math.max(prev, Math.min(100, Math.round(integrityScoreNum))),
      );
      setSelectedTaskGraph(taskKey);
      setSelectedStat("Speed");
    } else {
      setTaskHistory((prev) => ({
        ...prev,
        [taskKey]: [...(prev[taskKey] || []), { value: 0, date: today }],
      }));
      appendCompletedActivity(analyticsName, 0, listId, listLabel);
    }

    if (!preserveSource) {
      setTasksByListId((prev) => {
        const arr = prev[listId] ?? [];
        const newArr = arr.map((t) =>
          t.id === taskId ? { ...t, removing: true } : t,
        );
        return { ...prev, [listId]: newArr };
      });
      if (selectedListId === listId) {
        setTasks((prev) => {
          const newTasks = prev.map((t) =>
            t.id === taskId ? { ...t, removing: true } : t,
          );
          return newTasks;
        });
      }
    }

    setFocusSessionEntries((prev) => {
      const next = prev.filter(
        (e) => !(e.listId === listId && e.taskId === taskId),
      );
      if (next.length === 0 && running) {
        setTimeout(() => finishSessionManual(), 0);
      }
      return next;
    });

    setLastTaskCompletionTime(now);

    if (!preserveSource) {
      setTimeout(() => {
        setTasksByListId((prev) => {
          const arr = prev[listId] ?? [];
          return {
            ...prev,
            [listId]: arr.filter((t) => t.id !== taskId),
          };
        });
        if (selectedListId === listId) {
          setTasks((prev) => prev.filter((t) => t.id !== taskId));
        }
      }, 300);
    }
  }

  function completeTask(id: number) {
    const entry = focusSessionEntries.find((e) => e.taskId === id);
    if (entry) {
      completeFocusTask(entry.listId, id);
      return;
    }
    if (selectedListId) {
      completeFocusTask(selectedListId, id);
    }
  }

  function finishSessionManual() {
    const partialMins = Math.floor(timerAccumulatorRef.current / 60);
    const original = initialSecondsRef.current;
    const elapsedSecs = Math.max(0, original - secondsRef.current);
    const integrity = Math.round(
      Math.max(0, Math.min(100, integrityScoreNum)),
    );
    const tasksDone = Math.max(1, focusSessionTasksCompletedRef.current);

    setTodayTotalFocusMinutes((prev) => prev + partialMins);
    setTimerAccumulator(0);
    setRunning(false);
    setSeconds(0);
    setIsVictory(true);
    setReflectionPrompt(null);
    setReflectionText("");

    const snap = { integrity, elapsedSecs, tasksDone };
    focusFinaleSnapshotRef.current = snap;
    setFocusFinaleSnapshot(snap);
    setFocusFinalePhase(1);
    setFocusFinaleModalOpen(false);
    setFocusFinaleOpen(true);
  }

  function dismissFocusFinale() {
    const snap = focusFinaleSnapshotRef.current;
    setFocusFinaleOpen(false);
    setFocusFinaleModalOpen(false);
    setFocusFinaleSnapshot(null);
    focusFinaleSnapshotRef.current = null;
    setFocusFinalePhase(1);
    if (snap) {
      handleReflectionSubmit({ tasksCompleted: snap.tasksDone });
    } else {
      handleReflectionSubmit();
    }
  }

  /* ------------------- GRAPH ENGINE ------------------- */
  const currentData = useMemo(() => {
    if (isSimulation) return heroGraphData;
    if (selectedStat === "Speed") {
      const nk = normalizeTaskKey(selectedTaskGraph);
      const data =
        taskHistory[nk] ||
        (selectedTaskGraph ? taskHistory[selectedTaskGraph] : undefined);
      return data && data.length > 0 ? data : [{ value: 0, date: "N/A" }];
    }
    const integrityData = history["Focus Integrity"] || [];
    return integrityData.length > 0
      ? integrityData
      : [{ value: 0, date: "N/A" }];
  }, [selectedStat, history, taskHistory, selectedTaskGraph, isSimulation]);

  /** Adaptive domain so lines aren’t crushed at top/bottom (Integrity % or Speed seconds). */
  const graphScale = useMemo(() => {
    const vals = currentData.map((d) => d.value);
    if (vals.length === 0) {
      return {
        min: 0,
        max: selectedStat === "Integrity" ? 100 : 10,
        range: selectedStat === "Integrity" ? 100 : 10,
      };
    }
    const rawMin = Math.min(...vals);
    const rawMax = Math.max(...vals);
    const span = rawMax - rawMin;
    const pad =
      span > 1e-9
        ? Math.max(span * 0.14, span * 0.06)
        : selectedStat === "Integrity"
          ? 6
          : Math.max(3, Math.abs(rawMax) * 0.15 + 2);
    let min = rawMin - pad;
    let max = rawMax + pad;
    if (selectedStat === "Integrity") {
      min = Math.max(0, min);
      max = Math.min(100, max);
      if (max - min < 5) {
        const c = (rawMin + rawMax) / 2;
        min = Math.max(0, c - 2.5);
        max = Math.min(100, c + 2.5);
      }
    } else {
      min = Math.max(0, min);
      max = Math.max(max, rawMax + 1, 10);
      if (max - min < 2) max = min + 8;
    }
    const range = Math.max(max - min, 1e-9);
    return { min, max, range };
  }, [currentData, selectedStat]);

  const analyticsGraphXLabels = useMemo(() => {
    const d = currentData;
    if (d.length === 0) return [] as { key: string; text: string }[];
    if (d.length === 1) return [{ key: "0", text: d[0].date }];
    const n = d.length;
    const picks = new Set<number>([0, n - 1]);
    if (n > 2) picks.add(Math.floor((n - 1) / 2));
    if (n > 4) {
      picks.add(Math.floor((n - 1) * 0.25));
      picks.add(Math.floor((n - 1) * 0.75));
    }
    const sorted = [...picks].sort((a, b) => a - b);
    const out: { key: string; text: string }[] = [];
    let prevDate = "";
    for (const i of sorted) {
      const date = d[i].date;
      const text =
        date === prevDate ? `${date} (#${i + 1})` : date;
      out.push({ key: `x-${i}`, text });
      prevDate = date;
    }
    return out;
  }, [currentData]);

  const analyticsYTickValues = useMemo(() => {
    const { min, max } = graphScale;
    return [max, (min + max) / 2, min];
  }, [graphScale]);

  const analyticsGridYTicks = useMemo(() => {
    const { min, max } = graphScale;
    return [max, (min + max) / 2, min];
  }, [graphScale]);

  const analyticsYTickToSvgY = useMemo(() => {
    const { min, range } = graphScale;
    return (v: number) => 100 - ((v - min) / range) * 90;
  }, [graphScale]);

  const formatAnalyticsYTick = (v: number) => {
    if (selectedStat === "Integrity") {
      const r = Math.round(v * 10) / 10;
      return Number.isInteger(r) ? `${r}%` : `${r.toFixed(1)}%`;
    }
    if (v >= 100) return `${Math.round(v)}s`;
    if (v >= 10) return `${Math.round(v)}s`;
    const rounded = Math.round(v * 10) / 10;
    return Number.isInteger(rounded)
      ? `${rounded}s`
      : `${rounded.toFixed(1)}s`;
  };

  const analyticsChartHint = useMemo(() => {
    const vals = currentData.map((d) => d.value);
    if (vals.length === 0) return "No data yet";
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length;
    const u = selectedStat === "Integrity" ? "%" : "s";
    return `Avg ${avg.toFixed(1)}${u} · ${vals.length} points`;
  }, [currentData, selectedStat]);

  function generateLinearPath(data: HistoryPoint[]) {
    const { min, range } = graphScale;
    const points = data.map((d, i) => [
      (i / (data.length - 1 || 1)) * 100,
      100 - ((d.value - min) / range) * 90,
    ]);
    if (data.length <= 1)
      return `M 0 ${points[0][1]} L 100 ${points[0][1]} L 100 100 L 0 100 Z`;
    let dStr = `M 0 100 L ${points[0][0]} ${points[0][1]} `;
    for (let i = 1; i < points.length; i++) {
      dStr += `L ${points[i][0]} ${points[i][1]} `;
    }
    return dStr + `L 100 100 Z`;
  }

  /** Thin line only — same scale as generateLinearPath (analytics chart line stroke). */
  function generateAnalyticsLinePath(data: HistoryPoint[]) {
    const { min, range } = graphScale;
    const points = data.map((d, i) => [
      (i / (data.length - 1 || 1)) * 100,
      100 - ((d.value - min) / range) * 90,
    ]);
    if (data.length <= 1)
      return `M 0 ${points[0][1]} L 100 ${points[0][1]}`;
    let dStr = `M ${points[0][0]} ${points[0][1]}`;
    for (let i = 1; i < points.length; i++) {
      dStr += ` L ${points[i][0]} ${points[i][1]}`;
    }
    return dStr;
  }

  function getAnalyticsChartPoints(data: HistoryPoint[]) {
    const { min, range } = graphScale;
    return data.map((d, i) => [
      (i / (data.length - 1 || 1)) * 100,
      100 - ((d.value - min) / range) * 90,
    ]);
  }

  function buildAnalyticsSmoothLineD(data: HistoryPoint[]) {
    const pts = getAnalyticsChartPoints(data);
    if (pts.length === 0) return "";
    if (pts.length === 1)
      return `M ${pts[0][0]} ${pts[0][1]} L 100 ${pts[0][1]}`;
    let d = `M ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
    }
    return d;
  }

  function buildAnalyticsSmoothAreaD(data: HistoryPoint[]) {
    const pts = getAnalyticsChartPoints(data);
    if (pts.length === 0) return "";
    if (pts.length === 1) {
      const p = pts[0];
      return `M 0 100 L 0 ${p[1]} L 100 ${p[1]} L 100 100 Z`;
    }
    let d = `M ${pts[0][0]} 100 L ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const cp1x = p1[0] + (p2[0] - p0[0]) / 6;
      const cp1y = p1[1] + (p2[1] - p0[1]) / 6;
      const cp2x = p2[0] - (p3[0] - p1[0]) / 6;
      const cp2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += ` C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${p2[0]} ${p2[1]}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last[0]} 100 L ${pts[0][0]} 100 Z`;
    return d;
  }

  /* ------------------- UI STYLING ------------------- */
  const titleOpacity = isSimulation ? Math.max(0.4 - scrollY / 600, 0) : 0.1;
  const progressPercent =
    initialSeconds > 0
      ? (seconds / initialSeconds) * CIRCUMFERENCE
      : CIRCUMFERENCE;
  const auraColor =
    integrityScoreNum > 80
      ? "37, 99, 235"
      : integrityScoreNum > 50
        ? "168, 85, 247"
        : "239, 68, 68";

  /** Analytics heatmap — Todoist-like rounded cells; Analytics only. */
  const getHeatmapClass = (symbol: string, isCurrentDay: boolean) => {
    const base =
      "rounded-lg border transition-all duration-150 hover:ring-1 hover:ring-[#6366F1]/25 hover:z-[5]";
    if (isCurrentDay && symbol === "⬜")
      return `${base} bg-[#EEF2FF] border-[#6366F1]/30 ring-1 ring-[#6366F1]/20`;
    if (symbol === "⬜") return `${base} bg-[#F8FAFC] border-[#E5E7EB]`;
    if (symbol === "🔹") return `${base} bg-[#E0E7FF] border-[#C7D2FE]`;
    if (symbol === "🔷") return `${base} bg-[#C7D2FE] border-[#A5B4FC]`;
    if (symbol === "🔵") return `${base} bg-[#A5B4FC] border-[#818CF8]`;
    if (symbol === "🔥") return `${base} bg-[#818CF8] border-[#6366F1]`;
    return `${base} bg-[#F8FAFC] border-[#E5E7EB]`;
  };

  const improvementDelta = useMemo(() => {
    if (!isSimulation && yesterdayTotalFocusMinutes > 0) {
      const delta = todayTotalFocusMinutes - yesterdayTotalFocusMinutes;
      const percent = (delta / yesterdayTotalFocusMinutes) * 100;
      return percent.toFixed(0);
    }
    return "0";
  }, [yesterdayTotalFocusMinutes, todayTotalFocusMinutes, isSimulation]);

  /* --- PREVIEW SCENE OPACITIES (for soft crossfades) --- */
  const heroOpacity = useMemo(() => {
    return 1 - Math.min(previewParallax * 1.2, 0.6);
  }, [previewParallax]);

  const focusOpacity = useMemo(() => {
    const start = 0.15;
    const end = 0.75;
    const clamped = Math.min(
      1,
      Math.max(0, (previewParallax - start) / (end - start)),
    );
    return 0.3 + clamped * 0.7;
  }, [previewParallax]);

  const analyticsOpacity = useMemo(() => {
    const start = 0.55;
    const end = 1;
    const clamped = Math.min(
      1,
      Math.max(0, (previewParallax - start) / (end - start)),
    );
    return clamped;
  }, [previewParallax]);

  return (
    <>
      <style>{`
        .animate-fade-in{ animation:fadein .4s ease; }
        @keyframes fadein{ from{opacity:0;transform:translateY(-10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes chevron-bounce{ 0%,100%{ transform:translateY(0); opacity:0.7 } 50%{ transform:translateY(6px); opacity:1 } }
        @keyframes workmode-modal-in{ from{ opacity:0; transform:translateY(8px) scale(.96) } to{ opacity:1; transform:translateY(0) scale(1) } }
        .workmode-modal-enter{ animation:workmode-modal-in .18s ease-out; }
        .animate-chevron-bounce{ animation:chevron-bounce 2s ease-in-out infinite }
        @keyframes focus-zen-mist {
          0%{ opacity:0.5 }
          35%{ opacity:0.42 }
          100%{ opacity:0 }
        }
        @keyframes focus-zen-ripple-long {
          0%{ transform:scale(0.02); opacity:0 }
          18%{ opacity:0.22 }
          42%{ opacity:0.12 }
          100%{ transform:scale(1); opacity:0 }
        }
        @keyframes focus-zen-bloom {
          0%{ transform:scale(0.1); opacity:0.28 }
          40%{ opacity:0.12 }
          100%{ transform:scale(1); opacity:0 }
        }
        @keyframes app-notif-enter {
          0%{ opacity:0; transform:translateY(6px) scale(0.99) }
          100%{ opacity:1; transform:translateY(0) scale(1) }
        }
        @keyframes app-notif-urgency {
          0%,100%{ box-shadow:0 0 0 0 rgba(239,68,68,0) }
          50%{ box-shadow:0 0 0 1px rgba(239,68,68,0.12),0 8px 28px -12px rgba(239,68,68,0.18) }
        }
        .focus-zen-mist-overlay{
          animation:focus-zen-mist 5.5s cubic-bezier(0.22,0.61,0.36,1) forwards;
        }
        .focus-zen-ripple-ring{
          position:absolute; left:50%; top:50%;
          width:min(150vmax,2500px); height:min(150vmax,2500px);
          margin-left:calc(min(150vmax,2500px)/-2); margin-top:calc(min(150vmax,2500px)/-2);
          border-radius:50%;
          border:1px solid rgba(226,240,255,0.14);
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.04),
            0 0 48px rgba(180,210,240,0.07),
            0 0 120px rgba(120,170,220,0.04);
          animation:focus-zen-ripple-long 4.6s cubic-bezier(0.22,0.55,0.12,0.98) forwards;
        }
        .focus-zen-ripple-ring-slow{
          animation:focus-zen-ripple-long 5.2s cubic-bezier(0.2,0.52,0.14,1) forwards;
          border-color:rgba(210,230,248,0.1);
          box-shadow:
            0 0 0 1px rgba(255,255,255,0.03),
            0 0 64px rgba(160,200,230,0.06);
        }
        .focus-zen-bloom-core{
          position:absolute; left:50%; top:50%;
          width:min(88vmax,1400px); height:min(88vmax,1400px);
          margin-left:calc(min(88vmax,1400px)/-2); margin-top:calc(min(88vmax,1400px)/-2);
          border-radius:50%;
          background:rgba(99,102,241,0.04);
          animation:focus-zen-bloom 4.8s cubic-bezier(0.18,0.62,0.16,1) forwards;
        }
        .app-notif-item{
          animation:app-notif-enter 0.42s cubic-bezier(0.22,0.61,0.36,1) both;
        }
        .app-notif-item--unread{
          animation:app-notif-enter 0.42s cubic-bezier(0.22,0.61,0.36,1) both,
            app-notif-urgency 3.2s ease-in-out 0.4s 2;
        }
      `}</style>

      <div
        className={`size-full bg-white text-[#111827] selection:bg-[#6366F1]/20 font-sans text-[13px] leading-normal transition-all duration-700 ${isSimulation ? "min-h-[240vh]" : "min-h-screen"} ${isTransitioning ? "opacity-0" : "opacity-100"}`}
      >
        {isSimulation && null}
        {isSimulation && (
          <nav className="sticky top-0 z-[500] w-full px-4 md:px-8 py-2 md:py-3 bg-white/95 backdrop-blur-xl border-b border-[#E5E7EB]">
            <div className="w-full pointer-events-auto">
              <div className="flex items-center justify-between px-4 md:px-6 py-2 md:py-2.5">
                {/* Left: Logo as home button */}
                <button
                  type="button"
                  onClick={() =>
                    window.scrollTo({
                      top: 0,
                      behavior: "smooth",
                    })
                  }
                  className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-[#F1F5F9] hover:scale-[1.02] transition-all duration-200"
                >
                  <div className="w-8 h-8 rounded-xl overflow-hidden shadow-md">
                    <img
                      src="/favicon.ico"
                      alt="Tunnel Vision"
                      className="w-8 h-8 object-cover"
                    />
                  </div>
                  <span className="hidden sm:inline text-[13px] font-semibold tracking-[0.18em] uppercase text-[#111827] font-sans">
                    TunnelVision
                  </span>
                </button>

                {/* Center / right controls */}
                <div className="flex items-center gap-2 md:gap-4 text-[11px] font-semibold tracking-[0.18em] uppercase">
                  {/* Desktop nav */}
                  <div className="hidden sm:flex items-center gap-2 md:gap-3">
                    {/* Made For dropdown - feature panel */}
                    <div
                      ref={madeForRef}
                      className="relative pb-2"
                      onMouseEnter={() => setOpenDropdown("madeFor")}
                      onMouseLeave={() => setOpenDropdown(null)}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenDropdown((cur) =>
                            cur === "madeFor" ? null : "madeFor",
                          )
                        }
                        className={`relative inline-flex items-center gap-1 px-3 py-1 rounded-full text-[#111827] font-semibold tracking-[0.18em] transition-all duration-200 ${
                          openDropdown === "madeFor"
                            ? "bg-[#F1F5F9] text-[#111827]"
                            : "hover:bg-[#F1F5F9] hover:text-[#111827]"
                        }`}
                      >
                        <span className="leading-none">Made For</span>
                        <span className="text-[10px] leading-none">
                          {openDropdown === "madeFor" ? "▲" : "▼"}
                        </span>
                      </button>
                      {openDropdown === "madeFor" && (
                        <div className="absolute right-0 mt-4 w-[480px] rounded-lg bg-white border border-[#E5E7EB] shadow-[0_4px_12px_rgba(0,0,0,0.08)] overflow-hidden animate-fade-in">
                          <div className="px-6 py-6 space-y-4">
                            <p className="text-[10px] uppercase tracking-[0.28em] text-[#6B7280]">
                              Made For
                            </p>
                            <div className="grid md:grid-cols-3 gap-4">
                              <button
                                type="button"
                                onClick={() => {
                                  scrollToSection(performanceRef);
                                  setOpenDropdown(null);
                                }}
                                className="group flex flex-col items-start rounded-lg bg-[#F8FAFC] border border-[#E5E7EB] px-4 py-4 text-left hover:bg-[#F1F5F9] hover:-translate-y-0.5 transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#6366F1]/20 text-[10px]">
                                  ⚡
                                </span>
                                <span className="text-sm font-semibold text-[#111827]">
                                  Performance
                                </span>
                                <span className="mt-1 text-xs text-[#6B7280] leading-relaxed">
                                  Track your task performance and push your
                                  limits.
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  scrollToSection(habitRef);
                                  setOpenDropdown(null);
                                }}
                                className="group flex flex-col items-start rounded-lg bg-[#F8FAFC] border border-[#E5E7EB] px-4 py-4 text-left hover:bg-[#F1F5F9] hover:-translate-y-0.5 transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#6366F1]/15 text-[10px]">
                                  🌱
                                </span>
                                <span className="text-sm font-semibold text-[#111827]">
                                  Habit Building
                                </span>
                                <span className="mt-1 text-xs text-[#6B7280] leading-relaxed">
                                  Turn discipline into a daily habit.
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  scrollToSection(timeRef);
                                  setOpenDropdown(null);
                                }}
                                className="group flex flex-col items-start rounded-lg bg-[#F8FAFC] border border-[#E5E7EB] px-4 py-4 text-left hover:bg-[#F1F5F9] hover:-translate-y-0.5 transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-[#6366F1]/15 text-[10px]">
                                  ⏱
                                </span>
                                <span className="text-sm font-semibold text-[#111827]">
                                  Time Management
                                </span>
                                <span className="mt-1 text-xs text-[#6B7280] leading-relaxed">
                                  Take control of your schedule and priorities.
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Resources dropdown */}
                    <div
                      ref={resourcesRef}
                      className="relative pb-2"
                      onMouseEnter={() => setOpenDropdown("resources")}
                      onMouseLeave={() => setOpenDropdown(null)}
                    >
                      <button
                        type="button"
                        onClick={() =>
                          setOpenDropdown((cur) =>
                            cur === "resources" ? null : "resources",
                          )
                        }
                        className={`relative inline-flex items-center gap-1 px-3 py-1 rounded-full text-[#111827] font-semibold tracking-[0.18em] transition-all duration-200 ${
                          openDropdown === "resources"
                            ? "bg-[#F1F5F9] text-[#111827]"
                            : "hover:bg-[#F1F5F9] hover:text-[#111827]"
                        }`}
                      >
                        <span className="leading-none">Resources</span>
                        <span className="text-[10px] leading-none">
                          {openDropdown === "resources" ? "▲" : "▼"}
                        </span>
                      </button>
                      {openDropdown === "resources" && (
                        <div className="absolute right-0 mt-4 w-64 rounded-lg bg-white border border-[#E5E7EB] shadow-[0_4px_12px_rgba(0,0,0,0.08)] overflow-hidden animate-fade-in">
                          <div className="py-3">
                            {["Guides", "Tutorials", "Documentation"].map(
                              (item) => (
                                <button
                                  key={item}
                                  type="button"
                                  className="w-full text-left px-4 py-2.5 text-[12px] font-medium text-[#111827] hover:bg-[#F1F5F9] transition-colors duration-150"
                                >
                                  {item}
                                </button>
                              ),
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Get Started CTA – match hero button */}
                  <button
                    type="button"
                    onClick={handleGetStarted}
                    className="hidden sm:inline-flex group relative px-10 py-3 bg-[#6366F1] rounded-lg overflow-hidden transition-all duration-200 hover:bg-[#4f46e5] active:scale-[0.97]"
                  >
                    <span className="relative text-[13px] font-semibold tracking-wide uppercase text-white">
                      Get Started
                    </span>
                  </button>

                  {/* Mobile hamburger */}
                  <button
                    type="button"
                    className="sm:hidden inline-flex items-center justify-center rounded-full border border-[#E5E7EB] bg-[#F8FAFC] w-9 h-9 hover:bg-[#F1F5F9] transition-all duration-200"
                    onClick={() => setIsMobileMenuOpen((v) => !v)}
                  >
                    <span className="sr-only">Toggle navigation</span>
                    <div className="flex flex-col gap-1.5">
                      <span className="w-4 h-0.5 bg-[#111827] rounded-full" />
                      <span className="w-4 h-0.5 bg-[#111827] rounded-full" />
                    </div>
                  </button>
                </div>

                {/* Mobile menu panel */}
                {isMobileMenuOpen && (
                  <div className="sm:hidden mt-3 rounded-lg bg-white border border-[#E5E7EB] shadow-[0_4px_12px_rgba(0,0,0,0.08)] px-4 py-4 space-y-4 text-[11px] tracking-[0.18em] uppercase">
                    <div className="space-y-2">
                      <p className="text-[10px] text-[#6B7280]">Made For</p>
                      <button
                        type="button"
                        onClick={() => scrollToSection(performanceRef)}
                        className="w-full text-left px-3 py-2 rounded-lg bg-[#F8FAFC] text-[#111827] hover:bg-[#F1F5F9] transition-colors"
                      >
                        Performance
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToSection(habitRef)}
                        className="w-full text-left px-3 py-2 rounded-lg bg-[#F8FAFC] text-[#111827] hover:bg-[#F1F5F9] transition-colors"
                      >
                        Habit Building
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToSection(timeRef)}
                        className="w-full text-left px-3 py-2 rounded-lg bg-[#F8FAFC] text-[#111827] hover:bg-[#F1F5F9] transition-colors"
                      >
                        Time Management
                      </button>
                    </div>
                    <div className="space-y-2 pt-2">
                      <p className="text-[10px] text-[#6B7280]">Resources</p>
                      {["Guides", "Tutorials", "Documentation"].map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="w-full text-left px-3 py-2 rounded-lg bg-[#F8FAFC] text-[#111827] hover:bg-[#F1F5F9] transition-colors"
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleGetStarted}
                      className="w-full mt-3 group relative px-6 py-3 bg-[#6366F1] rounded-lg overflow-hidden transition-all duration-200 hover:bg-[#4f46e5] active:scale-[0.97]"
                    >
                      <span className="relative text-[13px] font-semibold tracking-wide uppercase text-white">
                        Get Started
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          </nav>
        )}

        {/* APP SHELL LAYOUT (dashboard — includes focus session) */}
        {!isSimulation && (
          <>
          {focusEnterZenActive && zenOverlayOrigin && (
            <div
              className={`fixed inset-0 z-[265] overflow-hidden ${
                focusZenFadeOut
                  ? "opacity-0 transition-opacity duration-[2200ms] ease-out"
                  : "opacity-100"
              } ${
                focusEnterZenBlocking && !focusZenFadeOut
                  ? "pointer-events-auto cursor-wait"
                  : "pointer-events-none"
              }`}
              aria-hidden
            >
              <div className="absolute inset-0 bg-[#EEF2FF]/60 focus-zen-mist-overlay" />
              <div className="absolute inset-0 bg-white/40 opacity-90" />
              <div
                className="absolute w-0 h-0 overflow-visible"
                style={{
                  left: zenOverlayOrigin.x,
                  top: zenOverlayOrigin.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="focus-zen-bloom-core" />
                {Array.from({ length: 6 }).map((_, i) => (
                  <div
                    key={i}
                    className={`focus-zen-ripple-ring ${i === 5 ? "focus-zen-ripple-ring-slow" : ""}`}
                    style={{ animationDelay: `${i * 380}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="h-screen min-h-0 flex w-full bg-[#FAFAFA] text-[#111827] overflow-hidden">
            {/* ── Sidebar (Todoist-style) ── */}
            {!isFocusSessionActive && (
              <div
                className={`relative flex h-full shrink-0 overflow-hidden border-r border-[#E8E6E3] bg-white transition-[width,min-width] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] z-[250] ${sidebarCollapsed ? "w-0 min-w-0 border-r-0" : "w-[min(19vw,320px)] min-w-[280px]"}`}
              >
                <aside className="app-sidebar flex h-full w-full min-w-[280px] max-w-[320px] flex-col bg-white">
                  <div className="shrink-0 flex h-[52px] items-center gap-1.5 border-b border-[#E8E6E3] px-4 py-3">
                    <div ref={sidebarUserMenuRef} className="relative min-w-0 flex-1">
                      <button
                        type="button"
                        onClick={() => setSidebarUserMenuOpen((v) => !v)}
                        className="flex w-full min-w-0 items-center gap-2 rounded-[5px] py-1.5 pl-1 pr-1 text-left transition-colors hover:bg-[#eeeeee]"
                        aria-expanded={sidebarUserMenuOpen}
                        aria-haspopup="menu"
                      >
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#db4c3f] text-[12px] font-semibold text-white ring-2 ring-[#db4c3f] ring-offset-2 ring-offset-white">
                          U
                        </span>
                        <span className="min-w-0 truncate text-[13px] font-semibold leading-tight text-[#202020]">
                          User
                        </span>
                        <svg className="ml-0.5 h-3.5 w-3.5 shrink-0 text-[#666666]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      </button>
                      {sidebarUserMenuOpen && (
                        <div
                          className="absolute left-0 top-[calc(100%+4px)] z-[400] w-[min(220px,calc(100vw-24px))] rounded-lg border border-[#E5E5E5] bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
                          role="menu"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="w-full px-3 py-2 text-left text-[13px] text-[#202020] hover:bg-[#F5F5F5]"
                            onClick={() => setSidebarUserMenuOpen(false)}
                          >
                            Settings
                          </button>
                        </div>
                      )}
                    </div>
                    <button
                      ref={notificationsButtonRef}
                      type="button"
                      onClick={handleNotificationsButtonClick}
                      aria-expanded={notificationsPanelOpen}
                      aria-haspopup="dialog"
                      aria-label="Notifications"
                      className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] text-[#666666] transition-colors hover:bg-[#eeeeee]"
                    >
                      {hasUnreadNotifications && (
                        <span className="absolute right-1.5 top-1.5 z-[1] h-1.5 w-1.5 rounded-full bg-[#db4c3f] ring-2 ring-white" aria-hidden />
                      )}
                      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" />
                        <path d="M13.73 21a2 2 0 01-3.46 0" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSidebarCollapsed(true)}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[5px] text-[#666666] transition-colors hover:bg-[#eeeeee]"
                      aria-label="Collapse sidebar"
                      title="Collapse sidebar"
                    >
                      <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <rect x="4" y="5" width="16" height="14" rx="1.5" />
                        <line x1="9" y1="5" x2="9" y2="19" />
                      </svg>
                    </button>
                  </div>

                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden overscroll-contain px-4 pb-3 pt-3">
                    <div className="sidebar-focus-today-wrap mb-1">
                      <button
                        type="button"
                        onClick={() => {
                          if (isFocusTimerRunning) {
                            setFocusSessionDialog({
                              kind: "quit",
                              pending: { action: "inboxAndFocus" },
                            });
                            return;
                          }
                          if (focusEnterZenActive) cancelFocusEnterZen();
                          if (isFocusSessionActive) cleanupFocusSessionAfterQuit();
                          setActiveView("tasks");
                          applyListSelection(SYS_LIST_INBOX);
                          queueMicrotask(() => taskListInputRef.current?.focus());
                        }}
                        className="sidebar-focus-cta"
                      >
                        <span className="sidebar-focus-cta-ring" aria-hidden>
                          <svg viewBox="0 0 24 24" className="sidebar-focus-cta-plus" fill="none" aria-hidden>
                            <line x1="12" y1="8" x2="12" y2="16" stroke="white" strokeWidth="2.25" strokeLinecap="round" />
                            <line x1="8" y1="12" x2="16" y2="12" stroke="white" strokeWidth="2.25" strokeLinecap="round" />
                          </svg>
                        </span>
                        <span className="sidebar-focus-cta-label">Add task</span>
                      </button>
                    </div>

                    <nav className="flex flex-col gap-px" aria-label="Tasks">
                      <button
                        type="button"
                        onClick={() => {
                          if (isFocusTimerRunning) {
                            setFocusSessionDialog({
                              kind: "quit",
                              pending: { action: "search" },
                            });
                            return;
                          }
                          if (focusEnterZenActive) cancelFocusEnterZen();
                          if (isFocusSessionActive) cleanupFocusSessionAfterQuit();
                          setActiveView("tasks");
                          setTodayMainMode("search");
                          queueMicrotask(() => {
                            taskSearchInputRef.current?.focus();
                            taskSearchInputRef.current?.select();
                          });
                        }}
                        className={`sidebar-nav-item ${activeView === "tasks" && todayMainMode === "search" ? "sidebar-nav-item--active" : ""}`}
                      >
                        <span className="sidebar-icon-slot">
                          <SidebarSearchIcon active={activeView === "tasks" && todayMainMode === "search"} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">Search</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          handleSidebarNavClick("tasks");
                          handleSelectList(SYS_LIST_INBOX);
                          setTodayMainMode("tasks");
                        }}
                        className={`sidebar-nav-item ${
                          activeView === "tasks" &&
                          todayMainMode === "tasks" &&
                          selectedListId === SYS_LIST_INBOX
                            ? "sidebar-nav-item--active"
                            : ""
                        }`}
                      >
                        <span className="sidebar-icon-slot">
                          <SidebarPrimaryListIcon
                            listId={SYS_LIST_INBOX}
                            active={
                              activeView === "tasks" &&
                              todayMainMode === "tasks" &&
                              selectedListId === SYS_LIST_INBOX
                            }
                          />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">Inbox</span>
                        {(tasksByListId[SYS_LIST_INBOX] ?? []).filter((t) => !t.completed && !t.removing).length > 0 ? (
                          <span className="sidebar-badge-muted shrink-0">
                            {(tasksByListId[SYS_LIST_INBOX] ?? []).filter((t) => !t.completed && !t.removing).length}
                          </span>
                        ) : null}
                      </button>
                      {SIDEBAR_PRIMARY_LIST_NAV.map((row) => {
                        const n = (tasksByListId[row.id] ?? []).filter((t) => !t.completed && !t.removing).length;
                        const isActive =
                          activeView === "tasks" &&
                          todayMainMode === "tasks" &&
                          selectedListId === row.id;
                        return (
                          <button
                            key={row.id}
                            type="button"
                            onClick={() => {
                              handleSidebarNavClick("tasks");
                              handleSelectList(row.id);
                              setTodayMainMode("tasks");
                            }}
                            className={`sidebar-nav-item ${isActive ? "sidebar-nav-item--active" : ""}`}
                          >
                            <span className="sidebar-icon-slot">
                              <SidebarPrimaryListIcon listId={row.id} active={isActive} />
                            </span>
                            <span className="min-w-0 flex-1 truncate text-left">{row.label}</span>
                            {n > 0 ? <span className="sidebar-badge-muted shrink-0">{n}</span> : null}
                          </button>
                        );
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          if (isFocusTimerRunning) {
                            setFocusSessionDialog({ kind: "quit", pending: { action: "completed" } });
                            return;
                          }
                          if (focusEnterZenActive) cancelFocusEnterZen();
                          if (isFocusSessionActive) cleanupFocusSessionAfterQuit();
                          setCollapsedCompletedDates({});
                          handleSidebarNavClick("tasks");
                          setTodayMainMode("completed");
                        }}
                        className={`sidebar-nav-item ${activeView === "tasks" && todayMainMode === "completed" ? "sidebar-nav-item--active" : ""}`}
                      >
                        <span className="sidebar-icon-slot">
                          <SidebarCompletedIcon active={activeView === "tasks" && todayMainMode === "completed"} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">Completed</span>
                      </button>
                    </nav>

                    <div className="h-4" />

                    <div className="sidebar-section-label sidebar-section-label--projects mb-1.5 px-0">My Projects</div>
                    <nav className="flex flex-col gap-px" aria-label="My Projects">
                      <button
                        ref={focusNavButtonRef}
                        type="button"
                        onClick={handleStartFocusSession}
                        className="sidebar-nav-item sidebar-nav-item--project"
                      >
                        <span className="sidebar-project-hash" aria-hidden>
                          #
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">Timer</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSidebarNavClick("analytics")}
                        className={`sidebar-nav-item sidebar-nav-item--project ${activeView === "analytics" ? "sidebar-nav-item--active" : ""}`}
                      >
                        <span className="sidebar-project-hash" aria-hidden>
                          #
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">Insights</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSidebarNavClick("calendar")}
                        className={`sidebar-nav-item sidebar-nav-item--project ${activeView === "calendar" ? "sidebar-nav-item--active" : ""}`}
                      >
                        <span className="sidebar-project-hash" aria-hidden>
                          #
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">Schedule</span>
                      </button>
                    </nav>

                    <div className="min-h-[16px] flex-1" />
                  </div>

                  <div className="sidebar-footer-stack shrink-0 border-t border-[#E8E6E3] px-4 py-2">
                    <button type="button" className="sidebar-footer-muted" onClick={() => {}}>
                      <svg className="sidebar-footer-muted-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden>
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                      </svg>
                      <span>Add a team</span>
                    </button>
                    <button type="button" className="sidebar-footer-muted" onClick={() => {}}>
                      <svg className="sidebar-footer-muted-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                        <circle cx="12" cy="12" r="10" />
                        <path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3" />
                        <line x1="12" y1="17" x2="12.01" y2="17" />
                      </svg>
                      <span>Help &amp; resources</span>
                    </button>
                  </div>
                </aside>
              </div>
            )}

            {/* Expand sidebar strip (focus session) */}
            {isFocusSessionActive &&
              isTodayPanelCollapsed &&
              !isTodayPanelAnimatingOut && (
                <button
                  type="button"
                  onClick={() => {
                    setIsTodayPanelCollapsed(false);
                    setIsTodayPanelAnimatingOut(false);
                  }}
                  className="h-full w-7 shrink-0 z-[240] flex flex-col items-center justify-center gap-1 bg-[#FAFAF8] border-r border-[#E8E6E3] text-[#5a5a5a] hover:text-[#202020] hover:bg-[#f3f0ee] transition-colors"
                  aria-label="Expand sidebar"
                  title="Show sidebar"
                >
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}

            {/* ── Main content column ── */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* Top bar (search; notifications live in sidebar) */}
              <div className="relative z-[260] flex h-[52px] shrink-0 items-center gap-3 border-b border-[#E5E7EB] bg-white px-5">
                {!isFocusSessionActive && sidebarCollapsed ? (
                  <button
                    type="button"
                    onClick={() => setSidebarCollapsed(false)}
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-[#5C5C5C] transition-colors hover:bg-[#F5F5F5]"
                    aria-label="Expand sidebar"
                    title="Expand sidebar"
                  >
                    <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                      <rect x="4" y="5" width="16" height="14" rx="1.5" />
                      <line x1="9" y1="5" x2="9" y2="19" />
                    </svg>
                  </button>
                ) : null}
                <div className="relative max-w-[480px] flex-1">
                  <svg className="pointer-events-none absolute left-3.5 top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-[#9CA3AF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" /></svg>
                  <input
                    ref={taskSearchInputRef}
                    value={taskSearchQuery}
                    onChange={(e) => setTaskSearchQuery(e.target.value)}
                    placeholder="Search..."
                    className="h-[36px] w-full rounded-[6px] border border-[#E5E7EB] bg-[#F8FAFC] pl-10 pr-4 text-[14px] text-[#111827] outline-none transition-all placeholder:text-[#9CA3AF] hover:border-[#D1D5DB] focus:border-[#6366F1] focus:bg-white focus:ring-1 focus:ring-[#6366F1]/10"
                  />
                </div>
              </div>

              {/* Notifications dropdown panel */}
              {notificationsPanelOpen && (
                <div
                  ref={notificationsPanelRef}
                  id="app-notifications-panel"
                  role="dialog"
                  aria-label="Notifications"
                  className="pointer-events-auto fixed z-[280] w-[min(340px,calc(100vw-16px))] max-h-[min(420px,calc(100vh-80px))] flex flex-col rounded-[8px] border border-[#E5E7EB] bg-white shadow-[0_4px_16px_rgba(0,0,0,0.08)] overflow-hidden"
                  style={{
                    left: notificationsPanelPos.left,
                    top: notificationsPanelPos.bottom,
                  }}
                >
                  <div className="shrink-0 px-4 pt-3.5 pb-2.5 border-b border-[#E5E7EB]">
                    <h2 className="text-[14px] font-semibold text-[#111827] tracking-tight">
                      Notifications
                    </h2>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                    {notificationItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
                        <svg className="w-8 h-8 text-[#D1D5DB] mb-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 01-3.46 0" /></svg>
                        <p className="text-[14px] font-medium text-[#111827]">
                          No notifications
                        </p>
                        <p className="text-[12px] text-[#9CA3AF] mt-1.5 max-w-[220px] leading-snug">
                          Overdue alerts and due-date reminders appear here.
                        </p>
                      </div>
                    ) : (
                      <ul className="py-1">
                        {notificationItems.map((n, idx) => (
                          <li
                            key={n.id}
                            className="border-b border-[#F1F5F9] last:border-b-0"
                          >
                            <div
                              className={`px-4 py-3 hover:bg-[#F8FAFC] transition-colors ${!n.read ? "app-notif-item--unread" : "app-notif-item"}`}
                              style={{ animationDelay: `${idx * 45}ms` }}
                            >
                              <p className="text-[13px] leading-snug text-[#111827] font-medium">
                                {n.message}
                              </p>
                              <p className="text-[12px] text-[#9CA3AF] mt-1.5 tabular-nums">
                                {formatDueButtonLabel(n.dueDate)}
                              </p>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              <div className="flex-1 min-h-0 flex overflow-hidden">

            {/* Content panel (hidden during focus session — replaced by light focus column) */}
            {!isFocusSessionActive && (
            <section
              className={`flex-1 min-h-0 h-full flex flex-col bg-white ${
                activeView === "tasks" &&
                (todayMainMode === "tasks" ||
                  todayMainMode === "search" ||
                  todayMainMode === "completed")
                  ? "overflow-hidden"
                  : activeView === "calendar"
                    ? "overflow-hidden"
                    : "overflow-y-auto"
              }`}
            >
              <div
                className={`w-full h-full min-h-0 flex flex-col bg-white overflow-hidden ${
                  activeView === "calendar" || activeView === "analytics"
                    ? "flex-1 min-h-0"
                    : ""
                }`}
              >
                {activeView === "tasks" && todayMainMode === "completed" ? (
                  <div className="w-full flex-1 min-h-0 flex flex-col overflow-hidden bg-white">
                    <header className="shrink-0 flex items-center gap-3 px-5 h-[40px] border-b border-[#E5E7EB]">
                      <button type="button" onClick={() => setSidebarCollapsed((c) => !c)} className="inline-flex items-center justify-center w-8 h-8 rounded-lg text-[#6B7280] hover:bg-[#F1F5F9] transition-colors" aria-label="Toggle sidebar">
                        <svg className="w-[17px] h-[17px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><line x1="4" y1="6" x2="20" y2="6" /><line x1="4" y1="12" x2="20" y2="12" /><line x1="4" y1="18" x2="20" y2="18" /></svg>
                      </button>
                      <svg className="w-[18px] h-[18px] text-[#6B7280] shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 11-5.93-9.14" /><path d="M22 4L12 14.01l-3-3" /></svg>
                      <h2 className="text-[15px] font-semibold text-[#111827] tracking-tight">Completed</h2>
                    </header>
                    <div className="flex-1 min-h-0 overflow-y-auto">
                      {completedGroups.length === 0 ? (
                        <div className="flex flex-col items-center justify-center min-h-[280px]">
                          <svg className="w-[80px] h-[80px] mb-3 opacity-70" viewBox="0 0 120 120" fill="none"><circle cx="60" cy="60" r="50" fill="#f4f4f5"/><circle cx="60" cy="55" r="25" fill="#e4e4e7"/><path d="M45 85c0-8.28 6.72-15 15-15s15 6.72 15 15" fill="#d4d4d8"/><circle cx="48" cy="50" r="3" fill="#a1a1aa"/><circle cx="72" cy="50" r="3" fill="#a1a1aa"/><path d="M52 60c0 0 4 5 8 5s8-5 8-5" stroke="#a1a1aa" strokeWidth="2" strokeLinecap="round"/></svg>
                          <p className="text-[14px] font-medium text-[#6B7280]">No completed tasks yet</p>
                          <p className="text-[12px] text-[#9CA3AF] mt-0.5">Complete some tasks and they'll show up here</p>
                        </div>
                      ) : (
                        <div>
                          {completedGroups.map((group) => {
                            const isCollapsed = collapsedCompletedDates[group.dateStr] ?? false;
                            return (
                              <div key={group.dateStr} className="border-b border-[#E5E7EB]">
                                <button type="button" onClick={() => setCollapsedCompletedDates((prev) => ({ ...prev, [group.dateStr]: !isCollapsed }))} className="w-full flex items-center gap-2 px-5 py-2 text-left hover:bg-[#F8FAFC] transition-colors">
                                  <svg className={`w-3 h-3 text-[#9CA3AF] transition-transform duration-150 ${isCollapsed ? "" : "rotate-90"}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                                  <span className="flex-1 text-[13px] font-semibold text-[#111827]">{group.label}</span>
                                  <span className="text-[11px] text-[#9CA3AF] font-medium tabular-nums">{group.items.length}</span>
                                </button>
                                {!isCollapsed && (
                                  <div className="divide-y divide-[#E5E7EB]">
                                    {group.items.map((item) => (
                                      <div key={item.key} className="flex items-center gap-2.5 px-5 py-2 pl-12 hover:bg-[#F8FAFC]/50 transition-colors">
                                        <span className="shrink-0 w-[16px] h-[16px] rounded-full bg-emerald-500 flex items-center justify-center"><span className="text-white text-[9px] leading-none">✓</span></span>
                                        <span className="flex-1 min-w-0 text-[13px] text-[#9CA3AF] line-through truncate">{item.taskName}</span>
                                        <span className="shrink-0 text-[11px] text-[#9CA3AF] tabular-nums">{item.minutes}m</span>
                                        <span className="shrink-0 text-[10px] text-[#9CA3AF] truncate max-w-[100px]">{item.listLabel}</span>
                                      </div>
                                    ))}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                ) : activeView === "tasks" &&
                  (todayMainMode === "tasks" || todayMainMode === "search") ? (
                  <div className="w-full flex-1 min-h-0 flex flex-col overflow-hidden bg-white">
                    <div className="shrink-0 border-b border-[#E5E7EB] px-5 py-3">
                      <div className="flex items-center gap-2.5">
                        {selectedListId ? (
                          <SidebarPrimaryListIcon listId={selectedListId} active className="h-5 w-5 shrink-0" />
                        ) : null}
                        <h2 className="text-[15px] font-semibold leading-tight tracking-tight text-[#111827]">
                          {todayMainMode === "search"
                            ? "Search"
                            : selectedList?.label ??
                              SIDEBAR_PRIMARY_LIST_NAV.find((r) => r.id === selectedListId)?.label ??
                              "Tasks"}
                        </h2>
                      </div>
                    </div>

                    <div className="shrink-0 flex items-center h-[32px] px-6 border-b border-[#E5E7EB] bg-[#F8FAFC] text-[10.5px] font-semibold uppercase tracking-wider text-[#6B7280]">
                      <div className="w-[28px] shrink-0" />
                      <div className="flex-1 min-w-0">Name</div>
                      <div className="w-[120px] shrink-0 text-center">Priority <span className="text-[#6366F1] font-semibold">AI</span></div>
                      <div className="w-[120px] shrink-0 text-center">Class</div>
                      <div className="w-[32px] shrink-0" />
                    </div>

                    {/* ── Task List ── */}
                    <div className="relative flex-1 min-h-0 overflow-y-auto">
                      {completionBurstTier ? (<div className={`pointer-events-none absolute inset-0 z-[1] rounded-lg micro-completion-burst--${completionBurstTier}`} aria-hidden />) : null}

                      {!selectedListId ? (
                        <div className="px-6 py-10 text-[#9CA3AF] text-[14px] text-center">Select a category to view tasks</div>
                      ) : (() => {
                        const searchQ = taskSearchQuery.toLowerCase().trim();
                        const filtered = searchQ ? visibleTasksForList.filter((t) => t.text.toLowerCase().includes(searchQ)) : visibleTasksForList;
                        const todoTasks = filtered.filter((t) => !t.completed);
                        const doneTasks = filtered.filter((t) => t.completed);

                        if (filtered.length === 0) {
                          if (allElasticListTasksComplete) {
                            return (
                              <div className="flex flex-col items-center justify-center min-h-[280px]">
                                <svg className="w-[100px] h-[100px] mb-5" viewBox="0 0 200 200" fill="none">
                                  <circle cx="100" cy="100" r="80" fill="#f8fafc" />
                                  <circle cx="100" cy="85" r="35" fill="#e0e7ff" />
                                  <circle cx="85" cy="78" r="4" fill="#818cf8" />
                                  <circle cx="115" cy="78" r="4" fill="#818cf8" />
                                  <path d="M88 92c0 0 5 7 12 7s12-7 12-7" stroke="#818cf8" strokeWidth="2.5" strokeLinecap="round" />
                                  <path d="M60 130c0 0 15-10 40-10s40 10 40 10" stroke="#c7d2fe" strokeWidth="3" strokeLinecap="round" />
                                  <circle cx="145" cy="55" r="6" fill="#fbbf24" opacity="0.6" />
                                  <circle cx="55" cy="60" r="4" fill="#fbbf24" opacity="0.4" />
                                  <circle cx="160" cy="80" r="3" fill="#c4b5fd" opacity="0.5" />
                                  <path d="M70 45l3-8 3 8-8-5h10z" fill="#fcd34d" opacity="0.5" />
                                  <path d="M140 35l2-6 2 6-6-4h8z" fill="#c4b5fd" opacity="0.4" />
                                </svg>
                                <p className="text-[14px] font-semibold text-[#6B7280]">No upcoming items in this category</p>
                                <p className="text-[12px] text-[#9CA3AF] mt-0.5">Enjoy a free day!</p>
                              </div>
                            );
                          }
                          if (selectedListId === SYS_LIST_OVERDUE) {
                            return (
                              <div className="flex flex-col items-center justify-center min-h-[280px]">
                                <svg className="w-[100px] h-[100px] mb-4" viewBox="0 0 200 200" fill="none">
                                  <circle cx="100" cy="100" r="80" fill="#f0fdf4" />
                                  <circle cx="100" cy="85" r="35" fill="#dcfce7" />
                                  <circle cx="85" cy="78" r="4" fill="#22c55e" />
                                  <circle cx="115" cy="78" r="4" fill="#22c55e" />
                                  <path d="M88 92c0 0 5 7 12 7s12-7 12-7" stroke="#22c55e" strokeWidth="2.5" strokeLinecap="round" />
                                  <path d="M60 130c0 0 15-10 40-10s40 10 40 10" stroke="#bbf7d0" strokeWidth="3" strokeLinecap="round" />
                                  <circle cx="145" cy="55" r="6" fill="#fbbf24" opacity="0.6" />
                                  <circle cx="55" cy="60" r="4" fill="#fbbf24" opacity="0.4" />
                                  <path d="M70 45l3-8 3 8-8-5h10z" fill="#86efac" opacity="0.5" />
                                </svg>
                                <p className="text-[14px] font-semibold text-[#6B7280]">Nothing overdue — nice work!</p>
                                <p className="text-[12px] text-[#9CA3AF] mt-0.5">Enjoy a free day!</p>
                              </div>
                            );
                          }
                          return (
                            <div className={`flex flex-col items-center justify-center min-h-[280px] ${listEmptyExit ? "micro-empty-out" : ""}`}>
                              <svg className="w-[100px] h-[100px] mb-5" viewBox="0 0 200 200" fill="none">
                                <circle cx="100" cy="100" r="80" fill="#faf5ff" />
                                <circle cx="100" cy="85" r="35" fill="#ede9fe" />
                                <circle cx="90" cy="80" r="3" fill="#8b5cf6" />
                                <circle cx="110" cy="80" r="3" fill="#8b5cf6" />
                                <path d="M93 95 a8 5 0 0 0 14 0" stroke="#8b5cf6" strokeWidth="2" strokeLinecap="round" />
                                <rect x="75" y="110" width="50" height="30" rx="8" fill="#ede9fe" />
                                <circle cx="148" cy="50" r="5" fill="#fbbf24" opacity="0.5" />
                                <circle cx="52" cy="55" r="3.5" fill="#c4b5fd" opacity="0.5" />
                                <path d="M65 40l2.5-7 2.5 7-7-4.5h9z" fill="#fcd34d" opacity="0.4" />
                              </svg>
                              <p className="text-[14px] font-semibold text-[#6B7280]">No upcoming items in this category</p>
                              <p className="text-[12px] text-[#9CA3AF] mt-0.5">Enjoy a free day!</p>
                            </div>
                          );
                        }

                        return (
                          <div className="flex flex-col">
                            {todoTasks.length > 0 && (
                              <div className={listFirstTaskEnter ? "micro-list-shell-in" : ""}>
                                {todoTasks.map((t) => {
                                  const isSelected = selectedTaskId === t.id;
                                  const priorityLabel = (() => {
                                    if (!t.dueDate) return { text: "Normal", color: "text-[#9CA3AF]", flag: "🏳️" };
                                    const now = new Date(); const due = parseISODate(t.dueDate);
                                    const diff = Math.ceil((due.getTime() - now.getTime()) / 86400000);
                                    if (diff < 0) return { text: "Urgent", color: "text-red-500", flag: "🚩" };
                                    if (diff === 0) return { text: "Urgent", color: "text-red-500", flag: "🚩" };
                                    if (diff <= 2) return { text: "High", color: "text-orange-500", flag: "🔶" };
                                    if (diff <= 5) return { text: "Normal", color: "text-yellow-500", flag: "🟡" };
                                    return { text: "Low", color: "text-[#9CA3AF]", flag: "🏳️" };
                                  })();
                                  const classLabel = selectedListId === SYS_LIST_TODAY ? "Today" : selectedListId === SYS_LIST_OVERDUE ? "Overdue" : selectedListId === SYS_LIST_PROJECTS ? "Projects" : selectedListId === SYS_LIST_TESTS ? "Tests" : selectedListId === SYS_LIST_LONGTERM ? "Long-Term" : selectedList?.label ?? "—";
                                  return (
                                    <div key={t.id} role="button" tabIndex={0} onClick={() => setSelectedTaskId(isSelected ? null : t.id)} onKeyDown={(e) => { if (e.key === "Enter") setSelectedTaskId(isSelected ? null : t.id); }} className={`group flex items-center h-[36px] px-6 cursor-pointer transition-colors duration-100 border-b border-[#E5E7EB] ${taskRowExitingId === t.id ? "opacity-0 pointer-events-none" : ""} ${taskReappearId === t.id ? "animate-task-reappear" : ""} ${newListTaskAnimId === t.id ? "micro-row-enter" : ""} ${isSelected ? "bg-[#EEF2FF]" : "hover:bg-[#F8FAFC]"}`}>
                                      <div className="w-[28px] shrink-0 flex items-center justify-center">
                                        <button type="button" disabled={taskCheckAnimatingId === t.id} onClick={(e) => { e.stopPropagation(); const next = !t.completed; if (!selectedListId) return; if (next && listUsesElasticComplete) { scheduleElasticListTaskComplete(t, selectedListId, selectedList?.label ?? ""); return; } if (next) { appendCompletedActivity(t.text, 0, selectedListId, selectedList?.label ?? ""); } else { removeLastCompletedForTaskOnList(t.text, selectedListId); } setTasks((prev) => prev.map((x) => x.id === t.id ? { ...x, completed: next } : x)); }} className={`btn-press-instant w-[16px] h-[16px] rounded-full border-[1.5px] flex items-center justify-center transition-colors disabled:opacity-100 ${t.completed || taskCheckAnimatingId === t.id ? "border-emerald-500 bg-emerald-500" : "border-[#D1D5DB] hover:border-[#9CA3AF]"} ${taskCheckAnimatingId === t.id ? "elastic-cb-pulse" : ""}`} aria-label={t.completed ? "Mark incomplete" : "Complete task"}>
                                          {listUsesElasticComplete && taskCheckAnimatingId === t.id ? (<svg className="w-[9px] h-[9px]" viewBox="0 0 12 12" fill="none" aria-hidden><path className="elastic-check-path-draw" d="M2.5 6.2 L5 8.8 L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>) : t.completed ? (<span className="text-white text-[8px] leading-none">✓</span>) : null}
                                        </button>
                                      </div>
                                      <div className="flex-1 min-w-0 text-[13px] text-[#111827] truncate">{t.text}</div>
                                      <div className={`w-[120px] shrink-0 flex items-center justify-center gap-1 text-[12px] ${priorityLabel.color}`}>
                                        <span className="text-[11px]">{priorityLabel.flag}</span>
                                        <span className="font-medium">{priorityLabel.text}</span>
                                      </div>
                                      <div className="w-[120px] shrink-0 text-center text-[12px] text-[#9CA3AF]">{classLabel}</div>
                                      <div className="w-[32px] shrink-0 flex items-center justify-center">
                                        <button type="button" onClick={(e) => { e.stopPropagation(); if (!selectedListId) return; if (deleteUndoToastTimerRef.current) { clearTimeout(deleteUndoToastTimerRef.current); deleteUndoToastTimerRef.current = null; } setTasks((prev) => prev.filter((x) => x.id !== t.id)); if (selectedTaskId === t.id) setSelectedTaskId(null); setDeleteUndoToast({ task: { ...t }, listId: selectedListId }); deleteUndoToastTimerRef.current = setTimeout(() => { setDeleteUndoToast(null); deleteUndoToastTimerRef.current = null; }, 8000); }} className="btn-press-instant w-6 h-6 rounded-md text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F1F5F9] opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-[11px]" aria-label="Delete task">✕</button>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            )}

                            {/* Inline Add Task */}
                            {selectedListId !== SYS_LIST_OVERDUE && (
                              <div className="flex items-center h-[42px] px-5 border-b border-[#E5E7EB] bg-[#F8FAFC] hover:bg-white transition-colors cursor-text" onClick={() => taskListInputRef.current?.focus()}>
                                <div className="w-[28px] shrink-0 flex items-center justify-center">
                                  <svg className="w-[13px] h-[13px] text-[#6366F1]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 5v14M5 12h14" /></svg>
                                </div>
                                <input ref={taskListInputRef} value={taskInput} onChange={(e) => setTaskInput(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTaskFromListInput({ fromEnter: true }); } }} placeholder={taskInputPlaceholder(selectedListId)} disabled={!selectedListId} className={`flex-1 min-w-0 h-full bg-transparent text-[13px] text-[#111827] placeholder:text-[#6B7280] outline-none disabled:opacity-50 ${taskInputClearFlash ? "opacity-40" : ""}`} />
                              </div>
                            )}

                            {doneTasks.length > 0 && (
                              <>
                                <div className="flex items-center gap-1.5 px-5 pt-3 pb-1">
                                  <svg className="w-3 h-3 text-[#9CA3AF]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 18l6-6-6-6" /></svg>
                                  <span className="inline-flex items-center gap-1 text-[10.5px] font-semibold uppercase tracking-wider text-[#9CA3AF]">Done</span>
                                  <span className="text-[10.5px] font-medium text-[#9CA3AF] tabular-nums">{doneTasks.length}</span>
                                </div>
                                <div>
                                  {doneTasks.map((t) => {
                                    const classLabel = selectedListId === SYS_LIST_TODAY ? "Today" : selectedListId === SYS_LIST_OVERDUE ? "Overdue" : selectedListId === SYS_LIST_PROJECTS ? "Projects" : selectedListId === SYS_LIST_TESTS ? "Tests" : selectedListId === SYS_LIST_LONGTERM ? "Long-Term" : selectedList?.label ?? "—";
                                    return (
                                      <div key={t.id} className={`group flex items-center h-[36px] px-6 border-b border-[#F1F5F9] ${taskRowExitingId === t.id ? "opacity-0 pointer-events-none" : ""}`}>
                                        <div className="w-[28px] shrink-0 flex items-center justify-center">
                                          <button type="button" disabled={taskCheckAnimatingId === t.id} onClick={(e) => { e.stopPropagation(); if (!selectedListId) return; removeLastCompletedForTaskOnList(t.text, selectedListId); setTasks((prev) => prev.map((x) => x.id === t.id ? { ...x, completed: false } : x)); }} className="btn-press-instant w-[16px] h-[16px] rounded-full border-[1.5px] border-emerald-500 bg-emerald-500 flex items-center justify-center transition-colors disabled:opacity-100" aria-label="Mark incomplete"><span className="text-white text-[8px] leading-none">✓</span></button>
                                        </div>
                                        <div className="flex-1 min-w-0 text-[13px] text-[#9CA3AF] line-through truncate">{t.text}</div>
                                        <div className="w-[120px] shrink-0 text-center text-[12px] text-[#9CA3AF]">—</div>
                                        <div className="w-[120px] shrink-0 text-center text-[12px] text-[#9CA3AF]">{classLabel}</div>
                                        <div className="w-[32px] shrink-0 flex items-center justify-center">
                                          <button type="button" onClick={(e) => { e.stopPropagation(); if (!selectedListId) return; if (deleteUndoToastTimerRef.current) { clearTimeout(deleteUndoToastTimerRef.current); deleteUndoToastTimerRef.current = null; } setTasks((prev) => prev.filter((x) => x.id !== t.id)); setDeleteUndoToast({ task: { ...t }, listId: selectedListId }); deleteUndoToastTimerRef.current = setTimeout(() => { setDeleteUndoToast(null); deleteUndoToastTimerRef.current = null; }, 8000); }} className="btn-press-instant w-6 h-6 rounded-md text-[#9CA3AF] hover:text-[#6B7280] hover:bg-[#F1F5F9] opacity-0 group-hover:opacity-100 transition-all flex items-center justify-center text-[11px]" aria-label="Delete task">✕</button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    <MiniDueDatePopover
                      open={dueDatePopover !== null}
                      anchor={dueDatePopover?.anchor ?? null}
                      selectedIso={dueDatePopover ? tasks.find((x) => x.id === dueDatePopover.taskId)?.dueDate ?? null : null}
                      onSelect={(iso) => { const tid = dueDatePopover?.taskId; if (tid == null) return; setTasks((prev) => prev.map((x) => x.id === tid ? { ...x, dueDate: iso } : x)); setDueDatePopover(null); }}
                      onClose={() => setDueDatePopover(null)}
                    />
                  </div>
                ) : (
                  <div
                    className={`pointer-events-auto ${
                      activeView === "calendar" || activeView === "analytics"
                        ? "flex-1 min-h-0 flex flex-col"
                        : "min-h-[60vh]"
                    }`}
                  >
                    {activeView === "tasks" ? null : activeView === "calendar" ? (
                      <TasksDueCalendarMonth
                        monthStart={calendarMonthStart}
                        tasksByDate={tasksByDueDate}
                        todayIso={calendarDay}
                        onPrevMonth={() =>
                          setCalendarMonthStart(
                            (d) =>
                              new Date(d.getFullYear(), d.getMonth() - 1, 1),
                          )
                        }
                        onNextMonth={() =>
                          setCalendarMonthStart(
                            (d) =>
                              new Date(d.getFullYear(), d.getMonth() + 1, 1),
                          )
                        }
                        onTodayMonth={() => {
                          const n = new Date();
                          setCalendarMonthStart(
                            new Date(n.getFullYear(), n.getMonth(), 1),
                          );
                        }}
                        onTaskPick={openTaskFromCalendar}
                      />
                    ) : activeView === "analytics" ? (
                      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-white text-[#111827] [text-rendering:optimizeLegibility]">
                        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                          <div className="w-full max-w-none mx-auto px-3 sm:px-5 lg:px-6 py-4 pb-10 space-y-2.5">
                            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-[#E5E7EB] pb-6 mb-0.5">
                              <div>
                                <h1 className="text-[20px] font-semibold text-[#111827] tracking-tight flex items-center gap-2.5">
                                  <span
                                    className="text-[#6B7280] shrink-0"
                                    aria-hidden
                                  >
                                    <svg
                                      className="w-7 h-7 sm:w-[1.65rem] sm:h-[1.65rem]"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.7"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                    >
                                      <path d="M4 19h16" />
                                      <polyline points="5 15 10 10 14 14 19 8" />
                                      <circle cx="10" cy="10" r="0.9" />
                                      <circle cx="14" cy="14" r="0.9" />
                                      <circle cx="19" cy="8" r="0.9" />
                                    </svg>
                                  </span>
                                  Analytics
                                </h1>
                                <p className="text-[13px] text-[#6B7280] mt-2 max-w-lg leading-relaxed">
                                  Focus trends and discipline at a glance
                                </p>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-1 text-[11px] font-medium text-[#6B7280] tabular-nums">
                                  <span
                                    className="h-1 w-1 rounded-full bg-[#6366F1]"
                                    aria-hidden
                                  />
                                  Last 7 days
                                </span>
                              </div>
                            </header>

                            <section className="rounded-lg border border-[#E5E7EB] bg-white transition-[background-color] duration-150">
                              <div className="flex flex-col gap-1.5 p-3 sm:p-4 border-b border-[#E5E7EB]">
                                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                                  <div className="min-w-0">
                                    <h2 className="text-[15px] font-semibold text-[#111827] tracking-tight">
                                      {selectedStat === "Integrity"
                                        ? "Focus Integrity"
                                        : "Task Speed"}
                                    </h2>
                                    <p className="text-[13px] text-[#6B7280] mt-0.5 leading-snug">
                                      {selectedStat === "Integrity"
                                        ? "Consistency over time"
                                        : selectedTaskGraph
                                          ? `${formatTaskTitleForGraph(normalizeTaskKey(selectedTaskGraph))} · Completion time per session`
                                          : "Completion time per session"}
                                    </p>
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2.5">
                                    {selectedStat === "Speed" && (
                                      <div
                                        ref={analyticsTaskPickerRef}
                                        className="relative z-[400] min-w-[12rem] max-w-[min(18rem,92vw)]"
                                      >
                                        <button
                                          type="button"
                                          aria-expanded={analyticsTaskPickerOpen}
                                          aria-haspopup="listbox"
                                          onClick={() =>
                                            setAnalyticsTaskPickerOpen(
                                              (o) => !o,
                                            )
                                          }
                                          className="flex h-9 w-full cursor-pointer items-center justify-between gap-2.5 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-left text-[13px] font-semibold text-[#111827] outline-none ring-0 transition-all duration-100 hover:border-[#D1D5DB] focus-visible:border-[#6366F1] focus-visible:ring-2 focus-visible:ring-[#6366F1]/20"
                                        >
                                          <span className="min-w-0 flex-1 truncate tracking-tight">
                                            {selectedTaskGraph
                                              ? formatTaskTitleForGraph(
                                                  normalizeTaskKey(
                                                    selectedTaskGraph,
                                                  ),
                                                )
                                              : "Select task"}
                                          </span>
                                          <svg
                                            className={`h-4 w-4 shrink-0 text-[#6B7280] transition-transform duration-200 ${analyticsTaskPickerOpen ? "rotate-180" : ""}`}
                                            viewBox="0 0 24 24"
                                            fill="none"
                                            stroke="currentColor"
                                            strokeWidth="2"
                                            strokeLinecap="round"
                                            strokeLinejoin="round"
                                            aria-hidden
                                          >
                                            <path d="M6 9l6 6 6-6" />
                                          </svg>
                                        </button>
                                        {analyticsTaskPickerOpen && (
                                          <div
                                            className="absolute left-0 right-0 top-full z-[401] mt-1.5 overflow-hidden rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-sm"
                                            role="listbox"
                                          >
                                            <div className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-contain px-1.5 py-0.5">
                                              <button
                                                type="button"
                                                role="option"
                                                aria-selected={selectedTaskGraph === ""}
                                                onClick={() => {
                                                  setSelectedTaskGraph("");
                                                  setAnalyticsTaskPickerOpen(
                                                    false,
                                                  );
                                                }}
                                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors ${
                                                  selectedTaskGraph === ""
                                                    ? "bg-[#EEF2FF] text-[#111827]"
                                                    : "text-[#6B7280] hover:bg-[#F8FAFC] hover:text-[#111827]"
                                                }`}
                                              >
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F8FAFC] text-[#6B7280]">
                                                  <svg
                                                    className="h-3.5 w-3.5"
                                                    viewBox="0 0 24 24"
                                                    fill="none"
                                                    stroke="currentColor"
                                                    strokeWidth="1.75"
                                                    strokeLinecap="round"
                                                    strokeLinejoin="round"
                                                  >
                                                    <rect
                                                      x="5"
                                                      y="5"
                                                      width="14"
                                                      height="14"
                                                      rx="2"
                                                    />
                                                    <path d="M9 12h6" />
                                                  </svg>
                                                </span>
                                                <span className="min-w-0 flex-1 truncate">
                                                  Select task
                                                </span>
                                              </button>
                                              {Object.keys(taskHistory)
                                                .sort((a, b) =>
                                                  a.localeCompare(b),
                                                )
                                                .map((task) => {
                                                  const isSel =
                                                    selectedTaskGraph === task;
                                                  return (
                                                    <button
                                                      key={task}
                                                      type="button"
                                                      role="option"
                                                      aria-selected={isSel}
                                                      onClick={() => {
                                                        setSelectedTaskGraph(
                                                          normalizeTaskKey(
                                                            task,
                                                          ),
                                                        );
                                                        setAnalyticsTaskPickerOpen(
                                                          false,
                                                        );
                                                      }}
                                                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] font-medium tracking-tight transition-colors ${
                                                        isSel
                                                          ? "bg-[#EEF2FF] text-[#111827]"
                                                          : "text-[#6B7280] hover:bg-[#F8FAFC] hover:text-[#111827]"
                                                      }`}
                                                    >
                                                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#F8FAFC] text-[#6B7280]">
                                                        <svg
                                                          className="h-3.5 w-3.5"
                                                          viewBox="0 0 24 24"
                                                          fill="none"
                                                          stroke="currentColor"
                                                          strokeWidth="1.75"
                                                          strokeLinecap="round"
                                                          strokeLinejoin="round"
                                                        >
                                                          <path d="M9 11l3 3L22 4" />
                                                          <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                                                        </svg>
                                                      </span>
                                                      <span className="min-w-0 flex-1 truncate">
                                                        {formatTaskTitleForGraph(
                                                          task,
                                                        )}
                                                      </span>
                                                    </button>
                                                  );
                                                })}
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    )}
                                    <div className="inline-flex h-9 shrink-0 rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] p-1">
                                      {(["Integrity", "Speed"] as const).map(
                                        (type) => (
                                          <button
                                            key={type}
                                            type="button"
                                            onClick={() => {
                                              setSelectedStat(type);
                                              if (type === "Integrity") {
                                                setAnalyticsTaskPickerOpen(
                                                  false,
                                                );
                                              }
                                            }}
                                            className={`rounded-lg px-3.5 py-1.5 text-[13px] font-semibold tracking-tight transition-all duration-200 ${
                                              selectedStat === type
                                                ? "bg-white text-[#111827] shadow-sm"
                                                : "text-[#6B7280] hover:text-[#111827]"
                                            }`}
                                          >
                                            {type}
                                          </button>
                                        ),
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </div>

                              <div className="p-3 sm:p-4 pt-2">
                                <div className="flex gap-2">
                                    <div className="flex shrink-0 flex-col justify-between py-1 text-[10px] tabular-nums text-[#6B7280] w-12 sm:w-14 text-right leading-none">
                                    {analyticsYTickValues.map((v, i) => (
                                      <span key={`y-${i}-${v}`}>
                                        {formatAnalyticsYTick(v)}
                                      </span>
                                    ))}
                                  </div>
                                  <div
                                    className="relative min-h-[236px] w-full max-h-[260px] flex-1"
                                    onMouseLeave={() =>
                                      setAnalyticsChartHover(null)
                                    }
                                  >
                                    {analyticsChartHover !== null &&
                                      currentData[analyticsChartHover] && (
                                        <div
                                          className="pointer-events-none absolute z-30 rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[10px] shadow-sm"
                                          style={{
                                            left: `${
                                              (analyticsChartHover /
                                                Math.max(
                                                  1,
                                                  currentData.length - 1,
                                                )) *
                                              100
                                            }%`,
                                            top: 6,
                                            transform: "translateX(-50%)",
                                          }}
                                        >
                                          <div className="font-medium text-[#111827]">
                                            {
                                              currentData[analyticsChartHover]
                                                .date
                                            }
                                          </div>
                                          <div className="tabular-nums text-[#6366F1] mt-0.5">
                                            {selectedStat === "Integrity"
                                              ? `${currentData[analyticsChartHover].value.toFixed(1)}%`
                                              : `${currentData[analyticsChartHover].value.toFixed(0)}s`}
                                          </div>
                                        </div>
                                      )}
                                    <svg
                                      viewBox="0 0 100 100"
                                      preserveAspectRatio="none"
                                      className="h-full w-full block cursor-crosshair"
                                      role="img"
                                      onMouseMove={(e) => {
                                        const svg = e.currentTarget;
                                        const rect =
                                          svg.getBoundingClientRect();
                                        const xPct =
                                          ((e.clientX - rect.left) /
                                            rect.width) *
                                          100;
                                        const n = currentData.length;
                                        if (n < 1) {
                                          setAnalyticsChartHover(null);
                                          return;
                                        }
                                        const idx = Math.round(
                                          (xPct / 100) *
                                            Math.max(0, n - 1),
                                        );
                                        setAnalyticsChartHover(
                                          Math.max(
                                            0,
                                            Math.min(n - 1, idx),
                                          ),
                                        );
                                      }}
                                    >
                                      <title>{analyticsChartHint}</title>
                                      <defs>
                                        <linearGradient
                                          id="analyticsAreaFillGrad"
                                          x1="0"
                                          y1="0"
                                          x2="0"
                                          y2="1"
                                        >
                                          <stop
                                            offset="0%"
                                            stopColor="#6366F1"
                                            stopOpacity="0.1"
                                          />
                                          <stop
                                            offset="100%"
                                            stopColor="#ffffff"
                                            stopOpacity="0"
                                          />
                                        </linearGradient>
                                      </defs>
                                      {analyticsGridYTicks.map((gv, gi) => (
                                        <line
                                          key={`gy-${gi}-${gv}`}
                                          x1="0"
                                          y1={analyticsYTickToSvgY(gv)}
                                          x2="100"
                                          y2={analyticsYTickToSvgY(gv)}
                                          stroke="#E5E7EB"
                                          strokeOpacity={0.8}
                                          strokeWidth="0.14"
                                          vectorEffect="non-scaling-stroke"
                                        />
                                      ))}
                                      <path
                                        d={buildAnalyticsSmoothAreaD(
                                          currentData,
                                        )}
                                        fill="url(#analyticsAreaFillGrad)"
                                        stroke="none"
                                        className="transition-all duration-700 ease-out"
                                      />
                                      <path
                                        d={buildAnalyticsSmoothLineD(
                                          currentData,
                                        )}
                                        fill="none"
                                        stroke="#6366F1"
                                        strokeWidth="0.5"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        vectorEffect="non-scaling-stroke"
                                        className="transition-all duration-700 ease-out"
                                      />
                                      {getAnalyticsChartPoints(
                                        currentData,
                                      ).map(([cx, cy], i) => (
                                        <circle
                                          key={i}
                                          cx={cx}
                                          cy={cy}
                                          r={
                                            analyticsChartHover === i
                                              ? 1.35
                                              : 0.85
                                          }
                                          fill={
                                            analyticsChartHover === i
                                              ? "#818CF8"
                                              : "#6366F1"
                                          }
                                          stroke="#ffffff"
                                          strokeWidth="0.22"
                                          className="transition-all duration-100"
                                          vectorEffect="non-scaling-stroke"
                                        />
                                      ))}
                                    </svg>
                                  </div>
                                </div>
                                <div className="mt-1 flex justify-between gap-1.5 pl-14 sm:pl-[3.75rem] pr-0 text-[10px] text-[#6B7280] tabular-nums">
                                  {analyticsGraphXLabels.map((lab) => (
                                    <span
                                      key={lab.key}
                                      className="truncate min-w-0"
                                      title={lab.text}
                                    >
                                      {lab.text}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            </section>

                            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2.5 pt-0.5">
                              <section className="rounded-lg border border-[#E5E7EB] bg-white p-3 sm:p-3.5">
                                <div className="flex items-baseline justify-between gap-3 mb-2 pb-2 border-b border-[#E5E7EB]">
                                  <h2 className="text-[15px] font-semibold text-[#111827]">
                                    Discipline
                                  </h2>
                                  <span className="text-[10px] font-medium text-[#6B7280] tabular-nums">
                                    {getCurrentMonthName()}
                                  </span>
                                </div>

                                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                                  {["M", "T", "W", "T", "F", "S", "S"].map(
                                    (day, i) => (
                                      <div
                                        key={i}
                                        className="text-[9px] font-medium text-[#6B7280] text-center pb-0.5"
                                      >
                                        {day}
                                      </div>
                                    ),
                                  )}

                                  {heatmapData.map((day, i) => {
                                    const todayDateNum = new Date().getDate();
                                    const isToday = i + 1 === todayDateNum;
                                    const mins = Math.floor(
                                      day.totalFocusSeconds / 60,
                                    );
                                    const hint = day.date
                                      ? `${day.date} · ${mins} min · ${day.focusIntegrity.toFixed(0)}%`
                                      : `${mins} min`;

                                    return (
                                      <div
                                        key={i}
                                        title={hint}
                                        className={`group relative aspect-square ${getHeatmapClass(day.symbol || "⬜", isToday)} flex items-center justify-center overflow-hidden cursor-default`}
                                      >
                                        <span className="text-[9px] leading-none opacity-85 z-10 pointer-events-none">
                                          {day.symbol || "⬜"}
                                        </span>
                                        {day.date && (
                                          <div className="absolute bottom-full left-1/2 z-[300] mb-1.5 w-[9.5rem] -translate-x-1/2 rounded-lg border border-[#E5E7EB] bg-white p-2.5 text-[10px] text-[#6B7280] opacity-0 shadow-sm transition-opacity duration-100 pointer-events-none group-hover:opacity-100">
                                            <div className="font-medium border-b border-[#E5E7EB] pb-1.5 mb-1.5 text-[#111827] text-[10px]">
                                              {day.date}
                                            </div>
                                            <div className="flex justify-between gap-2 text-[#6B7280]">
                                              <span>Minutes</span>
                                              <span className="text-[#111827] tabular-nums font-medium">
                                                {mins}
                                              </span>
                                            </div>
                                            <div className="flex justify-between gap-2 text-[#6B7280] mt-1">
                                              <span>Tasks</span>
                                              <span className="text-[#111827] tabular-nums font-medium">
                                                {day.tasksCompleted}
                                              </span>
                                            </div>
                                            <div className="flex justify-between gap-2 text-[#6B7280] mt-1">
                                              <span>Integrity</span>
                                              <span className="text-[#111827] tabular-nums font-medium">
                                                {day.focusIntegrity.toFixed(0)}%
                                              </span>
                                            </div>
                                            <div className="mt-1.5 flex justify-between border-t border-[#E5E7EB] pt-1.5 text-[#6366F1] text-[10px]">
                                              <span>Grade</span>
                                              <span>{day.symbol}</span>
                                            </div>
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              </section>

                              <section className="rounded-lg border border-[#E5E7EB] bg-white p-3 sm:p-3.5">
                                <h2 className="text-[15px] font-semibold text-[#111827] mb-2.5 pb-2 border-b border-[#E5E7EB] tracking-tight">
                                  Performance
                                </h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
                                  {stats.map((stat, i) => (
                                    <div
                                      key={i}
                                      className="group flex aspect-square min-h-0 flex-col justify-between rounded-lg border border-[#E5E7EB] bg-[#F8FAFC] px-2.5 py-2.5 transition-all duration-150 hover:bg-white sm:px-3 sm:py-3"
                                    >
                                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-[#6B7280] leading-snug line-clamp-2">
                                        {stat.label}
                                      </p>
                                      <p className="text-[15px] sm:text-base font-semibold tabular-nums tracking-tight text-[#111827] leading-none">
                                        {stat.val}
                                      </p>
                                    </div>
                                  ))}
                                </div>
                              </section>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-center justify-center h-full pt-8">
                        <p className="text-sm md:text-base text-[#6B7280]">
                          {activeView === "notifications" &&
                            "Notifications Center"}
                          {activeView === "settings" && "Settings"}
                        </p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </section>
            )}

            {isFocusSessionActive && (
              <div
                className={`flex flex-1 min-h-0 h-screen w-full min-w-0 overflow-hidden relative bg-white text-[#111827] transition-[filter] duration-300 ease-out ${
                  focusRootShake ? "micro-focus-shake" : ""
                }`}
              >
                <div
                  className="pointer-events-none absolute inset-0 z-[15] micro-focus-vignette"
                  aria-hidden
                />
                <div
                  className="pointer-events-none absolute inset-0 z-0"
                />
                <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-row">
                  <div
                    className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${
                      focusImmerseIntro ? "micro-focus-main-in" : ""
                    }`}
                  >
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                      <div className="flex w-full flex-shrink-0 flex-col items-center gap-6 px-4 pb-4 pt-16 sm:gap-8">
                  {warning && (
              <div className="fixed top-24 bg-[#6366F1] text-white px-8 py-2 rounded-lg z-[100] animate-pulse text-[13px] font-semibold tracking-wide uppercase shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
                {warning}
              </div>
            )}
            {floatingTime && (
              <div
                key={floatingTime.id}
                className="fixed top-1/2 text-6xl font-semibold text-[#6366F1] animate-float-fade z-[300] drop-shadow-[0_0_12px_rgba(99,102,241,0.2)]"
              >
                {floatingTime.text}
              </div>
            )}
            {stayLockedHint && (
              <div className="fixed bottom-28 left-1/2 z-[320] -translate-x-1/2 rounded-full border border-[#E5E7EB]/80 bg-white/90 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-[#6B7280] shadow-[0_4px_12px_rgba(0,0,0,0.08)] backdrop-blur-sm transition-opacity duration-200 ease-out">
                Stay locked in.
              </div>
            )}

            <div
              className={`w-full max-w-3xl text-center space-y-3 transition-all duration-300 ease-out ${
                running || focusFinaleModalOpen
                  ? "blur-lg opacity-0"
                  : focusImmerseIntro
                    ? "opacity-45"
                    : "opacity-100"
              }`}
            >
              <h1 className="text-4xl font-semibold tracking-tight text-[#111827]">
                Hello <span className="text-[#6366F1]">User</span>.
              </h1>
              <p className="text-lg text-[#6B7280] font-light italic">
                {randomGreeting}
              </p>
              <div
                className={`text-[10px] tracking-[0.3em] uppercase text-[#6B7280] inline-flex items-center justify-center gap-1 ${
                  streakMicro === "up"
                    ? "micro-streak-up"
                    : streakMicro === "down"
                      ? "micro-streak-down"
                      : ""
                }`}
              >
                🔥 {streak} day streak
              </div>

              {!isSimulation && (
                <div className="pt-6 flex justify-center">
                  <div className="bg-white border border-[#E5E7EB] rounded-lg p-8 flex gap-12 relative">
                    <div className="text-left">
                      <div className="text-[9px] uppercase tracking-[0.2em] text-[#6B7280] font-semibold">
                        YESTERDAY
                      </div>
                      <div className="text-3xl font-mono font-semibold tracking-tighter text-[#111827]">
                        {yesterdayTotalFocusMinutes}{" "}
                        <span className="text-[10px] text-[#6B7280] uppercase">
                          MIN
                        </span>
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-[9px] uppercase tracking-[0.2em] text-[#6B7280] font-semibold">
                        TODAY
                      </div>
                      <div className="text-3xl font-mono font-semibold tracking-tighter text-[#6366F1]">
                        {todayTotalFocusMinutes}{" "}
                        <span className="text-[10px] text-[#6366F1]/80 uppercase">
                          MIN
                        </span>
                      </div>
                    </div>
                    <div
                      className={`flex items-end pb-1 text-[10px] font-semibold uppercase tracking-widest ${parseInt(improvementDelta) >= 0 ? "text-emerald-600" : "text-red-500"}`}
                    >
                      <span className="mr-1">
                        {parseInt(improvementDelta) >= 0 ? "▲" : "▼"}
                      </span>
                      {Math.abs(parseInt(improvementDelta))}% IMPROVEMENT
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* TIMER CARD */}
            <div
              className={`relative flex items-center justify-center z-[200] transition-all duration-500 ${focusFinaleOpen ? "focus-finale-timer-wrap" : ""} ${focusTimerNudge ? "micro-timer-nudge" : ""}`}
            >
              {focusFinaleOpen && (
                <div
                  className="pointer-events-none absolute -inset-10 z-0 rounded-[3.75rem] focus-finale-streamers-ring"
                  aria-hidden
                />
              )}
              <svg className="absolute z-[1] w-[360px] h-[360px] -rotate-90">
                <circle
                  cx="180"
                  cy="180"
                  r={RADIUS}
                  stroke="rgba(0,0,0,0.08)"
                  strokeWidth="12"
                  fill="none"
                />
                <circle
                  cx="180"
                  cy="180"
                  r={RADIUS}
                  stroke="#6366F1"
                  strokeWidth="12"
                  fill="none"
                  strokeDasharray={CIRCUMFERENCE}
                  strokeDashoffset={CIRCUMFERENCE - progressPercent}
                  strokeLinecap="round"
                  style={{
                    transition: "stroke-dashoffset 1s linear, stroke 0.5s ease",
                  }}
                />
              </svg>
              <div
                className={`relative z-[2] w-80 h-80 rounded-lg bg-white border border-[#E5E7EB] flex flex-col items-center justify-center shadow-sm transition-all duration-700 overflow-hidden ${focusFinaleOpen ? "focus-finale-timer-card" : ""}`}
              >
                <>
                  <div
                    className={`text-7xl font-mono tracking-tighter text-[#111827]`}
                  >
                    {String(Math.floor(Math.abs(seconds) / 60)).padStart(
                      2,
                      "0",
                    )}
                    :{String(Math.abs(seconds) % 60).padStart(2, "0")}
                  </div>

                  {running && (
                    <div
                      className={`mt-2 text-[10px] tracking-[0.2em] font-semibold uppercase transition-all duration-300 ${isViolating ? "text-red-500 scale-105" : "text-[#9CA3AF] opacity-100"}`}
                    >
                      Focus Integrity: {integrityScore}%
                    </div>
                  )}

                  {!running && (
                    <div className="flex flex-col gap-3 mt-8">
                      <button
                        disabled={isSimulation}
                        onClick={() => {
                          setSeconds((s) => s + 900);
                          setInitialSeconds((s) => s + 900);
                        }}
                        className="px-8 py-2 bg-[#F1F5F9] border border-[#E5E7EB] rounded-lg text-[13px] tracking-wide uppercase text-[#111827] transition hover:bg-[#E5E7EB]"
                      >
                        +15 MIN
                      </button>
                      {seconds > 0 && (
                        <button
                          onClick={startTimer}
                          className="px-8 py-2 bg-[#6366F1] text-white rounded-lg text-[13px] tracking-wide uppercase font-semibold transition hover:bg-[#4f46e5]"
                        >
                          START
                        </button>
                      )}
                    </div>
                  )}
                </>
              </div>
            </div>
                      </div>

                      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-4xl space-y-12 px-4 pb-24 pt-2">
              <div
                className={`space-y-4 max-w-xl mx-auto transition-all duration-300 ease-out ${running || focusFinaleModalOpen ? "opacity-40" : "opacity-100"}`}
              >
                <div className="space-y-1.5">
                  <div
                    className={`flex gap-3 rounded-[24px] ${
                      invalidInputTarget === "focus"
                        ? "micro-input-invalid"
                        : taskInputShellPress
                          ? "micro-input-press"
                          : ""
                    }`}
                  >
                    <input
                      ref={focusSessionTaskInputRef}
                      disabled={isSimulation}
                      value={taskInput}
                      onChange={(e) => setTaskInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          addTaskFromFocusBar({ fromEnter: true });
                        }
                      }}
                      placeholder={
                        isSimulation ? "Simulating input..." : "Next objective..."
                      }
                      className={`flex-1 px-6 py-4 rounded-lg bg-white border border-[#E5E7EB] text-[#111827] outline-none text-[13px] focus:border-[#6366F1] transition-all duration-200 ease-out placeholder-[#6B7280] ${
                        taskInputClearFlash ? "opacity-50" : ""
                      }`}
                    />
                    <button
                      disabled={isSimulation}
                      type="button"
                      onClick={() =>
                        addTaskFromFocusBar({ fromButtonClick: true })
                      }
                      className="btn-press-instant px-8 bg-[#6366F1] text-white rounded-lg font-semibold text-[13px] tracking-wide uppercase shrink-0 active:bg-[#4f46e5]"
                    >
                      ADD
                    </button>
                  </div>
                  {taskInputLiveHints.length > 0 && (
                    <div className="pl-1 space-y-0.5" aria-live="polite">
                      {taskInputLiveHints.map((hint, hi) => (
                        <p
                          key={hi}
                          className="text-[11px] leading-snug text-[#6B7280] micro-hint-in"
                          style={{ animationDelay: `${hi * 40}ms` }}
                        >
                          {hint}
                        </p>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex flex-col gap-3 w-full max-w-xl mx-auto">
                  {focusSessionEntries.length === 0 ? (
                    <p className="text-center text-sm text-[#6B7280] py-2">
                      No tasks in session
                    </p>
                  ) : (
                    focusSessionEntries
                      .map((entry) => {
                        const t = (tasksByListId[entry.listId] ?? []).find(
                          (x) => x.id === entry.taskId,
                        );
                        if (!t || t.removing) return null;
                        return { entry, t };
                      })
                      .filter(
                        (
                          row,
                        ): row is {
                          entry: FocusSessionEntry;
                          t: Task;
                        } => row !== null,
                      )
                      .map(({ entry, t }) => (
                        <div
                          key={`${entry.listId}-${entry.taskId}`}
                          className={`flex items-center justify-between gap-3 p-4 rounded-lg bg-white border border-[#E5E7EB] transition-all duration-300 ${
                            t.removing
                              ? "opacity-0 translate-x-12"
                              : "opacity-100"
                          } ${
                            focusSessionNewRowId === t.id
                              ? "micro-row-enter"
                              : ""
                          }`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-[#9CA3AF]" />
                            <span className="text-base text-gray-800 truncate">
                              {getFocusSessionDisplayLabel(entry.listId, t.text)}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={isSimulation}
                            onClick={() =>
                              completeFocusTask(entry.listId, entry.taskId)
                            }
                            className="w-7 h-7 shrink-0 rounded-full border border-[#D1D5DB] hover:border-emerald-500 hover:bg-emerald-50 transition-all disabled:opacity-40 disabled:hover:border-[#D1D5DB] disabled:hover:bg-transparent"
                            title="Mark complete"
                          />
                        </div>
                      ))
                  )}
                </div>
              </div>
            </div>
                      </div>
                    </div>
                  </div>

                  <div
                    className={`flex w-[min(360px,32vw)] flex-shrink-0 flex-col self-stretch py-2 pr-2 pl-0 sm:w-[min(380px,34vw)] sm:py-3 sm:pr-3 transition-opacity duration-300 ease-out ${
                      focusImmerseIntro ? "opacity-[0.88]" : "opacity-100"
                    }`}
                  >
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#E5E7EB] border-l-[3px] border-l-[#6366F1]/40 bg-[#F8FAFC] sm:rounded-lg">
                      <div className="shrink-0 border-b border-[#E5E7EB] bg-white px-3 py-2.5 sm:px-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span
                              className="inline-flex select-none text-[17px] leading-none grayscale opacity-[0.88]"
                              aria-hidden
                            >
                              🧩
                            </span>
                            <h2 className="min-w-0 truncate text-[15px] font-semibold leading-7 tracking-normal text-[#111827]">
                              Constructor
                            </h2>
                          </div>
                          <div
                            className="shrink-0 p-1.5 text-[#6B7280]"
                            aria-hidden
                          >
                            <svg
                              className="h-[18px] w-[18px]"
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                            >
                              <circle cx="5" cy="12" r="1.5" fill="currentColor" />
                              <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                              <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                            </svg>
                          </div>
                        </div>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#F8FAFC] px-2 py-2 sm:px-2.5">
                          <div className="flex flex-col">
                            {focusSidebarSections.map((section, secIdx) => {
                              const expanded =
                                !!focusPickerExpanded[section.listId];
                              return (
                                <div
                                  key={section.listId}
                                  className={`border-b border-[#E5E7EB] last:border-b-0 ${secIdx === 0 ? "pt-0" : ""}`}
                                >
                                  <button
                                    type="button"
                                    aria-expanded={expanded}
                                    onClick={() =>
                                      setFocusPickerExpanded((prev) => ({
                                        ...prev,
                                        [section.listId]:
                                          !prev[section.listId],
                                      }))
                                    }
                                    className="flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-white active:bg-[#EEF2FF]"
                                  >
                                    <TaskSystemNavIcon
                                      listId={section.listId}
                                      className="h-5 w-5 shrink-0 text-[#9CA3AF]"
                                    />
                                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-[#111827]">
                                      {section.label}
                                    </span>
                                    <span className="shrink-0 tabular-nums text-[12px] font-medium text-[#6B7280]">
                                      {section.tasks.length}
                                    </span>
                                    <svg
                                      className={`h-4 w-4 shrink-0 text-[#6B7280] transition-transform duration-200 ease-out ${expanded ? "rotate-90" : ""}`}
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      aria-hidden
                                    >
                                      <path
                                        d="M9 18l6-6-6-6"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                      />
                                    </svg>
                                  </button>
                                  <div
                                    className={`grid transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none ${expanded ? "grid-rows-[1fr]" : "grid-rows-[0fr]"}`}
                                  >
                                    <div className="min-h-0 overflow-hidden">
                                      <div className="space-y-1 pb-2 pl-1 pr-1 pt-0.5">
                                        {section.tasks.length > 0 && (
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              addAllTasksToFocusSession(
                                                section.listId,
                                              );
                                            }}
                                            className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-[#E5E7EB] bg-white py-1.5 text-[11px] font-semibold text-[#6B7280] transition hover:border-[#6366F1]/40 hover:bg-[#EEF2FF] active:scale-[0.99]"
                                          >
                                            <span className="text-[12px] font-semibold text-[#6366F1]">
                                              +
                                            </span>
                                            Add all {section.label} tasks
                                          </button>
                                        )}
                                        {section.tasks.length === 0 ? (
                                          <p className="py-4 text-center text-[11px] text-[#6B7280]">
                                            No tasks here
                                          </p>
                                        ) : (
                                          <ul className="space-y-1">
                                            {section.tasks.map((task) => {
                                              const inSession =
                                                focusSessionKeySet.has(
                                                  `${section.listId}:${task.id}`,
                                                );
                                              return (
                                                <li
                                                  key={`${section.listId}-${task.id}`}
                                                >
                                                  <button
                                                    type="button"
                                                    disabled={inSession}
                                                    aria-label={
                                                      inSession
                                                        ? `${task.text} — already in session`
                                                        : `Add ${task.text} to focus session`
                                                    }
                                                    onClick={() =>
                                                      addTaskToFocusSession(
                                                        section.listId,
                                                        task.id,
                                                      )
                                                    }
                                                    className={`group flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition active:scale-[0.99] ${
                                                      inSession
                                                        ? "cursor-default border-[#6366F1]/30 bg-[#EEF2FF]"
                                                        : "border-[#E5E7EB] bg-white hover:border-[#D1D5DB] hover:bg-[#F8FAFC]"
                                                    }`}
                                                  >
                                                    <span
                                                      className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-md border-2 text-[13px] font-semibold leading-none transition-colors ${
                                                        inSession
                                                          ? "border-[#6366F1] bg-[#6366F1] text-white"
                                                          : "border-[#E5E7EB] bg-white text-[#6B7280] group-hover:border-[#6366F1]/60 group-hover:text-[#6366F1]"
                                                      }`}
                                                      aria-hidden
                                                    >
                                                      {inSession ? (
                                                        <svg
                                                          className="h-3 w-3"
                                                          viewBox="0 0 24 24"
                                                          fill="none"
                                                          stroke="currentColor"
                                                          strokeWidth="3"
                                                          strokeLinecap="round"
                                                          strokeLinejoin="round"
                                                        >
                                                          <path d="M20 6L9 17l-5-5" />
                                                        </svg>
                                                      ) : (
                                                        <span>+</span>
                                                      )}
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                      <span
                                                        className={`block text-[13px] leading-snug ${
                                                          inSession
                                                            ? "text-[#6B7280]"
                                                            : "text-[#111827]"
                                                        }`}
                                                      >
                                                        {task.text}
                                                      </span>
                                                      {inSession && (
                                                        <span className="mt-0.5 block text-[10px] font-medium text-[#6366F1]">
                                                          In your session
                                                        </span>
                                                      )}
                                                    </span>
                                                  </button>
                                                </li>
                                              );
                                            })}
                                          </ul>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                      </div>
                    </div>
                  </div>
                </div>
                {focusFinaleModalOpen && focusFinaleSnapshot && (
                  <div
                    className="absolute inset-0 z-[450] flex items-center justify-center p-6"
                    role="dialog"
                    aria-modal="true"
                    aria-labelledby="focus-finale-title"
                  >
                    <button
                      type="button"
                      className="absolute inset-0 bg-white/50 backdrop-blur-xl cursor-pointer border-0 p-0"
                      aria-label="Dismiss celebration"
                      onClick={dismissFocusFinale}
                    />
                    <div
                      className="relative z-[1] w-full max-w-md rounded-[28px] border border-[#E5E7EB]/80 bg-white/95 px-8 py-10 shadow-[0_24px_80px_rgba(0,0,0,0.12)] pointer-events-auto text-center font-['Plus_Jakarta_Sans',system-ui,sans-serif]"
                      onClick={(e) => e.stopPropagation()}
                      role="presentation"
                    >
                      <h2
                        id="focus-finale-title"
                        className={`text-[1.65rem] font-semibold tracking-tight text-[#111827] transition-all duration-500 ease-out ${
                          focusFinalePhase >= 2
                            ? "opacity-100 translate-y-0"
                            : "opacity-0 translate-y-3"
                        }`}
                      >
                        You&apos;re Finished!
                      </h2>
                      <div
                        className={`mt-8 space-y-5 text-left transition-opacity duration-500 ${
                          focusFinalePhase >= 3 ? "opacity-100" : "opacity-0"
                        }`}
                      >
                        <div
                          className={`flex items-baseline justify-between gap-3 border-b border-[#E5E7EB] pb-4 transition-all duration-500 ease-out ${
                            focusFinalePhase >= 3
                              ? "opacity-100 translate-y-0"
                              : "opacity-0 translate-y-4"
                          }`}
                          style={{
                            transitionDelay:
                              focusFinalePhase >= 3 ? "0ms" : "0ms",
                          }}
                        >
                          <span className="text-[13px] font-medium text-[#6B7280]">
                            🎯 Focus integrity
                          </span>
                          <span className="text-xl font-semibold tabular-nums text-[#111827]">
                            {focusFinaleSnapshot.integrity}%
                          </span>
                        </div>
                        <div
                          className={`flex items-baseline justify-between gap-3 border-b border-[#E5E7EB] pb-4 transition-all duration-500 ease-out ${
                            focusFinalePhase >= 3
                              ? "opacity-100 translate-y-0"
                              : "opacity-0 translate-y-4"
                          }`}
                          style={{
                            transitionDelay:
                              focusFinalePhase >= 3 ? "120ms" : "0ms",
                          }}
                        >
                          <span className="text-[13px] font-medium text-[#6B7280]">
                            ⏱ Time in focus
                          </span>
                          <span className="text-xl font-semibold tabular-nums text-[#111827]">
                            {(() => {
                              const s = focusFinaleSnapshot.elapsedSecs;
                              const m = Math.floor(s / 60);
                              const r = s % 60;
                              if (m <= 0) return `${r}s`;
                              return `${m}m ${String(r).padStart(2, "0")}s`;
                            })()}
                          </span>
                        </div>
                        <div
                          className={`flex items-baseline justify-between gap-3 transition-all duration-500 ease-out ${
                            focusFinalePhase >= 3
                              ? "opacity-100 translate-y-0"
                              : "opacity-0 translate-y-4"
                          }`}
                          style={{
                            transitionDelay:
                              focusFinalePhase >= 3 ? "240ms" : "0ms",
                          }}
                        >
                          <span className="text-[13px] font-medium text-[#6B7280]">
                            ✓ Tasks completed
                          </span>
                          <span className="text-xl font-semibold tabular-nums text-[#111827]">
                            {focusFinaleSnapshot.tasksDone}
                          </span>
                        </div>
                      </div>
                      <p className="mt-8 text-[11px] text-[#9CA3AF]">
                        Tap outside to continue
                      </p>
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>

          {isAddListModalOpen && (
            <div
              className="fixed inset-0 z-[600] flex items-center justify-center p-4 sm:p-6 bg-black/30 backdrop-blur-[1px]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-list-title"
              onClick={() => {
                setIsAddListModalOpen(false);
                setNewListName("");
              }}
            >
              <div
                className="w-full max-w-[720px] rounded-lg overflow-hidden shadow-sm flex flex-col sm:flex-row border border-[#E5E7EB] bg-white"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Left: form (TickTick Add List) */}
                <div className="flex-1 min-w-0 p-6 sm:p-8 flex flex-col gap-6">
                  <h2
                    id="add-list-title"
                    className="text-[15px] font-semibold text-[#111827] tracking-tight"
                  >
                    Add List
                  </h2>

                  <div>
                    <div className="flex items-stretch rounded-lg overflow-hidden border border-[#E5E7EB] bg-white focus-within:border-[#6366F1] transition-colors">
                      <span className="pl-3 pr-1 flex items-center text-[#6B7280] text-lg select-none">
                        ≡
                      </span>
                      <input
                        autoFocus
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="Name"
                        className="flex-1 min-w-0 py-3 pr-3 bg-transparent text-[13px] text-[#111827] placeholder:text-[#6B7280] outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[13px] text-[#6B7280] mb-3">List Color</p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {LIST_COLOR_SWATCHES.map((c, i) => {
                        const selected = newListColor === c;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setNewListColor(c)}
                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1]/60 ${
                              c === null
                                ? "border-2 border-dashed border-[#D1D5DB] bg-[#F8FAFC]"
                                : "border-2 border-transparent"
                            } ${selected ? "ring-2 ring-offset-2 ring-offset-white ring-[#6366F1]" : ""}`}
                            style={
                              c
                                ? {
                                    backgroundColor: c,
                                    boxShadow: selected
                                      ? `inset 0 0 0 2px rgba(0,0,0,0.25)`
                                      : undefined,
                                  }
                                : undefined
                            }
                            aria-label={c === null ? "No color" : `Color ${c}`}
                          >
                            {c === null && (
                              <span className="text-[#6B7280] text-xs">—</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 mt-auto pt-2">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAddListModalOpen(false);
                        setNewListName("");
                      }}
                      className="text-[13px] text-[#6B7280] hover:text-[#111827] transition-colors py-2"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      disabled={!newListName.trim()}
                      onClick={() => {
                        const trimmed = newListName.trim();
                        if (!trimmed) return;
                        setTodayLists((prev) => [
                          ...prev,
                          {
                            id: `list-${Date.now()}`,
                            label: trimmed,
                            icon: DEFAULT_LIST_ICON,
                            color: newListColor,
                          },
                        ]);
                        setIsAddListModalOpen(false);
                        setNewListName("");
                        setNewListColor("#eab308");
                        setOpenListMenuId(null);
                      }}
                      className="ml-auto rounded-lg px-8 py-2.5 text-[13px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-95"
                      style={{ backgroundColor: TT_ACCENT_BLUE }}
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Right: live preview */}
                <div className="w-full sm:w-[300px] shrink-0 border-t sm:border-t-0 sm:border-l border-[#E5E7EB] bg-[#F8FAFC] p-6 flex flex-col relative">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddListModalOpen(false);
                      setNewListName("");
                    }}
                    className="absolute top-4 right-4 w-8 h-8 rounded-lg text-[#6B7280] hover:text-[#111827] hover:bg-white flex items-center justify-center transition-colors"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                  <div className="mt-6 flex-1 flex flex-col rounded-lg border border-[#E5E7EB] bg-white overflow-hidden">
                    <div className="px-4 py-3 border-b border-[#E5E7EB] flex items-center gap-2">
                      <span className="text-[#6B7280]">{DEFAULT_LIST_ICON}</span>
                      <span className="text-[13px] text-[#111827] font-medium truncate">
                        {newListName.trim() || "Name"}
                      </span>
                      <span
                        className={`ml-1 w-2 h-2 rounded-full shrink-0 ${listAccentDotClass(newListColor)}`}
                        style={
                          newListColor
                            ? { backgroundColor: newListColor }
                            : undefined
                        }
                      />
                    </div>
                    <div className="p-3 space-y-2 flex-1">
                      {["Task title", "Task title"].map((label, idx) => (
                        <div
                          key={idx}
                          className="flex items-center gap-2.5 rounded-lg px-2 py-2 bg-[#F8FAFC]"
                        >
                          <span className="w-[18px] h-[18px] rounded-full border-2 border-[#E5E7EB] shrink-0" />
                          <span className="text-[13px] text-[#6B7280] truncate">
                            {label}
                          </span>
                          <span
                            className={`ml-auto w-1.5 h-1.5 rounded-full shrink-0 ${listAccentDotClass(newListColor)}`}
                            style={
                              newListColor
                                ? { backgroundColor: newListColor }
                                : undefined
                            }
                          />
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          </div>{/* end content flex row */}
          </div>{/* end main content column */}

          {!isSimulation && focusSessionDialog?.kind === "quit" && (
            <div
              className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px]"
              onClick={() => setFocusSessionDialog(null)}
              role="presentation"
            >
              <div
                className="w-full max-w-[400px] rounded-lg overflow-hidden shadow-sm border border-[#E5E7EB] bg-white p-6"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="focus-quit-title"
              >
                <h3
                  id="focus-quit-title"
                  className="text-[15px] font-semibold text-[#111827] mb-2"
                >
                  Quit Session?
                </h3>
                <p className="text-[13px] text-[#6B7280] mb-6">
                  You&apos;ll leave the focus session. Integrity up to now can
                  still be saved; task time for incomplete work won&apos;t be
                  logged.
                </p>
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      if (focusSessionDialog?.kind === "quit") {
                        confirmFocusQuitYes(focusSessionDialog.pending);
                      }
                    }}
                    className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#6B7280] hover:bg-[#F8FAFC] transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusSessionDialog(null)}
                    className="px-5 py-2 rounded-lg text-[13px] font-semibold bg-[#6366F1] text-white hover:bg-[#4f46e5] transition-colors"
                  >
                    No
                  </button>
                </div>
              </div>
            </div>
          )}

          {!isSimulation && focusSessionDialog?.kind === "reset" && (
            <div
              className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-black/30 backdrop-blur-[2px]"
              onClick={() => setFocusSessionDialog(null)}
              role="presentation"
            >
              <div
                className="w-full max-w-[400px] rounded-lg overflow-hidden shadow-sm border border-[#E5E7EB] bg-white p-6"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="focus-reset-title"
              >
                <h3
                  id="focus-reset-title"
                  className="text-[15px] font-semibold text-[#111827] mb-2"
                >
                  Reset Session?
                </h3>
                <p className="text-[13px] text-[#6B7280] mb-6">
                  Restart the timer and integrity tracking from the beginning.
                </p>
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleResetSessionConfirm}
                    className="px-4 py-2 rounded-lg text-[13px] font-medium text-[#6B7280] hover:bg-[#F8FAFC] transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusSessionDialog(null)}
                    className="px-5 py-2 rounded-lg text-[13px] font-semibold bg-[#6366F1] text-white hover:bg-[#4f46e5] transition-colors"
                  >
                    No
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
        )}

        {/* HERO + FEATURE LAYOUT WITH STICKY PREVIEW */}
        {isSimulation && (
          <section
            className="relative z-20 w-full px-6 pt-32 pb-32"
            onMouseMove={handleHeroMouseMove}
          >
            <div
              className="pointer-events-none absolute inset-0 -z-10"
              style={{
                transition: "background 0.18s ease-out",
              }}
            />
            <div className="mx-auto max-w-6xl grid grid-cols-1 gap-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
              {/* Left: Hero copy + feature sections (full width on mobile) */}
              <div className="space-y-16 w-full max-w-xl">
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-[#6366F1]">
                  Productivity App
                </p>
                <div className="space-y-4 animate-fade-in">
                  <h1 className="text-3xl md:text-5xl font-semibold tracking-tight leading-tight text-[#111827]">
                    {heroVariant.lines.length === 1 ? (
                      heroVariant.lines[0]
                    ) : (
                      <>
                        <span className="block">{heroVariant.lines[0]}</span>
                        <span className="block">{heroVariant.lines[1]}</span>
                      </>
                    )}
                  </h1>
                  <p className="text-base md:text-lg text-[#6B7280] leading-relaxed mt-1 max-w-xl">
                    Tunnel Vision{" "}
                    <span className="font-semibold text-[#6366F1]">
                      times your tasks
                    </span>{" "}
                    and{" "}
                    <span className="font-semibold text-[#6366F1]">
                      measures your focus
                    </span>{" "}
                    so you can take accountability.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleGetStarted}
                    className="group relative px-14 py-5 bg-[#6366F1] rounded-lg overflow-hidden transition-all duration-200 hover:bg-[#4f46e5] active:scale-[0.97]"
                  >
                    <span className="relative text-white font-semibold tracking-wide text-[13px] uppercase">
                      Get started
                    </span>
                  </button>
                </div>

                {/* Scroll indicator */}
                <div className="flex justify-center pt-16 pb-4">
                  <button
                    type="button"
                    onClick={() =>
                      feature1Ref.current?.scrollIntoView({
                        behavior: "smooth",
                      })
                    }
                    className="flex flex-col items-center gap-1 text-[#9CA3AF] hover:text-[#6B7280] transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1] focus-visible:ring-offset-2 rounded-full p-2"
                    aria-label="Scroll to content"
                  >
                    <span className="text-[10px] uppercase tracking-widest font-medium">
                      Scroll
                    </span>
                    <svg
                      className="w-6 h-6 animate-chevron-bounce"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                      strokeWidth={2}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                </div>

                {/* Mobile only: main interactive demo (with typing) below hero */}
                <div className="lg:hidden w-full max-w-[520px] mx-auto pt-8">
                  <div className="rounded-lg border border-[#E5E7EB] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.08)] p-4 md:p-6">
                    <div className="flex items-center justify-between mb-4 px-1">
                      <div className="flex gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-[#6B7280]">
                        Tunnel Vision · Demo
                      </span>
                      <span className="w-8" />
                    </div>
                    <div className="h-[440px] overflow-hidden rounded-lg bg-[#F8FAFC] border border-[#E5E7EB]">
                      <div className="w-full px-5 py-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.25em] text-[#6366F1]">
                              Today
                            </p>
                            <h3 className="text-2xl font-semibold tracking-tight text-[#111827]">
                              Hello <span className="text-[#6366F1]">Alex</span>.
                            </h3>
                            <p className="text-xs text-[#6B7280] mt-1">
                              Ready to beat yesterday?
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">
                              Streak
                            </p>
                            <p className="text-xl font-mono font-bold text-[#111827]">
                              3
                              <span className="text-[10px] text-[#6B7280] ml-1">
                                days
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 items-start">
                          <div className="relative flex items-center justify-center">
                            <div className="w-24 h-24 rounded-lg bg-white border border-[#E5E7EB] flex items-center justify-center">
                              <span className="font-mono text-lg text-[#111827]">
                                {String(Math.floor(demoSeconds / 60)).padStart(
                                  2,
                                  "0",
                                )}
                                :{String(demoSeconds % 60).padStart(2, "0")}
                              </span>
                            </div>
                          </div>
                          <div className="rounded-lg bg-white border border-[#E5E7EB] overflow-hidden">
                            <div className="flex gap-2 p-2 border-b border-[#E5E7EB]">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB] text-[12px] text-[#6B7280] font-sans">
                                {demoInputText ? (
                                  <>
                                    <span className="text-[#111827]">
                                      {demoInputText}
                                    </span>
                                    <span className="demo-cursor-blink ml-0.5 align-middle">
                                      |
                                    </span>
                                  </>
                                ) : (
                                  "Add task..."
                                )}
                              </div>
                              <div className="px-3 py-2 rounded-lg bg-[#6366F1] text-[11px] font-semibold text-white">
                                Add
                              </div>
                            </div>
                            <div className="divide-y divide-[#E5E7EB]">
                              {demoTasks.map((task, index) => (
                                <div
                                  key={`mobile-${task}`}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-[#EEF2FF]/80 text-[#111827]"
                                      : "text-[#111827]"
                                  }`}
                                >
                                  <span className="tracking-tight">{task}</span>
                                  <span className="w-4 h-4 rounded-md border border-[#D1D5DB] bg-white flex-shrink-0" />
                                </div>
                              ))}
                              {demoTasks.length === 0 && (
                                <div className="px-3 py-4 text-center text-[12px] text-[#9CA3AF] font-sans">
                                  Tasks you add will appear here
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Feature sections */}
                <div className="space-y-24 pt-16 lg:pt-32">
                  {/* Feature 1 */}
                  <section
                    ref={feature1Ref}
                    className="space-y-5 min-h-0 lg:min-h-[160vh] flex flex-col justify-center"
                  >
                    <p className="text-lg md:text-xl font-semibold tracking-[0.2em] uppercase text-blue-400/80">
                      Declutter your thoughts.
                    </p>
                    <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-[#111827]">
                      Step 1
                    </h2>
                    <p className="text-lg md:text-xl text-[#6B7280] leading-relaxed max-w-xl">
                      Brain dump tasks like emails, meetings, homework, or
                      chores. Start a timer and see if you can PR.
                    </p>
                    {/* Mobile: static Step 1 preview */}
                    <div className="lg:hidden w-full max-w-[520px] mt-8 rounded-lg border border-[#E5E7EB] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.08)] p-4 overflow-hidden">
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-[#6B7280]">
                          Tunnel Vision
                        </span>
                        <span className="w-8" />
                      </div>
                      <div className="rounded-lg bg-[#F8FAFC] border border-[#E5E7EB] p-4 space-y-4">
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 items-start">
                          <div className="w-24 h-24 rounded-lg bg-white border border-[#E5E7EB] flex items-center justify-center">
                            <span className="font-mono text-lg text-[#111827]">
                              25:00
                            </span>
                          </div>
                          <div className="rounded-lg bg-white border border-[#E5E7EB] overflow-hidden">
                            <div className="flex gap-2 p-2 border-b border-[#E5E7EB]">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB] text-[12px] text-[#6B7280] font-sans">
                                Add task...
                              </div>
                              <div className="px-3 py-2 rounded-lg bg-[#6366F1] text-[11px] font-semibold text-white">
                                Add
                              </div>
                            </div>
                            <div className="divide-y divide-[#E5E7EB]">
                              {[
                                "calculus homework",
                                "take bins down",
                                "Read Ch20 Of Mice and Men",
                              ].map((task, index) => (
                                <div
                                  key={task}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-[#EEF2FF]/80 text-[#111827]"
                                      : "text-[#111827]"
                                  }`}
                                >
                                  <span className="tracking-tight">{task}</span>
                                  <span className="w-4 h-4 rounded-md border border-[#D1D5DB] bg-white flex-shrink-0" />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Feature 2 */}
                  <section
                    ref={feature2Ref}
                    className="space-y-5 min-h-0 lg:min-h-[160vh] flex flex-col justify-center"
                  >
                    <p className="text-lg md:text-xl font-semibold tracking-[0.2em] uppercase text-[#6366F1]">
                      Make improvement a priority.
                    </p>
                    <h2 className="text-4xl md:text-5xl font-semibold tracking-tight text-[#111827]">
                      Step 2
                    </h2>
                    <p className="text-lg md:text-xl text-[#6B7280] leading-relaxed max-w-xl">
                      Use Tunnel Vision's graphs to view your productivity over
                      weeks and set goals for yourself in the future.
                    </p>
                    {/* Mobile: static Step 2 preview (focus mode) */}
                    <div className="lg:hidden w-full max-w-[520px] mt-8 rounded-lg border border-[#E5E7EB] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.08)] p-4 overflow-hidden">
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-[#6B7280]">
                          Tunnel Vision
                        </span>
                        <span className="w-8" />
                      </div>
                      <div className="rounded-lg bg-[#F8FAFC] border border-[#E5E7EB] p-4">
                        <div className="text-[10px] uppercase tracking-[0.3em] text-[#6B7280] mb-3">
                          Focus mode · Live
                        </div>
                        <div className="rounded-lg bg-white border border-[#E5E7EB] px-6 py-8 space-y-4">
                          <div className="flex flex-col items-center gap-1">
                            <div className="text-[10px] uppercase tracking-[0.3em] text-[#6366F1]">
                              Deep work session
                            </div>
                            <div className="text-4xl font-mono tracking-tight text-[#111827]">
                              24:32
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-[#6366F1]">
                              Focus integrity: 96.4%
                            </div>
                          </div>
                          <div className="divide-y divide-[#E5E7EB] rounded-lg bg-white border border-[#E5E7EB] overflow-hidden">
                            {[
                              "calculus homework",
                              "take bins down",
                              "Read Ch20 Of Mice and Men",
                            ].map((task, index) => (
                              <div
                                key={task}
                                className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                  index === 0
                                    ? "bg-[#EEF2FF] text-[#111827]"
                                    : "text-[#111827]"
                                }`}
                              >
                                <div className="flex items-center gap-2.5">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                      index === 0
                                        ? "bg-[#6366F1]"
                                        : "bg-[#9CA3AF]"
                                    }`}
                                  />
                                  <span className="tracking-tight">{task}</span>
                                </div>
                                <span className="w-4 h-4 rounded-md border border-[#D1D5DB] bg-white flex-shrink-0" />
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>

                  {/* Step 3 mobile section removed – mobile walkthrough now has two steps total */}
                </div>
              </div>

              {/* Right: Sticky app preview container (desktop only) */}
              <div className="hidden lg:flex justify-center md:justify-end md:sticky md:top-24 md:self-start">
                <div className="w-full max-w-[520px] rounded-lg border border-[#E5E7EB] bg-white shadow-[0_4px_12px_rgba(0,0,0,0.08)] p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4 px-1">
                    <div className="flex gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-[#6B7280]">
                      Tunnel Vision · Demo
                    </span>
                    <span className="w-8" />
                  </div>

                  {/* Scrollable simulated app */}
                  <div
                    ref={previewScrollRef}
                    className="h-[440px] overflow-hidden rounded-lg bg-[#F8FAFC] border border-[#E5E7EB]"
                  >
                    <div
                      className="min-h-full w-full px-5 py-5 space-y-10 will-change-transform"
                      style={{
                        transform: `translateY(-${previewParallax * previewMaxScroll}px)`,
                        transition: "transform 0.45s ease-out",
                      }}
                    >
                      {/* Simulated hero / hello area (starting state) */}
                      <div
                        className="space-y-4"
                        style={{ opacity: heroOpacity }}
                      >
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.25em] text-[#6366F1]">
                              Today
                            </p>
                            <h3 className="text-2xl font-semibold tracking-tight text-[#111827]">
                              Hello <span className="text-[#6366F1]">Alex</span>.
                            </h3>
                            <p className="text-xs text-[#6B7280] mt-1">
                              Ready to beat yesterday?
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-[#6B7280]">
                              Streak
                            </p>
                            <p className="text-xl font-mono font-bold text-[#111827]">
                              3
                              <span className="text-[10px] text-[#6B7280] ml-1">
                                days
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Demo timer + tasks card (Todoist-style list) */}
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 items-start">
                          <div className="relative flex items-center justify-center">
                            <div className="w-24 h-24 rounded-lg bg-white border border-[#E5E7EB] flex items-center justify-center">
                              <span className="font-mono text-lg text-[#111827]">
                                {String(Math.floor(demoSeconds / 60)).padStart(
                                  2,
                                  "0",
                                )}
                                :{String(demoSeconds % 60).padStart(2, "0")}
                              </span>
                            </div>
                          </div>

                          <div className="rounded-lg bg-white border border-[#E5E7EB] overflow-hidden">
                            <div className="flex gap-2 p-2 border-b border-[#E5E7EB]">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-[#F8FAFC] border border-[#E5E7EB] text-[12px] text-[#6B7280] font-sans">
                                {demoInputText ? (
                                  <>
                                    <span className="text-[#111827]">
                                      {demoInputText}
                                    </span>
                                    <span className="demo-cursor-blink ml-0.5 align-middle">
                                      |
                                    </span>
                                  </>
                                ) : (
                                  "Add task..."
                                )}
                              </div>
                              <div className="px-3 py-2 rounded-lg bg-[#6366F1] text-[11px] font-semibold text-white">
                                Add
                              </div>
                            </div>
                            <div className="divide-y divide-[#E5E7EB]">
                              {demoTasks.map((task, index) => (
                                <div
                                  key={task}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-[#EEF2FF]/80 text-[#111827]"
                                      : "text-[#111827]"
                                  }`}
                                >
                                  <span className="tracking-tight">{task}</span>
                                  <span className="w-4 h-4 rounded-md border border-[#D1D5DB] bg-white flex-shrink-0" />
                                </div>
                              ))}
                              {demoTasks.length === 0 && (
                                <div className="px-3 py-4 text-center text-[12px] text-[#9CA3AF] font-sans">
                                  Tasks you add will appear here
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Focus mode scene */}
                      <div
                        className="space-y-4 pt-6"
                        style={{ opacity: focusOpacity }}
                      >
                        <div className="text-[10px] uppercase tracking-[0.3em] text-[#6B7280]">
                          Focus mode · Live
                        </div>
                        <div className="rounded-lg bg-white border border-[#E5E7EB] px-8 py-10 space-y-6">
                          <div className="flex flex-col items-center gap-2">
                            <div className="text-[10px] uppercase tracking-[0.3em] text-[#6366F1]">
                              Deep work session
                            </div>
                            <div className="text-5xl md:text-6xl font-mono tracking-tight text-[#111827]">
                              {String(Math.floor(demoSeconds / 60)).padStart(
                                2,
                                "0",
                              )}
                              :{String(demoSeconds % 60).padStart(2, "0")}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-[#6366F1]">
                              Focus integrity: 96.4%
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-white border border-[#E5E7EB] text-[12px] text-[#6B7280] font-sans">
                                {demoInputText ? (
                                  <>
                                    <span className="text-[#111827]">
                                      {demoInputText}
                                    </span>
                                    <span className="demo-cursor-blink ml-0.5 align-middle">
                                      |
                                    </span>
                                  </>
                                ) : (
                                  "Add task..."
                                )}
                              </div>
                              <button className="px-4 py-2 rounded-lg bg-[#6366F1] text-[11px] font-semibold text-white">
                                Add
                              </button>
                            </div>
                            <div className="divide-y divide-[#E5E7EB] rounded-lg bg-white border border-[#E5E7EB] overflow-hidden">
                              {demoTasks.map((task, index) => (
                                <div
                                  key={`focus-${task}`}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-[#EEF2FF] text-[#111827]"
                                      : "text-[#111827]"
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                        index === 0
                                          ? "bg-[#6366F1]"
                                          : "bg-[#9CA3AF]"
                                      }`}
                                    />
                                    <span className="tracking-tight">
                                      {task}
                                    </span>
                                  </div>
                                  <span className="w-4 h-4 rounded-md border border-[#D1D5DB] bg-white flex-shrink-0" />
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Simulated analytics area (scroll target for feature 2) */}
                      <div
                        className="space-y-6 pt-6"
                        style={{ opacity: analyticsOpacity }}
                      >
                        <div className="flex items-center justify-between">
                          <h3 className="text-xs uppercase tracking-[0.3em] text-[#6B7280]">
                            Performance dashboard
                          </h3>
                          <span className="text-[10px] text-[#6366F1] uppercase tracking-[0.2em]">
                            Weekly view
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {[
                            { label: "Total focus", value: "14h 22m" },
                            {
                              label: "Best integrity",
                              value: `${Math.min(100, Math.max(0, bestFocusIntegrity)).toFixed(1)}%`,
                            },
                            { label: "Longest streak", value: "7 days" },
                            { label: "Tasks done", value: "482" },
                          ].map(({ label, value }) => (
                            <div
                              key={label}
                              className="rounded-lg bg-white border border-[#E5E7EB] px-3 py-3 space-y-1"
                            >
                              <p className="text-[9px] uppercase tracking-[0.2em] text-[#6B7280]">
                                {label}
                              </p>
                              <p className="text-sm font-mono font-bold text-[#111827]">
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-lg bg-white border border-[#E5E7EB] p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-[#6B7280]">
                              Discipline log
                            </p>
                            <span className="text-[10px] text-[#6366F1] uppercase tracking-[0.2em]">
                              Month view
                            </span>
                          </div>
                          <div className="grid grid-cols-7 gap-1">
                            {Array.from({ length: 21 }).map((_, i) => (
                              <div
                                key={i}
                                className={`aspect-square rounded-md border border-[#E5E7EB] ${
                                  i % 5 === 0
                                    ? "bg-[#6366F1]"
                                    : i % 3 === 0
                                      ? "bg-blue-300"
                                      : "bg-[#F1F5F9]"
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-lg bg-white border border-[#E5E7EB] p-4 space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.25em] text-[#6B7280]">
                            Focus integrity trend
                          </p>
                          <div className="h-24 rounded-lg bg-[#EEF2FF] border border-[#E5E7EB] relative overflow-hidden">
                            <div className="absolute inset-x-6 bottom-3 h-12 border-t border-[#E5E7EB]" />
                            <div className="absolute inset-3">
                              <div className="h-full w-full rounded-xl border border-[#E5E7EB] bg-white/60" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* Work mode selection modal */}
        {!isSimulation && isWorkModeModalOpen && (
          <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="workmode-modal-enter w-full max-w-md mx-4 rounded-lg bg-white border border-[#E5E7EB] shadow-sm p-6">
              <div className="mb-4">
                <p className="text-[10px] uppercase tracking-[0.3em] text-[#6366F1] mb-2">
                  Working Mode
                </p>
                <h2 className="text-[15px] font-semibold tracking-tight text-[#111827]">
                  How will you work on this task?
                </h2>
                {pendingWorkModeTaskTitle ? (
                  <p
                    className="mt-3 font-['Plus_Jakarta_Sans',system-ui,sans-serif] text-xl font-semibold leading-7 tracking-normal text-[#111827] line-clamp-3"
                    title={pendingWorkModeTaskTitle}
                  >
                    {pendingWorkModeTaskTitle}
                  </p>
                ) : null}
                <p className="mt-2 text-sm text-[#6B7280]">
                  Choose where you&apos;ll focus so Tunnel Vision can score your
                  integrity fairly.
                </p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    if (
                      pendingWorkModeTaskId == null ||
                      pendingWorkModeListId == null
                    ) {
                      workModePromptQueueRef.current = [];
                      setPendingWorkModeTaskId(null);
                      setPendingWorkModeListId(null);
                      setIsWorkModeModalOpen(false);
                      return;
                    }
                    const tid = pendingWorkModeTaskId;
                    const lid = pendingWorkModeListId;
                    setTasksByListId((prev) => {
                      const arr = prev[lid] ?? [];
                      return {
                        ...prev,
                        [lid]: arr.map((t) =>
                          t.id === tid ? { ...t, workMode: "inside" } : t,
                        ),
                      };
                    });
                    if (selectedListId === lid) {
                      setTasks((prev) =>
                        prev.map((t) =>
                          t.id === tid ? { ...t, workMode: "inside" } : t,
                        ),
                      );
                    }
                    advanceWorkModePromptQueue();
                  }}
                  className="group relative flex flex-col items-start gap-1 rounded-lg border border-[#6366F1] bg-[#6366F1] px-4 py-3 text-left text-[13px] font-medium text-white transition-transform duration-150 hover:-translate-y-0.5 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  <span className="text-[11px] uppercase tracking-[0.22em] opacity-70">
                    Recommended
                  </span>
                  <span className="text-sm font-semibold">
                    Work inside Tunnel Vision
                  </span>
                  <span className="text-[11px] text-white/80">
                    Stay in this tab. Leaving will lower focus integrity.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (
                      pendingWorkModeTaskId == null ||
                      pendingWorkModeListId == null
                    ) {
                      workModePromptQueueRef.current = [];
                      setPendingWorkModeTaskId(null);
                      setPendingWorkModeListId(null);
                      setIsWorkModeModalOpen(false);
                      return;
                    }
                    const tid = pendingWorkModeTaskId;
                    const lid = pendingWorkModeListId;
                    setTasksByListId((prev) => {
                      const arr = prev[lid] ?? [];
                      return {
                        ...prev,
                        [lid]: arr.map((t) =>
                          t.id === tid ? { ...t, workMode: "external" } : t,
                        ),
                      };
                    });
                    if (selectedListId === lid) {
                      setTasks((prev) =>
                        prev.map((t) =>
                          t.id === tid ? { ...t, workMode: "external" } : t,
                        ),
                      );
                    }
                    advanceWorkModePromptQueue();
                  }}
                  className="group flex flex-col items-start gap-1 rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-left text-[13px] font-medium text-[#111827] transition-transform duration-150 hover:-translate-y-0.5 hover:bg-[#F8FAFC] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#6366F1] focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  <span className="text-[11px] uppercase tracking-[0.22em] text-[#9CA3AF]">
                    Flexible
                  </span>
                  <span className="text-sm font-semibold">
                    Work in another tab/app
                  </span>
                  <span className="text-[11px] text-[#6B7280]">
                    You can switch tabs freely. Integrity won&apos;t be
                    penalized.
                  </span>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* "Made For" landing sections (Performance / Habit / Time) */}
        {isSimulation && (
          <section className="relative z-10 w-full px-6 pb-32">
            <div className="mx-auto max-w-5xl space-y-40">
              <div
                ref={performanceRef}
                className="space-y-6 text-left pt-12 min-h-[130vh] flex flex-col justify-center"
              >
                <p className="text-[13px] font-semibold tracking-[0.25em] uppercase text-[#6366F1]">
                  Performance
                </p>
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#111827]">
                  Track your task performance.
                </h2>
                <p className="text-[13px] md:text-base text-[#6B7280] max-w-2xl leading-relaxed">
                  Use Tunnel Vision to bring out your competitive edge. How many
                  tasks can you complete before the timer runs out?
                </p>
                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="mt-4 px-14 py-5 bg-[#6366F1] rounded-lg transition-all duration-200 hover:bg-[#4f46e5] active:scale-[0.97]"
                >
                  <span className="text-white font-semibold tracking-wide text-[13px] uppercase">
                    Get started
                  </span>
                </button>
              </div>

              <div
                ref={habitRef}
                className="space-y-6 text-left pt-12 min-h-[130vh] flex flex-col justify-center"
              >
                <p className="text-[13px] font-semibold tracking-[0.25em] uppercase text-[#6366F1]">
                  Habit Building
                </p>
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#111827]">
                  Fix your habits before it's too late.
                </h2>
                <p className="text-[13px] md:text-base text-[#6B7280] max-w-2xl leading-relaxed">
                  Tunnel Vision should become your go-to task manager. Brain
                  dump all your tasks right as you get home and hit deadlines
                  without breaking a sweat.
                </p>
                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="mt-4 px-14 py-5 bg-[#6366F1] rounded-lg transition-all duration-200 hover:bg-[#4f46e5] active:scale-[0.97]"
                >
                  <span className="text-white font-semibold tracking-wide text-[13px] uppercase">
                    Get started
                  </span>
                </button>
              </div>

              <div
                ref={timeRef}
                className="space-y-6 text-left pt-12 min-h-[130vh] flex flex-col justify-center"
              >
                <p className="text-[13px] font-semibold tracking-[0.25em] uppercase text-[#6366F1]">
                  Time Management
                </p>
                <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-[#111827]">
                  Own your schedule.
                </h2>
                <p className="text-[13px] md:text-base text-[#6B7280] max-w-2xl leading-relaxed">
                  Organize your tasks between most urgent and least urgent.
                </p>
                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="mt-4 px-14 py-5 bg-[#6366F1] rounded-lg transition-all duration-200 hover:bg-[#4f46e5] active:scale-[0.97]"
                >
                  <span className="text-white font-semibold tracking-wide text-[13px] uppercase">
                    Get started
                  </span>
                </button>
              </div>
            </div>
          </section>
        )}

        {(deleteUndoToast || taskDoneToast) && (
          <div
            className="fixed bottom-6 left-1/2 z-[620] flex w-[min(100vw-1.5rem,420px)] -translate-x-1/2 flex-col items-stretch gap-2 font-['Inter',system-ui,sans-serif]"
            role="region"
            aria-label="Notifications"
          >
            {deleteUndoToast && (
              <div
                className="micro-snackbar-in flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                role="status"
              >
                <span className="text-[13px] font-medium text-[#111827] microcopy-in">
                  Task deleted — Undo
                </span>
                <button
                  type="button"
                  onClick={undoDeleteTaskToast}
                  className="btn-press-instant shrink-0 rounded-lg px-3 py-1.5 text-[12px] font-semibold text-[#6366F1] transition hover:bg-[#F8FAFC]"
                >
                  Undo
                </button>
              </div>
            )}
            {taskDoneToast && (
              <div
                className="micro-snackbar-in flex items-center justify-between gap-3 rounded-lg border border-[#E5E7EB] bg-white px-4 py-2.5 shadow-[0_4px_12px_rgba(0,0,0,0.08)]"
                role="status"
              >
                <span className="text-[13px] font-medium text-[#111827] microcopy-in whitespace-nowrap">
                  Locked in.
                </span>
                <button
                  type="button"
                  onClick={undoTaskCompletionToast}
                  className="btn-press-instant flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#6366F1] transition hover:bg-[#F8FAFC]"
                  aria-label="Undo complete task"
                  title="Undo"
                >
                  <svg
                    className="h-[18px] w-[18px]"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M3 7v6h6" />
                    <path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13" />
                  </svg>
                </button>
              </div>
            )}
          </div>
        )}

        {microRewardMsg ? (
          <div
            className="pointer-events-none fixed bottom-[5.5rem] left-1/2 z-[615] -translate-x-1/2 px-4"
            role="status"
            aria-live="polite"
          >
            <p className="microcopy-in rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-center text-[12px] font-medium text-[#6B7280] shadow-[0_4px_12px_rgba(0,0,0,0.08)]">
              {microRewardMsg}
            </p>
          </div>
        ) : null}

        <style>{`
html { scroll-behavior: smooth; }
@keyframes glitch { 0% { transform: translate(0); } }
@keyframes breathing { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
@keyframes reflection-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
.animate-reflection-in { animation: reflection-in 0.5s ease-out forwards; }
.animate-glitch { animation: glitch 0.6s infinite; }
.animate-breathing { animation: breathing 3s ease-in-out infinite; }
@keyframes elastic-cb-squash {
  0% { transform: scale(1); }
  22% { transform: scale(0.9); }
  55% { transform: scale(1.1); }
  100% { transform: scale(1); }
}
.elastic-cb-pulse {
  animation: elastic-cb-squash 0.45s cubic-bezier(0.34, 1.45, 0.64, 1) forwards;
}
@keyframes elastic-check-draw {
  from { stroke-dashoffset: 16; }
  to { stroke-dashoffset: 0; }
}
.elastic-check-path-draw {
  stroke-dasharray: 16;
  stroke-dashoffset: 16;
  animation: elastic-check-draw 0.36s ease forwards 0.05s;
}
@keyframes task-reappear {
  from { opacity: 0; transform: translateY(6px) scale(0.98); }
  to { opacity: 1; transform: translateY(0) scale(1); }
}
.animate-task-reappear {
  animation: task-reappear 0.55s cubic-bezier(0.22, 1, 0.36, 1) forwards;
}
.focus-finale-timer-wrap {
  filter: drop-shadow(0 0 12px rgba(99, 102, 241, 0.15));
}
.focus-finale-timer-card {
  box-shadow:
    0 0 0 1px rgba(99, 102, 241, 0.12),
    0 8px 24px rgba(0, 0, 0, 0.06);
}
.focus-finale-streamers-ring {
  opacity: 0.6;
  overflow: hidden;
  background: rgba(99, 102, 241, 0.04);
}
::-webkit-scrollbar { width: 6px; }
`}</style>
      </div>
    </>
  );
}
