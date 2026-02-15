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

Deno.test("buildExecutionPlan filters by explicit task IDs", async () => {
  const ids = [
    "tabular-employees.csv.email_id_42",
    "tabular-employees.csv.dept_name_13",
  ];
  const plan = await buildExecutionPlan({
    modelsPath: "configs/models.json",
    suitePath: "suites/formats.suite.json",
    tasksPath: "",
    taskIds: ids,
    commandName: "bench",
  });

  assertEquals(plan.tasks.map((t) => t.id), ids);
  assertEquals(plan.plannedCalls, plan.models.length * ids.length);
});

Deno.test("buildExecutionPlan errors on missing explicit task IDs", async () => {
  await assertRejects(
    () =>
      buildExecutionPlan({
        modelsPath: "configs/models.json",
        suitePath: "suites/formats.suite.json",
        tasksPath: "",
        taskIds: ["does.not.exist"],
        commandName: "bench",
      }),
    CliUsageError,
    "Requested task IDs not found",
  );
});
