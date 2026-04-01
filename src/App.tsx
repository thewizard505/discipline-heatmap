import React from "react";
import { Analytics } from "@vercel/analytics/react";
import { motion } from "framer-motion";
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
/** Focus session countdown ring (SVG progress). Inscribed in the square timer hero. */
const FOCUS_TIMER_RING_RADIUS = 148;
const FOCUS_TIMER_RING_CIRCUMFERENCE = 2 * Math.PI * FOCUS_TIMER_RING_RADIUS;
const FOCUS_TIMER_SVG_SIZE = 360;
const FOCUS_TIMER_SVG_CENTER = FOCUS_TIMER_SVG_SIZE / 2;

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
  /** Todoist-style priority: 1 = highest; default 4 */
  priority?: 1 | 2 | 3 | 4;
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

/** Quick-add title placeholder examples, randomized when the selected list changes. */
const COMPOSER_TITLE_PLACEHOLDER_BY_LIST: Record<
  string,
  readonly string[]
> = {
  [SYS_LIST_TODAY]: [
    "Take bins down by today",
    "Take pictures of math homework by today",
    "Read Ch20 Of Mice and Men by tonight",
  ],
  [SYS_LIST_TESTS]: [
    "Trig test this Friday",
    "Open note Bio Test on Thursday",
    "Math group quiz on function graphs this Wednesday",
  ],
  [SYS_LIST_PROJECTS]: [
    "Mural Project on Latin Americans due this Tuesday",
    "DBQ on Julius Caesar due this Wednesday in class",
    "Presentation on Muhammad Ali this Thursday",
  ],
  [SYS_LIST_LONGTERM]: [
    "History Extra Credit due by February 15th",
    "SSR book project due by March 3rd",
    "Math Extra Credit assignment due by January 19th",
  ],
};

const DEFAULT_COMPOSER_TITLE_PLACEHOLDER = "Add a clear task title";

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

function findTaskListIdContaining(
  tbl: Record<string, Task[]>,
  taskId: number,
): string | null {
  for (const [lid, arr] of Object.entries(tbl)) {
    if (!Array.isArray(arr)) continue;
    if (arr.some((t) => t.id === taskId)) return lid;
  }
  return null;
}

/** Ordered tasks for Focus Today (read-only aggregate of other lists). */
function buildFocusTodayTasksFromStorage(
  tbl: Record<string, Task[]>,
  dayIso: string,
): Task[] {
  const picks = applySoftEstimateReorder(
    buildFocusForTodayPicks(tbl, dayIso),
    tbl,
  );
  return picks
    .map((p) => getTaskForPick(tbl, p))
    .filter((t): t is Task => !!t && !t.removing);
}

const EMPTY_STATE_IMG = {
  today: "/empty-states/today-all-done.png",
  longterm: "/empty-states/longterm-all-done.png",
  tests: "/empty-states/tests-all-done.png",
  projects: "/empty-states/projects-all-done.png",
  focusDayOff: "/empty-states/focus-today-day-off.png",
} as const;

