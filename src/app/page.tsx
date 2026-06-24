import Link from "next/link";
import { ArrowRight, Brain, Zap, Sparkles, Compass, Target, BellRing } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-slate-50 text-slate-900">
      
      {/* Navigation */}
      <nav className="sticky top-0 z-50 bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3">
            <img src="/icon.png" alt="ProActiveAI" className="h-8 w-8" />
            <div className="flex flex-col">
              <span className="text-lg font-bold text-slate-900">
                ProActiveAI
              </span>
              <span className="text-[9px] uppercase tracking-wider text-slate-500">Notion Task Strategy</span>
            </div>
          </Link>

          <Link 
            href="/dashboard"
            className="flex items-center gap-1.5 px-4 py-2 rounded bg-slate-900 text-white font-semibold text-xs hover:bg-slate-800 transition-colors"
          >
            Dashboard <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-grow">
        <section className="max-w-4xl mx-auto px-6 py-16 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded bg-blue-50 border border-blue-100 text-xs font-semibold text-blue-700 mb-6">
            <Zap size={14} className="fill-current" /> Active Notion Synchronization
          </div>
          
          <h1 className="text-3xl md:text-5xl font-bold text-slate-900 tracking-tight mb-4">
            The Task Manager That Thinks Ahead.
          </h1>

          <p className="max-w-xl mx-auto text-sm md:text-base text-slate-600 mb-8 leading-relaxed">
            ProActiveAI helps synchronize and optimize your Notion databases with local strategic insights, estimating tasks, and managing capacity slots.
          </p>

          <div className="flex justify-center">
            <Link 
              href="/dashboard"
              className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs uppercase tracking-wider rounded transition-colors flex items-center gap-2"
            >
              Go To Dashboard <Sparkles size={14} />
            </Link>
          </div>
        </section>

        {/* Feature Grid */}
        <section className="max-w-5xl mx-auto px-6 py-12 border-t border-slate-200">
          <div className="text-center mb-10">
            <span className="px-2.5 py-1 bg-slate-100 text-slate-600 rounded text-xs font-semibold uppercase tracking-wider">
               System Modules
            </span>
            <h2 className="text-2xl font-bold text-slate-900 mt-3">Simple Strategic Tools</h2>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Feature 1 */}
            <div className="p-6 bg-white border border-slate-200 rounded-lg flex flex-col gap-3 shadow-sm">
              <div className="w-10 h-10 bg-slate-100 text-slate-800 rounded flex items-center justify-center">
                <Brain size={20} />
              </div>
              <h3 className="text-base font-bold text-slate-900">Neural Strategy</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Context-aware planning engine that synthesizes multi-step roadmaps from simple goals, instantly updating your Notion workspace.
              </p>
            </div>

            {/* Feature 2 */}
            <div className="p-6 bg-white border border-slate-200 rounded-lg flex flex-col gap-3 shadow-sm">
              <div className="w-10 h-10 bg-slate-100 text-slate-800 rounded flex items-center justify-center">
                <Compass size={20} />
              </div>
              <h3 className="text-base font-bold text-slate-900">Horizon Blueprint</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Decomposes larger goals into actionable day-by-day tasks and syncs them automatically to shared databases.
              </p>
            </div>

            {/* Feature 3 */}
            <div className="p-6 bg-white border border-slate-200 rounded-lg flex flex-col gap-3 shadow-sm">
              <div className="w-10 h-10 bg-slate-100 text-slate-800 rounded flex items-center justify-center">
                <BellRing size={20} />
              </div>
              <h3 className="text-base font-bold text-slate-900">Proactive Urgency</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Monitors deadline intervals in real time, alerting you of key overlaps or immediate constraints.
              </p>
            </div>
          </div>
        </section>

        {/* Call to Action */}
        <section className="max-w-4xl mx-auto px-6 py-12">
          <div className="bg-slate-100 border border-slate-200 rounded-lg p-10 text-center">
             <div className="flex flex-col items-center gap-4">
                <span className="px-2.5 py-0.5 rounded bg-blue-50 text-blue-700 border border-blue-100 text-xs font-semibold flex items-center gap-1">
                  <Target size={12} /> Ready for Operation
                </span>
                <h2 className="text-xl md:text-2xl font-bold text-slate-900">Start Planning Better Today</h2>
                <p className="text-xs text-slate-600 max-w-md">
                   Get connected to your Notion task vaults and visualize workload capacity directly.
                </p>
                <Link 
                  href="/dashboard"
                  className="inline-flex items-center gap-2 px-6 py-2.5 bg-slate-900 text-white hover:bg-slate-800 font-bold text-xs uppercase tracking-wider rounded transition-colors"
                >
                  Launch Workspace <ArrowRight size={14} />
                </Link>
             </div>
          </div>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-8 border-t border-slate-200 text-center text-xs text-slate-500 bg-white">
         <p>&copy; 2026 ProActiveAI &bull; Clean Productivity Suite</p>
      </footer>
    </div>
  );
}
