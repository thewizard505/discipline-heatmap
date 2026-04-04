import React, { useCallback, useMemo, useState } from "react";
import type {
  EnergyLevel,
  FocusLevel,
  FocusPlanAdaptiveAnswers,
  FocusPlanBaseInput,
  FocusPlanUserInput,
  GeneratedFocusPlan,
} from "./types";
import {
  generateFocusPlan,
  getRequiredAdaptiveFields,
  prependUserAnchorTasks,
} from "./engine";

function splitList(s: string): string[] {
  return s
    .split(/[,;\n]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

const ENERGY_OPTS: EnergyLevel[] = ["low", "medium", "high"];
const FOCUS_OPTS: FocusLevel[] = ["low", "medium", "high"];

type Phase = "base" | "adaptive" | "plan";

export function FocusForTodayPlanner() {
  const [phase, setPhase] = useState<Phase>("base");
  const [base, setBase] = useState<FocusPlanBaseInput>({
    timeAvailable: 4,
    energy: "medium",
    focusLevel: "medium",
    mainFocus: "",
    priorities: [],
    hasDeadlines: false,
    distractions: [],
  });
  const [prioritiesText, setPrioritiesText] = useState("");
  const [distractionsText, setDistractionsText] = useState("");
  const [adaptive, setAdaptive] = useState<FocusPlanAdaptiveAnswers>({});
  const [plan, setPlan] = useState<GeneratedFocusPlan | null>(null);
  const [variationSeed, setVariationSeed] = useState(0.37);

  const req = useMemo(
    () =>
      getRequiredAdaptiveFields({
        timeAvailable: base.timeAvailable,
        energy: base.energy,
        hasDeadlines: base.hasDeadlines,
        mainFocus: base.mainFocus,
      }),
    [
      base.timeAvailable,
      base.energy,
      base.hasDeadlines,
      base.mainFocus,
    ],
  );

  const buildUserInput = useCallback((): FocusPlanUserInput => {
    return {
      ...base,
      priorities: splitList(prioritiesText),
      distractions: splitList(distractionsText),
      ...adaptive,
    };
  }, [base, prioritiesText, distractionsText, adaptive]);

  const runGenerate = useCallback(
    (seed: number) => {
      const input = buildUserInput();
      let out = generateFocusPlan(input, { variationSeed: seed });
      out = prependUserAnchorTasks(out, input);
      setPlan(out);
      setVariationSeed(out.variationSeed);
    },
    [buildUserInput],
  );

  const onContinueFromBase = () => {
    const next: FocusPlanBaseInput = {
      ...base,
      priorities: splitList(prioritiesText),
      distractions: splitList(distractionsText),
    };
    setBase(next);
    const r = getRequiredAdaptiveFields({
      timeAvailable: next.timeAvailable,
      energy: next.energy,
      hasDeadlines: next.hasDeadlines,
      mainFocus: next.mainFocus,
    });
    const needAdaptive =
      r.needOneMustFinish ||
      r.needDueFirst ||
      r.needDueMinutes ||
      r.needEasyOrBalanced ||
      r.needTennis;
    if (needAdaptive) {
      setPhase("adaptive");
    } else {
      const s = (variationSeed + 0.193) % 1;
      runGenerate(s);
      setPhase("plan");
    }
  };

  const onGenerateFromAdaptive = () => {
    const s = (variationSeed + 0.193) % 1;
    runGenerate(s);
    setPhase("plan");
  };

  const onRegenerate = () => {
    const s = (Math.sin(variationSeed * 12.989) + 1) / 2;
    runGenerate(s);
  };

  const onBackToStart = () => {
    setPhase("base");
    setPlan(null);
    setAdaptive({});
  };

  if (phase === "plan" && plan) {
    return (
      <div className="mb-4 rounded-xl border border-[#E8E4F5] bg-gradient-to-b from-[#FAF8FF] to-white p-5 shadow-sm">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
              Focus for today
            </p>
            <p className="mt-2 text-[20px] font-bold leading-snug tracking-tight text-[#202020] sm:text-[22px]">
              {plan.mainFocus}
            </p>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 sm:mt-0">
            <button
              type="button"
              onClick={onRegenerate}
              className="rounded-lg border border-[#E5E7EB] bg-white px-3 py-1.5 text-[12px] font-medium text-[#6B7280] transition hover:border-[#9d84d8]/50 hover:text-[#5b4a8a]"
            >
              Regenerate wording
            </button>
            <button
              type="button"
              onClick={onBackToStart}
              className="rounded-lg bg-[#9d84d8] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm hover:bg-[#8a6fcc]"
            >
              New inputs
            </button>
          </div>
        </div>

        <div className="mt-5">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
            Priority tasks
          </p>
          <ul className="mt-2 space-y-2">
            {plan.priorityTasks.map((t) => (
              <li
                key={t.id}
                className="flex items-start gap-3 rounded-lg border border-[#F1F5F9] bg-white px-3 py-2.5"
              >
                <span
                  className="mt-0.5 inline-flex h-4 w-4 shrink-0 rounded border border-[#D1D5DB] bg-white"
                  aria-hidden
                />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium text-[#202020]">{t.name}</p>
                  <p className="text-[11px] text-[#9CA3AF]">
                    {t.type} · {t.difficulty}
                    {t.hasDeadline ? " · deadline" : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {plan.stretchTask ? (
          <div className="mt-4 rounded-lg border border-dashed border-[#C4B5E8] bg-[#FAF8FF]/80 px-3 py-2">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9d84d8]">
              Stretch (optional)
            </p>
            <p className="mt-1 text-[13px] text-[#4B5563]">{plan.stretchTask.name}</p>
          </div>
        ) : null}

        <div className="mt-5 rounded-lg bg-[#F9FAFB] px-3 py-2.5 text-[13px] text-[#9CA3AF]">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-[#D1D5DB]">
            Avoid
          </p>
          <p className="mt-1 text-[#6B7280]">{plan.avoid}</p>
        </div>

        <div className="mt-4 border-t border-[#F1F5F9] pt-4">
          <p className="text-[12px] font-semibold text-[#6B7280]">Why this plan works</p>
          <p className="mt-1 text-[13px] leading-relaxed text-[#6B7280]">
            {plan.whyThisPlan}
          </p>
        </div>
      </div>
    );
  }

  if (phase === "adaptive") {
    return (
      <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
          A few follow-ups
        </p>
        <div className="mt-3 space-y-4">
          {req.needOneMustFinish ? (
            <label className="block">
              <span className="text-[13px] font-medium text-[#374151]">
                What is the ONE thing you must finish?
              </span>
              <input
                value={adaptive.oneMustFinish ?? ""}
                onChange={(e) =>
                  setAdaptive((a) => ({ ...a, oneMustFinish: e.target.value }))
                }
                className="mt-1.5 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[14px] text-[#202020] outline-none focus:border-[#9d84d8]/60"
                placeholder="e.g. submit lab report"
              />
            </label>
          ) : null}
          {req.needDueFirst ? (
            <label className="block">
              <span className="text-[13px] font-medium text-[#374151]">
                What is due first?
              </span>
              <input
                value={adaptive.dueFirst ?? ""}
                onChange={(e) =>
                  setAdaptive((a) => ({ ...a, dueFirst: e.target.value }))
                }
                className="mt-1.5 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[14px] outline-none focus:border-[#9d84d8]/60"
              />
            </label>
          ) : null}
          {req.needDueMinutes ? (
            <label className="block">
              <span className="text-[13px] font-medium text-[#374151]">
                Estimated time for that task (minutes)
              </span>
              <input
                type="number"
                min={5}
                step={5}
                value={adaptive.dueFirstMinutes ?? ""}
                onChange={(e) =>
                  setAdaptive((a) => ({
                    ...a,
                    dueFirstMinutes: e.target.value
                      ? Number(e.target.value)
                      : undefined,
                  }))
                }
                className="mt-1.5 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[14px] outline-none focus:border-[#9d84d8]/60"
              />
            </label>
          ) : null}
          {req.needEasyOrBalanced ? (
            <div>
              <p className="text-[13px] font-medium text-[#374151]">
                Do you want an easy or balanced day?
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {(["easy", "balanced"] as const).map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setAdaptive((a) => ({ ...a, easyOrBalanced: opt }))
                    }
                    className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium capitalize transition ${
                      adaptive.easyOrBalanced === opt
                        ? "border-[#9d84d8] bg-[#F5F0FF] text-[#5b4a8a]"
                        : "border-[#E5E7EB] text-[#6B7280] hover:bg-[#FAFAFA]"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {req.needTennis ? (
            <div>
              <p className="text-[13px] font-medium text-[#374151]">
                What do you want to improve?
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {["consistency", "serve", "footwork"].map((opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() =>
                      setAdaptive((a) => ({ ...a, tennisImprove: opt }))
                    }
                    className={`rounded-lg border px-3 py-1.5 text-[13px] font-medium capitalize transition ${
                      adaptive.tennisImprove === opt
                        ? "border-[#9d84d8] bg-[#F5F0FF] text-[#5b4a8a]"
                        : "border-[#E5E7EB] text-[#6B7280] hover:bg-[#FAFAFA]"
                    }`}
                  >
                    {opt}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </div>
        <div className="mt-5 flex flex-wrap justify-between gap-2">
          <button
            type="button"
            onClick={() => setPhase("base")}
            className="rounded-lg px-3 py-1.5 text-[13px] text-[#6B7280] hover:bg-[#FAFAFA]"
          >
            Back
          </button>
          <button
            type="button"
            onClick={onGenerateFromAdaptive}
            className="rounded-lg bg-[#9d84d8] px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-[#8a6fcc]"
          >
            Build my plan
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-[#E5E7EB] bg-white p-4 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-[#9CA3AF]">
        Focus for today · rule-based
      </p>
      <p className="mt-1 text-[13px] text-[#6B7280]">
        No AI — answers set weights and limits, then tasks are scored and capped.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="text-[13px] font-medium text-[#374151]">
            Hours available today
          </span>
          <input
            type="number"
            min={0.5}
            max={16}
            step={0.5}
            value={base.timeAvailable}
            onChange={(e) =>
              setBase((b) => ({
                ...b,
                timeAvailable: Number(e.target.value) || 0,
              }))
            }
            className="mt-1.5 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[14px] outline-none focus:border-[#9d84d8]/60"
          />
        </label>
        <div>
          <p className="text-[13px] font-medium text-[#374151]">Energy</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {ENERGY_OPTS.map((e) => (
              <button
                key={e}
                type="button"
                onClick={() => setBase((b) => ({ ...b, energy: e }))}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-medium capitalize ${
                  base.energy === e
                    ? "border-[#9d84d8] bg-[#F5F0FF] text-[#5b4a8a]"
                    : "border-[#E5E7EB] text-[#6B7280] hover:bg-[#FAFAFA]"
                }`}
              >
                {e}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[13px] font-medium text-[#374151]">Focus level</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {FOCUS_OPTS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setBase((b) => ({ ...b, focusLevel: f }))}
                className={`rounded-lg border px-2.5 py-1 text-[12px] font-medium capitalize ${
                  base.focusLevel === f
                    ? "border-[#9d84d8] bg-[#F5F0FF] text-[#5b4a8a]"
                    : "border-[#E5E7EB] text-[#6B7280] hover:bg-[#FAFAFA]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>
        </div>
        <label className="block sm:col-span-2">
          <span className="text-[13px] font-medium text-[#374151]">
            Main focus area
          </span>
          <input
            value={base.mainFocus}
            onChange={(e) =>
              setBase((b) => ({ ...b, mainFocus: e.target.value }))
            }
            className="mt-1.5 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[14px] outline-none focus:border-[#9d84d8]/60"
            placeholder="e.g. school, tennis, work"
          />
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[13px] font-medium text-[#374151]">
            Priorities (comma-separated)
          </span>
          <input
            value={prioritiesText}
            onChange={(e) => setPrioritiesText(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[14px] outline-none focus:border-[#9d84d8]/60"
            placeholder="school, tennis, health"
          />
        </label>
        <label className="flex cursor-pointer items-center gap-2 sm:col-span-2">
          <input
            type="checkbox"
            checked={base.hasDeadlines}
            onChange={(e) =>
              setBase((b) => ({ ...b, hasDeadlines: e.target.checked }))
            }
            className="h-4 w-4 rounded border-[#D1D5DB] text-[#9d84d8] focus:ring-[#9d84d8]"
          />
          <span className="text-[13px] text-[#374151]">I have deadlines today</span>
        </label>
        <label className="block sm:col-span-2">
          <span className="text-[13px] font-medium text-[#374151]">
            Distractions (comma-separated)
          </span>
          <input
            value={distractionsText}
            onChange={(e) => setDistractionsText(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[#E5E7EB] px-3 py-2 text-[14px] outline-none focus:border-[#9d84d8]/60"
            placeholder="phone, social, noise"
          />
        </label>
      </div>
      <div className="mt-5 flex justify-end">
        <button
          type="button"
          onClick={onContinueFromBase}
          className="rounded-lg bg-[#9d84d8] px-4 py-2 text-[13px] font-semibold text-white shadow-sm hover:bg-[#8a6fcc]"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
