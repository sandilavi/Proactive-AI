"use client";
import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { executeUserPrompt, confirmAction, getAgentSuggestion, NotionTask, AgentSuggestion, AgentResponse } from "@/app/actions/agent-actions";
import { fetchNotionTasks, NotionDatabase } from "@/app/actions/notion-actions";
 import { X, Zap, Trash2, AlertTriangle, Check, Bell, BellRing, Clock, Brain, Sparkles } from "lucide-react";

// Proactive Notification Timer
const NOTIFICATION_INTERVAL    = 5  * 60 * 1000; // 5 minutes
const TASK_SYNC_INTERVAL       = 5  * 60 * 1000; // 5 minutes

interface ProactiveAlert {
  id: string;
  taskId: string;
  taskName: string;
  urgency: "OVERDUE" | "TODAY" | "TOMORROW" | "SOON";
  deadline: string;
  timestamp: string; // The original pre-formatted time string (e.g. "11:45 PM")
  alertedAt?: number; // Raw milliseconds when this was first established
}

// Function To Classify Deadlines
function classifyDeadline(deadline: string): ProactiveAlert["urgency"] | null {
  if (!deadline || deadline === "No Deadline") return null;

  const now = new Date();
  const deadlineDate = new Date(deadline);
  const hasTime = deadline.includes("T");

  const today = new Date(); today.setHours(0, 0, 0, 0);
  const deadlineDay = new Date(deadlineDate); deadlineDay.setHours(0, 0, 0, 0);

  if (isNaN(deadlineDay.getTime())) return null;

  const diffDays = Math.round((deadlineDay.getTime() - today.getTime()) / 86400000);

  if (diffDays < 0) return "OVERDUE";              // Past calendar day → always overdue
  if (diffDays === 0) {
    // Due today: only mark OVERDUE if it has a specific time AND that time has passed
    if (hasTime && deadlineDate < now) return "OVERDUE";
    return "TODAY";                                // Still pending today (or date-only)
  }
  if (diffDays === 1) return "TOMORROW";           // Due tomorrow → orange
  if (diffDays >= 2 && diffDays <= 3) return "SOON"; // 2-3 days → blue
  return null;                                     // Beyond 3 days → no notification
}

// Function To Format Deadlines
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

function statusBadge(status: string) {
  const label = status || "Pending";
  const s = status.toLowerCase();
  const base = "inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap shadow-sm border";
  
  if (s === "done") {
    return <span className={`${base} bg-emerald-50 text-emerald-600 border-emerald-100`}>{label}</span>;
  }
  if (s === "in progress") {
    return <span className={`${base} bg-blue-50 text-blue-600 border-blue-100`}>{label}</span>;
  }
  
  return <span className={`${base} bg-slate-50 text-slate-500 border-slate-200`}>{label}</span>;
}

function priorityConfig(priority: any) {
  // Guard against non-string values from LLM
  const p = typeof priority === "string" ? priority.toUpperCase() : "";
  
  if (p === "CRITICAL") return { border: "border-red-200", headerBg: "bg-red-50 border-red-100", cardBg: "bg-red-50/40", badge: "bg-red-100 text-red-700", accent: "bg-red-500", iconColor: "text-red-500" };
  if (p === "HIGH")     return { border: "border-orange-200", headerBg: "bg-orange-50 border-orange-100", cardBg: "bg-orange-50/40", badge: "bg-orange-100 text-orange-700", accent: "bg-orange-500", iconColor: "text-orange-500" };
  if (p === "MEDIUM")   return { border: "border-blue-200", headerBg: "bg-blue-50 border-blue-100", cardBg: "bg-blue-50/40", badge: "bg-blue-100 text-blue-700", accent: "bg-blue-400", iconColor: "text-blue-500" };
  return                       { border: "border-gray-200", headerBg: "bg-gray-50 border-gray-100", cardBg: "bg-gray-50/40", badge: "bg-gray-100 text-gray-600", accent: "bg-gray-400", iconColor: "text-gray-400" };
}


const getFormattedAlertTime = (ms: number | undefined, timeString: string) => {
  if (!ms) return timeString;
  const now = new Date();
  const alert = new Date(ms);
  
  const isSameDay = now.getFullYear() === alert.getFullYear() &&
                  now.getMonth() === alert.getMonth() &&
                  now.getDate() === alert.getDate();
  
  if (isSameDay) return timeString; // "Today" is implied, keep it clean
  
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = yesterday.getFullYear() === alert.getFullYear() &&
                    yesterday.getMonth() === alert.getMonth() &&
                    yesterday.getDate() === alert.getDate();
  
  if (isYesterday) return `Yesterday, ${timeString}`;
  
  return `${alert.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeString}`;
};


interface CommandInputProps {
  initialTasks?: NotionTask[];
  databases?: NotionDatabase[];
}

