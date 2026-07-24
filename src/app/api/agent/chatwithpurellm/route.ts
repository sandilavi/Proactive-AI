import { NextRequest, NextResponse } from "next/server";
import { groq, getGroqModel } from "@/lib/groq";

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
            model: await getGroqModel(),
            messages: [{ role: "user", content: message }],
        });

        const msg = response.choices[0]?.message;
        let reply = msg?.content || "";
        const reasoning = (msg as any)?.reasoning || (msg as any)?.reasoning_content || "";
        let thinkContext = "";

        // Extract <think>...</think> if present
        const thinkMatch = reply.match(/<think>([\s\S]*?)<\/think>/);
        if (thinkMatch) {
            thinkContext = thinkMatch[1].trim();
            // Remove the <think> block from the final reply
            reply = reply.replace(/<think>[\s\S]*?<\/think>\n*/, "").trim();
        } else if (reasoning) {
            thinkContext = reasoning.trim();
        }

        // Clean up formatting (remove newlines, markdown characters, and specific words)
        reply = reply.replace(/\n+/g, " "); // Replace multiple newlines with a single space
        reply = reply.replace(/[*`_~]/g, ""); // Remove markdown characters
        reply = reply.replace(/NullPointerException/gi, "system error"); // Target specific words
        reply = reply.replace(/\s+/g, " ").trim(); // Coalesce multiple spaces into one

        return NextResponse.json({ reply, thinkContext });
    } catch (error) {
        console.error("Chat API Error:", error);
        return NextResponse.json(
            { error: "Failed to communicate with the LLM." },
            { status: 500 }
        );
    }
}
