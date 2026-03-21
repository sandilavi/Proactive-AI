"use client";
import React, { useState, useEffect } from 'react';
import { 
  Activity,
  HeartPulse,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Lightbulb,
  Loader2,
  PieChart
} from 'lucide-react';
import { getPulseInsights, PulseReport, NotionTask } from "@/app/actions/agent-actions";

interface PulseViewProps {
  tasks: NotionTask[];
}

export default function PulseView({ tasks }: PulseViewProps) {
  const [report, setReport] = useState<PulseReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchInsights = async () => {
      setLoading(true);
      try {
        const data = await getPulseInsights(tasks);
        setReport(data);
      } catch (err) {
        console.error("Pulse Insight Error:", err);
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
        <Loader2 className="w-12 h-12 text-rose-500 animate-spin mb-4" />
        <p className="text-lg font-bold text-slate-800">Checking your vitals...</p>
        <p className="text-sm text-slate-500">Analyzing completion rates and workflow habits.</p>
      </div>
    );
  }

  if (!tasks.length || !report) {
    return (
      <div className="text-center py-24 bg-white rounded-[3rem] border border-slate-100 shadow-sm">
        <Activity className="mx-auto text-slate-200 mb-6" size={64} />
        <h3 className="text-xl font-bold text-slate-800 mb-2">No Data Available</h3>
        <p className="max-w-xs mx-auto text-sm text-slate-500">Add more tasks to start calculating your productivity pulse.</p>
      </div>
    );
  }

   return (
    <div className="space-y-10 animate-in fade-in zoom-in-95 duration-1000">
      {/* Top Header Card: Cinematic Health Diagnostics */}
      <div className="bg-gradient-to-br from-rose-600 via-rose-800 to-black rounded-[3.5rem] p-12 text-white shadow-2xl shadow-rose-200/40 relative overflow-hidden group">
         {/* Animated Grid Overlay */}
         <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay"></div>
         <div className="absolute -top-24 -right-24 w-96 h-96 bg-rose-500/20 rounded-full blur-[100px] animate-pulse"></div>

         <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-10">
            <div className="space-y-6 max-w-2xl">
               <div className="inline-flex items-center gap-2.5 bg-white/10 backdrop-blur-xl px-5 py-2.5 rounded-full text-[11px] font-black uppercase tracking-[0.25em] border border-white/10 shadow-2xl">
                  <HeartPulse size={14} className="text-rose-400" /> System Vitality
               </div>
               <h2 className="text-4xl font-black leading-tight tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/70">
                  {report.summary}
               </h2>
               
               {/* Health Score Pill: High Impact */}
               <div className="flex gap-10 pt-4">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-white/40 tracking-[0.3em] mb-2">Efficiency Quotient</span>
                    <span className="text-5xl font-black tracking-tighter flex items-baseline gap-2">
                       {report.overallScore}
                       <span className="text-xl text-rose-400/60 font-black">/100</span>
                    </span>
                  </div>
               </div>
            </div>
            <PieChart size={200} className="absolute -bottom-16 -right-16 text-white/5 group-hover:scale-110 group-hover:-rotate-12 transition-all duration-1000 pointer-events-none" />
         </div>
      </div>

      {/* Recommendation Card: High-End Alert Style */}
      <div className="bg-white/60 backdrop-blur-xl border border-orange-100 p-8 rounded-[2.5rem] flex items-start gap-6 shadow-sm relative overflow-hidden group hover:border-orange-200/50 transition-all duration-500">
        <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.07] transition-opacity">
           <Lightbulb size={120} className="text-orange-900" />
        </div>
        <div className="p-4 bg-orange-50 rounded-[1.5rem] text-orange-500 shadow-sm border border-orange-100 group-hover:bg-orange-600 group-hover:text-white transition-all duration-500">
           <Lightbulb size={28} className="fill-current" />
        </div>
        <div className="relative z-10">
           <h4 className="text-[11px] font-black text-orange-800 uppercase tracking-[0.3em] mb-2">Neural Strategy Recommendation</h4>
           <p className="text-lg font-bold text-slate-800 leading-relaxed tracking-tight">{report.recommendation}</p>
        </div>
      </div>

      {/* Trends Grid: Premium Diagnostic Indicators */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-8">
        {report.trends.map((trend, idx) => {
          const isPos = trend.isPositive;
          return (
            <div key={idx} className="bg-white/70 backdrop-blur-xl rounded-[2.5rem] border border-slate-100 p-10 shadow-sm transition-all duration-500 hover:shadow-[0_40px_80px_-20px_rgba(0,0,0,0.08)] hover:-translate-y-2 relative overflow-hidden flex flex-col group">
               <div className="flex items-center justify-between mb-8">
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase text-slate-400 tracking-[0.2em] mb-2">{trend.trendName}</span>
                    <span className="text-3xl font-black text-slate-900 tracking-tighter uppercase">{trend.metric}</span>
                  </div>
                  <div className={`p-4 rounded-[1.5rem] transition-all duration-500 border shadow-sm ${isPos 
                     ? 'bg-emerald-50 text-emerald-600 border-emerald-100 group-hover:bg-emerald-600 group-hover:text-white' 
                     : 'bg-rose-50 text-rose-600 border-rose-100 group-hover:bg-rose-600 group-hover:text-white'}`}>
                    {isPos ? <TrendingUp size={24} /> : <TrendingDown size={24} />}
                  </div>
               </div>
               
               <p className="text-base text-slate-500 font-bold leading-relaxed opacity-80 group-hover:opacity-100 transition-opacity">
                 {trend.description}
               </p>

               {/* Background Accent */}
               <div className={`absolute top-0 right-0 w-24 h-24 blur-[60px] opacity-10 rounded-full transition-all duration-700 group-hover:scale-150 ${isPos ? 'bg-emerald-400' : 'bg-rose-400'}`}></div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
