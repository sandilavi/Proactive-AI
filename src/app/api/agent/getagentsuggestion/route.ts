import { getAgentSuggestion } from "@/app/actions/assistant-actions";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tasks = body.tasks && body.tasks.length > 0 ? body.tasks : [];

    const result = await getAgentSuggestion(tasks, body.userOffset || "+00:00", body.previousSuggestion);

    return NextResponse.json({ 
      success: true, 
      suggestion: result?.suggestion || "No suggestion",
      reason: result?.reason || "No reason",
      confidence: result?.confidence || 0,
    });
  } catch {
    return NextResponse.json({ success: false, error: "Reasoning failed" }, { status: 500 });
  }
}
