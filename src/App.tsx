import React from "react";
import { Analytics } from "@vercel/analytics/react";
import { useState, useEffect, useMemo, useRef } from "react";

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
};

const SYS_LIST_OVERDUE = "sys-overdue";
const SYS_LIST_TODAY = "sys-today";
const SYS_LIST_PROJECTS = "sys-projects";
const SYS_LIST_TESTS = "sys-tests";
const SYS_LIST_LONGTERM = "sys-longterm";

const OVERDUE_SOURCE_LIST_IDS: readonly string[] = [
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
  SYS_LIST_TODAY,
  SYS_LIST_PROJECTS,
  SYS_LIST_TESTS,
  SYS_LIST_LONGTERM,
];

const FOCUS_PICKER_LABELS: Record<string, string> = {
  [SYS_LIST_OVERDUE]: "Overdue",
  [SYS_LIST_TODAY]: "Today",
  [SYS_LIST_PROJECTS]: "Projects",
  [SYS_LIST_TESTS]: "Tests",
  [SYS_LIST_LONGTERM]: "Long-Term Assignments",
};

type FocusSessionEntry = { listId: string; taskId: number };

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
      className="fixed w-[268px] rounded-xl border border-white/[0.08] bg-[#1c1c1c] shadow-[0_16px_48px_rgba(0,0,0,0.55)] p-3 z-[500]"
      style={{ top, left }}
      role="dialog"
      aria-label="Choose due date"
    >
      <div className="flex items-center justify-between gap-2 mb-3">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] text-sm"
          aria-label="Previous month"
        >
          ‹
        </button>
        <span className="text-[13px] font-semibold text-zinc-200 tabular-nums">
          {monthLabel}
        </span>
        <button
          type="button"
          onClick={() => shiftMonth(1)}
          className="w-8 h-8 rounded-lg text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.06] text-sm"
          aria-label="Next month"
        >
          ›
        </button>
      </div>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[10px] font-medium text-zinc-500 uppercase tracking-wide mb-1">
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
                  ? "bg-white/[0.12] text-zinc-50 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.12),0_0_0_1px_rgba(255,255,255,0.06)]"
                  : isToday
                    ? "text-blue-400 hover:bg-white/[0.06]"
                    : "text-zinc-300 hover:bg-white/[0.06]"
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
  return "Add task";
}

