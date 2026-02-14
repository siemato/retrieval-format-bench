import { assertEquals } from "@std/assert";
import { OpenRouterClient } from "./openrouter.ts";
import { runBenchmark } from "./runner.ts";
import { ModelSpec, Task } from "./types.ts";

class FakeClient {
  readonly baseUrl = "https://example.invalid";

  async chatCompletion(_model: string, messages: Array<{ content: string }>) {
    const txt = messages[0]?.content ?? "";
    const sleep = txt.includes("slow") ? 20 : 1;
    await new Promise((r) => setTimeout(r, sleep));
    return {
      choices: [{ message: { content: "ok" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    };
  }
}

Deno.test("runBenchmark keeps deterministic attempt order and writes latest on completion", async () => {
  const models: ModelSpec[] = [{ id: "m1" }, { id: "m2" }];
  const tasks: Task[] = [
    {
      id: "c1.json.q1",
      prompt: "slow prompt",
      expected: "ok",
      tags: ["variant:json", "case:c1", "question:q1"],
    },
    {
      id: "c1.yaml.q1",
      prompt: "fast prompt",
      expected: "ok",
      tags: ["variant:yaml", "case:c1", "question:q1"],
    },
  ];

  const outDir = await Deno.makeTempDir();
  const { run, runPath, completed, aborted } = await runBenchmark(models, tasks, {
    outDir,
    concurrency: 2,
    client: new FakeClient() as unknown as OpenRouterClient,
  });

  assertEquals(completed, true);
  assertEquals(aborted, false);
  assertEquals(run.attempts.length, 4);
  assertEquals(run.attempts.map((a) => `${a.modelId}:${a.taskId}`), [
    "m1:c1.json.q1",
    "m1:c1.yaml.q1",
    "m2:c1.json.q1",
    "m2:c1.yaml.q1",
  ]);

  const latest = await Deno.readTextFile(`${outDir}/latest.json`);
  const parsedLatest = JSON.parse(latest);
  assertEquals(parsedLatest.runId, run.runId);

  const runRaw = await Deno.readTextFile(runPath);
  const parsedRun = JSON.parse(runRaw);
  assertEquals(parsedRun.runId, run.runId);
});