function ListEmptyHero({
  src,
  title,
  subtitle,
  className = "",
}: {
  src: string;
  title: string;
  subtitle: string;
  className?: string;
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center min-h-[300px] px-4 text-center ${className}`}
    >
      <img
        src={src}
        alt=""
        className="mb-5 h-auto w-[min(100%,280px)] max-h-[220px] object-contain select-none"
        draggable={false}
      />
      <p className="text-[17px] font-bold leading-snug text-[#202020] max-w-md">
        {title}
      </p>
      <p className="mt-2 max-w-sm text-[14px] leading-relaxed text-[#6B7280]">
        {subtitle}
      </p>
    </div>
  );
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
  const today = picks.filter(
    (p) =>
      p.listId === SYS_LIST_TODAY || p.listId === SYS_LIST_INBOX,
  );
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
      return { bar: "bg-[#EDE7FA]" };
    case "critical":
      return { bar: "bg-[#F3EEFC]" };
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

function addDaysToIso(iso: string, deltaDays: number): string {
  const d = parseISODate(iso);
  d.setDate(d.getDate() + deltaDays);
  return toISODate(d);
}

function addDaysFromToday(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return toISODate(d);
}

function formatDueButtonLabel(iso: string): string {
  const d = parseISODate(iso);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatDueChipLabel(iso: string | null, todayIso: string): string {
  if (!iso) return "Due date";
  if (iso === todayIso) return "Today";
  return formatDueButtonLabel(iso);
}

/** Todoist-style empty / “all done” hero (suitcase + hat + soft clouds). */
function SaaSAllCaughtUpIllustration() {
  return (
    <div
      className="mb-6 flex w-full max-w-[340px] flex-col items-center"
      aria-hidden
    >
      <svg
        className="h-[168px] w-full drop-shadow-sm"
        viewBox="0 0 320 200"
        fill="none"
      >
        <ellipse cx="248" cy="52" rx="36" ry="14" fill="#E2E8F0" opacity="0.85" />
        <ellipse cx="72" cy="44" rx="28" ry="11" fill="#E2E8F0" opacity="0.7" />
        <ellipse cx="180" cy="36" rx="22" ry="9" fill="#E2E8F0" opacity="0.55" />
        <ellipse cx="210" cy="68" rx="48" ry="16" fill="#D4A574" />
        <ellipse cx="210" cy="58" rx="40" ry="24" fill="#E8D4B8" />
        <rect x="96" y="88" width="128" height="78" rx="10" fill="#8FA8BC" />
        <rect x="104" y="98" width="112" height="52" rx="6" fill="#A8BFD4" />
        <path
          d="M136 88 V72 Q160 56 184 72 V88"
          stroke="#64748B"
          strokeWidth="5"
          strokeLinecap="round"
          fill="none"
        />
        <rect
          x="112"
          y="108"
          width="14"
          height="10"
          rx="2"
          fill="#F97373"
          opacity="0.9"
          transform="rotate(-10 119 113)"
        />
        <rect x="188" y="112" width="12" height="12" rx="2" fill="#F8FAFC" />
        <circle cx="116" cy="174" r="6" fill="#64748B" />
        <circle cx="204" cy="174" r="6" fill="#64748B" />
        <path
          d="M52 178 C100 162 220 162 268 178"
          stroke="#86B894"
          strokeWidth="4"
          strokeLinecap="round"
          opacity="0.85"
        />
        <ellipse cx="120" cy="182" rx="5" ry="10" fill="#86B894" opacity="0.5" />
        <ellipse cx="200" cy="182" rx="5" ry="10" fill="#86B894" opacity="0.5" />
      </svg>
    </div>
  );
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

type TaskPriorityLevel = 1 | 2 | 3 | 4;

function priorityCheckboxRingClass(p: TaskPriorityLevel | undefined): string {
  switch (p ?? 4) {
    case 1:
      return "border-[#8e6fd0] bg-[#f7f4fc]";
    case 2:
      return "border-[#eb8a0a] bg-[#fff8f0]";
    case 3:
      return "border-[#246fe0] bg-[#f4f8ff]";
    default:
      return "border-[#d1d5db] bg-white";
  }
}

function PriorityPickerPopover({
  open,
  anchor,
  selected,
  onSelect,
  onClose,
}: {
  open: boolean;
  anchor: DOMRect | null;
  selected: TaskPriorityLevel;
  onSelect: (p: TaskPriorityLevel) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const el = document.getElementById("priority-picker-popover");
      if (el && !el.contains(e.target as Node)) onClose();
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open, onClose]);

  if (!open || !anchor) return null;
  const top = Math.min(anchor.bottom + 6, window.innerHeight - 220);
  const left = Math.max(8, Math.min(anchor.left, window.innerWidth - 210));

  const rows: { p: TaskPriorityLevel; label: string; stroke: string }[] = [
    { p: 1, label: "Priority 1", stroke: "#8e6fd0" },
    { p: 2, label: "Priority 2", stroke: "#eb8a0a" },
    { p: 3, label: "Priority 3", stroke: "#246fe0" },
    { p: 4, label: "Priority 4", stroke: "#9ca3af" },
  ];

  return (
    <div
      id="priority-picker-popover"
      className="fixed w-[200px] rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-[0_8px_24px_rgba(0,0,0,0.12)] z-[540]"
      style={{ top, left }}
      role="listbox"
      aria-label="Priority"
    >
      {rows.map((r) => (
        <button
          key={r.p}
          type="button"
          role="option"
          aria-selected={selected === r.p}
          onClick={() => onSelect(r.p)}
          className="w-full flex items-center gap-2.5 px-3 py-2 text-left text-[13px] text-[#202020] hover:bg-[#F8FAFC] transition-colors"
        >
          <svg
            className="h-4 w-4 shrink-0"
            viewBox="0 0 24 24"
            fill="none"
            stroke={r.stroke}
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
            <line x1="4" y1="22" x2="4" y2="15" />
          </svg>
          <span className="flex-1 min-w-0">{r.label}</span>
          {selected === r.p ? (
            <span className="text-[#9d84d8] text-[14px]" aria-hidden>
              ✓
            </span>
          ) : (
            <span className="w-4 shrink-0" aria-hidden />
          )}
        </button>
      ))}
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
  priority: TaskPriorityLevel;
};

function ScheduleTaskCard({
  t,
  onTaskPick,
  onCompleteTask,
  compact,
}: {
  t: CalendarPlacedTask;
  onTaskPick: (listId: string, taskId: number) => void;
  onCompleteTask: (listId: string, taskId: number) => void;
  compact?: boolean;
}) {
  const pr = (t.priority ?? 4) as TaskPriorityLevel;
  const styles = upcomingTaskCardStyles(pr);
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onTaskPick(t.listId, t.id)}
      onKeyDown={(e) => {
        if (e.key === "Enter") onTaskPick(t.listId, t.id);
      }}
      className={`relative flex min-h-0 cursor-pointer items-stretch gap-0 overflow-hidden rounded-md border text-left shadow-sm transition-shadow hover:shadow ${styles.card}`}
    >
      <span className={`w-[3px] shrink-0 ${styles.strip}`} aria-hidden />
      <div
        className={`flex min-w-0 flex-1 items-start gap-1.5 ${compact ? "px-1.5 py-1" : "px-2 py-2"}`}
      >
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCompleteTask(t.listId, t.id);
          }}
          className={`btn-press-instant mt-0.5 shrink-0 rounded-full border-[2px] border-[#D1D5DB] bg-white transition-colors hover:border-[#9CA3AF] ${compact ? "h-[14px] w-[14px]" : "h-[18px] w-[18px] flex items-center justify-center"}`}
          aria-label="Complete task"
        />
        <div className="min-w-0 flex-1">
          <p
            className={`font-bold leading-snug text-[#111827] ${compact ? "text-[11px] leading-tight" : "text-[13px]"}`}
          >
            {t.text}
          </p>
        </div>
      </div>
    </div>
  );
}

/** Pastel card + left strip for Upcoming schedule (priority-driven). */
function upcomingTaskCardStyles(p: TaskPriorityLevel): {
  strip: string;
  card: string;
} {
  switch (p) {
    case 1:
      return {
        strip: "bg-[#8e6fd0]",
        card: "border-[#ddd6f0] bg-[#f7f4fc]",
      };
    case 2:
      return {
        strip: "bg-[#eb8a0a]",
        card: "border-[#fce8cc] bg-[#fff8f0]",
      };
    case 3:
      return {
        strip: "bg-[#246fe0]",
        card: "border-[#d6e4fa] bg-[#f4f8ff]",
      };
    default:
      return {
        strip: "bg-[#d1d5db]",
        card: "border-[#E5E7EB] bg-[#F8FAFC]",
      };
  }
}

function TasksDueUpcomingSchedule({
  rangeStartIso,
  tasksByDate,
  todayIso,
  onPrevDay,
  onNextDay,
  onTodayRange,
  onTaskPick,
  onCompleteTask,
}: {
  rangeStartIso: string;
  tasksByDate: Record<string, CalendarPlacedTask[]>;
  todayIso: string;
  onPrevDay: () => void;
  onNextDay: () => void;
  onTodayRange: () => void;
  onTaskPick: (listId: string, taskId: number) => void;
  onCompleteTask: (listId: string, taskId: number) => void;
}) {
  const days: { iso: string; dow: string; dayNum: number }[] = [];
  for (let i = 0; i < 5; i++) {
    const iso = addDaysToIso(rangeStartIso, i);
    const d = parseISODate(iso);
    days.push({
      iso,
      dow: d.toLocaleDateString("en-US", { weekday: "short" }),
      dayNum: d.getDate(),
    });
  }

  const first = parseISODate(rangeStartIso);
  const last = parseISODate(days[4]!.iso);
  const rangeSubtitle =
    first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear()
      ? first.toLocaleDateString("en-US", { month: "long", year: "numeric" })
      : `${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`;

  return (
    <div className="flex flex-1 min-h-0 w-full flex-col bg-white font-['Inter',system-ui,sans-serif] antialiased [text-rendering:optimizeLegibility]">
      <header className="shrink-0 px-5 pt-6 pb-4 sm:px-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#111827]">
              Upcoming
            </h1>
            <p className="mt-1 text-[14px] font-medium text-[#4B5563]">
              {rangeSubtitle}
            </p>
          </div>
          <div className="inline-flex shrink-0 items-stretch overflow-hidden rounded-full border border-[#E5E7EB] bg-white shadow-sm">
            <button
              type="button"
              onClick={onTodayRange}
              className="px-4 py-2 text-[13px] font-semibold text-[#111827] transition-colors hover:bg-[#F9FAFB] active:bg-[#F3F4F6]"
            >
              Today
            </button>
            <span className="w-px shrink-0 self-stretch bg-[#E5E7EB]" aria-hidden />
            <button
              type="button"
              onClick={onPrevDay}
              className="flex w-10 items-center justify-center text-[#6B7280] transition-colors hover:bg-[#F9FAFB] hover:text-[#111827] active:bg-[#F3F4F6]"
              aria-label="Previous day"
            >
              <span className="text-lg leading-none">‹</span>
            </button>
            <button
              type="button"
              onClick={onNextDay}
              className="flex w-10 items-center justify-center text-[#6B7280] transition-colors hover:bg-[#F9FAFB] hover:text-[#111827] active:bg-[#F3F4F6]"
              aria-label="Next day"
            >
              <span className="text-lg leading-none">›</span>
            </button>
          </div>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-5 mb-5 overflow-hidden rounded-xl border border-[#E5E7EB] bg-white sm:mx-8">
          <div className="grid grid-cols-5 divide-x divide-[#E5E7EB] min-h-[calc(100vh-220px)]">
            {days.map((d) => {
              const isRealToday = d.iso === todayIso;
              const sorted = [...(tasksByDate[d.iso] ?? [])].sort((a, b) => {
                const pa = a.priority ?? 4;
                const pb = b.priority ?? 4;
                if (pa !== pb) return pa - pb;
                const byCat = a.categoryLabel.localeCompare(b.categoryLabel);
                if (byCat !== 0) return byCat;
                return a.text.localeCompare(b.text);
              });
              return (
                <div key={d.iso} className="min-w-0 bg-white flex flex-col">
                  <div className="flex min-h-[64px] flex-col items-center justify-center gap-1 border-b border-[#E5E7EB] px-2 py-3">
                    <span
                      className={`text-[12px] tracking-tight ${isRealToday ? "font-bold text-[#111827]" : "font-medium text-[#6B7280]"}`}
                    >
                      {d.dow}
                    </span>
                    {isRealToday ? (
                      <span
                        className="flex h-7 min-w-[1.75rem] items-center justify-center rounded-full bg-[#9d84d8] px-1.5 text-[13px] font-semibold tabular-nums text-white shadow-sm shadow-[rgba(122,95,190,0.25)]"
                        title="Today"
                      >
                        {d.dayNum}
                      </span>
                    ) : (
                      <span className="text-[15px] font-semibold tabular-nums text-[#111827]">
                        {d.dayNum}
                      </span>
                    )}
                  </div>
                  <div className="flex-1 px-2 py-2 sm:px-3">
                    <div className="flex min-h-[40px] flex-col gap-1.5">
                      {sorted.map((t) => (
                        <ScheduleTaskCard
                          key={`${t.listId}-${t.id}`}
                          t={t}
                          onTaskPick={onTaskPick}
                          onCompleteTask={onCompleteTask}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

type HistoryPoint = { value: number; date: string };
type HistoryData = { [taskName: string]: HistoryPoint[] };

/**
 * Parse history `date` values: ISO `YYYY-MM-DD`, or legacy `toLocaleDateString` ("Mar 29").
 * Used for analytics range filtering so graphs stay in sync with stored sessions.
 */
function parseHistoryPointDateLabel(label: string, ref: Date): Date | null {
  if (label === "N/A") return null;
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(label.trim());
  if (iso) {
    const y = Number(iso[1]);
    const m = Number(iso[2]) - 1;
    const day = Number(iso[3]);
    const d = new Date(y, m, day);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const clean = label.replace(/,/g, "").trim();
  const m = clean.match(/^([A-Za-z]+)\s+(\d{1,2})$/);
  if (m) {
    const monthStr = m[1];
    const day = parseInt(m[2], 10);
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    const mi = months.findIndex((x) => monthStr.startsWith(x));
    if (mi >= 0 && day >= 1 && day <= 31) {
      let d = new Date(ref.getFullYear(), mi, day);
      if (d.getTime() > ref.getTime() + 864e5 * 3) {
        d = new Date(ref.getFullYear() - 1, mi, day);
      }
      return d;
    }
  }
  const tryParse = Date.parse(`${clean} ${ref.getFullYear()}`);
  if (!Number.isNaN(tryParse)) {
    const d = new Date(tryParse);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return null;
}

/** Short label for chart axis / tooltips (matches reference: "Mar 22"). */
function formatHistoryDateForDisplay(label: string): string {
  const d = parseHistoryPointDateLabel(label, new Date());
  if (!d) return label;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function filterHistoryPointsByRange(
  points: HistoryPoint[],
  rangeDays: number,
  ref: Date = new Date(),
): HistoryPoint[] {
  const cutoff = new Date(ref);
  cutoff.setHours(0, 0, 0, 0);
  cutoff.setDate(cutoff.getDate() - (rangeDays - 1));
  const withDates = points
    .map((p) => ({ p, dt: parseHistoryPointDateLabel(p.date, ref) }))
    .filter((x): x is { p: HistoryPoint; dt: Date } => x.dt != null);
  const kept = withDates.filter(
    (x) => x.dt.getTime() >= cutoff.getTime(),
  );
  kept.sort((a, b) => a.dt.getTime() - b.dt.getTime());
  return kept.map((x) => x.p);
}

function sortHistoryPointsByDate(
  points: HistoryPoint[],
  ref: Date,
): HistoryPoint[] {
  return [...points].sort((a, b) => {
    const da = parseHistoryPointDateLabel(a.date, ref)?.getTime() ?? 0;
    const db = parseHistoryPointDateLabel(b.date, ref)?.getTime() ?? 0;
    return da - db;
  });
}

/** If the date window removes everything (e.g. legacy dates), still show recent sessions. */
function filterHistoryPointsByRangeWithFallback(
  points: HistoryPoint[],
  rangeDays: number,
  ref: Date,
): HistoryPoint[] {
  const filtered = filterHistoryPointsByRange(points, rangeDays, ref);
  if (filtered.length > 0) return filtered;
  if (points.length === 0) return [];
  const sorted = sortHistoryPointsByDate(points, ref);
  return sorted.slice(-Math.min(60, sorted.length));
}

function mergeAllTaskSpeedPoints(
  th: Record<string, HistoryPoint[]>,
): HistoryPoint[] {
  const all: HistoryPoint[] = [];
  for (const pts of Object.values(th)) {
    if (Array.isArray(pts)) all.push(...pts);
  }
  return all;
}

/** Logged when a focus session ends (reflection or quit) for analytics insights. */
type FocusSessionRecord = {
  id: string;
  startTime: number;
  endTime: number;
  /** Session duration in minutes */
  duration: number;
  focusIntegrity: number;
  taskId?: number;
  completed: boolean;
};

type FocusInsight = {
  id: string;
  title: string;
  description: string;
  type: "positive" | "negative" | "neutral";
  strength: number;
};

type InsightCardItem = FocusInsight & {
  locked?: boolean;
  variant?: "green" | "red" | "blue";
};

const FOCUS_SESSION_LOG_KEY = "tunnelvision_focus_session_log_v1";
const TASK_INTEGRITY_HISTORY_KEY = "tunnelvision_task_integrity_history";

function toLocalDateIso(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseLocalDateIso(iso: string): Date {
  const [y, m, day] = iso.split("-").map(Number);
  return new Date(y, m - 1, day);
}

function startOfWeekMonday(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = (x.getDay() + 6) % 7;
  x.setDate(x.getDate() - day);
  x.setHours(0, 0, 0, 0);
  return x;
}

type FocusTimeBucket = "morning" | "afternoon" | "evening";
type FocusDurationBucket = "short" | "medium" | "long";

function hourBucket(
  h: number,
): FocusTimeBucket | null {
  if (h >= 5 && h < 12) return "morning";
  if (h >= 12 && h < 17) return "afternoon";
  if (h >= 17 && h < 22) return "evening";
  return null;
}

function durationBucket(mins: number): FocusDurationBucket {
  if (mins < 10) return "short";
  if (mins < 25) return "medium";
  return "long";
}

type DerivedSession = FocusSessionRecord & {
  dayOfWeek: number;
  hourOfDay: number;
  timeBucket: FocusTimeBucket | null;
  durationBucket: FocusDurationBucket;
};

function normalizeFocusSessionRecord(raw: unknown): FocusSessionRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id =
    typeof r.id === "string" && r.id.trim()
      ? r.id
      : `fs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

  const startTime =
    typeof r.startTime === "number" && Number.isFinite(r.startTime)
      ? r.startTime
      : typeof r.endTime === "number" && Number.isFinite(r.endTime)
        ? r.endTime
        : typeof r.dateIso === "string"
          ? parseLocalDateIso(r.dateIso).getTime()
          : Date.now();

  const endTime =
    typeof r.endTime === "number" && Number.isFinite(r.endTime)
      ? r.endTime
      : startTime + 60_000;

  const duration =
    typeof r.duration === "number" && Number.isFinite(r.duration)
      ? Math.max(0, r.duration)
      : typeof r.durationSeconds === "number" && Number.isFinite(r.durationSeconds)
        ? Math.max(0, r.durationSeconds / 60)
        : Math.max(0, (endTime - startTime) / 60_000);

  const focusIntegrity =
    typeof r.focusIntegrity === "number" && Number.isFinite(r.focusIntegrity)
      ? Math.max(0, Math.min(100, r.focusIntegrity))
      : typeof r.integrity === "number" && Number.isFinite(r.integrity)
        ? Math.max(0, Math.min(100, r.integrity))
        : 0;

  return {
    id,
    startTime,
    endTime: Math.max(endTime, startTime + 1),
    duration,
    focusIntegrity,
    taskId: typeof r.taskId === "number" ? r.taskId : undefined,
    completed: typeof r.completed === "boolean" ? r.completed : true,
  };
}

function normalizeFocusSessionRecords(raw: unknown): FocusSessionRecord[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map(normalizeFocusSessionRecord)
    .filter((x): x is FocusSessionRecord => x != null);
}

function deriveSessionFields(rec: FocusSessionRecord): DerivedSession {
  const start = new Date(rec.startTime);
  const hour = start.getHours();
  return {
    ...rec,
    dayOfWeek: start.getDay(),
    hourOfDay: hour,
    timeBucket: hourBucket(hour),
    durationBucket: durationBucket(rec.duration),
  };
}

function avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((s, n) => s + n, 0) / nums.length;
}

function groupSessionsByTime(
  sessions: DerivedSession[],
): Record<FocusTimeBucket, DerivedSession[]> {
  return {
    morning: sessions.filter((s) => s.timeBucket === "morning"),
    afternoon: sessions.filter((s) => s.timeBucket === "afternoon"),
    evening: sessions.filter((s) => s.timeBucket === "evening"),
  };
}

function groupSessionsByDuration(
  sessions: DerivedSession[],
): Record<FocusDurationBucket, DerivedSession[]> {
  return {
    short: sessions.filter((s) => s.durationBucket === "short"),
    medium: sessions.filter((s) => s.durationBucket === "medium"),
    long: sessions.filter((s) => s.durationBucket === "long"),
  };
}

function computeTrendPercent(
  sessions: DerivedSession[],
  now = new Date(),
): { percent: number; thisWeekN: number; prevWeekN: number } | null {
  const end = new Date(now);
  end.setHours(23, 59, 59, 999);
  const startThis = new Date(end);
  startThis.setDate(end.getDate() - 6);
  startThis.setHours(0, 0, 0, 0);
  const startPrev = new Date(startThis);
  startPrev.setDate(startThis.getDate() - 7);

  const thisWeek = sessions.filter(
    (s) => s.startTime >= startThis.getTime() && s.startTime <= end.getTime(),
  );
  const prevWeek = sessions.filter(
    (s) => s.startTime >= startPrev.getTime() && s.startTime < startThis.getTime(),
  );
  if (thisWeek.length < 2 || prevWeek.length < 2) return null;

  const tw = avg(thisWeek.map((s) => s.focusIntegrity));
  const pw = avg(prevWeek.map((s) => s.focusIntegrity));
  if (pw <= 0) return null;

  return {
    percent: ((tw - pw) / pw) * 100,
    thisWeekN: thisWeek.length,
    prevWeekN: prevWeek.length,
  };
}

const WEEKDAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

function generateInsights(records: FocusSessionRecord[]): FocusInsight[] {
  const normalized = records
    .filter(
      (r) =>
        Number.isFinite(r.startTime) &&
        Number.isFinite(r.endTime) &&
        Number.isFinite(r.duration) &&
        Number.isFinite(r.focusIntegrity),
    )
    .map((r) => ({
      ...r,
      duration: Math.max(0, r.duration),
      focusIntegrity: Math.max(0, Math.min(100, r.focusIntegrity)),
    }))
    .map(deriveSessionFields);

  if (normalized.length < 4) {
    return [
      {
        id: "not-enough-data",
        title: "Not enough data yet",
        description: "Complete a few focus sessions to unlock insights",
        type: "neutral",
        strength: 100,
      },
    ];
  }

  const candidates: FocusInsight[] = [];

  // A) Time of day
  const byTime = groupSessionsByTime(normalized);
  const timeRows = (Object.keys(byTime) as FocusTimeBucket[])
    .filter((k) => byTime[k].length >= 2)
    .map((k) => ({
      key: k,
      avg: avg(byTime[k].map((s) => s.focusIntegrity)),
      n: byTime[k].length,
    }))
    .sort((a, b) => b.avg - a.avg);
  if (timeRows.length >= 2) {
    const best = timeRows[0];
    const worst = timeRows[timeRows.length - 1];
    const delta = best.avg - worst.avg;
    if (delta > 5) {
      const label =
        best.key === "morning"
          ? "before 12 PM"
          : best.key === "afternoon"
            ? "in the afternoon"
            : "in the evening";
      candidates.push({
        id: "time-of-day",
        title: `You focus best ${label}`,
        description: `${best.key[0].toUpperCase()}${best.key.slice(1)} sessions average ${Math.round(best.avg)}% integrity`,
        type: "positive",
        strength: delta,
      });
    }
  }

  // B) Weekly trend
  const trend = computeTrendPercent(normalized);
  if (trend && Math.abs(trend.percent) > 3) {
    const rounded = Math.round(Math.abs(trend.percent));
    candidates.push({
      id: trend.percent > 0 ? "weekly-trend-up" : "weekly-trend-down",
      title:
        trend.percent > 0
          ? `You're improving +${rounded}% this week`
          : `Your focus dropped by ${rounded}% this week`,
      description: `Compared with the previous 7 days (${trend.thisWeekN} vs ${trend.prevWeekN} sessions).`,
      type: trend.percent > 0 ? "positive" : "negative",
      strength: Math.abs(trend.percent),
    });
  }

  // C) Worst day of week
  const byDow = new Map<number, number[]>();
  for (const s of normalized) {
    if (!byDow.has(s.dayOfWeek)) byDow.set(s.dayOfWeek, []);
    byDow.get(s.dayOfWeek)!.push(s.focusIntegrity);
  }
  const dowRows = [...byDow.entries()]
    .filter(([, vals]) => vals.length >= 2)
    .map(([dow, vals]) => ({ dow, avg: avg(vals), n: vals.length }))
    .sort((a, b) => a.avg - b.avg);
  if (dowRows.length >= 2) {
    const worst = dowRows[0];
    const best = dowRows[dowRows.length - 1];
    const gap = best.avg - worst.avg;
    if (gap >= 4) {
      candidates.push({
        id: "worst-day",
        title: `Your consistency drops on ${WEEKDAY_NAMES[worst.dow]}`,
        description: `Average integrity is ${Math.round(worst.avg)}% on that day`,
        type: "negative",
        strength: gap,
      });
    }
  }

  // D) Session length effect
  const byDuration = groupSessionsByDuration(normalized);
  const durRows = (Object.keys(byDuration) as FocusDurationBucket[])
    .filter((k) => byDuration[k].length >= 2)
    .map((k) => ({ key: k, avg: avg(byDuration[k].map((s) => s.focusIntegrity)) }))
    .sort((a, b) => b.avg - a.avg);
  if (durRows.length >= 2) {
    const best = durRows[0];
    const worst = durRows[durRows.length - 1];
    const gap = best.avg - worst.avg;
    if (gap >= 4) {
      const label =
        best.key === "short" ? "under 10 minutes" : best.key === "medium" ? "10–25 minute" : "25+ minute";
      candidates.push({
        id: "session-length",
        title: `You focus best in ${label} sessions`,
        description: `Average integrity is ${Math.round(best.avg)}% for this duration range`,
        type: "neutral",
        strength: gap,
      });
    }
  }

  // E) Peak focus window (2-hour)
  const hourVals: Record<number, number[]> = {};
  for (const s of normalized) {
    if (!hourVals[s.hourOfDay]) hourVals[s.hourOfDay] = [];
    hourVals[s.hourOfDay].push(s.focusIntegrity);
  }
  let bestWindow: { start: number; avgVal: number; n: number } | null = null;
  for (let h = 0; h < 24; h++) {
    const vals = [...(hourVals[h] ?? []), ...(hourVals[(h + 1) % 24] ?? [])];
    if (vals.length < 2) continue;
    const v = avg(vals);
    if (!bestWindow || v > bestWindow.avgVal) {
      bestWindow = { start: h, avgVal: v, n: vals.length };
    }
  }
  if (bestWindow && bestWindow.n >= 2) {
    const hh = (n: number) => {
      const h = ((n % 24) + 24) % 24;
      const display = h % 12 === 0 ? 12 : h % 12;
      const suffix = h < 12 ? "AM" : "PM";
      return `${display} ${suffix}`;
    };
    candidates.push({
      id: "peak-window",
      title: `Your peak focus time is ${hh(bestWindow.start)}–${hh(bestWindow.start + 2)}`,
      description: `This window averages ${Math.round(bestWindow.avgVal)}% integrity`,
      type: "positive",
      strength: Math.max(1, bestWindow.avgVal - avg(normalized.map((s) => s.focusIntegrity))),
    });
  }

  const deduped = candidates.filter(
    (c, i) => candidates.findIndex((x) => x.id === c.id) === i,
  );
  if (deduped.length === 0) {
    return [
      {
        id: "not-enough-signal",
        title: "Not enough data yet",
        description: "Complete a few focus sessions to unlock insights",
        type: "neutral",
        strength: 100,
      },
    ];
  }

  return deduped.sort((a, b) => b.strength - a.strength).slice(0, 4);
}

function InsightCard({
  insight,
  index,
}: {
  insight: InsightCardItem;
  index: number;
}) {
  const variantClass =
    insight.variant === "green"
      ? "tv-insight-card--green"
      : insight.variant === "red"
        ? "tv-insight-card--red"
        : insight.variant === "blue"
          ? "tv-insight-card--blue"
          : "tv-insight-card--neutral";
  const lockedClass = insight.locked ? "tv-insight-card--locked" : "";
  const exampleClass =
    insight.id === "pending-morning" || insight.id === "pending-trend"
      ? "tv-insight-card--example"
      : "";

  return (
    <motion.div
      initial={{ opacity: 0, y: 20, scale: 0.985, boxShadow: "0 0 0 rgba(0,0,0,0)" }}
      animate={{
        opacity: 1,
        y: 0,
        scale: 1,
        boxShadow:
          "0 10px 30px rgba(0,0,0,0.16), 0 0 40px rgba(255,255,255,0.03), inset 0 1px 0 rgba(255,255,255,0.38)",
      }}
      transition={{
        delay: index * 0.15,
        type: "spring",
        stiffness: 120,
        damping: 12,
      }}
      className={`tv-insight-card ${variantClass} ${lockedClass} ${exampleClass}`}
    >
      <p
        className={`tv-insight-card__title ${
          exampleClass ? "tv-insight-card__title--example" : ""
        }`}
      >
        {insight.title}
      </p>
      <p className="tv-insight-card__description">{insight.description}</p>
    </motion.div>
  );
}

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

/** Resolve task key for analytics series (normalized storage + legacy key variants). */
function getTaskSeriesPoints(
  taskKey: string,
  series: Record<string, HistoryPoint[]>,
): HistoryPoint[] {
  const nk = normalizeTaskKey(taskKey);
  if (!nk) return [];
  const direct = series[nk];
  if (direct && direct.length) return direct;
  for (const [k, pts] of Object.entries(series)) {
    if (normalizeTaskKey(k) === nk && pts.length) return pts;
  }
  return [];
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
  "#9d84d8",
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

/** Tunnel Vision brand lavender (active nav / filled icons). */
const SIDEBAR_ACCENT = "#9d84d8";
/** Wireframe nav icons (Todoist secondary). */
const SIDEBAR_ICON_OUTLINE = "#666666";
/** List icons: muted outline when idle, solid accent when active. */
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
            fill={SIDEBAR_ACCENT}
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
            <circle cx="12" cy="13" r="8" fill={SIDEBAR_ACCENT} />
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
            <rect x="4" y="4" width="16" height="16" rx="1.5" fill={SIDEBAR_ACCENT} />
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
            fill={SIDEBAR_ACCENT}
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
          <>
            <path
              fill={SIDEBAR_ACCENT}
              d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6z"
            />
            <path
              fill="rgba(255,255,255,0.22)"
              d="M14 2v6h6L14 2z"
            />
            <path d="M10 12h4M10 16h4" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </>
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
            fill={SIDEBAR_ACCENT}
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
          fill={SIDEBAR_ACCENT}
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

/** Matches primary nav icon language: outline @ #666, solid accent + white detail when active. */
function SidebarToolsIcon({
  kind,
  active,
  className = "h-[18px] w-[18px] shrink-0",
}: {
  kind: "timer" | "insights" | "schedule";
  active: boolean;
  className?: string;
}) {
  const stroke = active ? "none" : SIDEBAR_ICON_OUTLINE;
  const sw = active ? 0 : 1.5;
  const fill = active ? SIDEBAR_ACCENT : "none";
  if (kind === "timer") {
    return (
      <svg className={className} viewBox="0 0 24 24" fill="none" aria-hidden>
        {active ? (
          <>
            <circle cx="12" cy="12" r="10" fill={fill} />
            <path d="M12 6v6l4 2" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="10" stroke={stroke} strokeWidth={sw} />
            <path d="M12 6v6l4 2" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
          </>
        )}
      </svg>
    );
  }
  if (kind === "insights") {
    return (
      <svg className={className} viewBox="0 0 24 24" aria-hidden>
        {active ? (
          <>
            <rect x="4" y="14" width="4" height="6" rx="1" fill={fill} />
            <rect x="10" y="8" width="4" height="12" rx="1" fill={fill} />
            <rect x="16" y="4" width="4" height="16" rx="1" fill={fill} />
          </>
        ) : (
          <path d="M18 20V10M12 20V4M6 20v-6" stroke={stroke} strokeWidth={sw} strokeLinecap="round" />
        )}
      </svg>
    );
  }
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden>
      {active ? (
        <>
          <rect x="3" y="4" width="18" height="18" rx="2" fill={fill} />
          <path
            d="M8 2v4M16 2v4M3 10h18"
            stroke="white"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <path
            d="M7 14h4M13 14h4M7 18h10"
            stroke="white"
            strokeWidth="1.35"
            strokeLinecap="round"
            opacity="0.92"
          />
        </>
      ) : (
        <>
          <rect
            x="4"
            y="5"
            width="16"
            height="16"
            rx="1.5"
            stroke={stroke}
            strokeWidth={sw}
            fill="none"
          />
          <path
            d="M8 3v4M16 3v4M4 11h16"
            stroke={stroke}
            strokeWidth={sw}
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

const DEFAULT_USER_TODAY_LISTS: TodayList[] = [
  { id: "work", label: "Work", icon: "🗂️", color: "#9d84d8" },
  { id: "wishlist", label: "Wishlist", icon: "✨", color: "#c084fc" },
  { id: "shopping", label: "Shopping", icon: "🧾", color: "#e4e4e7" },
  { id: "exercise", label: "Exercise", icon: "🏃‍♂️", color: "#f97316" },
  { id: "packing", label: "Packing list", icon: "✈️", color: "#38bdf8" },
];

const TASKS_BY_LIST_STORAGE_KEY = "tunnelvision_tasks_by_list_v1";
const TODAY_LISTS_STORAGE_KEY = "tunnelvision_user_lists_v1";
const MOTION_PREF_STORAGE_KEY = "tunnelvision_motion_tier_v1";

function TaskListSkeletonRows() { return null; }

function normalizeLoadedTask(t: Task): Task {
  const raw = (t as Task & { priority?: number }).priority;
  const priority: 1 | 2 | 3 | 4 =
    raw === 1 || raw === 2 || raw === 3 || raw === 4 ? raw : 4;
  const out: Task = { ...t, priority };
  delete (out as Task & { scheduledStartMinutes?: number }).scheduledStartMinutes;
  delete (out as Task & { scheduledEndMinutes?: number }).scheduledEndMinutes;
  return out;
}

function normalizeTasksRecord(rec: Record<string, Task[]>): Record<string, Task[]> {
  const out: Record<string, Task[]> = {};
  for (const k of Object.keys(rec)) {
    const arr = rec[k];
    out[k] = Array.isArray(arr) ? arr.map(normalizeLoadedTask) : [];
  }
  return out;
}

function loadTasksByListIdFromStorage(): Record<string, Task[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(TASKS_BY_LIST_STORAGE_KEY);
    if (!raw) return { [SYS_LIST_INBOX]: [] };
    const p = JSON.parse(raw) as Record<string, Task[]>;
    if (!p || typeof p !== "object") return { [SYS_LIST_INBOX]: [] };
    return normalizeTasksRecord({
      ...p,
      [SYS_LIST_INBOX]: p[SYS_LIST_INBOX] ?? [],
    });
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
  const [name, setName] = useState("User");
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

  function updateGlow(elapsed: number, total: number) {
    if (total <= 0) return;
    const progress = elapsed / total;
    const canvas = document.querySelector(
      ".timer-canvas",
    ) as HTMLDivElement | null;
    const display = document.querySelector(
      ".timer-display",
    ) as HTMLDivElement | null;
    const overlay = document.getElementById(
      "tunnelOverlay",
    ) as HTMLDivElement | null;
    if (!canvas || !display || !overlay) return;

    canvas.classList.remove("glow-pulse");

    if (progress < 0.3) {
      canvas.style.boxShadow = "none";
      canvas.style.borderColor = "rgba(255,255,255,0.06)";
      display.style.textShadow = "none";
      overlay.style.opacity = "0";
    } else if (progress < 0.6) {
      canvas.style.boxShadow = "0 0 20px rgba(99,102,241,0.12)";
      canvas.style.borderColor = "rgba(99,102,241,0.2)";
      display.style.textShadow = "0 0 12px rgba(99,102,241,0.3)";
      overlay.style.opacity = "0.4";
    } else if (progress < 0.85) {
      canvas.style.boxShadow =
        "0 0 40px rgba(99,102,241,0.22), inset 0 0 30px rgba(99,102,241,0.06)";
      canvas.style.borderColor = "rgba(99,102,241,0.4)";
      display.style.textShadow =
        "0 0 24px rgba(99,102,241,0.6), 0 0 8px rgba(99,102,241,0.3)";
      overlay.style.opacity = "0.7";
    } else {
      canvas.style.boxShadow =
        "0 0 60px rgba(99,102,241,0.3), inset 0 0 40px rgba(99,102,241,0.1)";
      canvas.style.borderColor = "rgba(99,102,241,0.6)";
      display.style.textShadow =
        "0 0 32px rgba(99,102,241,0.8), 0 0 12px rgba(99,102,241,0.5)";
      overlay.style.opacity = "1";
      canvas.classList.add("glow-pulse");
    }
  }

  function resetGlow() {
    const canvas = document.querySelector(
      ".timer-canvas",
    ) as HTMLDivElement | null;
    const display = document.querySelector(
      ".timer-display",
    ) as HTMLDivElement | null;
    const overlay = document.getElementById(
      "tunnelOverlay",
    ) as HTMLDivElement | null;
    if (!canvas || !display || !overlay) return;
    canvas.style.boxShadow = "none";
    canvas.style.borderColor = "rgba(255,255,255,0.06)";
    display.style.textShadow = "none";
    overlay.style.opacity = "0";
    canvas.classList.remove("glow-pulse");
  }

  const [selectedStat, setSelectedStat] = useState("Integrity");
  const [history, setHistory] = useState<HistoryData>({});
  const [taskHistory, setTaskHistory] = useState<{
    [task: string]: HistoryPoint[];
  }>({});
  /** Per-task focus integrity points (syncs with Speed task keys). */
  const [taskIntegrityHistory, setTaskIntegrityHistory] = useState<
    Record<string, HistoryPoint[]>
  >({});
  const [selectedTaskGraph, setSelectedTaskGraph] = useState<string>("");
  const [analyticsChartHover, setAnalyticsChartHover] = useState<
    number | null
  >(null);
  const [analyticsTaskPickerOpen, setAnalyticsTaskPickerOpen] =
    useState(false);
  const analyticsTaskPickerRef = useRef<HTMLDivElement>(null);
  const [analyticsRange, setAnalyticsRange] = useState<
    "7d" | "14d" | "30d"
  >("7d");
  const [analyticsRangeOpen, setAnalyticsRangeOpen] = useState(false);
  const analyticsRangeRef = useRef<HTMLDivElement>(null);

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
  const [focusSessionRecords, setFocusSessionRecords] = useState<
    FocusSessionRecord[]
  >([]);

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
  const [notificationsFilter, setNotificationsFilter] = useState<"all" | "unread">("all");
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
  /** First day of the 5-day Upcoming schedule (inclusive). */
  const [scheduleRangeStartIso, setScheduleRangeStartIso] = useState(() =>
    toISODate(new Date()),
  );
  const [dueDatePopover, setDueDatePopover] = useState<null | {
    taskId: number;
    anchor: DOMRect;
  }>(null);

  const [composerDuePopover, setComposerDuePopover] = useState<null | {
    anchor: DOMRect;
  }>(null);
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [composerTitle, setComposerTitle] = useState("");
  const [composerDescription, setComposerDescription] = useState("");
  const [composerDue, setComposerDue] = useState<string | null>(null);
  const [composerPriority, setComposerPriority] =
    useState<TaskPriorityLevel>(4);
  const [composerPriorityOpen, setComposerPriorityOpen] = useState(false);
  const [composerPriorityAnchor, setComposerPriorityAnchor] =
    useState<DOMRect | null>(null);

  const [editingTaskId, setEditingTaskId] = useState<number | null>(null);
  /** When Focus Today is selected, edits apply to this source list. */
  const [editingSourceListId, setEditingSourceListId] = useState<string | null>(
    null,
  );
  const [editDraftTitle, setEditDraftTitle] = useState("");
  const [editDraftDescription, setEditDraftDescription] = useState("");
  const [editDraftDue, setEditDraftDue] = useState<string | null>(null);
  const [editDraftPriority, setEditDraftPriority] =
    useState<TaskPriorityLevel>(4);
  const [editDraftDuePopover, setEditDraftDuePopover] = useState<null | {
    anchor: DOMRect;
  }>(null);
  const [editDraftPriorityOpen, setEditDraftPriorityOpen] = useState(false);
  const [editDraftPriorityAnchor, setEditDraftPriorityAnchor] =
    useState<DOMRect | null>(null);

  const [taskDetailModalId, setTaskDetailModalId] = useState<number | null>(
    null,
  );

  const [draggingTaskId, setDraggingTaskId] = useState<number | null>(null);
  const [dropBeforeTaskId, setDropBeforeTaskId] = useState<number | null>(null);
  const [dragOverPostpone, setDragOverPostpone] = useState(false);
  const skipRowClickRef = useRef(false);

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

  const taskDetailModalTask = useMemo(() => {
    if (taskDetailModalId == null) return null;
    return tasks.find((t) => t.id === taskDetailModalId) ?? null;
  }, [taskDetailModalId, tasks]);

  const categoryLabelForSelectedList = useMemo(() => {
    if (!selectedListId) return "—";
    return (
      selectedList?.label ??
      SIDEBAR_PRIMARY_LIST_NAV.find((r) => r.id === selectedListId)?.label ??
      "—"
    );
  }, [selectedListId, selectedList]);

  const mainTasksPanelTitle = useMemo(() => {
    if (todayMainMode === "search") return "Search";
    if (selectedListId === SYS_LIST_INBOX) return "Focus Today";
    return (
      selectedList?.label ??
      SIDEBAR_PRIMARY_LIST_NAV.find((r) => r.id === selectedListId)?.label ??
      "Tasks"
    );
  }, [todayMainMode, selectedListId, selectedList]);

  const quickAddComposerTitlePlaceholder = useMemo(() => {
    if (!selectedListId) return DEFAULT_COMPOSER_TITLE_PLACEHOLDER;
    const opts = COMPOSER_TITLE_PLACEHOLDER_BY_LIST[selectedListId];
    if (!opts?.length) return DEFAULT_COMPOSER_TITLE_PLACEHOLDER;
    return opts[Math.floor(Math.random() * opts.length)]!;
  }, [selectedListId, quickAddOpen]);

  const todoistEmptyDayMessage = useMemo(() => {
    const h = new Date().getHours();
    const disp = name?.trim() || "User";
    if (h < 12) {
      return {
        title: `Enjoy your free day, ${disp}!`,
        variant: "morning" as const,
      };
    }
    return {
      title: `Enjoy the rest of your day, ${disp}!`,
      variant: "evening" as const,
    };
  }, [name]);

  const { tasksByDueDate } = useMemo(() => {
    if (isSimulation) {
      return {
        tasksByDueDate: {} as Record<string, CalendarPlacedTask[]>,
      };
    }
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
        const base: CalendarPlacedTask = {
          id: t.id,
          text: t.text,
          listId,
          categoryLabel,
          priority: (t.priority ?? 4) as TaskPriorityLevel,
        };
        if (!map[k]) map[k] = [];
        map[k].push(base);
      }
    }
    for (const k of Object.keys(map)) {
      map[k].sort((a, b) => {
        const pa = a.priority ?? 4;
        const pb = b.priority ?? 4;
        if (pa !== pb) return pa - pb;
        const byCat = a.categoryLabel.localeCompare(b.categoryLabel);
        if (byCat !== 0) return byCat;
        return a.text.localeCompare(b.text);
      });
    }
    return { tasksByDueDate: map };
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
  const filteredNotificationItems = useMemo(
    () =>
      notificationsFilter === "unread"
        ? notificationItems.filter((n) => !n.read)
        : notificationItems,
    [notificationItems, notificationsFilter],
  );

  const hasUnreadNotifications = useMemo(
    () => notificationItems.some((n) => !n.read),
    [notificationItems],
  );

  const focusForTodayItems = useMemo(() => {
    const base = buildFocusForTodayPicks(tasksByListId, notificationDay);
    return applySoftEstimateReorder(base, tasksByListId);
  }, [tasksByListId, notificationDay]);

  const mainPanelTaskCount = useMemo(() => {
    if (!selectedListId) return 0;
    const searchQ = taskSearchQuery.toLowerCase().trim();
    const base: Task[] =
      selectedListId === SYS_LIST_INBOX
        ? buildFocusTodayTasksFromStorage(tasksByListId, notificationDay)
        : visibleTasksForList;
    const filtered = searchQ
      ? base.filter((t) => t.text.toLowerCase().includes(searchQ))
      : base;
    return filtered.filter((t) => !t.completed).length;
  }, [
    selectedListId,
    taskSearchQuery,
    tasksByListId,
    notificationDay,
    visibleTasksForList,
  ]);

  const focusTaskSourceByTaskId = useMemo(() => {
    const m = new Map<number, string>();
    for (const p of focusForTodayItems) {
      m.set(p.taskId, p.listId);
    }
    return m;
  }, [focusForTodayItems]);

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
    setNotificationsPanelOpen((prev) => !prev);
    setNotificationsFilter("all");
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
        if (selectedListIdRef.current === SYS_LIST_INBOX) {
          setTasks((prev) =>
            prev.map((x) =>
              x.id === task.id ? { ...x, completed: true } : x,
            ),
          );
        }
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

  function completeTaskFromSchedule(listId: string, taskId: number) {
    if (isSimulation) return;
    const list = tasksByListId[listId] ?? [];
    const task = list.find((t) => t.id === taskId && !t.removing);
    if (!task || task.completed) return;
    const listLabel =
      allListsForSelection.find((l) => l.id === listId)?.label ?? "Tasks";
    const rowElasticComplete =
      listId !== SYS_LIST_OVERDUE &&
      (ELASTIC_COMPLETE_SYS_LIST_IDS.has(listId) ||
        todayLists.some((l) => l.id === listId));
    if (rowElasticComplete) {
      scheduleElasticListTaskComplete(task, listId, listLabel);
      return;
    }
    appendCompletedActivity(task.text, 0, listId, listLabel);
    setTasksByListId((prev) => {
      const arr = prev[listId] ?? [];
      return {
        ...prev,
        [listId]: arr.map((x) =>
          x.id === taskId ? { ...x, completed: true } : x,
        ),
      };
    });
    if (selectedListId === listId || selectedListId === SYS_LIST_INBOX) {
      setTasks((prev) =>
        prev.map((x) =>
          x.id === taskId ? { ...x, completed: true } : x,
        ),
      );
    }
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
    if (
      selectedListIdRef.current === listId ||
      selectedListIdRef.current === SYS_LIST_INBOX
    ) {
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
    if (selectedListId === SYS_LIST_INBOX) return;
    setTasksByListId((prev) => ({
      ...prev,
      [selectedListId]: tasks,
    }));
  }, [tasks, selectedListId, isSimulation]);

  useEffect(() => {
    if (selectedListId !== SYS_LIST_INBOX) return;
    if (isSimulation) return;
    if (isSwitchingListRef.current) return;
    setTasks(buildFocusTodayTasksFromStorage(tasksByListId, notificationDay));
  }, [tasksByListId, notificationDay, selectedListId, isSimulation]);

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
    setQuickAddOpen(false);
    setComposerDuePopover(null);
    setComposerPriorityOpen(false);
    setComposerPriorityAnchor(null);
    setEditingTaskId(null);
    setEditingSourceListId(null);
    setEditDraftDuePopover(null);
    setEditDraftPriorityOpen(false);
    setEditDraftPriorityAnchor(null);
    setTaskDetailModalId(null);
    setDraggingTaskId(null);
    setDropBeforeTaskId(null);
    setDragOverPostpone(false);
  }, [selectedListId]);

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

  const focusInsights = useMemo(
    () =>
      isSimulation ? [] : generateInsights(focusSessionRecords),
    [focusSessionRecords, isSimulation],
  );
  const sessionCountForInsights = focusSessionRecords.length;
  const isEmptyInsightsState = sessionCountForInsights < 3;
  const realInsights = focusInsights.filter((i) => !i.id.startsWith("not-enough"));
  const insightFallbacks: InsightCardItem[] = [
    {
      id: "not-enough-data",
      title: "Not enough data yet",
      description: "Complete a few focus sessions to unlock insights.",
      type: "neutral",
      strength: 0,
      variant: "blue",
      locked: false,
    },
    {
      id: "pending-morning",
      title: "You focus better in the morning",
      description: "This will appear once enough sessions confirm the pattern.",
      type: "neutral",
      strength: 0,
      variant: "green",
      locked: true,
    },
    {
      id: "pending-trend",
      title: "You're improving +3% this week",
      description: "Weekly trend unlocks after two weeks of session data.",
      type: "neutral",
      strength: 0,
      variant: "blue",
      locked: true,
    },
  ];
  const displayedInsightCards: InsightCardItem[] = isEmptyInsightsState
    ? insightFallbacks
    : realInsights.slice(0, 3).map((ins): InsightCardItem => ({
        ...ins,
        locked: false,
        variant:
          ins.type === "positive"
            ? "green"
            : ins.type === "negative"
              ? "red"
              : "blue",
      }));
  while (displayedInsightCards.length < 3) {
    const nextFallback = insightFallbacks[displayedInsightCards.length];
    if (!nextFallback) break;
    displayedInsightCards.push(nextFallback);
  }

  /** Performance tiles: 2×2 grid matching reference (Total, Best, Tasks, Avg completion). */
  const analyticsPerformanceQuad = useMemo(() => {
    const byLabel = Object.fromEntries(stats.map((s) => [s.label, s])) as Record<
      string,
      { label: string; val: string }
    >;
    const order = [
      "TOTAL FOCUS TIME",
      "BEST INTEGRITY",
      "ALL-TIME TASKS",
      "AVG COMPLETION",
    ] as const;
    return order.map((label) => ({
      label,
      val: byLabel[label]?.val ?? "—",
    }));
  }, [stats]);

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
    const savedFocusSessions = localStorage.getItem(FOCUS_SESSION_LOG_KEY);

    if (savedStreak) setStreak(parseInt(savedStreak));
    if (savedHistory) setHistory(JSON.parse(savedHistory));
    if (savedTodayMins) setTodayTotalFocusMinutes(parseInt(savedTodayMins));

    if (savedFocusSessions) {
      try {
        const parsed = JSON.parse(savedFocusSessions);
        setFocusSessionRecords(normalizeFocusSessionRecords(parsed));
      } catch {
        setFocusSessionRecords([]);
      }
    }

    let mergedTaskH: Record<string, HistoryPoint[]> = {};
    if (savedTaskHistory) {
      const parsed = JSON.parse(savedTaskHistory);
      mergedTaskH = mergeTaskHistoryByNormalizedKeys(parsed);
      setTaskHistory(mergedTaskH);
    }

    const savedTaskIntegrity = localStorage.getItem(TASK_INTEGRITY_HISTORY_KEY);
    let mergedTi: Record<string, HistoryPoint[]> = {};
    if (savedTaskIntegrity) {
      try {
        mergedTi = mergeTaskHistoryByNormalizedKeys(
          JSON.parse(savedTaskIntegrity) as Record<string, HistoryPoint[]>,
        );
        setTaskIntegrityHistory(mergedTi);
      } catch {
        setTaskIntegrityHistory({});
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
        TASK_INTEGRITY_HISTORY_KEY,
        JSON.stringify(taskIntegrityHistory),
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
      localStorage.setItem(
        FOCUS_SESSION_LOG_KEY,
        JSON.stringify(focusSessionRecords),
      );
    }
  }, [
    history,
    taskHistory,
    taskIntegrityHistory,
    streak,
    focusSessionRecords,
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
    if (!analyticsRangeOpen) return;
    const handlePointerDown = (e: MouseEvent) => {
      const el = analyticsRangeRef.current;
      if (el && !el.contains(e.target as Node)) {
        setAnalyticsRangeOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [analyticsRangeOpen]);

  useEffect(() => {
    if (activeView !== "analytics") setAnalyticsRangeOpen(false);
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
    const now = new Date();
    const dateIso = toLocalDateIso(now);
    const todayStr = getTodayStr();
    const v = Math.round(Math.max(0, Math.min(100, integrityScoreNum)));
    setBestFocusIntegrity((prev) => Math.max(prev, v));
    setHistory((prev) => ({
      ...prev,
      "Focus Integrity": [
        ...(prev["Focus Integrity"] || []),
        { value: v, date: dateIso },
      ],
    }));
    if (focusSessionEntries.length > 0) {
      setTaskIntegrityHistory((prev) => {
        const next = { ...prev };
        for (const e of focusSessionEntries) {
          const list = tasksByListId[e.listId] ?? [];
          const task = list.find((t) => t.id === e.taskId && !t.removing);
          if (!task) continue;
          const preserveSource = FOCUS_SESSION_PRESERVE_SOURCE_LIST_IDS.has(
            e.listId,
          );
          const sessionLabel = getFocusSessionDisplayLabel(e.listId, task.text);
          const analyticsName = preserveSource ? sessionLabel : task.text;
          const taskKey = normalizeTaskKey(analyticsName);
          next[taskKey] = [...(next[taskKey] || []), { value: v, date: dateIso }];
        }
        return next;
      });
    }
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

    const elapsedSecs = Math.max(
      0,
      Math.floor(initialSecondsRef.current - secondsRef.current),
    );
    const startMs = now.getTime() - elapsedSecs * 1000;
    const activeTaskId = focusSessionEntries[0]?.taskId;
    setFocusSessionRecords((prev) => [
      ...prev,
      {
        id:
          typeof crypto !== "undefined" && crypto.randomUUID
            ? crypto.randomUUID()
            : `fs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        startTime: startMs,
        endTime: now.getTime(),
        duration: elapsedSecs / 60,
        focusIntegrity: v,
        taskId: activeTaskId,
        completed: false,
      },
    ]);
  };

  const cleanupFocusSessionAfterQuit = () => {
    setFocusFinaleOpen(false);
    setFocusFinaleModalOpen(false);
    setFocusFinaleSnapshot(null);
    focusFinaleSnapshotRef.current = null;
    setFocusFinalePhase(1);
    setTimerAccumulator(0);
    resetGlow();
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
    setTasksByListId((prev) => {
      let merged = prev;
      if (selectedListId && selectedListId !== SYS_LIST_INBOX) {
        merged = { ...prev, [selectedListId]: tasks };
      }
      requestAnimationFrame(() => {
        if (listId === SYS_LIST_INBOX) {
          setTasks(buildFocusTodayTasksFromStorage(merged, notificationDay));
        } else {
          setTasks(merged[listId] ?? []);
        }
        isSwitchingListRef.current = false;
      });
      return merged;
    });
    setSelectedListId(listId);
    setSelectedTaskId(null);
    setTodayMainMode("tasks");
    setOpenListMenuId(null);
  };

  const performOpenTaskInList = (listId: string, taskId: number) => {
    isSwitchingListRef.current = true;
    const merged = { ...tasksByListId };
    if (selectedListId && selectedListId !== SYS_LIST_INBOX) {
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
    resetGlow();
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
    if (isFocusSessionActive) {
      if (isFocusTimerRunning) {
        setFocusSessionDialog({ kind: "reset" });
      } else {
        handleResetSessionConfirm();
      }
      return;
    }
    if (focusEnterZenActive) {
      clearFocusEnterTimers();
      setFocusEnterZenActive(false);
      setZenOverlayOrigin(null);
      setFocusEnterZenBlocking(false);
      setFocusZenFadeOut(false);
    }
    allowFocusEnterRef.current = true;
    finishEnterFocusSession();
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
    if (selectedListId === SYS_LIST_INBOX) return;
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
      priority: 4,
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

  const cancelQuickAddComposer = () => {
    setQuickAddOpen(false);
    setComposerDuePopover(null);
    setComposerPriorityOpen(false);
    setComposerPriorityAnchor(null);
  };

  const openQuickAddComposer = () => {
    if (
      !selectedListId ||
      selectedListId === SYS_LIST_OVERDUE ||
      selectedListId === SYS_LIST_INBOX
    )
      return;
    setQuickAddOpen(true);
    setComposerTitle("");
    setComposerDescription("");
    if (
      selectedListId === SYS_LIST_TODAY ||
      selectedListId === SYS_LIST_INBOX
    ) {
      setComposerDue(toISODate(new Date()));
    } else if (DUE_DATE_PICKER_LIST_IDS.has(selectedListId)) {
      setComposerDue(null);
    } else {
      setComposerDue(null);
    }
    setComposerPriority(4);
  };

  const submitQuickAddComposer = () => {
    if (
      !selectedListId ||
      selectedListId === SYS_LIST_OVERDUE ||
      selectedListId === SYS_LIST_INBOX
    )
      return;
    const trimmed = composerTitle.trim();
    if (!trimmed) {
      flashInvalidInput("list");
      return;
    }
    const id = Date.now();
    let dueDate: string | null = null;
    if (
      selectedListId === SYS_LIST_TODAY ||
      selectedListId === SYS_LIST_INBOX
    ) {
      dueDate = toISODate(new Date());
    } else if (DUE_DATE_PICKER_LIST_IDS.has(selectedListId)) {
      dueDate = composerDue;
    }
    const newTask: Task = {
      id,
      text: trimmed,
      description: composerDescription.trim(),
      removing: false,
      createdAt: Date.now(),
      workMode: "inside",
      completed: false,
      dueDate,
      priority: composerPriority,
    };
    const flushAdd = () => {
      setTasks((prev) => [...prev, newTask]);
      setSelectedTaskId(id);
      setNewListTaskAnimId(id);
      window.setTimeout(() => setNewListTaskAnimId(null), 280);
      cancelQuickAddComposer();
    };
    const wasEmptyFirst =
      visibleTasksForList.length === 0 && !allElasticListTasksComplete;
    triggerTaskInputPress();
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

  const cancelEditDraft = () => {
    setEditingTaskId(null);
    setEditingSourceListId(null);
    setEditDraftDuePopover(null);
    setEditDraftPriorityOpen(false);
    setEditDraftPriorityAnchor(null);
  };

  const saveEditDraft = () => {
    if (editingTaskId == null || !selectedListId) return;
    const effectiveListId = editingSourceListId ?? selectedListId;
    const trimmed = editDraftTitle.trim();
    if (!trimmed) return;
    const dueLocked = effectiveListId === SYS_LIST_TODAY;
    const nextRow = {
      text: trimmed,
      description: editDraftDescription.trim(),
      dueDate: dueLocked ? toISODate(new Date()) : editDraftDue,
      priority: editDraftPriority,
    };
    setTasksByListId((prev) => {
      const arr = [...(prev[effectiveListId] ?? [])];
      const idx = arr.findIndex((x) => x.id === editingTaskId);
      if (idx === -1) return prev;
      arr[idx] = { ...arr[idx], ...nextRow };
      return { ...prev, [effectiveListId]: arr };
    });
    setTasks((prev) =>
      prev.map((t) => {
        if (t.id !== editingTaskId) return t;
        return { ...t, ...nextRow };
      }),
    );
    cancelEditDraft();
  };

  const startEditTask = (t: Task, sourceListIdForFocus?: string | null) => {
    if (selectedListId === SYS_LIST_OVERDUE) return;
    setTaskDetailModalId(null);
    setEditingTaskId(t.id);
    setEditingSourceListId(
      selectedListId === SYS_LIST_INBOX
        ? sourceListIdForFocus ?? null
        : selectedListId,
    );
    setEditDraftTitle(t.text);
    setEditDraftDescription(t.description ?? "");
    setEditDraftDue(
      (selectedListId === SYS_LIST_INBOX
        ? sourceListIdForFocus
        : selectedListId) === SYS_LIST_TODAY
        ? toISODate(new Date())
        : t.dueDate ?? null,
    );
    setEditDraftPriority((t.priority ?? 4) as TaskPriorityLevel);
  };

  const applyTodoTaskOrder = (orderedTodos: Task[]) => {
    const done = tasks.filter((t) => t.completed);
    setTasks([...orderedTodos, ...done]);
  };

  const handleReorderDrop = (draggedId: number, beforeId: number | null) => {
    const todoOnly = tasks.filter((t) => !t.completed);
    const ids = todoOnly.map((t) => t.id);
    const from = ids.indexOf(draggedId);
    if (from === -1) return;
    const filtered = ids.filter((id) => id !== draggedId);
    let insertAt = beforeId == null ? filtered.length : filtered.indexOf(beforeId);
    if (insertAt < 0) insertAt = filtered.length;
    const nextIds = [...filtered.slice(0, insertAt), draggedId, ...filtered.slice(insertAt)];
    const byId = new Map(todoOnly.map((t) => [t.id, t]));
    const nextTodos = nextIds.map((id) => byId.get(id)).filter(Boolean) as Task[];
    applyTodoTaskOrder(nextTodos);
    setDraggingTaskId(null);
    setDropBeforeTaskId(null);
  };

  const handlePostponeDropOnZone = (taskId: number) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || !selectedListId) return;
    const tomorrow = addDaysFromToday(1);
    if (selectedListId === SYS_LIST_TODAY) {
      setTasksByListId((prev) => {
        const todayArr = [...(prev[SYS_LIST_TODAY] ?? [])].filter(
          (x) => x.id !== taskId,
        );
        const moved: Task = { ...task, dueDate: tomorrow };
        const inboxArr = [...(prev[SYS_LIST_INBOX] ?? []), moved];
        return { ...prev, [SYS_LIST_TODAY]: todayArr, [SYS_LIST_INBOX]: inboxArr };
      });
      setTasks((prev) => prev.filter((t) => t.id !== taskId));
    } else {
      setTasks((prev) =>
        prev.map((t) =>
          t.id === taskId ? { ...t, dueDate: tomorrow } : t,
        ),
      );
    }
    setDraggingTaskId(null);
    setDragOverPostpone(false);
    setDropBeforeTaskId(null);
  };

  const resetAllData = () => {
    localStorage.clear();
    setHistory({});
    setTaskHistory({});
    setTaskIntegrityHistory({});
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
    setFocusSessionRecords([]);
    setWarning("System Purged");
    setTimeout(() => setWarning(null), 3000);
  };

  const handleReflectionSubmit = (options?: {
    tasksCompleted?: number;
    durationSeconds?: number;
  }) => {
    const todayStr = getTodayStr();
    const sessionSecs = todayTotalFocusMinutes * 60;
    const tasksDone = options?.tasksCompleted ?? tasks.length;
    const integrityRounded = Math.round(
      Math.max(0, Math.min(100, integrityScoreNum)),
    );
    const durationLogged =
      options?.durationSeconds != null
        ? Math.max(0, Math.floor(options.durationSeconds))
        : Math.max(0, Math.floor(sessionSecs));

    if (!isSimulation) {
      const now = new Date();
      const startMs = now.getTime() - durationLogged * 1000;
      setFocusSessionRecords((prev) => [
        ...prev,
        {
          id:
            typeof crypto !== "undefined" && crypto.randomUUID
              ? crypto.randomUUID()
              : `fs-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          startTime: startMs,
          endTime: now.getTime(),
          duration: durationLogged / 60,
          focusIntegrity: integrityRounded,
          taskId: undefined,
          completed: true,
        },
      ]);
    }

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
          focusIntegrity: (existingDay.focusIntegrity + integrityRounded) / 2,
          tasksCompleted: existingDay.tasksCompleted + tasksDone,
          totalFocusSeconds: newTotalSecs,
          score: integrityRounded,
          symbol: symbol,
        };
      }
      return newData;
    });

    setHistory((prev) => ({
      ...prev,
      "Focus Integrity": [
        ...(prev["Focus Integrity"] || []),
        {
          value: integrityRounded,
          date: toLocalDateIso(new Date()),
        },
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
      setSeconds((s) => {
        const next = s - 1;
        if (!isSimulation) {
          const total = Math.max(1, initialSecondsRef.current);
          const elapsed = Math.max(0, total - Math.max(next, 0));
          updateGlow(elapsed, total);
        }
        return next;
      });
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

  useEffect(() => {
    if (!running && !isSimulation) {
      resetGlow();
    }
  }, [running, isSimulation]);

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
      priority: 4,
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

  function addAllFocusQueueToSession() {
    setFocusSessionEntries((prev) => {
      const keys = new Set(prev.map((e) => `${e.listId}:${e.taskId}`));
      const added: FocusSessionEntry[] = [];
      for (const p of focusForTodayItems) {
        const t = getTaskForPick(tasksByListId, p);
        if (!t || t.completed || t.removing) continue;
        const key = `${p.listId}:${p.taskId}`;
        if (keys.has(key)) continue;
        keys.add(key);
        added.push({ listId: p.listId, taskId: p.taskId });
      }
      if (!added.length) return prev;
      if (!isSimulation) {
        queueMicrotask(() => {
          const queue = added.map((e) => ({
            taskId: e.taskId,
            listId: e.listId,
          }));
          workModePromptQueueRef.current = queue;
          setPendingWorkModeTaskId(queue[0]!.taskId);
          setPendingWorkModeListId(queue[0]!.listId);
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
    const sessionDateIso = toLocalDateIso(new Date());
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
      const integritySnap = Math.round(
        Math.max(0, Math.min(100, integrityScoreNum)),
      );
      setTaskHistory((prev) => ({
        ...prev,
        [taskKey]: [
          ...(prev[taskKey] || []),
          { value: durationSecs, date: sessionDateIso },
        ],
      }));
      setTaskIntegrityHistory((prev) => ({
        ...prev,
        [taskKey]: [
          ...(prev[taskKey] || []),
          { value: integritySnap, date: sessionDateIso },
        ],
      }));
      appendCompletedActivity(analyticsName, mins, listId, listLabel);
      setBestFocusIntegrity((prev) => Math.max(prev, integritySnap));
      setSelectedTaskGraph(taskKey);
      setSelectedStat("Speed");
    } else {
      setTaskHistory((prev) => ({
        ...prev,
        [taskKey]: [...(prev[taskKey] || []), { value: 0, date: sessionDateIso }],
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
      handleReflectionSubmit({
        tasksCompleted: snap.tasksDone,
        durationSeconds: snap.elapsedSecs,
      });
    } else {
      handleReflectionSubmit();
    }
  }

  /* ------------------- GRAPH ENGINE ------------------- */
  const analyticsGraphTaskKeys = useMemo(() => {
    const u = new Set([
      ...Object.keys(taskHistory),
      ...Object.keys(taskIntegrityHistory),
    ]);
    return [...u].sort((a, b) => a.localeCompare(b));
  }, [taskHistory, taskIntegrityHistory]);

  const currentData = useMemo(() => {
    if (isSimulation) return heroGraphData;
    const rangeDays =
      analyticsRange === "7d" ? 7 : analyticsRange === "14d" ? 14 : 30;
    const ref = new Date();
    const mapChart = (pts: HistoryPoint[]) =>
      pts.map((p) => ({
        value: p.value,
        date: formatHistoryDateForDisplay(p.date),
      }));

    if (selectedStat === "Speed") {
      const rawAll = selectedTaskGraph
        ? getTaskSeriesPoints(selectedTaskGraph, taskHistory)
        : mergeAllTaskSpeedPoints(taskHistory);
      const sorted = sortHistoryPointsByDate(rawAll, ref);
      const filtered = filterHistoryPointsByRangeWithFallback(
        sorted,
        rangeDays,
        ref,
      );
      return filtered.length > 0
        ? mapChart(filtered)
        : [{ value: 0, date: "N/A" }];
    }

    const rawInt = history["Focus Integrity"] || [];
    const sortedInt = sortHistoryPointsByDate(rawInt, ref);
    const filteredInt = filterHistoryPointsByRangeWithFallback(
      sortedInt,
      rangeDays,
      ref,
    );
    return filteredInt.length > 0
      ? mapChart(filteredInt)
      : [{ value: 0, date: "N/A" }];
  }, [
    selectedStat,
    history,
    taskHistory,
    selectedTaskGraph,
    isSimulation,
    analyticsRange,
  ]);

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
    for (const i of sorted) {
      const date = d[i].date;
      out.push({ key: `x-${i}`, text: date });
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

  /** Linear area path — no spline overshoot / “humps” above the line. */
  function buildAnalyticsLinearAreaD(data: HistoryPoint[]) {
    const pts = getAnalyticsChartPoints(data);
    if (pts.length === 0) return "";
    if (pts.length === 1) {
      const p = pts[0];
      return `M 0 100 L 0 ${p[1]} L 100 ${p[1]} L 100 100 Z`;
    }
    let d = `M ${pts[0][0]} 100 L ${pts[0][0]} ${pts[0][1]}`;
    for (let i = 1; i < pts.length; i++) {
      d += ` L ${pts[i][0]} ${pts[i][1]}`;
    }
    const last = pts[pts.length - 1];
    d += ` L ${last[0]} 100 L ${pts[0][0]} 100 Z`;
    return d;
  }

  const analyticsPlotPoints = useMemo(
    () => getAnalyticsChartPoints(currentData),
    [currentData, graphScale],
  );

  /* ------------------- UI STYLING ------------------- */
  const titleOpacity = isSimulation ? Math.max(0.4 - scrollY / 600, 0) : 0.1;
  const focusTimerProgressLength =
    initialSeconds > 0
      ? (seconds / initialSeconds) * FOCUS_TIMER_RING_CIRCUMFERENCE
      : FOCUS_TIMER_RING_CIRCUMFERENCE;
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
        @import url('https://fonts.googleapis.com/css2?family=DM+Mono:wght@300;400;500&display=swap');

        :root {
          --accent: #6366f1;
          --accent-glow: rgba(99, 102, 241, 0.15);
          --accent-ring: rgba(99, 102, 241, 0.12);
          --canvas-bg: #0a0a0b;
          --timer-font: 'DM Mono', monospace;
        }
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
          0%,100%{ box-shadow:0 0 0 0 rgba(157,132,216,0) }
          50%{ box-shadow:0 0 0 1px rgba(157,132,216,0.18),0 8px 28px -12px rgba(122,95,190,0.2) }
        }
        .tv-insights-grid{
          display:grid;
          grid-template-columns:repeat(3,minmax(0,1fr));
          gap:16px;
          position:relative;
          z-index:2;
        }
        @media (max-width: 1024px){
          .tv-insights-grid{ grid-template-columns:1fr; }
        }
        .tv-insight-card{
          border-radius:16px;
          padding:20px;
          min-height:180px;
          background:rgba(255,255,255,0.04);
          backdrop-filter:blur(12px);
          -webkit-backdrop-filter:blur(12px);
          box-shadow:
            0 4px 20px rgba(0,0,0,0.14),
            inset 0 1px 0 rgba(255,255,255,0.38);
          transition:all .25s ease;
          will-change:transform, box-shadow, filter, opacity;
        }
        .tv-insight-card--green{ background:rgba(34,197,94,0.10); }
        .tv-insight-card--red{ background:rgba(239,68,68,0.10); }
        .tv-insight-card--blue{ background:rgba(59,130,246,0.10); }
        .tv-insight-card--neutral{ background:rgba(148,163,184,0.12); }
        .tv-insight-card--locked{
          opacity:.7;
          filter:saturate(.8);
          pointer-events:none;
        }
        .tv-insight-card__title{
          font-size:16px;
          line-height:1.35;
          font-weight:600;
          color:#1f2937;
        }
        .tv-insight-card__description{
          margin-top:8px;
          font-size:13px;
          line-height:1.45;
          color:rgba(31,41,55,.60);
        }
        @keyframes tv-insight-title-bounce {
          0%,100%{ transform:translateY(0); }
          50%{ transform:translateY(-3px); }
        }
        .tv-insight-card--example .tv-insight-card__title--example{
          background:linear-gradient(120deg,rgba(129,140,248,0.95),rgba(56,189,248,0.9),rgba(52,211,153,0.9));
          -webkit-background-clip:text;
          background-clip:text;
          color:transparent;
          text-shadow:0 0 24px rgba(148,163,184,0.55);
          animation:tv-insight-title-bounce 3.4s ease-in-out infinite;
        }
        .tv-insight-card:hover{
          transform:translateY(-2px);
          box-shadow:
            0 12px 32px rgba(0,0,0,0.20),
            inset 0 1px 0 rgba(255,255,255,0.40);
        }
        .tv-insight-card:active{ transform:scale(.98); }
        .tv-insight-wisp{
          position:absolute;
          width:120px;
          height:120px;
          background:radial-gradient(circle, rgba(255,255,255,0.13), transparent 68%);
          filter:blur(20px);
          animation:tv-insight-float 6s ease-in-out infinite;
          pointer-events:none;
          z-index:1;
        }
        .tv-insight-wisp--a{ left:4%; top:6%; animation-delay:0s; }
        .tv-insight-wisp--b{ right:8%; top:14%; animation-delay:1.1s; }
        .tv-insight-wisp--c{ left:46%; bottom:-8px; animation-delay:2.2s; }
        @keyframes tv-insight-float{
          0%{ transform:translateY(0px); }
          50%{ transform:translateY(-12px); }
          100%{ transform:translateY(0px); }
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
        .timer-canvas{
          background:rgba(255,255,255,0.7);
          border-radius:16px;
          padding:32px 28px;
          display:flex;
          flex-direction:column;
          align-items:center;
          gap:16px;
          position:relative;
          overflow:hidden;
          border:1px solid #E5E7EB;
          box-shadow:0 4px 12px rgba(0,0,0,0.06);
          backdrop-filter:blur(24px);
          -webkit-backdrop-filter:blur(24px);
          transition:box-shadow .6s ease,border-color .6s ease,transform .2s ease;
        }
        .session-chip{
          background:rgba(255,255,255,0.06);
          border:0.5px solid rgba(255,255,255,0.12);
          border-radius:999px;
          padding:4px 14px;
          font-size:11px;
          letter-spacing:0.08em;
          color:rgba(255,255,255,0.4);
          font-weight:500;
        }
        .timer-display{
          font-family:var(--timer-font);
          font-size:72px;
          font-weight:400;
          letter-spacing:-0.02em;
          color:#111827;
          line-height:1;
          position:relative;
          z-index:2;
          transition:text-shadow .6s ease;
        }
        .timer-display .colon{ opacity:.35; }
        .timer-task-label{
          font-size:13px;
          color:rgba(255,255,255,0.3);
          text-align:center;
          max-width:220px;
          line-height:1.5;
          z-index:2;
        }
        .timer-controls{
          display:flex;
          align-items:center;
          gap:12px;
          z-index:2;
        }
        .btn-play{
          border-radius:12px;
          background:var(--accent);
          border:none;
          color:#ffffff;
          font-size:14px;
          font-weight:600;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:6px;
          padding:10px 16px;
          cursor:pointer;
          box-shadow:0 4px 12px rgba(99,102,241,0.28);
          transition:transform .1s,opacity .1s,background-color .15s;
        }
        .btn-play:hover{ opacity:.96; background:#4f46e5; }
        .btn-play:active{ transform:scale(.98); }
        .btn-ghost{
          border-radius:12px;
          background:transparent;
          border:1px solid #E5E7EB;
          color:#374151;
          font-size:14px;
          font-weight:500;
          padding:10px 16px;
          display:inline-flex;
          align-items:center;
          justify-content:center;
          gap:6px;
          cursor:pointer;
          transition:background .12s,border-color .12s;
        }
        .btn-ghost:hover{
          background:#F3F4F6;
          border-color:#E5E7EB;
        }
        .add-time-btn{
          background:rgba(255,255,255,0.05);
          border:0.5px solid rgba(255,255,255,0.1);
          border-radius:999px;
          padding:6px 16px;
          font-size:12px;
          color:rgba(255,255,255,0.4);
          cursor:pointer;
          transition:background .12s;
          z-index:2;
        }
        .add-time-btn:hover{ background:rgba(255,255,255,0.09); }
        .tunnel-overlay{
          position:absolute;
          inset:0;
          border-radius:20px;
          background:radial-gradient(ellipse 55% 45% at 50% 45%, var(--accent-glow) 0%, transparent 70%);
          opacity:0;
          transition:opacity .8s ease;
          pointer-events:none;
          z-index:1;
        }
        @keyframes glowPulse{
          0%,100%{ box-shadow:0 0 60px rgba(99,102,241,0.3), inset 0 0 40px rgba(99,102,241,0.1); }
          50%{ box-shadow:0 0 80px rgba(99,102,241,0.45), inset 0 0 50px rgba(99,102,241,0.15); }
        }
        .glow-pulse{ animation:glowPulse 3s ease-in-out infinite; }
        .task-input-row{ width:100%; max-width:560px; }
        .task-input-wrap{
          display:flex;
          align-items:center;
          gap:10px;
          background:#ffffff;
          border:0.5px solid #d1d5db;
          border-radius:10px;
          padding:10px 14px;
          transition:border-color .15s,box-shadow .15s;
        }
        .task-input-wrap:focus-within{
          border-color:var(--accent);
          box-shadow:0 0 0 3px var(--accent-ring);
        }
        .input-icon{
          color:#9ca3af;
          flex-shrink:0;
        }
        .task-input{
          flex:1;
          border:none;
          background:transparent;
          font-size:14px;
          color:inherit;
          outline:none;
        }
        .task-input::placeholder{ color:#9ca3af; }
        .input-kbd{
          font-size:11px;
          font-family:monospace;
          background:#f3f4f6;
          border:0.5px solid #e5e7eb;
          border-radius:4px;
          padding:2px 6px;
          color:#9ca3af;
        }
        .task-item{
          display:flex;
          align-items:center;
          gap:10px;
          padding:12px 16px;
          border-radius:12px;
          background:#ffffff;
          border:0.5px solid #e5e7eb;
          transition:border-color .12s,background .12s;
          cursor:default;
        }
        .task-item:hover{
          border-color:#d1d5db;
          background:#f9fafb;
        }
        .task-check{
          width:17px;
          height:17px;
          border-radius:50%;
          border:1.5px solid #d1d5db;
          background:transparent;
          flex-shrink:0;
          cursor:pointer;
          display:flex;
          align-items:center;
          justify-content:center;
          transition:background .12s,border-color .12s;
          padding:0;
        }
        .task-check:hover{ border-color:var(--accent); }
        .task-item.done .task-check{
          background:var(--accent);
          border-color:var(--accent);
        }
        .task-item.done .task-check::after{
          content:'';
          display:block;
          width:8px;
          height:5px;
          border-left:1.5px solid #fff;
          border-bottom:1.5px solid #fff;
          transform:rotate(-45deg) translateY(-1px);
        }
        .task-label{
          flex:1;
          font-size:14px;
          color:inherit;
        }
        .task-item.done .task-label{
          text-decoration:line-through;
          color:#9ca3af;
        }
        .task-badge{
          font-size:11px;
          font-weight:500;
          padding:2px 9px;
          border-radius:999px;
        }
        .task-badge.project{
          background:rgba(99,102,241,0.1);
          color:#6366f1;
        }
        .task-time{
          font-size:12px;
          color:#9ca3af;
        }
        .queue-row{
          display:flex;
          align-items:center;
          gap:10px;
          padding:8px 10px;
          border-radius:8px;
          cursor:pointer;
          transition:background .1s;
        }
        .queue-row:hover{ background:rgba(0,0,0,0.04); }
        .queue-row-name{
          flex:1;
          font-size:14px;
        }
        .queue-count{
          font-size:12px;
          font-weight:500;
          color:#9ca3af;
        }
        .queue-count.overdue{
          background:rgba(239,68,68,0.1);
          color:#ef4444;
          border-radius:999px;
          padding:1px 8px;
        }
      `}</style>

      <div
        className={`size-full bg-[#F7F8FA] text-[#111827] selection:bg-[#6366F1]/20 font-sans text-[13px] leading-normal transition-all duration-700 ${isSimulation ? "min-h-[240vh]" : "min-h-screen"} ${isTransitioning ? "opacity-0" : "opacity-100"}`}
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
                        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#9d84d8] text-[12px] font-semibold text-white ring-2 ring-[#9d84d8] ring-offset-2 ring-offset-white shadow-sm shadow-[rgba(122,95,190,0.25)]">
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
                        <span className="absolute right-1.5 top-1.5 z-[1] h-1.5 w-1.5 rounded-full bg-[#9d84d8] ring-2 ring-white" aria-hidden />
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
                        <span className="sidebar-focus-cta-label">Focus Today</span>
                      </button>
                    </div>

                    <nav className="flex flex-col gap-px" aria-label="Tasks">
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

                    <div className="sidebar-section-label sidebar-section-label--tools mt-8 mb-1.5 px-0">Tools</div>
                    <nav className="flex flex-col gap-px" aria-label="Tools">
                      <button
                        ref={focusNavButtonRef}
                        type="button"
                        onClick={handleStartFocusSession}
                        className="sidebar-nav-item"
                      >
                        <span className="sidebar-icon-slot">
                          <SidebarToolsIcon kind="timer" active={false} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">Timer</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSidebarNavClick("analytics")}
                        className={`sidebar-nav-item ${activeView === "analytics" ? "sidebar-nav-item--active" : ""}`}
                      >
                        <span className="sidebar-icon-slot">
                          <SidebarToolsIcon kind="insights" active={activeView === "analytics"} />
                        </span>
                        <span className="min-w-0 flex-1 truncate text-left">Insights</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSidebarNavClick("calendar")}
                        className={`sidebar-nav-item ${activeView === "calendar" ? "sidebar-nav-item--active" : ""}`}
                      >
                        <span className="sidebar-icon-slot">
                          <SidebarToolsIcon kind="schedule" active={activeView === "calendar"} />
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
              {!isFocusSessionActive && sidebarCollapsed ? (
                <button
                  type="button"
                  onClick={() => setSidebarCollapsed(false)}
                  className="absolute left-3 top-3 z-[260] flex h-9 w-9 items-center justify-center rounded-md border border-[#E5E7EB] bg-white text-[#5C5C5C] shadow-sm transition-colors hover:bg-[#F8FAFC]"
                  aria-label="Expand sidebar"
                  title="Expand sidebar"
                >
                  <svg className="h-[18px] w-[18px]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <rect x="4" y="5" width="16" height="14" rx="1.5" />
                    <line x1="9" y1="5" x2="9" y2="19" />
                  </svg>
                </button>
              ) : null}
              {/* Notifications dropdown panel */}
              {notificationsPanelOpen && (
                <div
                  ref={notificationsPanelRef}
                  id="app-notifications-panel"
                  role="dialog"
                  aria-label="Notifications"
                  className="pointer-events-auto fixed z-[280] w-[min(320px,calc(100vw-20px))] max-h-[min(680px,calc(100vh-72px))] flex flex-col rounded-[14px] border border-[#E5E7EB] bg-white shadow-[0_12px_34px_rgba(0,0,0,0.12)] overflow-hidden"
                  style={{
                    left: notificationsPanelPos.left,
                    top: notificationsPanelPos.bottom,
                  }}
                >
                  <div className="shrink-0 px-4 pt-3 pb-2">
                    <div className="inline-flex h-9 items-center rounded-full border border-[#E5E7EB] bg-[#F8FAFC] p-1 shadow-sm">
                      <button
                        type="button"
                        onClick={() => setNotificationsFilter("all")}
                        className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors ${
                          notificationsFilter === "all"
                            ? "bg-white text-[#111827]"
                            : "text-[#6B7280] hover:text-[#111827]"
                        }`}
                      >
                        All
                      </button>
                      <button
                        type="button"
                        onClick={() => setNotificationsFilter("unread")}
                        className={`rounded-full px-3 py-1 text-[13px] font-semibold transition-colors ${
                          notificationsFilter === "unread"
                            ? "bg-white text-[#111827]"
                            : "text-[#6B7280] hover:text-[#111827]"
                        }`}
                      >
                        Unread {notificationItems.filter((n) => !n.read).length}
                      </button>
                    </div>
                  </div>
                  <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">
                    {filteredNotificationItems.length === 0 ? (
                      <div className="flex flex-col items-center justify-center px-8 py-10 text-center">
                        <img
                          src="/notifications-empty.png"
                          alt=""
                          className="mb-4 h-auto w-[min(100%,260px)] max-h-[200px] object-contain select-none"
                          draggable={false}
                        />
                        <p className="text-[15px] font-semibold text-[#111827]">
                          {notificationsFilter === "unread"
                            ? "No unread notifications"
                            : "No notifications"}
                        </p>
                        <p className="text-[13px] text-[#6B7280] mt-2 max-w-[280px] leading-relaxed">
                          Overdue alerts and due-date reminders will show up here.
                        </p>
                      </div>
                    ) : (
                      <ul className="py-1">
                        {filteredNotificationItems.map((n, idx) => (
                          <li
                            key={n.id}
                            className="border-b border-[#F1F5F9] last:border-b-0"
                          >
                            <div
                              className={`px-4 py-3 hover:bg-[#F8FAFC] transition-colors ${!n.read ? "app-notif-item--unread" : "app-notif-item"}`}
                              style={{ animationDelay: `${idx * 45}ms` }}
                              onClick={() =>
                                setNotificationReadIds((prev) => {
                                  const next = new Set(prev);
                                  next.add(n.id);
                                  return next;
                                })
                              }
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

              <div
                className={`flex min-h-0 flex-1 ${
                  isFocusSessionActive
                    ? "overflow-x-hidden overflow-y-auto"
                    : "overflow-hidden"
                }`}
              >

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
                  <div className="w-full flex-1 min-h-0 flex flex-col overflow-hidden bg-[#FAFAFA]">
                    <div className="mx-auto flex h-full min-h-0 w-full max-w-[min(100%,720px)] flex-col px-6 sm:px-10">
                    <header className="shrink-0 bg-[#FAFAFA] pb-2 pt-8">
                      <div>
                        <h1 className="text-[26px] font-bold leading-tight text-[#202020] tracking-tight font-['Inter',system-ui,sans-serif]">
                          {mainTasksPanelTitle}
                        </h1>
                        {selectedListId ? (
                          <p className="mt-1 flex items-center gap-1.5 text-[13px] text-[#808080]">
                            <svg className="w-3.5 h-3.5 text-[#B0B0B0]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                              <path d="M22 4L12 14.01l-3-3" />
                            </svg>
                            <span>
                              {mainPanelTaskCount}{" "}
                              {mainPanelTaskCount === 1 ? "task" : "tasks"}
                            </span>
                          </p>
                        ) : null}
                      </div>
                    </header>

                    {/* ── Task List ── */}
                    <div className="relative flex-1 min-h-0 overflow-y-auto pb-8">
                      {completionBurstTier ? (<div className={`pointer-events-none absolute inset-0 z-[1] rounded-lg micro-completion-burst--${completionBurstTier}`} aria-hidden />) : null}

                      {!selectedListId ? (
                        <div className="px-6 py-10 text-[#9CA3AF] text-[14px] text-center">Select a category to view tasks</div>
                      ) : (() => {
                        const searchQ = taskSearchQuery.toLowerCase().trim();
                        const baseList: Task[] =
                          selectedListId === SYS_LIST_INBOX
                            ? buildFocusTodayTasksFromStorage(
                                tasksByListId,
                                notificationDay,
                              )
                            : visibleTasksForList;
                        const filtered = searchQ
                          ? baseList.filter((t) =>
                              t.text.toLowerCase().includes(searchQ),
                            )
                          : baseList;
                        const todoTasks = filtered.filter((t) => !t.completed);
                        const doneTasks = filtered.filter((t) => t.completed);

                        const dispName = name?.trim() || "User";
                        const emptyBlock =
                          todayMainMode === "search" && searchQ ? (
                            <div className="flex min-h-[200px] flex-col items-center justify-center text-[14px] text-[#6B7280]">
                              No tasks match your search.
                            </div>
                          ) : selectedListId === SYS_LIST_OVERDUE ? (
                            <div className="flex flex-col items-center justify-center min-h-[240px]">
                              <SaaSAllCaughtUpIllustration />
                              <p className="text-[15px] font-semibold text-[#374151]">
                                Nothing overdue — nice work!
                              </p>
                              <p className="text-[13px] text-[#9CA3AF] mt-1">You&apos;re all clear.</p>
                            </div>
                          ) : selectedListId === SYS_LIST_INBOX &&
                            focusForTodayItems.length === 0 ? (
                            <ListEmptyHero
                              src={EMPTY_STATE_IMG.focusDayOff}
                              className={listEmptyExit ? "micro-empty-out" : ""}
                              title={`Enjoy a true day off, ${dispName}!`}
                              subtitle="Nothing is showing from your lists yet — add tasks in Today, Projects, Tests, or Long-Term and they will line up here automatically."
                            />
                          ) : allElasticListTasksComplete ? (
                            selectedListId === SYS_LIST_TODAY ? (
                              <ListEmptyHero
                                src={EMPTY_STATE_IMG.today}
                                className={listEmptyExit ? "micro-empty-out" : ""}
                                title={`Have a marvelous day, ${dispName}!`}
                                subtitle="You're all caught up for today."
                              />
                            ) : selectedListId === SYS_LIST_LONGTERM ? (
                              <ListEmptyHero
                                src={EMPTY_STATE_IMG.longterm}
                                className={listEmptyExit ? "micro-empty-out" : ""}
                                title={`Long-term load is light, ${dispName}`}
                                subtitle="No long-term assignments need attention in this view right now."
                              />
                            ) : selectedListId === SYS_LIST_TESTS ? (
                              <ListEmptyHero
                                src={EMPTY_STATE_IMG.tests}
                                className={listEmptyExit ? "micro-empty-out" : ""}
                                title={`Tests are clear, ${dispName}`}
                                subtitle="No exams or test prep tasks here — you're covered for now."
                              />
                            ) : selectedListId === SYS_LIST_PROJECTS ? (
                              <ListEmptyHero
                                src={EMPTY_STATE_IMG.projects}
                                className={listEmptyExit ? "micro-empty-out" : ""}
                                title={`Project board is quiet, ${dispName}`}
                                subtitle="No active project tasks in this list. Enjoy the pause or add your next milestone."
                              />
                            ) : (
                              <div
                                className={`flex flex-col items-center justify-center min-h-[280px] px-4 ${listEmptyExit ? "micro-empty-out" : ""}`}
                              >
                                <SaaSAllCaughtUpIllustration />
                                <p className="text-[17px] font-bold text-[#202020] text-center max-w-md">
                                  {todoistEmptyDayMessage.title}
                                </p>
                                <p className="text-[14px] text-[#6B7280] mt-2 text-center max-w-sm leading-relaxed">
                                  You&apos;re all caught up in this view.
                                </p>
                              </div>
                            )
                          ) : (
                            <div
                              className={`flex flex-col items-center justify-center min-h-[260px] px-4 ${listEmptyExit ? "micro-empty-out" : ""}`}
                            >
                              <SaaSAllCaughtUpIllustration />
                              <p className="text-[17px] font-bold text-[#202020] text-center max-w-md">
                                No tasks yet
                              </p>
                              <p className="text-[14px] text-[#6B7280] mt-2 text-center max-w-sm leading-relaxed">
                                Add your first task using the button above.
                              </p>
                            </div>
                          );

                        return (
                          <div className="flex w-full flex-col">
                            {selectedListId !== SYS_LIST_OVERDUE &&
                              selectedListId !== SYS_LIST_INBOX && (
                              <>
                                {quickAddOpen ? (
                                  <div className="rounded-lg border border-[#E5E7EB] bg-white p-3 shadow-sm mb-4">
                                    <input
                                      value={composerTitle}
                                      onChange={(e) => setComposerTitle(e.target.value)}
                                      placeholder={quickAddComposerTitlePlaceholder}
                                      className="w-full border-0 bg-transparent p-0 text-[15px] font-semibold text-[#202020] placeholder:text-[#B0B0B0] outline-none"
                                    />
                                    <textarea
                                      value={composerDescription}
                                      onChange={(e) => setComposerDescription(e.target.value)}
                                      placeholder="Description"
                                      rows={2}
                                      className="mt-2 w-full resize-none border-0 bg-transparent p-0 text-[13px] text-[#202020] placeholder:text-[#B0B0B0] outline-none"
                                    />
                                    <div className="mt-3 flex flex-wrap items-center gap-2">
                                      {selectedListId === SYS_LIST_TODAY ? (
                                        <span className="inline-flex items-center gap-1 rounded-md bg-[#E8F5E9] px-2 py-1 text-[12px] font-medium text-[#058527]">
                                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                            <rect x="3" y="4" width="18" height="18" rx="2" />
                                            <path d="M16 2v4M8 2v4M3 10h18" />
                                          </svg>
                                          Today
                                        </span>
                                      ) : (
                                        <button
                                          type="button"
                                          onClick={(e) =>
                                            setComposerDuePopover({
                                              anchor: e.currentTarget.getBoundingClientRect(),
                                            })
                                          }
                                          className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium transition-colors ${
                                            composerDue
                                              ? "border-transparent bg-[#E8F5E9] text-[#058527]"
                                              : "border-[#E5E7EB] text-[#6B7280] hover:bg-[#FAFAFA]"
                                          }`}
                                        >
                                          <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                            <rect x="3" y="4" width="18" height="18" rx="2" />
                                            <path d="M16 2v4M8 2v4M3 10h18" />
                                          </svg>
                                          {formatDueChipLabel(composerDue, calendarDay)}
                                          {composerDue &&
                                          selectedListId &&
                                          DUE_DATE_PICKER_LIST_IDS.has(selectedListId) ? (
                                            <span
                                              role="button"
                                              tabIndex={0}
                                              onClick={(ev) => {
                                                ev.stopPropagation();
                                                setComposerDue(null);
                                              }}
                                              className="ml-0.5 text-[#6B7280] hover:text-[#202020]"
                                            >
                                              ×
                                            </span>
                                          ) : null}
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          setComposerPriorityAnchor(
                                            e.currentTarget.getBoundingClientRect(),
                                          );
                                          setComposerPriorityOpen(true);
                                        }}
                                        className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px] text-[#6B7280] hover:bg-[#FAFAFA]"
                                      >
                                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                          <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                                          <line x1="4" y1="22" x2="4" y2="15" />
                                        </svg>
                                        Priority
                                      </button>
                                    </div>
                                    <div className="mt-4 flex justify-end gap-2 border-t border-[#F1F5F9] pt-3">
                                      <button
                                        type="button"
                                        onClick={cancelQuickAddComposer}
                                        className="rounded-md px-3 py-1.5 text-[13px] text-[#6B7280] hover:bg-[#FAFAFA]"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        type="button"
                                        onClick={submitQuickAddComposer}
                                        className="rounded-md bg-[#9d84d8] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm shadow-[rgba(122,95,190,0.2)] transition-colors hover:bg-[#8a6fcc]"
                                      >
                                        Add task
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    type="button"
                                    onClick={openQuickAddComposer}
                                    className="mb-4 flex items-center gap-2 py-0.5 text-left text-[14px] text-[#9d84d8] transition-colors hover:text-[#8a6fcc]"
                                  >
                                    <span className="text-[20px] font-light leading-none">+</span>
                                    Add task
                                  </button>
                                )}
                              </>
                            )}

                            {selectedListId === SYS_LIST_INBOX && todoTasks.length > 0 ? (
                              <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
                                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                                  <div className="min-w-0 flex-1">
                                    <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
                                      Focus queue · smart sort
                                    </p>
                                    <p className="mt-1 text-[13px] leading-relaxed text-[#6B7280]">
                                      Order uses due dates and quick time estimates. Add an estimate when prompted to keep the queue accurate.
                                    </p>
                                    <ol className="mt-3 space-y-2">
                                      {focusForTodayItems.map((p, i) => {
                                        const t = getTaskForPick(tasksByListId, p);
                                        const key = `${p.listId}:${p.taskId}`;
                                        const showEst =
                                          !!t && focusEstimatePromptKeys.has(key);
                                        return (
                                          <li
                                            key={key}
                                            className="flex flex-col gap-2 rounded-lg border border-[#F1F5F9] bg-[#FAFAFA] px-3 py-2 sm:flex-row sm:items-center sm:justify-between"
                                          >
                                            <div className="flex min-w-0 items-start gap-2">
                                              <span className="text-[12px] font-semibold text-[#9CA3AF]">
                                                {i + 1}
                                              </span>
                                              <div className="min-w-0">
                                                <p className="font-medium text-[#202020]">{p.displayTitle}</p>
                                                <p className="text-[12px] text-[#9CA3AF]">
                                                  {formatFocusTimeLine(p, t)}
                                                </p>
                                              </div>
                                            </div>
                                            {showEst && t ? (
                                              <div className="flex flex-wrap gap-1">
                                                {[15, 25, 45, 60].map((m) => (
                                                  <button
                                                    key={m}
                                                    type="button"
                                                    onClick={() =>
                                                      handleFocusEstimateInline(
                                                        p.listId,
                                                        p.taskId,
                                                        m,
                                                      )
                                                    }
                                                    className="rounded-md border border-[#E5E7EB] bg-white px-2 py-0.5 text-[11px] font-medium text-[#6B7280] hover:border-[#6366F1]/40 hover:text-[#6366F1]"
                                                  >
                                                    {m}m
                                                  </button>
                                                ))}
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    handleFocusEstimateInline(
                                                      p.listId,
                                                      p.taskId,
                                                      "skip",
                                                    )
                                                  }
                                                  className="rounded-md px-2 py-0.5 text-[11px] text-[#9CA3AF] hover:text-[#6B7280]"
                                                >
                                                  Skip
                                                </button>
                                              </div>
                                            ) : null}
                                          </li>
                                        );
                                      })}
                                    </ol>
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      addAllFocusQueueToSession();
                                      if (!isFocusSessionActive && !focusEnterZenActive) {
                                        runFocusEnterZenTransition();
                                      }
                                    }}
                                    className="shrink-0 rounded-lg bg-[#6366F1] px-4 py-2.5 text-[13px] font-semibold text-white shadow-sm transition hover:bg-[#4f46e5]"
                                  >
                                    Send to timer
                                  </button>
                                </div>
                              </div>
                            ) : null}

                            {filtered.length === 0 ? (
                              emptyBlock
                            ) : (
                            <>
                            <div
                              className={`overflow-hidden rounded-lg border border-[#E5E7EB] bg-white ${listFirstTaskEnter ? "micro-list-shell-in" : ""}`}
                            >
                                {todoTasks.map((t) => {
                                  const isSelected = taskDetailModalId === t.id;
                                  const sourceListId =
                                    selectedListId === SYS_LIST_INBOX
                                      ? focusTaskSourceByTaskId.get(t.id) ??
                                        selectedListId
                                      : selectedListId!;
                                  const classLabel =
                                    sourceListId === SYS_LIST_TODAY
                                      ? "Today"
                                      : sourceListId === SYS_LIST_OVERDUE
                                        ? "Overdue"
                                        : sourceListId === SYS_LIST_PROJECTS
                                          ? "Projects"
                                          : sourceListId === SYS_LIST_TESTS
                                            ? "Tests"
                                            : sourceListId === SYS_LIST_LONGTERM
                                              ? "Long-Term"
                                              : sourceListId === SYS_LIST_INBOX
                                                ? "Inbox"
                                                : selectedList?.label ?? "—";
                                  const listReadOnly =
                                    selectedListId === SYS_LIST_OVERDUE;
                                  const noReorder =
                                    selectedListId === SYS_LIST_OVERDUE ||
                                    selectedListId === SYS_LIST_INBOX;
                                  const editListId =
                                    editingSourceListId ?? selectedListId;
                                  if (
                                    editingTaskId === t.id &&
                                    selectedListId !== SYS_LIST_OVERDUE
                                  ) {
                                    return (
                                      <div key={`${sourceListId}-${t.id}`} className="border-b border-[#E5E7EB] bg-white p-3">
                                        <input
                                          value={editDraftTitle}
                                          onChange={(e) => setEditDraftTitle(e.target.value)}
                                          className="w-full border-0 bg-transparent p-0 text-[15px] font-semibold text-[#202020] outline-none"
                                        />
                                        <textarea
                                          value={editDraftDescription}
                                          onChange={(e) => setEditDraftDescription(e.target.value)}
                                          placeholder="Description"
                                          rows={2}
                                          className="mt-2 w-full resize-none border-0 bg-transparent p-0 text-[13px] text-[#202020] outline-none"
                                        />
                                        <div className="mt-3 flex flex-wrap items-center gap-2">
                                          {editListId === SYS_LIST_TODAY ? (
                                            <span className="inline-flex items-center gap-1 rounded-md bg-[#E8F5E9] px-2 py-1 text-[12px] font-medium text-[#058527]">
                                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                                <rect x="3" y="4" width="18" height="18" rx="2" />
                                                <path d="M16 2v4M8 2v4M3 10h18" />
                                              </svg>
                                              Today
                                            </span>
                                          ) : (
                                            <button
                                              type="button"
                                              onClick={(e) =>
                                                setEditDraftDuePopover({
                                                  anchor: e.currentTarget.getBoundingClientRect(),
                                                })
                                              }
                                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[12px] font-medium ${
                                                editDraftDue
                                                  ? "border-transparent bg-[#E8F5E9] text-[#058527]"
                                                  : "border-[#E5E7EB] text-[#6B7280] hover:bg-[#FAFAFA]"
                                              }`}
                                            >
                                              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                                <rect x="3" y="4" width="18" height="18" rx="2" />
                                                <path d="M16 2v4M8 2v4M3 10h18" />
                                              </svg>
                                              {formatDueChipLabel(editDraftDue, calendarDay)}
                                              {editDraftDue &&
                                              editListId &&
                                              DUE_DATE_PICKER_LIST_IDS.has(editListId) ? (
                                                <span
                                                  role="button"
                                                  tabIndex={0}
                                                  onClick={(ev) => {
                                                    ev.stopPropagation();
                                                    setEditDraftDue(null);
                                                  }}
                                                  className="ml-0.5 text-[#6B7280] hover:text-[#202020]"
                                                >
                                                  ×
                                                </span>
                                              ) : null}
                                            </button>
                                          )}
                                          <button
                                            type="button"
                                            onClick={(e) => {
                                              setEditDraftPriorityAnchor(
                                                e.currentTarget.getBoundingClientRect(),
                                              );
                                              setEditDraftPriorityOpen(true);
                                            }}
                                            className="inline-flex items-center gap-1 rounded-md border border-[#E5E7EB] px-2 py-1 text-[12px] text-[#6B7280] hover:bg-[#FAFAFA]"
                                          >
                                            <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                              <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
                                              <line x1="4" y1="22" x2="4" y2="15" />
                                            </svg>
                                            Priority {editDraftPriority}
                                          </button>
                                        </div>
                                        <div className="mt-4 flex justify-end gap-2 border-t border-[#F1F5F9] pt-3">
                                          <button
                                            type="button"
                                            onClick={cancelEditDraft}
                                            className="rounded-md px-3 py-1.5 text-[13px] text-[#6B7280] hover:bg-[#FAFAFA]"
                                          >
                                            Cancel
                                          </button>
                                          <button
                                            type="button"
                                            onClick={saveEditDraft}
                                            className="rounded-md bg-[#9d84d8] px-4 py-1.5 text-[13px] font-semibold text-white shadow-sm shadow-[rgba(122,95,190,0.2)] transition-colors hover:bg-[#8a6fcc]"
                                          >
                                            Save
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  }
                                  const pr = (t.priority ?? 4) as TaskPriorityLevel;
                                  const ring =
                                    t.completed || taskCheckAnimatingId === t.id
                                      ? "border-emerald-500 bg-emerald-500"
                                      : priorityCheckboxRingClass(pr);
                                  const sourceListLabel =
                                    allListsForSelection.find(
                                      (l) => l.id === sourceListId,
                                    )?.label ?? "Tasks";
                                  const rowElasticComplete =
                                    sourceListId !== SYS_LIST_OVERDUE &&
                                    (ELASTIC_COMPLETE_SYS_LIST_IDS.has(
                                      sourceListId,
                                    ) ||
                                      todayLists.some(
                                        (l) => l.id === sourceListId,
                                      ));
                                  return (
                                    <div
                                      key={`${sourceListId}-${t.id}`}
                                      role="button"
                                      tabIndex={0}
                                      onDragOver={(e) => {
                                        if (noReorder) return;
                                        if (draggingTaskId == null || draggingTaskId === t.id) return;
                                        e.preventDefault();
                                        setDropBeforeTaskId(t.id);
                                      }}
                                      onDrop={(e) => {
                                        e.preventDefault();
                                        if (noReorder) return;
                                        if (draggingTaskId == null) return;
                                        handleReorderDrop(draggingTaskId, t.id);
                                      }}
                                      onClick={() => {
                                        if (skipRowClickRef.current) return;
                                        setSelectedTaskId(t.id);
                                        setTaskDetailModalId(t.id);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter") {
                                          setTaskDetailModalId(t.id);
                                        }
                                      }}
                                      className={`group relative flex min-h-[44px] cursor-pointer items-center gap-2 border-b border-[#E5E7EB] px-3 py-2 transition-colors duration-100 last:border-b-0 ${
                                        taskRowExitingId === t.id ? "pointer-events-none opacity-0" : ""
                                      } ${taskReappearId === t.id ? "animate-task-reappear" : ""} ${newListTaskAnimId === t.id ? "micro-row-enter" : ""} ${
                                        draggingTaskId === t.id ? "z-10 shadow-[0_8px_24px_rgba(0,0,0,0.12)]" : ""
                                      } ${isSelected ? "bg-[#FAFAFA]" : "hover:bg-[#FAFAFA]"}`}
                                    >
                                      {dropBeforeTaskId === t.id && draggingTaskId !== t.id ? (
                                        <div className="pointer-events-none absolute -top-px left-0 right-0 z-[2] flex h-0.5 items-center bg-[#9d84d8]">
                                          <span className="absolute -left-0.5 h-2 w-2 rounded-full bg-[#9d84d8]" />
                                        </div>
                                      ) : null}
                                      {!noReorder ? (
                                        <button
                                          type="button"
                                          draggable={editingTaskId !== t.id}
                                          onDragStart={(e) => {
                                            e.stopPropagation();
                                            setDraggingTaskId(t.id);
                                            e.dataTransfer.effectAllowed = "move";
                                            e.dataTransfer.setData("text/plain", String(t.id));
                                          }}
                                          onDragEnd={() => {
                                            setDraggingTaskId(null);
                                            setDropBeforeTaskId(null);
                                            setDragOverPostpone(false);
                                            skipRowClickRef.current = true;
                                            window.setTimeout(() => {
                                              skipRowClickRef.current = false;
                                            }, 0);
                                          }}
                                          onClick={(e) => e.stopPropagation()}
                                          className="cursor-grab text-[#C4C4C4] opacity-0 transition-opacity hover:text-[#9CA3AF] group-hover:opacity-100 active:cursor-grabbing"
                                          aria-label="Reorder"
                                        >
                                          <span className="grid grid-cols-2 gap-0.5" aria-hidden>
                                            {[0, 1, 2, 3, 4, 5].map((i) => (
                                              <span key={i} className="h-1 w-1 rounded-full bg-current" />
                                            ))}
                                          </span>
                                        </button>
                                      ) : (
                                        <span className="w-4 shrink-0" aria-hidden />
                                      )}
                                      <div className="flex shrink-0 items-center justify-center">
                                        <button
                                          type="button"
                                          disabled={taskCheckAnimatingId === t.id}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            const next = !t.completed;
                                            if (!selectedListId) return;
                                            if (next && rowElasticComplete) {
                                              scheduleElasticListTaskComplete(
                                                t,
                                                sourceListId,
                                                sourceListLabel,
                                              );
                                              return;
                                            }
                                            if (next) {
                                              appendCompletedActivity(
                                                t.text,
                                                0,
                                                sourceListId,
                                                sourceListLabel,
                                              );
                                            } else {
                                              removeLastCompletedForTaskOnList(
                                                t.text,
                                                sourceListId,
                                              );
                                            }
                                            if (selectedListId === SYS_LIST_INBOX) {
                                              setTasksByListId((prev) => {
                                                const arr = [
                                                  ...(prev[sourceListId] ?? []),
                                                ];
                                                const idx = arr.findIndex(
                                                  (x) => x.id === t.id,
                                                );
                                                if (idx === -1) return prev;
                                                arr[idx] = {
                                                  ...arr[idx],
                                                  completed: next,
                                                };
                                                return {
                                                  ...prev,
                                                  [sourceListId]: arr,
                                                };
                                              });
                                            }
                                            setTasks((prev) =>
                                              prev.map((x) =>
                                                x.id === t.id
                                                  ? { ...x, completed: next }
                                                  : x,
                                              ),
                                            );
                                          }}
                                          className={`btn-press-instant flex h-[18px] w-[18px] items-center justify-center rounded-full border-[2px] transition-colors disabled:opacity-100 ${ring} ${
                                            taskCheckAnimatingId === t.id ? "elastic-cb-pulse" : ""
                                          }`}
                                          aria-label={t.completed ? "Mark incomplete" : "Complete task"}
                                        >
                                          {rowElasticComplete &&
                                          taskCheckAnimatingId === t.id ? (
                                            <svg className="h-[9px] w-[9px]" viewBox="0 0 12 12" fill="none" aria-hidden>
                                              <path
                                                className="elastic-check-path-draw"
                                                d="M2.5 6.2 L5 8.8 L9.5 3.5"
                                                stroke="white"
                                                strokeWidth="2"
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                              />
                                            </svg>
                                          ) : t.completed ? (
                                            <span className="text-[8px] leading-none text-white">✓</span>
                                          ) : null}
                                        </button>
                                      </div>
                                      <div className="min-w-0 flex-1">
                                        <div className="text-[14px] font-medium leading-snug text-[#202020]">
                                          {t.text}
                                        </div>
                                        {t.description ? (
                                          <div className="mt-0.5 text-[12px] leading-snug text-[#808080]">
                                            {t.description}
                                          </div>
                                        ) : null}
                                      </div>
                                      <div className="hidden shrink-0 items-center gap-1 text-[12px] text-[#9CA3AF] sm:flex">
                                        <span className="max-w-[120px] truncate">{classLabel}</span>
                                      </div>
                                      {!listReadOnly ? (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            startEditTask(
                                              t,
                                              selectedListId === SYS_LIST_INBOX
                                                ? focusTaskSourceByTaskId.get(
                                                    t.id,
                                                  )
                                                : undefined,
                                            );
                                          }}
                                          className="shrink-0 rounded-md p-1.5 text-[#9CA3AF] opacity-0 transition-opacity hover:bg-[#F1F5F9] hover:text-[#6B7280] group-hover:opacity-100"
                                          aria-label="Edit task"
                                        >
                                          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                            <path d="M12 20h9" />
                                            <path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                                          </svg>
                                        </button>
                                      ) : null}
                                    </div>
                                  );
                                })}
                            </div>

                            {selectedListId &&
                            selectedListId !== SYS_LIST_INBOX &&
                            draggingTaskId !== null ? (
                              <div
                                onDragOver={(e) => {
                                  e.preventDefault();
                                  setDragOverPostpone(true);
                                }}
                                onDragLeave={() => setDragOverPostpone(false)}
                                onDrop={(e) => {
                                  e.preventDefault();
                                  const id = parseInt(e.dataTransfer.getData("text/plain"), 10);
                                  if (!Number.isFinite(id)) return;
                                  handlePostponeDropOnZone(id);
                                }}
                                className={`mt-4 flex min-h-[72px] items-center justify-center gap-2 rounded-lg border-2 border-dashed px-4 text-[13px] transition-colors ${
                                  dragOverPostpone
                                    ? "border-[#9d84d8] bg-[#f7f4fc]"
                                    : "border-[#D1D5DB] bg-[#FAFAFA] text-[#6B7280]"
                                }`}
                              >
                                <svg className="h-5 w-5 text-[#9d84d8]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="M23 4v6h-6" />
                                  <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
                                </svg>
                                <span>
                                  Drop to postpone: <strong className="text-[#202020]">Tomorrow</strong>
                                </span>
                              </div>
                            ) : null}

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
                            </>
                            )}
                          </div>
                        );
                      })()}
                    </div>
                    </div>
                    <MiniDueDatePopover
                      open={dueDatePopover !== null}
                      anchor={dueDatePopover?.anchor ?? null}
                      selectedIso={dueDatePopover ? tasks.find((x) => x.id === dueDatePopover.taskId)?.dueDate ?? null : null}
                      onSelect={(iso) => {
                        const tid = dueDatePopover?.taskId;
                        if (tid == null) return;
                        const lid =
                          selectedListId === SYS_LIST_INBOX
                            ? focusTaskSourceByTaskId.get(tid)
                            : selectedListId;
                        const resolved =
                          lid ?? findTaskListIdContaining(tasksByListId, tid);
                        if (resolved) {
                          setTasksByListId((prev) => {
                            const arr = [...(prev[resolved] ?? [])];
                            const i = arr.findIndex((x) => x.id === tid);
                            if (i === -1) return prev;
                            arr[i] = { ...arr[i], dueDate: iso };
                            return { ...prev, [resolved]: arr };
                          });
                        }
                        setTasks((prev) =>
                          prev.map((x) =>
                            x.id === tid ? { ...x, dueDate: iso } : x,
                          ),
                        );
                        setDueDatePopover(null);
                      }}
                      onClose={() => setDueDatePopover(null)}
                    />
                    <MiniDueDatePopover
                      open={composerDuePopover !== null}
                      anchor={composerDuePopover?.anchor ?? null}
                      selectedIso={composerDue}
                      onSelect={(iso) => {
                        setComposerDue(iso);
                        setComposerDuePopover(null);
                      }}
                      onClose={() => setComposerDuePopover(null)}
                    />
                    <MiniDueDatePopover
                      open={editDraftDuePopover !== null}
                      anchor={editDraftDuePopover?.anchor ?? null}
                      selectedIso={editDraftDue}
                      onSelect={(iso) => {
                        setEditDraftDue(iso);
                        setEditDraftDuePopover(null);
                      }}
                      onClose={() => setEditDraftDuePopover(null)}
                    />
                    <PriorityPickerPopover
                      open={composerPriorityOpen}
                      anchor={composerPriorityAnchor}
                      selected={composerPriority}
                      onSelect={(p) => {
                        setComposerPriority(p);
                        setComposerPriorityOpen(false);
                      }}
                      onClose={() => setComposerPriorityOpen(false)}
                    />
                    <PriorityPickerPopover
                      open={editDraftPriorityOpen}
                      anchor={editDraftPriorityAnchor}
                      selected={editDraftPriority}
                      onSelect={(p) => {
                        setEditDraftPriority(p);
                        setEditDraftPriorityOpen(false);
                      }}
                      onClose={() => setEditDraftPriorityOpen(false)}
                    />
                    {taskDetailModalId != null && taskDetailModalTask ? (
                      <div
                        className="fixed inset-0 z-[600] flex items-center justify-center bg-black/25 p-4 font-['Inter',system-ui,sans-serif]"
                        role="dialog"
                        aria-modal="true"
                        aria-label="Task details"
                        onClick={() => setTaskDetailModalId(null)}
                      >
                        <div
                          className="relative flex max-h-[min(90vh,640px)] w-full max-w-[760px] flex-col overflow-hidden rounded-xl bg-white shadow-[0_16px_48px_rgba(0,0,0,0.18)] sm:flex-row"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <div className="flex min-h-0 min-w-0 flex-1 flex-col border-b border-[#E5E7EB] sm:border-b-0 sm:border-r">
                            <div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
                              <div className="flex items-center gap-2 text-[12px] text-[#6B7280]">
                                <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                                  <path d="M22 12h-6l-2 3h-6l-2-3H2" />
                                  <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
                                </svg>
                                <span>{categoryLabelForSelectedList}</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => setTaskDetailModalId(null)}
                                className="rounded-md p-1.5 text-[#9CA3AF] hover:bg-[#F3F4F6] hover:text-[#6B7280]"
                                aria-label="Close"
                              >
                                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                  <path d="M18 6L6 18M6 6l12 12" />
                                </svg>
                              </button>
                            </div>
                            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                              <div className="flex gap-3">
                                <button
                                  type="button"
                                  className={`mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 ${priorityCheckboxRingClass((taskDetailModalTask.priority ?? 4) as TaskPriorityLevel)}`}
                                  aria-hidden
                                />
                                <div>
                                  <h2 className="text-[18px] font-semibold leading-snug text-[#202020]">
                                    {taskDetailModalTask.text}
                                  </h2>
                                  <p className="mt-3 text-[13px] leading-relaxed text-[#6B7280]">
                                    {taskDetailModalTask.description || (
                                      <span className="text-[#B0B0B0]">Description</span>
                                    )}
                                  </p>
                                </div>
                              </div>
                            </div>
                          </div>
                          <div className="w-full shrink-0 border-t border-[#E5E7EB] bg-[#FAFAFA] px-5 py-4 sm:w-[240px] sm:border-t-0">
                            <div className="space-y-5 text-[13px]">
                              <div>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-[#9CA3AF]">
                                  Project
                                </p>
                                <p className="mt-1 font-medium text-[#202020]">{categoryLabelForSelectedList}</p>
                              </div>
                              <div>
                                <p className="text-[11px] font-medium uppercase tracking-wide text-[#9CA3AF]">
                                  Date
                                </p>
                                <p className="mt-1 flex items-center gap-1.5 font-medium text-[#058527]">
                                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
                                    <rect x="3" y="4" width="18" height="18" rx="2" />
                                    <path d="M16 2v4M8 2v4M3 10h18" />
                                  </svg>
                                  {taskDetailModalTask.dueDate
                                    ? formatDueChipLabel(taskDetailModalTask.dueDate, calendarDay)
                                    : "No date"}
                                </p>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    ) : null}
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
                      <TasksDueUpcomingSchedule
                        rangeStartIso={scheduleRangeStartIso}
                        tasksByDate={tasksByDueDate}
                        todayIso={calendarDay}
                        onPrevDay={() =>
                          setScheduleRangeStartIso((s) => addDaysToIso(s, -1))
                        }
                        onNextDay={() =>
                          setScheduleRangeStartIso((s) => addDaysToIso(s, 1))
                        }
                        onTodayRange={() =>
                          setScheduleRangeStartIso(toISODate(new Date()))
                        }
                        onTaskPick={openTaskFromCalendar}
                        onCompleteTask={completeTaskFromSchedule}
                      />
                    ) : activeView === "analytics" ? (
                      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#F9FAFB] text-[#111827] [text-rendering:optimizeLegibility] font-[family-name:Inter,system-ui,-apple-system,sans-serif] antialiased">
                        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                          <div className="w-full max-w-none mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-12 space-y-6">
                            <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
                              <div>
                                <h1 className="text-[28px] font-bold leading-tight tracking-[-0.03em] text-[#111827]">
                                  Analytics
                                </h1>
                                <p className="mt-1 text-[14px] font-medium text-[#4B5563]">
                                  Focus trends and discipline at a glance
                                </p>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                <div
                                  ref={analyticsRangeRef}
                                  className="relative z-[402]"
                                >
                                  <button
                                    type="button"
                                    aria-expanded={analyticsRangeOpen}
                                    aria-haspopup="listbox"
                                    onClick={() =>
                                      setAnalyticsRangeOpen((o) => !o)
                                    }
                                    className="inline-flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3.5 py-2 text-[13px] font-medium text-[#374151] shadow-sm outline-none transition-colors hover:bg-[#FAFAFA] focus-visible:ring-2 focus-visible:ring-[#9d84d8]/25"
                                  >
                                    {analyticsRange === "7d"
                                      ? "Last 7 days"
                                      : analyticsRange === "14d"
                                        ? "Last 14 days"
                                        : "Last month"}
                                    <svg
                                      className={`h-4 w-4 text-[#9CA3AF] shrink-0 transition-transform duration-150 ${analyticsRangeOpen ? "rotate-180" : ""}`}
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
                                  {analyticsRangeOpen && (
                                    <div
                                      className="absolute right-0 top-full z-[403] mt-1.5 min-w-[11.5rem] overflow-hidden rounded-lg border border-[#E5E7EB] bg-white py-1 shadow-[0_8px_24px_rgba(15,23,42,0.1)]"
                                      role="listbox"
                                    >
                                      {(
                                        [
                                          ["7d", "Last 7 days"],
                                          ["14d", "Last 14 days"],
                                          ["30d", "Last month"],
                                        ] as const
                                      ).map(([val, label]) => (
                                        <button
                                          key={val}
                                          type="button"
                                          role="option"
                                          aria-selected={analyticsRange === val}
                                          onClick={() => {
                                            setAnalyticsRange(val);
                                            setAnalyticsRangeOpen(false);
                                          }}
                                          className={`flex w-full items-center px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                                            analyticsRange === val
                                              ? "bg-[#F3EEFC] text-[#5B21B6]"
                                              : "text-[#374151] hover:bg-[#F9FAFB]"
                                          }`}
                                        >
                                          {label}
                                        </button>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </header>

                            <section className="rounded-2xl border border-[#E5E7EB] bg-white shadow-sm transition-[background-color] duration-150">
                              <div className="flex flex-col gap-1 p-5 sm:p-6 border-b border-[#E5E7EB]">
                                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
                                  <div className="min-w-0">
                                    <h2 className="text-[20px] font-bold leading-tight tracking-[-0.02em] text-[#111827]">
                                      {selectedStat === "Integrity"
                                        ? "Focus Integrity"
                                        : "Task Speed"}
                                    </h2>
                                    <p className="mt-1 text-[14px] font-medium text-[#4B5563]">
                                      {selectedStat === "Integrity"
                                        ? "Consistency over time · all focus sessions"
                                        : selectedTaskGraph
                                          ? `${formatTaskTitleForGraph(normalizeTaskKey(selectedTaskGraph))} · Completion time per session`
                                          : "All tasks · completion time per session"}
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
                                          className="flex h-9 w-full cursor-pointer items-center justify-between gap-2.5 rounded-[10px] border border-[#E5E7EB] bg-white px-3.5 py-1.5 text-left text-[13px] font-semibold text-[#111827] outline-none ring-0 transition-colors duration-150 hover:border-[#D1D5DB] focus-visible:border-[#0EA5E9] focus-visible:ring-2 focus-visible:ring-[#0EA5E9]/20"
                                        >
                                          <span className="min-w-0 flex-1 truncate tracking-tight">
                                            {selectedTaskGraph
                                              ? formatTaskTitleForGraph(
                                                  normalizeTaskKey(
                                                    selectedTaskGraph,
                                                  ),
                                                )
                                              : "All tasks"}
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
                                                    ? "bg-[#E0F2FE] text-[#111827]"
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
                                                  All tasks
                                                </span>
                                              </button>
                                              {analyticsGraphTaskKeys.map((task) => {
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
                                                          ? "bg-[#E0F2FE] text-[#111827]"
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
                                    <div className="inline-flex h-10 shrink-0 rounded-full border border-[#DDD6F0] bg-white p-1 shadow-[0_8px_20px_rgba(122,95,190,0.10)]">
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
                                            className={`flex min-w-[6rem] items-center justify-center rounded-full px-4 py-2 text-[13px] font-semibold tracking-tight transition-all duration-200 active:scale-[0.98] ${
                                              selectedStat === type
                                                ? "bg-[#9d84d8] text-white shadow-[0_6px_16px_rgba(122,95,190,0.35)]"
                                                : "bg-transparent text-[#4B5563] hover:bg-[#F6F3FC]"
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

                              <div className="p-5 sm:p-6 pt-2">
                                <div className="flex gap-3">
                                    <div className="flex shrink-0 flex-col justify-between py-1 text-[11px] tabular-nums text-[#6B7280] w-12 sm:w-14 text-right leading-none font-medium">
                                    {analyticsYTickValues.map((v, i) => (
                                      <span key={`y-${i}-${v}`}>
                                        {formatAnalyticsYTick(v)}
                                      </span>
                                    ))}
                                  </div>
                                  <div
                                    className="relative min-h-[280px] w-full max-h-[300px] flex-1"
                                    onMouseLeave={() =>
                                      setAnalyticsChartHover(null)
                                    }
                                  >
                                    {analyticsChartHover !== null &&
                                      currentData[analyticsChartHover] && (
                                        <div
                                          className="pointer-events-none absolute z-30 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-[12px] shadow-[0_4px_14px_rgba(15,23,42,0.08)]"
                                          style={{
                                            left: `${
                                              (analyticsChartHover /
                                                Math.max(
                                                  1,
                                                  currentData.length - 1,
                                                )) *
                                              100
                                            }%`,
                                            top: 8,
                                            transform: "translateX(-50%)",
                                          }}
                                        >
                                          <div className="font-medium text-[#111827] leading-tight">
                                            {
                                              currentData[analyticsChartHover]
                                                .date
                                            }
                                          </div>
                                          <div className="tabular-nums text-[#7a5fbe] mt-1 text-[13px] font-semibold leading-tight">
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
                                            stopColor="#7a5fbe"
                                            stopOpacity="0.22"
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
                                      {analyticsChartHover !== null &&
                                        analyticsPlotPoints[
                                          analyticsChartHover
                                        ] &&
                                        currentData.length > 1 && (
                                          <line
                                            x1={
                                              analyticsPlotPoints[
                                                analyticsChartHover
                                              ][0]
                                            }
                                            y1={
                                              analyticsPlotPoints[
                                                analyticsChartHover
                                              ][1]
                                            }
                                            x2={
                                              analyticsPlotPoints[
                                                analyticsChartHover
                                              ][0]
                                            }
                                            y2="100"
                                            stroke="#E5E7EB"
                                            strokeWidth="0.12"
                                            strokeOpacity={0.95}
                                            vectorEffect="non-scaling-stroke"
                                          />
                                        )}
                                      <path
                                        d={buildAnalyticsSmoothAreaD(
                                          currentData,
                                        )}
                                        fill="url(#analyticsAreaFillGrad)"
                                        stroke="none"
                                        className="transition-[d] duration-300 ease-out"
                                      />
                                      <path
                                        d={buildAnalyticsSmoothLineD(
                                          currentData,
                                        )}
                                        fill="none"
                                        stroke="#7a5fbe"
                                        strokeWidth="0.58"
                                        strokeLinejoin="round"
                                        strokeLinecap="round"
                                        vectorEffect="non-scaling-stroke"
                                        className="transition-[d] duration-300 ease-out"
                                      />
                                      {analyticsPlotPoints.map(([cx, cy], i) => (
                                        <g key={i}>
                                          <circle
                                            cx={cx}
                                            cy={cy}
                                            r={
                                              analyticsChartHover === i
                                                ? 1.45
                                                : 0.9
                                            }
                                            fill={
                                              analyticsChartHover === i
                                                ? "#7a5fbe"
                                                : "#8e6fd0"
                                            }
                                            stroke="#ffffff"
                                            strokeWidth="0.24"
                                            className="transition-all duration-100"
                                            vectorEffect="non-scaling-stroke"
                                          />
                                          {analyticsChartHover === i && (
                                            <circle
                                              cx={cx}
                                              cy={cy}
                                              r={0.42}
                                              fill="#EF4444"
                                              vectorEffect="non-scaling-stroke"
                                            />
                                          )}
                                        </g>
                                      ))}
                                    </svg>
                                  </div>
                                </div>
                                <div className="mt-2 flex justify-between gap-1.5 pl-14 sm:pl-[3.75rem] pr-0 text-[11px] text-[#6B7280] tabular-nums font-medium">
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

                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 lg:gap-6 pt-0.5">
                              <div className="lg:col-span-2 min-w-0">
                                <div className="mb-5">
                                  <h2 className="text-[15px] font-bold text-[#111827] tracking-tight">
                                    Insights
                                  </h2>
                                  <p className="text-[13px] text-[#6B7280] mt-1 leading-snug">
                                    Patterns based on your focus data
                                  </p>
                                </div>
                                <div className="relative">
                                  <span
                                    className="tv-insight-wisp tv-insight-wisp--a"
                                    aria-hidden
                                  />
                                  <span
                                    className="tv-insight-wisp tv-insight-wisp--b"
                                    aria-hidden
                                  />
                                  <span
                                    className="tv-insight-wisp tv-insight-wisp--c"
                                    aria-hidden
                                  />
                                  <div className="tv-insights-grid">
                                    {displayedInsightCards.map((ins, idx) => (
                                      <InsightCard
                                        key={ins.id}
                                        insight={ins}
                                        index={idx}
                                      />
                                    ))}
                                  </div>
                                </div>
                              </div>

                              <section className="rounded-2xl border border-[#E5E7EB] bg-white p-5 sm:p-6 shadow-sm lg:col-span-1">
                                <h2 className="text-[15px] font-bold text-[#111827] mb-4 pb-3 border-b border-[#E5E7EB] tracking-tight">
                                  Performance
                                </h2>
                                <div className="grid grid-cols-2 gap-3">
                                  {analyticsPerformanceQuad.map((stat, i) => (
                                    <div
                                      key={i}
                                      className="group flex aspect-square min-h-0 flex-col justify-between rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-3 py-3 transition-colors duration-150 hover:bg-white"
                                    >
                                      <p className="text-[9px] font-semibold uppercase tracking-[0.12em] text-[#6B7280] leading-snug line-clamp-2">
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

                            {/* Discipline heatmap — hidden until re-enabled; keep markup for later */}
                            <section
                              className="hidden rounded-2xl border border-[#E5E7EB] bg-white p-3 sm:p-4 shadow-sm"
                              aria-hidden
                            >
                              <div className="flex items-baseline justify-between gap-3 mb-2 pb-2 border-b border-[#E5E7EB]">
                                <h2 className="text-[15px] font-semibold text-[#111827] tracking-[-0.01em]">
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
                                          <div className="mt-1.5 flex justify-between border-t border-[#E5E7EB] pt-1.5 text-[#0EA5E9] text-[10px]">
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
                className={`relative flex min-h-0 w-full min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto bg-white text-[#111827] transition-[filter] duration-300 ease-out ${
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
                <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-row items-stretch overflow-x-hidden">
                  <div
                    className={`flex min-h-0 min-w-0 flex-1 flex-col overflow-x-hidden overflow-y-auto overscroll-y-contain ${
                      focusImmerseIntro ? "micro-focus-main-in" : ""
                    }`}
                  >
                    <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-8 px-4 pb-20 pt-10 sm:gap-10 sm:pb-24 sm:pt-12">
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

            {/* TIMER — dark tunnel canvas */}
            <div className="relative z-[200] flex w-full max-w-[460px] flex-col items-center px-2 py-8 sm:py-10">
              <div className={`timer-canvas ${running ? "scale-[1.01]" : ""}`}>
                <div className="session-chip">SESSION · FOCUS</div>
                <div className="timer-display">
                  {String(Math.floor(Math.abs(seconds) / 60)).padStart(2, "0")}
                  <span className="colon">:</span>
                  {String(Math.abs(seconds) % 60).padStart(2, "0")}
                </div>
                <p className="timer-task-label">
                  {activeFocusTaskForIntegrity
                    ? `Deep work: ${activeFocusTaskForIntegrity.text}`
                    : "Deep work: current task name"}
                </p>
                <div className="timer-controls">
                  <button
                    type="button"
                    className="btn-play"
                    disabled={isSimulation}
                    onClick={() => {
                      if (running) {
                        setRunning(false);
                      } else {
                        startTimer();
                      }
                    }}
                    aria-label={running ? "Pause timer" : "Start timer"}
                  >
                    <span aria-hidden>{running ? "⏹" : "▶"}</span>
                    <span>{running ? "Stop" : "Start"}</span>
                  </button>
                  <button
                    type="button"
                    className="btn-ghost"
                    disabled={isSimulation}
                    onClick={handleResetSessionConfirm}
                  >
                    <span aria-hidden>🔄</span>
                    <span>Reset</span>
                  </button>
                </div>
                <button
                  type="button"
                  disabled={isSimulation}
                  onClick={() => {
                    setSeconds((s) => s + 900);
                    setInitialSeconds((s) => s + 900);
                  }}
                  className="add-time-btn"
                >
                  + 15 min
                </button>
                <div id="tunnelOverlay" className="tunnel-overlay" />
              </div>
            </div>

            <div className="w-full max-w-xl space-y-12 px-0 pb-12 pt-6 sm:pt-8">
              <div
                className={`space-y-4 transition-all duration-300 ease-out ${running || focusFinaleModalOpen ? "opacity-40" : "opacity-100"}`}
              >
                <div className="space-y-1.5">
                  <div className="task-input-row">
                    <div
                      className={`task-input-wrap ${
                        invalidInputTarget === "focus"
                          ? "micro-input-invalid"
                          : taskInputShellPress
                            ? "micro-input-press"
                            : ""
                      }`}
                    >
                      <span className="input-icon" aria-hidden>
                        <svg
                          className="h-4 w-4"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="11" cy="11" r="7" />
                          <path d="M21 21l-3.8-3.8" />
                        </svg>
                      </span>
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
                        className={`task-input ${
                          taskInputClearFlash ? "opacity-50" : ""
                        }`}
                      />
                      <button
                        type="button"
                        disabled={isSimulation}
                        onClick={() =>
                          addTaskFromFocusBar({ fromButtonClick: true })
                        }
                        className="input-kbd"
                      >
                        +
                      </button>
                    </div>
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

                <div className="flex w-full flex-col overflow-hidden rounded-[3px] border border-[#E5E5E5] bg-white">
                  {focusSessionEntries.length === 0 ? (
                    <p className="py-8 text-center text-[13px] text-[#808080] font-[system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif]">
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
                      .map(({ entry, t }) => {
                        const est = t.estimatedMinutes ?? 25;
                        const timeLabel = `${est} min`;
                        const itemDone = t.completed;
                        return (
                          <div
                            key={`${entry.listId}-${entry.taskId}`}
                            className={`task-item ${
                              itemDone ? "done" : ""
                            } ${t.removing ? "opacity-0 translate-x-12" : "opacity-100"} ${
                              focusSessionNewRowId === t.id ? "micro-row-enter" : ""
                            }`}
                          >
                            <button
                              type="button"
                              className="task-check"
                              disabled={isSimulation}
                              onClick={() =>
                                completeFocusTask(entry.listId, entry.taskId)
                              }
                              title="Mark complete"
                            />
                            <span className="task-label">
                              {getFocusSessionDisplayLabel(entry.listId, t.text)}
                            </span>
                            <span className="task-badge project">Work</span>
                            <span className="task-time">{timeLabel}</span>
                          </div>
                        );
                      })
                  )}
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
                    <div className="focus-queue-panel-shadow flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-[#E5E5E5] bg-white sm:rounded-lg">
                      <div className="shrink-0 border-b border-[#E5E5E5] bg-white px-3 py-2.5 sm:px-3.5">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-1 items-center gap-2">
                            <span
                              className="inline-flex h-[18px] w-[18px] shrink-0 items-center justify-center text-[#1f1f1f]"
                              aria-hidden
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                              </svg>
                            </span>
                            <h2 className="min-w-0 truncate text-[14px] font-semibold leading-7 tracking-tight text-[#1f1f1f] font-[system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif]">
                              Task queue
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
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[#fafafa] px-2 py-2 sm:px-2.5">
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
                                    className="queue-row text-left"
                                  >
                                    <TaskSystemNavIcon
                                      listId={section.listId}
                                      className="h-5 w-5 shrink-0 text-[#808080]"
                                    />
                                    <span className="queue-row-name min-w-0 truncate font-[system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif]">
                                      {section.label}
                                    </span>
                                    <span
                                      className={`queue-count shrink-0 tabular-nums ${
                                        section.listId === SYS_LIST_OVERDUE &&
                                        section.tasks.length > 0
                                          ? "overdue"
                                          : ""
                                      }`}
                                    >
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
                                            className="mb-1 flex w-full items-center justify-center gap-1.5 rounded-[3px] border border-dashed border-[#d4d4d4] bg-white py-1.5 text-[11px] font-medium text-[#666] transition hover:bg-[#f5f5f5] active:scale-[0.99] font-[system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif]"
                                          >
                                            <span className="text-[12px] font-medium text-[#444]">
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
                                                    className={`group flex w-full items-start gap-2.5 rounded-[3px] border px-2.5 py-2 text-left transition active:scale-[0.99] ${
                                                      inSession
                                                        ? "cursor-default border-[#d4d4d4] bg-[#f0f0f0]"
                                                        : "border-[#E5E5E5] bg-white hover:border-[#ccc] hover:bg-[#fafafa]"
                                                    }`}
                                                  >
                                                    <span
                                                      className={`mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[3px] border text-[13px] font-medium leading-none transition-colors ${
                                                        inSession
                                                          ? "border-[#1f1f1f] bg-[#1f1f1f] text-white"
                                                          : "border-[#c8c8c8] bg-white text-[#666] group-hover:border-[#808080] group-hover:text-[#202020]"
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
                                                        className={`block text-[13px] leading-snug font-[system-ui,-apple-system,'Segoe_UI',Roboto,sans-serif] ${
                                                          inSession
                                                            ? "text-[#666]"
                                                            : "text-[#202020]"
                                                        }`}
                                                      >
                                                        {task.text}
                                                      </span>
                                                      {inSession && (
                                                        <span className="mt-0.5 block text-[10px] font-medium text-[#666]">
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
                              Hello <span className="text-[#6366F1]">{name}</span>.
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
                              Hello <span className="text-[#6366F1]">{name}</span>.
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
.focus-timer-hero-square {
  border-radius: 32px;
}
/** Neutral SaaS panel depth (timer idle + task queue) — no purple tint */
.focus-timer-idle-shadow {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.08),
    0 4px 14px rgba(0, 0, 0, 0.06);
}
.focus-queue-panel-shadow {
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.08),
    0 4px 14px rgba(0, 0, 0, 0.06);
}
.focus-finale-streamers-ring {
  opacity: 0.6;
  overflow: hidden;
  background: rgba(99, 102, 241, 0.04);
}
.focus-timer-running-glow {
  box-shadow:
    0 0 0 1px rgba(99, 102, 241, 0.14),
    0 20px 50px -18px rgba(99, 102, 241, 0.2),
    0 0 72px -20px rgba(129, 140, 248, 0.28);
}
@keyframes focus-timer-breathe {
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.015); }
}
.focus-timer-breathe {
  animation: focus-timer-breathe 3.5s ease-in-out infinite;
}
@media (prefers-reduced-motion: reduce) {
  .focus-timer-breathe {
    animation: none;
  }
  .focus-timer-running-glow {
    box-shadow:
      0 0 0 1px rgba(99, 102, 241, 0.1),
      0 8px 24px -12px rgba(99, 102, 241, 0.12);
  }
}
::-webkit-scrollbar { width: 6px; }
`}</style>
      </div>
    </>
  );
}
