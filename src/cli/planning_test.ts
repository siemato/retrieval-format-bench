import { assert, assertEquals, assertRejects } from "@std/assert";
import { buildExecutionPlan, resolveInput, taskVariant } from "./planning.ts";
import { CliUsageError } from "./errors.ts";

Deno.test("resolveInput rejects both suite and tasks", async () => {
  await assertRejects(
    () => resolveInput("suites/formats.suite.json", "tasks/sample.jsonl", "bench"),
    CliUsageError,
    "Provide either --suite or --tasks, not both.",
  );
});

Deno.test("buildExecutionPlan filters a single format deterministically", async () => {
  const plan = await buildExecutionPlan({
    modelsPath: "configs/models.json",
    suitePath: "suites/formats.suite.json",
    tasksPath: "",
    format: "json_cddl",
    commandName: "bench",
  });

  assertEquals(plan.tasks.length, 48);
  assertEquals(plan.plannedCalls, plan.models.length * 48);
  assert(plan.tasks.every((t) => taskVariant(t) === "json_cddl"));
});
