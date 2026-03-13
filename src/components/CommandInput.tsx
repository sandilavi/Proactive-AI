"use client";
import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { executeUserPrompt, confirmAction, NotionTask, AgentSuggestion, AgentResponse } from "@/app/actions/agent-actions";
import { fetchNotionTasks } from "@/app/actions/notion-actions";
import { Info, X, List, Zap, Trash2, Calendar, CheckCircle2, AlertTriangle, Check, Bell, BellRing, Clock } from "lucide-react";

// Proactive Notification Timer
const NOTIFICATION_INTERVAL = 2 * 60 * 1000;  // 2 minutes
const TASK_SYNC_INTERVAL   = 2 * 60 * 1000;  // 2 minutes

interface ProactiveAlert {
  id: string;
  taskId: string;
  taskName: string;
  urgency: "OVERDUE" | "TODAY" | "TOMORROW" | "SOON";
  deadline: string;
  timestamp: string;
}

// Function To Classify Deadlines
function classifyDeadline(deadline: string): ProactiveAlert["urgency"] | null {
  if (!deadline || deadline === "No Deadline") return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today); tomorrow.setDate(today.getDate() + 1);
  const soon = new Date(today); soon.setDate(today.getDate() + 3);
  const deadlineDay = new Date(deadline); deadlineDay.setHours(0, 0, 0, 0);
  if (isNaN(deadlineDay.getTime())) return null;
  if (deadlineDay < today)                             return "OVERDUE";
  if (deadlineDay.getTime() === today.getTime())       return "TODAY";
  if (deadlineDay.getTime() === tomorrow.getTime())    return "TOMORROW";
  if (deadlineDay.getTime() <= soon.getTime())         return "SOON";
  return null;
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
  const base = "inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold";
  const s = status.toLowerCase();
  if (s === "done") return `${base} bg-green-100 text-green-700`;
  if (s === "in progress") return `${base} bg-blue-100 text-blue-700`;
  return `${base} bg-slate-100 text-slate-500`;
}

function priorityConfig(priority: string) {
  const p = priority?.toUpperCase();
  if (p === "CRITICAL") return { border: "border-red-200", headerBg: "bg-red-50 border-red-100", cardBg: "bg-red-50/40", badge: "bg-red-100 text-red-700", accent: "bg-red-500", iconColor: "text-red-500" };
  if (p === "HIGH")     return { border: "border-orange-200", headerBg: "bg-orange-50 border-orange-100", cardBg: "bg-orange-50/40", badge: "bg-orange-100 text-orange-700", accent: "bg-orange-500", iconColor: "text-orange-500" };
  if (p === "MEDIUM")   return { border: "border-amber-200", headerBg: "bg-amber-50 border-amber-100", cardBg: "bg-amber-50/40", badge: "bg-amber-100 text-amber-700", accent: "bg-amber-400", iconColor: "text-amber-500" };
  return                       { border: "border-slate-200", headerBg: "bg-slate-50 border-slate-100", cardBg: "bg-slate-50/40", badge: "bg-slate-100 text-slate-600", accent: "bg-slate-400", iconColor: "text-slate-400" };
}

const SUGGESTIONS = [
  { icon: <List size={14} />, text: "List all my current tasks." },
  { icon: <Zap size={14} />, text: "Which task should I prioritize next?" },
  { icon: <Calendar size={14} />, text: "Add a task to submit thesis by tomorrow." },
  { icon: <CheckCircle2 size={14} />, text: "Mark submit thesis as completed." },
  { icon: <Trash2 size={14} />, text: "Delete the task submit thesis." },
];

interface CommandInputProps {
  initialTasks?: NotionTask[];
  initialSuggestion?: AgentSuggestion | null;
}

