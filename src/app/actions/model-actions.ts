"use server";
import { groq, DEFAULT_GROQ_MODEL } from "@/lib/groq";
import { cookies } from "next/headers";

export interface GroqModel {
  id: string;
  owned_by: string;
  context_window?: number;
}

export async function listGroqModels(): Promise<GroqModel[]> {
  try {
    const response = await groq.models.list();
    const models: GroqModel[] = (response.data || [])
      .filter((m: any) => !m.id.includes("whisper") && !m.id.includes("tts"))
      .map((m: any) => ({
        id: m.id,
        owned_by: m.owned_by || "",
        context_window: m.context_window,
      }))
      .sort((a: GroqModel, b: GroqModel) => a.id.localeCompare(b.id));
    return models;
  } catch (e) {
    console.error("Failed to list Groq models", e);
    return [];
  }
}

export async function getSelectedModel(): Promise<string> {
  const cookieStore = await cookies();
  return cookieStore.get("selected_groq_model")?.value || DEFAULT_GROQ_MODEL;
}

export async function setSelectedModel(modelId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set("selected_groq_model", modelId, {
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year
    httpOnly: false, // Readable by client if needed
    sameSite: "lax",
  });
}
