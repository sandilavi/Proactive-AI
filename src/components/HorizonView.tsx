"use client";
import React, { useState } from 'react';
import { 
  Compass, 
  Map, 
  Clock,
  Zap,
  Loader2,
  ArrowRight,
  Layers,
  Sparkles,
  Check
} from 'lucide-react';
import { generateHorizonRoadmap, HorizonRoadmap } from "@/app/actions/horizon-actions";
import { batchCreateNotionTasks } from "@/app/actions/notion-actions";

export default function HorizonView() {
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [roadmap, setRoadmap] = useState<HorizonRoadmap | null>(null);
  const [thinkOpen, setThinkOpen] = useState(false);
  const [syncSuccess, setSyncSuccess] = useState(false);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || loading) return;
    setLoading(true);
    setRoadmap(null);
    setSyncSuccess(false);
    try {
      const data = await generateHorizonRoadmap(goal);
      setRoadmap(data);
    } catch (err) {
      console.error("Horizon Generation Error:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleExport = async () => {
    if (!roadmap || syncing || syncSuccess) return;
    setSyncing(true);
    try {
      const tasksToSync = roadmap.tasks.map(t => ({
        title: t.title,
        date: t.date
      }));
      const res = await batchCreateNotionTasks(tasksToSync);
      if (res.success) {
        setSyncSuccess(true);
      } else {
        alert("Export failed: " + res.error);
      }
    } catch (err) {
      console.error("Export Error:", err);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div className="space-y-6">
      
      {/* Input Area */}
      <form onSubmit={handleGenerate} className="bg-white border border-slate-200 rounded-lg p-6 relative flex flex-col gap-4 shadow-sm">
         <div className="space-y-1">
            <h2 className="text-lg font-bold text-slate-900 flex items-center gap-2">
               <Compass size={18} className="text-slate-600" />
               Plot Your Next Big Move
            </h2>
            <p className="text-xs text-slate-500 pl-6">
               Describe a large project or objective. Our strategic AI will engineer a precision sequence of actionable daily steps.
            </p>
         </div>
         
         <div className="flex flex-col sm:flex-row gap-3 pt-2">
            <input 
               type="text" 
               value={goal}
               onChange={(e) => setGoal(e.target.value)}
               placeholder="e.g. Draft a plan to make a commercial website within 2 weeks"
               className="flex-grow p-3 rounded border border-slate-300 outline-none text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:border-slate-500"
               disabled={loading}
            />
            <button 
               type="submit" 
               disabled={loading || !goal.trim()} 
               className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
               {loading ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} className="fill-current" />}
               <span>{loading ? "Calculating..." : "Generate Roadmap"}</span>
            </button>
         </div>
      </form>

      {/* Results Area */}
      {roadmap && (
        <div className="space-y-6">
           {/* Summary Header */}
           <div className="bg-slate-900 rounded-lg p-6 text-white relative">
             <div className="space-y-3">
               <div>
                 <span className="px-2 py-0.5 rounded bg-blue-600 text-white text-[10px] font-bold uppercase tracking-wider mb-2 inline-block">
                   Horizon Blueprint
                 </span>
                 <h3 className="text-lg font-bold text-white leading-tight">
                   {roadmap.projectTitle}
                 </h3>
               </div>
               <p className="text-xs text-slate-300 leading-relaxed">
                 {roadmap.summary}
               </p>
             </div>

             {roadmap.thinkContext && (
               <div className="mt-4 pt-4 border-t border-slate-800">
                 <button
                   type="button"
                   onClick={() => setThinkOpen(!thinkOpen)}
                   className="flex items-center gap-1.5 text-xs text-indigo-300 hover:text-indigo-250 transition-colors cursor-pointer"
                 >
                   <Zap size={10} className={thinkOpen ? "text-indigo-400" : ""} />
                   <span>{thinkOpen ? "Collapse Intelligence" : "Expand Intelligence"}</span>
                   <svg
                     viewBox="0 0 24 24"
                     fill="none"
                     stroke="currentColor"
                     strokeWidth="3"
                     className={`w-3 h-3 transition-transform duration-300 ${thinkOpen ? "rotate-180" : "rotate-0"}`}
                   >
                     <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                   </svg>
                 </button>
                 {thinkOpen && (
                   <div className="mt-3 p-3 bg-slate-800/50 border border-slate-700 rounded text-xs text-slate-300 font-mono whitespace-pre-wrap">
                     {roadmap.thinkContext}
                   </div>
                 )}
               </div>
             )}
             
             <div className="mt-4 pt-4 border-t border-slate-800 flex gap-6">
                <div>
                   <span className="text-[10px] font-bold uppercase text-slate-400 tracking-wider block mb-0.5">Duration</span>
                   <span className="text-base font-bold">
                     {new Set(roadmap.tasks.map(t => t.date)).size} {new Set(roadmap.tasks.map(t => t.date)).size === 1 ? 'Day' : 'Days'}
                   </span>
                </div>
             </div>
           </div>

           {/* Timeline */}
           <div className="relative pl-14">
             {/* Timeline Main Line */}
             <div className="absolute left-[1.45rem] top-0 bottom-0 w-[2px] bg-slate-200"></div>
             
             <div className="space-y-6">
               {roadmap.tasks.map((task, idx) => {
                  const taskDate = new Date(task.date);
                  return (
                    <div key={idx} className="relative">
                       {/* Timeline Node */}
                       <div className="absolute -left-14 top-1 flex flex-col items-center">
                          <div className="w-10 h-10 rounded border border-slate-200 bg-white flex flex-col items-center justify-center text-slate-700 z-10 text-[9px] font-bold">
                             <span className="uppercase text-[8px] opacity-75">{taskDate.toLocaleDateString([], { month: 'short' })}</span>
                             <span className="leading-none mt-0.5">{taskDate.getDate()}</span>
                          </div>
                       </div>
                       
                       <div className="bg-white border border-slate-200 rounded-lg p-5 shadow-sm relative flex flex-col gap-3">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                             <div>
                                <h4 className="text-sm font-bold text-slate-900 uppercase">{task.title}</h4>
                                <span className="text-[9px] text-slate-400 uppercase font-semibold">Active Phase</span>
                             </div>
                             
                             <div className="text-[10px] font-semibold text-slate-600 bg-slate-100 px-2 py-1 rounded border border-slate-200 self-start sm:self-center">
                                Allocated Time: {task.durationHours}h
                             </div>
                          </div>
                          
                          <p className="text-xs text-slate-600 leading-relaxed">
                            {task.reason}
                          </p>
                       </div>
                    </div>
                  );
               })}
             </div>
           </div>
           
           <div className="pt-4 text-center">
               <button 
                 onClick={handleExport}
                 disabled={syncing || syncSuccess}
                 className={`inline-flex items-center gap-2 px-6 py-3 rounded font-bold uppercase tracking-wider transition-colors border text-xs cursor-pointer disabled:cursor-not-allowed ${syncSuccess ? "bg-emerald-50 text-emerald-600 border-emerald-100" : "bg-slate-900 text-white border-slate-800 hover:bg-slate-800 active:scale-95"}`}
               >
                 {syncing ? (
                    <Loader2 size={12} className="animate-spin text-blue-400" />
                 ) : syncSuccess ? (
                    <div className="flex items-center gap-1.5">
                       <Check size={12} strokeWidth={3} />
                       <span>Export Complete</span>
                    </div>
                 ) : (
                    <div className="flex items-center gap-1.5">
                       <span>Deploy Blueprint to Notion</span>
                       <ArrowRight size={12} />
                    </div>
                 )}
               </button>
           </div>
        </div>
      )}
    </div>
  );
}
