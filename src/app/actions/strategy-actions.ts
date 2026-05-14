"use server";
import { groq, GROQ_MODEL } from "@/lib/groq";
import { NotionTask } from "./assistant-actions";
import { extractJSON } from "@/lib/utils";

export interface CapacityInsight {
  date: string;
  totalHours: number;
  status: "SAFE" | "BUSY" | "OVERLOADED";
  taskInsights?: Array<{ id: string; name: string; estimatedHours: number }>;
  suggestion?: string;
  reason?: string;
  mitigationTaskName?: string;
  mitigationTargetDate?: string;
}

export interface CapacityReport {
  insights: CapacityInsight[];
  overallSummary: string;
  thinkContext?: string;
  knownEstimations?: Record<string, number>;
}

const capacityReportCache = new Map<string, CapacityReport>();
const taskEstimationCache = new Map<string, number>();
let rateLimitCooldownUntil = 0;

export async function getCapacityInsights(
  tasks: NotionTask[],
  userOffset: string,
  persistentMemory?: Record<string, number>
): Promise<CapacityReport> {
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(new Date().getTime() + offsetMs);
  const today = localNow.toISOString().split("T")[0];

  if (Date.now() < rateLimitCooldownUntil) {
    const remainingSeconds = Math.ceil((rateLimitCooldownUntil - Date.now()) / 1000);
    const estimationsRecord: Record<string, number> = {};
    taskEstimationCache.forEach((hours, key) => {
      const namePart = key.split('-').slice(1).join('-');
      estimationsRecord[namePart || key] = hours;
    });

    return {
      insights: [],
      overallSummary: `Groq AI Rate Limit hit! Pausing analysis for ${remainingSeconds}s...`,
      knownEstimations: estimationsRecord,
      thinkContext: "I have paused my active analysis due to a Groq API Rate Limit, but I am still maintaining your existing task estimations from my memory."
    };
  }

  if (persistentMemory) {
    Object.entries(persistentMemory).forEach(([key, value]) => {
      taskEstimationCache.set(key, value);
    });
  }

  const currentTaskKeys = new Set(tasks.map(t => `${t.id}-${t.name}`));
  for (const cachedKey of taskEstimationCache.keys()) {
    if (!currentTaskKeys.has(cachedKey)) {
      taskEstimationCache.delete(cachedKey);
    }
  }

  const timeKey = `${localNow.getHours()}`;
  const taskFingerprint = `v7|${today}|${timeKey}|` + [...tasks]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map(t => {
      const cachedTime = taskEstimationCache.get(`${t.id}-${t.name}`);
      return `${t.id}-${t.status}-${t.name}-${t.deadline}${cachedTime ? `-[${cachedTime}]` : ''}`;
    })
    .join("|");

  if (capacityReportCache.has(taskFingerprint)) {
    const cached = capacityReportCache.get(taskFingerprint)!;
    if (cached.insights && cached.insights.length > 0) return cached;
  }

  const result = await runCapacityAnalysis(tasks, userOffset);

  if (result?.insights && Array.isArray(result.insights)) {
    result.insights.forEach(day => {
      if (day.taskInsights && Array.isArray(day.taskInsights)) {
        day.taskInsights.forEach(tInsight => {
          const matched = tasks.find(ot => ot.name === tInsight.name);
          if (matched) {
            taskEstimationCache.set(`${matched.id}-${matched.name}`, tInsight.estimatedHours);
          }
        });
      }
    });
  }

  if (result && result.insights && result.insights.length > 0) {
    capacityReportCache.set(taskFingerprint, result);
  }

  return result;
}

