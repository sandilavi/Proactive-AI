"use client";
import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { executeUserPrompt, confirmAction, getAgentSuggestion, NotionTask, AgentSuggestion, AgentResponse } from "@/app/actions/assistant-actions";
import { fetchNotionTasks, NotionDatabase } from "@/app/actions/notion-actions";
import { X, Zap, Trash2, AlertTriangle, Check, Bell, BellRing, Clock, Brain, Sparkles, Activity } from "lucide-react";

// Proactive Notification Timer
const TASK_SYNC_INTERVAL       = 2  * 60 * 1000; // 2 minutes

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
    return `${yyyy}-${mm}-${dd}, ${hours}.${minutes}${ampm}`;
  } catch {
    return dateStr;
  }
}

function statusBadge(status: string) {
  const label = status || "Pending";
  const s = status.toLowerCase();
  const base = "inline-block px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest whitespace-nowrap border";
  
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

  // Trigger notification engine check immediately as soon as Assistant page mounts
  useEffect(() => {
    window.dispatchEvent(new Event('notion-tasks-updated'));
  }, []);

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

      // Handle Caching: Skip re-fetch if data is fresh and tasks haven't changed
      const cached = localStorage.getItem("proactive_auto_suggestion");
      const lastFetch = localStorage.getItem("proactive_last_fetch");
      const lastFingerprint = localStorage.getItem("proactive_task_fingerprint");
      // Create a fingerprint of current tasks (ID + Status + Name + Deadline)
      const currentFingerprint = (taskList || initialTasks || []).map(t => `${t.id}-${t.name}-${t.status}-${t.deadline}`).join("|");
      const isTaskListSame = lastFingerprint === currentFingerprint;

      const todayStr = new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
      const lastFetchDay = localStorage.getItem("proactive_last_fetch_day");
      const isSameDay = lastFetchDay === todayStr;
      
      // Logic: Only re-fetch if tasks changed OR it's a new day (past midnight).
      // Force re-fetch if the 'deadline' field is missing (schema upgrade).
      if (cached && isTaskListSame && isSameDay) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed && parsed.suggestion && typeof parsed.confidence === "number" && parsed.priority && parsed.deadline) {
            // Apply the fallback in case this was cached before the feature was added
            if (!parsed.updatedAt) {
              parsed.updatedAt = parseInt(lastFetch || Date.now().toString(), 10);
            }
            setSuggestion(parsed);
            return;
          }
        } catch {
          // Fallback to fetch a fresh one if parse fails
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
          // EXCEPTION: If the suggested task's deadline changed in Notion, always show fresh data.
          if (cached) {
            try {
              const old = JSON.parse(cached);
              const isSameTask = old && old.suggestion === newSuggestion.suggestion && old.priority === newSuggestion.priority && isSameDay;
              
              if (isSameTask) {
                // Check if the suggested task's deadline has changed since last cache
                const suggestedTaskNameLower = (newSuggestion.suggestion || "").toLowerCase().trim();
                const currentTaskMatch = (taskList || initialTasks || []).find(
                  t => t.name?.toLowerCase().trim() === suggestedTaskNameLower
                );
                const oldDeadline = old.deadline ?? "";
                const currentDeadline = currentTaskMatch?.deadline ?? newSuggestion.deadline ?? "";
                const deadlineChanged = currentDeadline !== "" && currentDeadline !== oldDeadline;

                if (!deadlineChanged) {
                  // Deadline is the same — apply normal freeze logic
                  // If it's the exact same advice (even if confidence changed), preserve the original time
                  finalSuggestion.updatedAt = old.updatedAt || parseInt(lastFetch || Date.now().toString(), 10);
                  
                  const confDiff = Math.abs((old.confidence || 0) - (newSuggestion.confidence || 0));
                  if (confDiff < 0.15) {
                    // Minor shift: Use old text AND old confidence to keep UI "frozen"
                    finalSuggestion = {
                      ...finalSuggestion,
                      reason: old.reason,
                      confidence: old.confidence,
                      thinkContext: old.thinkContext ?? newSuggestion.thinkContext
                    };
                  }
                }
                // else: deadline changed — skip freeze, use fully fresh finalSuggestion with new reason/deadline
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

  // Background Sync: silents re-fetches Notion tasks every interval.
  // Updates the task table if visible, skipping during confirmation flow.
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
          // Dispatch global signal that data changed
          window.dispatchEvent(new Event('notion-tasks-updated'));
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
      
      if (result.success) {
        // Dispatch global signal that data changed
        window.dispatchEvent(new Event('notion-tasks-updated'));
      }
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
    <div className="space-y-6">
      {/* Agentic Insight */}
      {suggestion && !message && !pendingDecision && status === "idle" && (() => {
         const currentSug = suggestion;
         const dateStr = new Date(currentSug.updatedAt || Date.now()).toLocaleString([], { hour: 'numeric', minute: '2-digit' });
         const p = (currentSug.priority || "MEDIUM").toUpperCase();
         
         const pStyle = 
           p === "CRITICAL" ? { 
             card: "bg-red-50 border-red-200 text-red-900", 
             text: "text-red-700", 
             badge: "bg-red-100 text-red-800 border-red-200",
             progress: "bg-red-600"
           } :
           p === "HIGH"     ? { 
             card: "bg-orange-50 border-orange-200 text-orange-900", 
             text: "text-orange-700", 
             badge: "bg-orange-100 text-orange-800 border-orange-200",
             progress: "bg-orange-600"
           } :
           p === "MEDIUM"   ? { 
             card: "bg-blue-50 border-blue-200 text-blue-900", 
             text: "text-blue-700", 
             badge: "bg-blue-100 text-blue-800 border-blue-200",
             progress: "bg-blue-600"
           } :
           p === "LOW"      ? { 
             card: "bg-slate-50 border-slate-200 text-slate-700", 
             text: "text-slate-600", 
             badge: "bg-slate-100 text-slate-700 border-slate-200",
             progress: "bg-slate-500"
           } :
           { 
             card: "bg-purple-50 border-purple-200 text-purple-900", 
             text: "text-purple-700", 
             badge: "bg-purple-100 text-purple-800 border-purple-200",
             progress: "bg-purple-600"
           };

         return (
            <div className={`border rounded-lg p-5 shadow-sm relative ${pStyle.card}`}>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="px-2 py-0.5 rounded bg-white border border-slate-200 text-xs font-bold text-slate-800 flex items-center gap-1.5 shadow-sm">
                    <Sparkles size={12} className={pStyle.text} /> Agentic Insight
                  </span>
                  <span className={`px-2 py-0.5 rounded border text-[10px] font-bold uppercase tracking-wider ${pStyle.badge}`}>
                    {p}
                  </span>
                </div>
                
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                  <span>AI Confidence: {Math.round(currentSug.confidence * 100)}%</span>
                  <div className="w-24 bg-slate-200 rounded-full h-1.5 overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-1000 ${pStyle.progress}`} style={{ width: `${Math.round(currentSug.confidence * 100)}%` }} />
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                 <h3 className="text-base font-bold text-slate-900 uppercase">
                   {currentSug.suggestion}
                 </h3>
                 {currentSug.deadline && currentSug.deadline !== "No Deadline" && (
                   <div className="text-xs font-semibold text-slate-500">
                     Due: {formatDeadline(currentSug.deadline)}
                   </div>
                 )}
                 <p className="text-xs text-slate-600 leading-relaxed">
                   {currentSug.reason}
                 </p>
                 <span className="text-[9px] text-slate-400 font-semibold block">
                   Generated at {dateStr}
                 </span>
              </div>

              {currentSug.thinkContext && (
                <div className="mt-4 pt-3 border-t border-slate-200">
                  <button
                    type="button"
                    onClick={() => setProactiveThinkOpen(!proactiveThinkOpen)}
                    className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 hover:text-slate-700 cursor-pointer"
                  >
                    <Brain size={12} />
                    <span>{proactiveThinkOpen ? "Collapse Intelligence" : "Expand Intelligence"}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      className={`w-3 h-3 transition-transform duration-300 ${proactiveThinkOpen ? "rotate-180" : "rotate-0 text-slate-400"}`}
                    >
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {proactiveThinkOpen && (
                    <div className="mt-3 p-3 bg-slate-50 border border-slate-200 rounded text-xs text-slate-600 font-mono whitespace-pre-wrap">
                      {currentSug.thinkContext}
                    </div>
                  )}
                </div>
              )}
            </div>
         );
      })()}

      {/* Main Chat Form Card */}
      <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden flex flex-col">
        {/* Source Badges */}
        <div className="px-5 py-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
          <span className="text-xs font-bold text-slate-500 mr-2 uppercase tracking-wider">Connected Databases:</span>
          {databases.map(db => {
             const isFYP = db.name.toUpperCase().includes("FYP");
             const isPersonal = db.name.toUpperCase().includes("PERSONAL");
             const badgeColor = isFYP ? "text-indigo-700 bg-indigo-50 border-indigo-100" : 
                              isPersonal ? "text-rose-700 bg-rose-50 border-rose-100" : 
                              "text-blue-700 bg-blue-50 border-blue-100";
             
             return (
               <span key={db.id} className={`px-2 py-0.5 rounded border text-xs font-semibold ${badgeColor}`}>
                 {db.name}
               </span>
             );
          })}
          {databases.length === 0 && (
             <span className="text-xs font-medium text-slate-400 italic">
               Initializing link...
             </span>
          )}
        </div>

        {/* Prompt Input Form */}
        <div className="p-4">
          <form onSubmit={handleSubmit} className="relative flex items-center">
            <input 
              ref={inputRef} 
              type="text" 
              value={prompt} 
              onChange={(e) => setPrompt(e.target.value)} 
              placeholder="Initialize mission or query database..." 
              className="w-full p-3 pr-24 border border-slate-300 rounded text-sm bg-white text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-slate-500" 
              disabled={isLoading} 
            />
            <button 
              type="submit" 
              disabled={isLoading || !prompt.trim()} 
              className="absolute right-1.5 top-1.5 bottom-1.5 px-4 bg-slate-900 hover:bg-slate-800 text-white rounded font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {isLoading ? (
                <div className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
              ) : (
                "Process"
              )}
            </button>
          </form>

          {/* Thinking + Response card */}
          {(thinkContext || message || pendingDecision) && (
            <div className={`mt-4 border rounded p-4 ${
              pendingDecision?.action === "DELETE"
                ? "border-red-200 bg-red-50/50"
                : "border-blue-200 bg-blue-50/50"
            }`}>

              {/* Show thinking toggle */}
              {thinkContext && (
                <div className={ (message || pendingDecision) ? "mb-3" : "" }>
                  <button
                    onClick={() => setThinkOpen((o) => !o)}
                    className="flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-700 cursor-pointer uppercase tracking-wider"
                  >
                    <Brain size={12} />
                    <span>{thinkOpen ? "Hide Neural Process" : "View Neural Process"}</span>
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      className={`w-3 h-3 transition-transform duration-300 ${thinkOpen ? "rotate-180" : "rotate-0 text-slate-400"}`}
                    >
                      <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </button>
                  {thinkOpen && (
                    <div className="mt-2.5 p-3 bg-white border border-slate-200 rounded text-xs text-slate-600 font-mono whitespace-pre-wrap">
                      {thinkContext}
                    </div>
                  )}
                </div>
              )}

              {/* Confirmation / Message Content Area */}
              <div>
                {pendingDecision ? (
                   <div className="space-y-4">
                     <div className="flex items-start gap-3">
                        <div className={`p-2 rounded flex-shrink-0 ${pendingDecision.action === "DELETE" ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"}`}>
                           {pendingDecision.action === "DELETE" ? <Trash2 size={16} /> : <Zap size={16} />}
                        </div>
                        <div>
                           <h4 className="text-sm font-bold text-slate-900">
                             {pendingDecision.action === "DELETE" && <>Confirm Deletion</>}
                             {pendingDecision.action === "UPDATE" && <>Verify Task Update</>}
                             {pendingDecision.action === "CREATE" && <>New Task Entry</>}
                             {pendingDecision.action === "PLAN" && <>AI Blueprint Ready</>}
                           </h4>
                           <p className="text-xs text-slate-500 mt-1">
                             {pendingDecision.action === "DELETE" && <>I&apos;m about to permanently remove <strong>&quot;{pendingTaskName}&quot;</strong> from Notion.</>}
                             {pendingDecision.action === "UPDATE" && <>Preparing to update <strong>&quot;{pendingTaskName}&quot;</strong> with new parameters.</>}
                             {pendingDecision.action === "CREATE" && <>Generating a new record: <strong>&quot;{pendingDecision.data.title}&quot;</strong>.</>}
                             {pendingDecision.action === "PLAN" && <>Reviewing the calculated roadmap with <strong>{pendingDecision.data.plan?.length || 0} tasks</strong>.</>}
                           </p>
                        </div>
                     </div>

                     {/* Plan Details Rendering */}
                     {pendingDecision.action === "PLAN" && pendingDecision.data.plan && (
                       <div className="space-y-2">
                         {pendingDecision.data.planSummary && (
                            <div className="p-3 bg-white border border-blue-200 rounded">
                              <p className="text-xs text-blue-800 font-semibold leading-relaxed flex items-center gap-1.5">
                                <Sparkles size={12} className="text-blue-500 shrink-0" />
                                {pendingDecision.data.planSummary}
                              </p>
                            </div>
                         )}
                         <div className="space-y-2">
                           {pendingDecision.data.plan.map((t, i) => (
                              <div key={i} className="bg-white p-3 rounded border border-slate-200">
                               <div className="flex items-center justify-between mb-1">
                                 <div className="flex items-center gap-1.5">
                                   <span className="w-4.5 h-4.5 rounded bg-slate-100 border border-slate-200 text-slate-700 text-[10px] font-bold flex items-center justify-center">{i + 1}</span>
                                   <span className="font-bold text-slate-800 text-xs uppercase">{t.title}</span>
                                 </div>
                                  {t.date && <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-100">{formatDeadline(t.date)}</span>}
                               </div>
                               <div className="flex items-center justify-between">
                                 {t.reason && <p className="text-[11px] text-slate-500 leading-relaxed">{t.reason}</p>}
                                 {t.durationHours && <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider ml-2 shrink-0">{t.durationHours}h</span>}
                               </div>
                             </div>
                           ))}
                         </div>
                       </div>
                     )}

                     {/* General Action Details */}
                     {(pendingDecision.action === "UPDATE" || pendingDecision.action === "CREATE") && (
                         <div className="p-3 bg-white border border-slate-200 rounded flex flex-col gap-2">
                           {pendingDecision.action === "UPDATE" && (
                             <>
                               <div className="flex items-center justify-between text-[10px] font-bold uppercase text-slate-400 tracking-wider">
                                  <span>Property</span>
                                  <span>New Value</span>
                               </div>
                               {pendingDecision.data.status && (
                                  <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                                     <span className="text-xs text-slate-500">Status</span>
                                     {statusBadge(pendingDecision.data.status)}
                                  </div>
                               )}
                               {pendingDecision.data.date && (
                                  <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                                     <span className="text-xs text-slate-500">Deadline</span>
                                     <span className="text-xs font-bold text-slate-800">{formatDeadline(pendingDecision.data.date)}</span>
                                  </div>
                               )}
                             </>
                           )}
                           {pendingDecision.action === "CREATE" && (
                              <div className="flex flex-col gap-2">
                                <div className="flex items-center justify-between">
                                   <span className="text-xs text-slate-500">Entry</span>
                                   <span className="text-xs font-bold text-slate-800 truncate max-w-[180px]">{pendingDecision.data.title}</span>
                                </div>
                                <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                                   <span className="text-xs text-slate-500">Initial Status</span>
                                   {statusBadge(pendingDecision.data.status || "To Do")}
                                </div>
                                 <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                                   <span className="text-xs text-slate-500">Scheduled Date</span>
                                   <span className="text-xs font-bold text-slate-800">{pendingDecision.data.date ? formatDeadline(pendingDecision.data.date) : "No Deadline"}</span>
                                </div>
                                {databases && databases.length > 0 && (
                                  <div className="flex items-center justify-between border-t border-slate-100 pt-1.5">
                                    <span className="text-xs text-slate-500">Target Database</span>
                                    <select
                                      value={pendingDecision.data.targetDatabase || databases[0]?.name}
                                      onChange={(e) => setPendingDecision(prev => prev ? { ...prev, data: { ...prev.data, targetDatabase: e.target.value } } : null)}
                                      className="text-xs font-bold text-slate-800 bg-slate-50 border border-slate-200 rounded px-2 py-1 outline-none focus:border-slate-400 cursor-pointer text-left max-w-[160px] truncate"
                                    >
                                      {databases.map(db => (
                                        <option key={db.id} value={db.name}>{db.name}</option>
                                      ))}
                                    </select>
                                  </div>
                                )}
                              </div>
                           )}
                        </div>
                     )}

                     {/* Warnings Rendering */}
                     <div className="space-y-2">
                       {deadlineConflict && conflictingTaskNames.length > 0 && (
                         <div className="flex items-start gap-2.5 rounded bg-orange-50 border border-orange-200 p-3">
                           <div className="p-1 bg-orange-100 rounded text-orange-600">
                              <AlertTriangle size={14} />
                           </div>
                           <div>
                             <h5 className="text-[10px] font-bold uppercase text-orange-700 tracking-wider">Scheduling Conflict</h5>
                             <p className="text-[11px] text-orange-850 leading-snug">
                               <strong>{conflictingTaskNames.join(", ")}</strong> {conflictingTaskNames.length === 1 ? "is" : "are"} already set for this date.
                             </p>
                           </div>
                         </div>
                       )}
                       {duplicateTask && duplicateTaskName && (
                         <div className="flex items-start gap-2.5 rounded bg-orange-50 border border-orange-200 p-3">
                           <div className="p-1 bg-orange-100 rounded text-orange-600">
                              <AlertTriangle size={14} />
                           </div>
                           <div>
                             <h5 className="text-[10px] font-bold uppercase text-orange-700 tracking-wider">Redundant Entry</h5>
                             <p className="text-[11px] text-orange-850 leading-snug">
                               A task with the name <strong>&quot;{duplicateTaskName}&quot;</strong> already exists in your active list.
                             </p>
                           </div>
                         </div>
                       )}
                     </div>

                     {/* Confirm / Cancel Buttons */}
                     <div className="flex gap-2">
                       <button onClick={handleCancel} className="flex-1 py-2 rounded bg-slate-100 border border-slate-200 text-xs font-bold text-slate-600 hover:text-slate-800 hover:bg-slate-200 cursor-pointer uppercase tracking-wider">
                         Dismiss
                       </button>
                       <button 
                          onClick={handleConfirm} 
                          disabled={confirmLoading} 
                          className={`flex-grow py-2 rounded text-xs font-bold text-white cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5 uppercase tracking-wider ${pendingDecision.action === "DELETE" ? "bg-red-600 hover:bg-red-700" : "bg-slate-900 hover:bg-slate-800"}`}
                       >
                         {confirmLoading ? (
                           <div className="animate-spin h-3.5 w-3.5 border-2 border-white border-t-transparent rounded-full" />
                         ) : (
                           <><Check size={14} /> {pendingDecision.action === "DELETE" ? "Execute Deletion" : pendingDecision.action === "PLAN" ? `Deploy Blueprint` : "Confirm Action"}</>
                         )}
                       </button>
                     </div>
                   </div>
                ) : (
                  message ? (
                    <div className="whitespace-pre-wrap text-xs font-semibold text-slate-700 leading-relaxed">
                      {message}
                    </div>
                  ) : null
                )}
              </div>
            </div>
          )}
        </div>

        {/* Task Section: Notion Ledger */}
        {taskList && (
          <div className={`border-t border-slate-200 p-4 ${isLoading ? 'opacity-40' : 'opacity-100'}`}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
               <div className="space-y-0.5">
                 <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                   <div className="w-1.5 h-1.5 rounded-full bg-slate-400"></div>
                   Notion Ledger
                 </h4>
                 <p className="text-[10px] text-slate-400">All tasks tracked inside the target integrations.</p>
               </div>
              <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded border border-slate-200 uppercase">
                    Auto-Synced
                 </span>
                  <span className="text-[10px] font-bold text-blue-700 bg-blue-50 px-2.5 py-1 rounded border border-blue-100 uppercase">
                    {taskList.length} Tasks
                 </span>
              </div>
            </div>
            
            <div className="border border-slate-200 rounded overflow-hidden text-slate-900 bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-2 text-slate-500 font-bold uppercase tracking-wider">Task Name</th>
                      <th className="px-4 py-2 text-slate-500 font-bold uppercase tracking-wider">Status</th>
                      <th className="px-4 py-2 text-slate-500 font-bold uppercase tracking-wider">Deadline</th>
                      {databaseCount > 1 && (
                        <th className="px-4 py-2 text-slate-500 font-bold uppercase tracking-wider">Origin</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {(() => {
                      const activeTasks = taskList.filter(t => {
                        const s = (t.status || "").toUpperCase();
                        return !s.includes("DONE") && !s.includes("COMPLETE");
                      });
                      const doneTasks = taskList.filter(t => {
                        const s = (t.status || "").toUpperCase();
                        return s.includes("DONE") || s.includes("COMPLETE");
                      });

                      activeTasks.sort((a, b) => {
                        const dA = a.deadline || "";
                        const dB = b.deadline || "";

                        const hasTimeA = dA.includes('T') || dA.includes(':');
                        const hasTimeB = dB.includes('T') || dB.includes(':');

                        const dateA = dA ? dA.split('T')[0] : "9999-99-99";
                        const dateB = dB ? dB.split('T')[0] : "9999-99-99";

                        // 1. Primary: Sort by Date
                        if (dateA !== dateB) {
                          return dateA.localeCompare(dateB);
                        }

                        // 2. Secondary: Tasks with specific times come BEFORE date-only tasks
                        if (hasTimeA && !hasTimeB) return -1;
                        if (!hasTimeA && hasTimeB) return 1;

                        // 3. Tertiary: Sort by earliest time first (e.g. 9am before 1pm)
                        const msA = dA ? new Date(dA).getTime() : Infinity;
                        const msB = dB ? new Date(dB).getTime() : Infinity;
                        return msA - msB;
                      });

                      doneTasks.sort((a, b) => {
                        const timeA = a.deadline ? new Date(a.deadline).getTime() : 0;
                        const timeB = b.deadline ? new Date(b.deadline).getTime() : 0;
                        return timeB - timeA; // Newest deadline first, oldest last
                      });

                      return [...activeTasks, ...doneTasks];
                    })().map((task) => {
                       const status = (task.status || "Planned").toUpperCase();
                       const isDone = status.includes("DONE") || status.includes("COMPLETE");
                       const isDoing = status.includes("DOING") || status.includes("PROGRESS");
                       const statusStyles = isDone ? "bg-emerald-50 text-emerald-700 border-emerald-100" : 
                                          isDoing ? "bg-blue-50 text-blue-700 border-blue-100" : 
                                          "bg-amber-50 text-amber-700 border-amber-100";
                       const dotColor = isDone ? "bg-emerald-500" : isDoing ? "bg-blue-500" : "bg-amber-500";

                       return (
                        <tr key={task.id} className="hover:bg-slate-50/50">
                          <td className="px-4 py-3">
                            <span className="font-semibold text-slate-800 block max-w-xs md:max-w-md truncate" title={task.name}>
                              {task.name}
                            </span>
                          </td>
                          <td className="px-4 py-3">
                              <span className={`inline-flex items-center gap-1.5 border ${statusStyles} px-2.5 py-0.5 rounded text-[10px] font-bold uppercase`}>
                                <div className={`w-1 h-1 rounded-full ${dotColor}`} />
                                {task.status || "Planned"}
                             </span>
                          </td>
                          <td className="px-4 py-3 whitespace-nowrap">
                            <span className="text-slate-600 font-medium">
                              {task.deadline ? (
                                 <span className="text-slate-800">{formatDeadline(task.deadline)}</span>
                              ) : <span className="text-slate-400 italic font-normal">No deadline</span>}
                            </span>
                          </td>
                          {databaseCount > 1 && (
                            <td className="px-4 py-3">
                              <span className="text-slate-500 font-medium">
                                {task.databaseName || "Source"}
                              </span>
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="bg-slate-50 py-3 px-4 border-t border-slate-200 flex items-center justify-between text-[10px] font-bold uppercase text-slate-400">
          <div className="flex items-center gap-2">
            <div className="w-1.5 h-1.5 bg-blue-500 rounded-full"></div>
            {databaseCount} Databases Connected
          </div>
        </div>
      </div>
    </div>
  );
}
