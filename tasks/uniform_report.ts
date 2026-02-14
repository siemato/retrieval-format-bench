import { parseArgs } from "@std/cli/parse-args";
import { dirname, join } from "@std/path";
import { ensureDir } from "@std/fs/ensure-dir";
import { RunResult } from "../src/types.ts";

type ModelRow = {
  id: string;
  label: string;
};

function usage(): string {
  return [
    "uniform_report",
    "",
    "Generate a uniform model x format accuracy report from a run JSON.",
    "",
    "Flags:",
    "  --run <path>   Path to run JSON (required)",
    "  --out <path>   Output markdown path (optional)",
    "",
    "Example:",
    "  deno run --allow-read --allow-write tasks/uniform_report.ts --run runs/final.json",
  ].join("\n");
}

function parseFormat(taskId: string): string {
  const parts = taskId.split(".");
  if (parts.length < 3) return "unknown";
  return parts[parts.length - 2];
}

function pct(correct: number, total: number): number {
  if (total <= 0) return 0;
  return (correct / total) * 100;
}

function formatPct(correct: number, total: number): string {
  if (total <= 0) return "-";
  return `${pct(correct, total).toFixed(2)}% (${correct}/${total})`;
}

function inferDefaultOut(runPath: string): string {
  if (runPath.endsWith(".json")) return runPath.slice(0, -".json".length) + ".uniform.md";
  return runPath + ".uniform.md";
}

