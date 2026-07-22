"use client";
import React, { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, BellRing, Clock, X, Brain, Target, Zap, Check, Loader2 } from 'lucide-react';
import { updateNotionTask, fetchNotionTasks } from "@/app/actions/notion-actions";

const normalizeName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

type AgentAlert = {
    id: string;
    taskId: string;
    taskName: string;
    urgency: "OVERDUE" | "TODAY" | "TOMORROW" | "SOON" | "CAPACITY_BUSY";
    deadline?: string;
    alertedAt: number;
    timestamp: string;
    mitigationSuggestion?: string;
    mitigationTaskName?: string;
    mitigationTargetDate?: string;
    reason?: string;
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

  // Capacity Alert State
  const [capacityHubOpen, setCapacityHubOpen] = useState(false);
  const [capacityData, setCapacityData] = useState<{ alerts: any[], summary: string, updatedAt: number } | null>(null);
  const [unreadCapacityCount, setUnreadCapacityCount] = useState(0);
  const [hasOverload, setHasOverload] = useState(false);
  const [mitigationStates, setMitigationStates] = useState<Record<string, 'idle' | 'loading' | 'done' | 'rejected'>>({});
  const [resolutionShield, setResolutionShield] = useState<Record<string, number>>({});
  const [hasRejectedAll, setHasRejectedAll] = useState(false);

  const handleAcceptMitigation = useCallback(async (alertId: string, taskName: string, targetDate: string) => {
    setMitigationStates(prev => ({ ...prev, [alertId]: 'loading' }));
    try {
      const allTasks = await fetchNotionTasks();
      const matched = allTasks.find(t => normalizeName(t.name) === normalizeName(taskName));
      if (!matched) {
        setMitigationStates(prev => ({ ...prev, [alertId]: 'idle' }));
        return;
      }
      const result = await updateNotionTask(matched.id, undefined, targetDate, matched.propNames, matched.propTypes);
      if (result.success) {
        setMitigationStates(prev => ({ ...prev, [alertId]: 'done' }));
        
        const shieldKey = `${taskName.toLowerCase().trim()}-${targetDate}`;
        setResolutionShield(prev => ({ ...prev, [shieldKey]: Date.now() + 45000 }));

        setTimeout(() => {
          setCapacityData(prev => prev ? {
            ...prev,
            alerts: prev.alerts.filter((a: any) => a.id !== alertId)
          } : null);

          setActiveToasts(prev => {
            const next = prev.filter(t => t.id !== alertId);
            localStorage.setItem("proactive_active_toasts", JSON.stringify(next));
            return next;
          });

          setMitigationStates(prev => {
            const next = { ...prev };
            delete next[alertId];
            return next;
          });
        }, 1500);

        localStorage.removeItem("proactive_tasks_fingerprint");
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
      let stored = localStorage.getItem("proactive_capacity_alerts");

      // Detect if stored alerts are stale/incomplete (missing actionable mitigation data)
      const hasIncompleteAlerts = (() => {
        if (!stored) return true;
        try {
          const parsed = JSON.parse(stored);
          const alerts = parsed.alerts || [];
          if (alerts.length === 0) return true;
          // If ANY busy alert is missing mitigationTaskName, consider it broken
          return alerts.some((a: any) => a.status === "BUSY" && (!a.mitigationTaskName || !a.mitigationTargetDate));
        } catch { return true; }
      })();

      // Robust Sync: If proactive_capacity_alerts is missing/stale, rebuild from full report
      if (hasIncompleteAlerts) {
        const fullReport = localStorage.getItem("proactive_capacity_full_report");
        if (fullReport) {
          try {
            const parsedFull = JSON.parse(fullReport);
            if (parsedFull.insights) {
              const rebuiltAlerts: any[] = [];
              const busyInsights = (parsedFull.insights || []).filter((i: any) => i.status === "BUSY" || i.totalHours >= 10);
              busyInsights.forEach((i: any) => {
                const dayMits = (parsedFull.mitigations || []).filter((m: any) => m.date === i.date);
                if (dayMits.length > 0) {
                  dayMits.forEach((mit: any) => {
                    rebuiltAlerts.push({
                      id: `capacity-${i.date}-${mit.mitigationTaskName}`,
                      taskId: `capacity-${i.date}-${mit.mitigationTaskName}`,
                      taskName: `Busy Day on ${i.date}`,
                      urgency: "CAPACITY_BUSY",
                      deadline: i.date,
                      date: i.date,
                      timestamp: new Date(parsedFull.updatedAt || Date.now()).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
                      alertedAt: parsedFull.updatedAt || Date.now(),
                      read: false,
                      suggestion: mit.suggestion,
                      reason: mit.reason,
                      totalHours: i.totalHours,
                      status: "BUSY",
                      mitigationSuggestion: mit.suggestion,
                      mitigationTaskName: mit.mitigationTaskName,
                      mitigationTargetDate: mit.mitigationTargetDate,
                      source: mit.source || "AI"
                    });
                  });
                }
              });
              if (rebuiltAlerts.length > 0) {
                const rebuiltData = {
                  alerts: rebuiltAlerts,
                  summary: parsedFull.overallSummary || "I detect some busy days. Let's proactively rebalance your workload.",
                  updatedAt: Date.now()
                };
                localStorage.setItem("proactive_capacity_alerts", JSON.stringify(rebuiltData));
                stored = JSON.stringify(rebuiltData);
              }
            }
          } catch (e) {}
        }
      }

      if (stored) {
        try {
          const parsed = JSON.parse(stored);
          const validAlerts = (parsed.alerts || []).filter((a: any) => a.date && (a.suggestion || a.mitigationSuggestion));
          parsed.alerts = validAlerts;

          const rejected = JSON.parse(localStorage.getItem("proactive_rejected_moves") || "[]");
          const filteredAlerts = (parsed.alerts || []).filter((a: any) => {
             if (!a.mitigationTaskName || !a.mitigationTargetDate) return true;
             const key = `${a.mitigationTaskName}|${a.date}|${a.mitigationTargetDate}`;
             return !rejected.includes(key);
          });
          
          parsed.alerts = filteredAlerts;
          
          const totalInsights = validAlerts.length;
          const visibleInsights = filteredAlerts.length;
          setHasRejectedAll(totalInsights > 0 && visibleInsights === 0);

          setCapacityData(parsed);
          setHasOverload(filteredAlerts.some((a: any) => a.status === "BUSY"));

          // Only show unread badge if the panel is currently closed AND new alerts arrived since last read
          setUnreadCapacityCount(prev => {
            const lastReadTime = Number(localStorage.getItem("proactive_last_capacity_read_timestamp") || 0);
            const isHubOpen = document.querySelector("[data-capacity-hub-open='true']") !== null;
            if (isHubOpen) return 0;
            if (parsed.updatedAt > lastReadTime + 2000 && validAlerts.length > 0) {
              return validAlerts.length;
            }
            return prev === 0 ? 0 : prev;
          });
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
    if (pathname.includes('/settings')) return 'Settings';
    return 'AI Assistant';
  };

  const urgencyStyles: Record<AgentAlert["urgency"], { border: string; bg: string; newBg: string; text: string; label: string; badge: string }> = {
    OVERDUE:  { border: "border-red-200", bg: "bg-red-50", newBg: "bg-red-100", text: "text-red-950", label: "Overdue", badge: "bg-red-50 text-red-700 border-red-200" },
    TODAY:    { border: "border-orange-200", bg: "bg-orange-50", newBg: "bg-orange-100", text: "text-orange-950", label: "Due Today", badge: "bg-orange-50 text-orange-700 border-orange-200" },
    TOMORROW: { border: "border-amber-200", bg: "bg-amber-50", newBg: "bg-amber-100", text: "text-amber-950", label: "Due Tomorrow", badge: "bg-amber-50 text-amber-700 border-amber-200" },
    SOON:     { border: "border-blue-200", bg: "bg-blue-50", newBg: "bg-blue-100", text: "text-blue-950", label: "Due Soon", badge: "bg-blue-50 text-blue-700 border-blue-200" },
    CAPACITY_BUSY: { border: "border-indigo-200", bg: "bg-indigo-50", newBg: "bg-indigo-100", text: "text-indigo-950", label: "Busy Day", badge: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  };

  return (
    <header className="sticky top-0 z-40 w-full bg-white border-b border-slate-200 h-14 px-6 flex items-center justify-between">
      {/* Left: Breadcrumbs */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-semibold text-slate-500">Dashboard</span>
        <span className="text-slate-300 text-xs">/</span>
        <span className="text-xs font-bold text-slate-900">{getPageTitle()}</span>
      </div>

      {/* Right: Notification Hub */}
      <div className="flex items-center gap-3 relative">
        
        {/* Hub 1: Capacity Alerts */}
        <div className="relative">
          <button
            onClick={handleToggleCapacityHub}
            className={`p-2 rounded border cursor-pointer flex items-center justify-center transition-colors ${
              capacityHubOpen
                ? "bg-slate-900 text-white border-slate-900"
                : unreadCapacityCount > 0 && capacityData && capacityData.alerts.length > 0
                ? "bg-indigo-50 text-indigo-700 border-indigo-200"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
            title="Capacity Intelligence"
          >
            <Brain size={16} />
            {unreadCapacityCount > 0 && capacityData && capacityData.alerts.length > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-600 text-[9px] font-bold text-white">
                {unreadCapacityCount}
              </span>
            )}
          </button>

          {capacityHubOpen && (
            <div data-capacity-hub-open="true" className="absolute top-10 right-0 w-80 max-h-[480px] bg-white border border-slate-200 rounded shadow-md z-50 flex flex-col">
               <div className="p-3 bg-slate-900 text-white font-bold text-xs">
                 Strategic Capacity Insights
               </div>

               <div className="flex-1 overflow-y-auto p-3 space-y-3 bg-slate-50 max-h-[360px]">
                  {(!capacityData || capacityData.alerts.length === 0) ? (
                    <div className="py-8 text-center">
                       <Target className="text-slate-300 mx-auto mb-2" size={32} />
                       <p className="text-xs font-semibold text-slate-500">
                         {hasRejectedAll ? "Suggestions dismissed" : (capacityData?.summary || "Schedule balanced")}
                       </p>
                    </div>
                  ) : (
                    capacityData.alerts
                      .filter((alert: any) => ((alert.totalHours || 0) > 0 || String(alert.id).startsWith('overdue-')) && alert.date && (alert.suggestion || alert.mitigationSuggestion))
                      .filter((alert: any) => {
                        if (!alert.mitigationTaskName || !alert.mitigationTargetDate) return true;
                        const shieldKey = `${alert.mitigationTaskName.toLowerCase().trim()}-${alert.mitigationTargetDate}`;
                        const expiry = resolutionShield[shieldKey];
                        return !expiry || Date.now() > expiry;
                      })
                      .map((alert: any) => {
                        const isBusy = alert.status === "BUSY";
                        const dateObj = new Date(alert.date);
                        const displayDate = isNaN(dateObj.getTime()) 
                          ? "Upcoming Period" 
                          : dateObj.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
                        const alertId = alert.id || `capacity-${alert.date}-${alert.mitigationTaskName || ''}`;
                        const alertedMs = alert.alertedAt || capacityData.updatedAt || Date.now();
                        const timeStr = new Date(alertedMs).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                        const formattedTime = getFormattedAlertTime(alertedMs, timeStr);

                        return (
                          <div key={alertId} className={`p-3 bg-white border rounded shadow-sm border-l-4 ${
                            String(alertId).startsWith('overdue-') ? 'border-l-red-500' : isBusy ? 'border-l-orange-500' : 'border-l-indigo-500'
                          }`}>
                             <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-2">
                                  <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${isBusy ? 'bg-orange-50 text-orange-700 border-orange-100' : 'bg-indigo-50 text-indigo-700 border-indigo-200'}`}>
                                    {(alert.estimatedHours !== undefined ? alert.estimatedHours : (alert.totalHours || 0)).toFixed(1)}h
                                  </span>
                                  {alert.source === "FALLBACK" ? (
                                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 border border-amber-300" title="Generated by System Capacity Guard fallback">
                                      🛡 System Guard
                                    </span>
                                  ) : (
                                    <span className="text-[8px] font-bold px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800 border border-indigo-200" title="Generated by AI Model">
                                      ⚡ AI Model
                                    </span>
                                  )}
                                </div>
                                <span className="text-[9px] text-slate-400 font-semibold">
                                  {formattedTime}
                                </span>
                             </div>

                             {(alert.mitigationTaskName || alert.suggestion) && (
                               <div className={`mt-2 p-3 rounded border text-[11px] ${isBusy ? 'bg-orange-50/50 border-orange-100 text-orange-950' : 'bg-indigo-50/50 border-indigo-100 text-indigo-950'}`}>
                                 <p className="leading-relaxed text-slate-800">
                                   {alert.mitigationTaskName && alert.mitigationTargetDate ? (
                                      <>
                                        {"I'm recommending you to move "}
                                        <span className="font-semibold">{alert.mitigationTaskName}</span>
                                        {" to "}
                                        {(() => { const d = new Date(alert.mitigationTargetDate!); return isNaN(d.getTime()) ? alert.mitigationTargetDate : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' }); })()}
                                        {String(alertId).startsWith('overdue-')
                                          ? " as it is overdue and needs immediate attention."
                                          : ` to reduce the workload on ${(() => { const d = new Date(alert.date); return isNaN(d.getTime()) ? alert.date : d.toLocaleDateString("en-US", { month: "long", day: "numeric" }); })()}.`
                                        }
                                      </>
                                   ) : alert.suggestion}
                                 </p>

                                 {alert.mitigationTaskName && alert.mitigationTargetDate && (
                                    <div className="mt-2.5 flex gap-2">
                                      <button 
                                        onClick={() => handleAcceptMitigation(alertId, alert.mitigationTaskName!, alert.mitigationTargetDate!)}
                                        disabled={mitigationStates[alertId] === 'loading'}
                                        className="flex-1 flex items-center justify-center gap-1 py-1 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold uppercase text-[9px] cursor-pointer"
                                      >
                                        {mitigationStates[alertId] === 'loading' ? (
                                          <Loader2 size={10} className="animate-spin" />
                                        ) : (
                                          <Check size={10} />
                                        )}
                                        {mitigationStates[alertId] === 'loading' ? 'Moving...' : 'Reschedule'}
                                      </button>
                                      
                                      <button 
                                        onClick={() => {
                                          const rejectedKey = `${alert.mitigationTaskName}|${alert.date}|${alert.mitigationTargetDate}`;
                                          const currentRejected = JSON.parse(localStorage.getItem("proactive_rejected_moves") || "[]");
                                          currentRejected.push(rejectedKey);
                                          localStorage.setItem("proactive_rejected_moves", JSON.stringify(currentRejected));
                                          
                                          setCapacityData(prev => prev ? {
                                            ...prev,
                                            alerts: prev.alerts.filter((a: any) => a.id !== alertId)
                                          } : null);
                                        }}
                                        disabled={mitigationStates[alertId] === 'loading'}
                                        className="py-1 px-2.5 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold uppercase text-[9px] cursor-pointer"
                                      >
                                        Dismiss
                                      </button>
                                    </div>
                                 )}
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

        {/* Hub 2: Notification Bell */}
        <div className="relative">
          <button
            onClick={handleTogglePanel}
            className={`p-2 rounded border cursor-pointer flex items-center justify-center transition-colors ${
              showNotificationPanel
                ? "bg-slate-900 text-white border-slate-900"
                : unreadCount > 0
                ? "bg-blue-50 text-blue-700 border-blue-200"
                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
            }`}
            title="Notifications"
          >
            <Bell size={16} />
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-[9px] font-bold text-white">
                {unreadCount}
              </span>
            )}
          </button>

          {showNotificationPanel && (
            <div className="absolute top-10 right-0 w-80 max-h-[480px] bg-white border border-slate-200 rounded shadow-md z-50 flex flex-col">
              <div className="p-3 bg-slate-900 text-white flex items-center justify-between text-xs font-bold">
                <span>Task Notifications</span>
                {activeToasts.length > 0 && (
                  <button 
                    onClick={clearAll}
                    className="text-[9px] uppercase tracking-wider text-slate-300 hover:text-white cursor-pointer"
                  >
                    Clear All
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto p-3 space-y-2.5 bg-slate-50 max-h-[360px]">
                {activeToasts.length === 0 ? (
                  <div className="py-8 text-center">
                    <Bell className="text-slate-300 mx-auto mb-2" size={32} />
                    <p className="text-xs font-semibold text-slate-500">No new alerts</p>
                  </div>
                ) : (
                  activeToasts
                    .filter((toast: any) => {
                      if (!toast.mitigationTaskName || !toast.mitigationTargetDate) return true;
                      const shieldKey = `${toast.mitigationTaskName.toLowerCase().trim()}-${toast.mitigationTargetDate}`;
                      const expiry = resolutionShield[shieldKey];
                      return !expiry || Date.now() > expiry;
                    })
                    .map(toast => {
                      const s = urgencyStyles[toast.urgency];
                      const isNew = (toast.alertedAt || 0) > lastReadTimestamp;
                      const cardBg = isNew ? s.newBg : s.bg;
                      
                      return (
                        <div key={toast.id} className={`p-3 bg-white border rounded shadow-sm relative ${s.border} ${cardBg}`}>
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded border ${s.badge}`}>
                                {s.label}
                              </span>
                              {isNew && (
                                <span className="text-[8px] font-bold px-1 rounded bg-indigo-600 text-white">New</span>
                              )}
                            </div>
                            <span className="text-[8px] text-slate-400 font-semibold">
                              {getFormattedAlertTime(toast.alertedAt, toast.timestamp)}
                            </span>
                          </div>

                          <div className="space-y-2">
                            {mitigationStates[toast.id] === 'done' ? (
                              <p className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 p-1 rounded border border-emerald-100 flex items-center gap-1">
                                <Check size={12} /> Task moved!
                              </p>
                            ) : mitigationStates[toast.id] === 'rejected' ? (
                              <p className="text-[11px] text-slate-400 line-through italic">Dismissed</p>
                            ) : (
                              <>
                                 <p className="text-xs text-slate-800 leading-tight">
                                   {toast.mitigationSuggestion || toast.taskName}
                                 </p>
                                
                                {toast.deadline && toast.deadline !== "No Deadline" && (
                                  <div className="flex items-center gap-1 text-[9px] text-slate-500 font-semibold">
                                    <Clock size={10} />
                                    <span>Due: {formatDeadline(toast.deadline)}</span>
                                  </div>
                                )}

                                {toast.mitigationTaskName && toast.mitigationTargetDate && (
                                  <div className="flex gap-2 pt-1">
                                    <button 
                                      onClick={() => handleAcceptMitigation(toast.id, toast.mitigationTaskName!, toast.mitigationTargetDate!)}
                                      className="flex-grow py-1 rounded bg-slate-900 hover:bg-slate-800 text-white font-bold uppercase text-[9px] cursor-pointer"
                                    >
                                      Accept
                                    </button>
                                    <button 
                                      onClick={() => {
                                        setMitigationStates(prev => ({ ...prev, [toast.id]: 'rejected' }));
                                        setTimeout(() => {
                                           setActiveToasts(prev => {
                                             const next = prev.filter(t => t.id !== toast.id);
                                             localStorage.setItem("proactive_active_toasts", JSON.stringify(next));
                                             return next;
                                           });
                                        }, 1500);
                                      }}
                                      className="py-1 px-3 rounded bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold uppercase text-[9px] cursor-pointer"
                                    >
                                      Reject
                                    </button>
                                  </div>
                                )}
                              </>
                            )}
                          </div>

                          <button 
                            onClick={() => removeOne(toast.id, toast.taskId, toast.urgency)}
                            className="absolute top-2 right-2 text-slate-400 hover:text-red-500 cursor-pointer"
                          >
                            <X size={10} />
                          </button>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
