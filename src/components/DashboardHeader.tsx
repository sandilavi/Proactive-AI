"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, BellRing, Clock, X, Terminal, Brain, Target, Zap, Check, Loader2 } from 'lucide-react';
import { updateNotionTask, fetchNotionTasks } from "@/app/actions/notion-actions";

// Use local storage to persist notifications
type AgentAlert = {
    id: string;
    taskId: string;
    taskName: string;
    urgency: "OVERDUE" | "TODAY" | "TOMORROW" | "SOON" | "CAPACITY_BUSY" | "CAPACITY_OVERLOADED";
    deadline?: string;
    alertedAt: number;
    timestamp: string;
    // Mitigation Action Data
    mitigationSuggestion?: string;
    mitigationTaskName?: string;
    mitigationTargetDate?: string;
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
  const [mitigationStates, setMitigationStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'rejected'>>({});
  // Shield to hide recently resolved tasks during Notion API propagation delay (45s)
  const [resolutionShield, setResolutionShield] = useState<Record<string, number>>({});
  const [hasRejectedAll, setHasRejectedAll] = useState(false);

  const handleAcceptMitigation = useCallback(async (alertId: string, taskName: string, targetDate: string) => {
    setMitigationStates(prev => ({ ...prev, [alertId]: 'loading' }));
    try {
      const allTasks = await fetchNotionTasks();
      const matched = allTasks.find(t => t.name.toLowerCase().trim() === taskName.toLowerCase().trim());
      if (!matched) {
        setMitigationStates(prev => ({ ...prev, [alertId]: 'idle' }));
        return;
      }
      const result = await updateNotionTask(matched.id, undefined, targetDate, matched.propNames, matched.propTypes);
      if (result.success) {
        setMitigationStates(prev => ({ ...prev, [alertId]: 'done' }));
        
        // Shield this move for 45s to bridge Notion's slow API propagation
        const shieldKey = `${taskName.toLowerCase().trim()}-${targetDate}`;
        setResolutionShield(prev => ({ ...prev, [shieldKey]: Date.now() + 45000 }));

        // Vanish the alert from BOTH Hubs after feedback time
        setTimeout(() => {
          // Vanish from Capacity Data Hub (Brain)
          setCapacityData(prev => prev ? {
            ...prev,
            alerts: prev.alerts.filter((a: any) => a.id !== alertId)
          } : null);

          // Vanish from Toast List Hub (Bell)
          setActiveToasts(prev => {
            const next = prev.filter(t => t.id !== alertId);
            localStorage.setItem("proactive_active_toasts", JSON.stringify(next));
            return next;
          });

          // NEW: Clear the mitigation state so future alerts for the same ID/date can be interacted with again
          setMitigationStates(prev => {
            const next = { ...prev };
            delete next[alertId];
            return next;
          });
        }, 1500);
        // Bust local storage fingerprint to force refresh
        localStorage.removeItem("proactive_tasks_fingerprint");
        // Trigger global refresh events
        window.dispatchEvent(new Event('notion-tasks-updated'));
      } else {
        setMitigationStates(prev => ({ ...prev, [alertId]: 'idle' }));
      }
    } catch (e) {
      console.error("Header Mitigation Error", e);
      setMitigationStates(prev => ({ ...prev, [alertId]: 'idle' }));
    }
  }, []);

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
          const validAlerts = (parsed.alerts || []).filter((a: any) => (a.totalHours || 0) > 0 && a.date);
          parsed.alerts = validAlerts;

          // Filter out persistently rejected suggestions
          const rejected = JSON.parse(localStorage.getItem("proactive_rejected_moves") || "[]");
          const filteredAlerts = (parsed.alerts || []).filter((a: any) => {
             if (!a.mitigationTaskName || !a.mitigationTargetDate) return true;
             const key = `${a.mitigationTaskName}|${a.date}|${a.mitigationTargetDate}`;
             return !rejected.includes(key);
          });
          
          parsed.alerts = filteredAlerts;
          
          // Count how many were rejected vs how many were provided
          const totalInsights = validAlerts.length;
          const visibleInsights = filteredAlerts.length;
          setHasRejectedAll(totalInsights > 0 && visibleInsights === 0);

          setCapacityData(parsed);
          setHasOverload(filteredAlerts.some((a: any) => a.status === "OVERLOADED"));
          
          // Calculate Unread (Read vs Updated timestamp)
          const lastReadTime = Number(localStorage.getItem("proactive_last_capacity_read_timestamp") || 0);
          if (parsed.updatedAt > lastReadTime && validAlerts.length > 0) {
            setUnreadCapacityCount(validAlerts.length);
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
    CAPACITY_BUSY: { border: "border-indigo-200/50", bg: "bg-indigo-50/60", newBg: "bg-indigo-300", iconColor: "text-indigo-600", text: "text-indigo-950", label: "Heavy Load", accent: "bg-indigo-600", badge: "bg-white/60 text-indigo-600 border border-indigo-200/50" },
    CAPACITY_OVERLOADED: { border: "border-rose-200/50", bg: "bg-rose-50/60", newBg: "bg-rose-300", iconColor: "text-rose-600", text: "text-rose-950", label: "Overloaded", accent: "bg-rose-600", badge: "bg-white/60 text-rose-600 border border-rose-200/50" },
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
                : unreadCapacityCount > 0 && capacityData && capacityData.alerts.length > 0
                ? "bg-white text-indigo-500 border-indigo-100 hover:border-indigo-300 hover:shadow-md shadow-sm"
                : "bg-white text-slate-400 border-slate-200/60 hover:text-slate-500 hover:border-slate-300 hover:shadow-md"
            }`}
            title="Strategic intelligence hub"
          >
            <div className="relative z-10">
              <Brain size={22} />
            </div>
            {unreadCapacityCount > 0 && capacityData && capacityData.alerts.length > 0 && (
              <span className="absolute -top-1.5 -right-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-indigo-600 text-[10px] font-black leading-none text-white ring-4 ring-white shadow-sm animate-in zoom-in group-hover:scale-110 transition-transform z-20">
                {unreadCapacityCount}
              </span>
            )}
          </button>

          {capacityHubOpen && (
            <div className="absolute top-16 right-0 w-[440px] max-h-[calc(100vh-120px)] bg-white border border-slate-100 shadow-[0_45px_100px_-20px_rgba(0,0,0,0.18)] rounded-[2.5rem] overflow-hidden animate-in slide-in-from-top-4 fade-in duration-500 z-50 flex flex-col">
               <div className="p-8 bg-indigo-950 text-white relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-10 opacity-[0.05] pointer-events-none">
                    <Brain size={180} />
                  </div>
                  <div className="relative z-10">
                    <div className="bg-white/10 backdrop-blur-md px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border border-white/10 shadow-2xl inline-block">
                      Neural Capacity Hub
                    </div>
                  </div>
               </div>

               <div className="flex-1 overflow-y-auto p-6 pb-10 space-y-4 bg-slate-50/30 scrollbar-hide">
                  {(!capacityData || capacityData.alerts.length === 0) ? (
                    <div className="py-12 flex flex-col items-center justify-center text-center">
                       <Target className="text-slate-200 mb-4" size={48} />
                       <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-2 leading-none">
                          {hasRejectedAll ? "Suggestions Dismissed" : "Schedule Optimized"}
                       </h3>
                       <p className="text-xs font-bold text-slate-400 tracking-tight max-w-[220px] mx-auto italic">
                          {hasRejectedAll 
                            ? "You have manually managed your current workload bottlenecks." 
                            : "Your workload is perfectly balanced. All days are within safe capacity levels."}
                       </p>
                    </div>
                  ) : (
                    capacityData.alerts
                      .filter((alert: any) => (alert.totalHours || 0) > 0 && alert.date && alert.suggestion) // Hide empty/broken entries & those with no actionable suggestion
                      .filter((alert: any) => {
                        // Shield Filter: Hide if we just recently moved this task for this specific overload date
                        if (!alert.mitigationTaskName || !alert.mitigationTargetDate) return true;
                        const shieldKey = `${alert.mitigationTaskName.toLowerCase().trim()}-${alert.mitigationTargetDate}`;
                        const expiry = resolutionShield[shieldKey];
                        return !expiry || Date.now() > expiry;
                      })
                      .map((alert: any) => {
                        const isOverload = alert.status === "OVERLOADED";
                        const dateObj = new Date(alert.date);
                        const displayDate = isNaN(dateObj.getTime()) 
                          ? "Upcoming Period" 
                          : dateObj.toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' });

                        // Using date as a stable ID for capacity insights
                        const alertId = alert.date;

                        return (
                          <div key={alertId} className={`p-6 bg-white rounded-[1.75rem] border border-slate-100 shadow-sm transition-all duration-500 hover:shadow-md ${isOverload ? 'border-l-rose-500 border-l-[6px]' : 'border-l-orange-500 border-l-[6px]'}`}>
                             <div className="flex items-center justify-between mb-4">
                                <span className="text-xs font-black text-slate-800 tracking-tight">
                                  {displayDate}
                                </span>
                                <span className={`text-[10px] font-black px-3 py-1 rounded-full uppercase tracking-widest border ${isOverload ? 'bg-rose-50 text-rose-600 border-rose-100' : 'bg-orange-50 text-orange-600 border-orange-100'}`}>
                                  {(alert.totalHours || 0).toFixed(1)}h / {isOverload ? 'Overloaded' : 'Busy'}
                                </span>
                             </div>

                           {alert.suggestion && (
                             <div className={`mt-2 p-5 rounded-[1.5rem] border shadow-sm relative overflow-hidden group/sugg transition-all duration-500 ${isOverload 
                                ? 'bg-rose-50 border-rose-100' 
                                : 'bg-indigo-50 border-indigo-100'}`}>
                                <div className="flex flex-col gap-4 relative z-10">
                                   <div className="flex items-start gap-3">
                                      <Zap size={18} className={`mt-1 flex-shrink-0 fill-current ${isOverload ? 'text-rose-500' : 'text-indigo-600'}`} />
                                      <div className="flex flex-col gap-1">
                                         <span className={`text-[9px] font-black uppercase tracking-[0.2em] ${isOverload ? 'text-rose-400' : 'text-indigo-400'}`}>Agent Mitigator</span>
                                         
                                         {mitigationStates[alertId] === 'done' ? (
                                           <div className="text-[11px] font-black text-emerald-700 flex items-center gap-1.5 animate-in slide-in-from-left-2">
                                              <Check size={14} /> Task rescheduled!
                                           </div>
                                         ) : mitigationStates[alertId] === 'rejected' ? (
                                           <p className="text-[11px] font-bold text-slate-400 line-through italic">Dismissed</p>
                                         ) : (
                                           <p className={`text-[12px] font-black leading-relaxed tracking-tight ${isOverload ? 'text-rose-900' : 'text-indigo-900'}`}>
                                             {alert.suggestion}
                                           </p>
                                         )}
                                      </div>
                                   </div>

                                   {mitigationStates[alertId] !== 'done' && mitigationStates[alertId] !== 'rejected' && alert.mitigationTaskName && alert.mitigationTargetDate && (
                                      <div className="flex gap-2">
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            handleAcceptMitigation(alertId, alert.mitigationTaskName!, alert.mitigationTargetDate!);
                                          }}
                                          disabled={mitigationStates[alertId] === 'loading'}
                                          className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all cursor-pointer active:scale-95
                                            ${isOverload 
                                              ? 'bg-rose-600 hover:bg-rose-700 text-white disabled:bg-rose-300 shadow-lg shadow-rose-200/50' 
                                              : 'bg-indigo-600 hover:bg-indigo-700 text-white disabled:bg-indigo-300 shadow-lg shadow-indigo-200/50'}`}
                                        >
                                          {mitigationStates[alertId] === 'loading' ? (
                                            <Loader2 size={12} className="animate-spin" />
                                          ) : (
                                            <Check size={12} />
                                          )}
                                          {mitigationStates[alertId] === 'loading' ? 'Moving...' : 'Accept'}
                                        </button>
                                        <button 
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            
                                            // 1. PERSISTENCE: Save this specific move to the Rejection Vault
                                            if (alert.mitigationTaskName && alert.mitigationTargetDate) {
                                              const key = `${alert.mitigationTaskName}|${alert.date}|${alert.mitigationTargetDate}`;
                                              const rejected = JSON.parse(localStorage.getItem("proactive_rejected_moves") || "[]");
                                              if (!rejected.includes(key)) {
                                                rejected.push(key);
                                                localStorage.setItem("proactive_rejected_moves", JSON.stringify(rejected));
                                              }
                                            }

                                            setMitigationStates(prev => ({ ...prev, [alertId]: 'rejected' }));
                                            // Vanish after 1.5s
                                            setTimeout(() => {
                                               setCapacityData(prev => prev ? {
                                                 ...prev,
                                                 alerts: prev.alerts.filter((a: any) => a.date !== alert.date)
                                               } : null);
                                               
                                               // Clear mitigation state for this ID
                                               setMitigationStates(prev => {
                                                 const next = { ...prev };
                                                 delete next[alertId];
                                                 return next;
                                               });
                                            }, 1500);
                                          }}
                                          className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase bg-white/50 border border-black/5 hover:bg-white text-slate-400 cursor-pointer active:scale-95 disabled:opacity-30 disabled:cursor-not-allowed"
                                     disabled={mitigationStates[alertId] === 'loading'}
                                        >
                                          <X size={12} />
                                        </button>
                                      </div>
                                   )}
                                </div>
                                <Brain size={120} className={`absolute -bottom-12 -right-12 opacity-[0.03] pointer-events-none group-hover/sugg:scale-110 transition-transform ${isOverload ? 'text-rose-900' : 'text-indigo-900'}`} />
                             </div>
                           )}
                        </div>
                      );
                    })
                  )}
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
          <div className="absolute top-16 right-0 w-[420px] max-h-[calc(100vh-120px)] bg-white border border-slate-100 shadow-[0_45px_100px_-20px_rgba(0,0,0,0.18)] rounded-[2rem] overflow-hidden animate-in slide-in-from-top-4 fade-in duration-500 z-50 flex flex-col">
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

            <div className="flex-1 overflow-y-auto p-4 pb-10 space-y-3 bg-[#fdfdfe]/50 scrollbar-thin scrollbar-thumb-slate-200 scrollbar-track-transparent">
              {activeToasts.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-center opacity-40">
                  <Brain className="text-slate-300 mb-3" size={32} />
                  <p className="text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] leading-relaxed">Neural Core Stable.<br/>No pending alerts.</p>
                </div>
              ) : (
                activeToasts
                  .filter((toast: any) => {
                    // Shield Filter: Hide if we just recently moved this task
                    if (!toast.mitigationTaskName || !toast.mitigationTargetDate) return true;
                    const shieldKey = `${toast.mitigationTaskName.toLowerCase().trim()}-${toast.mitigationTargetDate}`;
                    const expiry = resolutionShield[shieldKey];
                    return !expiry || Date.now() > expiry;
                  })
                  .map(toast => {
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
                        
                          <div className={`flex flex-col gap-2 flex-1 min-w-0 pr-4`}>
                            <div className="flex items-center justify-between">
                              <div className={`flex items-center gap-2 ${isNew ? '' : 'opacity-60'}`}>
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

                            <div className="flex flex-col gap-2.5">
                              {mitigationStates[toast.id] === 'done' ? (
                                <p className="text-[12px] font-black text-emerald-700 bg-emerald-50/50 py-2 px-3 rounded-xl border border-emerald-100 flex items-center gap-2">
                                  <Check size={14} /> Task moved successfully!
                                </p>
                              ) : mitigationStates[toast.id] === 'rejected' ? (
                                <p className="text-[12px] font-bold text-slate-400 line-through italic px-3 opacity-60">Dismissed</p>
                              ) : (
                                <>
                                    <div className="flex flex-col gap-1.5 min-w-0 pr-4">
                                      <p className={`text-[13px] font-bold leading-tight tracking-tight ${isNew ? 'text-slate-900' : 'text-slate-600'}`}>
                                        {toast.mitigationSuggestion || toast.taskName}
                                      </p>
                                      {toast.deadline && toast.deadline !== "No Deadline" && (
                                        <div className={`flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest ${isNew ? 'text-rose-600/80' : 'text-slate-400'}`}>
                                          <Clock size={10} strokeWidth={3} />
                                          <span>Due: {formatDeadline(toast.deadline)}</span>
                                        </div>
                                      )}
                                    </div>

                                  {/* ACTION BUTTONS DIRECTLY IN NOTIFICATION PANEL */}
                                  {mitigationStates[toast.id] !== 'done' && mitigationStates[toast.id] !== 'rejected' && toast.mitigationTaskName && toast.mitigationTargetDate && (
                                    <div className="flex gap-2">
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleAcceptMitigation(toast.id, toast.mitigationTaskName!, toast.mitigationTargetDate!);
                                        }}
                                        disabled={mitigationStates[toast.id] === 'loading'}
                                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all
                                          ${toast.urgency === 'CAPACITY_OVERLOADED' 
                                            ? 'bg-rose-500 hover:bg-rose-600 text-white cursor-pointer' 
                                            : 'bg-indigo-500 hover:bg-indigo-600 text-white cursor-pointer'}`}
                                      >
                                        {mitigationStates[toast.id] === 'loading' ? (
                                          <Loader2 size={12} className="animate-spin" />
                                        ) : (
                                          <Check size={12} />
                                        )}
                                        {mitigationStates[toast.id] === 'loading' ? 'Moving...' : 'Accept'}
                                      </button>
                                      <button 
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          setMitigationStates(prev => ({ ...prev, [toast.id]: 'rejected' }));
                                          // Vanish after 1.5s
                                          setTimeout(() => {
                                             setActiveToasts(prev => {
                                               const next = prev.filter(t => t.id !== toast.id);
                                               localStorage.setItem("proactive_active_toasts", JSON.stringify(next));
                                               return next;
                                             });
                                          }, 1500);
                                        }}
                                        className="px-4 py-2.5 rounded-xl text-[10px] font-black uppercase bg-slate-100 hover:bg-slate-200 text-slate-400 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                                         disabled={mitigationStates[toast.id] === 'loading'}
                                      >
                                        Reject
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
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
