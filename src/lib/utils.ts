export function extractJSON<T>(raw: string): T | null {
  try {
    // Strip closed <think> blocks
    let clean = raw.replace(/<think>[\s\S]*?<\/think>/g, "").trim();

    // Handle UNCLOSED <think> tags (truncated response) 
    if (clean.includes('<think>')) {
      clean = clean.replace(/<think>[\s\S]*/g, "").trim();
    }

    // Try extracting JSON block or general object match
    const markdownMatch = clean.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/i);
    const outerCurlyMatch = clean.match(/\{[\s\S]*\}/);
    const candidates = [markdownMatch?.[1], outerCurlyMatch?.[0], clean].filter(Boolean);

    for (const candidate of candidates as string[]) {
      let c = candidate.replace(/```json/gi, "").replace(/```/g, "").trim();
      
      // Deep Scan & trailing comma cleanup
      const firstCurly = c.indexOf('{');
      const lastCurly = c.lastIndexOf('}');
      if (firstCurly !== -1 && lastCurly !== -1 && lastCurly >= firstCurly) {
        let slice = c.substring(firstCurly, lastCurly + 1);
        slice = slice.replace(/,\s*([}\]])/g, '$1');
        try { 
          return JSON.parse(slice) as T; 
        } catch (e) { }
      }
    }

    return null;
  } catch (e) {
    console.error("Agent JSON Parsing Failed:", String(e));
    return null;
  }
}

export function getUrgencyCategory(hours: number): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  if (hours < 24) return "CRITICAL";
  if (hours < 72) return "HIGH";
  if (hours < 168) return "MEDIUM";
  return "LOW";
}

export function calculateDeadlineInfo(deadline: string | undefined | null, localNow: Date, now: Date): { deadlineLabel: string, relativeInfo: string } {
  let deadlineLabel = "No Deadline";
  let relativeInfo = "";

  if (deadline && deadline !== "No Deadline") {
    const isDateOnly = !deadline.includes("T");
    const dlDate = new Date(deadline);

    deadlineLabel = isDateOnly
      ? dlDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: 'UTC' })
      : dlDate.toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "numeric" });

    let sortHrs = 0;
    let humanDiff = "";

    if (isDateOnly) {
      const localDateObj = new Date(localNow.toISOString().split("T")[0] + "T00:00:00Z");
      const dlDateObj = new Date(deadline + "T00:00:00Z");
      const diffDays = Math.round((dlDateObj.getTime() - localDateObj.getTime()) / 86400000);
      sortHrs = diffDays * 24;
      humanDiff = diffDays < 0 ? `${Math.abs(diffDays)} days overdue` : diffDays === 0 ? "due today" : `due in ${diffDays} days`;
    } else {
      const diffMs = dlDate.getTime() - now.getTime();
      sortHrs = diffMs / 3600000;
      const absHrs = Math.abs(sortHrs);
      if (sortHrs < 0) {
        humanDiff = absHrs >= 24 ? `${Math.floor(absHrs / 24)}d ${Math.floor(absHrs % 24)}h overdue` : `${Math.floor(absHrs)}h ${Math.floor((absHrs * 60) % 60)}m overdue`;
      } else {
        humanDiff = absHrs >= 24 ? `due in ${Math.floor(absHrs / 24)}d ${Math.floor(absHrs % 24)}h` : `due in ${Math.floor(absHrs)}h ${Math.floor((absHrs * 60) % 60)}m`;
      }
    }

    const urgency = getUrgencyCategory(sortHrs);
    const daysVal = (sortHrs / 24).toFixed(1);
    relativeInfo = ` [Time: ${sortHrs.toFixed(1)}h (~${daysVal} days) | Urgency: ${urgency} | ${humanDiff}]`;
  }

  return { deadlineLabel, relativeInfo };
}

export function getUserLocalTime(userOffset: string) {
  const now = new Date();
  const [sign, h, m] = userOffset.match(/([+-])(\d{2}):(\d{2})/)?.slice(1) || ["+", "0", "0"];
  const offsetMs = (parseInt(h) * 60 + parseInt(m)) * 60000 * (sign === "+" ? 1 : -1);
  const localNow = new Date(now.getTime() + offsetMs);
  return { now, localNow };
}

export function normalizeStatus(input?: string): "Not started" | "In Progress" | "Done" {
  const s = (input ?? "").trim().toLowerCase();
  if (s === "done" || s === "completed") return "Done";
  if (s === "in progress" || s === "ongoing") return "In Progress";
  return "Not started";
}
