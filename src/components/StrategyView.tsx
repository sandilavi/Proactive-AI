"use client";
import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Brain, 
  Zap, 
  LayoutDashboard, 
  Clock, 
  Loader2, 
  TrendingUp, 
  Target
} from 'lucide-react';
import { getCapacityInsights, CapacityReport, CapacityInsight, NotionTask } from "@/app/actions/agent-actions";

interface StrategyViewProps {
  tasks: NotionTask[];
  initialReport?: CapacityReport | null;
}

export default function StrategyView({ tasks, initialReport }: StrategyViewProps) {
  const [report, setReport] = useState<CapacityReport | null>(initialReport || null);
  const [loading, setLoading] = useState(!initialReport);

  useEffect(() => {
    const fetchInsights = async () => {
      // If we already have a report and tasks haven't changed, skip loading state
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

        // If we're refreshing because of a signal, we need the latest task list first
        const { fetchNotionTasks } = await import("@/app/actions/notion-actions");
        const freshTasks = await fetchNotionTasks();
        const data = await getCapacityInsights(freshTasks, userOffset);
        setReport(data);

        // Sync to the Strategic Intelligence Hub in the header
        if (typeof window !== "undefined" && data) {
          const alerts = data.insights.filter(i => i.status === "BUSY" || i.status === "OVERLOADED");
          // SORT before fingerprinting to match AgentEngine exactly
          const currentFingerprint = [...freshTasks]
            .sort((a, b) => a.id.localeCompare(b.id))
            .map(t => `${t.id}-${t.status}-${t.name}-${t.deadline}`)
            .join("|");
          
          localStorage.setItem("proactive_tasks_fingerprint", currentFingerprint);
          localStorage.setItem("proactive_capacity_alerts", JSON.stringify({
            alerts,
            summary: data.overallSummary,
            updatedAt: Date.now()
          }));
          window.dispatchEvent(new Event('capacity-alerts-updated'));
        }
      } catch (err) {
        console.error("Strategy Insight Error:", err);
      } finally {
        setLoading(false);
      }
    };

    // Listen for global task updates (e.g., from the Assistant)
    const handleSync = () => fetchInsights();
    window.addEventListener('notion-tasks-updated', handleSync);
    
    // Initial fetch if needed
    if (tasks.length > 0 && !initialReport) {
      fetchInsights();
    } else if (tasks.length === 0) {
      setLoading(false);
    }

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

  if (!tasks.length || !report?.insights.length) {
    return (
      <div className="text-center py-24 bg-white rounded-[3rem] border border-slate-100 shadow-sm">
        <LayoutDashboard className="mx-auto text-slate-200 mb-6" size={64} />
        <h3 className="text-xl font-bold text-slate-800 mb-2">No Active Tasks Found</h3>
        <p className="max-w-xs mx-auto text-sm text-slate-500">Add chores or projects to your Notion databases to enable strategic analysis.</p>
      </div>
    );
  }

  const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done");

   return (
    <div className="space-y-10 animate-in fade-in zoom-in-95 duration-1000">
      {/* Top Header Card: Cinematic Strategy Overlook */}
      <div className="bg-slate-900 rounded-[3.5rem] p-12 text-white shadow-xl relative overflow-hidden group">
         {/* Animated Grid Overlay */}
         <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay"></div>

         <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-10">
            <div className="space-y-6 max-w-2xl">
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
                      {report.insights.filter(i => i.status === "OVERLOADED").length} Days
                    </span>
                  </div>
               </div>
            </div>
            <Brain size={200} className="absolute -bottom-16 -right-16 text-white/5 group-hover:scale-110 group-hover:rotate-6 transition-all duration-1000 pointer-events-none" />
         </div>
      </div>

      {/* Capacity Grid: Premium Analytical Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {report.insights.map((insight, idx) => {
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
                  <span className="text-5xl font-black text-slate-900 tracking-tighter leading-none">{insight.totalHours.toFixed(1)}</span>
                  <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.15em]">Estimated Hours</span>
               </div>

               {/* Task List: Precise Ledger Style */}
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

               {/* Strategy Recommendation: Cinematic Look */}
               {insight.suggestion && (
                 <div className={`mt-auto p-6 rounded-[1.5rem] border shadow-sm relative overflow-hidden group/sugg transition-all duration-500 ${isOverload 
                    ? 'bg-rose-50 border-rose-100 group-hover:bg-rose-100' 
                    : 'bg-indigo-50 border-indigo-100 group-hover:bg-indigo-100'}`}>
                    <div className="flex items-start gap-4 relative z-10">
                       <Zap size={18} className={`mt-1 flex-shrink-0 fill-current ${isOverload ? 'text-rose-500' : 'text-indigo-600'}`} />
                       <div className="flex flex-col gap-1">
                          <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${isOverload ? 'text-rose-400' : 'text-indigo-400'}`}>Agent Mitigator</span>
                          <p className={`text-xs font-black leading-relaxed tracking-tight ${isOverload ? 'text-rose-900' : 'text-indigo-900'}`}>
                            {insight.suggestion}
                          </p>
                       </div>
                    </div>
                    {/* Decorative Background Icon */}
                    <Brain size={100} className={`absolute -bottom-10 -right-10 opacity-[0.03] pointer-events-none group-hover/sugg:scale-110 transition-transform ${isOverload ? 'text-rose-900' : 'text-indigo-900'}`} />
                 </div>
               )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
