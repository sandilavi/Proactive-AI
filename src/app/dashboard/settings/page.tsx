"use client";
import React, { useEffect, useState, useTransition } from "react";
import { listGroqModels, getSelectedModel, setSelectedModel, GroqModel } from "@/app/actions/model-actions";
import { Check, Cpu, Loader2, RefreshCw, Zap } from "lucide-react";

const DEFAULT_GROQ_MODEL = "qwen/qwen3-32b";

function getModelDisplayName(id: string): string {
  const parts = id.split("/");
  return parts[parts.length - 1]
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function SettingsPage() {
  const [models, setModels] = useState<GroqModel[]>([]);
  const [selectedModel, setSelectedModelState] = useState<string>(DEFAULT_GROQ_MODEL);
  const [loading, setLoading] = useState(true);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    async function init() {
      setLoading(true);
      const [fetchedModels, current] = await Promise.all([listGroqModels(), getSelectedModel()]);
      setModels(fetchedModels);
      const ids = fetchedModels.map((m) => m.id);
      if (current && ids.includes(current)) {
        setSelectedModelState(current);
      } else if (ids.includes(DEFAULT_GROQ_MODEL)) {
        setSelectedModelState(DEFAULT_GROQ_MODEL);
      } else if (ids.length > 0) {
        setSelectedModelState(ids[0]);
      }
      setLoading(false);
    }
    init();
  }, []);

  const handleSelect = (modelId: string) => {
    if (modelId === selectedModel) return;
    startTransition(async () => {
      await setSelectedModel(modelId);
      setSelectedModelState(modelId);
      window.dispatchEvent(new Event("model-changed"));
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
            <Cpu size={16} className="text-white" />
          </div>
          <h1 className="text-xl font-bold text-slate-900">Settings</h1>
        </div>
        <p className="text-xs text-slate-500 ml-11">
          Configure the AI model used across Assistant, Strategy, and Horizon.
        </p>
      </div>

      {/* Model Selection Section */}
      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold text-slate-900">LLM Model</h2>
            <p className="text-[11px] text-slate-400 mt-0.5">Click a model to switch. Changes apply immediately.</p>
          </div>
          <div className="flex items-center gap-2">
            {isPending && <Loader2 size={14} className="animate-spin text-slate-400" />}
            <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200">
              <Zap size={11} className="text-slate-500" />
              <span className="text-[10px] font-semibold text-slate-600 uppercase tracking-wide">Groq</span>
            </div>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400">
            <Loader2 size={16} className="animate-spin" />
            <span className="text-sm">Fetching models…</span>
          </div>
        ) : models.length === 0 ? (
          <div className="text-center py-10 text-sm text-slate-400">
            <RefreshCw size={18} className="mx-auto mb-3 opacity-40" />
            No models available. Check your GROQ_API_KEY.
          </div>
        ) : (
          <div className="p-3 flex flex-wrap gap-2">
            {models.map((model) => {
              const isActive = model.id === selectedModel;
              const isDefault = model.id === DEFAULT_GROQ_MODEL;
              return (
                <button
                  key={model.id}
                  id={`model-${model.id.replace(/[^a-z0-9]/gi, "-")}`}
                  onClick={() => handleSelect(model.id)}
                  disabled={isPending}
                  className={`
                    flex items-center gap-1.5 px-3 py-2 rounded-lg border text-xs font-semibold transition-all duration-100 cursor-pointer disabled:cursor-not-allowed
                    ${isActive
                      ? "bg-slate-900 text-white border-slate-900"
                      : "bg-white text-slate-700 border-slate-200 hover:border-slate-400 hover:bg-slate-50"}
                  `}
                >
                  {isActive && <Check size={11} strokeWidth={3} />}
                  {getModelDisplayName(model.id)}
                  {isDefault && (
                    <span className={`text-[8px] font-bold px-1 py-0.5 rounded uppercase tracking-wide border
                      ${isActive 
                        ? "bg-slate-800 text-slate-300 border-slate-700" 
                        : "bg-indigo-50 text-indigo-600 border-indigo-100"}`}
                    >
                      Default
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Active model indicator */}
      {!loading && (
        <div className="mt-4 flex items-center gap-2 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[11px] text-slate-500">
            Active: <span className="font-semibold text-slate-800 font-mono">{selectedModel}</span>
          </span>
        </div>
      )}
    </div>
  );
}
