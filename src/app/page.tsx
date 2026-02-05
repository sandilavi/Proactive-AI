"use client";
import { useState, useTransition, useRef } from "react";
import { executeUserPrompt } from "@/app/actions/agent-actions";
import { Info, X, Zap, List, Trash2, Calendar, CheckCircle2 } from "lucide-react";

export default function CommandInput() {
  const [prompt, setPrompt] = useState("");
  const [showHelp, setShowHelp] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = [
    { icon: <List size={14} />, text: "List all my current tasks." },
    { icon: <Zap size={14} />, text: "Which task should I prioritize next?" },
    { icon: <Calendar size={14} />, text: "Add a task to submit thesis by tomorrow." },
    { icon: <CheckCircle2 size={14} />, text: "Mark submit thesis as completed." },
    { icon: <Trash2 size={14} />, text: "Delete the task submit thesis." },
  ];

  const handleSuggestionClick = (text: string) => {
    setPrompt(text);
    setShowHelp(false);
    // Focus the input after setting the prompt so Enter key works immediately
    setTimeout(() => {
      inputRef.current?.focus();
    }, 0);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || status === "loading") return;
    setStatus("loading");

    const now = new Date();
    const offsetMinutes = -now.getTimezoneOffset(); 
    const hours = Math.floor(Math.abs(offsetMinutes) / 60).toString().padStart(2, '0');
    const minutes = (Math.abs(offsetMinutes) % 60).toString().padStart(2, '0');
    const sign = offsetMinutes >= 0 ? '+' : '-';
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
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-200 pt-8 pb-12 px-4 relative">
      <div className="max-w-2xl mx-auto">
        {/* Help Icon Button */}
        <div className="flex justify-end mb-4 pr-2 md:pr-4">
          <button 
            onClick={() => setShowHelp(!showHelp)}
            className="p-2 bg-white rounded-full shadow-md hover:bg-blue-50 transition-all border border-slate-200 text-blue-600 cursor-pointer"
            title="Show Suggestions"
          >
            {showHelp ? <X size={20} /> : <Info size={20} />}
          </button>
        </div>

        {/* Header Section */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2">
            Proactive<span className="text-blue-600">AI</span>
          </h1>
          <p className="text-slate-500 font-medium">Your Intelligent Notion Task Agent</p>
        </div>

        {/* Suggestion Popup */}
        {showHelp && (
          <div className="absolute top-24 right-2 md:right-8 md:translate-x-0 z-50 w-72 bg-white/90 backdrop-blur-xl border border-blue-100 shadow-2xl rounded-2xl p-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-3 flex items-center gap-2">
              Try these prompts
            </h3>
            <div className="flex flex-col gap-2">
              {suggestions.map((item, i) => (
                <button
                  key={i}
                  onClick={() => handleSuggestionClick(item.text)}
                  className="text-left text-[13px] p-3 rounded-xl hover:bg-blue-500 hover:text-white transition-all border border-transparent hover:border-blue-400 flex items-center gap-3 font-medium text-slate-600 group cursor-pointer"
                >
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
                <input
                  ref={inputRef}
                  type="text"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  placeholder="Ask me to list, create, or prioritize tasks..."
                  className="w-full p-4 pr-12 rounded-xl border border-slate-200 focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none transition-all bg-white/50"
                  disabled={isLoading}
                />
                <button
                  type="submit"
                  disabled={isLoading}
                  className="absolute right-2 top-2 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50 cursor-pointer disabled:cursor-not-allowed"
                >
                  {isLoading ? (
                    <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                  ) : (
                    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 5l7 7-7 7M5 5l7 7-7 7" />
                    </svg>
                  )}
                </button>
              </div>
            </form>

            {/* Response Area */}
            {message && (
              <div className={`mt-6 p-5 rounded-xl border transition-all animate-in fade-in slide-in-from-top-2 ${
                status === "success" ? "bg-blue-50/50 border-blue-100" : "bg-red-50/50 border-red-100"
              }`}>
                <div className="flex items-center gap-2 mb-2">
                  <div className={`h-2 w-2 rounded-full ${status === "success" ? "bg-blue-500" : "bg-red-500"}`} />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Agent Response</span>
                </div>
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 font-medium">{message}</div>
              </div>
            )}
          </div>

          <div className="bg-slate-50/50 p-4 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400 font-medium uppercase tracking-widest">
            <span>Notion Connected</span>
            <span>Powered by Llama 3.1</span>
          </div>
        </div>
      </div>
    </main>
  );
}
