import Link from "next/link";
import { ArrowRight, Brain, Zap, Layers, CheckCircle2 } from "lucide-react";

export default function LandingPage() {
  return (
    <div className="flex flex-col min-h-screen bg-white text-slate-900 selection:bg-blue-100 selection:text-blue-900">
      
      {/* Navigation */}
      <nav className="fixed top-0 w-full z-50 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2 group cursor-pointer transition-transform duration-300 hover:scale-[1.02]">
            <img src="/icon.png" alt="ProActiveAI" className="h-8 w-8 drop-shadow-sm" />
            <span className="font-bold text-xl tracking-tight">ProActive<span className="text-blue-600">AI</span></span>
          </div>
          <Link 
            href="/dashboard"
            className="flex items-center gap-2 px-5 py-2 rounded-full bg-slate-900 text-white font-medium text-sm hover:bg-slate-800 transition-all shadow-sm hover:shadow-md active:scale-95"
          >
            Go to Dashboard <ArrowRight className="w-4 h-4" />
          </Link>
        </div>
      </nav>

      {/* Hero Section */}
      <main className="flex-grow pt-32 pb-20">
        <section className="max-w-5xl mx-auto px-6 text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-blue-700 text-xs font-bold uppercase tracking-wider mb-6 animate-fade-in">
            <Zap className="w-3 h-3 fill-blue-700" /> Powered by Notion
          </div>
          <h1 className="text-5xl md:text-7xl font-black text-slate-900 tracking-tight leading-[1.1] mb-8 animate-in slide-in-from-bottom-6 duration-700">
            The Task Manager that <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-indigo-600">Thinks Ahead.</span>
          </h1>
          <p className="max-w-2xl mx-auto text-lg md:text-xl text-slate-500 mb-10 leading-relaxed font-medium animate-in slide-in-from-bottom-8 duration-900">
            Stop manually organizing. ProActiveAI connects your Notion workspace and uses intelligence to prioritize, plan, and automate your productivity.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 animate-in slide-in-from-bottom-10 duration-1000">
            <Link 
              href="/dashboard"
              className="w-full sm:w-auto px-8 py-4 bg-blue-600 text-white font-bold text-lg rounded-2xl hover:bg-blue-700 transition-all shadow-[0_10px_40px_-10px_rgba(37,99,235,0.4)] hover:shadow-[0_15px_50px_-12px_rgba(37,99,235,0.5)] active:scale-95"
            >
              Get Started for Free
            </Link>
          </div>
        </section>

        {/* Features Grid */}
        <section id="how-it-works" className="max-w-7xl mx-auto px-6 py-32 bg-slate-50 rounded-[4rem] my-20">
          <div className="text-center mb-20 px-4">
            <h2 className="text-3xl md:text-4xl font-black mb-4">Focus on What Matters.</h2>
            <p className="text-slate-500 font-medium">Your Notion databases, now with an added brain.</p>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="p-10 bg-white rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-xl transition-shadow group">
              <div className="w-14 h-14 bg-blue-50 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                <Brain className="w-7 h-7 text-blue-600" />
              </div>
              <h3 className="text-xl font-bold mb-4">Autonomous Planning</h3>
              <p className="text-slate-500 leading-relaxed">
                Give me a goal like &quot;Draft a plan to make an e-commerce website&quot; and I'll autonomously create a multi-step roadmap in your Notion database.
              </p>
            </div>

            <div className="p-10 bg-white rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-xl transition-shadow group">
              <div className="w-14 h-14 bg-indigo-50 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                <Layers className="w-7 h-7 text-indigo-600" />
              </div>
              <h3 className="text-xl font-bold mb-4">Multi-DB Discovery</h3>
              <p className="text-slate-500 leading-relaxed">
                I automatically find all your shared Notion databases. I can handle them all.
              </p>
            </div>

            <div className="p-10 bg-white rounded-[3rem] border border-slate-100 shadow-sm hover:shadow-xl transition-shadow group">
              <div className="w-14 h-14 bg-emerald-50 rounded-2xl flex items-center justify-center mb-8 group-hover:scale-110 transition-transform">
                <CheckCircle2 className="w-7 h-7 text-emerald-600" />
              </div>
              <h3 className="text-xl font-bold mb-4">Priority Awareness</h3>
              <p className="text-slate-500 leading-relaxed">
                I analyze your deadlines and suggest the most impactful task at any given moment. Just ask.
              </p>
            </div>
          </div>
        </section>

        {/* Closing CTA */}
        <section className="text-center py-20 px-6">
          <h2 className="text-3xl font-black mb-8 italic">Ready to master your workflow?</h2>
          <Link 
            href="/dashboard"
            className="inline-flex items-center gap-4 px-10 py-5 bg-slate-900 text-white font-black text-xl rounded-[2rem] hover:bg-slate-800 transition-all shadow-xl active:scale-95"
          >
            Open Dashboard Now
          </Link>
        </section>
      </main>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-slate-100 text-center text-slate-400 text-sm font-medium tracking-tight">
        &copy; 2026 ProActiveAI &bull; Intelligent Productivity
      </footer>
    </div>
  );
}
