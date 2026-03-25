"use client";
import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, BellRing, Clock, X, Terminal, Brain, Target } from 'lucide-react';

// Use local storage to persist notifications
type AgentAlert = {
    id: string;
    taskId: string;
    taskName: string;
    urgency: "OVERDUE" | "TODAY" | "TOMORROW" | "SOON";
    deadline?: string;
    alertedAt: number;
    timestamp: string;
};

const getFormattedAlertTime = (ms: number | undefined, timeString: string) => {
  if (!ms) return timeString;
  const now = new Date();
  const alert = new Date(ms);
  const isSameDay = now.getFullYear() === alert.getFullYear() &&
                  now.getMonth() === alert.getMonth() &&
                  now.getDate() === alert.getDate();
  if (isSameDay) return timeString; 
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = yesterday.getFullYear() === alert.getFullYear() &&
                    yesterday.getMonth() === alert.getMonth() &&
                    yesterday.getDate() === alert.getDate();
  if (isYesterday) return `Yesterday, ${timeString}`;
  return `${alert.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeString}`;
};

function formatDeadline(dateStr: string): string {
  if (!dateStr || dateStr === "No Deadline") return "\u2014";
  if (!dateStr.includes("T")) return dateStr;
  try {
    const date = new Date(dateStr);
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, "0");
    const dd = String(date.getDate()).padStart(2, "0");
    let hours = date.getHours();
    const minutes = String(date.getMinutes()).padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12 || 12;
    return `${yyyy}-${mm}-${dd} ${hours}.${minutes}${ampm}`;
  } catch {
    return dateStr;
  }
}

