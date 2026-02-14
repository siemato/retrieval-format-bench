import { loadSync } from "@std/dotenv";
import { ModelSpec } from "./types.ts";

export interface EnvConfig {
  apiKey: string;
  baseUrl: string;
  httpReferer?: string;
  xTitle?: string;
  timeoutMs: number;
}

let envLoaded = false;

function ensureEnvLoaded(): void {
  if (envLoaded) return;
  envLoaded = true;
  try {
    loadSync({ export: true });
  } catch {
    // Ignore missing file and permission issues so callers can still rely on process env.
  }
}

export function readEnvConfigOptional(): EnvConfig {
  ensureEnvLoaded();
  const apiKey = Deno.env.get("OPENROUTER_API_KEY") ?? "";
  const baseUrl = Deno.env.get("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1";
  const httpReferer = Deno.env.get("OPENROUTER_HTTP_REFERER") ?? undefined;
  const xTitle = Deno.env.get("OPENROUTER_X_TITLE") ?? undefined;
  const timeoutMs = Number(Deno.env.get("OPENROUTER_TIMEOUT_MS") ?? "120000");

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error(`Invalid OPENROUTER_TIMEOUT_MS: ${Deno.env.get("OPENROUTER_TIMEOUT_MS")}`);
  }

  return { apiKey, baseUrl, httpReferer, xTitle, timeoutMs };
}

export function readEnvConfig(): EnvConfig {
  const cfg = readEnvConfigOptional();
  if (!cfg.apiKey) {
    throw new Error("Missing OPENROUTER_API_KEY (set it in env or .env)");
  }
  return cfg;
}

export async function readModelsFile(path: string): Promise<ModelSpec[]> {
  const txt = await Deno.readTextFile(path);
  const parsed = JSON.parse(txt) as { models: ModelSpec[] };
  if (!parsed.models || !Array.isArray(parsed.models) || parsed.models.length === 0) {
    throw new Error(`Models file must contain { "models": [...] }, got: ${path}`);
  }
  return parsed.models;
}
