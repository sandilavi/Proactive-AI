"use client";
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Brain, 
  LayoutDashboard, 
  LogOut,
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
      name: 'Horizon', 
      href: '/dashboard/horizon', 
      icon: Compass,
      description: 'AI Project Breakdown'
    },
  ];

  return (
    <aside className="w-64 h-screen bg-white/80 backdrop-blur-3xl border-r border-slate-100/60 flex flex-col sticky top-0 shadow-[20px_0_40px_-15px_rgba(0,0,0,0.02)] overflow-hidden">
      {/* Brand: Industrial High-End */}
      <div className="p-8">
        <Link href="/dashboard" className="flex items-center gap-3 group">
          <div className="relative flex-shrink-0">
             {/* Logo Container: Removed redundant padding/BG because icon.png is already circular */}
             <div className="w-12 h-12 flex items-center justify-center transition-all duration-500 group-hover:scale-110 overflow-hidden">
                <img src="/icon.png" alt="ProActiveAI" className="w-full h-full object-contain relative z-10 rotate-0 group-hover:rotate-[360deg] transition-transform duration-1000" />
             </div>
          </div>
          <div className="flex flex-col">
             <span className="text-xl font-black text-slate-900 tracking-tighter leading-none">
               ProActive<span className="text-blue-600">AI</span>
             </span>
             <span className="text-[8px] font-black uppercase tracking-[0.3em] text-slate-400 mt-0.5">Command Center</span>
          </div>
        </Link>
      </div>

      {/* Main Nav: Precision Nodes */}
      <nav className="flex-1 px-4 space-y-2 overflow-y-auto scrollbar-hide py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                group relative flex items-center gap-4 px-4 py-3 rounded-[1.25rem] transition-all duration-500
                cursor-pointer
                ${isActive 
                  ? 'bg-blue-600 text-white shadow-xl translate-x-1' 
                  : 'text-slate-500 hover:bg-slate-50/80 hover:text-slate-900 hover:translate-x-1'
                }
              `}
            >

              <div className={`
                relative z-10 p-2.5 rounded-[0.8rem] transition-all duration-500
                ${isActive ? 'bg-white/20' : 'bg-slate-50 group-hover:bg-white group-hover:shadow-sm'}
              `}>
                <Icon size={18} className={isActive ? 'text-white' : 'text-slate-500 group-hover:text-blue-600'} />
              </div>
              <div className="relative z-10 flex flex-col">
                <span className={`text-sm font-black tracking-tight ${isActive ? 'text-white' : 'text-slate-800'}`}>
                   {item.name}
                </span>
                <span className={`text-[9px] font-bold uppercase tracking-widest opacity-60 leading-tight mt-0.5 ${isActive ? 'text-blue-100' : 'text-slate-400'}`}>
                   {item.description}
                </span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer / Logout: Balanced & Subtle */}
      <div className="p-4 mt-auto border-t border-slate-50/80 bg-white/50 backdrop-blur-md">
        <Link 
          href="/" 
          className="flex items-center justify-center gap-3 w-full py-4 rounded-[1.5rem] bg-slate-50 hover:bg-rose-50 text-slate-500 hover:text-rose-600 border border-slate-100 hover:border-rose-100 transition-all duration-300 group cursor-pointer"
        >
          <LogOut size={18} strokeWidth={3} className="text-slate-400 group-hover:text-rose-500 transition-all" />
          <span className="text-[12px] font-black uppercase tracking-[0.2em]">Logout</span>
        </Link>
      </div>
    </aside>
  );
}