async function runCapacityAnalysis(tasks: NotionTask[], userOffset: string): Promise<CapacityReport> {
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(new Date().getTime() + offsetMs);

  let thinkContext = "";
  const activeTasks = tasks.filter(t => t.status?.toLowerCase() !== "done" && t.deadline && t.deadline !== 'No Deadline');

  // Phase 1: Estimations
  const missingEstimations = activeTasks.filter(t => {
    let cached = taskEstimationCache.get(`${t.id}-${t.name}`);
    if (cached === undefined) {
      for (const [key, val] of taskEstimationCache.entries()) {
        const cleanKey = key.split('-').pop() || key;
        if (cleanKey.toLowerCase().trim() === t.name.toLowerCase().trim()) {
          cached = val;
          break;
        }
      }
    }
    return cached === undefined;
  });

  if (missingEstimations.length > 0) {
    const estPrompt = missingEstimations.map(t => `- ID: "${t.id}", Name: "${t.name}"`).join("\n");
    try {
      const response = await groq.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0,
        messages: [
          { role: "system", content: "Estimate hours (0.5 to 8.0) for each task. Output strict JSON: { \"estimations\": [{ \"id\": \"task_id\", \"estimatedHours\": 2.5 }] }" },
          { role: "user", content: `TASKS TO ESTIMATE:\n${estPrompt}` }
        ]
      });
      const rawContent = response.choices[0]?.message?.content || "";
      const data = extractJSON<{ estimations: { id: string, name?: string, estimatedHours: number }[] }>(rawContent);
      const thinkMatch = rawContent.match(/<think>([\s\S]*?)<\/think>/);
      thinkContext = thinkMatch ? thinkMatch[1].trim() : "";
      
      if (data && data.estimations) {
        data.estimations.forEach(est => {
          const cleanEstId = String(est.id).trim().replace(/['"]/g, '');
          const matched = missingEstimations.find(t => {
            const cleanTaskId = String(t.id).trim().replace(/['"]/g, '');
            return cleanTaskId === cleanEstId || t.name.trim().toLowerCase() === String(est.name || "").trim().toLowerCase();
          });
          if (matched) {
            taskEstimationCache.set(`${matched.id}-${matched.name}`, est.estimatedHours);
          }
        });
      }
    } catch (e: any) { 
      if (e?.status === 429) {
        const retryAfter = parseInt(e.headers?.['retry-after'] || '60');
        rateLimitCooldownUntil = Date.now() + (retryAfter * 1000);
      }
      console.error("Estimation failed", e); 
    }
  }

  // Phase 2: Building insights
  const normalizeDate = (deadline: string): string => {
    const parsed = new Date(deadline);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return deadline.split('T')[0];
  };

  const [signToday, hToday, mToday] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMsToday = (parseInt(hToday) * 60 + parseInt(mToday)) * 60000 * (signToday === "+" ? 1 : -1);
  const localNowToday = new Date(new Date().getTime() + offsetMsToday);
  const todayStr = localNowToday.toISOString().split("T")[0];

  const insightsMap = new Map<string, CapacityInsight>();
  insightsMap.set(todayStr, { date: todayStr, totalHours: 0, status: "SAFE", taskInsights: [] });

  activeTasks.forEach(t => {
    const d = normalizeDate(t.deadline || todayStr);
    if (!insightsMap.has(d)) insightsMap.set(d, { date: d, totalHours: 0, status: "SAFE", taskInsights: [] });
    const day = insightsMap.get(d)!;
    
    let est = taskEstimationCache.get(`${t.id}-${t.name}`);
    if (est === undefined) {
      for (const [key, val] of taskEstimationCache.entries()) {
        const cleanKey = key.split('-').pop() || key;
        if (cleanKey.toLowerCase().trim() === t.name.toLowerCase().trim()) {
          est = val;
          break;
        }
      }
    }
    const finalEst = est || 1.5;
    
    day.taskInsights!.push({ id: t.id, name: t.name, estimatedHours: finalEst });
    day.totalHours += finalEst;
  });

  const insightsArray = Array.from(insightsMap.values()).sort((a, b) => a.date.localeCompare(b.date));
  insightsArray.forEach(day => {
    if (day.totalHours >= 12) day.status = "OVERLOADED";
    else if (day.totalHours >= 9) day.status = "BUSY";
    else day.status = "SAFE";
  });

  // Phase 3: Mitigation Consultant
  let overallSummary = "Your schedule is perfectly balanced! No overloads detected.";
  const overloadedDays = insightsArray.filter(i => i.status === "OVERLOADED");

  if (overloadedDays.length > 0) {
    overallSummary = "I detect some overloaded days. Let's proactively rebalance your workload.";
    const calendarMap = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(localNowToday);
      d.setDate(d.getDate() + i);
      calendarMap.push(d.toISOString().split('T')[0]);
    }

    try {
      const mitResponse = await groq.chat.completions.create({
        model: GROQ_MODEL,
        temperature: 0,
        messages: [
          {
            role: "system",
            content: `You are a Capacity Mitigation Consultant.
            CORE CONSTRAINTS:
            - STRATEGY: Prioritize moving tasks from OVERLOADED days to EARLIER safe dates (including Today) before suggesting future dates.
            - IMPORTANCE-FIRST: Suggest moving the LEAST IMPORTANT tasks first.
            - OUTPUT: Strict JSON schema.
            
            SCHEMA:
            {
              "overallSummary": "A concise, conversational summary of recommendations. NEVER use active words like 'I am moving' or 'I have moved'.",
              "mitigations": [{ 
                "date": "YYYY-MM-DD", 
                "suggestion": "A consultative sentence using Month and Day.",
                "mitigationTaskName": "Exact task name", 
                "mitigationTargetDate": "YYYY-MM-DD" 
              }]
            }`
          },
          { role: "user", content: `CALENDAR:\n${calendarMap.join(", ")}\n\nOVERLOADED DAYS:\n${overloadedDays.map(d => JSON.stringify(d)).join("\n")}` }
        ]
      });
      const rawMit = mitResponse.choices[0]?.message?.content || "";
      const thinkMatch = rawMit.match(/<think>([\s\S]*?)<\/think>/);
      if (thinkMatch) thinkContext = thinkMatch[1].trim();

      const mitData = extractJSON<{ mitigations: any[], overallSummary: string }>(rawMit);
      const toHumanDate = (iso: string) => {
        const d = new Date(iso);
        return isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
      };

      if (mitData) {
        if (mitData.overallSummary) overallSummary = mitData.overallSummary.replace(/,?\s*\d{4}/g, "");
        mitData.mitigations?.forEach(mit => {
          const targetDay = insightsArray.find(i => i.date === mit.date);
          if (targetDay) {
            let cleanSuggestion = (mit.suggestion || "").replace(/,?\s*\d{4}/g, "");
            const isoRegex = /\d{4}-\d{2}-\d{2}/g;
            cleanSuggestion = cleanSuggestion.replace(isoRegex, (match: string) => toHumanDate(match));

            if (mit.mitigationTargetDate < todayStr || mit.mitigationTargetDate === mit.date) {
              targetDay.mitigationTargetDate = todayStr;
              targetDay.suggestion = cleanSuggestion.replace(toHumanDate(mit.mitigationTargetDate), "Today");
            } else {
              targetDay.suggestion = cleanSuggestion;
              targetDay.mitigationTargetDate = mit.mitigationTargetDate;
            }
            targetDay.mitigationTaskName = mit.mitigationTaskName;
          }
        });
      }
    } catch (e) { console.error("Mitigation failed", e); }
  }

  return {
    insights: insightsArray,
    overallSummary,
    knownEstimations: Object.fromEntries(taskEstimationCache),
    thinkContext
  };
}
