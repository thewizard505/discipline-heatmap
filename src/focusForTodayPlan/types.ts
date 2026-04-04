/** Rule-based daily focus planner — no AI, no network. */

export type EnergyLevel = "low" | "medium" | "high";
export type FocusLevel = "low" | "medium" | "high";
export type TaskDifficulty = "easy" | "medium" | "hard";
export type EasyOrBalanced = "easy" | "balanced";

/** Core answers from the structured flow */
export type FocusPlanBaseInput = {
  timeAvailable: number;
  energy: EnergyLevel;
  focusLevel: FocusLevel;
  mainFocus: string;
  priorities: string[];
  hasDeadlines: boolean;
  distractions: string[];
};

/** Follow-ups filled by adaptive logic */
export type FocusPlanAdaptiveAnswers = {
  /** timeAvailable < 2 */
  oneMustFinish?: string;
  /** hasDeadlines */
  dueFirst?: string;
  dueFirstMinutes?: number;
  /** energy === low */
  easyOrBalanced?: EasyOrBalanced;
  /** mainFocus hints tennis */
  tennisImprove?: string;
};

export type FocusPlanUserInput = FocusPlanBaseInput & FocusPlanAdaptiveAnswers;

export type PlanTaskType = string;

export type PlanTask = {
  id: string;
  name: string;
  type: PlanTaskType;
  difficulty: TaskDifficulty;
  hasDeadline: boolean;
};

export type ScoredPlanTask = PlanTask & { score: number };

export type GeneratedFocusPlan = {
  mainFocus: string;
  priorityTasks: ScoredPlanTask[];
  stretchTask: ScoredPlanTask | null;
  avoid: string;
  whyThisPlan: string;
  /** For regenerate: bump to reshuffle tie-breakers */
  variationSeed: number;
};

export type WizardStepId =
  | "base"
  | "oneMustFinish"
  | "deadlines"
  | "deadlineTime"
  | "easyOrBalanced"
  | "tennis"
  | "review";
