import { ensureDir } from "@std/fs/ensure-dir";
import { join } from "@std/path/join";
import { AttemptResult, ModelSpec, RunResult, Task } from "./types.ts";
import { OpenRouterClient } from "./openrouter.ts";
import { scoreOutput } from "./scoring.ts";

export interface RunOptions {
  outDir: string;
  concurrency: number;
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  storeFullText?: boolean;
  maxChars?: number;
  client: OpenRouterClient;
}

function isoNow(): string {
  return new Date().toISOString();
}

function truncate(s: string, maxChars: number): string {
  if (s.length <= maxChars) return s;
  return s.slice(0, maxChars) + `... (truncated, ${s.length} chars total)`;
}

type WorkItem = {
  index: number;
  model: ModelSpec;
  task: Task;
};

export async function runBenchmark(
  models: ModelSpec[],
  tasks: Task[],
  options: RunOptions,
): Promise<{ run: RunResult; runPath: string; completed: boolean; aborted: boolean }> {
  const startedAt = isoNow();
  const runId = `${startedAt.replaceAll(":", "-")}_${crypto.randomUUID().slice(0, 8)}`;

  await ensureDir(options.outDir);

  const maxChars = options.maxChars ?? 4000;
  const storeFullText = options.storeFullText ?? false;

  const work: WorkItem[] = [];
  let idx = 0;
  for (const model of models) {
    for (const task of tasks) {
      work.push({ index: idx++, model, task });
    }
  }

  const planned = work.length;
  let done = 0;
  let next = 0;
  let aborted = false;
  const attemptsByIndex: Array<AttemptResult | undefined> = new Array(planned);

  const stop = () => {
    aborted = true;
  };

  const canListenSignals = typeof Deno.addSignalListener === "function";
  if (canListenSignals) {
    Deno.addSignalListener("SIGINT", stop);
    Deno.addSignalListener("SIGTERM", stop);
  }

  const logProgress = () => {
    if (planned === 0) return;
    const pct = ((done / planned) * 100).toFixed(1);
    if (done % Math.max(1, Math.floor(planned / 50)) === 0 || done === planned) {
      console.log(`[${done}/${planned}] ${pct}%`);
    }
  };

  const workerCount = Math.max(1, Math.min(options.concurrency, planned || 1));

  const worker = async () => {
    while (true) {
      if (aborted) return;
      const i = next;
      next += 1;
      if (i >= work.length) return;

      const w = work[i];
      const attemptStart = Date.now();
      const startedAtTask = isoNow();

      try {
        const messages = w.task.messages ??
          (w.task.prompt ? [{ role: "user" as const, content: w.task.prompt }] : (() => {
            throw new Error(`Task ${w.task.id} must have either messages or prompt`);
          })());

        const resp = await options.client.chatCompletion(w.model.id, messages, {
          temperature: options.temperature,
          maxTokens: options.maxTokens,
          includeReasoning: options.includeReasoning,
        });

        const endedAtTask = isoNow();
        const latencyMs = Date.now() - attemptStart;
        const content = resp.choices?.[0]?.message?.content ?? "";
        const responseText = storeFullText ? content : truncate(content, maxChars);

        attemptsByIndex[w.index] = {
          taskId: w.task.id,
          modelId: w.model.id,
          modelLabel: w.model.label,
          ok: true,
          startedAt: startedAtTask,
          endedAt: endedAtTask,
          latencyMs,
          responseText,
          finishReason: resp.choices?.[0]?.finish_reason ?? null,
          usage: resp.usage,
          expected: w.task.expected,
          score: scoreOutput(content, w.task.expected, w.task.scorer),
        };
      } catch (err) {
        const endedAtTask = isoNow();
        attemptsByIndex[w.index] = {
          taskId: w.task.id,
          modelId: w.model.id,
          modelLabel: w.model.label,
          ok: false,
          startedAt: startedAtTask,
          endedAt: endedAtTask,
          latencyMs: Date.now() - attemptStart,
          error: (err as Error).message,
          expected: w.task.expected,
        };
      } finally {
        done += 1;
        logProgress();
      }
    }
  };

  try {
    const workers = Array.from({ length: workerCount }, () => worker());
    await Promise.all(workers);
  } finally {
    if (canListenSignals) {
      Deno.removeSignalListener("SIGINT", stop);
      Deno.removeSignalListener("SIGTERM", stop);
    }
  }

  const endedAt = isoNow();
  const attempts = attemptsByIndex.filter((x): x is AttemptResult => Boolean(x));
  const completed = !aborted && done === planned;

  const run: RunResult = {
    runId,
    startedAt,
    endedAt,
    openrouterBaseUrl: options.client.baseUrl,
    models,
    temperature: options.temperature,
    maxTokens: options.maxTokens,
    includeReasoning: options.includeReasoning,
    tasks: tasks.map((t) => ({ id: t.id, tags: t.tags })),
    attempts,
  };

  const suffix = completed ? ".json" : ".partial.json";
  const runPath = join(options.outDir, `${runId}${suffix}`);
  await Deno.writeTextFile(runPath, JSON.stringify(run, null, 2) + "\n");

  if (completed) {
    await Deno.writeTextFile(
      join(options.outDir, "latest.json"),
      JSON.stringify(run, null, 2) + "\n",
    );
  }

  return { run, runPath, completed, aborted };
}