function render(run: RunResult): string {
  const models: ModelRow[] = run.models.map((m) => ({ id: m.id, label: m.label ?? m.id }));
  const formats = Array.from(new Set(run.tasks.map((t) => parseFormat(t.id)))).sort((a, b) =>
    a.localeCompare(b)
  );

  const tasksByFormat: Record<string, number> = {};
  for (const t of run.tasks) {
    const f = parseFormat(t.id);
    tasksByFormat[f] = (tasksByFormat[f] ?? 0) + 1;
  }

  const totalAttempts = run.attempts.length;
  const totalCorrect = run.attempts.filter((a) => a.score?.correct === true).length;

  const lines: string[] = [];
  lines.push("# Uniform Accuracy Report");
  lines.push("");
  lines.push(`- Run ID: \`${run.runId}\``);
  lines.push(`- Models: \`${models.length}\``);
  lines.push(`- Tasks: \`${run.tasks.length}\``);
  lines.push(`- Attempts: \`${totalAttempts}\``);
  lines.push(`- Overall accuracy: \`${formatPct(totalCorrect, totalAttempts)}\``);
  lines.push("");

  lines.push("## Accuracy Matrix");
  lines.push("");
  lines.push(`| Model | ${formats.join(" | ")} | Overall |`);
  lines.push(`|---|${formats.map(() => "---:").join("|")}|---:|`);

  for (const m of models) {
    const attempts = run.attempts.filter((a) => a.modelId === m.id);
    const rowCells: string[] = [];
    for (const f of formats) {
      const xs = attempts.filter((a) => parseFormat(a.taskId) === f);
      const c = xs.filter((a) => a.score?.correct === true).length;
      rowCells.push(formatPct(c, xs.length));
    }
    const correct = attempts.filter((a) => a.score?.correct === true).length;
    lines.push(`| ${m.label} | ${rowCells.join(" | ")} | ${formatPct(correct, attempts.length)} |`);
  }

  const overallRowCells: string[] = [];
  for (const f of formats) {
    const xs = run.attempts.filter((a) => parseFormat(a.taskId) === f);
    const c = xs.filter((a) => a.score?.correct === true).length;
    overallRowCells.push(formatPct(c, xs.length));
  }
  lines.push(
    `| **Total** | ${overallRowCells.map((x) => `**${x}**`).join(" | ")} | **${
      formatPct(totalCorrect, totalAttempts)
    }** |`,
  );
  lines.push("");

  lines.push("## Coverage");
  lines.push("");
  lines.push(`| Model | ${formats.join(" | ")} |`);
  lines.push(`|---|${formats.map(() => "---:").join("|")}|`);
  for (const m of models) {
    const attempts = run.attempts.filter((a) => a.modelId === m.id);
    const rowCells: string[] = [];
    for (const f of formats) {
      const got = attempts.filter((a) => parseFormat(a.taskId) === f).length;
      const expected = tasksByFormat[f] ?? 0;
      rowCells.push(`${got}/${expected}`);
    }
    lines.push(`| ${m.label} | ${rowCells.join(" | ")} |`);
  }

  lines.push("");
  lines.push("## Dataset Tokens (Prompt)");
  lines.push("");
  lines.push("| Model | " + formats.join(" | ") + " | Overall |");
  lines.push("|---|" + formats.map(() => "---:").join("|") + "|---:|");
  for (const m of models) {
    const attempts = run.attempts.filter((a) => a.modelId === m.id);
    const rowCells: string[] = [];
    for (const f of formats) {
      const xs = attempts.filter((a) => parseFormat(a.taskId) === f);
      const totalPrompt = xs.reduce((s, a) => s + (a.usage?.prompt_tokens ?? 0), 0);
      rowCells.push(totalPrompt.toString());
    }
    const totalPromptAll = attempts.reduce((s, a) => s + (a.usage?.prompt_tokens ?? 0), 0);
    lines.push(`| ${m.label} | ${rowCells.join(" | ")} | ${totalPromptAll} |`);
  }
  const totalPromptByFormat: string[] = [];
  for (const f of formats) {
    const xs = run.attempts.filter((a) => parseFormat(a.taskId) === f);
    const totalPrompt = xs.reduce((s, a) => s + (a.usage?.prompt_tokens ?? 0), 0);
    totalPromptByFormat.push(`**${totalPrompt}**`);
  }
  const totalPromptAll = run.attempts.reduce((s, a) => s + (a.usage?.prompt_tokens ?? 0), 0);
  lines.push(`| **Total** | ${totalPromptByFormat.join(" | ")} | **${totalPromptAll}** |`);

  lines.push("");
  lines.push("## Ingress Price (Prompt Cost)");
  lines.push("");
  lines.push("| Model | " + formats.join(" | ") + " | Overall |");
  lines.push("|---|" + formats.map(() => "---:").join("|") + "|---:|");
  for (const m of models) {
    const attempts = run.attempts.filter((a) => a.modelId === m.id);
    const rowCells: string[] = [];
    for (const f of formats) {
      const xs = attempts.filter((a) => parseFormat(a.taskId) === f);
      const promptCost = xs.reduce(
        (s, a) => s + (a.usage?.cost_details?.upstream_inference_prompt_cost as number ?? 0),
        0,
      );
      rowCells.push(promptCost.toFixed(6));
    }
    const promptCostAll = attempts.reduce(
      (s, a) => s + (a.usage?.cost_details?.upstream_inference_prompt_cost as number ?? 0),
      0,
    );
    lines.push(`| ${m.label} | ${rowCells.join(" | ")} | ${promptCostAll.toFixed(6)} |`);
  }
  const totalIngressByFormat: string[] = [];
  for (const f of formats) {
    const xs = run.attempts.filter((a) => parseFormat(a.taskId) === f);
    const promptCost = xs.reduce(
      (s, a) => s + (a.usage?.cost_details?.upstream_inference_prompt_cost as number ?? 0),
      0,
    );
    totalIngressByFormat.push(`**${promptCost.toFixed(6)}**`);
  }
  const totalIngressAll = run.attempts.reduce(
    (s, a) => s + (a.usage?.cost_details?.upstream_inference_prompt_cost as number ?? 0),
    0,
  );
  lines.push(
    `| **Total** | ${totalIngressByFormat.join(" | ")} | **${totalIngressAll.toFixed(6)}** |`,
  );

  return lines.join("\n") + "\n";
}

if (import.meta.main) {
  const normalizedArgs = Deno.args.filter((a, i) => !(i === 0 && a === "--"));
  const args = parseArgs(normalizedArgs, {
    string: ["run", "out"],
    boolean: ["help"],
    alias: { h: "help" },
  });

  if (args.help) {
    console.log(usage());
    Deno.exit(0);
  }

  const runPath = String(args.run ?? "");
  if (!runPath) {
    console.error("Missing required flag: --run <path>\n");
    console.error(usage());
    Deno.exit(2);
  }

  const outPath = String(args.out ?? inferDefaultOut(runPath));
  const raw = await Deno.readTextFile(runPath);
  const run = JSON.parse(raw) as RunResult;
  const md = render(run);

  await ensureDir(dirname(outPath));
  await Deno.writeTextFile(outPath, md);
  console.log(`Uniform report: ${outPath}`);
}
