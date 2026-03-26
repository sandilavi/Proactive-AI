"use client";
import { useEffect, useCallback, useRef } from "react";
import { fetchNotionTasks } from "@/app/actions/notion-actions";
import { getCapacityInsights } from "@/app/actions/agent-actions";

const NOTIFICATION_INTERVAL = 5 * 60 * 1000; // 5 minutes

interface ProactiveAlert {
  id: string;
  taskId: string;
  taskName: string;
  urgency: "OVERDUE" | "TODAY" | "TOMORROW" | "SOON";
  deadline: string;
  timestamp: string;
  alertedAt?: number;
}

function classifyDeadline(deadline: string): ProactiveAlert["urgency"] | null {
  if (!deadline || deadline === "No Deadline") return null;
  const now = new Date();
  const deadlineDate = new Date(deadline);
  const hasTime = deadline.includes("T");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const deadlineDay = new Date(deadlineDate); deadlineDay.setHours(0, 0, 0, 0);
  if (isNaN(deadlineDay.getTime())) return null;
  const diffDays = Math.round((deadlineDay.getTime() - today.getTime()) / 86400000);
  if (diffDays < 0) return "OVERDUE";
  if (diffDays === 0) {
    if (hasTime && deadlineDate < now) return "OVERDUE";
    return "TODAY";
  }
  if (diffDays === 1) return "TOMORROW";
  if (diffDays >= 2 && diffDays <= 3) return "SOON";
  return null;
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
    };
    const body = `"${alert.taskName}" — ${urgencyLabel[alert.urgency]}`;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification("ProActiveAI Intelligence", { body, icon: "/favicon.ico", tag: alert.taskId });
    }
  }, []);

  useEffect(() => {
    const urgencyRank: Record<ProactiveAlert["urgency"], number> = { OVERDUE: 0, TODAY: 1, TOMORROW: 2, SOON: 3 };

    const syncNotifications = async () => {
      try {
        const tasks = await fetchNotionTasks();
        if (!tasks) return;
        
        const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done");
        const prevToasts = activeToastsRef.current;
        const urgentAlerts: ProactiveAlert[] = [];
        const now = new Date();
        const nowString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let newUnreadFound = false;

        for (const task of activeTasks) {
          const urgency = classifyDeadline(task.deadline ?? "");
          if (!urgency) continue;

          const mutedKey = `proactive_muted_${task.id}_${urgency}`;
          if (typeof window !== "undefined" && localStorage.getItem(mutedKey)) continue;

          const existingAlert = prevToasts.find(t => t.taskId === task.id);
          const alertedKey = `proactive_alerted_${task.id}_${urgency}`;
          
          let alertTimestamp = nowString;
          let alertedMs = Date.now();
          let isFreshAlert = true;

          if (existingAlert) {
            const oldRank = urgencyRank[existingAlert.urgency];
            const newRank = urgencyRank[urgency];
            if (newRank < oldRank) {
              isFreshAlert = true; 
            } else {
              alertTimestamp = existingAlert.timestamp;
              alertedMs = existingAlert.alertedAt || Date.now();
              isFreshAlert = false;
            }
          } 
          else if (typeof window !== "undefined") {
            const cached = localStorage.getItem(alertedKey);
            if (cached && cached.startsWith('{')) {
              try {
                const parsed = JSON.parse(cached);
                alertTimestamp = parsed.displayTime || nowString;
                alertedMs = parsed.alertedAt || Date.now();
                isFreshAlert = false;
              } catch {}
            }
          }

          if (isFreshAlert) {
             const alreadyFreshInSession = prevToasts.some(t => t.taskId === task.id && t.urgency === urgency);
             if (!alreadyFreshInSession) {
               newUnreadFound = true;
               if (typeof window !== "undefined") {
                 localStorage.setItem(alertedKey, JSON.stringify({ alertedAt: alertedMs, displayTime: alertTimestamp }));
               }
               
               // Fire OS Notification for truly fresh events
               const newAlert: ProactiveAlert = {
                 id: `${task.id}-${urgency}-${alertedMs}`,
                 taskId: task.id,
                 taskName: task.name,
                 urgency,
                 deadline: task.deadline || "",
                 timestamp: alertTimestamp,
                 alertedAt: alertedMs
               };
               fireOsNotification(newAlert);
             }
          }

          urgentAlerts.push({ 
            id: `${task.id}-${urgency}-${alertedMs}`,
            taskId: task.id, 
            taskName: task.name, 
            urgency, 
            deadline: task.deadline ?? "", 
            timestamp: alertTimestamp,
            alertedAt: alertedMs 
          });
        }

        // 2. Performance Tracking: Check if tasks changed since last sync
        // SORT before join to ensure identity even if Notion API order changes
        const currentFingerprint = [...tasks]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map(t => `${t.id}-${t.status}-${t.name}-${t.deadline}`)
          .join("|");
          
        const tasksActuallyChanged = taskFingerprintRef.current !== "" && taskFingerprintRef.current !== currentFingerprint;
        taskFingerprintRef.current = currentFingerprint;

        // Global Sync: Sort so most recent is at the top
        const sorted = [...urgentAlerts].sort((a, b) => (b.alertedAt || 0) - (a.alertedAt || 0));
        localStorage.setItem("proactive_active_toasts", JSON.stringify(sorted));
        
        // Signal that new alerts are ready
        window.dispatchEvent(new Event('notifications-updated'));
        
        // If the task list itself changed (e.g. data modified in Notion app), signal the Strategy/Dashboard pages
        if (tasksActuallyChanged) {
          window.dispatchEvent(new Event('notion-tasks-updated'));
        }
        
        activeToastsRef.current = sorted;

        // 3. Strategic Capacity Monitor: Detect burnout risk
        const storedFingerprint = localStorage.getItem("proactive_tasks_fingerprint");
        
        // ONLY call the AI if the tasks have actually changed since the last saved report
        if (currentFingerprint !== storedFingerprint) {
            const offsetMinutes = -now.getTimezoneOffset();
            const sign = offsetMinutes >= 0 ? '+' : '-';
            const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, '0');
            const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, '0');
            const userOffset = `${sign}${hours}:${minutes}`;

            const report = await getCapacityInsights(tasks, userOffset);
            if (report && report.insights) {
                const alerts = report.insights.filter(i => i.status === "BUSY" || i.status === "OVERLOADED");
                localStorage.setItem("proactive_tasks_fingerprint", currentFingerprint);
                localStorage.setItem("proactive_capacity_alerts", JSON.stringify({
                    alerts,
                    summary: report.overallSummary,
                    updatedAt: Date.now()
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
