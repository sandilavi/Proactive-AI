import { NextRequest, NextResponse } from "next/server";
import { performNotionCRUD } from "@/app/actions/agent-actions";

export async function POST(req: NextRequest) {
  try {
    const { action, data } = await req.json();

    // 1. Basic Validation
    if (!action) {
      return NextResponse.json({ error: "Action is required (e.g., CREATE, UPDATE, DELETE)" }, { status: 400 });
    }

    // 2. Execute the CRUD operation directly
    const result = await performNotionCRUD(action, data);

    return NextResponse.json({
      status: "Operation Attempted",
      received: { action, data },
      result: result
    });

  } catch (error: unknown) {
    // Standardizing error handling to avoid 'any'
    const errorMessage = error instanceof Error ? error.message : "An unknown error occurred";
    return NextResponse.json({ 
      status: "Error", 
      message: errorMessage 
    }, { status: 500 });
  }
}
