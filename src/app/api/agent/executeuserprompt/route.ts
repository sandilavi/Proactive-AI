import { NextRequest, NextResponse } from 'next/server';
import { executeUserPrompt } from "@/app/actions/agent-actions";

export async function POST(req: NextRequest) {
  try {
    const { prompt } = await req.json();
    const result = await executeUserPrompt(prompt);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ success: false, error: "Command failed" }, { status: 500 });
  }
}
