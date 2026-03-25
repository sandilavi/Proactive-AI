import Link from "next/link";
import { ArrowRight, Brain, Zap, Sparkles, Compass, Activity, Target, BellRing } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-[#fcfcfd] text-slate-900 selection:bg-blue-100 selection:text-blue-900 relative overflow-hidden">
      
      {/* Premium Background Elements */}
      <div className="fixed top-0 left-0 w-full h-full pointer-events-none z-0">
      </div>

      {/* Navigation: Industrial Precision */}
      <nav className="fixed top-0 w-full z-50 bg-white/40 backdrop-blur-2xl border-b border-slate-200/40 shadow-sm shadow-slate-200/10">
        <div className="max-w-7xl mx-auto px-10 h-20 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-4 group transition-all duration-500">
             <div className="relative">
                <div className="absolute -inset-2 "></div>
                <img src="/icon.png" alt="ProActiveAI" className="h-10 w-10 relative z-10 group-hover:rotate-[360deg] transition-all duration-1000" />
             </div>
             <div className="flex flex-col">
                <span className="text-2xl font-black text-slate-900 tracking-tighter leading-none">
                  ProActive<span className="text-blue-600 font-black">AI</span>
                </span>
                <span className="text-[8px] font-black uppercase tracking-[0.4em] text-slate-400 mt-1">Intelligence Division</span>
             </div>
          </Link>

          <Link 
            href="/dashboard"
            className="group relative flex items-center gap-2.5 px-6 py-3 rounded-full bg-slate-900 text-white font-black text-xs uppercase tracking-widest hover:bg-blue-600 transition-all shadow-xl shadow-sm hover:shadow-md hover:-translate-y-0.5 active:scale-95"
          >
            Dashboard <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
          </Link>
        </div>
      </nav>

      {/* Hero Section: Cinematic High-End */}
      <main className="flex-grow relative z-10 pt-44 pb-32">
        <section className="max-w-6xl mx-auto px-10 text-center relative">
          <div className="inline-flex items-center gap-3 px-5 py-2.5 rounded-full bg-white/60 backdrop-blur-xl border border-slate-200/50 text-[10px] font-black uppercase tracking-[0.3em] text-slate-500 mb-10 shadow-sm animate-in fade-in zoom-in-95 duration-700">
            <Zap className="w-3.5 h-3.5 fill-blue-500 text-blue-500" /> Neural Sync with Notion Active
          </div>
          
          <h1 className="text-6xl md:text-8xl font-black text-slate-900 tracking-tighter leading-[0.95] mb-10 animate-in slide-in-from-bottom-12 duration-1000">
            The Task Manager <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 via-indigo-600 to-purple-600">That Thinks Ahead.</span>
          </h1>

          <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-500/80 mb-14 leading-relaxed font-bold tracking-tight animate-in slide-in-from-bottom-12 duration-1000 delay-200 pr-4">
            ProActiveAI bridges the gap between static databases and autonomous intelligence. Direct synchronization with Notion, powered by multi-engine neural processing.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-6 animate-in slide-in-from-bottom-12 duration-1000 delay-400">
            <Link 
              href="/dashboard"
              className="w-full sm:w-auto px-12 py-6 bg-slate-900 text-white font-black text-sm uppercase tracking-widest rounded-[2rem] hover:bg-blue-600 transition-all shadow-2xl shadow-lg hover:shadow-black/20 hover:-translate-y-1 active:scale-95 flex items-center gap-3"
            >
              Go To Dashboard <Sparkles size={16} />
            </Link>
           </div>
         </section>

        {/* Feature Grid: Precision Nodes */}
        <section className="max-w-7xl mx-auto px-10 py-44 relative">
          <div className="text-center mb-24 relative z-10">
            <div className="inline-flex items-center gap-3 text-blue-600 mb-4 px-4 py-1.5 bg-blue-50 rounded-full text-[10px] font-black uppercase tracking-[0.3em] border border-blue-100">
               <Activity size={14} /> System Core Modules
            </div>
            <h2 className="text-5xl font-black tracking-tighter mb-6">Designed for Operation Intensity.</h2>
            <p className="text-lg text-slate-500 font-bold max-w-xl mx-auto tracking-tight">Enterprise-grade capabilities distilled into a cinematic workspace experience.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-10">
            <div className="group p-10 bg-white/60 backdrop-blur-xl rounded-[3.5rem] border border-slate-100 border-slate-200 transition-all duration-700 hover:-translate-y-1 relative overflow-hidden flex flex-col min-h-[400px]">
              <div className="absolute top-0 right-0 p-8 opacity-[0.03] scale-150 group-hover:scale-110 transition-transform duration-1000">
                <Brain size={140} className="text-blue-900" />
              </div>
              <div className="w-16 h-16 bg-blue-600 text-white rounded-[1.5rem] flex items-center justify-center mb-10 shadow-xl shadow-md group-hover:rotate-[15deg] transition-transform duration-500">
                <Brain size={28} />
              </div>
              <h3 className="text-2xl font-black tracking-tighter mb-4">Neural Strategy</h3>
              <p className="text-slate-500 font-bold leading-relaxed tracking-tight mb-8">
                Context-aware planning engine that synthesizes multi-step roadmaps from simple goals, instantly updating your Notion workspace.
              </p>
            </div>

            <div className="group p-10 bg-white/60 backdrop-blur-xl rounded-[3.5rem] border border-slate-200 transition-all duration-700 hover:-translate-y-1 relative overflow-hidden flex flex-col min-h-[400px]">
               <div className="absolute top-0 right-0 p-8 opacity-[0.01] scale-150 group-hover:scale-110 transition-transform duration-1000">
                <Compass size={140} className="text-indigo-900" />
              </div>
              <div className="w-16 h-16 bg-slate-900 text-white rounded-[1.5rem] flex items-center justify-center mb-10 group-hover:rotate-[15deg] transition-transform duration-500">
                <Compass size={28} />
              </div>
              <h3 className="text-2xl font-black tracking-tighter mb-4">Horizon Blueprint</h3>
              <p className="text-slate-500 font-bold leading-relaxed tracking-tight mb-8">
                Autonomous project decomposition. I automatically discover and synchronize with all Notion databases shared with your workspace.
              </p>
            </div>

            <div className="group p-10 bg-white/60 backdrop-blur-xl rounded-[3.5rem] border border-slate-200 transition-all duration-700 hover:-translate-y-1 relative overflow-hidden flex flex-col min-h-[400px]">
               <div className="absolute top-0 right-0 p-8 opacity-[0.01] scale-150 group-hover:scale-110 transition-transform duration-1000">
                <BellRing size={140} className="text-rose-900" />
              </div>
              <div className="w-16 h-16 bg-slate-900 text-white rounded-[1.5rem] flex items-center justify-center mb-10 group-hover:rotate-[15deg] transition-transform duration-500">
                <BellRing size={28} />
              </div>
              <h3 className="text-2xl font-black tracking-tighter mb-4">Proactive Intelligence</h3>
              <p className="text-slate-500 font-bold leading-relaxed tracking-tight mb-8">
                Context-aware deadline monitoring. My neural engine classifies urgency in real-time and alerts you to mission-critical blockers.
              </p>
            </div>
          </div>
        </section>

        {/* Closing CTA: Industrial Action */}
        <section className="max-w-6xl mx-auto px-10 py-32 relative text-center">
           <div className="bg-slate-900 rounded-[4rem] p-24 relative overflow-hidden border border-slate-800">
              {/* Background Accents */}
              <div className="relative z-10 flex flex-col items-center gap-10">
                 <div className="inline-flex items-center gap-3 text-blue-400 text-[11px] font-black uppercase tracking-[0.5em] mb-4">
                    <Target size={16} /> Ready for Deployment
                 </div>
                 <h2 className="text-5xl md:text-7xl font-black text-white tracking-tighter leading-none mb-4 italic">Initialize Your Command <br /> Center Today.</h2>
                 <p className="text-xl text-blue-100/60 font-bold tracking-tight max-w-xl mx-auto mb-6">
                    Join the next generation of power-users leveraging proactive intelligence.
                 </p>
                 <Link 
                   href="/dashboard"
                   className="group relative inline-flex items-center gap-4 px-12 py-7 bg-white text-slate-900 font-black text-xl rounded-[2.5rem] hover:bg-blue-600 hover:text-white transition-all duration-500 shadow-2xl active:scale-95"
                 >
                   Launch ProActiveAI <ArrowRight className="group-hover:translate-x-2 transition-transform" />
                 </Link>
              </div>
           </div>
        </section>
      </main>

      {/* Footer: Precision Stats */}
      <footer className="relative z-10 py-16 px-10 border-t border-slate-200/60 text-center">
         <div className="max-w-7xl mx-auto flex flex-col items-center justify-center gap-10">
            <p className="text-[11px] font-black text-slate-400 uppercase tracking-[0.2em]">
               &copy; 2026 ProActiveAI &bull; Intelligent Productivity Suite
            </p>
         </div>
      </footer>
    </div>
  );
}
