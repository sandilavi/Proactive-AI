"use client";
import React, { useState, useEffect } from 'react';
import { 
  Sparkles, 
  Brain, 
  Zap, 
  LayoutDashboard, 
  Target, 
  Trophy,
  Loader2,
  TrendingUp,
  Star,
  Swords,
  Rocket
} from 'lucide-react';
import { getGrowthInsights, GrowthReport, NotionTask } from "@/app/actions/agent-actions";

interface GrowthViewProps {
  tasks: NotionTask[];
}

export default function GrowthView({ tasks }: GrowthViewProps) {
  const [report, setReport] = useState<GrowthReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInsights = async () => {
      setLoading(true);
      try {
        const data = await getGrowthInsights(tasks);
        setReport(data);
      } catch (err) {
        console.error("Growth Insight Error:", err);
      } finally {
        setLoading(false);
      }
    };

    if (tasks.length > 0) {
      fetchInsights();
    } else {
      setLoading(false);
    }
  }, [tasks]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32 bg-white rounded-[3rem] border border-slate-100 shadow-sm border-dashed">
        <Loader2 className="w-12 h-12 text-emerald-500 animate-spin mb-4" />
        <p className="text-lg font-bold text-slate-800">Analyzing your skill tree...</p>
        <p className="text-sm text-slate-500">Calculating XP points from your completed and active tasks.</p>
      </div>
    );
  }

  if (!tasks.length || !report?.skills.length) {
    return (
      <div className="text-center py-24 bg-white rounded-[3rem] border border-slate-100 shadow-sm">
        <Trophy className="mx-auto text-slate-200 mb-6" size={64} />
        <h3 className="text-xl font-bold text-slate-800 mb-2">No Skills Tracked Yet</h3>
        <p className="max-w-xs mx-auto text-sm text-slate-500">As you add and complete tasks in Notion, your RPG-style skill tree will grow here.</p>
      </div>
    );
  }

   return (
    <div className="space-y-10 animate-in fade-in zoom-in-95 duration-1000">
      {/* Top Header Card: Cinematic Character Status */}
      <div className="bg-gradient-to-br from-emerald-600 via-emerald-800 to-black rounded-[3.5rem] p-12 text-white shadow-2xl shadow-emerald-200/40 relative overflow-hidden group">
         {/* Particle Effect Overlay */}
         <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay"></div>
         <div className="absolute -top-24 -left-24 w-96 h-96 bg-emerald-500/20 rounded-full blur-[100px] animate-pulse"></div>

         <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-10">
            <div className="space-y-6 max-w-2xl">
               <div className="inline-flex items-center gap-2.5 bg-white/10 backdrop-blur-xl px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.25em] border border-white/10 shadow-2xl">
                  <Swords size={14} className="text-emerald-400" /> Operational Mastery
               </div>
               <h2 className="text-4xl font-black leading-tight tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/70">
                  {report.summary}
               </h2>
               <div className="flex gap-10 pt-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-white/40 tracking-[0.3em] mb-2">Prime Specialization</span>
                    <span className="text-3xl font-black tracking-tighter flex items-center gap-3">
                       <div className="p-2 bg-yellow-400/20 rounded-xl">
                          <Rocket size={24} className="text-yellow-400 fill-yellow-400" />
                       </div>
                       {report.topSkill}
                    </span>
                  </div>
               </div>
            </div>
            <Trophy size={200} className="absolute -bottom-16 -right-16 text-white/5 group-hover:scale-110 group-hover:-rotate-6 transition-all duration-1000 pointer-events-none" />
         </div>
      </div>

      {/* Skills Grid: Premium Interactive Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        {report.skills.map((skill, idx) => {
          const xpForCurrentLevel = (skill.level - 1) * 10;
          const xpForNextLevel = skill.level * 10;
          const progressPercent = Math.min(100, Math.max(0, ((skill.xp - xpForCurrentLevel) / 10) * 100));
          
          return (
            <div key={idx} className="bg-white/70 backdrop-blur-xl rounded-[2.5rem] border border-slate-100 p-10 shadow-sm transition-all duration-500 hover:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.08)] hover:-translate-y-2 relative overflow-hidden flex flex-col group border-b-slate-200/50">
               {/* Skill Rank Badge */}
               <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                  <Star size={120} className="fill-current text-emerald-900" />
               </div>

               <div className="flex items-center justify-between mb-8 relative z-10">
                  <h3 className="text-xl font-black text-slate-900 tracking-tight uppercase leading-none">{skill.skillName}</h3>
                  <div className="bg-emerald-50 text-emerald-600 p-3 rounded-[1.2rem] group-hover:bg-black group-hover:text-white transition-all duration-500 shadow-sm">
                    <Star size={20} className="fill-current" />
                  </div>
               </div>

               {/* Level Stats: High Impact */}
               <div className="flex items-end gap-3 mb-6 relative z-10">
                  <div className="flex flex-col">
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Current Tier</span>
                     <span className="text-5xl font-black text-slate-900 tracking-tighter flex items-baseline">
                        <span className="text-2xl text-emerald-500 font-black mr-2">LVL</span>{skill.level}
                     </span>
                  </div>
                  <div className="mb-2 ml-auto text-right">
                     <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest block">Accumulated XP</span>
                     <span className="text-sm font-black text-slate-800 tabular-nums">
                        {skill.xp.toFixed(1)}
                     </span>
                  </div>
               </div>

               {/* XP Bar: Laboratory Style */}
               <div className="mb-10 relative z-10">
                  <div className="flex justify-between text-[10px] font-black text-slate-400 mb-2 uppercase tracking-[0.15em]">
                     <span>Progress to Next Tier</span>
                     <span className="text-emerald-600">{xpForNextLevel - skill.xp < 0 ? 0 : (xpForNextLevel - skill.xp).toFixed(1)} XP REQD</span>
                  </div>
                  <div className="h-3 w-full bg-slate-100/50 rounded-full overflow-hidden p-0.5 border border-slate-50 shadow-inner">
                     <div 
                        className="h-full bg-gradient-to-r from-emerald-500 to-teal-600 rounded-full relative transition-all duration-1000 ease-out shadow-sm"
                        style={{ width: `${progressPercent}%` }}
                     >
                        <div className="absolute inset-0 bg-white/20 w-full h-full animate-[shimmer_2s_infinite]"></div>
                     </div>
                  </div>
               </div>

               {/* Recent Tasks: Industrial Ledger Style */}
               <div className="mt-auto space-y-4 pt-6 border-t border-slate-100 relative z-10">
                  <div className="flex items-center gap-2 mb-1">
                     <div className="w-1 h-4 bg-emerald-500 rounded-full"></div>
                     <span className="text-[10px] font-black uppercase text-slate-500 tracking-[0.2em]">Latest Operations</span>
                  </div>
                  <div className="space-y-3">
                    {skill.recentTasks?.map((taskName, tidx) => (
                      <div key={tidx} className="flex items-start gap-3 group/item">
                         <div className="w-1.5 h-1.5 rounded-full bg-slate-200 mt-1.5 group-hover/item:bg-emerald-500 transition-colors"></div>
                         <span className="text-xs font-bold text-slate-600 line-clamp-1 group-hover/item:text-slate-900 transition-colors">{taskName}</span>
                      </div>
                    ))}
                    {(!skill.recentTasks || skill.recentTasks.length === 0) && (
                       <span className="text-[11px] text-slate-400 font-bold uppercase tracking-widest opacity-60">Standby: No recent operations</span>
                    )}
                  </div>
               </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
