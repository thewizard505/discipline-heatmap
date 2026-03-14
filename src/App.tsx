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

/* --- DATA MODELS --- */
type Task = { id: number; text: string; removing: boolean; createdAt: number };
type HistoryPoint = { value: number; date: string };
type HistoryData = { [taskName: string]: HistoryPoint[] };

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
  const [tasks, setTasks] = useState<Task[]>([]);

  const [selectedStat, setSelectedStat] = useState("Integrity");
  const [history, setHistory] = useState<HistoryData>({});
  const [taskHistory, setTaskHistory] = useState<{
    [task: string]: HistoryPoint[];
  }>({});
  const [selectedTaskGraph, setSelectedTaskGraph] = useState<string>("");

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

  const randomGreeting = useMemo(
    () => greetings[Math.floor(Math.random() * greetings.length)],
    [],
  );

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
        totalTaskDurationSecs += p.value * 60;
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
      setTaskHistory(parsed);
      const taskKeys = Object.keys(parsed);
      if (taskKeys.length > 0 && !selectedTaskGraph) {
        setSelectedTaskGraph(taskKeys[taskKeys.length - 1]);
      }
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
    }
  }, [
    history,
    taskHistory,
    streak,
    isSimulation,
    heatmapData,
    todayTotalFocusMinutes,
  ]);

  /* ------------------- FOCUS INTEGRITY ENGINE ------------------- */
  useEffect(() => {
    if (!running) return;
    const handleVisibilityChange = () => {
      if (document.hidden) {
        hiddenTimeRef.current = Date.now();
      } else if (hiddenTimeRef.current) {
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
  }, [running]);

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
    setIsTransitioning(true);
    setTimeout(() => {
      setIsSimulation(false);
      setName("User");
      setStreak(0);
      loadUserProgress();
      setTasks([]);
      setSeconds(0);
      setRunning(false);
      setIsTransitioning(false);
      window.scrollTo({ top: 0, behavior: "instant" });
    }, 600);
  };

  const handleGoHome = () => {
    setIsTransitioning(true);
    setTimeout(() => {
      setIsSimulation(true);
      setName("Alex");
      setStreak(3);
      setTasks([]);
      setHistory({});
      setSeconds(0);
      setRunning(false);
      setIsTransitioning(false);
      setIsVictory(false);
      setShowReflection(false);
      setReflectionPrompt(null);
      setReflectionText("");
      window.scrollTo({ top: 0, behavior: "instant" });
    }, 600);
  };

  const resetAllData = () => {
    localStorage.clear();
    setHistory({});
    setTaskHistory({});
    setHeatmapData([]);
    setTodayTotalFocusMinutes(0);
    setYesterdayTotalFocusMinutes(0);
    setStreak(0);
    setTasks([]);
    setSeconds(0);
    setRunning(false);
    setIsVictory(false);
    setShowReflection(false);
    setIntegrityPenalty(0);
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
          if (isSimAborted.current) return;
          setTaskInput(t.slice(0, i));
          await wait(80);
        }
        if (isSimAborted.current) return;
        setTasks((prev) => [
          ...prev,
          { id: Date.now(), text: t, removing: false, createdAt: Date.now() },
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

  /* --- Feature 1 demo sequence --- */
  useEffect(() => {
    if (!isSimulation || previewSection !== "feature1" || hasPlayedFeature1Demo)
      return;

    setHasPlayedFeature1Demo(true);
    setDemoTasks([]);
    setDemoSeconds(25 * 60);
    setDemoRunning(false);

    const examples = [
      "Precalculus homework",
      "Take bins down",
      "Read Ch20 Of Mice and Men",
    ];

    const timeouts: number[] = [];
    examples.forEach((task, index) => {
      const id = window.setTimeout(() => {
        setDemoTasks((prev) => [...prev, task]);
      }, index * 600);
      timeouts.push(id);
    });

    const startId = window.setTimeout(
      () => {
        setDemoRunning(true);
      },
      examples.length * 600 + 800,
    );
    timeouts.push(startId);

    return () => {
      timeouts.forEach((id) => window.clearTimeout(id));
    };
  }, [isSimulation, previewSection, hasPlayedFeature1Demo]);

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
    if (tasks.length === 0) {
      setWarning("Compile tasks before starting!");
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

  function completeTask(id: number) {
    if (isSimulation) return;
    if (!running) {
      setWarning("Start timer to track efficiency!");
      setTimeout(() => setWarning(null), 3000);
      return;
    }
    const task = tasks.find((t) => t.id === id);
    if (!task) return;
    const now = Date.now();
    const today = getTodayStr();
    const refPoint = lastTaskCompletionTime || timerSessionStart || now;
    const durationSecs = Math.max(1, Math.floor((now - refPoint) / 1000));
    setFloatingTime({ text: `${durationSecs}s`, id: Date.now() });
    setTimeout(() => setFloatingTime(null), 1500);
    setTaskHistory((prev) => ({
      ...prev,
      [task.text]: [
        ...(prev[task.text] || []),
        { value: Math.round(durationSecs / 60), date: today },
      ],
    }));
    setSelectedTaskGraph(task.text);
    setSelectedStat("Speed");
    setTasks((prev) => {
      const newTasks = prev.map((t) =>
        t.id === id ? { ...t, removing: true } : t,
      );
      if (newTasks.filter((t) => !t.removing).length === 0) {
        finishSessionManual();
      }
      return newTasks;
    });
    setLastTaskCompletionTime(now);
    setTimeout(() => setTasks((prev) => prev.filter((t) => t.id !== id)), 300);
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
      const data = taskHistory[selectedTaskGraph];
      return data && data.length > 0 ? data : [{ value: 0, date: "N/A" }];
    }
    const integrityData = history["Focus Integrity"] || [];
    return integrityData.length > 0
      ? integrityData
      : [{ value: 0, date: "N/A" }];
  }, [selectedStat, history, taskHistory, selectedTaskGraph, isSimulation]);

  const graphScale = useMemo(() => {
    const vals = currentData.map((d) => d.value);
    const max = selectedStat === "Speed" ? Math.max(...vals, 10) : 100;
    const min = 0;
    const range = max - min;
    return { min, max, range };
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

  const getHeatmapClass = (symbol: string, isCurrentDay: boolean) => {
    if (isCurrentDay && symbol === "⬜")
      return "bg-blue-600/20 border-blue-500 shadow-[0_0_15px_rgba(37,99,235,0.4)]";
    if (symbol === "⬜") return "bg-white/5 border-white/5 shadow-none";
    if (symbol === "🔹") return "bg-blue-900/40 border-blue-500/20";
    if (symbol === "🔷")
      return "bg-blue-600/40 border-blue-400/30 shadow-[0_0_10px_rgba(37,99,235,0.2)]";
    if (symbol === "🔵")
      return "bg-blue-500 border-blue-300/40 shadow-[0_0_15px_rgba(59,130,246,0.4)]";
    if (symbol === "🔥")
      return "bg-blue-400 border-white/40 shadow-[0_0_20px_rgba(96,165,250,0.8)]";
    return "bg-white/5";
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
      `}</style>

      <div
        className={`size-full bg-black text-white selection:bg-blue-500/30 font-sans transition-all duration-700 ${isSimulation ? "min-h-[240vh]" : "min-h-screen"} ${isTransitioning ? "opacity-0" : "opacity-100"}`}
      >
        {/* VIGNETTE & AURA */}
        <div
          className={`fixed inset-0 z-[150] pointer-events-none transition-opacity duration-1000 ${running ? "opacity-100" : "opacity-0"}`}
          style={{
            background:
              "radial-gradient(circle, transparent 40%, rgba(0,0,0,0.8) 150%)",
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
        {isSimulation && (
          <nav className="sticky top-0 z-[500] w-full px-4 md:px-8 py-2 md:py-3 bg-black/80 backdrop-blur-xl border-b border-white/10">
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
                  className="flex items-center gap-2 rounded-full px-2 py-1 hover:bg-white/10 hover:scale-[1.02] transition-all duration-200"
                >
                  <div className="w-8 h-8 rounded-xl overflow-hidden shadow-md">
                    <img
                      src="/favicon.ico"
                      alt="Tunnel Vision"
                      className="w-8 h-8 object-cover"
                    />
                  </div>
                  <span className="hidden sm:inline text-xs md:text-sm font-semibold tracking-[0.22em] uppercase text-white/80">
                    Tunnel Vision
                  </span>
                </button>

                {/* Center / right controls */}
                <div className="flex items-center gap-2 md:gap-4 text-[11px] font-medium tracking-[0.16em] uppercase">
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
                        className={`inline-flex items-center gap-1 rounded-full px-4 py-2 border border-white/10 bg-white/0 text-white/70 transition-all duration-200 hover:bg-white/10 hover:scale-105 ${
                          openDropdown === "madeFor" ? "bg-white/10" : ""
                        }`}
                      >
                        <span>Made For</span>
                        <span className="text-[10px]">
                          {openDropdown === "madeFor" ? "▲" : "▼"}
                        </span>
                      </button>
                      {openDropdown === "madeFor" && (
                        <div className="absolute right-0 mt-4 w-[480px] rounded-3xl bg-black/80 border border-white/10 shadow-[0_32px_120px_rgba(0,0,0,0.9)] backdrop-blur-2xl overflow-hidden animate-fade-in">
                          <div className="px-6 py-5">
                            <p className="text-[10px] uppercase tracking-[0.28em] text-white/40 mb-3">
                              Made For
                            </p>
                            <div className="grid md:grid-cols-3 gap-3">
                              <button
                                type="button"
                                onClick={() => {
                                  scrollToSection(performanceRef);
                                  setOpenDropdown(null);
                                }}
                                className="group flex flex-col items-start rounded-2xl bg-white/5 border border-white/10 px-4 py-4 text-left hover:bg-white/10 hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(0,0,0,0.8)] transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-blue-500/30 text-[10px]">
                                  ⚡
                                </span>
                                <span className="text-sm font-semibold text-white">
                                  Performance
                                </span>
                                <span className="mt-1 text-xs text-white/50 leading-relaxed">
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
                                className="group flex flex-col items-start rounded-2xl bg-white/5 border border-white/10 px-4 py-4 text-left hover:bg-white/10 hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(0,0,0,0.8)] transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/25 text-[10px]">
                                  🌱
                                </span>
                                <span className="text-sm font-semibold text-white">
                                  Habit Building
                                </span>
                                <span className="mt-1 text-xs text-white/50 leading-relaxed">
                                  Turn discipline into a daily habit.
                                </span>
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  scrollToSection(timeRef);
                                  setOpenDropdown(null);
                                }}
                                className="group flex flex-col items-start rounded-2xl bg-white/5 border border-white/10 px-4 py-4 text-left hover:bg-white/10 hover:-translate-y-1 hover:shadow-[0_18px_40px_rgba(0,0,0,0.8)] transition-all duration-200"
                              >
                                <span className="mb-2 inline-flex h-6 w-6 items-center justify-center rounded-full bg-purple-500/25 text-[10px]">
                                  ⏱
                                </span>
                                <span className="text-sm font-semibold text-white">
                                  Time Management
                                </span>
                                <span className="mt-1 text-xs text-white/50 leading-relaxed">
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
                        className={`inline-flex items-center gap-1 rounded-full px-4 py-2 border border-white/10 bg-white/0 text-white/70 transition-all duration-200 hover:bg-white/10 hover:scale-105 ${
                          openDropdown === "resources" ? "bg-white/10" : ""
                        }`}
                      >
                        <span>Resources</span>
                        <span className="text-[10px]">
                          {openDropdown === "resources" ? "▲" : "▼"}
                        </span>
                      </button>
                      {openDropdown === "resources" && (
                        <div className="absolute right-0 mt-4 w-64 rounded-3xl bg-black/80 border border-white/10 shadow-[0_32px_120px_rgba(0,0,0,0.9)] backdrop-blur-2xl overflow-hidden animate-fade-in">
                          <div className="px-5 py-4 space-y-1">
                            {["Guides", "Tutorials", "Documentation"].map(
                              (item) => (
                                <button
                                  key={item}
                                  type="button"
                                  className="w-full text-left px-2 py-2.5 text-[11px] tracking-[0.18em] uppercase text-white/70 rounded-2xl hover:bg-white/10 transition-colors"
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
                    className="sm:hidden inline-flex items-center justify-center rounded-full border border-white/15 bg-white/5 w-9 h-9 hover:bg-white/10 transition-all duration-200"
                    onClick={() => setIsMobileMenuOpen((v) => !v)}
                  >
                    <span className="sr-only">Toggle navigation</span>
                    <div className="flex flex-col gap-1.5">
                      <span className="w-4 h-0.5 bg-white rounded-full" />
                      <span className="w-4 h-0.5 bg-white rounded-full" />
                    </div>
                  </button>
                </div>

                {/* Mobile menu panel */}
                {isMobileMenuOpen && (
                  <div className="sm:hidden mt-3 rounded-3xl bg-black/80 border border-white/10 backdrop-blur-2xl shadow-[0_24px_80px_rgba(0,0,0,0.9)] px-4 py-4 space-y-4 text-[11px] tracking-[0.18em] uppercase">
                    <div className="space-y-2">
                      <p className="text-[10px] text-white/40">Made For</p>
                      <button
                        type="button"
                        onClick={() => scrollToSection(performanceRef)}
                        className="w-full text-left px-3 py-2 rounded-2xl bg-white/5 text-white/80 hover:bg-white/10 transition-colors"
                      >
                        Performance
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToSection(habitRef)}
                        className="w-full text-left px-3 py-2 rounded-2xl bg-white/5 text-white/80 hover:bg-white/10 transition-colors"
                      >
                        Habit Building
                      </button>
                      <button
                        type="button"
                        onClick={() => scrollToSection(timeRef)}
                        className="w-full text-left px-3 py-2 rounded-2xl bg-white/5 text-white/80 hover:bg-white/10 transition-colors"
                      >
                        Time Management
                      </button>
                    </div>
                    <div className="space-y-2 pt-2">
                      <p className="text-[10px] text-white/40">Resources</p>
                      {["Guides", "Tutorials", "Documentation"].map((item) => (
                        <button
                          key={item}
                          type="button"
                          className="w-full text-left px-3 py-2 rounded-2xl bg-white/5 text-white/80 hover:bg-white/10 transition-colors"
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
                  "radial-gradient(circle at var(--mouse-x, 50%) var(--mouse-y, 30%), rgba(255,255,255,0.08), transparent 40%)",
                transition: "background 0.18s ease-out",
              }}
            />
            <div className="mx-auto max-w-6xl grid gap-16 md:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] items-start">
              {/* Left: Hero copy + feature sections */}
              <div className="space-y-16 max-w-xl">
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-blue-400/80">
                  Discipline Operating System
                </p>
                <h1 className="text-3xl md:text-5xl font-semibold tracking-tight leading-tight text-white">
                  Other options are just a glorified google calendar
                </h1>
                <p className="text-base md:text-lg text-white/60 leading-relaxed mt-4">
                  Tunnel Vision times your tasks and gives you a focus integrity score so you can take accountability.
                </p>
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

                {/* Feature sections */}
                <div className="space-y-40 pt-40">
                  {/* Feature 1 */}
                  <section
                    ref={feature1Ref}
                    className="space-y-5 min-h-[160vh] flex flex-col justify-center"
                  >
                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
                      Step 1
                    </h2>
                    <p className="text-lg md:text-xl text-white/80 leading-relaxed max-w-xl">
                      Brain dump all your tasks that include homework, chores, and projects.
                      Start a timer and see how many tasks you can get done.
                    </p>
                  </section>

                  {/* Feature 2 */}
                  <section
                    ref={feature2Ref}
                    className="space-y-5 min-h-[160vh] flex flex-col justify-center"
                  >
                    <h2 className="text-4xl md:text-5xl font-bold tracking-tight text-white">
                      Step 2
                    </h2>
                    <p className="text-lg md:text-xl text-white/80 leading-relaxed max-w-xl">
                      Use Tunnel Vision's graphs to view your productivity over weeks and set goals for yourself in the future.
                    </p>
                  </section>
                </div>
              </div>

              {/* Right: Sticky app preview container */}
<div className="flex justify-center md:justify-end md:sticky md:top-24 md:self-start">
  <div className="w-full max-w-[520px] rounded-3xl border border-white/15 bg-white/5 shadow-[0_30px_80px_rgba(0,0,0,0.75)] p-4 md:p-6 backdrop-blur-xl">
    <div className="flex items-center justify-between mb-4 px-1">
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500/80" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400/80" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-400/80" />
      </div>
      <span className="text-[10px] uppercase tracking-[0.2em] text-white/40">
        Tunnel Vision · Demo
      </span>
      <span className="w-8" />
    </div>

                  {/* Scrollable simulated app */}
                  <div
                    ref={previewScrollRef}
                    className="h-[440px] overflow-hidden rounded-2xl bg-black/80 border border-white/10"
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
                            <p className="text-xs uppercase tracking-[0.25em] text-blue-400/80">
                              Today
                            </p>
                            <h3 className="text-2xl font-semibold tracking-tight">
                              Hello <span className="text-blue-400">Alex</span>.
                            </h3>
                            <p className="text-xs text-white/50 mt-1">
                              Ready to beat yesterday?
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="text-[10px] uppercase tracking-[0.22em] text-white/40">
                              Streak
                            </p>
                            <p className="text-xl font-mono font-bold">
                              3
                              <span className="text-[10px] text-white/40 ml-1">
                                days
                              </span>
                            </p>
                          </div>
                        </div>

                        {/* Demo timer + tasks card (Todoist-style list) */}
                        <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-4 items-start">
                          <div className="relative flex items-center justify-center">
                            <div className="w-24 h-24 rounded-2xl bg-white/[0.06] border border-white/10 flex items-center justify-center shadow-lg">
                              <span className="font-mono text-lg text-white/90">
                                {String(Math.floor(demoSeconds / 60)).padStart(
                                  2,
                                  "0",
                                )}
                                :{String(demoSeconds % 60).padStart(2, "0")}
                              </span>
                            </div>
                          </div>

                          <div className="rounded-2xl bg-white/[0.04] border border-white/10 shadow-sm overflow-hidden">
                            <div className="flex gap-2 p-2 border-b border-white/5">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[12px] text-white/60 placeholder-white/30 font-sans">
                                Add task...
                              </div>
                              <div className="px-3 py-2 rounded-xl bg-white text-[11px] font-semibold text-black shadow-sm">
                                Add
                              </div>
                            </div>
                            <div className="divide-y divide-white/5">
                              {demoTasks.map((task, index) => (
                                <div
                                  key={task}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-white/5 text-white/95"
                                      : "text-white/80"
                                  }`}
                                >
                                  <span className="tracking-tight">{task}</span>
                                  <span className="w-4 h-4 rounded-md border border-white/20 bg-white/5 flex-shrink-0" />
                                </div>
                              ))}
                              {demoTasks.length === 0 && (
                                <div className="px-3 py-4 text-center text-[12px] text-white/40 font-sans">
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
                        <div className="text-[10px] uppercase tracking-[0.3em] text-white/40">
                          Focus mode · Live
                        </div>
                        <div className="rounded-[32px] bg-gradient-to-b from-slate-900 via-slate-950 to-black border border-blue-500/40 shadow-[0_0_40px_rgba(37,99,235,0.6)] px-8 py-10 space-y-6">
                          <div className="flex flex-col items-center gap-2">
                            <div className="text-[10px] uppercase tracking-[0.3em] text-blue-400/80">
                              Deep work session
                            </div>
                            <div className="text-5xl md:text-6xl font-mono tracking-tight">
                              {String(Math.floor(demoSeconds / 60)).padStart(
                                2,
                                "0",
                              )}
                              :{String(demoSeconds % 60).padStart(2, "0")}
                            </div>
                            <div className="text-[10px] uppercase tracking-[0.3em] text-blue-300/80">
                              Focus integrity: 96.4%
                            </div>
                          </div>

                          <div className="space-y-3">
                            <div className="flex gap-2">
                              <div className="flex-1 px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-[12px] text-white/60 font-sans">
                                Add task...
                              </div>
                              <button className="px-4 py-2 rounded-xl bg-white text-[11px] font-semibold text-black shadow-sm">
                                Add
                              </button>
                            </div>
                            <div className="divide-y divide-white/5 rounded-2xl bg-white/[0.04] border border-white/10 overflow-hidden shadow-sm">
                              {demoTasks.map((task, index) => (
                                <div
                                  key={`focus-${task}`}
                                  className={`flex items-center justify-between px-3 py-2.5 text-[13px] font-sans ${
                                    index === 0
                                      ? "bg-blue-500/15 text-white/95"
                                      : "text-white/80"
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5">
                                    <span
                                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                        index === 0
                                          ? "bg-blue-400"
                                          : "bg-white/30"
                                      }`}
                                    />
                                    <span className="tracking-tight">{task}</span>
                                  </div>
                                  <span className="w-4 h-4 rounded-md border border-white/20 bg-white/5 flex-shrink-0" />
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
                          <h3 className="text-xs uppercase tracking-[0.3em] text-white/50">
                            Performance dashboard
                          </h3>
                          <span className="text-[10px] text-blue-400/80 uppercase tracking-[0.2em]">
                            Weekly view
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-3 text-xs">
                          {[
                            "Total focus",
                            "Best integrity",
                            "Longest streak",
                            "Tasks done",
                          ].map((label, i) => (
                            <div
                              key={label}
                              className="rounded-2xl bg-white/5 border border-white/10 px-3 py-3 space-y-1"
                            >
                              <p className="text-[9px] uppercase tracking-[0.2em] text-white/40">
                                {label}
                              </p>
                              <p className="text-sm font-mono font-bold">
                                {i === 0 && "14h 22m"}
                                {i === 1 && "99.2%"}
                                {i === 2 && "7 days"}
                                {i === 3 && "482"}
                              </p>
                            </div>
                          ))}
                        </div>

                        <div className="rounded-3xl bg-white/5 border border-white/10 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                              Discipline log
                            </p>
                            <span className="text-[10px] text-blue-400/80 uppercase tracking-[0.2em]">
                              Month view
                            </span>
                          </div>
                          <div className="grid grid-cols-7 gap-1">
                            {Array.from({ length: 21 }).map((_, i) => (
                              <div
                                key={i}
                                className={`aspect-square rounded-md border border-white/5 ${
                                  i % 5 === 0
                                    ? "bg-blue-500/70"
                                    : i % 3 === 0
                                      ? "bg-blue-400/40"
                                      : "bg-white/5"
                                }`}
                              />
                            ))}
                          </div>
                        </div>

                        <div className="rounded-3xl bg-white/5 border border-white/10 p-4 space-y-2">
                          <p className="text-[10px] uppercase tracking-[0.25em] text-white/50">
                            Focus integrity trend
                          </p>
                          <div className="h-24 rounded-2xl bg-gradient-to-tr from-blue-500/60 via-blue-400/30 to-transparent border border-blue-400/40 relative overflow-hidden">
                            <div className="absolute inset-x-6 bottom-3 h-12 border-t border-white/15" />
                            <div className="absolute inset-3">
                              <div className="h-full w-full rounded-xl border border-white/10 bg-black/30" />
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

        {!isSimulation && (
          <div
            className="flex flex-col items-center gap-10 relative z-20"
            style={{
              paddingTop: "5rem",
              transform: "none",
            }}
          >
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
              {!isSimulation && (
                <div className="flex justify-center mb-4">
                  <button
                    type="button"
                    onClick={handleGoHome}
                    className="group relative px-10 py-3 bg-blue-600 rounded-full overflow-hidden transition-all duration-500 hover:scale-110 active:scale-95 shadow-[0_0_40px_rgba(37,99,235,0.4)] animate-breathing"
                  >
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent -translate-x-full group-hover:translate-x-full transition-transform duration-1000 ease-in-out" />
                    <span className="relative text-[10px] font-black tracking-[0.3em] uppercase text-white">
                      Home
                    </span>
                  </button>
                </div>
              )}
              <h1 className="text-4xl font-semibold tracking-tight">
                Hello <span className="text-blue-400">{name}</span>.
              </h1>
              <p className="text-lg opacity-40 font-light italic">
                {randomGreeting}
              </p>
              <div className="text-[10px] tracking-[0.3em] uppercase opacity-40">
                🔥 {streak} day streak
              </div>

              {!isSimulation && (
                <div className="pt-6 flex justify-center">
                  <div className="bg-white/[0.03] border border-white/10 rounded-[32px] p-8 flex gap-12 backdrop-blur-xl shadow-[0_0_20px_rgba(59,130,246,0.1)] relative">
                    <div className="text-left">
                      <div className="text-[9px] uppercase tracking-[0.2em] opacity-30 font-black">
                        YESTERDAY
                      </div>
                      <div className="text-3xl font-mono font-bold tracking-tighter">
                        {yesterdayTotalFocusMinutes}{" "}
                        <span className="text-[10px] opacity-40 uppercase">
                          MIN
                        </span>
                      </div>
                    </div>
                    <div className="text-left">
                      <div className="text-[9px] uppercase tracking-[0.2em] opacity-30 font-black">
                        TODAY
                      </div>
                      <div className="text-3xl font-mono font-bold tracking-tighter text-blue-400">
                        {todayTotalFocusMinutes}{" "}
                        <span className="text-[10px] text-blue-400/40 uppercase">
                          MIN
                        </span>
                      </div>
                    </div>
                    <div
                      className={`flex items-end pb-1 text-[10px] font-black uppercase tracking-widest ${parseInt(improvementDelta) >= 0 ? "text-emerald-400" : "text-red-400"}`}
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
                  stroke="rgba(255,255,255,0.03)"
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
                className={`w-80 h-80 rounded-[56px] bg-white/[0.02] backdrop-blur-3xl border border-white/10 flex flex-col items-center justify-center shadow-2xl transition-all duration-700 overflow-hidden`}
              >
                {!showReflection ? (
                  <>
                    <div className={`text-7xl font-mono tracking-tighter`}>
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
                          className="px-8 py-2 bg-white/5 border border-white/10 rounded-full text-[10px] tracking-widest uppercase transition hover:bg-white/10"
                        >
                          +15 MIN
                        </button>
                        {seconds > 0 && (
                          <button
                            onClick={startTimer}
                            className="px-8 py-2 bg-white text-black rounded-full text-[10px] tracking-widest uppercase font-bold transition hover:scale-105"
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
                        <div className="text-[10px] font-black uppercase tracking-[0.3em] opacity-30 mb-4">
                          Reflect
                        </div>
                        {prompts.map((p, i) => (
                          <button
                            key={i}
                            onClick={() => setReflectionPrompt(p)}
                            className="w-full text-left p-3 rounded-2xl bg-white/[0.03] border border-white/5 hover:border-blue-500/40 hover:bg-blue-500/5 transition-all text-[10px] group"
                          >
                            <span className="opacity-50 group-hover:opacity-100 transition-opacity font-medium line-clamp-1">
                              {p}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-4 w-full flex flex-col items-center">
                        <div className="text-[8px] font-black uppercase tracking-widest text-blue-400 px-3 py-1 bg-blue-500/10 rounded-full border border-blue-500/20">
                          {reflectionPrompt}
                        </div>
                        <textarea
                          autoFocus
                          value={reflectionText}
                          onChange={(e) => setReflectionText(e.target.value)}
                          placeholder="..."
                          className="w-full h-24 bg-white/5 border border-white/10 rounded-2xl p-4 outline-none text-[10px] focus:border-blue-500/50 transition-all resize-none"
                        />
                        <div className="flex gap-2 w-full">
                          <button
                            onClick={() => {
                              setReflectionPrompt(null);
                              setReflectionText("");
                            }}
                            className="px-4 py-2 bg-white/5 border border-white/10 rounded-xl font-bold text-[8px] tracking-widest uppercase"
                          >
                            BACK
                          </button>
                          <button
                            onClick={handleReflectionSubmit}
                            disabled={!reflectionText.trim()}
                            className="flex-1 py-2 bg-white text-black rounded-xl font-black text-[8px] uppercase tracking-widest"
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

            <div className="w-full max-w-4xl space-y-12 pb-32">
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
                    className="flex-1 px-6 py-4 rounded-[24px] bg-white/[0.03] border border-white/10 text-white outline-none text-sm focus:border-blue-500/50 transition-all"
                  />
                  <button
                    disabled={isSimulation}
                    onClick={() => {
                      if (taskInput) {
                        setTasks((prev) => [
                          ...prev,
                          {
                            id: Date.now(),
                            text: taskInput,
                            removing: false,
                            createdAt: Date.now(),
                          },
                        ]);
                        setTaskInput("");
                      }
                    }}
                    className="px-8 bg-white text-black rounded-[24px] font-black text-[10px] tracking-widest uppercase"
                  >
                    ADD
                  </button>
                </div>

                <div className="flex flex-col gap-3">
                  {tasks.map((task, index) => (
                    <div
                      key={task.id}
                      className={`flex items-center justify-between p-4 rounded-[28px] bg-white/[0.02] border border-white/5 transition-all duration-300 ${task.removing ? "opacity-0 translate-x-12" : "opacity-100"} ${running && index === 0 ? "bg-white/[0.08] border-blue-500/30" : ""}`}
                    >
                      <div className="flex items-center gap-5">
                        <div
                          className={`w-1.5 h-1.5 rounded-full ${running && index === 0 ? "bg-blue-400" : "bg-white/20"}`}
                        />
                        <span className="text-base text-white/80">
                          {task.text}
                        </span>
                      </div>
                      <button
                        disabled={isSimulation}
                        onClick={() => completeTask(task.id)}
                        className="w-7 h-7 rounded-full border border-white/10 hover:border-emerald-500 hover:bg-emerald-500/20 transition-all"
                      />
                    </div>
                  ))}
                </div>
              </div>

              <div
                className={`transition-all duration-1000 ${running || showReflection ? "blur-3xl opacity-0 scale-90 pointer-events-none" : "blur-0 opacity-100 scale-100"}`}
              >
                <div className="mt-10 w-full max-w-4xl mx-auto space-y-8">
                  <div className="flex flex-col md:flex-row justify-between items-center gap-4 px-6">
                    <h2 className="text-[10px] tracking-[0.4em] uppercase opacity-30 font-black">
                      PERFORMANCE DASHBOARD
                    </h2>
                    <div className="flex gap-4 items-center">
                      {selectedStat === "Speed" && (
                        <select
                          value={selectedTaskGraph}
                          onChange={(e) => setSelectedTaskGraph(e.target.value)}
                          className="bg-white/[0.03] backdrop-blur-md border border-white/10 rounded-full px-5 py-2 text-[9px] uppercase tracking-widest font-black text-blue-400 outline-none hover:bg-white/10 transition shadow-lg"
                        >
                          <option value="">Select Task</option>
                          {Object.keys(taskHistory).map((task) => (
                            <option
                              key={task}
                              value={task}
                              className="bg-black text-white"
                            >
                              {task}
                            </option>
                          ))}
                        </select>
                      )}
                      <div className="flex bg-white/[0.03] border border-white/10 p-1 rounded-full backdrop-blur-xl shadow-inner">
                        {["Integrity", "Speed"].map((type) => (
                          <button
                            key={type}
                            onClick={() => setSelectedStat(type)}
                            className={`px-6 py-2 rounded-full text-[9px] uppercase tracking-[0.2em] font-black transition-all duration-500 ${selectedStat === type ? "bg-white text-black shadow-[0_0_20px_rgba(255,255,255,0.4)] scale-100" : "text-white/30 hover:text-white/60 scale-95"}`}
                          >
                            {type}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-8">
                    <div className="bg-white/[0.01] border border-white/10 rounded-[48px] overflow-hidden relative group min-h-[350px] shadow-[inset_0_0_80px_rgba(59,130,246,0.05)]">
                      <div className="absolute top-10 left-12 z-10">
                        <div className="text-[10px] uppercase tracking-widest opacity-40 mb-1 font-black">
                          SESSION ANALYTICS
                        </div>
                        <div className="text-2xl font-mono font-bold text-blue-400 tracking-tighter uppercase">
                          {selectedStat === "Integrity"
                            ? "FOCUS INTEGRITY"
                            : selectedTaskGraph
                              ? `TASK: ${selectedTaskGraph}`
                              : "COMPLETION SECONDS"}
                        </div>
                      </div>
                      <svg
                        viewBox="0 0 100 100"
                        preserveAspectRatio="none"
                        className="absolute inset-0 w-full h-full"
                      >
                        <defs>
                          <filter id="glow">
                            <feGaussianBlur
                              stdDeviation="2.5"
                              result="coloredBlur"
                            />
                            <feMerge>
                              <feMergeNode in="coloredBlur" />
                              <feMergeNode in="SourceGraphic" />
                            </feMerge>
                          </filter>
                          <linearGradient
                            id="graphGradient"
                            x1="0%"
                            y1="0%"
                            x2="0%"
                            y2="100%"
                          >
                            <stop
                              offset="0%"
                              stopColor="#3b82f6"
                              stopOpacity="0.6"
                            />
                            <stop
                              offset="50%"
                              stopColor="#3b82f6"
                              stopOpacity="0.2"
                            />
                            <stop
                              offset="100%"
                              stopColor="#3b82f6"
                              stopOpacity="0"
                            />
                          </linearGradient>
                          <linearGradient
                            id="lineGradient"
                            x1="0%"
                            y1="0%"
                            x2="100%"
                            y2="0%"
                          >
                            <stop offset="0%" stopColor="#3b82f6" />
                            <stop offset="50%" stopColor="#60a5fa" />
                            <stop offset="100%" stopColor="#a855f7" />
                          </linearGradient>
                        </defs>
                        <path
                          d={generateLinearPath(currentData)}
                          fill="url(#graphGradient)"
                          stroke="url(#lineGradient)"
                          strokeWidth="0.8"
                          filter="url(#glow)"
                          className="transition-all duration-1000 ease-out"
                        />
                      </svg>
                      <div className="absolute bottom-10 right-12 text-[10px] font-mono opacity-20 uppercase tracking-widest">
                        STRUCTURAL INTEGRITY: 100%
                      </div>
                    </div>
                  </div>
                </div>

                <div className="grid md:grid-cols-2 gap-8 mt-12">
                  {/* DISCIPLINE LOG: Real Calendar Mapping */}
                  <div className="bg-white/[0.02] border border-white/10 rounded-[48px] p-10 backdrop-blur-md">
                    <div className="flex justify-between items-center mb-10">
                      <h2 className="text-[10px] tracking-[0.3em] uppercase opacity-30 font-black">
                        DISCIPLINE LOG
                      </h2>
                      <span className="text-[10px] font-mono font-bold text-blue-400 opacity-60 uppercase">
                        {getCurrentMonthName()}
                      </span>
                    </div>

                    <div className="grid grid-cols-7 gap-3">
                      {["M", "T", "W", "T", "F", "S", "S"].map((day, i) => (
                        <div
                          key={i}
                          className="text-[8px] font-black opacity-20 text-center mb-2"
                        >
                          {day}
                        </div>
                      ))}

                      {heatmapData.map((day, i) => {
                        const todayDateNum = new Date().getDate();
                        const isToday = i + 1 === todayDateNum;

                        return (
                          <div
                            key={i}
                            className={`group relative aspect-square rounded-xl border transition-all duration-500 ${getHeatmapClass(day.symbol || "⬜", isToday)} hover:scale-110 flex items-center justify-center overflow-hidden cursor-help`}
                          >
                            <span className="text-xs group-hover:scale-125 transition-transform z-10">
                              {day.symbol || "⬜"}
                            </span>
                            {day.date && (
                              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-3 w-40 p-4 bg-gray-950 border border-white/20 rounded-2xl text-[10px] opacity-0 group-hover:opacity-100 transition-all pointer-events-none z-[300] backdrop-blur-xl shadow-2xl">
                                <div className="font-bold border-b border-white/10 pb-2 mb-2 uppercase">
                                  {day.date}
                                </div>
                                <div className="flex justify-between opacity-60 uppercase">
                                  <span>FOCUS:</span>
                                  <span>
                                    {Math.floor(day.totalFocusSeconds / 60)} MIN
                                  </span>
                                </div>
                                <div className="flex justify-between opacity-60 uppercase">
                                  <span>INTEGRITY:</span>
                                  <span>{day.focusIntegrity.toFixed(0)}%</span>
                                </div>
                                <div className="mt-2 pt-2 border-t border-white/10 text-blue-400 font-bold flex justify-between uppercase">
                                  <span>GRADE:</span>
                                  <span>{day.symbol}</span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  <div className="bg-white/[0.02] border border-white/10 rounded-[48px] p-10 backdrop-blur-md">
                    <h2 className="text-[10px] tracking-[0.3em] uppercase opacity-30 font-black">
                      PERFORMANCE ANALYTICS
                    </h2>
                    <div className="grid grid-cols-2 gap-4">
                      {stats.map((stat, i) => (
                        <div
                          key={i}
                          className="p-5 bg-white/[0.03] border border-white/5 rounded-3xl hover:scale-[1.03] transition-all duration-500 group shadow-lg"
                        >
                          <div className="text-[8px] uppercase tracking-widest opacity-30 mb-2 group-hover:text-blue-400 transition-colors font-black">
                            {stat.label}
                          </div>
                          <div className="text-lg font-mono font-bold">
                            {stat.val}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
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
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-blue-400/80">
                  Performance
                </p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                  Track your task performance.
                </h2>
                <p className="text-sm md:text-base text-white/70 max-w-2xl leading-relaxed">
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
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-blue-400/80">
                  Habit Building
                </p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                  Fix your habits before it's too late.
                </h2>
                <p className="text-sm md:text-base text-white/70 max-w-2xl leading-relaxed">
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
                <p className="text-xs font-semibold tracking-[0.25em] uppercase text-blue-400/80">
                  Time Management
                </p>
                <h2 className="text-3xl md:text-4xl font-bold tracking-tight">
                  Own your schedule.
                </h2>
                <p className="text-sm md:text-base text-white/70 max-w-2xl leading-relaxed">
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
