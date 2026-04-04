import type { FocusPlanUserInput } from "./types";

/** Deterministic pick: uses seed 0–1 for stable variation index */
export function pickVariation<T>(variations: readonly T[], seed: number): T {
  if (variations.length === 0) throw new Error("pickVariation: empty");
  const raw = Number.isFinite(seed) ? seed : 0.5;
  const s = ((raw % 1) + 1) % 1;
  const idx = Math.floor(s * variations.length) % variations.length;
  return variations[idx]!;
}

export const MAIN_FOCUS_URGENT: readonly string[] = [
  "Finish urgent tasks first — deadlines drive the order.",
  "Lead with what’s due: knock out the urgent work before anything else.",
  "Prioritize what’s on the clock — ship the must-dos early.",
  "Clock beats calendar today — tackle what’s due before it’s late.",
  "Urgent items anchor the plan so pressure turns into progress.",
];

export const MAIN_FOCUS_LOW_ENERGY: readonly string[] = [
  "Build momentum with easy wins — small completions fuel the day.",
  "Start light, finish strong: ease in so energy lasts.",
  "Keep the bar reachable — stack quick wins before harder work.",
  "Prefer gentle progress over grinding — consistency beats intensity today.",
  "Let quick completions rebuild your sense of control.",
];

export const MAIN_FOCUS_DEFAULT: readonly string[] = [
  "Focus on high-impact progress — one meaningful move at a time.",
  "Protect deep attention for what moves the needle most.",
  "Channel energy into outcomes, not busywork.",
  "Pick depth over breadth — fewer threads, cleaner wins.",
  "Aim for visible movement on what actually matters.",
];

export const AVOID_PHONE: readonly string[] = [
  "Avoid unnecessary phone use — batch checks instead of grazing.",
  "Keep the phone away during focus blocks — interruptions are expensive.",
  "Treat phone time as scheduled, not default.",
  "Silence low-signal apps until your priority block is done.",
  "Swap doom-scrolling for a named next action.",
];

export const AVOID_DEFAULT: readonly string[] = [
  "Avoid multitasking — finish one thing before the next.",
  "Avoid context-switching — single-thread your attention.",
  "Avoid filling gaps with random tabs — name the next task first.",
  "Avoid half-starting five things — one finish beats five starts.",
  "Avoid vague “I’ll do everything” — protect one lane at a time.",
];

export const WHY_DEADLINES: readonly string[] = [
  "This plan weights urgency so nothing critical slips.",
  "Deadlines came first so time aligns with real due dates.",
  "You flagged deadlines — the order reflects that pressure.",
  "Time-sensitive work floats to the top by design.",
  "When something’s due, the sequence honors that constraint.",
];

export const WHY_LOW_ENERGY: readonly string[] = [
  "Workload stays lighter so you can finish without burning out.",
  "Fewer, easier moves match the energy you have today.",
  "The mix favors sustainability over heroics.",
  "Capacity is honest — the list shrinks so completion stays realistic.",
  "You’re set up to close loops instead of starting new strain.",
];

export const WHY_DEFAULT: readonly string[] = [
  "Tasks are ordered by impact fit for your time and focus.",
  "The mix balances what matters with what you can sustain today.",
  "You get a clear sequence instead of a vague to-do pile.",
  "The ranking reflects your stated priorities and constraints.",
  "Nothing magical — just rules you can tweak as life changes.",
];

export function resolveMainFocus(
  input: FocusPlanUserInput,
  seed: number,
): string {
  if (input.hasDeadlines) {
    return pickVariation(MAIN_FOCUS_URGENT, seed);
  }
  if (input.energy === "low") {
    return pickVariation(MAIN_FOCUS_LOW_ENERGY, seed + 0.17);
  }
  return pickVariation(MAIN_FOCUS_DEFAULT, seed + 0.31);
}

export function resolveAvoid(input: FocusPlanUserInput, seed: number): string {
  const d = input.distractions.map((x) => x.toLowerCase());
  if (d.some((x) => x.includes("phone"))) {
    return pickVariation(AVOID_PHONE, seed + 0.41);
  }
  return pickVariation(AVOID_DEFAULT, seed + 0.53);
}

export function resolveWhy(input: FocusPlanUserInput, seed: number): string {
  if (input.hasDeadlines) {
    return pickVariation(WHY_DEADLINES, seed + 0.61);
  }
  if (input.energy === "low") {
    return pickVariation(WHY_LOW_ENERGY, seed + 0.71);
  }
  return pickVariation(WHY_DEFAULT, seed + 0.79);
}
