"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { 
  Sparkles, 
  Brain, 
  Zap, 
  LayoutDashboard, 
  Loader2, 
  TrendingUp, 
  Check,
  X
} from 'lucide-react';
import { getCapacityInsights, CapacityReport, NotionTask } from "@/app/actions/agent-actions";
import { updateNotionTask, fetchNotionTasks } from "@/app/actions/notion-actions";

interface StrategyViewProps {
  tasks: NotionTask[];
  initialReport?: CapacityReport | null;
}

export default function StrategyView({ tasks, initialReport }: StrategyViewProps) {
  const [report, setReport] = useState<CapacityReport | null>(initialReport || null);
  const [loading, setLoading] = useState(!initialReport);
  const [thinkOpen, setThinkOpen] = useState(false);
  const [mitigationState, setMitigationState] = useState<Record<string, 'idle' | 'loading' | 'accepted' | 'rejected'>>({});
  const fetchInsightsRef = React.useRef<() => void>(() => {});

  const handleAccept = useCallback(async (insightDate: string, taskName: string, targetDate: string) => {
    setMitigationState(prev => ({ ...prev, [insightDate]: 'loading' }));
    try {
      const allTasks = await fetchNotionTasks();
      const matchedTask = allTasks.find(t =>
        t.name.toLowerCase().trim() === taskName.toLowerCase().trim()
      );
      if (!matchedTask) {
        console.error('Task not found:', taskName);
        setMitigationState(prev => ({ ...prev, [insightDate]: 'idle' }));
        return;
      }
      const result = await updateNotionTask(
        matchedTask.id,
        undefined,
        targetDate,
        matchedTask.propNames,
        matchedTask.propTypes
      );
      if (result.success) {
        setMitigationState(prev => ({ ...prev, [insightDate]: 'accepted' }));
        // Bust the server-side Map cache by clearing the fingerprint
        if (typeof window !== 'undefined') {
          localStorage.removeItem('proactive_tasks_fingerprint');
        }
        setTimeout(() => fetchInsightsRef.current?.(), 1500);
      } else {
        setMitigationState(prev => ({ ...prev, [insightDate]: 'idle' }));
      }
    } catch (e) {
      console.error('Accept mitigation error:', e);
      setMitigationState(prev => ({ ...prev, [insightDate]: 'idle' }));
    }
  }, []);

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
        data.insights.forEach(day => {
          day.taskInsights?.forEach(t => {
            const task = freshTasks.find(ft => ft.name === t.name);
            if (task) updatedEstimates[`${task.id}-${task.name}`] = t.estimatedHours;
          });
        });
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
    (window as any).__strategyHandleAccept = handleAccept;

    const handleSync = () => fetchInsights();
    window.addEventListener('notion-tasks-updated', handleSync);
    
    fetchInsights();

    return () => window.removeEventListener('notion-tasks-updated', handleSync);
  }, [tasks, initialReport]);

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
        <p className="max-w-xs mx-auto text-sm text-slate-500">Add chores or projects to your Notion databases to enable strategic analysis.</p>
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
               className="flex items-center gap-2 text-[10px] font-black text-purple-300/60 hover:text-purple-300 transition-all uppercase tracking-[0.2em] cursor-pointer"
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
        {(report?.insights || []).map((insight, idx) => {
          const isOverload = insight.status === "OVERLOADED";
          const isBusy = insight.status === "BUSY";
          const date = new Date(insight.date);
          
          return (
            <div key={idx} className={`bg-white/70 backdrop-blur-xl rounded-[2.5rem] border border-slate-100 p-10 shadow-sm transition-all duration-500 hover:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.08)] hover:-translate-y-2 relative overflow-hidden flex flex-col group ${isOverload ? 'border-b-rose-200' : 'border-b-slate-200/50'}`}>
               {isOverload && <div className="absolute top-0 left-0 w-full h-2 bg-rose-500" />}
               
               <div className="flex items-center justify-between mb-8">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.3em] mb-1 leading-none">{date.toLocaleDateString([], { weekday: 'long' })}</span>
                    <span className="text-2xl font-black text-slate-900 tracking-tighter uppercase leading-none">
                      {date.toLocaleDateString([], { month: 'short', day: 'numeric' })}
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

               {/* Strategy Recommendation with Accept / Reject */}
               {insight.suggestion && (
                 <div className={`mt-auto p-7 min-h-[140px] rounded-[1.8rem] border shadow-sm relative overflow-hidden group/sugg transition-all duration-500 
                    hover:shadow-xl hover:-translate-y-1 ${
                    isOverload 
                    ? 'bg-rose-50 border-rose-100 group-hover:bg-rose-100/80' 
                    : 'bg-indigo-50 border-indigo-100 group-hover:bg-indigo-100/80'}`}>
                    
                    <div className="flex flex-col gap-5 relative z-10 h-full">
                       <div className="flex items-start gap-3.5">
                          <div className={`p-2 rounded-xl transition-colors ${isOverload ? 'bg-rose-200/50 text-rose-600' : 'bg-indigo-200/50 text-indigo-600'}`}>
                            <Zap size={14} className="fill-current" />
                          </div>
                          <div className="flex flex-col gap-1.5 flex-1">
                             <span className={`text-[10px] font-black uppercase tracking-[0.25em] ${isOverload ? 'text-rose-400' : 'text-indigo-400'}`}>Agent Mitigator</span>
                             
                             {mitigationState[insight.date] === 'accepted' ? (
                               <p className="text-xs font-black text-emerald-700 flex items-center gap-1.5 animate-in slide-in-from-left-2">
                                 <Check size={14} className="text-emerald-600" /> Task moved successfully!
                               </p>
                             ) : mitigationState[insight.date] === 'rejected' ? (
                               <p className="text-xs font-bold text-slate-400 line-through italic animate-in fade-in">Suggestion dismissed</p>
                             ) : (
                               <p className={`text-[13px] font-bold leading-relaxed tracking-tight ${isOverload ? 'text-rose-900' : 'text-indigo-900'}`}>
                                 {insight.suggestion}
                               </p>
                             )}
                          </div>
                       </div>

                       {/* Action Bar — Improved Visibility */}
                       {insight.mitigationTaskName && insight.mitigationTargetDate &&
                        mitigationState[insight.date] !== 'accepted' &&
                        mitigationState[insight.date] !== 'rejected' && (
                         <div className="flex items-center gap-3 pt-1 mt-auto">
                           <button
                             onClick={() => (window as any).__strategyHandleAccept?.(insight.date, insight.mitigationTaskName!, insight.mitigationTargetDate!)}
                             disabled={mitigationState[insight.date] === 'loading'}
                             className={`flex-1 flex items-center justify-center gap-2 px-5 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest transition-all duration-300 shadow-lg active:scale-95
                               ${ isOverload
                                 ? 'bg-rose-600 hover:bg-rose-700 text-white disabled:bg-rose-300 hover:shadow-rose-300/50'
                                 : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-indigo-300 hover:shadow-indigo-300/50'
                               }`}
                           >
                             {mitigationState[insight.date] === 'loading' ? (
                               <>
                                 <Loader2 size={12} className="animate-spin" />
                                 <span>Moving...</span>
                               </>
                             ) : (
                               <>
                                 <Check size={12} />
                                 <span>Accept</span>
                               </>
                             )}
                           </button>
                           <button
                             onClick={() => setMitigationState(prev => ({ ...prev, [insight.date]: 'rejected' }))}
                             disabled={mitigationState[insight.date] === 'loading'}
                             className="px-5 py-3 rounded-2xl text-[11px] font-black uppercase tracking-widest bg-white hover:bg-slate-100 text-slate-500 transition-all duration-300 border border-slate-100 hover:border-slate-200"
                           >
                             <X size={12} />
                           </button>
                         </div>
                       )}
                    </div>
                    <Brain size={120} className={`absolute -bottom-10 -right-10 opacity-[0.04] pointer-events-none group-hover/sugg:scale-125 transition-transform duration-700 ${isOverload ? 'text-rose-900' : 'text-indigo-900'}`} />
                 </div>
               )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
