"use client";
import { useState, useTransition, useRef } from "react";
import { executeUserPrompt, confirmAction, NotionTask, AgentSuggestion, AgentResponse } from "@/app/actions/agent-actions";
import { Info, X, List, Zap, Trash2, Calendar, CheckCircle2, AlertTriangle, Check } from "lucide-react";

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
  const [pendingDecision, setPendingDecision] = useState<AgentResponse | null>(null);
  const [pendingTaskName, setPendingTaskName] = useState("");
  const [confirmLoading, setConfirmLoading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

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
        if (data.requiresConfirmation) {
          setPendingDecision(data.pendingDecision);
          setPendingTaskName(data.pendingTaskName);
          setTaskList(data.tasks ?? null);
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
      setConfirmLoading(false);
    }
  };

  const handleCancel = () => {
    setPendingDecision(null);
    setPendingTaskName("");
    setStatus("idle");
    setMessage("Action cancelled.");
  };

  const isLoading = status === "loading" || isPending;

  return (
    <div className="relative">
       {/* Help Icon Button */}
       <div className="flex justify-end mb-4 pr-2 md:pr-4">
         <button onClick={() => setShowHelp(!showHelp)} 
          className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-all border border-slate-200 text-blue-600 cursor-pointer"
          title="Show Suggestions"
          >
           {showHelp ? <X size={20} /> : <Info size={20} />}
         </button>
       </div>

       {/* Suggestion Popup */}
       {showHelp && (
         <div className="absolute top-12 right-2 z-50 w-72 bg-white/90 backdrop-blur-xl border border-blue-100 shadow-2xl rounded-2xl p-4 animate-in zoom-in-95">
           <h3 className="text-xs font-bold text-slate-400 uppercase mb-3">Try these prompts</h3>
           <div className="flex flex-col gap-2">
             {SUGGESTIONS.map((item, i) => (
               <button key={i} onClick={() => handleSuggestionClick(item.text)} className="text-left text-[13px] p-3 rounded-xl hover:bg-blue-500 hover:text-white transition-all border border-transparent hover:border-blue-400 flex items-center gap-3 font-medium text-slate-600 group cursor-pointer">
                 <span className="text-blue-500 group-hover:text-white">{item.icon}</span>
                 {item.text}
               </button>
             ))}
           </div>
         </div>
       )}

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

            {/* Confirmation Card */}
            {pendingDecision && (
              <div className={`mt-5 rounded-xl border overflow-hidden ${pendingDecision.action === "DELETE" ? "border-red-200" : "border-amber-200"}`}>
                <div className={`px-5 py-2.5 flex items-center gap-2 border-b ${pendingDecision.action === "DELETE" ? "bg-red-50 border-red-100" : "bg-amber-50 border-amber-100"}`}>
                  <AlertTriangle size={13} className={pendingDecision.action === "DELETE" ? "text-red-500" : "text-amber-500"} />
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Confirm Action</span>
                </div>
                <div className={`px-5 py-4 ${pendingDecision.action === "DELETE" ? "bg-red-50/40" : "bg-amber-50/40"}`}>
                  <p className="text-sm text-slate-700 mb-4">
                    {pendingDecision.action === "DELETE" && <>I&apos;m about to permanently delete <strong>&quot;{pendingTaskName}&quot;</strong>. This cannot be undone.</>}
                    {pendingDecision.action === "UPDATE" && <>I&apos;m about to update <strong>&quot;{pendingTaskName}&quot;</strong>{pendingDecision.data.status && <> → Status: <strong>{pendingDecision.data.status}</strong></>}{pendingDecision.data.date && <> → Due: <strong>{pendingDecision.data.date}</strong></>}.</>}
                    {pendingDecision.action === "CREATE" && <>I&apos;m about to create: <strong>&quot;{pendingDecision.data.title}&quot;</strong>{pendingDecision.data.date && <> due <strong>{pendingDecision.data.date}</strong></>}.</>}
                  </p>
                  <div className="flex gap-3">
                    <button onClick={handleCancel} className="flex-1 py-2 rounded-xl border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors cursor-pointer font-medium">
                      Cancel
                    </button>
                    <button onClick={handleConfirm} disabled={confirmLoading} className={`flex-1 py-2 rounded-xl text-sm font-semibold text-white transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center gap-2 ${pendingDecision.action === "DELETE" ? "bg-red-500 hover:bg-red-600" : "bg-blue-500 hover:bg-blue-600"}`}>
                      {confirmLoading ? <div className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" /> : <><Check size={14} />{pendingDecision.action === "DELETE" ? "Yes, Delete" : "Confirm"}</>}
                    </button>
                  </div>
                </div>
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
             {message && (
               <div className={`mt-6 p-5 rounded-xl border ${status === "success" ? "bg-blue-50/50 border-blue-100" : "bg-red-50/50 border-red-100"}`}>
                 <div className="whitespace-pre-wrap text-sm text-slate-700">{message}</div>
               </div>
             )}
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
                         <th className="text-left px-4 py-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">Due Date</th>
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
