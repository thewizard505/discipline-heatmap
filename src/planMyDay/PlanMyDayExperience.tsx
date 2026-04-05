import React, { useCallback, useEffect, useRef, useState } from "react";
import type { PlanMyDayResult, PlanMyDayPick, TaskLite } from "./engine";
import {
  buildTodayPlan,
  findCriticalEstimateQuestion,
} from "./engine";
import { loadFlowSessionAnswers, saveFlowSessionAnswers } from "./sessionAnswers";

const THINKING_LABELS = [
  "Understanding your tasks…",
  "Balancing priorities…",
  "Optimizing your time…",
] as const;

const HOUR_CHOICES = [2, 4, 6, 8] as const;

function formatLineMinutes(minutes: number): string {
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}

type Props = {
  intent: number;
  picks: PlanMyDayPick[];
  tasksByTaskId: Map<number, TaskLite>;
};

export function PlanMyDayExperience({
  intent,
  picks,
  tasksByTaskId,
}: Props) {
  const [thinking, setThinking] = useState(false);
  const [labelIdx, setLabelIdx] = useState(0);
  const [modal, setModal] = useState<"hours" | "estimate" | null>(null);
  const [estimateTitle, setEstimateTitle] = useState("");
  const [estimateInput, setEstimateInput] = useState("");
  const [result, setResult] = useState<PlanMyDayResult | null>(null);

  const sessionRef = useRef(loadFlowSessionAnswers());
  const flowStartRef = useRef(0);
  const picksRef = useRef(picks);
  picksRef.current = picks;

  const finalizeRef = useRef<() => void>(() => {});
  const tieBreakRef = useRef(0.37);

  const runFinalize = useCallback(() => {
    const start = flowStartRef.current;
    const elapsed = Date.now() - start;
    const wait = Math.max(0, 2000 - elapsed);
    window.setTimeout(() => {
      setThinking(false);
      setModal(null);
      const s = sessionRef.current;
      saveFlowSessionAnswers(s);
      const plan = buildTodayPlan(picksRef.current, tasksByTaskId, s, {
        tieSeed: tieBreakRef.current,
      });
      setResult(plan);
    }, wait);
  }, [tasksByTaskId]);

  finalizeRef.current = runFinalize;

  const openNextModalOrFinish = useCallback(() => {
    const s = sessionRef.current;
    const crit = findCriticalEstimateQuestion(
      picksRef.current,
      tasksByTaskId,
      s,
    );
    if (crit) {
      setEstimateTitle(crit.pick.displayTitle);
      setEstimateInput("");
      setModal("estimate");
    } else {
      finalizeRef.current();
    }
  }, [tasksByTaskId]);

  useEffect(() => {
    if (intent <= 0) return;
    flowStartRef.current = Date.now();
    tieBreakRef.current = (intent * 0.09417 + 0.31) % 1;
    sessionRef.current = loadFlowSessionAnswers();
    setThinking(true);
    setResult(null);
    setModal(null);
    setLabelIdx(0);

    const t400 = window.setTimeout(() => {
      if (picksRef.current.length === 0) {
        finalizeRef.current();
        return;
      }
      const s = sessionRef.current;
      if (s.workHours == null) {
        setModal("hours");
        return;
      }
      openNextModalOrFinish();
    }, 400);

    return () => window.clearTimeout(t400);
  }, [intent, openNextModalOrFinish]);

  useEffect(() => {
    if (!thinking) return;
    const id = window.setInterval(() => {
      setLabelIdx((i) => (i + 1) % THINKING_LABELS.length);
    }, 600);
    return () => window.clearInterval(id);
  }, [thinking]);

  const onPickHours = (h: number) => {
    sessionRef.current = {
      ...sessionRef.current,
      workHours: h,
    };
    saveFlowSessionAnswers(sessionRef.current);
    setModal(null);
    openNextModalOrFinish();
  };

  const onSubmitEstimate = () => {
    const raw = parseInt(estimateInput, 10);
    const m = Number.isFinite(raw) ? Math.min(240, Math.max(5, raw)) : 25;
    const crit = findCriticalEstimateQuestion(
      picksRef.current,
      tasksByTaskId,
      sessionRef.current,
    );
    if (crit) {
      sessionRef.current = {
        ...sessionRef.current,
        taskEstimates: {
          ...sessionRef.current.taskEstimates,
          [crit.pick.taskId]: m,
        },
      };
      saveFlowSessionAnswers(sessionRef.current);
    }
    setModal(null);
    finalizeRef.current();
  };

  const onRegenerate = () => {
    tieBreakRef.current = (tieBreakRef.current + 0.2718) % 1;
    const plan = buildTodayPlan(picks, tasksByTaskId, sessionRef.current, {
      tieSeed: tieBreakRef.current,
    });
    setResult(plan);
  };

  const showCard = result && !thinking;

  const overlay = thinking || modal != null;

  return (
    <>
      {overlay ? (
        <div
          className="fixed inset-0 z-[200] flex items-center justify-center p-6"
          role="presentation"
        >
          <div
            className="absolute inset-0 bg-white/55 backdrop-blur-[10px]"
            aria-hidden
          />
          {thinking && !modal ? (
            <div className="relative flex flex-col items-center gap-6 text-center">
              <div className="relative flex h-[72px] w-[72px] items-center justify-center">
                <div className="absolute inset-0 animate-ping rounded-full bg-[#c4b5fd]/25" />
                <div className="absolute inset-2 animate-pulse rounded-full bg-[#ddd6fe]/40 blur-md" />
                <svg
                  className="relative h-9 w-9 text-[#a78bfa]"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  aria-hidden
                >
                  <path d="M12 2l1.09 3.26L16 6l-2.91 1.74L12 11l-1.09-3.26L8 6l2.91-1.74L12 2zM5 13l.84 2.5L8.5 16 6.84 17.5 5 20l-.84-2.5L1.5 16l2.66-1.5L5 13zm14 0l.84 2.5L22.5 16l-2.66 1.5L19 20l-.84-2.5L15.5 16l2.66-1.5L19 13z" />
                </svg>
              </div>
              <p className="max-w-[260px] text-[15px] font-medium tracking-tight text-[#52525b]">
                {THINKING_LABELS[labelIdx]}
              </p>
            </div>
          ) : null}

          {modal === "hours" ? (
            <div
              className="relative w-full max-w-[300px] rounded-2xl border border-[#e7e5e4] bg-white/95 p-5 shadow-xl shadow-stone-200/40"
              role="dialog"
              aria-modal="true"
              aria-labelledby="pmd-hours-title"
            >
              <p
                id="pmd-hours-title"
                className="text-[15px] font-semibold text-[#1c1917]"
              >
                How many hours can you work today?
              </p>
              <div className="mt-4 grid grid-cols-2 gap-2">
                {HOUR_CHOICES.map((h) => (
                  <button
                    key={h}
                    type="button"
                    onClick={() => onPickHours(h)}
                    className="rounded-xl bg-[#fafaf9] py-2.5 text-[15px] font-medium text-[#44403c] transition hover:bg-[#f5f5f4] active:scale-[0.98]"
                  >
                    {h}h
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {modal === "estimate" ? (
            <div
              className="relative w-full max-w-[300px] rounded-2xl border border-[#e7e5e4] bg-white/95 p-5 shadow-xl shadow-stone-200/40"
              role="dialog"
              aria-modal="true"
            >
              <p className="text-[14px] leading-snug text-[#57534e]">
                How long will{" "}
                <span className="font-semibold text-[#1c1917]">
                  {estimateTitle || "this task"}
                </span>{" "}
                take?
              </p>
              <div className="mt-4 flex gap-2">
                <input
                  type="number"
                  min={5}
                  max={240}
                  step={5}
                  value={estimateInput}
                  onChange={(e) => setEstimateInput(e.target.value)}
                  placeholder="min"
                  className="min-w-0 flex-1 rounded-xl border border-[#e7e5e4] bg-white px-3 py-2.5 text-[16px] text-[#1c1917] outline-none ring-0 focus:border-[#a78bfa]"
                  autoFocus
                />
                <button
                  type="button"
                  onClick={onSubmitEstimate}
                  className="rounded-xl bg-[#1c1917] px-4 py-2.5 text-[14px] font-semibold text-white transition hover:bg-[#292524] active:scale-[0.98]"
                >
                  OK
                </button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      {showCard && result ? (
        <PlanResultCard result={result} onRegenerate={onRegenerate} />
      ) : null}

    </>
  );
}

function PlanResultCard({
  result,
  onRegenerate,
}: {
  result: PlanMyDayResult;
  onRegenerate: () => void;
}) {
  return (
    <div className="mb-4 rounded-2xl border border-[#e7e5e4] bg-white px-5 py-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.12em] text-[#a8a29e]">
          Today&apos;s Focus
        </h2>
        <button
          type="button"
          onClick={onRegenerate}
          className="shrink-0 text-[12px] font-medium text-[#a78bfa] transition hover:text-[#7c3aed]"
        >
          Regenerate
        </button>
      </div>
      {result.focus.length === 0 ? (
        <p className="mt-3 text-[14px] text-[#78716c]">Nothing on your list yet.</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {result.focus.map((line, i) => (
            <li
              key={`${line.taskId}-${i}`}
              className="flex items-baseline justify-between gap-3 text-[15px] text-[#1c1917]"
            >
              <span className="min-w-0 font-medium leading-snug">{line.title}</span>
              <span className="shrink-0 tabular-nums text-[14px] text-[#78716c]">
                {formatLineMinutes(line.minutes)}
              </span>
            </li>
          ))}
        </ol>
      )}
      {result.extra.length > 0 ? (
        <div className="mt-6 border-t border-[#f5f5f4] pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-[0.1em] text-[#a8a29e]">
            If extra time
          </p>
          <ul className="mt-2 space-y-1.5 text-[13px] text-[#57534e]">
            {result.extra.slice(0, 4).map((line) => (
              <li key={line.taskId} className="flex justify-between gap-2">
                <span className="min-w-0 truncate">{line.title}</span>
                <span className="shrink-0 tabular-nums text-[#a8a29e]">
                  {formatLineMinutes(line.minutes)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <p className="mt-5 text-[12px] text-[#a8a29e]">Avoid: multitasking</p>
    </div>
  );
}
