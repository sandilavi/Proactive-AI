import { NextRequest, NextResponse } from "next/server";
import { groq, GROQ_MODEL } from "@/lib/groq";

export async function POST(req: NextRequest) {
    try {
        const body = await req.json();
        const { message } = body;

        if (!message) {
            return NextResponse.json(
                { error: "Please provide a 'message' in the JSON body." },
                { status: 400 }
            );
        }

        const response = await groq.chat.completions.create({
            model: GROQ_MODEL,
            messages: [{ role: "user", content: message }],
        });

        const reply = response.choices[0]?.message?.content || "";
        return NextResponse.json({ reply });
    } catch (error) {
        console.error("Chat API Error:", error);
        return NextResponse.json(
            { error: "Failed to communicate with the LLM." },
            { status: 500 }
        );
    }
}
