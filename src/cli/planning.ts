import { readModelsFile } from "../config.ts";
import { expandSuiteToTasks, readSuite } from "../suite.ts";
import { ModelSpec, Task } from "../types.ts";
import { readJsonlTasks } from "../utils/jsonl.ts";
import { CliUsageError } from "./errors.ts";

export interface ResolvedInput {
  tasks: Task[];
  inputLabel: string;
}

export interface ExecutionPlan {
  models: ModelSpec[];
  tasks: Task[];
  inputLabel: string;
  format?: string;
  plannedCalls: number;
}

function taskVariantFromId(taskId: string): string | undefined {
  const parts = taskId.split(".");
  if (parts.length >= 3 && parts[1]) return parts[1];
  return undefined;
}

export function taskVariant(task: Task): string | undefined {
  const byMeta = task.meta?.variant;
  if (typeof byMeta === "string" && byMeta.trim() !== "") return byMeta;

  if (Array.isArray(task.tags)) {
    const tagged = task.tags.find((t) => t.startsWith("variant:"));
    if (tagged) {
      const v = tagged.slice("variant:".length).trim();
      if (v) return v;
    }
  }

  return taskVariantFromId(task.id);
}

export function availableFormats(tasks: Task[]): string[] {
  return [...new Set(tasks.map(taskVariant).filter((x): x is string => typeof x === "string"))]
    .sort((a, b) => a.localeCompare(b));
}

export function filterTasksByFormat(tasks: Task[], format: string): Task[] {
  const wanted = format.trim().toLowerCase();
  return tasks.filter((t) => taskVariant(t)?.toLowerCase() === wanted);
}

export async function resolveInput(
  suitePath: string,
  tasksPath: string,
  commandName: "bench" | "estimate",
): Promise<ResolvedInput> {
  if (suitePath && tasksPath) {
    throw new CliUsageError("Provide either --suite or --tasks, not both.");
  }

  if (suitePath) {
    const suite = await readSuite(suitePath);
    return {
      tasks: expandSuiteToTasks(suite),
      inputLabel: `suite ${suitePath} (${suite.name})`,
    };
  }

  if (tasksPath) {
    return {
      tasks: await readJsonlTasks(tasksPath),
      inputLabel: `tasks ${tasksPath}`,
    };
  }

  throw new CliUsageError(
    `${commandName} requires one input source: --suite <path> or --tasks <path>`,
  );
}

export async function buildExecutionPlan(opts: {
  modelsPath: string;
  suitePath: string;
  tasksPath: string;
  format?: string;
  taskIds?: string[];
  commandName: "bench" | "estimate";
}): Promise<ExecutionPlan> {
  const models = await readModelsFile(opts.modelsPath);
  const { tasks: resolvedTasks, inputLabel } = await resolveInput(
    opts.suitePath,
    opts.tasksPath,
    opts.commandName,
  );

  const format = (opts.format ?? "").trim();
  let tasks = resolvedTasks;
  if (format) {
    const filtered = filterTasksByFormat(tasks, format);
    if (filtered.length === 0) {
      const formats = availableFormats(tasks);
      throw new CliUsageError(
        `No tasks matched --format "${format}". Available formats: ${
          formats.length > 0 ? formats.join(", ") : "(none detected)"
        }`,
      );
    }
    tasks = filtered;
  }

  const wantedTaskIds = (opts.taskIds ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
  if (wantedTaskIds.length > 0) {
    const byId = new Map(tasks.map((t) => [t.id, t]));
    const selected: Task[] = [];
    const missing: string[] = [];
    const seen = new Set<string>();
    for (const id of wantedTaskIds) {
      if (seen.has(id)) continue;
      seen.add(id);
      const t = byId.get(id);
      if (!t) {
        missing.push(id);
      } else {
        selected.push(t);
      }
    }
    if (missing.length > 0) {
      const sample = missing.slice(0, 8).join(", ");
      const suffix = missing.length > 8 ? ` ... (+${missing.length - 8} more)` : "";
      throw new CliUsageError(`Requested task IDs not found: ${sample}${suffix}`);
    }
    tasks = selected;
  }

  return {
    models,
    tasks,
    inputLabel,
    format: format || undefined,
    plannedCalls: models.length * tasks.length,
  };
}

export function renderPreflight(plan: ExecutionPlan, baseUrl?: string): string[] {
  const lines = [
    `Models: ${plan.models.length}`,
    `Input: ${plan.inputLabel}`,
    `Tasks: ${plan.tasks.length}`,
  ];
  if (plan.format) lines.push(`Format: ${plan.format}`);
  lines.push(`Planned calls: ${plan.plannedCalls}`);
  if (baseUrl) lines.push(`Base URL: ${baseUrl}`);
  return lines;
}
