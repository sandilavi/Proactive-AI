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

interface StrategyViewProps {
  tasks: NotionTask[];
  initialReport?: CapacityReport | null;
}

export default function StrategyView({ tasks, initialReport }: StrategyViewProps) {
  const [syncedTasks, setSyncedTasks] = useState<NotionTask[]>(tasks || []);
  const [report, setReport] = useState<CapacityReport | null>(initialReport || null);
  const [loading, setLoading] = useState(!report);
  const [thinkOpen, setThinkOpen] = useState(false);

  // SAFE CLIENT HYDRATION: Fixes the 'Hydration failed' error by ensuring 
  // the first render matches the server's HTML, then instantly switching to local memory.
  useEffect(() => {
    if (typeof window !== "undefined") {
      const isInitialError = report?.overallSummary?.includes("Rate Limit") || report?.overallSummary?.includes("API Error");
      const hasNoInsights = !report?.insights || report?.insights?.length === 0;

      if (isInitialError || hasNoInsights) {
        try {
          const saved = localStorage.getItem("proactive_capacity_full_report");
          if (saved) {
            const localSaved = JSON.parse(saved);
            if (localSaved.insights && localSaved.insights.length > 0) {
              setReport(localSaved);
              setLoading(false);
            }
          }
        } catch (e) {}
      }
    }
  }, []); // Run once on mount 

  const fetchInsightsRef = React.useRef<() => void>(() => {});

  useEffect(() => {
    const fetchInsights = async () => {
      try {
        const now = new Date();
        const offsetMinutes = -now.getTimezoneOffset();
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, '0');
        const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, '0');
        const userOffset = `${sign}${hours}:${minutes}`;

        // Fetch FRESH tasks directly to keep the UI from staggering
        const freshTasks = await fetchNotionTasks();
        if (!freshTasks) return;
        setSyncedTasks(freshTasks); // ATOMIC SYNC: Update the UI tasks immediately

        // Smart Consistency Check
        const currentFingerprint = [...freshTasks]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(t => `${t.id}-${t.status}-${t.name}-${t.deadline}`)
          .join("|");
        const todayStr = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split("T")[0];
        const lastFingerprint = localStorage.getItem("proactive_capacity_fingerprint_strategy");
        const lastFetchDay = localStorage.getItem("proactive_capacity_last_day_strategy");

        // Logic: Skip AI cost if data is identical AND it's the same day.
        if (report && !loading && currentFingerprint === lastFingerprint && todayStr === lastFetchDay) {
          return;
        }

        if (!report) setLoading(true);

        // Load persistent estimation memory (v2 ID-first format)
        const v2Vault = JSON.parse(localStorage.getItem("proactive_task_estimates_v2") || "{}");
        const savedEstimates: Record<string, number> = {};
        Object.entries(v2Vault).forEach(([key, data]: [string, any]) => {
          savedEstimates[key] = data.value || data;
        });
        
        const data = await getCapacityInsights(freshTasks, userOffset, savedEstimates);
        
        // Update fingerprints ONLY after a successful (non-cooldown) call
        const isRateLimitResponse = data?.overallSummary?.includes("Rate Limit");
        if (!isRateLimitResponse && data && Array.isArray(data.insights)) {
          localStorage.setItem("proactive_capacity_fingerprint_strategy", currentFingerprint);
          localStorage.setItem("proactive_capacity_last_day_strategy", todayStr);
          localStorage.setItem("proactive_capacity_full_report", JSON.stringify(data));
          
          // Legacy Sync: Update capacity alerts for the global hub
          const alerts = data.insights.filter(i => i.status === "BUSY" || i.status === "OVERLOADED");
          localStorage.setItem("proactive_capacity_alerts", JSON.stringify({
            alerts,
            summary: data.overallSummary,
            deadlineFingerprint: currentFingerprint,
            updatedAt: Date.now()
          }));
          window.dispatchEvent(new Event('capacity-alerts-updated'));
        } else if (isRateLimitResponse) {
          localStorage.removeItem("proactive_capacity_fingerprint_strategy");
          localStorage.removeItem("proactive_capacity_last_day_strategy");
        }
        
        setReport(data);
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
  }, [tasks, initialReport]);

  // AUTO-RETRY: Detect rate limits and self-heal automatically
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
               <span className="inline-flex items-center gap-1.5 bg-slate-700 px-3 py-1 rounded text-xs font-semibold border border-slate-600 text-slate-200">
                  <Sparkles size={12} className="text-blue-400" /> Strategic Capacity Report
               </span>
               <h2 className="text-lg font-bold uppercase tracking-wide">
                  {report.overallSummary}
               </h2>
               <div className="flex gap-8 pt-2">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Active Queue</span>
                    <span className="text-xl font-bold">{activeTasks.length} Tasks</span>
                  </div>
                  <div className="flex flex-col border-l border-slate-700 pl-6">
                    <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider mb-1">Critical Overloads</span>
                    <span className="text-xl font-bold text-red-400">
                      {(report?.insights || []).filter(i => i.status === "OVERLOADED").length} Days
                    </span>
                  </div>
               </div>
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
                 <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
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
          const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

          const normalizeDate = (deadline: string): string => {
            const parsed = new Date(deadline);
            if (!isNaN(parsed.getTime())) {
              return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
            }
            return deadline.split('T')[0];
          };

          const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== 'done' && t.deadline && t.deadline !== 'No Deadline');
          const uniqueDates = [...new Set(activeTasks.map(t => normalizeDate(t.deadline!)))];
          
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
              status: totalHours >= 12 ? "OVERLOADED" as const : totalHours >= 9 ? "BUSY" as const : "SAFE" as const,
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
            const isOverload = insight.status === "OVERLOADED";
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
                  ${isOverload ? 'bg-red-50/10' : ''}
                `}
              >
                 {isOverload && <div className="absolute top-0 left-0 w-full h-1 bg-red-650" />}
                 
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
                    <div className={`p-2 rounded border text-xs font-semibold ${isOverload 
                       ? 'bg-red-50 text-red-700 border-red-200' 
                       : isBusy 
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
                    {insight.taskInsights?.map((t, tidx) => (
                      <div key={tidx} className="flex flex-col border-l border-slate-200 pl-3 py-0.5">
                         <span className="text-xs font-semibold text-slate-700 truncate max-w-xs">{t.name}</span>
                         <span className="text-[9px] font-bold text-slate-400 uppercase mt-0.5">Est. time: {t.estimatedHours}h</span>
                      </div>
                    ))}
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