function listEmptyHeadline(listId: string, isUserList: boolean): string {
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
        className="absolute inset-0 rounded-[2rem] opacity-95"
        style={{
          background:
            "radial-gradient(ellipse 80% 70% at 45% 35%, #262626 0%, #171717 75%)",
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
          strokeWidth="1.8"
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

/** Single blue accent; category + title row inside (TickTick-style). */
const CALENDAR_TASK_CHIP =
  "group w-full text-left rounded-md px-2 py-1.5 border border-sky-500/35 bg-gradient-to-b from-sky-600/90 to-sky-700/95 hover:from-sky-500/95 hover:to-sky-600/95 text-left min-w-0 shadow-[0_1px_3px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)] transition-[box-shadow,background-color,border-color] duration-150 active:scale-[0.99]";

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
    <div className="flex flex-col flex-1 min-h-0 w-full h-full bg-gradient-to-b from-[#111110] via-[#0e0e0e] to-[#0a0a0a] antialiased [text-rendering:optimizeLegibility]">
      <header className="shrink-0 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 px-4 sm:px-6 pt-3.5 pb-3 border-b border-white/[0.07] shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.04)]">
        <div className="min-w-0 flex items-baseline gap-2.5 flex-wrap">
          <h2 className="text-xl sm:text-2xl font-semibold text-zinc-50 tracking-[-0.02em] tabular-nums">
            {monthTitle}
          </h2>
          <span className="text-lg sm:text-xl font-medium text-zinc-500 tabular-nums">
            {yearTitle}
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={onTodayMonth}
            className="px-3 py-1.5 rounded-lg text-[12px] font-medium text-zinc-200 bg-white/[0.07] border border-white/[0.1] shadow-[0_1px_2px_rgba(0,0,0,0.35),inset_0_1px_0_rgba(255,255,255,0.06)] hover:bg-white/[0.11] hover:border-white/[0.14] transition-all duration-150 active:scale-[0.98]"
          >
            Today
          </button>
          <button
            type="button"
            onClick={onPrevMonth}
            className="w-9 h-9 rounded-lg border border-white/[0.1] bg-[#181818] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] hover:border-white/[0.12] text-lg leading-none transition-all duration-150 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.4)] active:scale-[0.97]"
            aria-label="Previous month"
          >
            ‹
          </button>
          <button
            type="button"
            onClick={onNextMonth}
            className="w-9 h-9 rounded-lg border border-white/[0.1] bg-[#181818] text-zinc-400 hover:text-zinc-100 hover:bg-white/[0.06] hover:border-white/[0.12] text-lg leading-none transition-all duration-150 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.4)] active:scale-[0.97]"
            aria-label="Next month"
          >
            ›
          </button>
        </div>
      </header>

      <div className="flex-1 min-h-0 flex flex-col">
        <div className="grid grid-cols-7 shrink-0 border-b border-black/50 bg-[#151515] shadow-[inset_0_-1px_0_0_rgba(255,255,255,0.05)]">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((wd) => (
            <div
              key={wd}
              className="py-2 text-center text-[11px] font-medium text-zinc-500 tracking-tight"
            >
              {wd}
            </div>
          ))}
        </div>

        <div
          className="flex-1 min-h-0 grid grid-cols-7 gap-px bg-[#1c1c1c]"
          style={{
            gridTemplateRows: `repeat(${rowCount}, minmax(80px, 1fr))`,
          }}
        >
          {cells.map((cell) => {
            if (cell.kind === "outside") {
              return (
                <div
                  key={cell.key}
                  className="bg-[#0f0f0f] min-h-[100px] p-1.5 flex flex-col min-w-0 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.03)]"
                  aria-hidden
                >
                  <div className="text-[11px] font-medium tabular-nums text-zinc-600 mb-1 shrink-0">
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
                className={`relative bg-[#131313] min-h-[100px] p-1.5 flex flex-col min-w-0 shadow-[inset_0_1px_0_0_rgba(255,255,255,0.045)] ${
                  isToday
                    ? "ring-1 ring-inset ring-sky-500/45 bg-[radial-gradient(ellipse_at_50%_0%,rgba(56,189,248,0.09),transparent_55%)]"
                    : ""
                }`}
              >
                <div className="mb-1 shrink-0">
                  {isToday ? (
                    <span
                      className="inline-flex min-w-[1.75rem] h-7 px-1.5 items-center justify-center rounded-full bg-sky-600 text-[11px] font-semibold text-white tabular-nums shadow-[0_1px_4px_rgba(14,165,233,0.45),inset_0_1px_0_rgba(255,255,255,0.2)]"
                      title="Today"
                    >
                      {cell.day}
                    </span>
                  ) : (
                    <span className="inline-flex text-[11px] font-semibold tabular-nums text-zinc-500 pl-0.5">
                      {dayLabel}
                    </span>
                  )}
                </div>
                <div className="flex flex-col gap-0.5 flex-1 min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-width:thin] [scrollbar-color:rgba(63,63,70,0.6)_transparent]">
                  {visible.map((t) => (
                    <button
                      key={`${t.listId}-${t.id}`}
                      type="button"
                      onClick={() => onTaskPick(t.listId, t.id)}
                      className={CALENDAR_TASK_CHIP}
                      title={`${t.categoryLabel} — ${t.text}`}
                    >
                      <span className="flex items-baseline gap-1 min-w-0 w-full">
                        <span className="shrink-0 max-w-[42%] truncate text-[10px] font-semibold text-white/75 leading-tight">
                          {t.categoryLabel}
                        </span>
                        <span
                          className="shrink-0 text-[11px] text-white/35 font-light select-none"
                          aria-hidden
                        >
                          ·
                        </span>
                        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-white leading-snug">
                          {t.text}
                        </span>
                      </span>
                    </button>
                  ))}
                  {more > 0 ? (
                    <div className="text-[10px] font-medium text-zinc-500 pl-0.5 pt-0.5 tracking-tight">
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

/** TickTick-style list UI: unified main-pane grey */
const TT_MAIN_GREY = "#1a1a1a";
const TT_INPUT_ROW = "#1f1f1f";
const TT_ACCENT_BLUE = "#2563eb";

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
    return "border border-zinc-500 bg-zinc-800/80";
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
  { id: "sys-today", label: "Today", icon: "", color: null, system: true },
  { id: "sys-projects", label: "Projects", icon: "", color: null, system: true },
  { id: "sys-tests", label: "Tests", icon: "", color: null, system: true },
  { id: "sys-longterm", label: "Long-Term", icon: "", color: null, system: true },
];

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
  const [isSimulation, setIsSimulation] = useState(true);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [name, setName] = useState("Alex");
  const [seconds, setSeconds] = useState(0);
  const [initialSeconds, setInitialSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [streak, setStreak] = useState(3);
  const [taskInput, setTaskInput] = useState("");
  const [tasksByListId, setTasksByListId] = useState<Record<string, Task[]>>(
    {},
  );
  const [tasks, setTasks] = useState<Task[]>([]);
  const isSwitchingListRef = useRef(false);
  const [selectedTaskId, setSelectedTaskId] = useState<number | null>(null);
  const tasksRef = useRef<Task[]>([]);
  const [isWorkModeModalOpen, setIsWorkModeModalOpen] = useState(false);
  const [pendingWorkModeTaskId, setPendingWorkModeTaskId] = useState<
    number | null
  >(null);
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
  const [showReflection, setShowReflection] = useState(false);
  const [reflectionPrompt, setReflectionPrompt] = useState<string | null>(null);
  const [reflectionText, setReflectionText] = useState("");
  const [scrollY, setScrollY] = useState(0);

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

  const prompts = [
    "What worked well today?",
    "Anything distract you? How can you avoid it later?",
    "What grade would you give yourself?",
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
    | { action: "openTask"; listId: string; taskId: number };
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

  const DEFAULT_LIST_ICON = "≡";
  const [todayLists, setTodayLists] = useState<TodayList[]>([
    { id: "work", label: "Work", icon: "🗂️", color: "#ef4444" },
    { id: "wishlist", label: "Wishlist", icon: "✨", color: "#c084fc" },
    { id: "shopping", label: "Shopping", icon: "🧾", color: "#e4e4e7" },
    { id: "exercise", label: "Exercise", icon: "🏃‍♂️", color: "#f97316" },
    { id: "packing", label: "Packing list", icon: "✈️", color: "#38bdf8" },
  ]);
  const [completedActivityLog, setCompletedActivityLog] = useState<
    CompletedActivityEntry[]
  >([]);
  const [openListMenuId, setOpenListMenuId] = useState<string | null>(null);
  const [isAddListModalOpen, setIsAddListModalOpen] = useState(false);
  const [newListName, setNewListName] = useState("");
  const [newListColor, setNewListColor] = useState<string | null>("#eab308");
  const listMenuRef = useRef<HTMLDivElement | null>(null);

  const [selectedListId, setSelectedListId] = useState<string | null>(null);
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

  const [todayMainMode, setTodayMainMode] = useState<"tasks" | "completed">(
    "tasks",
  );
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
    }
  }, [
    history,
    taskHistory,
    streak,
    isSimulation,
    heatmapData,
    todayTotalFocusMinutes,
    completedActivityLog,
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
    setFocusEnterZenActive(false);
    setZenOverlayOrigin(null);
    setFocusEnterZenBlocking(false);
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
    setShowReflection(false);
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
    const el = focusNavButtonRef.current;
    if (el) {
      const r = el.getBoundingClientRect();
      setZenOverlayOrigin({
        x: r.left + r.width / 2,
        y: r.top + r.height / 2,
      });
    } else {
      setZenOverlayOrigin({
        x: window.innerWidth * 0.06,
        y: window.innerHeight * 0.38,
      });
    }
    setFocusEnterZenActive(true);
    setFocusEnterZenBlocking(true);
    const ENTER_MS = 2200;
    const UNBLOCK_MS = 2350;
    const CLEAR_MS = 4800;
    const t0 = window.setTimeout(() => {
      if (!allowFocusEnterRef.current) return;
      finishEnterFocusSession();
    }, ENTER_MS);
    const t1 = window.setTimeout(() => setFocusEnterZenBlocking(false), UNBLOCK_MS);
    const t2 = window.setTimeout(() => {
      setFocusEnterZenActive(false);
      setZenOverlayOrigin(null);
      setFocusEnterZenBlocking(false);
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

  const handleToggleTodaySidebar = () => {
    if (activeView !== "tasks") return;
    if (isTodayPanelCollapsed) {
      setIsTodayPanelCollapsed(false);
      setIsTodayPanelAnimatingOut(false);
      return;
    }

    setIsTodayPanelAnimatingOut(true);
    window.setTimeout(() => {
      setIsTodayPanelCollapsed(true);
      setIsTodayPanelAnimatingOut(false);
    }, 220);
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

  /** Add task from the list input bar (Enter only); selects the new task for the detail pane. */
  const addTaskFromListInput = () => {
    if (!selectedListId) return;
    if (selectedListId === SYS_LIST_OVERDUE) return;
    const trimmed = taskInput.trim();
    if (!trimmed) return;
    const id = Date.now();
    let dueDate: string | null = null;
    if (selectedListId === SYS_LIST_TODAY) {
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
    setTasks((prev) => [...prev, newTask]);
    setSelectedTaskId(id);
    setTaskInput("");
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
    setShowReflection(false);
    setIntegrityPenalty(0);
    setFocusSessionEntries([]);
    setWarning("System Purged");
    setTimeout(() => setWarning(null), 3000);
  };

  const handleReflectionSubmit = () => {
    const todayStr = getTodayStr();
    const sessionSecs = todayTotalFocusMinutes * 60;
    const tasksDone = tasks.length;

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
    setShowReflection(false);
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
    setIsVictory(false);
    setShowReflection(false);
  }

  function addTaskToFocusSession(listId: string, taskId: number) {
    setFocusSessionEntries((prev) => {
      if (prev.some((e) => e.listId === listId && e.taskId === taskId)) {
        return prev;
      }
      return [...prev, { listId, taskId }];
    });
  }

  function completeFocusTask(listId: string, taskId: number) {
    if (isSimulation) return;
    const list = tasksByListId[listId] ?? [];
    const task = list.find((t) => t.id === taskId && !t.removing);
    if (!task) return;
    const now = Date.now();
    const today = getTodayStr();
    const taskKey = normalizeTaskKey(task.text);
    const listLabel =
      allListsForSelection.find((l) => l.id === listId)?.label ?? "Focus";

    if (running) {
      const refPoint = lastTaskCompletionTime || timerSessionStart || now;
      const durationSecs = Math.max(1, Math.floor((now - refPoint) / 1000));
      setFloatingTime({ text: `${durationSecs}s`, id: Date.now() });
      setTimeout(() => setFloatingTime(null), 1500);
      const mins = Math.round(durationSecs / 60);
      setTaskHistory((prev) => ({
        ...prev,
        [taskKey]: [...(prev[taskKey] || []), { value: durationSecs, date: today }],
      }));
      appendCompletedActivity(task.text, mins, listId, listLabel);
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
      appendCompletedActivity(task.text, 0, listId, listLabel);
    }

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
    const partialMins = Math.floor(timerAccumulator / 60);
    setTodayTotalFocusMinutes((prev) => prev + partialMins);
    setTimerAccumulator(0);
    setRunning(false);
    setSeconds(0);
    setIsVictory(true);
    if (initialSeconds >= 3600) {
      setTimeout(() => setShowReflection(true), 1200);
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
      "rounded-2xl border shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-150 hover:brightness-110 hover:ring-1 hover:ring-blue-500/25 hover:z-[5]";
    if (isCurrentDay && symbol === "⬜")
      return `${base} bg-zinc-800/80 border-blue-500/30 ring-1 ring-blue-500/20`;
    if (symbol === "⬜") return `${base} bg-zinc-900/40 border-zinc-800/50`;
    if (symbol === "🔹") return `${base} bg-blue-950/60 border-blue-900/35`;
    if (symbol === "🔷") return `${base} bg-blue-900/45 border-blue-800/30`;
    if (symbol === "🔵") return `${base} bg-blue-700/40 border-blue-600/28`;
    if (symbol === "🔥") return `${base} bg-blue-600/50 border-blue-500/25`;
    return `${base} bg-zinc-900/40 border-zinc-800/50`;
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
          0%{ opacity:0.55 }
          45%{ opacity:0.42 }
          100%{ opacity:0 }
        }
        @keyframes focus-zen-ripple-long {
          0%{ transform:scale(0.04); opacity:0.72 }
          100%{ transform:scale(1); opacity:0 }
        }
        @keyframes focus-zen-bloom {
          0%{ transform:scale(0.3); opacity:0.35 }
          100%{ transform:scale(1); opacity:0 }
        }
        .focus-zen-mist-overlay{
          animation:focus-zen-mist 4.8s cubic-bezier(0.25,0.46,0.45,0.94) forwards;
        }
        .focus-zen-ripple-ring{
          position:absolute; left:50%; top:50%;
          width:min(160vmax,2600px); height:min(160vmax,2600px);
          margin-left:calc(min(160vmax,2600px)/-2); margin-top:calc(min(160vmax,2600px)/-2);
          border-radius:50%;
          border:1.5px solid rgba(186,230,253,0.35);
          box-shadow:
            0 0 120px rgba(59,130,246,0.22),
            0 0 220px rgba(147,197,253,0.12),
            inset 0 0 100px rgba(255,255,255,0.08);
          animation:focus-zen-ripple-long 2.6s cubic-bezier(0.2,0.85,0.25,1) forwards;
        }
        .focus-zen-ripple-ring-slow{
          animation:focus-zen-ripple-long 3.2s cubic-bezier(0.15,0.75,0.2,1) forwards;
          border-color:rgba(147,197,253,0.22);
          box-shadow:0 0 180px rgba(59,130,246,0.15);
        }
        .focus-zen-bloom-core{
          position:absolute; left:50%; top:50%;
          width:min(90vmax,1400px); height:min(90vmax,1400px);
          margin-left:calc(min(90vmax,1400px)/-2); margin-top:calc(min(90vmax,1400px)/-2);
          border-radius:50%;
          background:radial-gradient(circle, rgba(147,197,253,0.2) 0%, transparent 68%);
          animation:focus-zen-bloom 3.4s ease-out forwards;
        }
      `}</style>

      <div
        className={`size-full ${isSimulation || isFocusSessionActive ? "bg-gradient-to-b from-gray-50 via-gray-50 to-gray-100 text-gray-900" : "bg-black text-zinc-200 antialiased"} selection:bg-blue-500/30 font-sans text-[13px] leading-normal transition-all duration-700 ${isSimulation ? "min-h-[240vh]" : "min-h-screen"} ${isTransitioning ? "opacity-0" : "opacity-100"}`}
      >
        {/* VIGNETTE & AURA (landing / timer only — keep app shell pure black) */}
        {isSimulation && (
          <>
            <div
              className={`fixed inset-0 z-[150] pointer-events-none transition-opacity duration-1000 ${running ? "opacity-100" : "opacity-0"}`}
              style={{
                background:
                  "radial-gradient(circle, transparent 40%, rgba(0,0,0,0.12) 150%)",
              }}
            />

            <div
              className={`fixed inset-0 pointer-events-none z-0 transition-all duration-1000 ${running ? "blur-xl opacity-20" : "blur-0 opacity-100"}`}
            >
              <div
                className="absolute inset-x-0 top-0 h-screen transition-all duration-1000"
                style={{
                  background: `radial-gradient(circle at top, rgba(${auraColor}, 0.1), transparent 70%)`,
                }}
              />
              <div
                className="absolute inset-x-0 bottom-0 h-screen transition-all duration-1000"
                style={{
                  background: `radial-gradient(circle at bottom, rgba(${auraColor}, 0.3), transparent 70%)`,
                }}
              />
            </div>
          </>
        )}
        {isSimulation && (
          <nav className="sticky top-0 z-[500] w-full px-4 md:px-8 py-2 md:py-3 bg-white/95 backdrop-blur-xl border-b border-gray-200">
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
                  className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-gray-100 hover:scale-[1.02] transition-all duration-200"
                >
                  <div className="w-8 h-8 rounded-xl overflow-hidden shadow-md">
                    <img
                      src="/favicon.ico"
                      alt="Tunnel Vision"
                      className="w-8 h-8 object-cover"
                    />
                  </div>
                  <span className="hidden sm:inline text-xs md:text-sm font-bold tracking-[0.18em] uppercase text-gray-700 font-sans">
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
                        className={`relative inline-flex items-center gap-1 px-3 py-1 rounded-full text-gray-700 font-semibold tracking-[0.18em] transition-all duration-200 ${
                          openDropdown === "madeFor"
                            ? "bg-gray-100 text-gray-900"
                            : "hover:bg-gray-100 hover:text-gray-900"
                        }`}
                      >
                        <span className="leading-none">Made For</span>
                        <span className="text-[10px] leading-none">
                          {openDropdown === "madeFor" ? "▲" : "▼"}
                        </span>
                      </button>
                      {openDropdown === "madeFor" && (
                        <div className="absolute right-0 mt-4 w-[480px] rounded-3xl bg-white border border-gray-200 shadow-2xl backdrop-blur-2xl overflow-hidden animate-fade-in">
                          <div className="px-6 py-6 space-y-4">
                            <p className="text-[10px] uppercase tracking-[0.28em] text-gray-500">
                              Made For
                            </p>
                            <div className="grid md:grid-cols-3 gap-4">
                              <button
                                type="button"
                                onClick={() => {
                                  scrollToSection(performanceRef);
                                  setOpenDropdown(null);
                                }}
                                className="group flex flex-col items-start rounded-2xl bg-gray-50 border border-gray-200 px-4 py-4 text-left hover:bg-gray-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/30 text-[10px]">
                                  ⚡
                                </span>
                                <span className="text-sm font-semibold text-gray-900">
                                  Performance
                                </span>
                                <span className="mt-1 text-xs text-gray-500 leading-relaxed">
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
                                className="group flex flex-col items-start rounded-2xl bg-gray-50 border border-gray-200 px-4 py-4 text-left hover:bg-gray-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/25 text-[10px]">
                                  🌱
                                </span>
                                <span className="text-sm font-semibold text-gray-900">
                                  Habit Building
                                </span>
                                <span className="mt-1 text-xs text-gray-500 leading-relaxed">
                                  Turn discipline into a daily habit.
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  scrollToSection(timeRef);
                                  setOpenDropdown(null);
                                }}
                                className="group flex flex-col items-start rounded-2xl bg-gray-50 border border-gray-200 px-4 py-4 text-left hover:bg-gray-100 hover:-translate-y-0.5 hover:shadow-md transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/25 text-[10px]">
                                  ⏱
                                </span>
                                <span className="text-sm font-semibold text-gray-900">
                                  Time Management
                                </span>
                                <span className="mt-1 text-xs text-gray-500 leading-relaxed">
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
                        className={`relative inline-flex items-center gap-1 px-3 py-1 rounded-full text-gray-700 font-semibold tracking-[0.18em] transition-all duration-200 ${
                          openDropdown === "resources"
                            ? "bg-gray-100 text-gray-900"
                            : "hover:bg-gray-100 hover:text-gray-900"
                        }`}
                      >
                        <span className="leading-none">Resources</span>
                        <span className="text-[10px] leading-none">
                          {openDropdown === "resources" ? "▲" : "▼"}
                        </span>
                      </button>
                      {openDropdown === "resources" && (
                        <div className="absolute right-0 mt-4 w-64 rounded-3xl bg-white border border-gray-200 shadow-2xl backdrop-blur-2xl overflow-hidden animate-fade-in">
                          <div className="py-3">
                            {["Guides", "Tutorials", "Documentation"].map(
                              (item) => (
                                <button
                                  key={item}
                                  type="button"
                                  className="w-full text-left px-4 py-2.5 text-[12px] font-medium text-gray-700 hover:bg-gray-100 transition-colors duration-150"
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
                    className="hidden sm:inline-flex group relative px-10 py-3 bg-blue-600 rounded-full overflow-hidden transition-all duration-500 hover:scale-110 active:scale-95 shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-breathing"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                    <span className="relative text-[10px] font-black tracking-[0.3em] uppercase text-white">
                      Get Started
                    </span>
                  </button>

                  {/* Mobile hamburger */}
                  <button
                    type="button"
                    className="sm:hidden inline-flex items-center justify-center rounded-full border border-gray-200 bg-gray-50 w-9 h-9 hover:bg-gray-100 transition-all duration-200"
                    onClick={() => setIsMobileMenuOpen((v) => !v)}
                  >
                    <span className="sr-only">Toggle navigation</span>
                    <div className="flex flex-col gap-1.5">
                      <span className="w-4 h-0.5 bg-gray-700 rounded-full" />
                      <span className="w-4 h-0.5 bg-gray-700 rounded-full" />
                    </div>
                  </button>
                </div>

                {/* Mobile menu panel */}
                {isMobileMenuOpen && (
                  <div className="sm:hidden mt-3 rounded-3xl bg-white border border-gray-200 backdrop-blur-2xl shadow-xl px-4 py-4 space-y-4 text-[11px] tracking-[0.18em] uppercase">
                    <div className="space-y-2">
                      <p className="text-[10px] text-gray-500">Made For</p>
                      <button
                        type="button"
                        onClick={() => scrollToSection(performanceRef)}
                        className="w-full text-left px-3 py-2 rounded-2xl bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        Performance
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToSection(habitRef)}
                        className="w-full text-left px-3 py-2 rounded-2xl bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        Habit Building
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToSection(timeRef)}
                        className="w-full text-left px-3 py-2 rounded-2xl bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
                      >
                        Time Management
                      </button>
                    </div>
                    <div className="space-y-2 pt-2">
                      <p className="text-[10px] text-gray-500">Resources</p>
                      {["Guides", "Tutorials", "Documentation"].map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="w-full text-left px-3 py-2 rounded-2xl bg-gray-50 text-gray-700 hover:bg-gray-100 transition-colors"
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={handleGetStarted}
                      className="w-full mt-3 group relative px-6 py-3 bg-blue-600 rounded-full overflow-hidden transition-all duration-500 hover:scale-105 active:scale-95 shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-breathing"
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                      <span className="relative text-[10px] font-black tracking-[0.3em] uppercase text-white">
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
              className={`fixed inset-0 z-[265] overflow-hidden transition-opacity duration-700 ${
                focusEnterZenBlocking
                  ? "pointer-events-auto cursor-wait"
                  : "pointer-events-none"
              }`}
              aria-hidden
            >
              <div className="absolute inset-0 bg-gradient-to-br from-sky-200/35 via-[#e0f2fe]/25 to-indigo-100/15 focus-zen-mist-overlay" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/10 via-transparent to-white/20 opacity-90" />
              <div
                className="absolute w-0 h-0 overflow-visible"
                style={{
                  left: zenOverlayOrigin.x,
                  top: zenOverlayOrigin.y,
                  transform: "translate(-50%, -50%)",
                }}
              >
                <div className="focus-zen-bloom-core" />
                {Array.from({ length: 7 }).map((_, i) => (
                  <div
                    key={i}
                    className={`focus-zen-ripple-ring ${i === 6 ? "focus-zen-ripple-ring-slow" : ""}`}
                    style={{ animationDelay: `${i * 180}ms` }}
                  />
                ))}
              </div>
            </div>
          )}
          <div className="h-screen min-h-0 flex w-full bg-black text-zinc-200 overflow-hidden">
            {/* Left sidebar (main) — flush to viewport edge */}
            <aside className="h-screen w-[52px] sm:w-14 bg-[#141414] border-r border-[#2a2a2a] flex flex-col items-center justify-between py-2 z-[250] shrink-0">
              {/* Top: profile */}
              <div className="flex flex-col items-center gap-4">
                <button
                  type="button"
                  onClick={() => {}}
                  className="group relative flex items-center justify-center w-9 h-9 rounded-lg bg-transparent border border-transparent hover:bg-white/5 transition-colors duration-150"
                >
                  <svg
                    className="w-6 h-6 text-gray-200"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="8" r="3.2" />
                    <path d="M5.5 19a6.5 6.5 0 0 1 13 0" />
                  </svg>
                  <div className="pointer-events-none absolute left-16 top-1/2 -translate-y-1/2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                    <div className="rounded-xl bg-[#18191f] shadow-lg border border-white/10 px-3 py-1 text-xs text-gray-100">
                      Profile
                    </div>
                  </div>
                </button>

                {/* Main nav */}
                <nav className="flex flex-col items-center gap-3 mt-3">
                  {/* Tasks */}
                  <button
                    type="button"
                    onClick={() => handleSidebarNavClick("tasks")}
                    className={`group relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150 ${
                      activeView === "tasks"
                        ? "bg-white/10 text-zinc-100"
                        : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="4" y="5" width="16" height="15" rx="3" />
                      <path d="M9 3v4M15 3v4" />
                      <path d="M7 11h10" />
                      <circle cx="12" cy="15" r="1.4" />
                    </svg>
                    <div className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                      <div className="rounded-xl bg-[#18191f] shadow-lg border border-white/10 px-3 py-1 text-xs text-gray-100">
                        Tasks
                      </div>
                    </div>
                  </button>

                  {/* Calendar */}
                  <button
                    type="button"
                    onClick={() => handleSidebarNavClick("calendar")}
                    className={`group relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150 ${
                      activeView === "calendar"
                        ? "bg-white/10 text-zinc-100"
                        : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <svg
                      className="w-5 h-5"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="4" y="5" width="16" height="15" rx="3" />
                      <path d="M9 3v4M15 3v4M4 10h16" />
                      <path d="M8 14h2M12 14h2M16 14h2M8 17h2M12 17h2M16 17h2" />
                    </svg>
                    <div className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                      <div className="rounded-xl bg-[#18191f] shadow-lg border border-white/10 px-3 py-1 text-xs text-gray-100">
                        Calendar
                      </div>
                    </div>
                  </button>

                  {/* Focus — same entry as “Start Focus Session” */}
                  <button
                    ref={focusNavButtonRef}
                    type="button"
                    onClick={handleStartFocusSession}
                    className="group relative flex items-center justify-center w-9 h-9 rounded-lg text-zinc-100 hover:bg-white/5 transition-colors duration-150 overflow-visible"
                  >
                    <span className="focus-nav-aura-soft" aria-hidden />
                    <span className="focus-nav-aura" aria-hidden />
                    <span className="relative z-[1] text-[15px] leading-none select-none">
                      🎯
                    </span>
                    <div className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150 z-[2]">
                      <div className="rounded-xl bg-[#18191f] shadow-lg border border-white/10 px-3 py-1 text-xs text-gray-100">
                        Focus
                      </div>
                    </div>
                  </button>

                  {/* Analytics */}
                  <button
                    type="button"
                    onClick={() => handleSidebarNavClick("analytics")}
                    className={`group relative flex items-center justify-center w-9 h-9 rounded-lg transition-colors duration-150 ${
                      activeView === "analytics"
                        ? "bg-white/10 text-zinc-100"
                        : "text-zinc-500 hover:bg-white/5 hover:text-zinc-200"
                    }`}
                  >
                    <svg
                      className="w-5 h-5"
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
                    <div className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                      <div className="rounded-xl bg-[#18191f] shadow-lg border border-white/10 px-3 py-1 text-xs text-gray-100">
                        Analytics
                      </div>
                    </div>
                  </button>
                </nav>
              </div>

              {/* Bottom nav */}
              <div className="flex flex-col items-center gap-3">
                {/* Notifications */}
                <button
                  type="button"
                  onClick={() => {}}
                  className="group relative flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200 transition-colors duration-150"
                >
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 16v-5a6 6 0 0 0-12 0v5" />
                    <path d="M5 16h14" />
                    <path d="M10 19a2 2 0 0 0 4 0" />
                  </svg>
                  <div className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                    <div className="rounded-xl bg-[#18191f] shadow-lg border border-white/10 px-3 py-1 text-xs text-gray-100">
                      Notifications
                    </div>
                  </div>
                </button>

                {/* Settings (placeholder) */}
                <button
                  type="button"
                  onClick={() => {}}
                  className="group relative flex items-center justify-center w-8 h-8 rounded-lg text-zinc-500 hover:bg-white/5 hover:text-zinc-200 transition-colors duration-150"
                >
                  <svg
                    className="w-5 h-5"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.7"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                  </svg>
                  <div className="pointer-events-none absolute left-14 top-1/2 -translate-y-1/2 opacity-0 translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all duration-150">
                    <div className="rounded-xl bg-[#18191f] shadow-lg border border-white/10 px-3 py-1 text-xs text-gray-100">
                      Settings
                    </div>
                  </div>
                </button>
              </div>
            </aside>

            {/* Second sidebar: Tasks panel (only when Tasks view is active) */}
            {!isSimulation &&
              activeView === "tasks" &&
              (!isTodayPanelCollapsed || isTodayPanelAnimatingOut) && (
                <aside
                  className={`h-screen w-[272px] bg-[#181818] border-r border-[#2a2a2a] flex flex-col min-h-0 py-4 px-3 transition-all duration-200 ease-out shrink-0 ${
                    isTodayPanelAnimatingOut
                      ? "opacity-0 translate-x-2 pointer-events-none"
                      : "opacity-100 translate-x-0"
                  }`}
                >
                  <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                    {/* System categories — TickTick-style nav (taller, outline icons) */}
                    <nav
                      className="shrink-0 flex flex-col gap-0.5"
                      aria-label="Task categories"
                    >
                      {TASK_CATEGORY_LISTS.map((list) => (
                        <div
                          key={list.id}
                          role="button"
                          tabIndex={0}
                          onClick={() => {
                            handleSelectList(list.id);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" || e.key === " ") {
                              e.preventDefault();
                              handleSelectList(list.id);
                            }
                          }}
                          className={`flex items-center gap-3 rounded-lg px-2.5 py-2.5 min-h-[44px] text-[13px] font-medium leading-snug transition-colors duration-150 cursor-pointer overflow-visible ${
                            selectedListId === list.id
                              ? "bg-[#2c2c2c] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
                              : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
                          }`}
                        >
                          {list.id === SYS_LIST_OVERDUE ? (
                            <span className="relative flex items-center justify-center w-[22px] h-[22px] shrink-0">
                              <span className="overdue-nav-aura-soft" aria-hidden />
                              <span className="overdue-nav-aura" aria-hidden />
                              <span className="relative z-[1] flex items-center justify-center">
                                <TaskSystemNavIcon listId={list.id} />
                              </span>
                            </span>
                          ) : (
                            <TaskSystemNavIcon listId={list.id} />
                          )}
                          <span className="truncate">{list.label}</span>
                        </div>
                      ))}
                    </nav>

                    <div
                      className="shrink-0 h-px bg-white/[0.07] my-4 mx-0.5"
                      aria-hidden
                    />

                    <div className="shrink-0 flex items-center justify-between group mb-2 px-0.5">
                      <p className="text-[11px] font-medium text-zinc-500 tracking-wide">
                        Lists
                      </p>
                      <button
                        type="button"
                        onClick={() => {
                          if (isFocusTimerRunning) {
                            setFocusSessionDialog({
                              kind: "quit",
                              pending: { action: "addList" },
                            });
                            return;
                          }
                          if (focusEnterZenActive) {
                            cancelFocusEnterZen();
                          }
                          if (isFocusSessionActive) {
                            cleanupFocusSessionAfterQuit();
                          }
                          setNewListName("");
                          setNewListColor("#eab308");
                          setIsAddListModalOpen(true);
                        }}
                        className="opacity-0 group-hover:opacity-100 transition-opacity duration-150 rounded-lg hover:bg-white/5 w-7 h-7 flex items-center justify-center text-zinc-400 hover:text-zinc-200 shrink-0"
                        aria-label="Add List"
                      >
                        +
                      </button>
                    </div>

                    <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden flex flex-col gap-0.5 pb-1 -mx-0.5 px-0.5">
                      {todayLists.map((list) => (
                        <div
                          key={list.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => {
                          handleSelectList(list.id);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            handleSelectList(list.id);
                          }
                        }}
                          className={`group flex flex-col gap-0.5 rounded-md mx-1 px-1.5 py-1 text-[12px] leading-tight transition-colors duration-150 ${
                            selectedListId === list.id
                              ? "bg-[#2e2e2e] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]"
                              : "text-zinc-200 hover:bg-white/[0.06]"
                          }`}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <span className="text-base shrink-0">{list.icon}</span>
                              <span className="truncate text-[13px] font-normal">
                                {list.label}
                              </span>
                              <span
                                className={`w-2 h-2 rounded-full shrink-0 ${listAccentDotClass(list.color)}`}
                                style={
                                  list.color
                                    ? { backgroundColor: list.color }
                                    : undefined
                                }
                                aria-hidden
                              />
                            </div>

                            <div className="flex items-center">
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setOpenListMenuId((cur) =>
                                    cur === list.id ? null : list.id,
                                  );
                                }}
                                className={`opacity-0 group-hover:opacity-100 transition-opacity duration-150 text-gray-200 rounded-md w-7 h-7 flex items-center justify-center hover:bg-white/5`}
                                aria-label="List menu"
                              >
                                •••
                              </button>
                            </div>
                          </div>

                          {openListMenuId === list.id && (
                            <div
                              ref={listMenuRef}
                              className="w-full rounded-xl bg-[#18191f] border border-white/10 shadow-sm overflow-hidden"
                            >
                              <button
                                type="button"
                                onClick={() => {
                                  setTodayLists((prev) =>
                                    prev.filter((l) => l.id !== list.id),
                                  );
                                  setTasksByListId((prev) => {
                                    const next = { ...prev };
                                    delete next[list.id];
                                    return next;
                                  });
                                  if (selectedListId === list.id) {
                                    setSelectedListId(null);
                                    setTasks([]);
                                    setSelectedTaskId(null);
                                  }
                                  setOpenListMenuId(null);
                                }}
                                className="w-full text-left px-3 py-2 text-sm text-gray-200 hover:bg-white/5 transition-colors duration-150"
                              >
                                Delete List
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="shrink-0 border-t border-white/[0.06] pt-3 mt-2 pb-1">
                    <button
                      type="button"
                      onClick={() => {
                        if (isFocusTimerRunning) {
                          setFocusSessionDialog({
                            kind: "quit",
                            pending: { action: "completed" },
                          });
                          return;
                        }
                        if (focusEnterZenActive) {
                          cancelFocusEnterZen();
                        }
                        if (isFocusSessionActive) {
                          cleanupFocusSessionAfterQuit();
                        }
                        setCollapsedCompletedDates({});
                        setTodayMainMode("completed");
                      }}
                      className={`w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2.5 min-h-[40px] text-[13px] font-medium leading-snug transition-colors duration-150 ${
                        todayMainMode === "completed"
                          ? "bg-[#2c2c2c] text-zinc-100 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]"
                          : "text-zinc-400 hover:text-zinc-200 hover:bg-white/[0.05]"
                      }`}
                    >
                      <svg
                        className="w-[18px] h-[18px] text-zinc-500 shrink-0"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden
                      >
                        <path d="M9 11l3 3L22 4" />
                        <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                      </svg>
                      <span className="font-medium">Completed</span>
                    </button>
                  </div>
                </aside>
            )}

            {/* Expand lists sidebar (focus session, TickTick-style) */}
            {isFocusSessionActive &&
              activeView === "tasks" &&
              isTodayPanelCollapsed &&
              !isTodayPanelAnimatingOut && (
                <button
                  type="button"
                  onClick={() => {
                    setIsTodayPanelCollapsed(false);
                    setIsTodayPanelAnimatingOut(false);
                  }}
                  className="h-screen w-7 shrink-0 z-[240] flex flex-col items-center justify-center gap-1 bg-[#141414] border-r border-[#2a2a2a] text-zinc-500 hover:text-zinc-200 hover:bg-white/[0.04] transition-colors"
                  aria-label="Expand lists sidebar"
                  title="Show lists"
                >
                  <svg
                    className="w-4 h-4"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    aria-hidden
                  >
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </button>
              )}

            {/* Content panel (hidden during focus session — replaced by light focus column) */}
            {!isFocusSessionActive && (
            <section
              className={`flex-1 min-h-0 h-screen flex flex-col ${
                activeView === "tasks" &&
                (todayMainMode === "tasks" || todayMainMode === "completed")
                  ? "overflow-hidden"
                  : activeView === "calendar"
                    ? "overflow-hidden"
                    : "overflow-y-auto"
              }`}
            >
              <div
                className={`w-full h-full min-h-0 flex flex-col ${
                  activeView === "tasks" &&
                  (todayMainMode === "tasks" || todayMainMode === "completed")
                    ? "px-0 pt-0 pb-0"
                    : activeView === "calendar" || activeView === "analytics"
                      ? "flex-1 min-h-0 px-0 pt-0 pb-0"
                      : "px-5 pt-3 pb-6"
                }`}
              >
                <div
                  className={`flex items-center justify-between pointer-events-auto shrink-0 ${
                    activeView === "tasks" &&
                    (todayMainMode === "tasks" || todayMainMode === "completed")
                      ? "hidden"
                      : activeView === "calendar" || activeView === "analytics"
                        ? "hidden"
                        : "mb-6"
                  }`}
                >
                  {activeView === "tasks" ? (
                    <>
                      <h1 className="text-lg font-semibold text-zinc-100 tracking-tight">
                        {todayMainMode === "completed"
                          ? "Completed"
                          : selectedListId
                            ? selectedList?.label ?? "Tasks"
                            : ""}
                      </h1>
                      <button
                        type="button"
                        disabled
                        className={`hidden md:inline-flex items-center gap-2 px-3 py-1.5 rounded border border-zinc-700 bg-zinc-900/80 text-zinc-500 text-[11px] font-medium transition-all pointer-events-auto ${
                          selectedListId ? "" : "hidden"
                        }`}
                      >
                        Collapse
                      </button>
                    </>
                  ) : (
                    <h1 className="text-lg font-semibold text-zinc-100 tracking-tight">
                      {activeView === "notifications" && "Notifications"}
                      {activeView === "settings" && "Settings"}
                    </h1>
                  )}
                </div>
                {activeView === "tasks" && todayMainMode === "completed" ? (
                  <div
                    className="w-full flex-1 min-h-0 flex flex-col overflow-hidden"
                    style={{ backgroundColor: TT_MAIN_GREY }}
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] flex-1 min-h-0">
                      <div
                        className="pl-3 pr-2 pt-3 pb-2 flex flex-col h-full min-h-0 border-r border-[#2a2a2a]"
                        style={{ backgroundColor: TT_MAIN_GREY }}
                      >
                        <div className="flex items-center justify-between gap-4 mb-3 shrink-0">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={handleToggleTodaySidebar}
                              disabled={isTodayPanelAnimatingOut}
                              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-transparent bg-transparent text-zinc-300 hover:border-zinc-600 hover:shadow-[0_1px_8px_rgba(0,0,0,0.45)] hover:bg-zinc-800/40 transition-all duration-150 disabled:opacity-50"
                              aria-label="Collapse Tasks sidebar"
                            >
                              <svg
                                className="w-[18px] h-[18px]"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                aria-hidden
                              >
                                <line x1="4" y1="6" x2="20" y2="6" />
                                <line x1="4" y1="12" x2="20" y2="12" />
                                <line x1="4" y1="18" x2="20" y2="18" />
                              </svg>
                            </button>
                            <h2 className="text-xl font-semibold text-zinc-100 tracking-normal leading-7">
                              Completed
                            </h2>
                          </div>
                        </div>

                        <div className="flex-1 min-h-0 overflow-y-auto">
                          {completedGroups.length === 0 ? (
                            <div className="flex flex-col items-center justify-center min-h-[200px] text-zinc-500 text-sm px-4">
                              No completed tasks
                            </div>
                          ) : (
                            <div className="space-y-0">
                              {completedGroups.map((group) => {
                                const isCollapsed =
                                  collapsedCompletedDates[group.dateStr] ?? false;
                                return (
                                  <div
                                    key={group.dateStr}
                                    className="border-b border-[#2a2a2a]"
                                  >
                                    <button
                                      type="button"
                                      onClick={() =>
                                        setCollapsedCompletedDates((prev) => ({
                                          ...prev,
                                          [group.dateStr]: !isCollapsed,
                                        }))
                                      }
                                      className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/[0.04] transition-colors"
                                    >
                                      <span
                                        className={`text-zinc-500 text-xs w-4 flex justify-center transition-transform ${isCollapsed ? "" : "rotate-90"}`}
                                        aria-hidden
                                      >
                                        ▼
                                      </span>
                                      <span className="flex-1 text-[14px] font-semibold text-zinc-200">
                                        {group.label}
                                      </span>
                                    </button>
                                    {!isCollapsed && (
                                      <div className="divide-y divide-[#2a2a2a]/80">
                                        {group.items.map((item) => (
                                          <div
                                            key={item.key}
                                            className="flex items-center gap-3 px-3 py-2.5 pl-9"
                                          >
                                            <span className="shrink-0 w-[16px] h-[16px] rounded border border-blue-500 bg-blue-500 flex items-center justify-center">
                                              <span className="text-white text-[9px] leading-none">
                                                ✓
                                              </span>
                                            </span>
                                            <span className="flex-1 min-w-0 text-[13px] text-zinc-500 line-through truncate">
                                              {item.taskName}
                                            </span>
                                            <span className="shrink-0 text-right">
                                              <span className="text-[11px] text-zinc-600 block">
                                                {item.minutes}m
                                              </span>
                                              <span className="text-[10px] text-zinc-600/90 truncate max-w-[100px] block">
                                                {item.listLabel}
                                              </span>
                                            </span>
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

                      <div
                        className="hidden lg:flex flex-col h-full min-h-0 items-center justify-center relative overflow-hidden"
                        style={{ backgroundColor: "#0f0f0f" }}
                      >
                        <div
                          className="absolute inset-0 opacity-[0.12]"
                          style={{
                            background:
                              "radial-gradient(ellipse at 50% 65%, rgba(250,250,250,0.15), transparent 55%)",
                          }}
                        />
                        <svg
                          className="relative z-[1] w-[min(100%,320px)] max-h-[45vh] text-zinc-500/50"
                          viewBox="0 0 240 200"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.2"
                          aria-hidden
                        >
                          <rect
                            x="48"
                            y="44"
                            width="72"
                            height="96"
                            rx="4"
                            className="fill-zinc-800/30"
                          />
                          <path d="M56 56h56M56 68h40M56 80h48M56 92h36" />
                          <path d="M68 120h32" strokeDasharray="3 3" />
                          <rect
                            x="118"
                            y="52"
                            width="10"
                            height="28"
                            rx="1"
                            className="fill-zinc-700/40"
                          />
                          <path d="M128 80 L132 120 L124 120 Z" className="fill-zinc-600/30" />
                          <ellipse cx="168" cy="118" rx="22" ry="8" />
                          <path d="M150 118 L186 118" />
                          <path d="M162 110 L174 102" />
                          <rect x="178" y="64" width="28" height="36" rx="3" />
                          <path d="M182 72h20M182 80h16" />
                          <circle cx="88" cy="36" r="6" strokeDasharray="2 2" />
                          <rect x="152" y="36" width="14" height="14" rx="2" />
                          <path d="M156 40h6M159 37v6" />
                        </svg>
                      </div>
                    </div>
                  </div>
                ) : activeView === "tasks" && todayMainMode === "tasks" ? (
                  <div
                    className="w-full flex-1 min-h-0 flex flex-col overflow-hidden"
                    style={{ backgroundColor: TT_MAIN_GREY }}
                  >
                    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] flex-1 min-h-0">
                      {/* LEFT PANEL: tasks (TickTick middle column) */}
                      <div
                        className="pl-3 pr-2 pt-3 pb-2 flex flex-col h-full min-h-0"
                        style={{ backgroundColor: TT_MAIN_GREY }}
                      >
                        {/* Header + actions */}
                        <div className="flex items-center justify-between gap-4 mb-3 shrink-0">
                          <div className="flex items-center gap-2.5 min-w-0 flex-1">
                            <button
                              type="button"
                              onClick={handleToggleTodaySidebar}
                              disabled={isTodayPanelAnimatingOut}
                              className="inline-flex items-center justify-center w-9 h-9 rounded-md border border-transparent bg-transparent text-zinc-300 hover:border-zinc-600 hover:shadow-[0_1px_8px_rgba(0,0,0,0.45)] hover:bg-zinc-800/40 transition-all duration-150 disabled:opacity-50"
                              aria-label="Collapse Tasks sidebar"
                              title="Collapse Tasks sidebar"
                            >
                              <svg
                                className="w-[18px] h-[18px]"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                aria-hidden
                              >
                                <line x1="4" y1="6" x2="20" y2="6" />
                                <line x1="4" y1="12" x2="20" y2="12" />
                                <line x1="4" y1="18" x2="20" y2="18" />
                              </svg>
                            </button>
                            {selectedList ? (
                              <>
                                {selectedList.system ? (
                                  <TaskSystemNavIcon
                                    listId={selectedList.id}
                                    className="w-5 h-5 shrink-0 text-zinc-400"
                                  />
                                ) : (
                                  <span className="text-lg leading-none shrink-0">
                                    {selectedList.icon}
                                  </span>
                                )}
                                <h2 className="text-xl font-semibold text-zinc-100 truncate tracking-normal leading-7">
                                  {selectedList.label}
                                </h2>
                                {!selectedList.system && (
                                  <span
                                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${listAccentDotClass(selectedList.color)}`}
                                    style={
                                      selectedList.color
                                        ? {
                                            backgroundColor: selectedList.color,
                                          }
                                        : undefined
                                    }
                                    aria-hidden
                                  />
                                )}
                              </>
                            ) : (
                              <h2 className="text-xl font-semibold text-zinc-300 truncate tracking-normal leading-7">
                                Tasks
                              </h2>
                            )}
                          </div>
                          <div className="flex items-center gap-1 shrink-0 text-zinc-500">
                            <button
                              type="button"
                              className="p-2 rounded-md hover:bg-white/[0.06] hover:text-zinc-300 transition-colors"
                              aria-label="Sort"
                            >
                              <svg
                                className="w-[18px] h-[18px]"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M8 9l4-4 4 4M8 15l4 4 4-4" />
                              </svg>
                            </button>
                            <button
                              type="button"
                              className="p-2 rounded-md hover:bg-white/[0.06] hover:text-zinc-300 transition-colors"
                              aria-label="More options"
                            >
                              <svg
                                className="w-[18px] h-[18px]"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                              >
                                <circle cx="5" cy="12" r="1.5" fill="currentColor" />
                                <circle cx="12" cy="12" r="1.5" fill="currentColor" />
                                <circle cx="19" cy="12" r="1.5" fill="currentColor" />
                              </svg>
                            </button>
                          </div>
                        </div>

                        {/* Task input bar — hidden for Overdue (system-fed only) */}
                        {selectedListId !== SYS_LIST_OVERDUE && (
                          <div
                            className="border border-[#2a2a2a] rounded-[10px] px-2.5 h-10 flex items-center gap-2 shrink-0"
                            style={{ backgroundColor: TT_INPUT_ROW }}
                          >
                            <span className="text-zinc-500 text-base leading-none pl-0.5">
                              +
                            </span>
                            <input
                              value={taskInput}
                              onChange={(e) => setTaskInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  addTaskFromListInput();
                                }
                              }}
                              placeholder={taskInputPlaceholder(selectedListId)}
                              disabled={!selectedListId}
                              className="flex-1 h-full bg-transparent text-zinc-200 placeholder:text-zinc-500 outline-none text-[15px] leading-normal disabled:opacity-50 disabled:cursor-not-allowed"
                            />
                          </div>
                        )}

                        {/* Tasks list */}
                        <div
                          className={`flex-1 min-h-0 overflow-y-auto ${
                            selectedListId === SYS_LIST_OVERDUE ? "mt-1" : "mt-2"
                          }`}
                        >
                          {!selectedListId ? (
                            <div className="h-full min-h-[240px] flex flex-col items-center justify-center px-6 text-center">
                              <p className="text-[15px] font-semibold text-zinc-200 mb-1">
                                No list selected
                              </p>
                              <p className="text-sm text-zinc-500 max-w-xs">
                                Choose a list from the sidebar to add and view tasks.
                              </p>
                            </div>
                          ) : tasks.filter((t) => !t.removing).length === 0 ? (
                            selectedListId === SYS_LIST_OVERDUE ? (
                              <div className="flex flex-col items-center justify-center min-h-[min(420px,60vh)] px-6 py-12">
                                <DogHomeworkOverdueIllustration />
                                <p className="text-[15px] font-medium text-zinc-300 text-center max-w-[280px] leading-relaxed">
                                  Looks like nothing is missing. Nice work!
                                </p>
                              </div>
                            ) : (
                              <div className="flex flex-col items-center justify-center min-h-[min(420px,60vh)] px-4 py-10">
                                <DefaultTasksEmptyIllustration />
                                <p className="text-lg font-semibold text-zinc-100 tracking-tight">
                                  {listEmptyHeadline(
                                    selectedListId,
                                    isUserListSelected,
                                  )}
                                </p>
                                <p className="mt-1.5 text-sm text-zinc-400">
                                  Click the input box to add
                                </p>
                              </div>
                            )
                          ) : (
                            <div className="space-y-0.5 pt-1">
                              {tasks
                                .filter((t) => !t.removing)
                                .map((t) => {
                                  const isSelected = selectedTaskId === t.id;
                                  return (
                                    <div
                                      key={t.id}
                                      role="button"
                                      tabIndex={0}
                                      onClick={() => {
                                        setSelectedTaskId(t.id);
                                      }}
                                      onKeyDown={(e) => {
                                        if (e.key !== "Enter") return;
                                        setSelectedTaskId(t.id);
                                      }}
                                      className={`group mx-1 rounded-xl px-2 py-1.5 flex items-center gap-2.5 transition-colors cursor-pointer ${
                                        isSelected
                                          ? "bg-[#333333] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.07)]"
                                          : "hover:bg-[#1c1c1c]"
                                      }`}
                                    >
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          const next = !t.completed;
                                          if (selectedListId) {
                                            if (next) {
                                              appendCompletedActivity(
                                                t.text,
                                                0,
                                                selectedListId,
                                                selectedList?.label ?? "",
                                              );
                                            } else {
                                              removeLastCompletedForTaskOnList(
                                                t.text,
                                                selectedListId,
                                              );
                                            }
                                          }
                                          setTasks((prev) =>
                                            prev.map((x) =>
                                              x.id === t.id
                                                ? { ...x, completed: next }
                                                : x,
                                            ),
                                          );
                                        }}
                                        className={`shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center transition-colors ${
                                          t.completed
                                            ? "border-blue-500 bg-blue-500"
                                            : "border-zinc-500 hover:border-zinc-400"
                                        }`}
                                        aria-label={
                                          t.completed ? "Mark incomplete" : "Complete task"
                                        }
                                      >
                                        {t.completed ? (
                                          <span className="text-white text-[10px] leading-none">✓</span>
                                        ) : null}
                                      </button>
                                      <span
                                        className={`text-[13px] truncate flex-1 text-left ${
                                          t.completed
                                            ? "text-zinc-500 line-through"
                                            : "text-zinc-200"
                                        }`}
                                      >
                                        {t.text}
                                      </span>
                                      {selectedListId &&
                                        (selectedListId === SYS_LIST_TODAY ||
                                          (t.dueDate &&
                                            (DUE_DATE_PICKER_LIST_IDS.has(
                                              selectedListId,
                                            ) ||
                                              selectedListId ===
                                                SYS_LIST_OVERDUE))) && (
                                          <span className="relative inline-flex items-center shrink-0 max-w-[88px]">
                                            <span
                                              className="due-date-aura-row-soft"
                                              aria-hidden
                                            />
                                            <span
                                              className="due-date-aura-row"
                                              aria-hidden
                                            />
                                            <span className="relative z-[1] inline-flex items-center rounded-md border border-white/[0.1] bg-[#2a2a2a] px-2 py-1 text-[12px] font-medium text-zinc-300 tabular-nums truncate">
                                              {selectedListId === SYS_LIST_TODAY
                                                ? formatDueButtonLabel(
                                                    calendarDay,
                                                  )
                                                : selectedListId ===
                                                    SYS_LIST_OVERDUE
                                                  ? formatOverdueRowDue(
                                                      t.dueDate!,
                                                    )
                                                  : formatDueButtonLabel(
                                                      t.dueDate!,
                                                    )}
                                            </span>
                                          </span>
                                        )}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setTasks((prev) =>
                                            prev.filter((x) => x.id !== t.id),
                                          );
                                          if (selectedTaskId === t.id) {
                                            setSelectedTaskId(null);
                                          }
                                        }}
                                        className="shrink-0 w-7 h-7 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity"
                                        aria-label="Delete task"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  );
                                })}
                            </div>
                          )}
                        </div>
                      </div>

                      {/* RIGHT PANEL: task details (TickTick detail column) */}
                      <div
                        className="border-l border-[#2a2a2a] flex flex-col h-full min-h-0"
                        style={{ backgroundColor: TT_MAIN_GREY }}
                      >
                        {!selectedListId ? (
                          <div className="flex-1 flex items-center justify-center text-zinc-500 text-sm px-6 text-center">
                            Select a list to view details
                          </div>
                        ) : selectedTask ? (
                          <>
                            <div className="flex items-center gap-3 px-4 py-2.5 shrink-0">
                              <button
                                type="button"
                                onClick={() => {
                                  const next = !selectedTask.completed;
                                  if (selectedListId) {
                                    if (next) {
                                      appendCompletedActivity(
                                        selectedTask.text,
                                        0,
                                        selectedListId,
                                        selectedList?.label ?? "",
                                      );
                                    } else {
                                      removeLastCompletedForTaskOnList(
                                        selectedTask.text,
                                        selectedListId,
                                      );
                                    }
                                  }
                                  setTasks((prev) =>
                                    prev.map((x) =>
                                      x.id === selectedTask.id
                                        ? { ...x, completed: next }
                                        : x,
                                    ),
                                  );
                                }}
                                className={`shrink-0 w-[18px] h-[18px] rounded-full border-2 flex items-center justify-center ${
                                  selectedTask.completed
                                    ? "border-blue-500 bg-blue-500"
                                    : "border-zinc-500 hover:border-zinc-400"
                                }`}
                                aria-label="Toggle complete"
                              >
                                {selectedTask.completed ? (
                                  <span className="text-white text-[10px]">✓</span>
                                ) : null}
                              </button>
                            </div>

                            <div className="px-4 pt-1 flex items-start justify-between gap-2 shrink-0">
                              <h3 className="text-lg font-semibold text-white leading-snug flex-1 min-w-0">
                                {selectedTask.text}
                              </h3>
                              <div className="flex items-center gap-2 shrink-0">
                                {selectedListId === SYS_LIST_TODAY && (
                                  <span className="relative inline-flex items-center rounded-lg shrink-0">
                                    <span
                                      className="due-date-aura-detail-soft"
                                      aria-hidden
                                    />
                                    <span
                                      className="due-date-aura-detail"
                                      aria-hidden
                                    />
                                    <button
                                      type="button"
                                      disabled
                                      aria-disabled="true"
                                      tabIndex={-1}
                                      onClick={(e) => e.preventDefault()}
                                      className="relative z-[1] inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#2a2a2a] px-3 py-2 text-[13px] font-medium text-zinc-200 cursor-default"
                                    >
                                      <span className="tabular-nums">
                                        {formatDueButtonLabel(calendarDay)}
                                      </span>
                                      <svg
                                        className="w-4 h-4 text-zinc-500"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        aria-hidden
                                      >
                                        <path d="M6 9l6 6 6-6" />
                                      </svg>
                                    </button>
                                  </span>
                                )}
                                {selectedListId === SYS_LIST_OVERDUE &&
                                  selectedTask.dueDate && (
                                    <span className="relative inline-flex items-center rounded-lg shrink-0">
                                      <span
                                        className="due-date-aura-detail-soft"
                                        aria-hidden
                                      />
                                      <span
                                        className="due-date-aura-detail"
                                        aria-hidden
                                      />
                                      <button
                                        type="button"
                                        disabled
                                        aria-disabled="true"
                                        tabIndex={-1}
                                        onClick={(e) => e.preventDefault()}
                                        className="relative z-[1] inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#2a2a2a] px-3 py-2 text-[13px] font-medium text-zinc-200 cursor-default"
                                      >
                                        <span className="tabular-nums">
                                          {formatOverdueRowDue(
                                            selectedTask.dueDate,
                                          )}
                                        </span>
                                        <svg
                                          className="w-4 h-4 text-zinc-500"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          aria-hidden
                                        >
                                          <path d="M6 9l6 6 6-6" />
                                        </svg>
                                      </button>
                                    </span>
                                  )}
                                {selectedListId &&
                                  DUE_DATE_PICKER_LIST_IDS.has(
                                    selectedListId,
                                  ) && (
                                    <span className="relative inline-flex items-center rounded-lg shrink-0">
                                      <span
                                        className="due-date-aura-detail-soft"
                                        aria-hidden
                                      />
                                      <span
                                        className="due-date-aura-detail"
                                        aria-hidden
                                      />
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setDueDatePopover({
                                            taskId: selectedTask.id,
                                            anchor:
                                              e.currentTarget.getBoundingClientRect(),
                                          });
                                        }}
                                        className="relative z-[1] inline-flex items-center gap-1.5 rounded-lg border border-white/[0.1] bg-[#2a2a2a] px-3 py-2 text-[13px] font-medium text-zinc-200 hover:bg-[#323232] transition-colors"
                                      >
                                        {selectedTask.dueDate ? (
                                          <>
                                            <span className="tabular-nums">
                                              {formatDueButtonLabel(
                                                selectedTask.dueDate,
                                              )}
                                            </span>
                                            <svg
                                              className="w-4 h-4 text-zinc-500"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="2"
                                              aria-hidden
                                            >
                                              <path d="M6 9l6 6 6-6" />
                                            </svg>
                                          </>
                                        ) : (
                                          <>
                                            <span>Due date</span>
                                            <svg
                                              className="w-4 h-4 text-zinc-500"
                                              viewBox="0 0 24 24"
                                              fill="none"
                                              stroke="currentColor"
                                              strokeWidth="1.75"
                                              aria-hidden
                                            >
                                              <rect
                                                x="3"
                                                y="5"
                                                width="18"
                                                height="16"
                                                rx="2"
                                              />
                                              <path d="M8 3v4M16 3v4M3 11h18" />
                                            </svg>
                                          </>
                                        )}
                                      </button>
                                    </span>
                                  )}
                                <button
                                  type="button"
                                  className="text-zinc-500 hover:text-zinc-300 p-1 shrink-0"
                                  aria-label="Task menu"
                                >
                                  ⋮
                                </button>
                              </div>
                            </div>

                            <div className="flex-1 min-h-0 px-4 pt-3 pb-6 overflow-y-auto">
                              <textarea
                                value={selectedTask.description}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  setTasks((prev) =>
                                    prev.map((t) =>
                                      t.id === selectedTask.id
                                        ? { ...t, description: val }
                                        : t,
                                    ),
                                  );
                                }}
                                placeholder="Write a description"
                                className="w-full min-h-[200px] bg-transparent text-[13px] text-zinc-300 placeholder:text-zinc-600 outline-none resize-none leading-relaxed"
                              />
                            </div>
                          </>
                        ) : (
                          <div className="flex-1 flex items-center justify-center text-zinc-600 text-[13px] px-6 text-center">
                            Select a task to view details
                          </div>
                        )}
                      </div>
                    </div>
                    <MiniDueDatePopover
                      open={dueDatePopover !== null}
                      anchor={dueDatePopover?.anchor ?? null}
                      selectedIso={
                        dueDatePopover
                          ? tasks.find((x) => x.id === dueDatePopover.taskId)
                              ?.dueDate ?? null
                          : null
                      }
                      onSelect={(iso) => {
                        const tid = dueDatePopover?.taskId;
                        if (tid == null) return;
                        setTasks((prev) =>
                          prev.map((x) =>
                            x.id === tid ? { ...x, dueDate: iso } : x,
                          ),
                        );
                        setDueDatePopover(null);
                      }}
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
                      <div className="flex-1 min-h-0 flex flex-col overflow-hidden bg-[#09090b] text-zinc-100 antialiased [text-rendering:optimizeLegibility]">
                        <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden">
                          <div className="w-full max-w-none mx-auto px-3 sm:px-5 lg:px-6 py-4 pb-10 space-y-2.5">
                            <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between border-b border-zinc-800/50 pb-6 mb-0.5">
                              <div>
                                <h1 className="text-[1.5rem] sm:text-[1.65rem] font-semibold text-zinc-50 tracking-tight flex items-center gap-2.5">
                                  <span
                                    className="text-zinc-400 shrink-0"
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
                                <p className="text-[12px] text-zinc-600 mt-2 max-w-lg leading-relaxed">
                                  Focus trends and discipline at a glance
                                </p>
                              </div>
                              <div className="shrink-0 flex items-center gap-2">
                                <span className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-800/80 bg-[#0f0f12] px-2.5 py-1 text-[11px] font-medium text-zinc-500 tabular-nums shadow-[0_1px_2px_rgba(0,0,0,0.4)]">
                                  <span
                                    className="h-1 w-1 rounded-full bg-blue-500/65"
                                    aria-hidden
                                  />
                                  Last 7 days
                                </span>
                              </div>
                            </header>

                            <section className="rounded-xl border border-zinc-800/70 bg-[#0f0f12] shadow-[0_1px_0_rgba(255,255,255,0.035)_inset,0_8px_28px_rgba(0,0,0,0.45)] transition-[background-color] duration-150 hover:bg-[#101014]">
                              <div className="flex flex-col gap-1.5 p-3 sm:p-4 border-b border-zinc-800/60">
                                <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-3">
                                  <div className="min-w-0">
                                    <h2 className="text-[16px] font-semibold text-zinc-50 tracking-tight">
                                      {selectedStat === "Integrity"
                                        ? "Focus Integrity"
                                        : "Task Speed"}
                                    </h2>
                                    <p className="text-[11px] text-zinc-600 mt-0.5 leading-snug">
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
                                          className="flex h-9 w-full cursor-pointer items-center justify-between gap-2.5 rounded-2xl border border-zinc-700/60 bg-[#161618] px-3.5 py-1.5 text-left font-['Plus_Jakarta_Sans',system-ui,sans-serif] text-[12px] font-semibold text-zinc-100 shadow-[0_8px_24px_rgba(0,0,0,0.35)] outline-none ring-0 transition-all duration-100 hover:border-zinc-600 hover:bg-[#1a1a1d] hover:shadow-[0_12px_32px_rgba(0,0,0,0.4)] focus-visible:border-blue-500/50 focus-visible:ring-2 focus-visible:ring-blue-500/25"
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
                                            className={`h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 ${analyticsTaskPickerOpen ? "rotate-180" : ""}`}
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
                                            className="absolute left-0 right-0 top-full z-[401] mt-1.5 overflow-hidden rounded-2xl border border-zinc-700/55 bg-[#18181b]/98 py-1 shadow-[0_22px_55px_rgba(0,0,0,0.55),inset_0_1px_0_rgba(255,255,255,0.06)] backdrop-blur-xl"
                                            role="listbox"
                                          >
                                            <div className="max-h-[min(320px,50vh)] overflow-y-auto overscroll-contain px-1.5 py-0.5 font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
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
                                                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium tracking-tight transition-colors ${
                                                  selectedTaskGraph === ""
                                                    ? "bg-white/[0.08] text-zinc-50 ring-1 ring-white/10"
                                                    : "text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200"
                                                }`}
                                              >
                                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800/80 text-zinc-500">
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
                                                      className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] font-medium tracking-tight transition-colors ${
                                                        isSel
                                                          ? "bg-white/[0.08] text-zinc-50 ring-1 ring-white/10"
                                                          : "text-zinc-300 hover:bg-white/[0.04] hover:text-zinc-50"
                                                      }`}
                                                    >
                                                      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-zinc-800/70 text-zinc-500">
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
                                    <div className="inline-flex h-9 shrink-0 rounded-full border border-zinc-700/75 bg-[#0c0c0e] p-1 font-['Plus_Jakarta_Sans',system-ui,sans-serif] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
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
                                            className={`rounded-full px-3.5 py-1.5 text-[11px] font-bold tracking-tight antialiased transition-all duration-200 ${
                                              selectedStat === type
                                                ? "bg-zinc-100 text-zinc-900 shadow-[0_1px_8px_rgba(0,0,0,0.35)]"
                                                : "font-semibold text-zinc-500 hover:text-zinc-200"
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
                                  <div className="flex shrink-0 flex-col justify-between py-1 text-[10px] tabular-nums text-zinc-500 w-12 sm:w-14 text-right leading-none">
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
                                          className="pointer-events-none absolute z-30 rounded-lg border border-zinc-700/90 bg-zinc-950/98 px-2.5 py-1.5 text-[10px] shadow-[0_4px_20px_rgba(0,0,0,0.55)]"
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
                                          <div className="font-medium text-zinc-200">
                                            {
                                              currentData[analyticsChartHover]
                                                .date
                                            }
                                          </div>
                                          <div className="tabular-nums text-blue-400/95 mt-0.5">
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
                                            stopColor="#3b82f6"
                                            stopOpacity="0.12"
                                          />
                                          <stop
                                            offset="100%"
                                            stopColor="#09090b"
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
                                          stroke="#3f3f46"
                                          strokeOpacity={0.45}
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
                                        stroke="#5b9fff"
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
                                              ? "#93c5fd"
                                              : "#3b82f6"
                                          }
                                          stroke="#0c1420"
                                          strokeWidth="0.22"
                                          className="transition-all duration-100"
                                          vectorEffect="non-scaling-stroke"
                                        />
                                      ))}
                                    </svg>
                                  </div>
                                </div>
                                <div className="mt-1 flex justify-between gap-1.5 pl-14 sm:pl-[3.75rem] pr-0 text-[10px] text-zinc-600/85 tabular-nums">
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
                              <section className="rounded-xl border border-zinc-800/70 bg-[#0f0f12] p-3 sm:p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.035)_inset,0_6px_24px_rgba(0,0,0,0.4)] transition-[background-color] duration-150 hover:bg-[#101014]">
                                <div className="flex items-baseline justify-between gap-3 mb-2 pb-2 border-b border-zinc-800/60">
                                  <h2 className="text-[14px] font-semibold text-zinc-100">
                                    Discipline
                                  </h2>
                                  <span className="text-[10px] font-medium text-zinc-600 tabular-nums">
                                    {getCurrentMonthName()}
                                  </span>
                                </div>

                                <div className="grid grid-cols-7 gap-1.5 sm:gap-2">
                                  {["M", "T", "W", "T", "F", "S", "S"].map(
                                    (day, i) => (
                                      <div
                                        key={i}
                                        className="text-[9px] font-medium text-zinc-600 text-center pb-0.5"
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
                                          <div className="absolute bottom-full left-1/2 z-[300] mb-1.5 w-[9.5rem] -translate-x-1/2 rounded-md border border-zinc-700/90 bg-zinc-950/98 p-2.5 text-[10px] text-zinc-300 opacity-0 shadow-lg transition-opacity duration-100 pointer-events-none group-hover:opacity-100">
                                            <div className="font-medium border-b border-zinc-800 pb-1.5 mb-1.5 text-zinc-100 text-[10px]">
                                              {day.date}
                                            </div>
                                            <div className="flex justify-between gap-2 text-zinc-500">
                                              <span>Minutes</span>
                                              <span className="text-zinc-200 tabular-nums font-medium">
                                                {mins}
                                              </span>
                                            </div>
                                            <div className="flex justify-between gap-2 text-zinc-500 mt-1">
                                              <span>Tasks</span>
                                              <span className="text-zinc-200 tabular-nums font-medium">
                                                {day.tasksCompleted}
                                              </span>
                                            </div>
                                            <div className="flex justify-between gap-2 text-zinc-500 mt-1">
                                              <span>Integrity</span>
                                              <span className="text-zinc-200 tabular-nums font-medium">
                                                {day.focusIntegrity.toFixed(0)}%
                                              </span>
                                            </div>
                                            <div className="mt-1.5 flex justify-between border-t border-zinc-800 pt-1.5 text-blue-400/85 text-[10px]">
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

                              <section className="rounded-xl border border-zinc-800/70 bg-[#0f0f12] p-3 sm:p-3.5 shadow-[0_1px_0_rgba(255,255,255,0.035)_inset,0_6px_24px_rgba(0,0,0,0.4)] transition-[background-color] duration-150 hover:bg-[#101014] font-['Plus_Jakarta_Sans',system-ui,sans-serif]">
                                <h2 className="text-[13px] font-bold text-zinc-100 mb-2.5 pb-2 border-b border-zinc-800/60 tracking-tight">
                                  Performance
                                </h2>
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-2.5">
                                  {stats.map((stat, i) => (
                                    <div
                                      key={i}
                                      className="group flex aspect-square min-h-0 flex-col justify-between rounded-2xl border border-zinc-800/70 bg-gradient-to-b from-zinc-900/45 to-zinc-950/90 px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all duration-150 hover:border-zinc-700/80 hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)] sm:px-3 sm:py-3"
                                    >
                                      <p className="text-[9px] font-semibold uppercase tracking-[0.14em] text-zinc-500 leading-snug line-clamp-2">
                                        {stat.label}
                                      </p>
                                      <p className="text-[15px] sm:text-base font-bold tabular-nums tracking-tight text-zinc-50 leading-none">
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
                        <p className="text-sm md:text-base text-gray-500">
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
              <div className="flex flex-1 min-h-0 h-screen w-full min-w-0 overflow-hidden relative bg-gradient-to-b from-gray-50 via-white to-gray-100 text-gray-900">
                <div
                  className="pointer-events-none absolute inset-0 z-0"
                  style={{
                    background:
                      "radial-gradient(circle at 50% 18%, rgba(59, 130, 246, 0.14), transparent 42%)",
                  }}
                />
                <div className="relative z-10 flex min-h-0 min-w-0 flex-1 flex-row">
                  <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                    <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                      <div className="flex w-full flex-shrink-0 flex-col items-center gap-6 px-4 pb-4 pt-16 sm:gap-8">
                  {warning && (
              <div className="fixed top-24 bg-blue-600 text-white px-8 py-2 rounded-full z-[100] animate-pulse text-[10px] font-bold tracking-widest uppercase shadow-xl">
                {warning}
              </div>
            )}
            {floatingTime && (
              <div
                key={floatingTime.id}
                className="fixed top-1/2 text-6xl font-black text-blue-400 animate-float-fade z-[300] drop-shadow-[0_0_20px_rgba(59,130,246,0.5)]"
              >
                {floatingTime.text}
              </div>
            )}

            <div
              className={`w-full max-w-3xl text-center space-y-3 transition-all duration-1000 ${running || showReflection ? "blur-lg opacity-0" : "opacity-100"}`}
            >
              <h1 className="text-4xl font-semibold tracking-tight text-gray-900">
                Hello <span className="text-blue-600">{name}</span>.
              </h1>
              <p className="text-lg text-gray-500 font-light italic">
                {randomGreeting}
              </p>
              <div className="text-[10px] tracking-[0.3em] uppercase text-gray-500">
                🔥 {streak} day streak
              </div>

              {!isSimulation && (
                <div className="pt-6 flex justify-center">
                  <div className="bg-white border border-gray-200 rounded-[32px] p-8 flex gap-12 shadow-lg relative">
                    <div className="text-left">
                      <div className="text-[9px] uppercase tracking-[0.2em] text-gray-500 font-black">
                        YESTERDAY
                      </div>
                      <div className="text-3xl font-mono font-bold tracking-tighter text-gray-900">
                        {yesterdayTotalFocusMinutes}{" "}
                        <span className="text-[10px] text-gray-500 uppercase">
                          MIN
                        </span>
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-[9px] uppercase tracking-[0.2em] text-gray-500 font-black">
                        TODAY
                      </div>
                      <div className="text-3xl font-mono font-bold tracking-tighter text-blue-600">
                        {todayTotalFocusMinutes}{" "}
                        <span className="text-[10px] text-blue-600/80 uppercase">
                          MIN
                        </span>
                      </div>
                    </div>
                    <div
                      className={`flex items-end pb-1 text-[10px] font-black uppercase tracking-widest ${parseInt(improvementDelta) >= 0 ? "text-emerald-600" : "text-red-500"}`}
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
            <div className="relative flex items-center justify-center z-[200]">
              <svg className="absolute w-[360px] h-[360px] -rotate-90">
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
                  stroke={
                    auraColor === "37, 99, 235"
                      ? "#3b82f6"
                      : auraColor === "168, 85, 247"
                        ? "#a855f7"
                        : "#ef4444"
                  }
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
                className={`w-80 h-80 rounded-[56px] bg-white backdrop-blur-3xl border border-gray-200 flex flex-col items-center justify-center shadow-2xl transition-all duration-700 overflow-hidden`}
              >
                {!showReflection ? (
                  <>
                    <div
                      className={`text-7xl font-mono tracking-tighter text-gray-900`}
                    >
                      {String(Math.floor(Math.abs(seconds) / 60)).padStart(
                        2,
                        "0",
                      )}
                      :{String(Math.abs(seconds) % 60).padStart(2, "0")}
                    </div>

                    {running && (
                      <div
                        className={`mt-2 text-[10px] tracking-[0.2em] font-black uppercase transition-all duration-300 ${isViolating ? "text-red-500 scale-125 animate-glitch" : "text-blue-400/60 opacity-100"}`}
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
                          className="px-8 py-2 bg-gray-100 border border-gray-200 rounded-full text-[10px] tracking-widest uppercase text-gray-700 transition hover:bg-gray-200"
                        >
                          +15 MIN
                        </button>
                        {seconds > 0 && (
                          <button
                            onClick={startTimer}
                            className="px-8 py-2 bg-gray-900 text-white rounded-full text-[10px] tracking-widest uppercase font-bold transition hover:scale-105"
                          >
                            START
                          </button>
                        )}
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex flex-col items-center px-6 text-center w-full animate-reflection-in">
                    {!reflectionPrompt ? (
                      <div className="space-y-2 w-full">
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] text-gray-500 mb-4">
                          Reflect
                        </div>
                        {prompts.map((p, i) => (
                          <button
                            key={i}
                            onClick={() => setReflectionPrompt(p)}
                            className="w-full text-left p-3 rounded-2xl bg-gray-50 border border-gray-200 hover:border-blue-400 hover:bg-blue-50/50 transition-all text-[10px] group"
                          >
                            <span className="text-gray-500 group-hover:text-gray-900 transition-colors font-medium line-clamp-1">
                              {p}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-4 w-full flex flex-col items-center">
                        <div className="text-[8px] font-black uppercase tracking-widest text-blue-600 px-3 py-1 bg-blue-50 rounded-full border border-blue-200">
                          {reflectionPrompt}
                        </div>
                        <textarea
                          autoFocus
                          value={reflectionText}
                          onChange={(e) => setReflectionText(e.target.value)}
                          placeholder="..."
                          className="w-full h-24 bg-gray-50 border border-gray-200 rounded-2xl p-4 outline-none text-[10px] text-gray-900 focus:border-blue-400 transition-all resize-none"
                        />
                        <div className="flex gap-2 w-full">
                          <button
                            onClick={() => {
                              setReflectionPrompt(null);
                              setReflectionText("");
                            }}
                            className="px-4 py-2 bg-gray-100 border border-gray-200 rounded-xl font-bold text-[8px] tracking-widest uppercase text-gray-700"
                          >
                            BACK
                          </button>
                          <button
                            onClick={handleReflectionSubmit}
                            disabled={!reflectionText.trim()}
                            className="flex-1 py-2 bg-gray-900 text-white rounded-xl font-black text-[8px] uppercase tracking-widest"
                          >
                            SYNC
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
                      </div>

                      <div className="flex min-h-0 w-full flex-1 flex-col overflow-y-auto overflow-x-hidden">
            <div className="mx-auto w-full max-w-4xl space-y-12 px-4 pb-24 pt-2">
              <div
                className={`space-y-4 max-w-xl mx-auto transition-all duration-1000 ${running || showReflection ? "opacity-40" : "opacity-100"}`}
              >
                <div className="flex gap-3">
                  <input
                    disabled={isSimulation}
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    placeholder={
                      isSimulation ? "Simulating input..." : "Next objective..."
                    }
                    className="flex-1 px-6 py-4 rounded-[24px] bg-white border border-gray-200 text-gray-900 outline-none text-sm focus:border-blue-400 transition-all placeholder-gray-400"
                  />
                  <button
                    disabled={isSimulation}
                    onClick={() => {
                      if (!taskInput.trim()) return;
                      const targetListId = selectedListId ?? SYS_LIST_TODAY;
                      if (targetListId === SYS_LIST_OVERDUE) return;
                      const id = Date.now();
                      let dueDate: string | null = null;
                      if (targetListId === SYS_LIST_TODAY) {
                        dueDate = toISODate(new Date());
                      } else if (DUE_DATE_PICKER_LIST_IDS.has(targetListId)) {
                        dueDate = null;
                      }
                      const newTask: Task = {
                        id,
                        text: taskInput.trim(),
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
                      setTaskInput("");
                      setPendingWorkModeTaskId(id);
                      setIsWorkModeModalOpen(true);
                    }}
                    className="px-8 bg-gray-900 text-white rounded-[24px] font-black text-[10px] tracking-widest uppercase"
                  >
                    ADD
                  </button>
                </div>

                <div className="flex flex-col gap-3 w-full max-w-xl mx-auto">
                  {focusSessionEntries.length === 0 ? (
                    <p className="text-center text-sm text-gray-500 py-2">
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
                          className={`flex items-center justify-between gap-3 p-4 rounded-[28px] bg-white border border-gray-200 transition-all duration-300 ${
                            t.removing
                              ? "opacity-0 translate-x-12"
                              : "opacity-100"
                          }`}
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <div className="w-1.5 h-1.5 rounded-full shrink-0 bg-gray-400" />
                            <span className="text-base text-gray-800 truncate">
                              {t.text}
                            </span>
                          </div>
                          <button
                            type="button"
                            disabled={isSimulation}
                            onClick={() =>
                              completeFocusTask(entry.listId, entry.taskId)
                            }
                            className="w-7 h-7 shrink-0 rounded-full border border-gray-300 hover:border-emerald-500 hover:bg-emerald-50 transition-all disabled:opacity-40 disabled:hover:border-gray-300 disabled:hover:bg-transparent"
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

                  <div className="flex w-[min(360px,32vw)] flex-shrink-0 flex-col self-stretch py-3 pr-3 pl-1 sm:w-[min(380px,34vw)] sm:py-4 sm:pr-4">
                    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-[1.75rem] border border-gray-200/90 bg-white/95 shadow-[0_12px_48px_-16px_rgba(15,23,42,0.12)] backdrop-blur-md sm:rounded-[2rem]">
                      <div className="shrink-0 border-b border-gray-100/90 px-4 py-3">
                        <h2 className="text-[15px] font-semibold tracking-tight text-gray-900">
                          Pick tasks
                        </h2>
                        <p className="mt-0.5 text-[11px] text-gray-500">
                          Tap a category to expand and add tasks
                        </p>
                      </div>
                      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 py-3">
                        {focusSidebarSections.every(
                          (s) => s.tasks.length === 0,
                        ) ? (
                          <p className="px-1 py-8 text-center text-[13px] leading-relaxed text-gray-500">
                            No tasks available
                          </p>
                        ) : (
                          <div className="flex flex-col gap-2">
                            {focusSidebarSections.map((section) => {
                              const expanded = !!focusPickerExpanded[section.listId];
                              return (
                                <div key={section.listId} className="rounded-2xl">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      setFocusPickerExpanded((prev) => ({
                                        ...prev,
                                        [section.listId]: !prev[section.listId],
                                      }))
                                    }
                                    className="flex w-full items-center justify-between gap-2 rounded-full border border-gray-200/90 bg-gradient-to-b from-white to-slate-50/90 px-4 py-2.5 text-left shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-gray-300/90 hover:shadow-md"
                                  >
                                    <span className="min-w-0 truncate text-[13px] font-medium text-gray-800">
                                      {section.label}
                                    </span>
                                    <span className="flex shrink-0 items-center gap-2">
                                      <span
                                        className={`rounded-full px-2 py-0.5 text-[11px] font-semibold tabular-nums ${
                                          section.tasks.length > 0
                                            ? "bg-slate-100 text-slate-600"
                                            : "bg-slate-50 text-slate-400"
                                        }`}
                                      >
                                        {section.tasks.length}
                                      </span>
                                      <svg
                                        className={`h-4 w-4 shrink-0 text-slate-400 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
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
                                    </span>
                                  </button>
                                  {expanded && (
                                    <ul className="mt-2 space-y-1.5 pl-0.5">
                                      {section.tasks.length === 0 ? (
                                        <li className="rounded-xl px-3 py-2 text-[12px] text-gray-400">
                                          No tasks in this list
                                        </li>
                                      ) : (
                                        section.tasks.map((task) => {
                                          const inSession =
                                            focusSessionKeySet.has(
                                              `${section.listId}:${task.id}`,
                                            );
                                          return (
                                            <li
                                              key={`${section.listId}-${task.id}`}
                                            >
                                              <div className="group flex items-start gap-3 rounded-[14px] border border-gray-100/90 bg-white px-3 py-2.5 shadow-[0_1px_0_rgba(15,23,42,0.04)] transition hover:border-gray-200 hover:bg-slate-50/80">
                                                <button
                                                  type="button"
                                                  disabled={inSession}
                                                  onClick={() =>
                                                    addTaskToFocusSession(
                                                      section.listId,
                                                      task.id,
                                                    )
                                                  }
                                                  className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-2 transition-all ${
                                                    inSession
                                                      ? "border-emerald-500 bg-emerald-500 text-white shadow-[0_2px_6px_rgba(16,185,129,0.35)]"
                                                      : "border-slate-300/90 bg-white shadow-sm hover:border-sky-400 hover:shadow-md"
                                                  } disabled:cursor-default`}
                                                  aria-label={
                                                    inSession
                                                      ? "Already in session"
                                                      : "Add to focus session"
                                                  }
                                                >
                                                  {inSession ? (
                                                    <svg
                                                      className="h-2.5 w-2.5"
                                                      viewBox="0 0 24 24"
                                                      fill="none"
                                                      stroke="currentColor"
                                                      strokeWidth="3"
                                                      strokeLinecap="round"
                                                      strokeLinejoin="round"
                                                      aria-hidden
                                                    >
                                                      <path d="M20 6L9 17l-5-5" />
                                                    </svg>
                                                  ) : null}
                                                </button>
                                                <span className="min-w-0 flex-1 pt-0.5 text-[13px] leading-snug text-gray-800">
                                                  {task.text}
                                                </span>
                                              </div>
                                            </li>
                                          );
                                        })
                                      )}
                                    </ul>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

          </div>

          {isAddListModalOpen && (
            <div
              className="fixed inset-0 z-[600] flex items-center justify-center p-4 sm:p-6 bg-black/65 backdrop-blur-[1px]"
              role="dialog"
              aria-modal="true"
              aria-labelledby="add-list-title"
              onClick={() => {
                setIsAddListModalOpen(false);
                setNewListName("");
              }}
            >
              <div
                className="w-full max-w-[720px] rounded-2xl overflow-hidden shadow-2xl flex flex-col sm:flex-row border border-zinc-700/60 bg-[#2d2d2d]"
                onClick={(e) => e.stopPropagation()}
              >
                {/* Left: form (TickTick Add List) */}
                <div className="flex-1 min-w-0 p-6 sm:p-8 flex flex-col gap-6">
                  <h2
                    id="add-list-title"
                    className="text-lg font-semibold text-zinc-100 tracking-tight"
                  >
                    Add List
                  </h2>

                  <div>
                    <div className="flex items-stretch rounded-lg overflow-hidden border border-zinc-600/80 bg-[#1f1f1f] focus-within:border-blue-500/70 transition-colors">
                      <span className="pl-3 pr-1 flex items-center text-zinc-500 text-lg select-none">
                        ≡
                      </span>
                      <input
                        autoFocus
                        value={newListName}
                        onChange={(e) => setNewListName(e.target.value)}
                        placeholder="Name"
                        className="flex-1 min-w-0 py-3 pr-3 bg-transparent text-[15px] text-zinc-100 placeholder:text-zinc-500 outline-none"
                      />
                    </div>
                  </div>

                  <div>
                    <p className="text-[13px] text-zinc-400 mb-3">List Color</p>
                    <div className="flex flex-wrap items-center gap-2.5">
                      {LIST_COLOR_SWATCHES.map((c, i) => {
                        const selected = newListColor === c;
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setNewListColor(c)}
                            className={`w-7 h-7 rounded-full flex items-center justify-center transition-transform hover:scale-105 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/80 ${
                              c === null
                                ? "border-2 border-dashed border-zinc-500 bg-[#1a1a1a]"
                                : "border-2 border-transparent"
                            } ${selected ? "ring-2 ring-offset-2 ring-offset-[#2d2d2d] ring-blue-500" : ""}`}
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
                              <span className="text-zinc-500 text-xs">—</span>
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
                      className="text-[14px] text-zinc-400 hover:text-zinc-200 transition-colors py-2"
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
                      className="ml-auto rounded-full px-8 py-2.5 text-[14px] font-semibold text-white disabled:opacity-40 disabled:cursor-not-allowed transition-opacity hover:opacity-95"
                      style={{ backgroundColor: TT_ACCENT_BLUE }}
                    >
                      Add
                    </button>
                  </div>
                </div>

                {/* Right: live preview */}
                <div className="w-full sm:w-[300px] shrink-0 border-t sm:border-t-0 sm:border-l border-zinc-800 bg-[#1a1a1a] p-6 flex flex-col relative">
                  <button
                    type="button"
                    onClick={() => {
                      setIsAddListModalOpen(false);
                      setNewListName("");
                    }}
                    className="absolute top-4 right-4 w-8 h-8 rounded-lg text-zinc-500 hover:text-zinc-200 hover:bg-white/5 flex items-center justify-center transition-colors"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                  <div className="mt-6 flex-1 flex flex-col rounded-xl border border-zinc-800/80 bg-[#141414] overflow-hidden">
                    <div className="px-4 py-3 border-b border-zinc-800/80 flex items-center gap-2">
                      <span className="text-zinc-500">{DEFAULT_LIST_ICON}</span>
                      <span className="text-[15px] text-zinc-100 font-medium truncate">
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
                          className="flex items-center gap-2.5 rounded-lg px-2 py-2 bg-[#1c1c1c]/80"
                        >
                          <span className="w-[18px] h-[18px] rounded-full border-2 border-zinc-600 shrink-0" />
                          <span className="text-[13px] text-zinc-400 truncate">
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

          {!isSimulation && focusSessionDialog?.kind === "quit" && (
            <div
              className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]"
              onClick={() => setFocusSessionDialog(null)}
              role="presentation"
            >
              <div
                className="w-full max-w-[400px] rounded-2xl overflow-hidden shadow-2xl border border-zinc-700/60 bg-[#2d2d2d] p-6"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="focus-quit-title"
              >
                <h3
                  id="focus-quit-title"
                  className="text-lg font-semibold text-zinc-100 mb-2"
                >
                  Quit Session?
                </h3>
                <p className="text-sm text-zinc-400 mb-6">
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
                    className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-300 hover:bg-white/5 transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusSessionDialog(null)}
                    className="px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20"
                  >
                    No
                  </button>
                </div>
              </div>
            </div>
          )}

          {!isSimulation && focusSessionDialog?.kind === "reset" && (
            <div
              className="fixed inset-0 z-[700] flex items-center justify-center p-4 bg-black/55 backdrop-blur-[2px]"
              onClick={() => setFocusSessionDialog(null)}
              role="presentation"
            >
              <div
                className="w-full max-w-[400px] rounded-2xl overflow-hidden shadow-2xl border border-zinc-700/60 bg-[#2d2d2d] p-6"
                onClick={(e) => e.stopPropagation()}
                role="dialog"
                aria-modal="true"
                aria-labelledby="focus-reset-title"
              >
                <h3
                  id="focus-reset-title"
                  className="text-lg font-semibold text-zinc-100 mb-2"
                >
                  Reset Session?
                </h3>
                <p className="text-sm text-zinc-400 mb-6">
                  Restart the timer and integrity tracking from the beginning.
                </p>
                <div className="flex items-center justify-end gap-3">
                  <button
                    type="button"
                    onClick={handleResetSessionConfirm}
                    className="px-4 py-2 rounded-xl text-sm font-medium text-zinc-300 hover:bg-white/5 transition-colors"
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setFocusSessionDialog(null)}
                    className="px-5 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-500 transition-colors shadow-lg shadow-blue-500/20"
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
                background:
                  "radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 30%), rgba(59, 130, 246, 0.14), transparent 40%)",
                transition: "background 0.18s ease-out",
              }}
            />
            <div className="mx-auto max-w-6xl grid grid-cols-1 gap-16 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
              {/* Left: Hero copy + feature sections (full width on mobile) */}
              <div className="space-y-16 w-full max-w-xl">
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-blue-600">
                  Productivity App
                </p>
                <div className="space-y-4 animate-fade-in">
                  <h1 className="text-3xl md:text-5xl font-semibold tracking-tight leading-tight text-gray-900">
                    {heroVariant.lines.length === 1 ? (
                      heroVariant.lines[0]
                    ) : (
                      <>
                        <span className="block">{heroVariant.lines[0]}</span>
                        <span className="block">{heroVariant.lines[1]}</span>
                      </>
                    )}
                  </h1>
                  <p className="text-base md:text-lg text-gray-700 leading-relaxed mt-1 max-w-xl">
                    Tunnel Vision{" "}
                    <span className="font-semibold bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">
                      times your tasks
                    </span>{" "}
                    and{" "}
                    <span className="font-semibold bg-gradient-to-r from-blue-600 to-indigo-500 bg-clip-text text-transparent">
                      measures your focus
                    </span>{" "}
                    so you can take accountability.
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 pt-2">
                  <button
                    type="button"
                    onClick={handleGetStarted}
                    className="group relative px-14 py-5 bg-blue-600 rounded-full overflow-hidden transition-all duration-500 hover:scale-110 active:scale-95 shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-breathing"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                    <span className="relative text-white font-black tracking-[0.3em] text-xs uppercase">
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
                    className="flex flex-col items-center gap-1 text-gray-400 hover:text-gray-600 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 rounded-full p-2"
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
                  <div className="rounded-3xl border border-gray-200 bg-white shadow-xl p-4 md:p-6">
                    <div className="flex items-center justify-between mb-4 px-1">
                      <div className="flex gap-1.5">
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                      </div>
                      <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
                        Tunnel Vision · Demo
                      </span>
                      <span className="w-8" />
                    </div>
                    <div className="h-[440px] overflow-hidden rounded-2xl bg-gray-100 border border-gray-200">
                      <div className="w-full px-5 py-5 space-y-4">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-xs uppercase tracking-[0.25em] text-blue-600">
                              Today
                            </p>
                            <h3 className="text-2xl font-semibold tracking-tight text-gray-900">
                              Hello <span className="text-blue-600">Alex</span>.
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">
                              Ready to beat yesterday?
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-gray-500">
                              Streak
                            </p>
                            <p className="text-xl font-mono font-bold text-gray-900">
                              3
                              <span className="text-[10px] text-gray-500 ml-1">
                                days
                              </span>
                            </p>
                          </div>
                        </div>
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 items-start">
                          <div className="relative flex items-center justify-center">
                            <div className="w-24 h-24 rounded-2xl bg-white border border-gray-200 flex items-center justify-center shadow-md">
                              <span className="font-mono text-lg text-gray-900">
                                {String(Math.floor(demoSeconds / 60)).padStart(
                                  2,
                                  "0",
                                )}
                                :{String(demoSeconds % 60).padStart(2, "0")}
                              </span>
                            </div>
                          </div>
                          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                            <div className="flex gap-2 p-2 border-b border-gray-100">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-[12px] text-gray-500 font-sans">
                                {demoInputText ? (
                                  <>
                                    <span className="text-gray-700">
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
                              <div className="px-3 py-2 rounded-xl bg-gray-900 text-[11px] font-semibold text-white shadow-sm">
                                Add
                              </div>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {demoTasks.map((task, index) => (
                                <div
                                  key={`mobile-${task}`}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-blue-50/80 text-gray-900"
                                      : "text-gray-700"
                                  }`}
                                >
                                  <span className="tracking-tight">{task}</span>
                                  <span className="w-4 h-4 rounded-md border border-gray-300 bg-white flex-shrink-0" />
                                </div>
                              ))}
                              {demoTasks.length === 0 && (
                                <div className="px-3 py-4 text-center text-[12px] text-gray-400 font-sans">
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
                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900">
                      Step 1
                    </h2>
                    <p className="text-lg md:text-xl text-gray-600 leading-relaxed max-w-xl">
                      Brain dump tasks like emails, meetings, homework, or
                      chores. Start a timer and see if you can PR.
                    </p>
                    {/* Mobile: static Step 1 preview */}
                    <div className="lg:hidden w-full max-w-[520px] mt-8 rounded-3xl border border-gray-200 bg-white shadow-xl p-4 overflow-hidden">
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
                          Tunnel Vision
                        </span>
                        <span className="w-8" />
                      </div>
                      <div className="rounded-2xl bg-gray-100 border border-gray-200 p-4 space-y-4">
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 items-start">
                          <div className="w-24 h-24 rounded-2xl bg-white border border-gray-200 flex items-center justify-center shadow-md">
                            <span className="font-mono text-lg text-gray-900">
                              25:00
                            </span>
                          </div>
                          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                            <div className="flex gap-2 p-2 border-b border-gray-100">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-[12px] text-gray-500 font-sans">
                                Add task...
                              </div>
                              <div className="px-3 py-2 rounded-xl bg-gray-900 text-[11px] font-semibold text-white shadow-sm">
                                Add
                              </div>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {[
                                "calculus homework",
                                "take bins down",
                                "Read Ch20 Of Mice and Men",
                              ].map((task, index) => (
                                <div
                                  key={task}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-blue-50/80 text-gray-900"
                                      : "text-gray-700"
                                  }`}
                                >
                                  <span className="tracking-tight">{task}</span>
                                  <span className="w-4 h-4 rounded-md border border-gray-300 bg-white flex-shrink-0" />
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
                    <p className="text-lg md:text-xl font-semibold tracking-[0.2em] uppercase text-blue-600">
                      Make improvement a priority.
                    </p>
                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-gray-900">
                      Step 2
                    </h2>
                    <p className="text-lg md:text-xl text-gray-600 leading-relaxed max-w-xl">
                      Use Tunnel Vision's graphs to view your productivity over
                      weeks and set goals for yourself in the future.
                    </p>
                    {/* Mobile: static Step 2 preview (focus mode) */}
                    <div className="lg:hidden w-full max-w-[520px] mt-8 rounded-3xl border border-gray-200 bg-white shadow-xl p-4 overflow-hidden">
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex gap-1.5">
                          <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                          <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                        </div>
                        <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
                          Tunnel Vision
                        </span>
                        <span className="w-8" />
                      </div>
                      <div className="rounded-2xl bg-gray-100 border border-gray-200 p-4">
                        <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500 mb-3">
                          Focus mode · Live
                        </div>
                        <div className="rounded-[32px] bg-gradient-to-b from-blue-50 to-white border border-blue-200 shadow-lg px-6 py-8 space-y-4">
                          <div className="flex flex-col items-center gap-1">
                            <div className="text-[10px] uppercase tracking-[0.3em] text-blue-600">
                              Deep work session
                            </div>
                            <div className="text-4xl font-mono tracking-tight text-gray-900">
                              24:32
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-blue-600">
                              Focus integrity: 96.4%
                            </div>
                          </div>
                          <div className="divide-y divide-gray-100 rounded-2xl bg-white border border-gray-200 overflow-hidden">
                            {[
                              "calculus homework",
                              "take bins down",
                              "Read Ch20 Of Mice and Men",
                            ].map((task, index) => (
                              <div
                                key={task}
                                className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                  index === 0
                                    ? "bg-blue-50 text-gray-900"
                                    : "text-gray-700"
                                }`}
                              >
                                <div className="flex items-center gap-2.5">
                                  <span
                                    className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                      index === 0
                                        ? "bg-blue-500"
                                        : "bg-gray-400"
                                    }`}
                                  />
                                  <span className="tracking-tight">{task}</span>
                                </div>
                                <span className="w-4 h-4 rounded-md border border-gray-300 bg-white flex-shrink-0" />
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
                <div className="w-full max-w-[520px] rounded-3xl border border-gray-200 bg-white shadow-xl p-4 md:p-6">
                  <div className="flex items-center justify-between mb-4 px-1">
                    <div className="flex gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
                    </div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-gray-500">
                      Tunnel Vision · Demo
                    </span>
                    <span className="w-8" />
                  </div>

                  {/* Scrollable simulated app */}
                  <div
                    ref={previewScrollRef}
                    className="h-[440px] overflow-hidden rounded-2xl bg-gray-100 border border-gray-200"
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
                            <p className="text-xs uppercase tracking-[0.25em] text-blue-600">
                              Today
                            </p>
                            <h3 className="text-2xl font-semibold tracking-tight text-gray-900">
                              Hello <span className="text-blue-600">Alex</span>.
                            </h3>
                            <p className="text-xs text-gray-500 mt-1">
                              Ready to beat yesterday?
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-gray-500">
                              Streak
                            </p>
                            <p className="text-xl font-mono font-bold text-gray-900">
                              3
                              <span className="text-[10px] text-gray-500 ml-1">
                                days
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Demo timer + tasks card (Todoist-style list) */}
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 items-start">
                          <div className="relative flex items-center justify-center">
                            <div className="w-24 h-24 rounded-2xl bg-white border border-gray-200 flex items-center justify-center shadow-md">
                              <span className="font-mono text-lg text-gray-900">
                                {String(Math.floor(demoSeconds / 60)).padStart(
                                  2,
                                  "0",
                                )}
                                :{String(demoSeconds % 60).padStart(2, "0")}
                              </span>
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white border border-gray-200 shadow-sm overflow-hidden">
                            <div className="flex gap-2 p-2 border-b border-gray-100">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-[12px] text-gray-500 font-sans">
                                {demoInputText ? (
                                  <>
                                    <span className="text-gray-700">
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
                              <div className="px-3 py-2 rounded-xl bg-gray-900 text-[11px] font-semibold text-white shadow-sm">
                                Add
                              </div>
                            </div>
                            <div className="divide-y divide-gray-100">
                              {demoTasks.map((task, index) => (
                                <div
                                  key={task}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-blue-50/80 text-gray-900"
                                      : "text-gray-700"
                                  }`}
                                >
                                  <span className="tracking-tight">{task}</span>
                                  <span className="w-4 h-4 rounded-md border border-gray-300 bg-white flex-shrink-0" />
                                </div>
                              ))}
                              {demoTasks.length === 0 && (
                                <div className="px-3 py-4 text-center text-[12px] text-gray-400 font-sans">
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
                        <div className="text-[10px] uppercase tracking-[0.3em] text-gray-500">
                          Focus mode · Live
                        </div>
                        <div className="rounded-[32px] bg-gradient-to-b from-blue-50 to-white border border-blue-200 shadow-lg px-8 py-10 space-y-6">
                          <div className="flex flex-col items-center gap-2">
                            <div className="text-[10px] uppercase tracking-[0.3em] text-blue-600">
                              Deep work session
                            </div>
                            <div className="text-5xl md:text-6xl font-mono tracking-tight text-gray-900">
                              {String(Math.floor(demoSeconds / 60)).padStart(
                                2,
                                "0",
                              )}
                              :{String(demoSeconds % 60).padStart(2, "0")}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-blue-600">
                              Focus integrity: 96.4%
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-white border border-gray-200 text-[12px] text-gray-500 font-sans">
                                {demoInputText ? (
                                  <>
                                    <span className="text-gray-700">
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
                              <button className="px-4 py-2 rounded-xl bg-gray-900 text-[11px] font-semibold text-white shadow-sm">
                                Add
                              </button>
                            </div>
                            <div className="divide-y divide-gray-100 rounded-2xl bg-white border border-gray-200 overflow-hidden shadow-sm">
                              {demoTasks.map((task, index) => (
                                <div
                                  key={`focus-${task}`}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-blue-50 text-gray-900"
                                      : "text-gray-700"
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                        index === 0
                                          ? "bg-blue-500"
                                          : "bg-gray-400"
                                      }`}
                                    />
                                    <span className="tracking-tight">
                                      {task}
                                    </span>
                                  </div>
                                  <span className="w-4 h-4 rounded-md border border-gray-300 bg-white flex-shrink-0" />
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
                          <h3 className="text-xs uppercase tracking-[0.3em] text-gray-500">
                            Performance dashboard
                          </h3>
                          <span className="text-[10px] text-blue-600 uppercase tracking-[0.2em]">
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
                              className="rounded-2xl bg-white border border-gray-200 px-3 py-3 space-y-1"
                            >
                              <p className="text-[9px] uppercase tracking-[0.2em] text-gray-500">
                                {label}
                              </p>
                              <p className="text-sm font-mono font-bold text-gray-900">
                                {value}
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-3xl bg-white border border-gray-200 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-gray-500">
                              Discipline log
                            </p>
                            <span className="text-[10px] text-blue-600 uppercase tracking-[0.2em]">
                              Month view
                            </span>
                          </div>
                          <div className="grid grid-cols-7 gap-1">
                            {Array.from({ length: 21 }).map((_, i) => (
                              <div
                                key={i}
                                className={`aspect-square rounded-md border border-gray-200 ${
                                  i % 5 === 0
                                    ? "bg-blue-500"
                                    : i % 3 === 0
                                      ? "bg-blue-300"
                                      : "bg-gray-100"
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-3xl bg-white border border-gray-200 p-4 space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.25em] text-gray-500">
                            Focus integrity trend
                          </p>
                          <div className="h-24 rounded-2xl bg-gradient-to-tr from-blue-200 via-blue-100 to-transparent border border-blue-200 relative overflow-hidden">
                            <div className="absolute inset-x-6 bottom-3 h-12 border-t border-gray-200" />
                            <div className="absolute inset-3">
                              <div className="h-full w-full rounded-xl border border-gray-200 bg-white/60" />
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
          <div className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 backdrop-blur-sm">
            <div className="workmode-modal-enter w-full max-w-md mx-4 rounded-3xl bg-white/90 border border-gray-200 shadow-[0_24px_60px_rgba(15,23,42,0.45)] p-6">
              <div className="mb-4">
                <p className="text-[10px] uppercase tracking-[0.3em] text-blue-600 mb-2">
                  Working Mode
                </p>
                <h2 className="text-xl font-semibold tracking-tight text-gray-900">
                  How will you work on this task?
                </h2>
                <p className="mt-2 text-sm text-gray-500">
                  Choose where you&apos;ll focus so Tunnel Vision can score your
                  integrity fairly.
                </p>
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button
                  type="button"
                  onClick={() => {
                    if (pendingWorkModeTaskId == null) {
                      setIsWorkModeModalOpen(false);
                      return;
                    }
                    setTasks((prev) =>
                      prev.map((t) =>
                        t.id === pendingWorkModeTaskId
                          ? { ...t, workMode: "inside" }
                          : t,
                      ),
                    );
                    setPendingWorkModeTaskId(null);
                    setIsWorkModeModalOpen(false);
                  }}
                  className="group relative flex flex-col items-start gap-1 rounded-2xl border border-blue-500/70 bg-gradient-to-br from-blue-600 via-blue-500 to-blue-700 px-4 py-3 text-left text-sm font-medium text-white shadow-[0_18px_40px_rgba(37,99,235,0.55)] transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-[0_22px_55px_rgba(37,99,235,0.7)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  <span className="text-[11px] uppercase tracking-[0.22em] opacity-70">
                    Recommended
                  </span>
                  <span className="text-sm font-semibold">
                    Work inside Tunnel Vision
                  </span>
                  <span className="text-[11px] text-blue-100/90">
                    Stay in this tab. Leaving will lower focus integrity.
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (pendingWorkModeTaskId == null) {
                      setIsWorkModeModalOpen(false);
                      return;
                    }
                    setTasks((prev) =>
                      prev.map((t) =>
                        t.id === pendingWorkModeTaskId
                          ? { ...t, workMode: "external" }
                          : t,
                      ),
                    );
                    setPendingWorkModeTaskId(null);
                    setIsWorkModeModalOpen(false);
                  }}
                  className="group flex flex-col items-start gap-1 rounded-2xl border border-gray-200 bg-white px-4 py-3 text-left text-sm font-medium text-gray-900 shadow-[0_18px_40px_rgba(15,23,42,0.18)] transition-transform duration-150 hover:-translate-y-0.5 hover:shadow-[0_22px_55px_rgba(15,23,42,0.26)] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 focus-visible:ring-offset-2 focus-visible:ring-offset-white"
                >
                  <span className="text-[11px] uppercase tracking-[0.22em] text-gray-400">
                    Flexible
                  </span>
                  <span className="text-sm font-semibold">
                    Work in another tab/app
                  </span>
                  <span className="text-[11px] text-gray-500">
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
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-blue-600">
                  Performance
                </p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">
                  Track your task performance.
                </h2>
                <p className="text-sm md:text-base text-gray-600 max-w-2xl leading-relaxed">
                  Use Tunnel Vision to bring out your competitive edge. How many
                  tasks can you complete before the timer runs out?
                </p>
                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="group relative mt-4 px-14 py-5 bg-blue-600 rounded-full overflow-hidden transition-all duration-500 hover:scale-110 active:scale-95 shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-breathing"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                  <span className="relative text-white font-black tracking-[0.3em] text-xs uppercase">
                    Get started
                  </span>
                </button>
              </div>

              <div
                ref={habitRef}
                className="space-y-6 text-left pt-12 min-h-[130vh] flex flex-col justify-center"
              >
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-blue-600">
                  Habit Building
                </p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">
                  Fix your habits before it's too late.
                </h2>
                <p className="text-sm md:text-base text-gray-600 max-w-2xl leading-relaxed">
                  Tunnel Vision should become your go-to task manager. Brain
                  dump all your tasks right as you get home and hit deadlines
                  without breaking a sweat.
                </p>
                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="group relative mt-4 px-14 py-5 bg-blue-600 rounded-full overflow-hidden transition-all duration-500 hover:scale-110 active:scale-95 shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-breathing"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                  <span className="relative text-white font-black tracking-[0.3em] text-xs uppercase">
                    Get started
                  </span>
                </button>
              </div>

              <div
                ref={timeRef}
                className="space-y-6 text-left pt-12 min-h-[130vh] flex flex-col justify-center"
              >
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-blue-600">
                  Time Management
                </p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight text-gray-900">
                  Own your schedule.
                </h2>
                <p className="text-sm md:text-base text-gray-600 max-w-2xl leading-relaxed">
                  Organize your tasks between most urgent and least urgent.
                </p>
                <button
                  type="button"
                  onClick={handleGetStarted}
                  className="group relative mt-4 px-14 py-5 bg-blue-600 rounded-full overflow-hidden transition-all duration-500 hover:scale-110 active:scale-95 shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-breathing"
                >
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                  <span className="relative text-white font-black tracking-[0.3em] text-xs uppercase">
                    Get started
                  </span>
                </button>
              </div>
            </div>
          </section>
        )}

        <style>{`
html { scroll-behavior: smooth; }
@keyframes glitch { 0% { transform: translate(0); } }
@keyframes breathing { 0% { opacity: 0.6; } 50% { opacity: 1; } 100% { opacity: 0.6; } }
@keyframes reflection-in { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
.animate-reflection-in { animation: reflection-in 0.5s ease-out forwards; }
.animate-glitch { animation: glitch 0.6s infinite; }
.animate-breathing { animation: breathing 3s ease-in-out infinite; }
::-webkit-scrollbar { width: 6px; }
`}</style>
      </div>
    </>
  );
}
