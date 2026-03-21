"use client";
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Brain, 
  LayoutDashboard, 
  Sparkles, 
  Settings, 
  ChevronRight,
  LogOut,
  Calendar,
  Trophy,
  Activity,
  Compass
} from 'lucide-react';

export default function Sidebar() {
  const pathname = usePathname();

  const navItems = [
    { 
      name: 'Assistant', 
      href: '/dashboard', 
      icon: LayoutDashboard,
      description: 'Chat & Task Management'
    },
    { 
      name: 'Strategy', 
      href: '/dashboard/strategy', 
      icon: Brain,
      description: 'Capacity & Load Analysis'
    },
    { 
      name: 'Growth Lab', 
      href: '/dashboard/growth', 
      icon: Trophy,
      description: 'Skill Tree & XP Tracking'
    },
    { 
      name: 'Pulse', 
      href: '/dashboard/pulse', 
      icon: Activity,
      description: 'Predictive Productivity Analytics'
    },
    { 
      name: 'Horizon', 
      href: '/dashboard/horizon', 
      icon: Compass,
      description: 'AI Project Breakdown'
    },
    { 
      name: 'Calendar', 
      href: '#', 
      icon: Calendar,
      description: 'Visual Schedule (Soon)',
      disabled: true
    },
  ];

  return (
    <aside className="w-80 min-h-screen bg-white/80 backdrop-blur-3xl border-r border-slate-100/60 flex flex-col sticky top-0 shadow-[20px_0_40px_-15px_rgba(0,0,0,0.02)]">
      {/* Brand: Industrial High-End */}
      <div className="p-10">
        <Link href="/dashboard" className="flex items-center gap-4 group">
          <div className="relative">
             <div className="absolute -inset-2 bg-blue-500/10 rounded-full blur-xl opacity-0 group-hover:opacity-100 transition-opacity duration-700"></div>
             <img src="/icon.png" alt="ProActiveAI" className="h-12 w-12 hover:scale-110 rotate-0 group-hover:rotate-[360deg] transition-all duration-1000 relative z-10" />
          </div>
          <div className="flex flex-col">
             <span className="text-2xl font-black text-slate-900 tracking-tighter leading-none">
               ProActive<span className="text-blue-600">AI</span>
             </span>
             <span className="text-[9px] font-black uppercase tracking-[0.3em] text-slate-400 mt-1">Command Center</span>
          </div>
        </Link>
      </div>

      {/* Main Nav: Precision Nodes */}
      <nav className="flex-1 px-5 space-y-3">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.name}
              href={item.disabled ? '#' : item.href}
              className={`
                group relative flex items-center gap-5 px-5 py-4 rounded-[1.5rem] transition-all duration-500
                ${item.disabled ? 'opacity-30 cursor-not-allowed' : 'cursor-pointer'}
                ${isActive 
                  ? 'bg-blue-600 text-white shadow-xl shadow-blue-200/50 translate-x-1' 
                  : 'text-slate-500 hover:bg-slate-50/80 hover:text-slate-900 hover:translate-x-1'
                }
              `}
            >
              {/* Active Glow */}
              {isActive && (
                <div className="absolute -inset-1 bg-blue-400/20 rounded-[1.6rem] blur-xl animate-pulse"></div>
              )}

              <div className={`
                relative z-10 p-3 rounded-[1rem] transition-all duration-500
                ${isActive ? 'bg-white/20' : 'bg-slate-50 group-hover:bg-white group-hover:shadow-sm'}
              `}>
                <Icon size={20} className={isActive ? 'text-white' : 'text-slate-500 group-hover:text-blue-600'} />
              </div>
              <div className="relative z-10 flex flex-col">
                <span className={`text-[15px] font-black tracking-tight ${isActive ? 'text-white' : 'text-slate-800'}`}>
                   {item.name}
                </span>
                <span className={`text-[10px] font-bold uppercase tracking-widest opacity-60 leading-tight mt-0.5 ${isActive ? 'text-blue-100' : 'text-slate-400'}`}>
                   {item.description}
                </span>
              </div>
              {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-white animate-pulse"></div>}
            </Link>
          );
        })}
      </nav>

      {/* Footer / Account: Premium Member Card */}
      <div className="p-8 mt-auto border-t border-slate-50/80 relative">
        <button className="relative group/account flex items-center gap-4 w-full p-4 rounded-[2rem] bg-slate-50/50 hover:bg-white hover:shadow-xl transition-all duration-500 border border-transparent hover:border-slate-100 cursor-pointer overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/5 to-transparent opacity-0 group-hover/account:opacity-100 transition-opacity"></div>
          
          <div className="relative w-12 h-12 rounded-[1rem] bg-white border border-slate-200 flex items-center justify-center font-black text-slate-800 shadow-sm group-hover/account:scale-110 transition-transform">
            S
          </div>
          <div className="relative text-left flex-1">
            <p className="text-sm font-black text-slate-900 leading-tight">Sandilavi</p>
            <div className="flex items-center gap-1.5 mt-0.5">
               <div className="w-1.5 h-1.5 rounded-full bg-blue-500"></div>
               <p className="text-[10px] font-black uppercase tracking-widest text-blue-600">Premium Control</p>
            </div>
          </div>
          <LogOut size={16} className="relative text-slate-300 group-hover/account:text-rose-500 transition-colors" />
        </button>
      </div>
    </aside>
  );
}
