"use client";
import React, { useState, useEffect, useCallback } from 'react';
import {
  Sparkles,
  Brain,
  LayoutDashboard,
  Loader2,
  TrendingUp
} from 'lucide-react';
import { getCapacityInsights, CapacityReport } from "@/app/actions/strategy-actions";
import { NotionTask } from "@/app/actions/assistant-actions";
import { fetchNotionTasks } from "@/app/actions/notion-actions";

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

const getFormattedReportTime = (ms: number | undefined) => {
  if (!ms) return "";
  const alertDate = new Date(ms);
  const timeString = alertDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const now = new Date();
  const isSameDay = now.getFullYear() === alertDate.getFullYear() &&
                    now.getMonth() === alertDate.getMonth() &&
                    now.getDate() === alertDate.getDate();
  if (isSameDay) return timeString;
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = yesterday.getFullYear() === alertDate.getFullYear() &&
                      yesterday.getMonth() === alertDate.getMonth() &&
                      yesterday.getDate() === alertDate.getDate();
  if (isYesterday) return `Yesterday, ${timeString}`;
  return `${alertDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeString}`;
};

interface StrategyViewProps {
  tasks: NotionTask[];
  initialReport?: CapacityReport | null;
}

export default function StrategyView({ tasks, initialReport }: StrategyViewProps) {
  const [syncedTasks, setSyncedTasks] = useState<NotionTask[]>(tasks || []);
  const [report, setReport] = useState<CapacityReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [thinkOpen, setThinkOpen] = useState(false);
  const [reportUpdatedAt, setReportUpdatedAt] = useState<number | null>(null);

  // Restore cached report from localStorage on mount (no server-side AI call anymore)
  useEffect(() => {
    if (typeof window !== "undefined") {
      // Restore report timestamp
      try {
        const savedAlerts = localStorage.getItem("proactive_capacity_alerts");
        if (savedAlerts) {
          const parsed = JSON.parse(savedAlerts);
          if (parsed.updatedAt) setReportUpdatedAt(parsed.updatedAt);
        }
      } catch (e) {}

      // Restore cached report immediately so the card doesn't flash
      try {
        const saved = localStorage.getItem("proactive_capacity_full_report");
        if (saved) {
          const localSaved = JSON.parse(saved);
          if (localSaved.insights && localSaved.insights.length > 0) {
            // Patch with local estimates
            const v2Vault = JSON.parse(localStorage.getItem("proactive_task_estimates_v2") || "{}");
            const savedEstimates: Record<string, number> = {};
            Object.entries(v2Vault).forEach(([key, data]: [string, any]) => {
              savedEstimates[key] = data.value || data;
            });

            if (Object.keys(savedEstimates).length > 0) {
              const patchedReport = JSON.parse(JSON.stringify(localSaved));
              patchedReport.insights.forEach((ins: any) => {
                let totalHours = 0;
                ins.taskInsights?.forEach((ti: any) => {
                  const matchedTask = tasks.find(t => normalizeName(t.name) === normalizeName(ti.name));
                  const idMatch = matchedTask ? savedEstimates[matchedTask.id] : undefined;
                  const nameMatch = savedEstimates[ti.name] !== undefined ? savedEstimates[ti.name] : (matchedTask ? savedEstimates[matchedTask.name] : undefined);
                  const est = idMatch !== undefined ? idMatch : (nameMatch !== undefined ? nameMatch : ti.estimatedHours);
                  ti.estimatedHours = est;
                  totalHours += est;
                });
                ins.totalHours = totalHours;
                ins.status = totalHours >= 10 ? "BUSY" : "SAFE";
              });
              setReport(patchedReport);
            } else {
              setReport(localSaved);
            }
            if (localSaved.updatedAt) setReportUpdatedAt(localSaved.updatedAt);
            setLoading(false);
          }
        }
      } catch (e) {}
    }
  }, [tasks]); // Run on mount

  const fetchInsightsRef = React.useRef<() => void>(() => { });

  useEffect(() => {
    const fetchInsights = async () => {
      try {
        const now = new Date();
        const offsetMinutes = -now.getTimezoneOffset();
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, '0');
        const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, '0');
        const userOffset = `${sign}${hours}:${minutes}`;

        // Fetch fresh tasks directly to prevent UI staggering
        const freshTasks = await fetchNotionTasks();
        if (!freshTasks) return;
        setSyncedTasks(freshTasks); // Update UI tasks immediately

        const currentFingerprint = [...freshTasks]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(t => `${t.id}-${t.status}-${t.name}-${t.deadline}`)
          .join("|");
        const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split("T")[0];
        const lastFingerprint = localStorage.getItem("proactive_capacity_fingerprint_strategy");
        const lastFetchDay = localStorage.getItem("proactive_capacity_last_day_strategy");

        // Skip API calls if fingerprint + day match — even after component remounts (report state is null)
        if (currentFingerprint === lastFingerprint && todayStr === lastFetchDay) {
          // Restore from localStorage if report state was lost due to remount
          if (!report || loading) {
            const saved = localStorage.getItem("proactive_capacity_full_report");
            if (saved) {
              try {
                const parsed = JSON.parse(saved);
                if (parsed?.insights?.length > 0) {
                  setReport(parsed);
                  if (parsed.updatedAt) setReportUpdatedAt(parsed.updatedAt);
                  setLoading(false);
                }
              } catch (e) {}
            }
          }
          // Always re-dispatch so the brain panel in the header re-reads whatever is in localStorage
          window.dispatchEvent(new Event('capacity-alerts-updated'));
          return;
        }

        if (!report) setLoading(true);

        // Load persistent estimation memory (v2 ID-first format)
        const v2Vault = JSON.parse(localStorage.getItem("proactive_task_estimates_v2") || "{}");
        const savedEstimates: Record<string, number> = {};
        Object.entries(v2Vault).forEach(([key, data]: [string, any]) => {
          savedEstimates[key] = data.value || data;
        });

        // Also build compound-key format matching strategy-actions.ts cache (id-name)
        // so that the server-side taskEstimationCache uses saved estimates instead of re-estimating
        const savedEstimatesForServer: Record<string, number> = { ...savedEstimates };
        freshTasks.forEach(t => {
          const byId = savedEstimates[t.id];
          const byName = savedEstimates[t.name];
          const compound = `${t.id}-${t.name}`;
          if (byId !== undefined) savedEstimatesForServer[compound] = byId;
          else if (byName !== undefined) savedEstimatesForServer[compound] = byName;
        });

        const data = await getCapacityInsights(freshTasks, userOffset, savedEstimatesForServer);

        // Update fingerprints only after a successful (non-cooldown) call
        const isRateLimitResponse = data?.overallSummary?.includes("Rate Limit");
        if (!isRateLimitResponse && data && Array.isArray(data.insights)) {
          const generatedAtTime = Date.now();
          const reportWithMeta = { ...data, updatedAt: generatedAtTime };

          localStorage.setItem("proactive_capacity_fingerprint_strategy", currentFingerprint);
          localStorage.setItem("proactive_capacity_last_day_strategy", todayStr);
          localStorage.setItem("proactive_capacity_full_report", JSON.stringify(reportWithMeta));

          // Legacy Sync: Update capacity alerts for the global hub
          const capacityAlerts: any[] = [];
          const toHumanDate = (iso: string) => {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return iso;
            return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
          };

          const updatedEstimates = { ...savedEstimates };
          if (data && data.insights) {
            data.insights.forEach(day => {
              day.taskInsights?.forEach(t => {
                if (t.id) updatedEstimates[t.id] = t.estimatedHours;
                updatedEstimates[t.name] = t.estimatedHours;
              });
            });
          }

          // Save updated estimates to localStorage
          const ONE_DAY_MS = 24 * 60 * 60 * 1000;
          const activeTaskIds = new Set(freshTasks.map(t => t.id));
          const activeTaskNames = new Set(freshTasks.map(t => t.name));

          const currentVault = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("proactive_task_estimates_v2") || "{}") : {};
          const updatedVault = { ...currentVault };

          Object.entries(updatedEstimates).forEach(([key, val]) => {
            updatedVault[key] = { value: val as number, lastSeen: Date.now() };
          });

          const cleanedVault: Record<string, any> = {};
          Object.entries(updatedVault).forEach(([key, data]: [string, any]) => {
            const isStillActive = activeTaskIds.has(key) || activeTaskNames.has(key);
            const isRecentlySeen = (Date.now() - data.lastSeen) < ONE_DAY_MS;
            if (isStillActive || isRecentlySeen) {
              cleanedVault[key] = data;
            }
          });
          localStorage.setItem("proactive_task_estimates_v2", JSON.stringify(cleanedVault));

          const existingCachedAlerts = JSON.parse(localStorage.getItem("proactive_capacity_alerts") || "{}");
          const busyInsights = data.insights.filter(i => i.status === "BUSY");
          busyInsights.forEach(i => {
            const dayMitigations = data.mitigations?.filter(m => m.date === i.date) || [];
            if (dayMitigations.length > 0) {
              dayMitigations.forEach(mit => {
                const formattedSuggestion = `I'm recommending you to move ${mit.mitigationTaskName} to ${toHumanDate(mit.mitigationTargetDate)} to reduce the workload on ${toHumanDate(i.date)}.`;

                let estHours = 1.5;
                const matchedTask = freshTasks.find(t => normalizeName(t.name) === normalizeName(mit.mitigationTaskName));
                if (matchedTask && updatedEstimates[matchedTask.id]) {
                  estHours = updatedEstimates[matchedTask.id];
                } else if (updatedEstimates[mit.mitigationTaskName]) {
                  estHours = updatedEstimates[mit.mitigationTaskName];
                }

                const alertId = `capacity-${i.date}-${mit.mitigationTaskName}`;
                const prevAlert = (existingCachedAlerts.alerts || []).find((a: any) => a.id === alertId);
                const alertedAtTs = prevAlert?.alertedAt || generatedAtTime;
                const alertReadState = prevAlert?.read ?? false;

                capacityAlerts.push({
                  id: alertId,
                  taskId: alertId,
                  taskName: `Busy Day on ${i.date}`,
                  urgency: "CAPACITY_BUSY",
                  deadline: i.date,
                  date: i.date,
                  timestamp: new Date(alertedAtTs).toISOString(),
                  alertedAt: alertedAtTs,
                  read: alertReadState,
                  suggestion: formattedSuggestion,
                  reason: mit.reason,
                  totalHours: i.totalHours,
                  status: "BUSY",
                  mitigationSuggestion: formattedSuggestion,
                  mitigationTaskName: mit.mitigationTaskName,
                  mitigationTargetDate: mit.mitigationTargetDate,
                  estimatedHours: estHours,
                  source: (mit as any).source || "AI",
                });
              });
            } else {
              let remainingLoad = i.totalHours || 0;
              const sortedTasks = [...(i.taskInsights || [])].sort((a, b) => a.estimatedHours - b.estimatedHours);

              for (const task of sortedTasks) {
                if (remainingLoad <= 9.99) break;

                const taskName = task.name;
                const tmr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000));
                tmr.setDate(tmr.getDate() + 1);
                const targetDate = tmr.toISOString().split('T')[0];
                const newLoad = remainingLoad - task.estimatedHours;
                const reason = `Rescheduling this ${task.estimatedHours}h task brings ${toHumanDate(i.date)}'s workload down to ${newLoad.toFixed(1)} hours.`;
                const formattedSuggestion = `I'm recommending you to move ${taskName} to ${toHumanDate(targetDate)} to reduce the workload on ${toHumanDate(i.date)}.`;

                let estHours: number | undefined = task.estimatedHours;
                const matchedTask = freshTasks.find(t => normalizeName(t.name) === normalizeName(taskName));
                if (matchedTask && updatedEstimates[matchedTask.id]) {
                  estHours = updatedEstimates[matchedTask.id];
                } else if (updatedEstimates[taskName]) {
                  estHours = updatedEstimates[taskName];
                }

                const alertId = `capacity-${i.date}-${taskName}`;
                const prevAlert = (existingCachedAlerts.alerts || []).find((a: any) => a.id === alertId);
                const alertedAtTs = prevAlert?.alertedAt || generatedAtTime;
                const alertReadState = prevAlert?.read ?? false;

                capacityAlerts.push({
                  id: alertId,
                  taskId: alertId,
                  taskName: `Busy Day on ${i.date}`,
                  urgency: "CAPACITY_BUSY",
                  deadline: i.date,
                  date: i.date,
                  timestamp: new Date(alertedAtTs).toISOString(),
                  alertedAt: alertedAtTs,
                  read: alertReadState,
                  suggestion: formattedSuggestion,
                  reason: reason,
                  totalHours: i.totalHours,
                  status: "BUSY",
                  mitigationSuggestion: formattedSuggestion,
                  mitigationTaskName: taskName,
                  mitigationTargetDate: targetDate,
                  estimatedHours: estHours,
                  source: "FALLBACK",
                });

                remainingLoad = newLoad;
              }
            }
          });

          localStorage.setItem("proactive_capacity_alerts", JSON.stringify({
            alerts: capacityAlerts,
            summary: data.overallSummary,
            deadlineFingerprint: currentFingerprint,
            updatedAt: existingCachedAlerts.updatedAt || generatedAtTime
          }));
          window.dispatchEvent(new Event('capacity-alerts-updated'));
          setReport(reportWithMeta);
          setReportUpdatedAt(generatedAtTime);
        } else if (isRateLimitResponse) {
          localStorage.removeItem("proactive_capacity_fingerprint_strategy");
          localStorage.removeItem("proactive_capacity_last_day_strategy");
          setReport(data);
        }
      } catch (err) {
        console.error("Strategy Insight Error:", err);
      } finally {
        setLoading(false);
      }
    };

    fetchInsightsRef.current = fetchInsights;

    const handleSync = () => fetchInsights();
    window.addEventListener('notion-tasks-updated', handleSync);

    fetchInsights();

    return () => {
      window.removeEventListener('notion-tasks-updated', handleSync);
    };
  }, [tasks]);

  // Auto-retry on rate limits
  const isCooldown = report?.overallSummary?.includes("Rate Limit");
  useEffect(() => {
    if (isCooldown) {
      // Supports both "wait 13s" and "for 15 seconds"
      const match = report?.overallSummary?.match(/(?:wait |for )(\d+)(?:s| seconds)/);
      const seconds = match ? parseInt(match[1]) : 15; // default to 15 if parsing fails
      const timeout = setTimeout(() => {
        fetchInsightsRef.current();
      }, seconds * 1000 + 500); // Wait the stated time + 0.5s buffer
      return () => clearTimeout(timeout);
    }
  }, [report?.overallSummary]); // React now sees changing timestamps and re-triggers correctly

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-20 bg-slate-50 rounded-lg border border-slate-200 border-dashed">
        <Loader2 className="w-10 h-10 text-slate-650 animate-spin mb-3" />
        <p className="text-sm font-bold text-slate-800">Analyzing workload...</p>
        <p className="text-xs text-slate-500 mt-1">Estimating task durations and checking constraints.</p>
      </div>
    );
  }

  if (!report?.insights?.length) {
    return (
      <div className="text-center py-16 bg-slate-50 rounded-lg border border-slate-200">
        <LayoutDashboard className="mx-auto text-slate-300 mb-4" size={48} />
        <h3 className="text-sm font-bold text-slate-800 mb-1">No Active Tasks Found</h3>
        <p className="max-w-xs mx-auto text-xs text-slate-500 mb-3">Add chores or projects to your Notion databases to enable strategic analysis.</p>
        {report?.overallSummary && report.overallSummary !== "Your schedule is clear!" && (
          <div className="max-w-md mx-auto p-3 bg-red-50 border border-red-200 rounded text-red-700 text-xs font-semibold">
            <p>System Diagnostic: {report.overallSummary}</p>
          </div>
        )}
      </div>
    );
  }

  const activeTasks = (syncedTasks || []).filter(t => t.status?.toLowerCase() !== "done");

  return (
    <div className="space-y-6">
      {/* Top Header Card: Minimalist Strategy Overlook */}
      <div className="bg-slate-800 border border-slate-700 rounded-lg p-6 text-white relative">
        <div className="flex flex-col gap-4">
          <div className="space-y-4 w-full">
            {/* UI: Global Strategic Header */}
            <div>
              <span className="inline-flex items-center gap-1.5 bg-slate-700 px-3 py-1 rounded text-xs font-semibold border border-slate-600 text-slate-200">
                <Sparkles size={12} className="text-blue-400" /> Strategic Capacity Report
              </span>
            </div>
            <h2 className="text-lg font-bold tracking-wide">
              {report.overallSummary}
            </h2>
            <div className="flex gap-8 pt-2">
              <div className="flex flex-col">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Active Queue</span>
                <span className="text-xl font-bold">{activeTasks.length} Tasks</span>
              </div>
              <div className="flex flex-col border-l border-slate-700 pl-6">
                <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Busy Days</span>
                <span className="text-xl font-bold text-orange-400">
                  {(report?.insights || []).filter(i => i.status === "BUSY").length} Days
                </span>
              </div>
            </div>
            {reportUpdatedAt && (
              <span className="text-[9px] text-slate-400 font-semibold block pt-1" suppressHydrationWarning>
                Generated at {getFormattedReportTime(reportUpdatedAt)}
              </span>
            )}
          </div>
        </div>

        {report.thinkContext && (
          <div className="mt-4 pt-4 border-t border-slate-700 w-full col-span-full">
            <button
              type="button"
              onClick={() => setThinkOpen(!thinkOpen)}
              className="flex items-center gap-1.5 text-xs font-semibold text-slate-400 hover:text-slate-200 transition-colors cursor-pointer"
            >
              <Brain size={12} />
              <span>{thinkOpen ? "Collapse Intelligence" : "Expand Intelligence"}</span>
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                className={`w-3 h-3 transition-transform duration-300 ${thinkOpen ? "rotate-180" : "rotate-0 text-slate-500"}`}
              >
                <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            {thinkOpen && (
              <div className="mt-3 p-3 bg-slate-900 border border-slate-700 rounded text-xs text-slate-350 font-mono whitespace-pre-wrap">
                {report.thinkContext}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Grid: Individual date-based analytical cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(() => {
          const now = new Date();
          const taskHoursMap = new Map<string, number>();
          if (report?.knownEstimations) {
            Object.entries(report.knownEstimations).forEach(([name, hours]) => {
              taskHoursMap.set(name, hours);
            });
          }
          if (report?.insights) {
            report.insights.forEach(ins => {
              ins.taskInsights?.forEach(ti => {
                if (ti.estimatedHours > 0) taskHoursMap.set(ti.name, ti.estimatedHours);
              });
            });
          }
          const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

          const normalizeDate = (deadline: string): string => {
            const parsed = new Date(deadline);
            if (!isNaN(parsed.getTime())) {
              return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
            }
            return deadline.split('T')[0];
          };

          const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== 'done' && t.deadline && t.deadline !== 'No Deadline');
          // Only show today-or-future dates as cards; overdue tasks are merged into today's card
          const uniqueDates = [...new Set(activeTasks.map(t => normalizeDate(t.deadline!)).filter(d => d >= todayStr))];

          if (!uniqueDates.includes(todayStr)) {
            uniqueDates.push(todayStr);
          }

          const displayList = uniqueDates.map(dateStr => {
            const aiInsight = report?.insights.find(ins => ins.date === dateStr);
            if (aiInsight) return aiInsight;

            const dayTasks = activeTasks.filter(t => normalizeDate(t.deadline!) === dateStr);
            const taskInsights = dayTasks.map(t => ({
              name: t.name,
              estimatedHours: taskHoursMap.get(t.name) || 0
            }));
            const totalHours = taskInsights.reduce((sum, t) => sum + t.estimatedHours, 0);
            return {
              date: dateStr,
              totalHours,
              status: totalHours >= 10 ? "BUSY" as const : "SAFE" as const,
              taskInsights
            };
          });

          const sortedList = displayList.sort((a, b) => {
            const dateA = new Date(a.date).getTime();
            const dateB = new Date(b.date).getTime();
            if (isNaN(dateA)) return -1;
            if (isNaN(dateB)) return 1;
            return dateA - dateB;
          });

          return sortedList.map((insight, idx) => {
            const isBusy = insight.status === "BUSY";
            const date = new Date(insight.date);
            const isInvalid = isNaN(date.getTime());

            const getLocalDateTimestamp = (d: Date) => {
              const nd = new Date(d);
              nd.setHours(0, 0, 0, 0);
              return nd.getTime();
            };

            const todayTimestamp = getLocalDateTimestamp(new Date());
            const insightTimestamp = !isInvalid ? getLocalDateTimestamp(date) : 0;

            const isOverdue = !isInvalid && insightTimestamp < todayTimestamp;
            const isToday = !isInvalid && insightTimestamp === todayTimestamp;
            const isTomorrow = !isInvalid && insightTimestamp === (todayTimestamp + 86400000);

            return (
              <div
                key={idx}
                className={`bg-white rounded-lg p-5 border border-slate-200 shadow-sm relative overflow-hidden flex flex-col cursor-default
                  ${isToday ? 'border-slate-800 ring-1 ring-slate-800' : ''} 
                  ${isBusy ? 'bg-orange-50/10' : ''}
                `}
              >
                {isBusy && <div className="absolute top-0 left-0 w-full h-1 bg-orange-600" />}

                <div className="flex items-center justify-between mb-4">
                  <div className="flex flex-col">
                    <span className={`text-[10px] font-bold uppercase tracking-wider mb-0.5 leading-none 
                        ${isToday ? 'text-blue-600' : isOverdue || isInvalid ? 'text-red-605' : 'text-slate-400'}
                      `}>
                      {isToday
                        ? "TODAY"
                        : isOverdue || isInvalid
                          ? "OVERDUE"
                          : isTomorrow
                            ? "TOMORROW"
                            : date.toLocaleDateString([], { weekday: 'long' })}
                    </span>
                    <span className="text-base font-bold text-slate-900 uppercase">
                      {isInvalid ? "Past Due" : date.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                  <div className={`p-2 rounded border text-xs font-semibold ${isBusy
                    ? 'bg-orange-50 text-orange-700 border-orange-200'
                    : 'bg-emerald-50 text-emerald-700 border-emerald-200'}`}>
                    <TrendingUp size={16} />
                  </div>
                </div>

                <div className="flex items-baseline gap-1.5 mb-4">
                  <span className="text-3xl font-bold text-slate-800">{(insight.totalHours || 0).toFixed(1)}</span>
                  <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Est. Hours</span>
                </div>

                {/* Data: Breakdown of tasks for this specific date */}
                <div className="space-y-3 flex-1">
                  <div className="text-[10px] font-bold uppercase text-slate-400 tracking-wider flex items-center gap-1.5">
                    <div className="w-1 h-3 bg-slate-200 rounded-full"></div>
                    Allocation Metrics
                  </div>
                  {(() => {
                    const sortedTasks = [...(insight.taskInsights || [])].sort((a: any, b: any) => {
                      const getTaskInfo = (t: any) => {
                        let hasTime = false;
                        let dateOnlyMs = Infinity;
                        let timeMs = Infinity;
                        let isPast = false;
                        let isOverdue = !!t.isOverdue;

                        if (t.originalDeadline) {
                          const dl = t.originalDeadline;
                          const parsed = new Date(dl);
                          if (!isNaN(parsed.getTime())) {
                            timeMs = parsed.getTime();
                            // Get date without time for day-level comparison
                            const dateOnly = new Date(parsed);
                            dateOnly.setHours(0, 0, 0, 0);
                            dateOnlyMs = dateOnly.getTime();

                            const timeMatch = dl.match(/T(\d{2}):(\d{2})/);
                            if (timeMatch) {
                              const h = parseInt(timeMatch[1], 10);
                              const m = parseInt(timeMatch[2], 10);
                              if (h !== 0 || m !== 0) {
                                hasTime = true;
                                if (!isOverdue && timeMs < Date.now()) {
                                  isPast = true;
                                }
                              }
                            }
                          }
                        }
                        return { isOverdue, isPast, hasTime, timeMs, dateOnlyMs };
                      };

                      const infoA = getTaskInfo(a);
                      const infoB = getTaskInfo(b);

                      const scoreA = infoA.isOverdue || infoA.isPast ? 2 : 1;
                      const scoreB = infoB.isOverdue || infoB.isPast ? 2 : 1;

                      // 1. Overdue/past tasks first
                      if (scoreA !== scoreB) {
                        return scoreB - scoreA;
                      }

                      // 2. Earliest date first (ignoring time)
                      if (infoA.dateOnlyMs !== infoB.dateOnlyMs) {
                        return infoA.dateOnlyMs - infoB.dateOnlyMs;
                      }

                      // 3. On the same day, tasks WITH a time come before tasks WITHOUT a time
                      if (infoA.hasTime !== infoB.hasTime) {
                        return infoA.hasTime ? -1 : 1;
                      }

                      // 4. Sort by time
                      if (infoA.timeMs !== infoB.timeMs) {
                        return infoA.timeMs - infoB.timeMs;
                      }
                      return 0;
                    });

                    return sortedTasks.map((t, tidx) => {
                      const task = t as any;
                      let dueTimeStr: string | null = null;
                      let wasDueStr: string | null = null;
                      let isTimePast = false;
                      if (task.originalDeadline) {
                        const dl: string = task.originalDeadline;
                        const timeMatch = dl.match(/T(\d{2}):(\d{2})/);
                        if (timeMatch) {
                          const h = parseInt(timeMatch[1], 10);
                          const m = parseInt(timeMatch[2], 10);
                          if (h !== 0 || m !== 0) {
                            const parsed = new Date(dl);
                            if (!isNaN(parsed.getTime())) {
                              dueTimeStr = parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                              if (!task.isOverdue && parsed.getTime() < Date.now()) {
                                isTimePast = true;
                              }
                            }
                          }
                        }
                        if (task.isOverdue) {
                          const parsed = new Date(dl);
                          if (!isNaN(parsed.getTime())) {
                            wasDueStr = parsed.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                          }
                        }
                      }
                      return (
                        <div key={tidx} className="flex flex-col border-l border-slate-200 pl-3 py-0.5">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="text-xs font-semibold text-slate-700 truncate max-w-xs">{t.name}</span>
                            {(task.isOverdue || isTimePast) && (
                              <span className="text-[8px] font-bold px-1 py-0.5 rounded bg-red-50 text-red-600 border border-red-100 uppercase tracking-wide shrink-0">Overdue</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2.5 mt-0.5">
                            <span className="text-[9px] font-bold text-slate-400 uppercase">Est. time: {t.estimatedHours}h</span>
                            {(wasDueStr || dueTimeStr) && (
                              <span className={`text-[9px] font-medium whitespace-nowrap ${(wasDueStr || isTimePast) ? 'text-red-400' : 'text-slate-500'}`}>
                                {wasDueStr && dueTimeStr
                                  ? `Was due ${wasDueStr} at ${dueTimeStr}`
                                  : wasDueStr
                                    ? `Was due ${wasDueStr}`
                                    : isTimePast
                                      ? `Was due at ${dueTimeStr}`
                                      : `Due by ${dueTimeStr}`}
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    });
                  })()}
                  {(!insight.taskInsights || insight.taskInsights.length === 0) && (
                    <div className="text-xs text-slate-400 italic py-2 bg-slate-50 rounded text-center border border-dashed border-slate-200">
                      Zero Allocations
                    </div>
                  )}
                </div>

              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}
