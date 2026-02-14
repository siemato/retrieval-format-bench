import { readEnvConfigOptional } from "../../config.ts";
import {
  estimateCost,
  estimateTokensForTasks,
  extractPricingMap,
  fetchPricingFromOpenRouter,
} from "../../estimate.ts";
import { OpenRouterClient } from "../../openrouter.ts";
import { parseCommandArgs, parseOptionalPositiveNumber } from "../args.ts";
import { buildExecutionPlan, renderPreflight } from "../planning.ts";
import { usage } from "../usage.ts";

const ESTIMATE_ALLOWED = new Set([
  "models",
  "suite",
  "tasks",
  "format",
  "output-tokens",
  "cache",
  "help",
]);

export async function cmdEstimate(args: string[]) {
  const parsed = parseCommandArgs(
    args,
    {
      string: ["models", "suite", "tasks", "output-tokens", "cache", "format"],
      boolean: ["help"],
      default: {
        models: "configs/models.json",
        suite: "",
        tasks: "",
        cache: "cache/openrouter.models.json",
        "output-tokens": "",
      },
    },
    ESTIMATE_ALLOWED,
  );

  if (parsed.help) {
    console.log(usage());
    return;
  }

  const plan = await buildExecutionPlan({
    modelsPath: String(parsed.models),
    suitePath: String(parsed.suite ?? ""),
    tasksPath: String(parsed.tasks ?? ""),
    format: String(parsed.format ?? ""),
    commandName: "estimate",
  });

  const outTok = parseOptionalPositiveNumber(parsed["output-tokens"], "--output-tokens");
  const tokenEst = estimateTokensForTasks(plan.tasks, { outputTokensPerCall: outTok });

  const env = readEnvConfigOptional();
  const modelIds = plan.models.map((m) => m.id);

  let pricingByModel: Record<string, { prompt: number; completion: number; request?: number }>;
  if (env.apiKey) {
    const client = new OpenRouterClient({
      apiKey: env.apiKey,
      baseUrl: env.baseUrl,
      httpReferer: env.httpReferer,
      xTitle: env.xTitle,
      timeoutMs: env.timeoutMs,
    });
    pricingByModel = await fetchPricingFromOpenRouter(client, modelIds);
  } else {
    const cachePath = String(parsed.cache);
    const txt = await Deno.readTextFile(cachePath);
    pricingByModel = extractPricingMap(JSON.parse(txt), modelIds);
  }

  const { perModel, totalUsd } = estimateCost(plan.models, {
    totalInputTokens: tokenEst.totalInputTokens,
    totalOutputTokens: tokenEst.totalOutputTokens,
    tasks: plan.tasks.length,
  }, pricingByModel);

  console.log(`Token estimation (heuristic): ~4 chars/token`);
  for (const line of renderPreflight(plan)) console.log(line);
  console.log(``);
  console.log(`Estimated tokens per model (same tasks replicated per model):`);
  console.log(`- Prompt tokens:    ${tokenEst.totalInputTokens}`);
  console.log(
    `- Completion tokens: ${tokenEst.totalOutputTokens}${outTok ? ` (forced ${outTok}/call)` : ""}`,
  );
  console.log(``);

  console.log(`Estimated cost by model (USD):`);
  for (const r of perModel) {
    console.log(
      `- ${r.modelLabel}: $${r.estimatedUsd.toFixed(4)} (prompt $${
        (r.pricing.prompt * 1_000_000).toFixed(2)
      }/M, completion $${(r.pricing.completion * 1_000_000).toFixed(2)}/M)`,
    );
  }
  console.log(``);
  console.log(`Total estimated cost (all models): $${totalUsd.toFixed(4)}`);

  if (tokenEst.byVariant) {
    const variants = Object.keys(tokenEst.byVariant).sort((a, b) => a.localeCompare(b));
    console.log(``);
    console.log(`Estimated prompt token share by variant (per model):`);
    for (const v of variants) {
      const x = tokenEst.byVariant[v];
      console.log(`- ${v}: ${x.tasks} tasks, ~${x.inputTokens} prompt tokens`);
    }
  }
}