export default function CommandInput({ initialTasks, initialSuggestion }: CommandInputProps) {
  const [prompt, setPrompt] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [taskList, setTaskList] = useState<NotionTask[] | null>(initialTasks ?? null);
  const [suggestion, setSuggestion] = useState<AgentSuggestion | null>(initialSuggestion ?? null);

  // Prevent suggestion from disappearing on page refresh if the LLM fails/rate-limits
  useEffect(() => {
    if (typeof window !== "undefined") {
      try {
        if (initialSuggestion) {
          // If server successfully fetched a suggestion, use it and cache it
          setSuggestion(initialSuggestion);
          localStorage.setItem("proactive_auto_suggestion", JSON.stringify(initialSuggestion));
        } else {
          // Server returned null (likely rate-limited on refresh), fallback to cached version
          const stored = localStorage.getItem("proactive_auto_suggestion");
          if (stored) {
            setSuggestion(JSON.parse(stored));
          }
        }
      } catch {
        // Silently ignore corrupted localstorage
      }
    }
  }, [initialSuggestion]);
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
      TOMORROW: "🔔 Due TOMORROW",
      SOON:     "📅 Due Soon",
    };
    const body = `"${alert.taskName}" — ${urgencyLabel[alert.urgency]}`;
    if (typeof window !== "undefined" && "Notification" in window && Notification.permission === "granted") {
      new Notification("ProActiveAI Alert", { body, icon: "/favicon.ico", tag: alert.taskId });
    }
  }, []);

  // Background interval: fetch tasks & classify deadlines every notification interval
  useEffect(() => {
    const urgencyRank: Record<ProactiveAlert["urgency"], number> = { OVERDUE: 0, TODAY: 1, TOMORROW: 2, SOON: 3 };

    const syncNotifications = async () => { // Function to sync notifications after certain period of time
      try {
        const tasks = await fetchNotionTasks();
        const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done"); // activeTasks = All the tasks that haven't completed yet

        // Collect all urgent alerts in this check
        const urgentAlerts: ProactiveAlert[] = [];
        const nowString = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        for (const task of activeTasks) {
          const urgency = classifyDeadline(task.deadline ?? "");
          if (!urgency) continue;

          // If user already dismissed this specific urgency state for this task, don't ping them again
          const mutedKey = `proactive_muted_${task.id}_${urgency}`;
          if (typeof window !== "undefined" && localStorage.getItem(mutedKey)) continue;

          urgentAlerts.push({ 
            id: `${task.id}-${Date.now()}`, 
            taskId: task.id, 
            taskName: task.name, 
            urgency, 
            deadline: task.deadline ?? "", 
            timestamp: nowString 
          });
        }

        if (urgentAlerts.length === 0) return;

        // Fire OS notification for every urgent task
        // urgentAlerts.forEach(alert => fireOsNotification(alert));

        // Safely check how many items are TRULY new against what's currently in the list
        const prevToasts = activeToastsRef.current;
        const newlyFoundCount = urgentAlerts.filter(
          ua => !prevToasts.some(t => t.taskId === ua.taskId && t.urgency === ua.urgency)
        ).length;

        if (newlyFoundCount > 0) {
          setUnreadCount(prev => prev + newlyFoundCount);
        }

        // Merge keeping timestamps of existing items
        const mergedToasts = urgentAlerts.map(newAlert => {
          const existing = prevToasts.find(t => t.taskId === newAlert.taskId && t.urgency === newAlert.urgency);
          return existing ? existing : newAlert;
        });

        setActiveToasts(mergedToasts.sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency]));
      } catch {
        // Silently fail — don't disrupt the user's workflow on a background check error
      }
    };

    syncNotifications(); // Run immediately on mount
    const intervalId = setInterval(syncNotifications, NOTIFICATION_INTERVAL);
    return () => clearInterval(intervalId); // cleanup on unmount
  }, [fireOsNotification]);

  // Background task sync — silently re-fetch Notion tasks every 60 seconds
  // Only updates the task table when it is currently visible (taskList !== null)
  // Skips update during confirmation flow to avoid disrupting the user
  useEffect(() => {
    const syncTasks = async () => {
      try {
        const fresh = await fetchNotionTasks();
        setTaskList(prev => {
          if (prev === null) return prev;          // table hidden — don't show it
          if (pendingDecision) return prev;        // mid-confirmation — don't disrupt
          return fresh;                            // silently swap in fresh data
        });
      } catch {
        // Silently fail — don't disrupt user on a background sync error
      }
    };

    const id = setInterval(syncTasks, TASK_SYNC_INTERVAL);
    return () => clearInterval(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingDecision]);

  const handleSuggestionClick = (text: string) => {
    setPrompt(text);
    setShowHelp(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || status === "loading") return;
    setStatus("loading");
    setTaskList(null);
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
       <div className="flex justify-end items-center gap-2 mb-4 pr-2 md:pr-4">

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
            className={`relative p-2 rounded-full shadow-md transition-all border border-slate-200 cursor-pointer ${
              showNotificationPanel && activeToasts.length > 0
                ? "bg-blue-50 text-blue-600 border-blue-200 ring-2 ring-blue-100" 
                : "bg-white text-slate-500 hover:bg-blue-50"
            }`}
            title={activeToasts.length === 0 ? "No Notifications" : "Notification alerts"}
          >
            {activeToasts.length > 0 && unreadCount > 0 ? (
              <BellRing size={20} className={showNotificationPanel ? "text-blue-600" : "text-red-500"} />
            ) : (
              <Bell size={20} className={showNotificationPanel && activeToasts.length > 0 ? "text-blue-600" : ""} />
            )}
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white animate-in zoom-in">
                {unreadCount}
              </span>
            )}
          </button>

         {/* Help / Prompts */}
         <button onClick={() => setShowHelp(!showHelp)}
           className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-all border border-slate-200 text-blue-600 cursor-pointer"
           title="Show Suggestions"
         >
           {showHelp ? <X size={20} /> : <Info size={20} />}
         </button>
       </div>

       {/* In-App Proactive Panel (List of Toasts) */}
       {showNotificationPanel && activeToasts.length > 0 && (() => {
         const urgencyStyles: Record<ProactiveAlert["urgency"], { border: string; headerBg: string; cardBg: string; iconColor: string; label: string }> = {
           OVERDUE:  { border: "border-red-300",    headerBg: "bg-red-50 border-red-200",    cardBg: "bg-red-50/40",    iconColor: "text-red-500",    label: "🚨 OVERDUE" },
           TODAY:    { border: "border-orange-300", headerBg: "bg-orange-50 border-orange-200", cardBg: "bg-orange-50/40", iconColor: "text-orange-500", label: "⚠️ Due TODAY" },
           TOMORROW: { border: "border-blue-300",   headerBg: "bg-blue-50 border-blue-200",   cardBg: "bg-blue-50/40",   iconColor: "text-blue-500",   label: "🔔 Due TOMORROW" },
           SOON:     { border: "border-gray-300",   headerBg: "bg-gray-100 border-gray-300",   cardBg: "bg-gray-50/60",   iconColor: "text-gray-500",   label: "📅 Due Soon" },
         };
         return (
           <div className="flex flex-col gap-2 mb-4 animate-in slide-in-from-bottom-2 duration-200">
             <div className="flex items-center justify-between mb-1 px-1">
               <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">Active Alerts ({activeToasts.length})</span>
               <button 
                 onClick={() => { 
                   activeToasts.forEach(t => localStorage.setItem(`proactive_muted_${t.taskId}_${t.urgency}`, "true"));
                   setShowNotificationPanel(false); 
                   setActiveToasts([]);
                 }}
                 className="text-[10px] font-bold text-blue-500 hover:text-blue-700 cursor-pointer"
               >
                 Mark all as read
               </button>
             </div>
             {activeToasts.map(toast => {
               const s = urgencyStyles[toast.urgency];
               return (
                 <div key={toast.id} className={`rounded-xl border shadow-sm overflow-hidden ${s.border}`}>
                   <div className={`px-4 py-2 flex items-center gap-2 border-b ${s.headerBg}`}>
                     <BellRing size={12} className={s.iconColor} />
                     <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${s.iconColor}`}>{s.label}</span>
                     <span className="text-[10px] font-bold text-slate-400 ml-auto mr-2">{toast.timestamp}</span>
                     <button onClick={() => {
                        localStorage.setItem(`proactive_muted_${toast.taskId}_${toast.urgency}`, "true");
                        const next = activeToasts.filter(t => t.id !== toast.id);
                        setActiveToasts(next);
                        if (next.length === 0) {
                          setShowNotificationPanel(false);
                        }
                     }} className="text-slate-400 hover:text-slate-600 cursor-pointer"><X size={12} /></button>
                   </div>
                   <div className={`px-4 py-2.5 flex items-start gap-3 ${s.cardBg}`}>
                     <Clock size={14} className={`mt-0.5 flex-shrink-0 ${s.iconColor}`} />
                     <div>
                       <p className="text-sm font-semibold text-slate-800">{toast.taskName}</p>
                       <p className="text-[11px] text-slate-500 mt-0.5">
                         {toast.deadline && toast.deadline !== "No Deadline"
                           ? `Deadline: ${formatDeadline(toast.deadline)}`
                           : "No deadline set"}
                       </p>
                     </div>
                   </div>
                 </div>
               );
             })}
           </div>
         );
       })()}

       {/* Backdrop */}
       {showHelp && (
         <div
           className="fixed inset-0 z-40"
           onClick={() => setShowHelp(false)}
         />
       )}

       {/* Right-side Suggestion Panel */}
       <div
         className={`fixed top-0 right-0 h-full w-72 z-50 bg-white border-l border-blue-100 shadow-2xl flex flex-col transition-transform duration-300 ease-in-out ${
           showHelp ? "translate-x-0" : "translate-x-full"
         }`}
       >
         {/* Panel Header */}
         <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
           <h3 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Try these prompts</h3>
           <button
             onClick={() => setShowHelp(false)}
             className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors cursor-pointer"
           >
             <X size={16} />
           </button>
         </div>

         {/* Prompt Buttons */}
         <div className="flex flex-col gap-2 p-4 overflow-y-auto flex-1">
           {SUGGESTIONS.map((item, i) => (
             <button
               key={i}
               onClick={() => { handleSuggestionClick(item.text); setShowHelp(false); }}
               className="text-left text-[13px] p-3 rounded-xl hover:bg-blue-500 hover:text-white transition-all border border-slate-100 hover:border-blue-400 flex items-center gap-3 font-medium text-slate-600 group cursor-pointer bg-slate-50/60"
             >
               <span className="text-blue-500 group-hover:text-white flex-shrink-0">{item.icon}</span>
               {item.text}
             </button>
           ))}
         </div>

         {/* Panel Footer */}
         <div className="px-5 py-3 border-t border-slate-100">
           <p className="text-[10px] text-slate-400 text-center">Click any prompt to fill the input</p>
         </div>
       </div>

       {/* Main Chat Card */}
       <div className="bg-white/80 backdrop-blur-md border border-white shadow-xl rounded-2xl overflow-hidden relative z-10">
         <div className="p-6">
           <form onSubmit={handleSubmit} className="flex flex-col gap-4">
             <div className="relative">
               <input ref={inputRef} type="text" value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Ask me to..." className="w-full p-4 pr-12 rounded-xl border border-slate-200 outline-none transition-all" disabled={isLoading} />
               <button type="submit" disabled={isLoading} className="absolute right-2 top-2 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed">
                 {isLoading ? <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" /> : <Zap size={20} />}
               </button>
             </div>
           </form>

             {/* Thinking + Response — unified card */}
             {(thinkContext || message || pendingDecision) && (
               <div className={`mt-5 rounded-xl border px-5 py-4 ${
                 pendingDecision?.action === "DELETE"
                   ? "border-red-200 bg-red-50/40"
                   : "border-blue-100 bg-blue-50/50"
               }`}>

                 {/* Show thinking toggle — first */}
                 {thinkContext && (
                   <div className={(message || pendingDecision) ? "mb-4" : ""}>
                     <button
                       onClick={() => setThinkOpen((o) => !o)}
                       className="flex items-center gap-1.5 text-[13px] text-slate-400 hover:text-slate-600 transition-colors cursor-pointer select-none"
                     >
                       <span>{thinkOpen ? "Hide Thinking" : "Show Thinking"}</span>
                       <svg
                         viewBox="0 0 24 24"
                         fill="none"
                         stroke="currentColor"
                         strokeWidth="2.5"
                         className={`w-3 h-3 transition-transform duration-300 ${thinkOpen ? "rotate-180" : "rotate-0"}`}
                       >
                         <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                       </svg>
                     </button>
                     {/* Scrollable full think log — no cutoff */}
                     {thinkOpen && (
                       <div className="mt-2 max-h-60 overflow-y-auto pl-3 border-l-2 border-slate-200">
                         <p className="text-[12px] text-slate-400 italic leading-relaxed whitespace-pre-wrap font-mono">
                           {thinkContext}
                         </p>
                       </div>
                     )}
                   </div>
                 )}

                 {/* Confirmation content — replaces message area during confirmation */}
                 {pendingDecision ? (
                   <div>
                     <p className="text-sm text-slate-700 mb-4">
                       {pendingDecision.action === "DELETE" && <>I&apos;m about to permanently delete <strong>&quot;{pendingTaskName}&quot;</strong>. This cannot be undone.</>}
                       {pendingDecision.action === "UPDATE" && <>I&apos;m about to update <strong>&quot;{pendingTaskName}&quot;</strong>{pendingDecision.data.status && <> \u2192 Status: <strong>{pendingDecision.data.status}</strong></>}{pendingDecision.data.date && <> \u2192 Due: <strong>{formatDeadline(pendingDecision.data.date)}</strong></>}.</>}
                       {pendingDecision.action === "CREATE" && <>I&apos;m about to create: <strong>&quot;{pendingDecision.data.title}&quot;</strong>{pendingDecision.data.date && <> due <strong>{formatDeadline(pendingDecision.data.date)}</strong></>}.</>}
                     </p>
                     {/* Deadline conflict warning */}
                     {deadlineConflict && conflictingTaskNames.length > 0 && (
                       <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                         <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                         <p className="text-[12px] text-amber-700 leading-relaxed">
                           <strong>Deadline conflict: </strong>
                           {conflictingTaskNames.map((n, i) => (
                             <span key={i}><strong>&quot;{n}&quot;</strong>{i < conflictingTaskNames.length - 1 ? ", " : ""}</span>
                           ))}
                           {conflictingTaskNames.length === 1 ? " already has" : " already have"} this deadline. You&apos;ll have multiple tasks due on the same day.
                         </p>
                       </div>
                     )}
                      {/* Duplicate task warning */}
                      {duplicateTask && duplicateTaskName && (
                        <div className="mb-4 flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5">
                          <AlertTriangle size={14} className="text-amber-500 mt-0.5 shrink-0" />
                          <p className="text-[12px] text-amber-700 leading-relaxed">
                            <strong>Duplicate task: </strong>A task named <strong>&quot;{duplicateTaskName}&quot;</strong> already exists in your list. You&apos;ll have multiple tasks with the same name.
                          </p>
                        </div>
                      )}
                     <div className="flex gap-3">
                       <button onClick={handleCancel} className="flex-1 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer font-medium">
                         Cancel
                       </button>
                       <button onClick={handleConfirm} disabled={confirmLoading} className={`flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 ${pendingDecision.action === "DELETE" ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"}`}>
                         {confirmLoading ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : <><Check size={14} />{pendingDecision.action === "DELETE" ? "Yes, Delete" : "Confirm"}</>}
                       </button>
                     </div>
                   </div>
                 ) : (
                   /* Regular response message */
                   message ? (
                     <div className="whitespace-pre-wrap text-sm text-slate-700">
                       {message}
                     </div>
                   ) : null
                 )}
               </div>
             )}

            {/* Proactive Suggestion Card */}
            {suggestion && (() => {
              const pc = priorityConfig(suggestion.priority);
              return (
                <div className={`mt-5 rounded-xl border overflow-hidden ${pc.border}`}>
                  <div className={`px-5 py-2.5 flex items-center gap-2 border-b ${pc.headerBg}`}>
                    <Zap size={13} className={pc.iconColor} />
                    <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Proactive Suggestion</span>
                    <span className={`ml-auto inline-block text-[10px] font-bold px-2 py-0.5 rounded-full ${pc.badge}`}>{suggestion.priority}</span>
                  </div>
                  <div className={`px-5 py-4 ${pc.cardBg}`}>
                    <p className="font-bold text-slate-800 text-sm mb-1.5">📌 {suggestion.suggestion}</p>
                    <p className="text-xs text-slate-500 leading-relaxed mb-3">{suggestion.reason}</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-white/70 rounded-full h-1.5 overflow-hidden">
                        <div className={`h-full rounded-full ${pc.accent}`} style={{ width: `${Math.round(suggestion.confidence * 100)}%` }} />
                      </div>
                      <span className="text-[11px] text-slate-400 tabular-nums">{Math.round(suggestion.confidence * 100)}% confidence</span>
                    </div>
                  </div>
                </div>
              );
            })()}
             {taskList && (
               <div className="mt-4 rounded-xl border border-blue-100 overflow-hidden">
                 <div className="px-5 py-3 bg-blue-50/70 border-b border-blue-100">
                   <p className="text-xs font-bold text-slate-500 uppercase tracking-wide">Your Notion Tasks : {taskList.length}</p>
                 </div>
                 <div className="overflow-x-auto">
                   <table className="w-full text-sm">
                     <thead>
                       <tr className="border-b border-slate-100 bg-slate-50/50">
                         <th className="text-left px-5 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide w-1/2">Task</th>
                         <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                         <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Date</th>
                       </tr>
                     </thead>
                     <tbody>
                       {taskList.map((task, i) => (
                         <tr key={task.id} className={`${i % 2 === 0 ? "bg-white" : "bg-slate-50/30"} border-b border-slate-50 last:border-0`}>
                           <td className="px-5 py-3 font-medium text-slate-700">{task.name}</td>
                           <td className="px-4 py-3">
                             <span className={statusBadge(task.status ?? "")}>{task.status ?? "â€”"}</span>
                           </td>
                           <td className="px-4 py-3 text-slate-500 text-xs tabular-nums">{formatDeadline(task.deadline ?? "")}</td>
                         </tr>
                       ))}
                     </tbody>
                   </table>
                 </div>
               </div>
             )}
         </div>
         <div className="bg-slate-50/50 p-4 border-t border-slate-100 flex justify-between text-[10px] text-slate-400">
           <span>Notion Connected</span>
           <span>Powered by Qwen 3</span>
         </div>
       </div>
    </div>
  );
}
