"use client";
import { useEffect, useCallback, useRef } from "react";
import { fetchNotionTasks } from "@/app/actions/notion-actions";
import { getCapacityInsights } from "@/app/actions/agent-actions";

const NOTIFICATION_INTERVAL = 2 * 60 * 1000; // 2 minutes

interface ProactiveAlert {
  id: string;
  taskId: string;
  taskName: string;
  urgency: "OVERDUE" | "TODAY" | "TOMORROW" | "SOON" | "CAPACITY_BUSY" | "CAPACITY_OVERLOADED";
  deadline: string;
  timestamp: string;
  alertedAt?: number;
  read: boolean;
  // New mitigation fields
  mitigationSuggestion?: string;
  mitigationTaskName?: string;
  mitigationTargetDate?: string;
}

export default function AgentEngine() {
  const activeToastsRef = useRef<ProactiveAlert[]>([]);
  const taskFingerprintRef = useRef<string>("");

  const fireOsNotification = useCallback((alert: ProactiveAlert) => {
    const urgencyLabel: Record<ProactiveAlert["urgency"], string> = {
      OVERDUE:  "🚨 OVERDUE",
      TODAY:    "⚠️ Due TODAY",
      TOMORROW: "⚠️ Due TOMORROW",
      SOON:     "🔔 Due Soon",
      CAPACITY_BUSY: "⚠️ HEAVY LOAD",
      CAPACITY_OVERLOADED: "🔥 OVERLOADED"
    };
    const body = `"${alert.taskName}" — ${urgencyLabel[alert.urgency]}`;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification("ProActiveAI Intelligence", { body, icon: "/favicon.ico", tag: alert.taskId });
    }
  }, []);

  useEffect(() => {
    const urgencyRank: Record<ProactiveAlert["urgency"], number> = { 
      OVERDUE: 0, 
      CAPACITY_OVERLOADED: 1,
      TODAY: 2, 
      CAPACITY_BUSY: 3,
      TOMORROW: 4, 
      SOON: 5 
    };

    const syncNotifications = async () => {
      try {
        // 1. Fetch fresh data from Notion directly to ensure parity with StrategyView
        const { fetchNotionTasks } = await import("@/app/actions/notion-actions");
        const freshTasks = await fetchNotionTasks();
        if (!freshTasks) return;

        const now = new Date();
        const prevToasts = activeToastsRef.current;
        const currentFingerprint = [...freshTasks]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(t => `${t.id}-${t.status}-${t.name}-${t.deadline}`)
          .join("|");
          
        const tasksActuallyChanged = taskFingerprintRef.current !== "" && taskFingerprintRef.current !== currentFingerprint;
        taskFingerprintRef.current = currentFingerprint;

        const urgentAlerts: ProactiveAlert[] = [];

        // 2. Identify urgent tasks (Overdue/Today/Upcoming)
        for (const task of freshTasks) {
          if (!task.deadline || task.status?.toLowerCase() === "done") continue;
          
          const deadline = new Date(task.deadline);
          const diffDays = Math.ceil((deadline.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
          
          let urgency: ProactiveAlert["urgency"] | null = null;
          if (diffDays < 0) urgency = "OVERDUE";
          else if (diffDays === 0) urgency = "TODAY";
          else if (diffDays === 1) urgency = "TOMORROW";
          else if (diffDays <= 3) urgency = "SOON";

          if (urgency) {
            const alertedKey = `proactive_alert_${task.id}_${urgency}`;
            const nowString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let alertedMs = Date.now();
            let alertTimestamp = nowString;
            let isFreshAlert = true;

            const saved = typeof window !== "undefined" ? localStorage.getItem(alertedKey) : null;
            if (saved) {
              try {
                const parsed = JSON.parse(saved);
                alertTimestamp = parsed.displayTime || nowString;
                alertedMs = parsed.alertedAt || Date.now();
                isFreshAlert = false;
              } catch {}
            }

            if (isFreshAlert) {
               const alreadyFreshInSession = prevToasts.some(t => t.taskId === task.id && t.urgency === urgency);
               if (!alreadyFreshInSession) {
                 if (typeof window !== "undefined") {
                   localStorage.setItem(alertedKey, JSON.stringify({ alertedAt: alertedMs, displayTime: alertTimestamp }));
                 }
                 
                 // Fire OS Notification for truly fresh events
                 fireOsNotification({
                    id: `${task.id}-${urgency}-${alertedMs}`,
                    taskId: task.id,
                    taskName: task.name,
                    urgency,
                    deadline: task.deadline || "",
                    timestamp: alertTimestamp,
                    alertedAt: alertedMs,
                    read: false // Matches type
                 });
               }
            }

            urgentAlerts.push({ 
              id: `${task.id}-${urgency}-${alertedMs}`,
              taskId: task.id, 
              taskName: task.name, 
              urgency, 
              deadline: task.deadline ?? "", 
              timestamp: alertTimestamp,
              alertedAt: alertedMs,
              read: false
            });
          }
        }

        // Global Sync: Sort so most recent is at the top
        const sorted = [...urgentAlerts].sort((a, b) => (b.alertedAt || 0) - (a.alertedAt || 0));
        localStorage.setItem("proactive_active_toasts", JSON.stringify(sorted));
        
        // Signal that new alerts are ready
        window.dispatchEvent(new Event('notifications-updated'));
        
        if (tasksActuallyChanged) {
          window.dispatchEvent(new Event('notion-tasks-updated'));
        }
        
        activeToastsRef.current = sorted;

        // Logic: Monitor capacity state and trigger notifications on change.
        const storedFingerprint = localStorage.getItem("proactive_tasks_fingerprint");
        
        if (currentFingerprint !== storedFingerprint) {
            const offsetMinutes = -now.getTimezoneOffset();
            const sign = offsetMinutes >= 0 ? '+' : '-';
            const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, '0');
            const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, '0');
            const userOffset = `${sign}${hours}:${minutes}`;

            // Sync: Load persistent durations from local vault.
            const savedEstimates = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("proactive_task_estimates") || "{}") : {};

            const report = await getCapacityInsights(freshTasks, userOffset, savedEstimates);
            if (report && report.insights && report.overallSummary) {
                // Persistence: Write fresh durations to the local vault.
                const updatedEstimates = { ...savedEstimates };
                report.insights.forEach(day => {
                   day.taskInsights?.forEach(t => {
                     const task = freshTasks.find(ft => ft.name === t.name);
                     if (task) updatedEstimates[`${task.id}-${task.name}`] = t.estimatedHours;
                   });
                });
                if (typeof window !== "undefined") {
                   localStorage.setItem("proactive_task_estimates", JSON.stringify(updatedEstimates));
                }

                const results = report.insights.filter(i => i.status === "BUSY" || i.status === "OVERLOADED");
                
                // Add capacity-specific insights
                const capacityAlerts: any[] = results.map(i => ({
                    id: `capacity-${i.date}`,
                    taskId: `capacity-${i.date}`,
                    taskName: i.status === "OVERLOADED" ? `Overload on ${i.date}` : `Heavy Workload on ${i.date}`,
                    urgency: i.status === "OVERLOADED" ? "CAPACITY_OVERLOADED" : "CAPACITY_BUSY",
                    deadline: i.date,
                    timestamp: new Date().toISOString(),
                    suggestion: i.suggestion,
                    mitigationSuggestion: i.suggestion,
                    mitigationTaskName: i.mitigationTaskName,
                    mitigationTargetDate: i.mitigationTargetDate,
                    totalHours: i.totalHours,
                    status: i.status,
                    date: i.date // CRITICAL: Required by DashboardHeader filter
                }));

                localStorage.setItem("proactive_tasks_fingerprint", currentFingerprint);
                
                // CRITICAL: Only update the 'updatedAt' timestamp if we actually HAVE alerts to show.
                // This prevents "Ghost Notifications" from appearing when there's nothing to see.
                const lastData = JSON.parse(localStorage.getItem("proactive_capacity_alerts") || "{}");
                const hasNewAlerts = capacityAlerts.length > 0;
                
                localStorage.setItem("proactive_capacity_alerts", JSON.stringify({
                    alerts: capacityAlerts,
                    summary: report.overallSummary,
                    updatedAt: hasNewAlerts ? Date.now() : (lastData.updatedAt || Date.now())
                }));
                
                window.dispatchEvent(new Event('capacity-alerts-updated'));
            }
        }

      } catch (err) {
        console.error("AgentEngine Sync Error:", err);
      }
    };

    syncNotifications();
    const intervalId = setInterval(syncNotifications, NOTIFICATION_INTERVAL);
    
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    return () => clearInterval(intervalId);
  }, [fireOsNotification]);

  return null;
}