export default function DashboardHeader() {
  const pathname = usePathname();
  const [activeToasts, setActiveToasts] = useState<AgentAlert[]>([]);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);

  // Sync notifications from localStorage
  useEffect(() => {
    const syncToasts = () => {
      const stored = localStorage.getItem("proactive_active_toasts");
      if (stored) {
        try {
          const parsed = JSON.parse(stored) as AgentAlert[];
          setActiveToasts(parsed);
          
          const lastReadTime = Number(localStorage.getItem("proactive_last_read_timestamp") || 0);
          const newUnreads = parsed.filter(t => (t.alertedAt || 0) > lastReadTime).length;
          setUnreadCount(newUnreads);
        } catch (e) {
          console.error("Failed to parse toasts", e);
        }
      }
    };

    syncToasts();
    window.addEventListener('storage', syncToasts);
    window.addEventListener('notifications-updated', syncToasts);
    
    return () => {
      window.removeEventListener('storage', syncToasts);
      window.removeEventListener('notifications-updated', syncToasts);
    };
  }, []);

  const handleTogglePanel = () => {
    if (!showNotificationPanel) {
      setUnreadCount(0);
      localStorage.setItem("proactive_last_read_timestamp", Date.now().toString());
    }
    setShowNotificationPanel(!showNotificationPanel);
  };

  const clearAll = () => {
    activeToasts.forEach(t => localStorage.setItem(`proactive_muted_${t.taskId}_${t.urgency}`, "true"));
    localStorage.removeItem("proactive_active_toasts");
    setActiveToasts([]);
    setUnreadCount(0);
    setShowNotificationPanel(false);
    window.dispatchEvent(new Event('notifications-updated'));
  };

  const removeOne = (id: string, taskId: string, urgency: string) => {
    localStorage.setItem(`proactive_muted_${taskId}_${urgency}`, "true");
    const next = activeToasts.filter(t => t.id !== id);
    localStorage.setItem("proactive_active_toasts", JSON.stringify(next));
    setActiveToasts(next);
    if (next.length === 0) setShowNotificationPanel(false);
    window.dispatchEvent(new Event('notifications-updated'));
  };

  const getPageTitle = () => {
    if (pathname.includes('/strategy')) return 'Capacity Analysis';
    if (pathname.includes('/horizon')) return 'Project Breakdown';
    return 'AI Assistant';
  };

  const urgencyStyles: Record<AgentAlert["urgency"], { border: string; bg: string; iconColor: string; text: string; label: string; accent: string }> = {
    OVERDUE:  { border: "border-rose-200/50", bg: "bg-white/60", iconColor: "text-rose-500", text: "text-rose-900", label: "Overdue", accent: "bg-rose-500" },
    TODAY:    { border: "border-orange-200/50", bg: "bg-white/60", iconColor: "text-orange-500", text: "text-orange-900", label: "Due Today", accent: "bg-orange-500" },
    TOMORROW: { border: "border-amber-200/50", bg: "bg-white/60", iconColor: "text-amber-500", text: "text-amber-900", label: "Due Tomorrow", accent: "bg-amber-500" },
    SOON:     { border: "border-blue-200/50", bg: "bg-white/60", iconColor: "text-blue-500", text: "text-blue-900", label: "Due Soon", accent: "bg-blue-500" },
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-white/40 backdrop-blur-2xl border-b border-slate-100/60 h-20 px-8 flex items-center justify-between">
      {/* Left: Breadcrumbs */}
      <div className="flex items-center gap-6">
        <div className="flex flex-col">
          <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
            <span>Dashboard</span>
            <span className="opacity-40">/</span>
            <span className="text-blue-600 font-black">{getPageTitle()}</span>
          </div>
        </div>
      </div>

      {/* Right: Notification Hub */}
      <div className="flex items-center gap-4 relative">
        <button
          onClick={handleTogglePanel}
          className={`relative p-3.5 rounded-[1.25rem] transition-all duration-300 border cursor-pointer group hover:scale-105 z-20 ${
            showNotificationPanel && activeToasts.length > 0
              ? "bg-blue-600 text-white border-blue-600 shadow-xl shadow-md ring-4 ring-blue-50" 
              : "bg-white text-slate-400 border-slate-200/60 hover:border-slate-300 hover:text-slate-600 hover:shadow-md"
          }`}
          title={activeToasts.length === 0 ? "No Notifications" : "Notification alerts"}
        >
          <div className="relative z-10 flex items-center justify-center">
             {activeToasts.length > 0 && unreadCount > 0 ? (
               <BellRing size={22} className={showNotificationPanel ? "text-white" : "text-rose-500"} />
             ) : (
               <Bell size={22} className={showNotificationPanel && activeToasts.length > 0 ? "text-white" : ""} />
             )}
          </div>
          
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-500 text-[10px] font-black leading-none text-white ring-4 ring-white shadow-sm animate-in zoom-in group-hover:scale-110 transition-transform z-20">
              {unreadCount}
            </span>
          )}
        </button>

        {showNotificationPanel && (
          <div className="absolute top-16 right-0 w-[420px] bg-white border border-slate-100 shadow-[0_45px_100px_-20px_rgba(0,0,0,0.18)] rounded-[2rem] overflow-hidden animate-in slide-in-from-top-4 fade-in duration-500 z-50">
            <div className="px-6 py-5 border-b border-slate-50 flex items-center justify-between bg-slate-50/30">
              <div className="flex items-center gap-3">
                 <div className="w-6 h-[2px] bg-slate-300 rounded-full"></div>
                 <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em]">System Intelligence Alerts ({activeToasts.length})</span>
              </div>
              <button 
                 onClick={clearAll}
                 className="text-[9px] font-black text-rose-500 hover:text-rose-700 bg-rose-50/50 hover:bg-rose-100 px-4 py-2 rounded-lg transition-all uppercase tracking-widest cursor-pointer border border-rose-100/30"
              >
                Clear All
              </button>
            </div>

            <div className="max-h-[75vh] overflow-y-auto p-4 pb-10 space-y-3 bg-[#fdfdfe]/50 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              {activeToasts.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center opacity-40">
                  <Brain className="text-slate-300 mb-3" size={32} />
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] leading-relaxed">Neural Core Stable.<br/>No pending alerts.</p>
                </div>
              ) : (
                activeToasts.map(toast => {
                  const s = urgencyStyles[toast.urgency];
                  return (
                    <div key={toast.id} className={`rounded-[1.25rem] border shadow-sm overflow-hidden relative group transition-all duration-300 hover:shadow-md ${s.border} ${s.bg}`}>
                      <div className={`absolute top-0 left-0 w-full h-1 opacity-80 z-20 ${s.accent}`}></div>
                      <div className="absolute top-0 right-0 p-4 opacity-[0.03] group-hover:opacity-[0.06] transition-opacity pointer-events-none z-0">
                        <BellRing size={80} className={s.iconColor} />
                      </div>
                      
                      <div className="px-5 py-4 flex items-start gap-4 relative z-10 w-full">
                        <div className={`p-2.5 rounded-xl bg-white shadow-sm border border-slate-100/40 flex-shrink-0 mt-0.5 ${s.iconColor}`}>
                          <BellRing size={16} />
                        </div>
                        
                        <div className="flex-1 min-w-0 pr-4">
                          <div className="flex items-center justify-between mb-1.5">
                            <span className={`text-[8px] font-black uppercase tracking-[0.2em] px-2 py-1 rounded-md bg-white shadow-sm border border-slate-100/40 ${s.iconColor}`}>{s.label}</span>
                            <span className="text-[9px] font-black text-slate-400 tabular-nums uppercase tracking-widest">
                              {getFormattedAlertTime(toast.alertedAt, toast.timestamp)}
                            </span>
                          </div>
                          
                          <p className={`text-sm font-black tracking-tight leading-tight mb-2.5 line-clamp-1 ${s.text}`}>
                            {toast.taskName}
                          </p>
                          
                          <div className="flex items-center gap-2">
                            <Clock size={10} className="text-slate-400 opacity-60" />
                            <span className="text-[9px] font-bold text-slate-500 uppercase tracking-widest leading-none pt-0.5 truncate">
                              {formatDeadline(toast.deadline || "")}
                            </span>
                          </div>
                        </div>
                        
                        <button 
                          onClick={() => removeOne(toast.id, toast.taskId, toast.urgency)}
                          className="absolute top-4 right-4 text-slate-300 hover:text-rose-500 hover:bg-rose-50/50 p-1.5 rounded-lg cursor-pointer transition-all z-20 opacity-0 group-hover:opacity-100"
                        >
                          <X size={12} strokeWidth={3} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  );
}
