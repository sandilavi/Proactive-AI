import Groq from "groq-sdk";

export const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

export const DEFAULT_GROQ_MODEL = "qwen/qwen3.6-27b";

let cachedModels: string[] | null = null;
let lastFetched: number = 0;
const CACHE_TTL = 1000 * 60 * 60; // 1 hour cache

async function getAvailableModelIds(): Promise<string[]> {
  const now = Date.now();
  if (cachedModels && (now - lastFetched < CACHE_TTL)) {
    return cachedModels;
  }
  try {
    const response = await groq.models.list();
    const ids = (response.data || [])
      .filter((m: any) => !m.id.includes("whisper") && !m.id.includes("tts"))
      .map((m: any) => m.id);
    if (ids.length > 0) {
      cachedModels = ids;
      lastFetched = now;
      return ids;
    }
  } catch (e) {
    console.error("Failed to fetch available Groq models for fallback check:", e);
  }
  return cachedModels || [];
}

// Server-safe: reads the selected model from the request cookie.
// Falls back to DEFAULT_GROQ_MODEL when no cookie is set or when
// running outside of a request context (e.g., during build).
// If the selected/default model is not available in Groq, falls back to the first available model.
export async function getGroqModel(): Promise<string> {
  let modelToUse = DEFAULT_GROQ_MODEL;
  try {
    const { cookies } = await import("next/headers");
    const cookieStore = await cookies();
    const stored = cookieStore.get("selected_groq_model")?.value;
    if (stored) {
      modelToUse = stored;
    }
  } catch {
    // Safe catch for static builds or non-request scopes
  }

  try {
    const available = await getAvailableModelIds();
    if (available.length > 0 && !available.includes(modelToUse)) {
      console.warn(`Model "${modelToUse}" is not available on Groq. Falling back to "${available[0]}".`);
      return available[0];
    }
  } catch (e) {
    // If fallback check fails, continue using the selected model
  }

  return modelToUse;
}

// Keep the legacy constant so any non-migrated callers don't break at build time.
export const GROQ_MODEL = DEFAULT_GROQ_MODEL;
