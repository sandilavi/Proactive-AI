"use client";
import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { 
  Brain, 
  LayoutDashboard, 
  LogOut,
  Compass,
  Settings
} from 'lucide-react';

function formatModelName(id: string): string {
  if (!id) return "";
  const parts = id.split("/");
  return parts[parts.length - 1]
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

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

  const [activeModel, setActiveModel] = React.useState<string>("");

  React.useEffect(() => {
    async function loadModel() {
      const { getSelectedModel } = await import("@/app/actions/model-actions");
      const model = await getSelectedModel();
      setActiveModel(model);
    }
    loadModel();

    const handleModelChange = () => {
      loadModel();
    };

    window.addEventListener("model-changed", handleModelChange);
    return () => window.removeEventListener("model-changed", handleModelChange);
  }, []);

  return (
    <aside className="w-60 h-screen bg-white border-r border-slate-200 flex flex-col sticky top-0 overflow-hidden">
      {/* Brand */}
      <div className="p-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 flex items-center justify-center flex-shrink-0">
             <img src="/icon.png" alt="ProActiveAI" className="w-8 h-8 object-contain" />
          </div>
          <div className="flex flex-col">
             <span className="text-lg font-bold text-slate-900 tracking-tight leading-none">
               ProActiveAI
             </span>
             <span className="text-[9px] uppercase tracking-wider text-slate-400 mt-1">Command Center</span>
          </div>
        </div>
      </div>

      {/* Main Nav */}
      <nav className="flex-grow px-3 space-y-1 py-2">
        {navItems.map((item) => {
          const isActive = pathname === item.href;
          const Icon = item.icon;
          
          return (
            <Link
              key={item.name}
              href={item.href}
              className={`
                flex items-center gap-3 px-3 py-2 rounded transition-colors
                cursor-pointer text-xs font-semibold
                ${isActive 
                  ? 'bg-slate-900 text-white' 
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                }
              `}
            >
              <Icon size={16} />
              <div className="flex flex-col">
                <span>{item.name}</span>
                <span className={`text-[9px] font-normal leading-none mt-0.5 ${isActive ? 'text-slate-300' : 'text-slate-400'}`}>
                  {item.description}
                </span>
              </div>
            </Link>
          );
        })}
      </nav>

      {/* Footer / Logout */}
      <div>
        <div className="p-3">
          <Link
            href="/dashboard/settings"
            className={`
              flex items-center gap-3 px-3 py-2 rounded transition-colors
              cursor-pointer text-xs font-semibold
              ${pathname === '/dashboard/settings'
                ? 'bg-slate-900 text-white' 
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }
            `}
          >
            <Settings size={16} />
            <div className="flex flex-col">
              <span>Settings</span>
              <span className={`text-[9px] font-normal leading-none mt-0.5 ${pathname === '/dashboard/settings' ? 'text-slate-300' : 'text-slate-400'}`}>
                Model & Preferences
              </span>
            </div>
          </Link>
        </div>
        <div className="p-4 border-t border-slate-200 space-y-2">
          {activeModel && (
            <div className="p-2 rounded bg-slate-50 border border-slate-200 flex flex-col gap-1" title={`Active Model: ${activeModel}`}>
              <div className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0 animate-pulse" />
                <span className="text-[9px] uppercase tracking-wider text-slate-400 font-bold">Model</span>
              </div>
              <span className="text-[10px] font-bold text-slate-800 leading-tight break-words pl-3">
                {formatModelName(activeModel)}
              </span>
            </div>
          )}
          <Link 
            href="/" 
            className="flex items-center justify-center gap-2 w-full py-2.5 rounded bg-slate-100 hover:bg-rose-50 text-slate-600 hover:text-rose-700 border border-slate-200 hover:border-rose-200 transition-colors text-xs font-semibold"
          >
            <LogOut size={14} className="text-slate-500" />
            <span>LOGOUT</span>
          </Link>
        </div>
      </div>
    </aside>
  );
}
