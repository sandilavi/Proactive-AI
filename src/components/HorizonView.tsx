"use client";
import React, { useState } from 'react';
import { 
  Compass, 
  Map, 
  Flag,
  CalendarDays,
  Clock,
  Zap,
  Loader2,
  ArrowRight,
  Layers,
  Sparkles
} from 'lucide-react';
import { generateHorizonRoadmap, HorizonRoadmap } from "@/app/actions/agent-actions";

export default function HorizonView() {
  const [goal, setGoal] = useState("");
  const [loading, setLoading] = useState(false);
  const [roadmap, setRoadmap] = useState<HorizonRoadmap | null>(null);

  const handleGenerate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!goal.trim() || loading) return;
    setLoading(true);
    setRoadmap(null);
    try {
      const data = await generateHorizonRoadmap(goal);
      setRoadmap(data);
    } catch (err) {
      console.error("Horizon Generation Error:", err);
    } finally {
      setLoading(false);
    }
  };

   return (
    <div className="space-y-12 animate-in fade-in zoom-in-95 duration-700">
      
      {/* Input Area: Premium Glassmorphism */}
      <form onSubmit={handleGenerate} className="bg-white/80 backdrop-blur-2xl rounded-[3rem] p-10 border border-white/40 shadow-[0_32px_80px_-15px_rgba(0,0,0,0.08)] relative overflow-hidden group transition-all duration-700 hover:shadow-[0_45px_100px_-20px_rgba(0,0,0,0.12)]">
         {/* Background Decoration */}
         <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-br from-indigo-500/10 to-transparent rounded-bl-full opacity-50 pointer-events-none transition-all duration-700 group-hover:scale-110 group-hover:rotate-6"></div>
         
         <div className="relative z-10 space-y-6 max-w-3xl">
            <div className="space-y-2">
               <h2 className="text-3xl font-black text-slate-800 tracking-tight flex items-center gap-3">
                  <div className="p-2 bg-indigo-600 rounded-2xl text-white shadow-lg shadow-indigo-200">
                    <Compass size={28} />
                  </div>
                  Plot Your Next Big Move
               </h2>
               <p className="text-base text-slate-500 font-medium leading-relaxed pl-1">
                  Describe a large project or objective. Our strategic AI will engineer a precision-sliced sequence of actionable daily steps.
               </p>
            </div>
            
            <div className="flex flex-col sm:flex-row gap-4 pt-4 relative">
               <div className="flex-1 relative group/input">
                 {/* Input Glow */}
                 <div className="absolute -inset-1 bg-gradient-to-r from-indigo-500/0 via-indigo-500/10 to-indigo-500/0 rounded-[1.5rem] blur-xl opacity-0 group-focus-within/input:opacity-100 transition-opacity duration-700 pointer-events-none"></div>
                 
                 <input 
                    type="text" 
                    value={goal}
                    onChange={(e) => setGoal(e.target.value)}
                    placeholder="e.g. Architect a SaaS platform using Next.js 15 and Supabase"
                    className="relative w-full p-6 pr-16 rounded-[1.2rem] border border-slate-200/60 outline-none transition-all duration-500 focus:border-indigo-500/30 focus:bg-white focus:ring-4 focus:ring-indigo-500/5 bg-slate-50/50 text-slate-800 font-bold placeholder:text-slate-400 placeholder:font-medium text-lg leading-tight"
                    disabled={loading}
                 />
               </div>
               <button 
                  type="submit" 
                  disabled={loading || !goal.trim()} 
                  className="px-10 py-6 bg-indigo-600 hover:bg-black text-white rounded-[1.2rem] font-black text-sm uppercase tracking-[0.2em] flex items-center justify-center gap-3 transition-all duration-500 shadow-xl shadow-indigo-200/50 hover:shadow-black/20 disabled:opacity-30 disabled:cursor-not-allowed group-hover:scale-[1.02] active:scale-95"
               >
                  {loading ? <Loader2 size={18} className="animate-spin" /> : <Zap size={18} className="fill-current" />}
                  <span>{loading ? "Calculating..." : "Generate Roadmap"}</span>
               </button>
            </div>
         </div>
         <Map size={180} className="absolute -bottom-16 -right-16 text-indigo-500/5 opacity-40 group-hover:opacity-100 transition-all duration-1000 group-hover:rotate-12 group-hover:scale-110" />
      </form>

      {/* Results Area */}
      {roadmap && (
        <div className="animate-in slide-in-from-bottom-12 duration-1000 space-y-12">
           {/* Summary Header: Cinematic Look */}
           <div className="bg-gradient-to-br from-indigo-700 via-indigo-800 to-black rounded-[3.5rem] p-12 text-white shadow-2xl shadow-indigo-200/50 relative overflow-hidden group">
             {/* Animated Overlay */}
             <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay"></div>
             
             <div className="relative z-10 max-w-2xl">
               <div className="inline-flex items-center gap-2.5 bg-white/10 backdrop-blur-xl px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.25em] border border-white/10 mb-6 shadow-2xl">
                  <Sparkles size={14} className="text-indigo-400" /> Strategic Blueprint
               </div>
               <h3 className="text-4xl font-black leading-tight tracking-tighter mb-6 bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/60">
                 {roadmap.projectTitle}
               </h3>
               <p className="text-indigo-100/80 font-bold leading-relaxed text-lg tracking-tight">
                 {roadmap.summary}
               </p>
             </div>
             
             <div className="absolute top-12 right-12 flex flex-col items-end">
                <div className="text-[10px] font-black uppercase tracking-[0.3em] text-white/40 mb-1">Duration</div>
                <div className="text-4xl font-black tabular-nums">{roadmap.tasks.length} Days</div>
             </div>
             
             <Layers size={300} className="absolute -bottom-24 -right-24 text-white/5 group-hover:scale-110 group-hover:-rotate-12 transition-all duration-1000" />
           </div>

           {/* Timeline: Refined Industrial Ledger */}
           <div className="relative px-4">
             {/* Timeline Main Line */}
             <div className="absolute left-[3.25rem] top-0 bottom-0 w-[2px] bg-gradient-to-b from-indigo-500/20 via-indigo-500/20 to-transparent"></div>
             
             <div className="space-y-8">
               {roadmap.tasks.map((task, idx) => (
                  <div key={idx} className="relative group/task pl-20">
                     {/* Timeline Node: Custom Pill */}
                     <div className="absolute left-0 top-0 bottom-0 flex flex-col items-center">
                        <div className="w-11 h-11 rounded-[1rem] bg-white border border-indigo-100 shadow-sm flex items-center justify-center text-[10px] font-black text-indigo-600 z-10 group-hover/task:bg-indigo-600 group-hover/task:text-white group-hover/task:scale-110 transition-all duration-500">
                           {task.dayOffset}
                        </div>
                     </div>
                     
                     <div className="bg-white/60 backdrop-blur-xl rounded-[2.5rem] border border-slate-100 p-8 shadow-sm transition-all duration-500 hover:shadow-xl hover:bg-white/90 hover:-translate-y-1 relative group hover:border-indigo-100/50">
                        <div className="flex flex-col md:flex-row md:items-center gap-5 justify-between mb-5">
                           <div className="flex items-center gap-4">
                              <div className="flex flex-col">
                                 <h4 className="text-xl font-black text-slate-800 tracking-tight leading-tight group-hover:text-indigo-600 transition-colors uppercase">{task.title}</h4>
                                 <div className="flex items-center gap-1.5 mt-1">
                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></div>
                                    <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Active Phase</span>
                                 </div>
                              </div>
                           </div>
                           <div className="flex items-center gap-2 text-[11px] font-black text-slate-500 bg-slate-50 px-4 py-2 rounded-full border border-slate-100 shadow-sm group-hover:bg-indigo-50 group-hover:text-indigo-600 transition-colors uppercase tracking-widest">
                              <Clock size={14} className="text-indigo-400" /> 
                              {task.estimatedHours}h Energy Reqd
                           </div>
                        </div>
                        
                        <p className="text-base text-slate-500 leading-relaxed font-bold opacity-80 group-hover:opacity-100 transition-opacity">
                          {task.description}
                        </p>

                        <div className="absolute top-8 right-8 text-[40px] font-black text-indigo-500/5 select-none pointer-events-none group-hover:text-indigo-500/10 transition-colors">
                           0{task.dayOffset}
                        </div>
                     </div>
                  </div>
               ))}
             </div>
           </div>
           
           <div className="pt-8 text-center">
             <button className="inline-flex items-center gap-3 px-8 py-4 rounded-2xl bg-slate-50 text-[11px] font-black text-slate-400 uppercase tracking-[0.3em] hover:text-indigo-600 hover:bg-indigo-50 transition-all duration-500 group border border-slate-100/60" disabled>
                <span>Directly Export to Notion</span>
                <div className="px-2 py-0.5 rounded-md bg-white border border-slate-100 text-[8px]">Coming Soon</div>
                <ArrowRight size={16} className="group-hover:translate-x-1 transition-transform" />
             </button>
           </div>
        </div>
      )}
    </div>
  );
}
