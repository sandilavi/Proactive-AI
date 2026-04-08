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
  date: string;
  timestamp: string;
  alertedAt?: number;
  read: boolean;
  // New mitigation fields
  mitigationSuggestion?: string;
  mitigationTaskName?: string;
  mitigationTargetDate?: string;
  suggestion?: string;
  totalHours?: number;
  status?: string;
}

export default function AgentEngine() {
  const activeToastsRef = useRef<ProactiveAlert[]>([]);
  const taskFingerprintRef = useRef<string>("");
  const capacityFingerprintRef = useRef<string>("");
  const notifiedUrgentRef = useRef<Set<string>>(new Set());
  const notifiedCapacityRef = useRef<Set<string>>(new Set());

  const fireOsNotification = useCallback((alert: ProactiveAlert) => {
    const urgencyLabel: Record<ProactiveAlert["urgency"], string> = {
      OVERDUE:  "🚨 OVERDUE",
      TODAY:    "⚠️ Due TODAY",
      TOMORROW: "⚠️ Due TOMORROW",
      SOON:     "🔔 Due Soon",
      CAPACITY_BUSY: "⚠️ HEAVY LOAD",
      CAPACITY_OVERLOADED: "🔥 OVERLOADED"
    };
    const body = alert.mitigationSuggestion || alert.suggestion || `"${alert.taskName}" — ${urgencyLabel[alert.urgency]}`;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification("ProActiveAI Intelligence", { body, icon: "/favicon.ico", tag: alert.id });
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
        const freshTasks = await fetchNotionTasks();
        if (!freshTasks) return;

        const now = new Date();
        // USE LOCAL ISO STRING: Ensures 'today' rolls over at the user's actual midnight, not UTC's.
        const today = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
        const prevToasts = activeToastsRef.current;
        const currentFingerprint = `v11|${today}|` + [...freshTasks]
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
          const deadlineTime = deadline.getTime();
          const nowTime = now.getTime();
          
          let urgency: ProactiveAlert["urgency"] | null = null;
          
          if (task.deadline) {
            const deadlineStr = task.deadline.split('T')[0];
            const deadlineDate = new Date(deadlineStr);
            const nowNoTime = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            
            // Calculate day difference using local midnights
            const diffTime = deadlineDate.getTime() - nowNoTime.getTime();
            const diffDays = Math.round(diffTime / (1000 * 60 * 60 * 24));

            if (deadlineStr < today) urgency = "OVERDUE";
            else if (deadlineStr === today) {
                // PRECISION CHECK: If it's today, only flip to OVERDUE if it has a specific time
                const dText = task.deadline.toUpperCase();
                const hasTime = dText.includes('T') || dText.includes(':') || dText.includes('.') || dText.includes('AM') || dText.includes('PM');
                
                if (hasTime) {
                    const deadlineTime = new Date(task.deadline).getTime();
                    const currentTime = now.getTime();
                    if (currentTime > deadlineTime) {
                        urgency = "OVERDUE";
                    } else {
                        urgency = "TODAY";
                    }
                } else {
                    // No time component? It's "Due Today" for the entire day.
                    urgency = "TODAY";
                }
            }
            else if (diffDays === 1) urgency = "TOMORROW";
            else if (diffDays > 1 && diffDays <= 3) urgency = "SOON";
          }

          if (urgency) {
            const existingAlert = prevToasts.find(t => t.taskId === task.id);
            const nowString = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            let alertTimestamp = nowString;
            let alertedMs = Date.now();
            let isFreshAlert = true;
            let isFreshId = true;

            const currentUrgency = urgency; // Narrowing for TS safety

            // CHECK: Did we already alert the user at this level OR a more critical level?
            if (existingAlert) {
              const oldRank = urgencyRank[existingAlert.urgency];
              const newRank = urgencyRank[currentUrgency];
              
              if (newRank < oldRank || (existingAlert.urgency === "OVERDUE" && currentUrgency === "TODAY")) {
                // Task became MORE critical (e.g. Tomorrow -> Today) OR we are performing a Correction (Overdue -> Today)
                isFreshAlert = true;
                // Generate a NEW ID to trigger a "NEW" badge and fresh notification
                alertedMs = Date.now();
                isFreshId = true;
              } else {
                // Task is same or less critical (already notified)
                // PRESERVE the original "alertedAt" to keep the ID stable and avoid ghost "NEW" badges
                alertTimestamp = existingAlert.timestamp;
                alertedMs = existingAlert.alertedAt || Date.now();
                isFreshAlert = false;
                isFreshId = false;
              }
            } else {
              // Check Persistent Storage if session is fresh
              // Key includes deadline so a deadline change invalidates the old cache
              const alertedKeyPrefix = `proactive_alert_${task.id}_${task.deadline ?? ""}_`;
              const allKeys = typeof window !== "undefined" ? Object.keys(localStorage) : [];
              const taskKeys = allKeys.filter(k => k.startsWith(alertedKeyPrefix));
              
              if (taskKeys.length > 0) {
                let bestPreviousRank = 99;
                let bestPrevData: { alertedAt?: number; displayTime?: string } | null = null;
                
                taskKeys.forEach(k => {
                  const levelStr = k.replace(alertedKeyPrefix, "");
                  const rank = (urgencyRank as any)[levelStr];
                  if (typeof rank === 'number' && rank < bestPreviousRank) {
                    bestPreviousRank = rank;
                    try {
                      const saved = localStorage.getItem(k);
                      if (saved) bestPrevData = JSON.parse(saved);
                    } catch {}
                  }
                });

                if (urgencyRank[currentUrgency] < bestPreviousRank) {
                  isFreshAlert = true;
                } else if (bestPrevData) {
                  const data = bestPrevData as { displayTime?: string; alertedAt?: number; originalUrgency?: ProactiveAlert["urgency"] };
                  alertTimestamp = data.displayTime || nowString;
                  alertedMs = data.alertedAt || Date.now();
                  // RESTORE: Use the more critical urgency from history to avoid ghost notifications
                  if (data.originalUrgency) urgency = data.originalUrgency;
                  isFreshAlert = false;
                }
              }
            }

            if (isFreshAlert) {
               // Include deadline in key so stale cache is busted when deadline changes
               const alertedKey = `proactive_alert_${task.id}_${task.deadline ?? ""}_${currentUrgency}`;
               const alreadyFreshInSession = prevToasts.some(t => t.taskId === task.id && t.urgency === urgency);
                if (!alreadyFreshInSession) {
                  const urgentNotificationKey = `${task.id}-${urgency}`;
                  if (!notifiedUrgentRef.current.has(urgentNotificationKey)) {
                    // STAMP FIRST: Claim the slot before firing to prevent async race conditions
                    notifiedUrgentRef.current.add(urgentNotificationKey);

                    if (typeof window !== "undefined") {
                      localStorage.setItem(alertedKey, JSON.stringify({ alertedAt: alertedMs, displayTime: alertTimestamp, originalUrgency: currentUrgency }));
                    }
                    
                    // Fire OS Notification for truly fresh events
                    fireOsNotification({
                       id: `${task.id}-${urgency}-${alertedMs}`,
                       taskId: task.id,
                       taskName: task.name,
                       urgency,
                       deadline: task.deadline || "",
                       date: task.deadline || "",
                       timestamp: alertTimestamp,
                       alertedAt: alertedMs,
                       read: false
                    });
                  }
                }
            }

            urgentAlerts.push({ 
              id: isFreshId ? `${task.id}-${urgency}-${alertedMs}` : existingAlert?.id || `${task.id}-${urgency}-${alertedMs}`,
              taskId: task.id, 
              taskName: task.name, 
              urgency, 
              deadline: task.deadline ?? "", 
              date: task.deadline ?? "",
              timestamp: alertTimestamp,
              alertedAt: alertedMs,
              read: isFreshId ? false : (existingAlert?.read || false)
            });
          }
        }

        // Signal that new alerts are ready
        window.dispatchEvent(new Event('notifications-updated'));
        
        if (tasksActuallyChanged) {
          window.dispatchEvent(new Event('notion-tasks-updated'));
        }
        


        // Logic: Monitor capacity state and trigger notifications on change.
        const storedFingerprint = localStorage.getItem("proactive_capacity_fingerprint");
        const currentCapacityFingerprint = `v9|${today}|${currentFingerprint}`;
        
        if (currentCapacityFingerprint !== storedFingerprint) {
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

                // Filter results based on STRICT mathematical thresholds (AI can sometimes hallucinate status)
                const results = report.insights.filter(i => (i.totalHours || 0) > 9 || i.status === "BUSY" || i.status === "OVERLOADED");
                
                // Get persistent rejections to avoid double-processing
                const rejected = typeof window !== "undefined" ? JSON.parse(localStorage.getItem("proactive_rejected_moves") || "[]") : [];

                // Add capacity-specific insights
                const capacityAlerts: ProactiveAlert[] = results.map(i => {
                    const alert = {
                        id: `capacity-${i.date}`,
                        taskId: `capacity-${i.date}`,
                        taskName: i.status === "OVERLOADED" ? `Overload on ${i.date}` : `Heavy Workload on ${i.date}`,
                        urgency: i.status === "OVERLOADED" ? "CAPACITY_OVERLOADED" : "CAPACITY_BUSY",
                        deadline: i.date,
                        date: i.date,
                        timestamp: new Date().toISOString(),
                        alertedAt: Date.now(),
                        read: false,
                        suggestion: i.suggestion,
                        totalHours: i.totalHours,
                        status: i.totalHours > 12 ? "OVERLOADED" : i.totalHours > 9 ? "BUSY" : i.status,
                        mitigationSuggestion: i.suggestion,
                        mitigationTaskName: i.mitigationTaskName,
                        mitigationTargetDate: i.mitigationTargetDate,
                    } as ProactiveAlert;

                    // Trigger OS Notification for NEW capacity alerts
                    const notificationKey = `${alert.id}-${alert.urgency}-${i.suggestion?.slice(0, 50)}`;
                    if (!notifiedCapacityRef.current.has(notificationKey)) {
                        fireOsNotification(alert);
                        notifiedCapacityRef.current.add(notificationKey);
                    }

                    return alert;
                }).filter(a => {
                    if (!a.mitigationTaskName || !a.mitigationTargetDate) return true;
                    const key = `${a.mitigationTaskName}|${a.date}|${a.mitigationTargetDate}`;
                    return !rejected.includes(key);
                });

                localStorage.setItem("proactive_capacity_fingerprint", currentCapacityFingerprint);
                
                // Compute deadline fingerprint for change-detection in StrategyView
                const deadlineFingerprint = freshTasks
                  .filter(t => t.status?.toLowerCase() !== "done")
                  .map(t => `${t.id}:${t.deadline ?? ""}`)
                  .sort()
                  .join("|");

                // CRITICAL: Only update the 'updatedAt' timestamp if we actually HAVE alerts to show.
                // This prevents "Ghost Notifications" from appearing when there's nothing to see.
                const lastData = JSON.parse(localStorage.getItem("proactive_capacity_alerts") || "{}");
                const hasNewAlerts = capacityAlerts.length > 0;
                const deadlineChanged = deadlineFingerprint !== (lastData.deadlineFingerprint || "");
                
                localStorage.setItem("proactive_capacity_alerts", JSON.stringify({
                    alerts: capacityAlerts,
                    summary: report.overallSummary,
                    deadlineFingerprint,
                    updatedAt: (hasNewAlerts || deadlineChanged) ? Date.now() : (lastData.updatedAt || Date.now())
                }));

                // FINAL SYNC (System Alerts Hub): Sort so most recent is at the top
                const finalToasts = [...urgentAlerts].sort((a, b) => (b.alertedAt || 0) - (a.alertedAt || 0));
                localStorage.setItem("proactive_active_toasts", JSON.stringify(finalToasts));
                activeToastsRef.current = finalToasts;
                window.dispatchEvent(new Event('notifications-updated'));
                window.dispatchEvent(new Event('capacity-alerts-updated'));
            } else {
              // NO CHANGES: Keep existing alerts but make sure state is ready
              const finalToasts = [...urgentAlerts].sort((a, b) => (b.alertedAt || 0) - (a.alertedAt || 0));
              localStorage.setItem("proactive_active_toasts", JSON.stringify(finalToasts));
              activeToastsRef.current = finalToasts;
              window.dispatchEvent(new Event('capacity-alerts-updated'));
            }
        } else {
            // NO CHANGES: Keep existing alerts but make sure state is ready
            const finalToasts = [...urgentAlerts].sort((a, b) => (b.alertedAt || 0) - (a.alertedAt || 0));
            localStorage.setItem("proactive_active_toasts", JSON.stringify(finalToasts));
            activeToastsRef.current = finalToasts;
            window.dispatchEvent(new Event('capacity-alerts-updated'));
        }

      } catch (err) {
        console.error("AgentEngine Sync Error:", err);
      }
    };

    syncNotifications();
    const intervalId = setInterval(syncNotifications, NOTIFICATION_INTERVAL);
    
    const handleManualRefresh = () => {
        syncNotifications();
    };
    window.addEventListener('notion-tasks-updated', handleManualRefresh);

    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "default") {
        Notification.requestPermission();
    }

    return () => {
        clearInterval(intervalId);
        window.removeEventListener('notion-tasks-updated', handleManualRefresh);
    };
  }, [fireOsNotification]);

  return null;
}