export default function CommandInput({ initialTasks, databases = [] }: CommandInputProps) {
  const databaseCount = databases.length;
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [taskList, setTaskList] = useState<NotionTask[] | null>(initialTasks ?? null);
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(null);
  // Proactive Suggestion Logic (Client-side to capture local timezone)
  useEffect(() => {
    const fetchLocalSuggestion = async () => {
      const currentTasks = taskList || initialTasks;
      if (!currentTasks || currentTasks.length === 0) return;

      // GUARD: Only fetch or update the suggestion if the user is in the "Initial State"
      // This prevents the card from suddenly appearing or changing while the user is in a chat.
      if (message || pendingDecision || status !== "idle") {
        return;
      }

      // Handle Caching: Don't re-fetch if we have a fresh one AND tasks haven't changed
      const cached = localStorage.getItem("proactive_auto_suggestion");
      const lastFetch = localStorage.getItem("proactive_last_fetch");
      const lastFingerprint = localStorage.getItem("proactive_task_fingerprint");
      // Create a fingerprint of current tasks (ID + Status + Name + Deadline)
      const currentFingerprint = (taskList || initialTasks || []).map(t => `${t.id}-${t.name}-${t.status}-${t.deadline}`).join("|");
      const isTaskListSame = lastFingerprint === currentFingerprint;

      const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
      const lastFetchDay = localStorage.getItem("proactive_last_fetch_day");
      const isSameDay = lastFetchDay === todayStr;
      
      // CRITICAL: We only re-fetch if tasks changed OR it's a new day (past midnight).
      // If tasks are identical and it's the same day, we persist the suggestion indefinitely.
      if (cached && isTaskListSame && isSameDay) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.suggestion && typeof parsed.confidence === "number" && parsed.priority) {
            setSuggestion(parsed);
            return;
          }
        } catch {
          // If parse fails, we continue to fetch a fresh one
        }
      }

      // Fetch new suggestion with local offset
      try {
        const offsetMinutes = -new Date().getTimezoneOffset();
        const absOffset = Math.abs(offsetMinutes);
        const hours = Math.floor(absOffset / 60).toString().padStart(2, "0");
        const minutes = (absOffset % 60).toString().padStart(2, "0");
        const sign = offsetMinutes >= 0 ? "+" : "-";
        const userOffset = `${sign}${hours}:${minutes}`;

        const newSuggestion = await getAgentSuggestion(taskList || initialTasks || [], userOffset);
        if (newSuggestion) {
          let finalSuggestion = newSuggestion;

          // Smart Consistency Check:
          // 1. If suggestion & priority match EXACTLY:
          //    - If confidence change is minor (< 15%), stick to the old card entirely (no flicker).
          //    - If confidence change is major (>= 15%), update the whole card (reveal new reasoning).
          if (cached) {
            try {
              const old = JSON.parse(cached);
              const isSameTask = old && old.suggestion === newSuggestion.suggestion && old.priority === newSuggestion.priority && isSameDay;
              
              if (isSameTask) {
                const confDiff = Math.abs((old.confidence || 0) - (newSuggestion.confidence || 0));
                
                if (confDiff < 0.15) {
                  // Minor shift: Use old text AND old confidence to keep UI "frozen"
                  finalSuggestion = {
                    ...newSuggestion,
                    reason: old.reason,
                    confidence: old.confidence,
                    thinkContext: old.thinkContext ?? newSuggestion.thinkContext
                  };
                } else {
                  // Major shift: Let the new suggestion flow through (FinalSuggestion is already newSuggestion)
                }
              }
            } catch {
              // Ignore parse errors, just use new suggestion
            }
          }

          setSuggestion(finalSuggestion);
          localStorage.setItem("proactive_auto_suggestion", JSON.stringify(finalSuggestion));
          localStorage.setItem("proactive_last_fetch", Date.now().toString());
          localStorage.setItem("proactive_last_fetch_day", todayStr);
          localStorage.setItem("proactive_task_fingerprint", currentFingerprint);
        }
      } catch (err) {
        console.error("Failed to fetch client-side suggestion:", err);
      }
    };

    fetchLocalSuggestion();
  }, [taskList, initialTasks]);
  const [pendingDecision, setPendingDecision] = useState<AgentResponse | null>(null);
  const [pendingTaskName, setPendingTaskName] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [thinkContext, setThinkContext] = useState("");
  const [thinkOpen, setThinkOpen] = useState(false);
  const [deadlineConflict, setDeadlineConflict] = useState(false);
  const [conflictingTaskNames, setConflictingTaskNames] = useState<string[]>([]);
  const [duplicateTask, setDuplicateTask] = useState(false);
  const [duplicateTaskName, setDuplicateTaskName] = useState("");
  const [proactiveThinkOpen, setProactiveThinkOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Proactive Notification State
  const [activeToasts, setActiveToasts] = useState<ProactiveAlert[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotificationPanel, setShowNotificationPanel] = useState(false);

  // Safely track activeToasts in a ref to avoid React StrictMode double-fire bugs
  const activeToastsRef = useRef<ProactiveAlert[]>([]);
  useEffect(() => { activeToastsRef.current = activeToasts; }, [activeToasts]);

  // Request browser notification permission once on mount
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      if (Notification.permission === "default") {
        Notification.requestPermission();
      }
    }
  }, []);

  // Fire OS notification for a single task alert
  const fireOsNotification = useCallback((alert: ProactiveAlert) => {
    const urgencyLabel: Record<ProactiveAlert["urgency"], string> = {
      OVERDUE:  "🚨 OVERDUE",
      TODAY:    "⚠️ Due TODAY",
      TOMORROW: "⚠️ Due TOMORROW",
      SOON:     "🔔 Due Soon",
    };
    const body = `"${alert.taskName}" — ${urgencyLabel[alert.urgency]}`;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification("ProActiveAI Alert", { body, icon: "/favicon.ico", tag: alert.taskId });
    }
  }, []);

  // Background interval: fetch tasks & classify deadlines every notification interval
  useEffect(() => {
    const urgencyRank: Record<ProactiveAlert["urgency"], number> = { OVERDUE: 0, TODAY: 1, TOMORROW: 2, SOON: 3 };

    const syncNotifications = async () => {
      try {
        const tasks = await fetchNotionTasks();
        const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done"); 

        const urgencyRank: Record<ProactiveAlert["urgency"], number> = { OVERDUE: 0, TODAY: 1, TOMORROW: 2, SOON: 3 };
        const prevToasts = activeToastsRef.current;
        const urgentAlerts: ProactiveAlert[] = [];
        const nowString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        let newUnreadCount = 0;

        for (const task of activeTasks) {
          const urgency = classifyDeadline(task.deadline ?? "");
          if (!urgency) continue;

          const mutedKey = `proactive_muted_${task.id}_${urgency}`;
          if (typeof window !== "undefined" && localStorage.getItem(mutedKey)) continue;

          // Find if this task ALREADY has a notification in ANY state (to check for progression)
          const existingAlert = prevToasts.find(t => t.taskId === task.id);
          const alertedKey = `proactive_alerted_${task.id}_${urgency}`;
          
          let alertTimestamp = nowString;
          let alertedMs = Date.now();
          let isFreshAlert = true;

          // Case 1: Task is already in the Notification Panel (in some state)
          if (existingAlert) {
            const oldRank = urgencyRank[existingAlert.urgency];
            const newRank = urgencyRank[urgency];

            // If it became MORE urgent (e.g. Tomorrow -> Today), it's a "Fresh Alert"
            if (newRank < oldRank) {
              isFreshAlert = true; // New timestamp, increment unread
            } else {
              // Same or Less urgent: Keep original timestamp and don't notify
              alertTimestamp = existingAlert.timestamp;
              alertedMs = existingAlert.alertedAt || Date.now();
              isFreshAlert = false;
            }
          } 
          // Case 2: Not in current panel, but check localStorage (persisted from previous session)
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
             // Check if we already "Fresh Alerted" this specific ID/Urgency in this session to avoid double-pings
             const alreadyFreshInSession = prevToasts.some(t => t.taskId === task.id && t.urgency === urgency);
             if (!alreadyFreshInSession) {
               newUnreadCount++;
               // Mark as alerted in storage
               if (typeof window !== "undefined") {
                 localStorage.setItem(alertedKey, JSON.stringify({ alertedAt: alertedMs, displayTime: alertTimestamp }));
               }
             }
          }

          urgentAlerts.push({ 
            id: `${task.id}-${urgency}-${alertedMs}`, // Include urgency in ID to force list refresh if state changes
            taskId: task.id, 
            taskName: task.name, 
            urgency, 
            deadline: task.deadline ?? "", 
            timestamp: alertTimestamp,
            alertedAt: alertedMs 
          });
        }

        if (newUnreadCount > 0) {
          setUnreadCount(prev => prev + newUnreadCount);
        }

        // Final sort: Newest on top
        const sorted = [...urgentAlerts].sort((a, b) => (b.alertedAt || 0) - (a.alertedAt || 0));
        setActiveToasts(sorted);

      } catch (err) {
        console.error("SyncNotifications Error:", err);
      }
    };

    syncNotifications(); // Run immediately on mount
    const intervalId = setInterval(syncNotifications, NOTIFICATION_INTERVAL);
    return () => clearInterval(intervalId); // cleanup on unmount
  }, [fireOsNotification]);


  // Background task sync - silently re-fetch Notion tasks every 60 seconds
  // Only updates the task table when it is currently visible (taskList !== null)
  // Skips update during confirmation flow to avoid disrupting the user
  useEffect(() => {
    const syncTasks = async () => {
      try {
        const fresh = await fetchNotionTasks();
        setTaskList(prev => {
          if (prev === null) return prev;          // table hidden - don't show it
          if (pendingDecision) return prev;        // mid-confirmation - don't disrupt
          return fresh;                            // silently swap in fresh data
        });
      } catch {
        // Silently fail - don't disrupt user on a background sync error
      }
    };

    const id = setInterval(syncTasks, TASK_SYNC_INTERVAL);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDecision]);


  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || status === "loading") return;
    setStatus("loading");
    setMessage("");
    setSuggestion(null);
    setThinkContext("");
    setThinkOpen(false);

    // Timezone logic
    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset();
    const sign = offsetMinutes >= 0 ? '+' : '-';
    const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, '0');
    const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, '0');
    const userOffset = `${sign}${hours}:${minutes}`;

    startTransition(async () => {
      try {
        const data = await executeUserPrompt(prompt, userOffset);
        setThinkContext(data.thinkContext || "");
        setThinkOpen(false);
        if (data.requiresConfirmation) {
          setPendingDecision(data.pendingDecision);
          setPendingTaskName(data.pendingTaskName);
          setTaskList(data.tasks ?? null);
          setDeadlineConflict(data.deadlineConflict ?? false);
          setConflictingTaskNames(data.conflictingTaskNames ?? []);
          setDuplicateTask(data.duplicateTask ?? false);
          setDuplicateTaskName(data.duplicateTaskName ?? "");
          setStatus("idle");
          setPrompt("");
        } else if (data.success) {
          setMessage(data.message);
          setTaskList(data.tasks ?? null);
          setStatus("success");
          setPrompt("");
        } else {
          setMessage(data.message || "Something went wrong");
          setTaskList(data.tasks ?? null);
          setStatus("error");
        }
      } catch {
        setStatus("error");
        setMessage("Failed to execute command.");
      }
    });
  };

  const handleConfirm = async () => {
    if (!pendingDecision) return;
    setConfirmLoading(true);
    try {
      const result = await confirmAction(pendingDecision);
      setMessage(result.message);
      setTaskList(result.tasks ?? null);
      setStatus(result.success ? "success" : "error");
    } catch {
      setStatus("error");
      setMessage("Failed to execute action.");
    } finally {
      setPendingDecision(null);
      setPendingTaskName("");
      setDeadlineConflict(false);
      setConflictingTaskNames([]);
      setDuplicateTask(false);
      setDuplicateTaskName("");
      setConfirmLoading(false);
    }
  };

  const handleCancel = () => {
    setPendingDecision(null);
    setPendingTaskName("");
    setDeadlineConflict(false);
    setConflictingTaskNames([]);
    setDuplicateTask(false);
    setDuplicateTaskName("");
    setStatus("idle");
    setMessage("Action cancelled.");
  };

  const isLoading = status === "loading" || isPending;

  return (
    <div className="relative">
       {/* Top Button Row: Bell + Help */}
       <div className="flex justify-end items-center gap-2 mb-2 pr-2 md:pr-4">


         {/* Notification Bell */}
          <button
            onClick={() => {
              if (activeToasts.length === 0) return; // Nothing happens if empty
              
              // Clear the red badge count when clicking the bell,
              // but keep the notifications in the list until manually dismissed.
              if (!showNotificationPanel) {
                setUnreadCount(0);
              }
              setShowNotificationPanel(!showNotificationPanel);
            }}
            className={`relative p-3.5 rounded-[1.25rem] transition-all duration-300 border cursor-pointer group hover:scale-105 z-20 ${
              showNotificationPanel && activeToasts.length > 0
                ? "bg-blue-600 text-white border-blue-600 shadow-xl shadow-md ring-4 ring-blue-50" 
                : "bg-white text-slate-400 border-slate-200/60 hover:border-slate-300 hover:text-slate-600 hover:shadow-md"
            }`}
            title={activeToasts.length === 0 ? "No Notifications" : "Notification alerts"}
          >
            {/* Background Glow when Unread */}
            
            
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
        </div>

        {/* In-App Proactive Panel: Premium Alert System */}
       {showNotificationPanel && activeToasts.length > 0 && (() => {
         const urgencyStyles: Record<ProactiveAlert["urgency"], { border: string; bg: string; iconColor: string; text: string; label: string; accent: string }> = {
           OVERDUE:  { border: "border-rose-200/50 hover:border-rose-300 shadow-rose-100/50", bg: "bg-white/60 backdrop-blur-xl", iconColor: "text-rose-500", text: "text-rose-900", label: "Critical Overdue", accent: "bg-rose-500" },
           TODAY:    { border: "border-orange-200/50 hover:border-orange-300 shadow-orange-100/50", bg: "bg-white/60 backdrop-blur-xl", iconColor: "text-orange-500", text: "text-orange-900", label: "Action Reqd Today", accent: "bg-orange-500" },
           TOMORROW: { border: "border-amber-200/50 hover:border-amber-300 shadow-amber-100/50", bg: "bg-white/60 backdrop-blur-xl", iconColor: "text-amber-500", text: "text-amber-900", label: "Upcoming Tomorrow", accent: "bg-amber-500" },
           SOON:     { border: "border-blue-200/50 hover:border-blue-300 shadow-blue-100/50", bg: "bg-white/60 backdrop-blur-xl", iconColor: "text-blue-500", text: "text-blue-900", label: "Future Horizon", accent: "bg-blue-500" },
         };
         return (
           <div className="flex flex-col gap-4 mb-4 animate-in slide-in-from-top-4 fade-in duration-700">
             <div className="flex items-center justify-between mb-2 px-4 md:px-2">
               <div className="flex items-center gap-3">
                 <div className="w-8 h-[2px] bg-slate-300 rounded-full"></div>
                 <span className="text-[11px] font-black text-slate-500 uppercase tracking-[0.3em]">System Intelligence Alerts ({activeToasts.length})</span>
               </div>
               <button 
                 onClick={() => { 
                   activeToasts.forEach(t => localStorage.setItem(`proactive_muted_${t.taskId}_${t.urgency}`, "true"));
                   setShowNotificationPanel(false); 
                   setActiveToasts([]);
                 }}
                 className="text-[10px] font-black text-rose-500 hover:text-rose-700 bg-rose-50 hover:bg-rose-100 px-5 py-2.5 rounded-[1rem] transition-all uppercase tracking-widest cursor-pointer shadow-sm border border-rose-100/50"
               >
                 Clear All Intel
               </button>
             </div>
             
             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-2 gap-5 pointer-events-auto">
                {activeToasts.map(toast => {
               const s = urgencyStyles[toast.urgency];
               return (
                 <div key={toast.id} className={`rounded-[2.5rem] border shadow-lg overflow-hidden relative group transition-all duration-500 hover:-translate-y-1 hover:shadow-xl ${s.border} ${s.bg}`}>
                   {/* Top Accent Strip */}
                   <div className={`absolute top-0 left-0 w-full h-1.5 opacity-80 z-20 ${s.accent}`}></div>
                   
                   {/* Decorative Icon Background */}
                   <div className="absolute top-0 right-0 p-8 opacity-[0.03] group-hover:opacity-[0.08] transition-opacity pointer-events-none z-0">
                     <BellRing size={120} className={s.iconColor} />
                   </div>
                   
                   <div className="px-8 py-7 flex items-start gap-5 relative z-10 w-full overflow-hidden">
                     {/* Icon Box */}
                     <div className={`p-3.5 rounded-2xl bg-white shadow-sm border border-slate-100/50 flex-shrink-0 mt-1 ${s.iconColor} group-hover:scale-110 transition-transform duration-500`}>
                       <BellRing size={22} className="fill-current/10" />
                     </div>
                     
                     <div className="flex-1 min-w-0 pr-6 w-full">
                       <div className="flex items-center justify-between mb-3 w-full">
                         <span className={`text-[9px] font-black uppercase tracking-[0.25em] px-3.5 py-1.5 rounded-full bg-white shadow-sm border border-slate-100/50 flex-shrink-0 ${s.iconColor}`}>{s.label}</span>
                         <span className="text-[10px] font-black text-slate-400 tabular-nums uppercase tracking-widest flex-shrink-0">{getFormattedAlertTime(toast.alertedAt, toast.timestamp)}</span>
                       </div>
                       
                       <p className={`text-lg font-black tracking-tight leading-tight mb-4 line-clamp-2 w-full pr-2 ${s.text}`}>{toast.taskName}</p>
                       
                       <div className="flex items-center gap-2">
                         <Clock size={12} className="text-slate-400 flex-shrink-0" />
                         <span className="text-xs font-bold text-slate-500 uppercase tracking-widest leading-none pt-0.5 truncate w-full">
                           {toast.deadline && toast.deadline !== "No Deadline"
                             ? formatDeadline(toast.deadline)
                             : "No deadline constraint"}
                         </span>
                       </div>
                     </div>
                     
                     {/* Close Button */}
                     <button onClick={() => {
                        localStorage.setItem(`proactive_muted_${toast.taskId}_${toast.urgency}`, "true");
                        const next = activeToasts.filter(t => t.id !== toast.id);
                        setActiveToasts(next);
                        if (next.length === 0) {
                          setShowNotificationPanel(false);
                        }
                     }} className="absolute top-6 right-6 text-slate-300 hover:text-rose-500 hover:bg-rose-50/80 hover:shadow-sm border border-transparent hover:border-rose-100 p-2.5 rounded-full cursor-pointer transition-all z-20"><X size={16} strokeWidth={3} /></button>
                   </div>
                 </div>
               );
                })}
              </div>
            </div>
         );
       })()}

         {/* Main Chat Card: Premium Glassmorphism */}
         <div className="bg-white/80 backdrop-blur-2xl border border-white/40 shadow-[0_32px_80px_-15px_rgba(0,0,0,0.08)] rounded-[3rem] overflow-hidden relative z-10 flex flex-col transition-all duration-700 hover:shadow-[0_45px_100px_-20px_rgba(0,0,0,0.12)] border-b-white/20">
           
           {/* Header with Source Badges: Refined Capsules */}
           <div className="px-8 py-5 pb-2 flex flex-col gap-4">
             <div className="flex flex-wrap items-center gap-3">
               <span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.25em] self-center mr-2 opacity-60">Sources</span>
               {databases.map(db => (
                 <div key={db.id} className="group relative flex items-center gap-2.5 bg-white/70 hover:bg-white border border-slate-100/80 px-4 py-2 rounded-full text-[10px] font-black text-slate-600 uppercase tracking-widest shadow-sm transition-all duration-300 cursor-default hover:scale-105 hover:border-blue-200">
                   <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div>
                   {db.name}
                 </div>
               ))}
               {databases.length === 0 && (
                 <div className="flex items-center gap-2 bg-red-50 border border-red-100 px-4 py-2 rounded-full text-[10px] font-black text-red-500 uppercase tracking-widest shadow-sm">
                   <AlertTriangle size={12} className="animate-bounce" />
                   No connection
                 </div>
               )}
             </div>
           </div>

           <div className="px-8 py-6 pt-2">
             <form onSubmit={handleSubmit} className="flex flex-col gap-6">
               <div className="relative group/input">
                 
                 
                 <input 
                   ref={inputRef} 
                   type="text" 
                   value={prompt} 
                   onChange={(e) => setPrompt(e.target.value)} 
                   placeholder="Type a command or ask a question..." 
                   className="relative w-full p-6 pr-16 rounded-[1.5rem] border border-slate-200/60 outline-none transition-all duration-500 focus:border-blue-500/30 focus:bg-white focus:ring-4 focus:ring-blue-500/5 bg-slate-50/50 text-slate-800 font-bold placeholder:text-slate-400 placeholder:font-medium text-lg leading-tight" 
                   disabled={isLoading} 
                 />
                 <button 
                   type="submit" 
                   disabled={isLoading || !prompt.trim()} 
                   className="absolute right-3 top-3 bottom-3 px-4 bg-slate-900 hover:bg-blue-600 text-white rounded-[1rem] transition-all duration-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed shadow-lg shadow-md hover:shadow-black/20 flex items-center justify-center min-w-[56px]"
                 >
                   {isLoading ? (
                     <div className="animate-spin h-6 w-6 border-3 border-white border-t-transparent rounded-full" />
                   ) : (
                     <Zap size={22} className="fill-current" />
                   )}
                 </button>
               </div>
             </form>

             {/* Thinking + Response - Premium unified card */}
             {(thinkContext || message || pendingDecision) && (
               <div className={`mt-8 rounded-[2rem] border overflow-hidden animate-in fade-in zoom-in-95 duration-500 ${
                 pendingDecision?.action === "DELETE"
                   ? "border-red-100 bg-red-50/30"
                   : "border-blue-100 bg-blue-50/30 shadow-inner"
               }`}>

                 {/* Show thinking toggle - first */}
                 {thinkContext && (
                   <div className={`px-6 pt-5 ${ (message || pendingDecision) ? "mb-4" : "pb-5" }`}>
                     <button
                       onClick={() => setThinkOpen((o) => !o)}
                       className="flex items-center gap-2 text-[11px] font-black text-slate-400 hover:text-blue-600 transition-all cursor-pointer select-none uppercase tracking-widest"
                     >
                       <Brain size={12} className={thinkOpen ? "text-blue-500" : ""} />
                       <span>{thinkOpen ? "Close Neural Process" : "View Neural Process"}</span>
                       <svg
                         viewBox="0 0 24 24"
                         fill="none"
                         stroke="currentColor"
                         strokeWidth="3"
                         className={`w-2.5 h-2.5 transition-transform duration-500 ${thinkOpen ? "rotate-180" : "rotate-0 text-slate-300"}`}
                       >
                         <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                       </svg>
                     </button>
                     {/* Scrollable full think log - no cutoff */}
                     {thinkOpen && (
                       <div className="mt-4 max-h-64 overflow-y-auto pl-4 border-l-2 border-slate-200/50 scrollbar-hide">
                         <p className="text-[12px] text-slate-500 italic leading-relaxed whitespace-pre-wrap font-mono opacity-80">
                           {thinkContext}
                         </p>
                       </div>
                     )}
                   </div>
                 )}

                 {/* Confirmation / Message Content Area */}
                 <div className="px-8 pb-8 pt-2">
                   {pendingDecision ? (
                      <div className="animate-in fade-in slide-in-from-top-2 duration-300">
                        <div className="flex items-start gap-4 mb-6">
                           <div className={`p-3 rounded-2xl flex-shrink-0 ${pendingDecision.action === "DELETE" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                              {pendingDecision.action === "DELETE" ? <Trash2 size={24} /> : <Zap size={24} />}
                           </div>
                           <div className="pt-1">
                              <h3 className="text-lg font-black text-slate-800 tracking-tight leading-snug">
                                {pendingDecision.action === "DELETE" && <>Confirm Deletion</>}
                                {pendingDecision.action === "UPDATE" && <>Verify Task Update</>}
                                {pendingDecision.action === "CREATE" && <>New Task Entry</>}
                                {pendingDecision.action === "PLAN" && <>AI Blueprint Ready</>}
                              </h3>
                              <p className="text-sm font-medium text-slate-500 mt-1">
                                {pendingDecision.action === "DELETE" && <>I&apos;m about to permanently remove <strong>&quot;{pendingTaskName}&quot;</strong> from your Notion.</>}
                                {pendingDecision.action === "UPDATE" && <>Preparing to update <strong>&quot;{pendingTaskName}&quot;</strong> with new parameters.</>}
                                {pendingDecision.action === "CREATE" && <>Generating a new record: <strong>&quot;{pendingDecision.data.title}&quot;</strong>.</>}
                                {pendingDecision.action === "PLAN" && <>Reviewing the calculated roadmap with <strong>{pendingDecision.data.plan?.length || 0} tasks</strong>.</>}
                              </p>
                           </div>
                        </div>

                        {/* Plan Details Rendering */}
                        {pendingDecision.action === "PLAN" && pendingDecision.data.plan && (
                          <div className="mb-6 space-y-4">
                            {pendingDecision.data.planSummary && (
                              <div className="p-4 bg-white/60 border border-blue-100 rounded-2xl shadow-sm">
                                <p className="text-xs text-blue-800 font-bold leading-relaxed flex items-center gap-2">
                                  <Sparkles size={14} className="text-blue-500 shrink-0" />
                                  {pendingDecision.data.planSummary}
                                </p>
                              </div>
                            )}
                            <div className="max-h-72 overflow-y-auto pr-2 space-y-3 scrollbar-hide">
                              {pendingDecision.data.plan.map((t, i) => (
                                <div key={i} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:border-blue-200 transition-colors">
                                  <div className="flex items-center justify-between mb-2">
                                    <span className="font-black text-slate-800 text-[13px] tracking-tight">{t.title}</span>
                                    {t.date && <span className="text-[10px] font-black text-slate-400 bg-slate-50 px-2.5 py-1 rounded-full uppercase tracking-widest">{formatDeadline(t.date)}</span>}
                                  </div>
                                  {t.reason && <p className="text-[11px] font-medium text-slate-500 leading-relaxed">{t.reason}</p>}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* General Action Details */}
                        {pendingDecision.action !== "PLAN" && (
                           <div className="mb-8 p-5 bg-white border border-slate-100 rounded-[1.5rem] shadow-sm flex flex-col gap-3">
                              {pendingDecision.action === "UPDATE" && (
                                <>
                                  <div className="flex items-center justify-between">
                                     <span className="text-[10px] font-black uppercase text-slate-400 tracking-widest">Property</span>
                                     <span className="text-[10px] font-black uppercase text-slate-600 tracking-widest">New Value</span>
                                  </div>
                                  {pendingDecision.data.status && (
                                     <div className="flex items-center justify-between border-t border-slate-50 pt-2">
                                        <span className="text-xs font-bold text-slate-500">Status</span>
                                        {statusBadge(pendingDecision.data.status)}
                                     </div>
                                  )}
                                  {pendingDecision.data.date && (
                                     <div className="flex items-center justify-between border-t border-slate-50 pt-2">
                                        <span className="text-xs font-bold text-slate-500">Deadline</span>
                                        <span className="text-xs font-black text-slate-800">{formatDeadline(pendingDecision.data.date)}</span>
                                     </div>
                                  )}
                                </>
                              )}
                              {pendingDecision.action === "CREATE" && (
                                 <div className="flex flex-col gap-3">
                                   <div className="flex items-center justify-between">
                                      <span className="text-xs font-bold text-slate-500">Entry</span>
                                      <span className="text-xs font-black text-slate-800 line-clamp-1">{pendingDecision.data.title}</span>
                                   </div>
                                   <div className="flex items-center justify-between border-t border-slate-50 pt-2">
                                      <span className="text-xs font-bold text-slate-500">Initial Status</span>
                                      {statusBadge(pendingDecision.data.status || "To Do")}
                                   </div>
                                    <div className="flex items-center justify-between border-t border-slate-50 pt-2">
                                      <span className="text-xs font-bold text-slate-500">Scheduled Date</span>
                                      <span className="text-xs font-black text-slate-800">{pendingDecision.data.date ? formatDeadline(pendingDecision.data.date) : "Immediate"}</span>
                                   </div>
                                 </div>
                              )}
                           </div>
                        )}

                       {/* Warnings Rendering */}
                       <div className="space-y-3 mb-8">
                         {deadlineConflict && conflictingTaskNames.length > 0 && (
                           <div className="flex items-start gap-4 rounded-2xl bg-orange-50/80 border border-orange-200 px-5 py-4 shadow-sm shadow-orange-500/5 transition-all animate-in zoom-in-95 duration-500">
                             <div className="p-2 bg-orange-100 rounded-xl text-orange-600">
                                <AlertTriangle size={18} />
                             </div>
                             <div>
                               <h5 className="text-[11px] font-black uppercase text-orange-700 tracking-widest mb-1.5">Scheduling Conflict</h5>
                               <p className="text-[12px] text-orange-900 leading-snug font-medium">
                                 <strong>{conflictingTaskNames.join(", ")}</strong> {conflictingTaskNames.length === 1 ? "is" : "are"} already set for this date.
                               </p>
                             </div>
                           </div>
                         )}
                         {duplicateTask && duplicateTaskName && (
                           <div className="flex items-start gap-4 rounded-2xl bg-orange-50/80 border border-orange-200 px-5 py-4 shadow-sm shadow-orange-500/5 transition-all animate-in zoom-in-95 duration-500">
                             <div className="p-2 bg-orange-100 rounded-xl text-orange-600">
                                <AlertTriangle size={18} />
                             </div>
                             <div>
                               <h5 className="text-[11px] font-black uppercase text-orange-700 tracking-widest mb-1.5">Redundant Entry</h5>
                               <p className="text-[12px] text-orange-900 leading-snug font-medium">
                                 A task with the name <strong>&quot;{duplicateTaskName}&quot;</strong> already exists in your active list.
                               </p>
                             </div>
                           </div>
                         )}
                       </div>

                       {/* Confirm / Cancel Buttons */}
                       <div className="flex gap-4">
                         <button onClick={handleCancel} className="flex-1 py-4 rounded-2xl bg-white border border-slate-200 text-[13px] font-black text-slate-500 hover:text-slate-800 hover:bg-slate-50 transition-all duration-300 shadow-sm cursor-pointer uppercase tracking-widest">
                           Dismiss
                         </button>
                         <button 
                            onClick={handleConfirm} 
                            disabled={confirmLoading} 
                            className={`flex-[2] py-4 rounded-2xl text-[13px] font-black text-white transition-all duration-500 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2.5 shadow-xl uppercase tracking-[0.15em] ${pendingDecision.action === "DELETE" ? "bg-red-500 hover:bg-black shadow-red-200/50" : "bg-slate-900 hover:bg-blue-600 shadow-md"}`}
                         >
                           {confirmLoading ? (
                             <div className="animate-spin h-5 w-5 border-3 border-white border-t-transparent rounded-full" />
                           ) : (
                             <><Check size={18} strokeWidth={3} /> {pendingDecision.action === "DELETE" ? "Execute Deletion" : "Confirm Action"}</>
                           )}
                         </button>
                       </div>
                      </div>
                   ) : (
                     /* Regular response message: Premium Typography */
                     message ? (
                       <div className="whitespace-pre-wrap text-[15px] font-bold text-slate-800 leading-relaxed tracking-tight animate-in slide-in-from-top-4 duration-500">
                         {message}
                       </div>
                     ) : null
                   )}
                 </div>
               </div>
             )}

            {/* Proactive Suggestion Card: RPG Gold theme */}
            {suggestion && !message && !pendingDecision && status === "idle" && (() => {
               const pc = priorityConfig(suggestion.priority);
               return (
                 <div className={`mt-4 rounded-[2rem] border overflow-hidden animate-in fade-in zoom-in-95 duration-700 ${pc.border} shadow-sm bg-white`}>
                   <div className={`px-6 py-3.5 flex items-center gap-3 border-b ${pc.headerBg}`}>
                     <Sparkles size={14} className={pc.iconColor} />
                     <span className="text-[10px] font-black text-slate-500 uppercase tracking-[0.2em]">Strategy Insight</span>
                     <span className={`ml-auto inline-block text-[10px] font-black px-3 py-1 rounded-full border shadow-sm ${pc.badge}`}>{suggestion.priority}</span>
                   </div>
                   <div className={`px-8 py-7 ${pc.cardBg}`}>
                     <p className="font-black text-slate-900 text-lg mb-2 relative tracking-tight leading-tight">
                        {suggestion.suggestion}
                     </p>
                     <p className="text-sm font-medium text-slate-600/80 leading-relaxed mb-6 opacity-80">{suggestion.reason}</p>
                     
                     <div className="flex flex-col gap-2">
                        <div className="flex justify-between items-center px-1">
                           <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">AI Confidence</span>
                           <span className="text-[10px] font-black text-slate-800 tabular-nums">{Math.round(suggestion.confidence * 100)}%</span>
                        </div>
                        <div className="bg-white/50 rounded-full h-2.5 overflow-hidden p-0.5 border border-white">
                           <div className={`h-full rounded-full transition-all duration-1000 ease-out shadow-sm ${pc.accent}`} style={{ width: `${Math.round(suggestion.confidence * 100)}%` }} />
                        </div>
                     </div>

                     {/* Proactive Thinking */}
                     {suggestion.thinkContext && (
                       <div className="mt-6 pt-5 border-t border-slate-200/40">
                         <button
                           type="button"
                           onClick={() => setProactiveThinkOpen(!proactiveThinkOpen)}
                           className="flex items-center gap-2 text-[10px] font-black text-slate-400 hover:text-blue-600 transition-all uppercase tracking-[0.15em] cursor-pointer"
                         >
                           <Brain size={12} className={proactiveThinkOpen ? "text-blue-500" : ""} />
                           <span>{proactiveThinkOpen ? "Collapse Intelligence" : "Expand Intelligence"}</span>
                           <svg
                             viewBox="0 0 24 24"
                             fill="none"
                             stroke="currentColor"
                             strokeWidth="3"
                             className={`w-2.5 h-2.5 transition-transform duration-500 ${proactiveThinkOpen ? "rotate-180" : "rotate-0 text-slate-300"}`}
                           >
                             <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                           </svg>
                         </button>
                         {proactiveThinkOpen && (
                           <div className="mt-4 max-h-48 overflow-y-auto pl-4 border-l-2 border-slate-200/60 custom-scrollbar">
                             <p className="text-[11px] text-slate-500 italic leading-relaxed whitespace-pre-wrap font-mono opacity-70">
                               {suggestion.thinkContext}
                             </p>
                           </div>
                         )}
                       </div>
                     )}
                   </div>
                 </div>
               );
             })()}

               {/* Task Section: Modern High-End Table */}
               {taskList && (
                 <div className={`mt-14 animate-in slide-in-from-bottom-12 duration-1000 delay-300 transition-opacity duration-500 ${isLoading ? 'opacity-30' : 'opacity-100'}`}>
                   <div className="flex items-center justify-between mb-6 px-4">
                     <h4 className="text-[11px] font-black text-slate-500 uppercase tracking-[0.3em] flex items-center gap-3">
                        <div className="w-8 h-[2px] bg-blue-500/40"></div>
                        Notion Ledger
                     </h4>
                     <div className="flex items-center gap-4">
                        <span className="flex items-center gap-1.5 text-[10px] font-black text-slate-400 bg-slate-50 px-3.5 py-1.5 rounded-full border border-slate-100 uppercase tracking-widest shadow-sm">
                           <Clock size={12} className="text-blue-500" />
                           Auto-Syncing
                        </span>
                        <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest">
                           {taskList.length} Tasks Found
                        </span>
                     </div>
                   </div>
                   
                   <div className="bg-white/80 border border-slate-100/50 rounded-[2.5rem] overflow-hidden shadow-[0_10px_40px_-15px_rgba(0,0,0,0.03)] backdrop-blur-md">
                     <div className="overflow-x-auto">
                       <table className="w-full text-left border-separate border-spacing-0">
                         <thead>
                           <tr className="bg-slate-50/50">
                             <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] border-b border-slate-100/80">Objective</th>
                             <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] border-b border-slate-100/80">Stage</th>
                             <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] border-b border-slate-100/80">Timeline</th>
                             {databaseCount > 1 && <th className="px-8 py-5 text-[10px] font-black text-slate-400 uppercase tracking-[0.15em] border-b border-slate-100/80">Origin</th>}
                           </tr>
                         </thead>
                         <tbody className="divide-y divide-slate-50/50">
                           {taskList.map((task) => (
                             <tr key={task.id} className="group hover:bg-blue-50/20 transition-all duration-300 cursor-default">
                               <td className="px-8 py-5">
                                 <span className="text-[14px] font-bold text-slate-800 tracking-tight block max-w-md truncate group-hover:text-blue-600 transition-colors" title={task.name}>
                                   {task.name}
                                 </span>
                               </td>
                               <td className="px-8 py-5">
                                 <div className="inline-block scale-95 origin-left">
                                    {statusBadge(task.status ?? "")}
                                 </div>
                               </td>
                               <td className="px-8 py-5 whitespace-nowrap">
                                 <span className="text-[12px] font-black text-slate-500 flex items-center gap-2 group-hover:text-slate-700 transition-colors">
                                   {task.deadline ? (
                                      <div className="flex flex-col">
                                         <span className="text-slate-800">{formatDeadline(task.deadline).split(' ')[0]}</span>
                                         <span className="text-[9px] uppercase tracking-tighter opacity-70">{formatDeadline(task.deadline).split(' ').slice(1).join(' ')}</span>
                                      </div>
                                   ) : <span className="opacity-40 font-normal">No deadline</span>}
                                 </span>
                               </td>
                               {databaseCount > 1 && (
                                 <td className="px-8 py-5">
                                   <div className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 rounded-full bg-slate-200 group-hover:bg-blue-400"></div>
                                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest group-hover:text-slate-600 transition-colors">
                                        {task.databaseName || "Source"}
                                      </span>
                                   </div>
                                 </td>
                               )}
                             </tr>
                           ))}
                         </tbody>
                       </table>
                     </div>
                   </div>
                 </div>
               )}
          </div>
          
          {/* Footer: Multi-engine tech credits */}
          <div className="bg-slate-50/70 py-6 px-10 border-t border-slate-100/60 flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.2em] text-slate-400">
            <div className="flex items-center gap-5">
               <div className="flex items-center gap-2">
                 <div className="w-1 h-1 bg-blue-500 rounded-full"></div>
                 {databaseCount} Databases Connected
               </div>
            </div>
          </div>
        </div>
     </div>
  );
}
