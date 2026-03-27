"use client";
import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { executeUserPrompt, confirmAction, getAgentSuggestion, NotionTask, AgentSuggestion, AgentResponse } from "@/app/actions/agent-actions";
import { fetchNotionTasks, NotionDatabase } from "@/app/actions/notion-actions";
import { X, Zap, Trash2, AlertTriangle, Check, Bell, BellRing, Clock, Brain, Sparkles, Activity } from "lucide-react";

// Proactive Notification Timer
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
    <div className="relative space-y-10">
      {/* Agentic Insight: Cinematic AI Overlook */}
      {suggestion && !message && !pendingDecision && status === "idle" && (() => {
         // Local narrow to satisfy TS
         const currentSug = suggestion;
         const dateStr = new Date().toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
         const p = (currentSug.priority || "MEDIUM").toUpperCase();
         
         const pStyle = 
           p === "CRITICAL" ? { 
             card: "bg-rose-950 border-rose-500/40 shadow-rose-900/40", 
             text: "text-rose-400", 
             bg: "bg-rose-500/20",
             border: "border-rose-500/30",
             glow: "from-rose-500/20", 
             gradient: "from-rose-500 to-rose-400" 
           } :
           p === "HIGH"     ? { 
             card: "bg-orange-950 border-orange-500/40 shadow-orange-900/40", 
             text: "text-orange-400", 
             bg: "bg-orange-500/20",
             border: "border-orange-500/30",
             glow: "from-orange-500/20", 
             gradient: "from-orange-500 to-orange-400" 
           } :
           p === "MEDIUM"   ? { 
             card: "bg-slate-900 border-blue-500/30 shadow-blue-900/20", 
             text: "text-blue-400", 
             bg: "bg-blue-500/20",
             border: "border-blue-500/30",
             glow: "from-blue-500/10", 
             gradient: "from-blue-500 to-blue-400" 
           } :
           p === "LOW"      ? { 
             card: "bg-zinc-900 border-zinc-700 shadow-zinc-950/40", 
             text: "text-zinc-500/80", 
             bg: "bg-zinc-500/20",
             border: "border-zinc-500/30",
             glow: "from-zinc-700/10", 
             gradient: "from-zinc-500 to-zinc-400" 
           } :
                              { 
             card: "bg-slate-900 border-purple-500/30 shadow-purple-900/20", 
             text: "text-purple-400", 
             bg: "bg-purple-500/20",
             border: "border-purple-500/30",
             glow: "from-purple-500/10", 
             gradient: "from-purple-500 to-purple-400" 
           };

         return (
           <div className={`${pStyle.card} rounded-[3.5rem] p-10 text-white shadow-2xl relative overflow-hidden group animate-in fade-in slide-in-from-top-10 duration-1000 border`}>
              {/* Dynamic Glow Overlay */}
              <div className={`absolute inset-0 bg-gradient-to-br ${pStyle.glow} to-transparent opacity-50`}></div>
              {/* Animated Grid Overlay */}
              <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/carbon-fibre.png')] opacity-10 mix-blend-overlay"></div>

              <div className="relative z-10">
                 <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 mb-8">
                    <div className="flex flex-col gap-2">
                       <div className="flex items-center gap-3">
                         <div className={`inline-flex items-center gap-2.5 bg-white/10 backdrop-blur-xl px-5 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.3em] border border-white/10 shadow-2xl w-fit`}>
                            <Sparkles size={14} className={pStyle.text} /> Agentic Insight
                         </div>
                         <div className={`inline-flex items-center px-4 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] border shadow-2xl ${pStyle.bg} ${pStyle.text} ${pStyle.border}`}>
                            {p}
                         </div>
                       </div>
                       <div className="text-[11px] font-black text-white/40 uppercase tracking-[0.2em] pl-1">
                          Calculated for {dateStr}
                       </div>
                    </div>
                    
                    <div className="flex flex-col items-end gap-2 text-right">
                       <div className="flex items-center gap-3">
                          <span className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none mt-1">AI Confidence</span>
                          <span className={`text-2xl font-black tabular-nums ${pStyle.text} leading-none`}>{Math.round(currentSug.confidence * 100)}%</span>
                       </div>
                       <div className="w-48 bg-white/10 rounded-full h-1.5 overflow-hidden p-0">
                          <div className={`h-full bg-gradient-to-r ${pStyle.gradient} rounded-full transition-all duration-1000 ease-out shadow-sm`} style={{ width: `${Math.round(currentSug.confidence * 100)}%` }} />
                       </div>
                    </div>
                 </div>

                 <div className="space-y-4 w-full">
                    <h3 className="text-4xl font-black leading-tight tracking-tighter bg-clip-text text-transparent bg-gradient-to-r from-white via-white to-white/70">
                       {currentSug.suggestion}
                    </h3>
                    <p className="text-xl font-medium text-white/70 leading-relaxed tracking-tight">
                       {currentSug.reason}
                    </p>
                 </div>

                 {/* Proactive Thinking Block */}
                 {currentSug.thinkContext && (
                   <div className="mt-10 pt-8 border-t border-white/10">
                     <button
                       type="button"
                       onClick={() => setProactiveThinkOpen(!proactiveThinkOpen)}
                       className={`flex items-center gap-2 text-[10px] font-black transition-all uppercase tracking-[0.2em] cursor-pointer ${proactiveThinkOpen ? pStyle.text : "text-white/40 hover:text-white"}`}
                     >
                       <Brain size={12} />
                       <span>{proactiveThinkOpen ? "Collapse Intelligence" : "Expand Intelligence"}</span>
                       <svg
                         viewBox="0 0 24 24"
                         fill="none"
                         stroke="currentColor"
                         strokeWidth="3"
                         className={`w-2.5 h-2.5 transition-transform duration-500 ${proactiveThinkOpen ? "rotate-180" : "rotate-0 text-white/20"}`}
                       >
                         <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round"/>
                       </svg>
                     </button>
                     {proactiveThinkOpen && (
                       <div className="mt-6 pl-5 border-l-2 border-white/10">
                         <p className="text-[11px] text-white/50 leading-relaxed whitespace-pre-wrap font-mono">
                           {currentSug.thinkContext}
                         </p>
                       </div>
                     )}
                   </div>
                 )}
              </div>
              
              <Brain size={400} className="absolute -bottom-32 -right-32 text-white/5 group-hover:scale-110 group-hover:rotate-12 transition-all duration-1000 pointer-events-none" />
           </div>
         );
      })()}

       {/* Main Chat Card: Premium Glassmorphism */}
       <div className="bg-white/90 backdrop-blur-3xl border border-white/50 shadow-[0_32px_100px_-20px_rgba(0,0,0,0.1)] rounded-[3.5rem] overflow-hidden relative z-10 flex flex-col transition-all duration-700 hover:shadow-[0_50px_120px_-25px_rgba(0,0,0,0.15)] group/card">
            {/* Ambient Background Glows */}
            <div className="absolute top-0 left-0 w-full h-96 bg-gradient-to-br from-blue-50/50 via-indigo-50/20 to-transparent opacity-0 group-hover/card:opacity-100 transition-opacity duration-1000 pointer-events-none" />
            
            {/* Dynamic Pattern Overlay */}
            <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-[0.03] pointer-events-none" />

            {/* Header with Source Badges: Refined Capsules */}
            <div className="px-10 py-8 pb-3 flex flex-col gap-5 relative z-10">
              <div className="flex flex-wrap items-center gap-4">
                <div className="flex items-center gap-2 mr-4">
                  <div className="w-1.5 h-4 bg-slate-900 rounded-full" />
                  <span className="text-[12px] font-black text-slate-800 uppercase tracking-[0.3em]">Neural Sources</span>
                </div>
                {databases.map(db => {
                   const isFYP = db.name.toUpperCase().includes("FYP");
                   const isPersonal = db.name.toUpperCase().includes("PERSONAL");
                   const badgeColor = isFYP ? "text-indigo-600 bg-indigo-50 border-indigo-100/50" : 
                                    isPersonal ? "text-rose-600 bg-rose-50 border-rose-100/50" : 
                                    "text-blue-600 bg-blue-50 border-blue-100/50";
                   const dotColor = isFYP ? "bg-indigo-400" : isPersonal ? "bg-rose-400" : "bg-blue-400";
                   
                   return (
                    <div key={db.id} className={`group relative flex items-center gap-3 border ${badgeColor} px-6 py-2.5 rounded-full text-[10px] font-black uppercase tracking-[0.2em] shadow-sm transition-all duration-500 cursor-default hover:scale-105 hover:shadow-md active:scale-95`}>
                      <div className={`w-1.5 h-1.5 rounded-full ${dotColor} animate-pulse`} />
                      {db.name}
                    </div>
                  );
                })}
                {databases.length === 0 && (
                  <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-6 py-2.5 rounded-full text-[10px] font-black text-slate-400 uppercase tracking-widest shadow-sm italic">
                    <Activity size={12} className="opacity-50" /> Initializing Neural Link...
                  </div>
                )}
              </div>
            </div>

           <div className="px-8 py-6 pt-2">
              <form onSubmit={handleSubmit} className="flex flex-col gap-6">
                <div className="relative group/input flex items-center">
                  <div className="absolute left-6 pointer-events-none text-slate-300 group-focus-within/input:text-slate-900 transition-colors duration-500 z-20">
                    <Sparkles size={20} />
                  </div>
                  
                  <input 
                    ref={inputRef} 
                    type="text" 
                    value={prompt} 
                    onChange={(e) => setPrompt(e.target.value)} 
                    placeholder="Initialize mission or query database..." 
                    className="relative w-full p-7 pl-16 pr-20 rounded-[2rem] border-2 border-slate-100 outline-none transition-all duration-500 focus:border-slate-900 focus:bg-white bg-slate-50/80 text-slate-900 font-bold placeholder:text-slate-400 placeholder:font-medium text-xl leading-tight shadow-sm" 
                    disabled={isLoading} 
                  />
                  <button 
                    type="submit" 
                    disabled={isLoading || !prompt.trim()} 
                    className="absolute right-3 top-3 bottom-3 px-6 bg-slate-900 hover:bg-black text-white rounded-[1.5rem] transition-all duration-300 disabled:opacity-30 cursor-pointer disabled:cursor-not-allowed flex items-center justify-center min-w-[70px] z-20"
                  >
                    {isLoading ? (
                      <div className="animate-spin h-6 w-6 border-3 border-white border-t-transparent rounded-full" />
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-black uppercase tracking-widest hidden md:block">Process</span>
                        <Zap size={20} className="fill-current" />
                      </div>
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
                       <span>{thinkOpen ? "Hide Neural Process" : "View Neural Process"}</span>
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
                       <div className="mt-4 pl-4 border-l-2 border-slate-200/50">
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
                            <div className="space-y-3">
                              {pendingDecision.data.plan.map((t, i) => (
                                <div key={i} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm hover:border-indigo-200 transition-all duration-300">
                                  <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                      <span className="w-5 h-5 rounded-full bg-indigo-50 border border-indigo-100 text-indigo-600 text-[9px] font-black flex items-center justify-center">{i + 1}</span>
                                      <span className="font-black text-slate-800 text-[13px] tracking-tight">{t.title}</span>
                                    </div>
                                    {t.date && <span className="text-[10px] font-black text-indigo-600 bg-indigo-50 px-3 py-1 rounded-full uppercase tracking-widest border border-indigo-100">{formatDeadline(t.date)}</span>}
                                  </div>
                                  <div className="flex items-center justify-between">
                                    {t.reason && <p className="text-[11px] font-medium text-slate-500 leading-relaxed">{t.reason}</p>}
                                    {t.durationHours && <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-2 shrink-0">{t.durationHours}h</span>}
                                  </div>
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
                               <><Check size={18} strokeWidth={3} /> {pendingDecision.action === "DELETE" ? "Execute Deletion" : pendingDecision.action === "PLAN" ? `Deploy ${pendingDecision.data.plan?.length ?? 0} Tasks to Notion` : "Confirm Action"}</>
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



                {/* Task Section: Modern High-End Table */}
                {taskList && (
                  <div className={`mt-14 animate-in slide-in-from-bottom-12 duration-1000 delay-300 transition-opacity duration-500 ${isLoading ? 'opacity-30' : 'opacity-100'}`}>
                    <div className="flex items-center justify-between mb-8 px-8">
                       <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-3">
                           <div className="w-1.5 h-1.5 rounded-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.5)]"></div>
                           <h4 className="text-[12px] font-black text-slate-900 uppercase tracking-[0.4em]">Notion Ledger</h4>
                        </div>
                        <div className="h-0.5 w-full bg-slate-100 rounded-full overflow-hidden">
                           <div className="h-full w-1/4 bg-blue-500/30"></div>
                        </div>
                       </div>
                      <div className="flex items-center gap-3">
                         <span className="flex items-center gap-2 text-[10px] font-black text-slate-500 bg-white px-4 py-2 rounded-full border border-slate-100 uppercase tracking-widest shadow-sm">
                            <Clock size={12} className="text-blue-500 animate-pulse" />
                            Auto-Syncing
                         </span>
                         <span className="text-[11px] font-black text-blue-600 bg-blue-50 px-4 py-2 rounded-full border border-blue-100 uppercase tracking-[0.2em] shadow-sm">
                            {taskList.length} Targets
                         </span>
                      </div>
                    </div>
                    
                    <div className="bg-white border border-slate-200/60 rounded-[3rem] overflow-hidden shadow-2xl relative">
                      {/* Subtle Internal Gradient */}
                      <div className="absolute inset-0 bg-gradient-to-b from-slate-50/30 to-white pointer-events-none" />

                      <div className="overflow-x-auto relative z-10">
                        <table className="w-full text-left border-separate border-spacing-0">
                          <thead>
                            <tr className="bg-slate-50/80 backdrop-blur-md">
                              <th className="px-10 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-slate-100">
                                 <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                                    Objective
                                 </div>
                              </th>
                              <th className="px-10 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-slate-100">
                                 <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                                    Stage
                                 </div>
                              </th>
                              <th className="px-10 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-slate-100">
                                 <div className="flex items-center gap-2">
                                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                                    Timeline
                                 </div>
                              </th>
                              {databaseCount > 1 && (
                                <th className="px-10 py-6 text-[10px] font-black text-slate-500 uppercase tracking-[0.25em] border-b border-slate-100">
                                   <div className="flex items-center gap-2">
                                      <div className="w-1.5 h-1.5 rounded-full bg-slate-300"></div>
                                      Origin
                                   </div>
                                </th>
                              )}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {taskList.map((task) => {
                               const status = (task.status || "Planned").toUpperCase();
                               const isDone = status.includes("DONE") || status.includes("COMPLETE");
                               const isDoing = status.includes("DOING") || status.includes("PROGRESS");
                               const statusStyles = isDone ? "bg-emerald-50 text-emerald-600 border-emerald-100" : 
                                                  isDoing ? "bg-indigo-50 text-indigo-600 border-indigo-100" : 
                                                  "bg-amber-50 text-amber-600 border-amber-100";
                               const dotColor = isDone ? "bg-emerald-400" : isDoing ? "bg-indigo-400" : "bg-amber-400";

                               return (
                                <tr key={task.id} className="group hover:bg-slate-50/80 transition-all duration-300 cursor-default">
                                  <td className="px-10 py-7">
                                    <span className="text-[14px] font-bold text-slate-800 tracking-tight block max-w-md truncate group-hover:text-blue-600 transition-colors" title={task.name}>
                                      {task.name}
                                    </span>
                                  </td>
                                  <td className="px-10 py-7">
                                     <div className={`inline-flex items-center gap-2.5 border ${statusStyles} px-4 py-1.5 rounded-full text-[9px] font-black uppercase tracking-[0.2em] shadow-sm transition-transform duration-500 group-hover:scale-105`}>
                                        <div className={`w-1 h-1 rounded-full ${dotColor} animate-pulse`} />
                                        {task.status || "Planned"}
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
                             );
                            })}
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
