"use client";
import React, { useState, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, BellRing, Clock, X, Terminal, Brain, Target, Zap } from 'lucide-react';

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
  const [lastReadTimestamp, setLastReadTimestamp] = useState<number>(0);

  // New Capacity Alert State
  const [capacityHubOpen, setCapacityHubOpen] = useState(false);
  const [capacityData, setCapacityData] = useState<{ alerts: any[], summary: string, updatedAt: number } | null>(null);
  const [unreadCapacityCount, setUnreadCapacityCount] = useState(0);
  const [hasOverload, setHasOverload] = useState(false);

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

    const syncCapacity = () => {
      const stored = localStorage.getItem("proactive_capacity_alerts");
      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          setCapacityData(parsed);
          setHasOverload(parsed.alerts.some((a: any) => a.status === "OVERLOADED"));
          
          // Calculate Unread (Read vs Updated timestamp)
          const lastReadTime = Number(localStorage.getItem("proactive_last_capacity_read_timestamp") || 0);
          if (parsed.updatedAt > lastReadTime && parsed.alerts.length > 0) {
            setUnreadCapacityCount(parsed.alerts.length);
          } else {
            setUnreadCapacityCount(0);
          }
        } catch {}
      }
    };

    syncCapacity();
    window.addEventListener('storage', syncToasts);
    window.addEventListener('notifications-updated', syncToasts);
    window.addEventListener('capacity-alerts-updated', syncCapacity);
    
    return () => {
      window.removeEventListener('storage', syncToasts);
      window.removeEventListener('notifications-updated', syncToasts);
      window.removeEventListener('capacity-alerts-updated', syncCapacity);
    };
  }, []);

  const handleTogglePanel = () => {
    if (!showNotificationPanel) {
      // Capture the timestamp BEFORE we reset it, so we can highlight NEW items in the UI
      const prevRead = Number(localStorage.getItem("proactive_last_read_timestamp") || 0);
      setLastReadTimestamp(prevRead);
      
      setUnreadCount(0);
      localStorage.setItem("proactive_last_read_timestamp", Date.now().toString());
    }
    setCapacityHubOpen(false);
    setShowNotificationPanel(!showNotificationPanel);
  };

  const handleToggleCapacityHub = () => {
    if (!capacityHubOpen) {
      setUnreadCapacityCount(0);
      localStorage.setItem("proactive_last_capacity_read_timestamp", Date.now().toString());
    }
    setShowNotificationPanel(false);
    setCapacityHubOpen(!capacityHubOpen);
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

  const urgencyStyles: Record<AgentAlert["urgency"], { border: string; bg: string; newBg: string; iconColor: string; text: string; label: string; accent: string; badge: string }> = {
    OVERDUE:  { border: "border-rose-200/50", bg: "bg-rose-50/60", newBg: "bg-rose-300", iconColor: "text-rose-600", text: "text-rose-950", label: "Overdue", accent: "bg-rose-600", badge: "bg-white/60 text-rose-600 border border-rose-200/50" },
    TODAY:    { border: "border-orange-200/50", bg: "bg-orange-50/60", newBg: "bg-orange-300", iconColor: "text-orange-600", text: "text-orange-950", label: "Due Today", accent: "bg-orange-600", badge: "bg-white/60 text-orange-600 border border-orange-200/50" },
    TOMORROW: { border: "border-amber-200/50", bg: "bg-amber-50/60", newBg: "bg-amber-300", iconColor: "text-amber-600", text: "text-amber-950", label: "Due Tomorrow", accent: "bg-amber-600", badge: "bg-white/60 text-amber-600 border border-amber-200/50" },
    SOON:     { border: "border-blue-200/50", bg: "bg-blue-50/60", newBg: "bg-blue-300", iconColor: "text-blue-600", text: "text-blue-950", label: "Due Soon", accent: "bg-blue-600", badge: "bg-white/60 text-blue-600 border border-blue-200/50" },
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
        
        {/* Hub 1: Strategic Intelligence (Capacity Alerts) */}
        <div className="relative">
          <button
            onClick={handleToggleCapacityHub}
            className={`group relative p-3.5 rounded-[1.25rem] transition-all duration-300 border cursor-pointer z-20 hover:scale-105 ${
              capacityHubOpen
                ? "bg-indigo-600 text-white border-indigo-600 shadow-xl shadow-md ring-4 ring-indigo-50"
                : unreadCapacityCount > 0
                ? "bg-white text-indigo-500 border-indigo-100 hover:border-indigo-300 hover:shadow-md shadow-sm"
                : "bg-white text-slate-400 border-slate-200/60 hover:text-slate-500 hover:border-slate-300 hover:shadow-md"
            }`}
            title="Strategic intelligence hub"
          >
            <div className="relative z-10">
              <Brain size={22} />
            </div>
            {unreadCapacityCount > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-black leading-none text-white ring-4 ring-white shadow-sm animate-in zoom-in group-hover:scale-110 transition-transform z-20">
                {unreadCapacityCount}
              </span>
            )}
          </button>

          {capacityHubOpen && (
            <div className="absolute top-16 right-0 w-[440px] bg-white border border-slate-100 shadow-[0_45px_100px_-20px_rgba(0,0,0,0.18)] rounded-[2.5rem] overflow-hidden animate-in slide-in-from-top-4 fade-in duration-500 z-50">
               <div className="p-8 bg-indigo-950 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-10 opacity-[0.05] pointer-events-none">
                    <Brain size={180} />
                  </div>
                  <div className="relative z-10">
                    <div className="flex items-center gap-2.5 mb-6">
                      <div className="bg-white/10 backdrop-blur-xl px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] border border-white/10 shadow-2xl">
                        Neural Capacity Hub
                      </div>
                    </div>
                    <h3 className="text-2xl font-black tracking-tighter leading-tight mb-3">
                      {capacityData?.summary || "Neural core is currently idle."}
                    </h3>
                  </div>
               </div>

               <div className="p-6 space-y-4 max-h-[60vh] overflow-y-auto bg-slate-50/30 scrollbar-hide">
                  {(!capacityData || capacityData.alerts.length === 0) ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center">
                       <Target className="text-slate-200 mb-4" size={48} />
                       <p className="text-xs font-bold text-slate-400 tracking-tight">Your workload is perfectly balanced. <br /> All days are within safe capacity levels.</p>
                    </div>
                  ) : (
                    capacityData.alerts.map((alert: any, idx: number) => {
                      const isOverload = alert.status === "OVERLOADED";
                      return (
                        <div key={idx} className={`p-6 bg-white rounded-[1.75rem] border border-slate-100 shadow-sm transition-all duration-500 hover:shadow-md ${isOverload ? 'border-l-rose-500 border-l-[6px]' : 'border-l-orange-500 border-l-[6px]'}`}>
                           <div className="flex items-center justify-between mb-4">
                              <span className="text-xs font-black text-slate-800 tracking-tight">
                                {new Date(alert.date).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' })}
                              </span>
                              <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest border ${isOverload ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                                {alert.totalHours.toFixed(1)}h / {isOverload ? 'Overloaded' : 'Busy'}
                              </span>
                           </div>

                           {alert.suggestion && (
                             <div className={`mt-2 p-5 rounded-[1.5rem] border shadow-sm relative overflow-hidden group/sugg transition-all duration-500 ${isOverload 
                                ? 'bg-rose-50 border-rose-100' 
                                : 'bg-indigo-50 border-indigo-100'}`}>
                                <div className="flex items-start gap-4 relative z-10">
                                   <Zap size={18} className={`mt-1 flex-shrink-0 fill-current ${isOverload ? 'text-rose-500' : 'text-indigo-600'}`} />
                                   <div className="flex flex-col gap-1">
                                      <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${isOverload ? 'text-rose-400' : 'text-indigo-400'}`}>Agent Mitigator</span>
                                      <p className={`text-[12px] font-black leading-relaxed tracking-tight ${isOverload ? 'text-rose-900' : 'text-indigo-900'}`}>
                                        {alert.suggestion}
                                      </p>
                                   </div>
                                </div>
                                {/* Decorative Background Icon */}
                                <Brain size={120} className={`absolute -bottom-12 -right-12 opacity-[0.03] pointer-events-none group-hover/sugg:scale-110 transition-transform ${isOverload ? 'text-rose-900' : 'text-indigo-900'}`} />
                             </div>
                           )}
                        </div>
                      );
                    })
                  )}
               </div>

               <div className="p-6 border-t border-slate-100 flex justify-center">
                  <button 
                    onClick={() => setCapacityHubOpen(false)}
                    className="text-[10px] font-black text-slate-400 uppercase tracking-widest hover:text-indigo-600 transition-colors"
                  >
                    Minimize Intelligence Hub
                  </button>
               </div>
            </div>
          )}
        </div>

        {/* Hub 2: System Alerts (Existing Bell) */}
        <button
          onClick={() => {
            handleTogglePanel();
            setCapacityHubOpen(false);
          }}
          className={`relative p-3.5 rounded-[1.25rem] transition-all duration-300 border cursor-pointer group hover:scale-105 z-20 ${
            showNotificationPanel && activeToasts.length > 0
              ? "bg-blue-600 text-white border-blue-600 shadow-xl ring-4 ring-blue-50" 
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
                  const isNew = (toast.alertedAt || 0) > lastReadTimestamp;
                  
                  // Use pre-defined high-vibrancy styles
                  const cardBg = isNew ? s.newBg : s.bg;
                  const cardBorder = isNew ? "border-indigo-400/40 shadow-md" : s.border;
                  
                  return (
                    <div key={toast.id} className={`rounded-[1.25rem] border shadow-sm overflow-hidden relative group transition-all duration-300 ${cardBorder} ${cardBg} hover:shadow-md`}>
                      <div className="absolute top-0 right-0 p-4 opacity-[0.05] group-hover:opacity-[0.1] transition-opacity pointer-events-none z-0">
                        <BellRing size={80} className={s.iconColor} />
                      </div>
                      
                      <div className="px-5 py-4 flex items-start gap-4 relative z-10 w-full ml-1">
                        <div className={`p-2.5 rounded-xl bg-white/90 shadow-sm border border-white/40 flex-shrink-0 mt-0.5 ${s.iconColor} ${isNew ? '' : 'opacity-40'}`}>
                          <BellRing size={16} />
                        </div>
                        
                        <div className="flex-1 min-w-0 pr-4">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className={`flex items-center gap-2 ${isNew ? '' : 'opacity-60'}`}>
                              {/* New items get the SOLID badge, Old items get the GLASS badge */}
                              <span className={`text-[8px] font-black uppercase tracking-[0.2em] px-2 py-1 rounded-md shadow-sm border ${
                                isNew 
                                  ? `${s.accent} text-white border-transparent` 
                                  : s.badge
                              }`}>
                                {s.label}
                              </span>
                              {isNew && (
                                <span className="text-[7px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded-full bg-indigo-600 text-white shadow-sm shadow-indigo-200">New</span>
                              )}
                            </div>
                            <span className={`text-[9px] font-black tabular-nums uppercase tracking-widest ${isNew ? 'bg-white/60' : 'bg-white/40 opacity-50'} px-2 py-0.5 rounded-full border border-white/40 ${s.text}`}>
                              {getFormattedAlertTime(toast.alertedAt, toast.timestamp)}
                            </span>
                          </div>
                          
                          <p className={`text-sm font-black tracking-tight leading-tight mb-2.5 line-clamp-1 ${s.text} ${isNew ? 'opacity-100' : 'opacity-60'}`}>
                            {toast.taskName}
                          </p>
                          
                          <div className={`flex items-center gap-2 ${isNew ? 'opacity-100' : 'opacity-50'}`}>
                             <Clock size={12} className={s.iconColor} />
                             <span className={`text-[10px] font-black uppercase tracking-widest ${s.text} leading-none pt-0.5 truncate`}>
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
