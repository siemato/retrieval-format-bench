import { ModelSpec, Task } from "./types.ts";
import { OpenRouterClient } from "./openrouter.ts";

export type ModelPricing = {
  prompt: number; // USD per token
  completion: number; // USD per token
  request?: number; // USD per request
};

function approxTokens(text: string): number {
  // Rough heuristic: ~4 chars per token (varies by tokenizer/model).
  return Math.max(1, Math.ceil(text.length / 4));
}

function stringifyExpected(x: unknown): string {
  if (x === null || x === undefined) return "";
  if (typeof x === "string") return x;
  if (typeof x === "number" || typeof x === "boolean") return String(x);
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

export type TaskTokenEstimate = {
  taskId: string;
  inputTokens: number;
  outputTokens: number;
  meta?: Record<string, unknown>;
};

export type EstimateResult = {
  tasks: number;
  models: number;
  plannedCalls: number;
  totalsPerTask: TaskTokenEstimate[];
  totalInputTokens: number; // per model
  totalOutputTokens: number; // per model
  byVariant?: Record<string, { tasks: number; inputTokens: number; outputTokens: number }>;
};

export function estimateTokensForTasks(
  tasks: Task[],
  opts?: { outputTokensPerCall?: number },
): EstimateResult {
  const outPerCall = opts?.outputTokensPerCall;

  const totalsPerTask: TaskTokenEstimate[] = [];
  let totalInput = 0;
  let totalOutput = 0;

  const byVariant: Record<string, { tasks: number; inputTokens: number; outputTokens: number }> =
    {};

  for (const t of tasks) {
    let inputTok = 0;
    if (t.messages && t.messages.length > 0) {
      for (const m of t.messages) inputTok += approxTokens(m.content);
    } else if (t.prompt) {
      inputTok += approxTokens(t.prompt);
    }

    let outTok: number;
    if (typeof outPerCall === "number") {
      outTok = outPerCall;
    } else {
      const exp = stringifyExpected(t.expected);
      // Expect answers to be short (we enforce "final answer only" in templates).
      outTok = Math.max(8, approxTokens(exp) + 2);
    }

    totalInput += inputTok;
    totalOutput += outTok;

    totalsPerTask.push({ taskId: t.id, inputTokens: inputTok, outputTokens: outTok, meta: t.meta });

    const v = String(t.meta?.variant ?? "unknown");
    byVariant[v] ??= { tasks: 0, inputTokens: 0, outputTokens: 0 };
    byVariant[v].tasks += 1;
    byVariant[v].inputTokens += inputTok;
    byVariant[v].outputTokens += outTok;
  }

  return {
    tasks: tasks.length,
    models: 0,
    plannedCalls: 0,
    totalsPerTask,
    totalInputTokens: totalInput,
    totalOutputTokens: totalOutput,
    byVariant,
  };
}

function parsePricingNumber(x: unknown): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function extractPricingMap(
  modelsResponse: unknown,
  wantedModelIds: string[],
): Record<string, ModelPricing> {
  const root = modelsResponse as any;
  const data = root?.data;
  if (!Array.isArray(data)) {
    throw new Error(`Unexpected /models response: missing "data" array`);
  }

  const wanted = new Set(wantedModelIds);
  const out: Record<string, ModelPricing> = {};

  for (const m of data) {
    const id = String((m as any)?.id ?? "");
    if (!wanted.has(id)) continue;
    const pricing = (m as any)?.pricing ?? {};
    const prompt = parsePricingNumber(pricing.prompt);
    const completion = parsePricingNumber(pricing.completion);
    const request = parsePricingNumber(pricing.request);

    if (prompt === null || completion === null) {
      throw new Error(`Missing pricing.prompt or pricing.completion for model: ${id}`);
    }

    out[id] = { prompt, completion, request: request ?? 0 };
  }

  // Ensure all were found
  for (const id of wantedModelIds) {
    if (!out[id]) throw new Error(`Model not found in /models pricing list: ${id}`);
  }

  return out;
}

export async function fetchPricingFromOpenRouter(
  client: OpenRouterClient,
  modelIds: string[],
): Promise<Record<string, ModelPricing>> {
  const resp = await client.listModels();
  return extractPricingMap(resp, modelIds);
}

export type CostEstimate = {
  modelId: string;
  modelLabel: string;
  promptTokens: number;
  completionTokens: number;
  requestCount: number;
  pricing: ModelPricing;
  estimatedUsd: number;
};

export function estimateCost(
  models: ModelSpec[],
  tokenTotals: { totalInputTokens: number; totalOutputTokens: number; tasks: number },
  pricingByModel: Record<string, ModelPricing>,
): { perModel: CostEstimate[]; totalUsd: number } {
  const perModel: CostEstimate[] = [];
  let totalUsd = 0;

  for (const m of models) {
    const p = pricingByModel[m.id];
    const promptTokens = tokenTotals.totalInputTokens;
    const completionTokens = tokenTotals.totalOutputTokens;
    const requestCount = tokenTotals.tasks;

    const usd = promptTokens * p.prompt + completionTokens * p.completion +
      requestCount * (p.request ?? 0);
    perModel.push({
      modelId: m.id,
      modelLabel: m.label ?? m.id,
      promptTokens,
      completionTokens,
      requestCount,
      pricing: p,
      estimatedUsd: usd,
    });
    totalUsd += usd;
  }

  return { perModel, totalUsd };
}
