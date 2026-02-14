import { readEnvConfig } from "../../config.ts";
import { OpenRouterClient } from "../../openrouter.ts";
import { writeMarkdownReport } from "../../report.ts";
import { runBenchmark } from "../../runner.ts";
import {
  parseCommandArgs,
  parseOptionalNonNegativeNumber,
  parseOptionalPositiveNumber,
  parsePositiveNumber,
} from "../args.ts";
import { buildExecutionPlan, renderPreflight } from "../planning.ts";
import { usage } from "../usage.ts";

const BENCH_ALLOWED = new Set([
  "models",
  "suite",
  "tasks",
  "out",
  "concurrency",
  "temperature",
  "max-tokens",
  "include-reasoning",
  "store-full-text",
  "max-chars",
  "format",
  "execute",
  "help",
]);

export async function cmdBench(args: string[]) {
  const parsed = parseCommandArgs(
    args,
    {
      string: [
        "models",
        "suite",
        "tasks",
        "out",
        "concurrency",
        "temperature",
        "max-tokens",
        "max-chars",
        "format",
      ],
      boolean: ["include-reasoning", "store-full-text", "execute", "help"],
      default: {
        models: "configs/models.json",
        suite: "",
        tasks: "",
        out: "runs",
        concurrency: "4",
        "store-full-text": false,
        "include-reasoning": false,
        execute: false,
        "max-chars": "4000",
      },
    },
    BENCH_ALLOWED,
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
    commandName: "bench",
  });

  const concurrency = parsePositiveNumber(parsed.concurrency, "--concurrency");
  const temperature = parseOptionalNonNegativeNumber(parsed.temperature, "--temperature");
  const maxTokens = parseOptionalPositiveNumber(parsed["max-tokens"], "--max-tokens");
  const maxChars = parsePositiveNumber(parsed["max-chars"], "--max-chars");

  const outDir = String(parsed.out);
  const includeReasoning = Boolean(parsed["include-reasoning"]);
  const storeFullText = Boolean(parsed["store-full-text"]);
  const execute = Boolean(parsed.execute);

  for (const line of renderPreflight(plan)) console.log(line);

  if (!execute) {
    console.log(`Execution: skipped (preflight only). Use --execute to run model calls.`);
    return;
  }

  const env = readEnvConfig();
  const client = new OpenRouterClient({
    apiKey: env.apiKey,
    baseUrl: env.baseUrl,
    httpReferer: env.httpReferer,
    xTitle: env.xTitle,
    timeoutMs: env.timeoutMs,
  });

  console.log(`Base URL: ${client.baseUrl}`);

  const { run, runPath, completed, aborted } = await runBenchmark(plan.models, plan.tasks, {
    outDir,
    concurrency,
    temperature,
    maxTokens,
    includeReasoning,
    storeFullText,
    maxChars,
    client,
  });

  if (!completed) {
    if (aborted) {
      throw new Error(`Benchmark aborted. Partial run JSON: ${runPath}`);
    }
    throw new Error(`Benchmark did not complete. Partial run JSON: ${runPath}`);
  }

  const reportPath = await writeMarkdownReport(run, outDir);
  console.log(`Run JSON: ${runPath}`);
  console.log(`Report: ${reportPath}`);
}
