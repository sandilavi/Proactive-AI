import { NextRequest, NextResponse } from "next/server";
import { processUserPrompt } from "@/app/actions/agent-actions";

export async function POST(req: NextRequest) {
  try {
    const { prompt, taskContext, userOffset } = await req.json();

    // Basic validation to ensure the test has data
    if (!prompt) {
      return NextResponse.json({ error: "Prompt is required" }, { status: 400 });
    }

    // Call the internal brain function directly
    const decision = await processUserPrompt(
      prompt, 
      taskContext || "", 
      userOffset || "+00:00"
    );

    return NextResponse.json({
      status: "Success",
      input: { prompt, userOffset },
      extracted_intent: decision
    });

  } catch (error: unknown) {
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ 
      status: "Error", 
      message: errorMessage 
    }, { status: 500 });
  }
}
