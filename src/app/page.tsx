"use client";
import { useState, useTransition } from "react";
import { executeUserPrompt } from "@/app/actions/agent-actions";

export default function CommandInput() {
  const [prompt, setPrompt] = useState("");
  const [status, setStatus] = useState<
    "idle" | "loading" | "success" | "error"
  >("idle");
  const [message, setMessage] = useState("");
  const [isPending, startTransition] = useTransition();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");

    startTransition(async () => {
      try {
        const data = await executeUserPrompt(prompt);

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
    <main className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-200 py-12 px-4">
      <div className="max-w-2xl mx-auto">
        {/* Header Section */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-extrabold text-slate-900 tracking-tight mb-2">
            Proactive<span className="text-blue-600">AI</span>
          </h1>
          <p className="text-slate-500 font-medium">
            Your Intelligent Notion Task Agent
          </p>
        </div>

        {/* Main Chat Card */}
        <div className="bg-white/80 backdrop-blur-md border border-white shadow-xl rounded-2xl overflow-hidden">
          <div className="p-6">
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div className="relative">
                <input
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
                  className="absolute right-2 top-2 p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors disabled:opacity-50"
                >
                  {status === "loading" ? (
                    <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                  ) : (
                    <svg
                      className="w-6 h-6"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13 5l7 7-7 7M5 5l7 7-7 7"
                      />
                    </svg>
                  )}
                </button>
              </div>
            </form>

            {/* Response Area */}
            {message && (
              <div
                className={`mt-6 p-5 rounded-xl border transition-all animate-in fade-in slide-in-from-top-2 ${
                  status === "success"
                    ? "bg-blue-50/50 border-blue-100"
                    : "bg-red-50/50 border-red-100"
                }`}
              >
                {/* Agent Label */}
                <div className="flex items-center gap-2 mb-2">
                  <div
                    className={`h-2 w-2 rounded-full ${
                      status === "success" ? "bg-blue-500" : "bg-red-500"
                    }`}
                  />
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Agent Response
                  </span>
                </div>

                {/* Message Content */}
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700 font-medium">
                  {message}
                </div>
              </div>
            )}
          </div>

          {/* Footer info */}
          <div className="bg-slate-50/50 p-4 border-t border-slate-100 flex justify-between items-center text-[10px] text-slate-400 font-medium uppercase tracking-widest">
            <span>Notion Connected</span>
            <span>Powered by Llama 3.3</span>
          </div>
        </div>
      </div>
    </main>
  );
}
