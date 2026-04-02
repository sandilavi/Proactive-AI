"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { 
  Sparkles, 
  Brain, 
  LayoutDashboard, 
  Loader2, 
  TrendingUp
} from 'lucide-react';
import { getCapacityInsights, CapacityReport, NotionTask } from "@/app/actions/agent-actions";
import { fetchNotionTasks } from "@/app/actions/notion-actions";

interface StrategyViewProps {
  tasks: NotionTask[];
  initialReport?: CapacityReport | null;
}

export default function StrategyView({ tasks, initialReport }: StrategyViewProps) {
  const [report, setReport] = useState<CapacityReport | null>(initialReport || null);
  const [loading, setLoading] = useState(!initialReport);
  const [thinkOpen, setThinkOpen] = useState(false);
  const fetchInsightsRef = React.useRef<() => void>(() => {});

  useEffect(() => {
    const fetchInsights = async () => {
      if (report && !loading) {
         // Keep existing report while updating in background to avoid flicker
      } else {
         setLoading(true);
      }

      try {
        const now = new Date();
        const offsetMinutes = -now.getTimezoneOffset();
        const sign = offsetMinutes >= 0 ? '+' : '-';
        const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, '0');
        const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, '0');
        const userOffset = `${sign}${hours}:${minutes}`;

        const freshTasks = await fetchNotionTasks();
        
        // Load persistent estimation memory from LocalStorage
        const savedEstimates = JSON.parse(localStorage.getItem("proactive_task_estimates") || "{}");
        
        const data = await getCapacityInsights(freshTasks, userOffset, savedEstimates);
        setReport(data);

        // Save any NEWLY generated estimates back to LocalStorage
        const updatedEstimates = { ...savedEstimates };
        if (data?.insights) {
          data.insights.forEach(day => {
            day.taskInsights?.forEach(t => {
              const task = freshTasks.find(ft => ft.name === t.name);
              if (task) updatedEstimates[`${task.id}-${task.name}`] = t.estimatedHours;
            });
          });
        }
        localStorage.setItem("proactive_task_estimates", JSON.stringify(updatedEstimates));

        if (typeof window !== "undefined" && data && Array.isArray(data.insights)) {
          const alerts = data.insights.filter(i => i.status === "BUSY" || i.status === "OVERLOADED");
          
          const lastStored = JSON.parse(localStorage.getItem("proactive_capacity_alerts") || "{}");
          const lastAlertsStr = JSON.stringify(lastStored.alerts || []);
          const newAlertsStr = JSON.stringify(alerts);
          const hasStructuralChange = lastAlertsStr !== newAlertsStr;

          localStorage.setItem("proactive_capacity_alerts", JSON.stringify({
            alerts,
            summary: data.overallSummary,
            updatedAt: hasStructuralChange ? Date.now() : (lastStored.updatedAt || Date.now())
          }));
          window.dispatchEvent(new Event('capacity-alerts-updated'));
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

    return () => window.removeEventListener('notion-tasks-updated', handleSync);
  }, [tasks, initialReport]);

  // AUTO-RETRY: Detect rate limits and self-heal automatically
  useEffect(() => {
    if (report?.overallSummary?.includes("Rate Limit hit")) {
      const match = report.overallSummary.match(/wait (\d+)s/);
      if (match) {
        const seconds = parseInt(match[1]);
        const timeout = setTimeout(() => {
          fetchInsightsRef.current();
        }, seconds * 1000 + 500); // Wait the stated time + 0.5s buffer
        return () => clearTimeout(timeout);
      }
    }
  }, [report?.overallSummary]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 bg-white rounded-[3rem] border border-slate-100 shadow-sm border-dashed">
        <Loader2 className="w-12 h-12 text-purple-600 animate-spin mb-4" />
        <p className="text-lg font-bold text-slate-800">Analyzing workload...</p>
        <p className="text-sm text-slate-500">Estimating task durations and checking constraints.</p>
      </div>
    );
  }

  if (!report?.insights?.length) {
    return (
      <div className="text-center py-24 bg-white rounded-[3rem] border border-slate-100 shadow-sm">
        <LayoutDashboard className="mx-auto text-slate-200 mb-6" size={64} />
        <h3 className="text-xl font-bold text-slate-800 mb-2">No Active Tasks Found</h3>
        <p className="max-w-xs mx-auto text-sm text-slate-500 mb-4">Add chores or projects to your Notion databases to enable strategic analysis.</p>
        {report?.overallSummary && report.overallSummary !== "Your schedule is clear!" && (
          <div className="max-w-md mx-auto p-4 bg-red-50 border border-red-100 rounded-2xl text-red-600 text-sm font-medium">
            <p>System Diagnostic: {report.overallSummary}</p>
          </div>
        )}
      </div>
    );
  }

  const activeTasks = (tasks || []).filter(t => t.status?.toLowerCase() !== "done");

   return (
    <div className="space-y-10 animate-in fade-in zoom-in-95 duration-1000">
      {/* Top Header Card: Cinematic Strategy Overlook */}
      <div className="bg-slate-900 rounded-[3.5rem] p-12 text-white shadow-xl relative overflow-hidden group">
         {/* Animated Grid Overlay */}
         <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay"></div>

         <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-10">
            <div className="space-y-6 w-full">
               {/* UI: Global Strategic Header */}
               <div className="inline-flex items-center gap-2.5 bg-white/10 backdrop-blur-xl px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.25em] border border-white/10 shadow-2xl">
                  <Sparkles size={14} className="text-purple-400" /> Strategic Capacity Report
               </div>
               <h2 className="text-4xl font-black leading-tight tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/70">
                  {report.overallSummary}
               </h2>
               <div className="flex gap-10 pt-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-white/40 tracking-[0.3em] mb-2">Active Queue</span>
                    <span className="text-3xl font-black tracking-tighter">{activeTasks.length} Tasks</span>
                  </div>
                  <div className="flex flex-col border-l border-white/20 pl-8">
                    <span className="text-[10px] font-black uppercase text-white/40 tracking-[0.3em] mb-2">Critical Overloads</span>
                    <span className="text-3xl font-black tracking-tighter text-rose-400">
                      {(report?.insights || []).filter(i => i.status === "OVERLOADED").length} Days
                    </span>
                  </div>
               </div>
            </div>
         </div>

         {report.thinkContext && (
           <div className="mt-8 pt-6 border-t border-white/10 relative z-10 w-full col-span-full">
             <button
               type="button"
               onClick={() => setThinkOpen(!thinkOpen)}
               className="relative z-50 flex items-center gap-2 text-[10px] font-black text-purple-300/60 hover:text-purple-300 transition-all uppercase tracking-[0.2em] cursor-pointer"
             >
               <Brain size={12} className={thinkOpen ? "text-purple-400" : ""} />
               <span>{thinkOpen ? "Collapse Intelligence" : "Expand Intelligence"}</span>
               <svg
                 viewBox="0 0 24 24"
                 fill="none"
                 stroke="currentColor"
                 strokeWidth="3"
                 className={`w-2.5 h-2.5 transition-transform duration-500 ${thinkOpen ? "rotate-180" : "rotate-0 text-purple-300/40"}`}
               >
                 <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
               </svg>
             </button>
             {thinkOpen && (
               <div className="mt-5 pl-5 border-l-2 border-purple-500/30 custom-scrollbar w-full">
                 <p className="text-[11px] text-purple-100/60 leading-relaxed whitespace-pre-wrap font-mono">
                   {report.thinkContext}
                 </p>
               </div>
             )}
           </div>
         )}
         <Brain size={200} className="absolute -bottom-16 -right-16 text-white/5 group-hover:scale-110 group-hover:rotate-6 transition-all duration-1000 pointer-events-none" />
      </div>

      {/* Grid: Individual date-based analytical cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {(() => {
          const now = new Date();
          // Use local date to avoid UTC timezone mismatch
          // Build a task-name -> estimatedHours lookup from ALL AI insights
          const taskHoursMap = new Map<string, number>();
          // Pull from historical cache if the server provided it
          if (report?.knownEstimations) {
            Object.entries(report.knownEstimations).forEach(([name, hours]) => {
              taskHoursMap.set(name, hours);
            });
          }
          // Also pull from current insights just in case
          if (report?.insights) {
            report.insights.forEach(ins => {
              ins.taskInsights?.forEach(ti => {
                if (ti.estimatedHours > 0) taskHoursMap.set(ti.name, ti.estimatedHours);
              });
            });
          }
          const todayStr = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;

          // Normalize any Notion date format ('April 3, 2026' or ISO) → 'YYYY-MM-DD'
          const normalizeDate = (deadline: string): string => {
            const parsed = new Date(deadline);
            if (!isNaN(parsed.getTime())) {
              return `${parsed.getFullYear()}-${String(parsed.getMonth()+1).padStart(2,'0')}-${String(parsed.getDate()).padStart(2,'0')}`;
            }
            return deadline.split('T')[0]; // Fallback for already-formatted ISO strings
          };

          // 1. Derive the full set of dates from RAW TASKS (source of truth)
          const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== 'done' && t.deadline && t.deadline !== 'No Deadline');
          const uniqueDates = [...new Set(activeTasks.map(t => normalizeDate(t.deadline!)))];
          
          // 2. Always include Today even if empty
          if (!uniqueDates.includes(todayStr)) {
            uniqueDates.push(todayStr);
          }

          // 3. Build display list: merge task dates with AI insights
          const displayList = uniqueDates.map(dateStr => {
            // Try to find AI insight for this date
            const aiInsight = report?.insights.find(ins => ins.date === dateStr);
            if (aiInsight) return aiInsight;

            // Fallback: build a placeholder from raw tasks + cached AI hours
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

          // 4. Sort chronologically (overdue/invalid at the top)
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
                className={`bg-white rounded-[3rem] p-10 transition-all duration-500 relative overflow-hidden flex flex-col group cursor-default
                  hover:-translate-y-3
                  ${isToday 
                    ? 'border-[2px] border-slate-900 shadow-xl hover:shadow-2xl' 
                    : 'border border-slate-100 shadow-sm hover:shadow-md'
                  } 
                  ${isOverload ? 'bg-rose-50/10' : 'bg-white/70 backdrop-blur-xl'}
                `}
              >
                 {isOverload && <div className="absolute top-0 left-0 w-full h-2 bg-rose-500" />}
                 
                 <div className="flex items-center justify-between mb-8">
                    <div className="flex flex-col">
                      <span className={`font-black uppercase tracking-[0.3em] mb-1 leading-none 
                        ${isToday ? 'text-[22px] text-purple-600' : isOverdue || isInvalid ? 'text-[22px] text-rose-600' : 'text-[10px] text-slate-400'}
                      `}>
                        {isToday 
                          ? "TODAY" 
                          : isOverdue || isInvalid 
                          ? "OVERDUE" 
                          : isTomorrow 
                          ? "TOMORROW" 
                          : date.toLocaleDateString([], { weekday: 'long' })}
                      </span>
                      <span className="text-2xl font-black text-slate-900 tracking-tighter uppercase leading-none">
                        {isInvalid ? "Past Due" : date.toLocaleDateString([], { month: 'short', day: 'numeric' })}
                      </span>
                    </div>
                    <div className={`p-4 rounded-[1.5rem] transition-all duration-500 border shadow-sm ${isOverload 
                       ? 'bg-rose-50 text-rose-600 border-rose-100 group-hover:bg-rose-600 group-hover:text-white' 
                       : isBusy 
                       ? 'bg-orange-50 text-orange-600 border-orange-100 group-hover:bg-orange-600 group-hover:text-white' 
                       : 'bg-emerald-50 text-emerald-600 border-emerald-100 group-hover:bg-emerald-600 group-hover:text-white'}`}>
                      <TrendingUp size={24} />
                    </div>
                 </div>

                 <div className="flex items-baseline gap-3 mb-8">
                    <span className="text-5xl font-black text-slate-900 tracking-tighter leading-none">{(insight.totalHours || 0).toFixed(1)}</span>
                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Estimated Hours</span>
                 </div>

                 {/* Data: Breakdown of tasks for this specific date */}
                 <div className="space-y-4 mb-10 flex-1">
                    <div className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-4 flex items-center gap-2">
                       <div className="w-1 h-3 bg-slate-200 rounded-full"></div>
                       Allocation Metrics
                    </div>
                    {insight.taskInsights?.map((t, tidx) => (
                      <div key={tidx} className="flex flex-col gap-1 border-l-2 border-slate-100 pl-5 py-1 group/item hover:border-blue-400 transition-colors">
                         <span className="text-sm font-bold text-slate-800 line-clamp-1 group-hover/item:text-blue-600 transition-colors tracking-tight leading-tight">{t.name}</span>
                         <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest leading-none mt-1">Estimated time: {t.estimatedHours}h</span>
                      </div>
                    ))}
                    {(!insight.taskInsights || insight.taskInsights.length === 0) && (
                       <div className="text-[11px] font-bold text-slate-400 uppercase tracking-widest py-4 bg-slate-50/50 rounded-2xl text-center border border-dashed border-slate-100 opacity-60">
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
