"use client";
import { useState, useTransition, useRef } from "react";
import { executeUserPrompt } from "@/app/actions/agent-actions";
import { Info, X, Zap, List, Trash2, Calendar, CheckCircle2 } from "lucide-react";

const SUGGESTIONS = [
  { icon: <List size={14} />, text: "List all my current tasks." },
  { icon: <Zap size={14} />, text: "Which task should I prioritize next?" },
  { icon: <Calendar size={14} />, text: "Add a task to submit thesis by tomorrow." },
  { icon: <CheckCircle2 size={14} />, text: "Mark submit thesis as completed." },
  { icon: <Trash2 size={14} />, text: "Delete the task submit thesis." },
];

export default function CommandInput() {
  const [prompt, setPrompt] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
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
        if (data.success) {
          setMessage(data.message);
          setStatus("success");
          setPrompt("");
        } else {
          setMessage(data.message || "Something went wrong");
          setStatus("error");
        }
      } catch {
        setStatus("error");
        setMessage("Failed to execute command.");
      }
    });
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
           {message && (
             <div className={`mt-6 p-5 rounded-xl border ${status === "success" ? "bg-blue-50/50 border-blue-100" : "bg-red-50/50 border-red-100"}`}>
               <div className="whitespace-pre-wrap text-sm text-slate-700">{message}</div>
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
