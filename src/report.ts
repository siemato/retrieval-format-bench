import { ensureDir } from "@std/fs/ensure-dir";
import { join } from "@std/path/join";
import { AttemptResult, RunResult } from "./types.ts";
import { mean, median, percentile } from "./utils/stats.ts";

function groupBy<T, K extends string>(xs: T[], keyFn: (x: T) => K): Record<K, T[]> {
  const out = {} as Record<K, T[]>;
  for (const x of xs) {
    const k = keyFn(x);
    (out[k] ??= []).push(x);
  }
  return out;
}

function fmtNum(n: number, digits = 2): string {
  if (!Number.isFinite(n)) return "n/a";
  return n.toFixed(digits);
}

function sum(nums: Array<number | undefined>): number {
  let s = 0;
  for (const n of nums) if (typeof n === "number" && Number.isFinite(n)) s += n;
  return s;
}

function safeRatio(a: number, b: number): number {
  if (b === 0) return NaN;
  return a / b;
}

type TaskIdentity = { caseId?: string; variant?: string; questionId?: string };

function parseTaskId(
  taskId: string,
): { caseId: string; variant: string; questionId: string } | null {
  const parts = taskId.split(".");
  if (parts.length < 3) return null;
  const questionId = parts[parts.length - 1];
  const variant = parts[parts.length - 2];
  const caseId = parts.slice(0, parts.length - 2).join(".");
  if (!caseId || !variant || !questionId) return null;
  return { caseId, variant, questionId };
}

function parseIdentityFromTags(tags?: string[]): TaskIdentity {
  if (!Array.isArray(tags) || tags.length === 0) return {};

  let caseId: string | undefined;
  let variant: string | undefined;
  let questionId: string | undefined;
  for (const tag of tags) {
    if (tag.startsWith("case:")) caseId = tag.slice("case:".length).trim() || undefined;
    if (tag.startsWith("variant:")) variant = tag.slice("variant:".length).trim() || undefined;
    if (tag.startsWith("question:")) questionId = tag.slice("question:".length).trim() || undefined;
  }
  return { caseId, variant, questionId };
}

function buildTaskIdentityLookup(run: RunResult): Record<string, TaskIdentity> {
  const byTaskId: Record<string, TaskIdentity> = {};
  for (const t of run.tasks) {
    const byTags = parseIdentityFromTags(t.tags);
    const parsed = parseTaskId(t.id) ?? undefined;
    byTaskId[t.id] = {
      caseId: byTags.caseId ?? parsed?.caseId,
      variant: byTags.variant ?? parsed?.variant,
      questionId: byTags.questionId ?? parsed?.questionId,
    };
  }
  return byTaskId;
}

type VariantAgg = { calls: number; promptTok: number; outputTok: number; totalTok: number };

function fmtDeltaPct(deltaPct: number): string {
  if (!Number.isFinite(deltaPct)) return "n/a";
  return `${deltaPct >= 0 ? "+" : ""}${deltaPct.toFixed(1)}%`;
}

function sparkBar(value: number, maxValue: number, width = 20): string {
  if (!Number.isFinite(value) || !Number.isFinite(maxValue) || maxValue <= 0) {
    return "".padEnd(width, "░");
  }
  const n = Math.max(0, Math.min(width, Math.round((value / maxValue) * width)));
  return "█".repeat(n) + "░".repeat(Math.max(0, width - n));
}

function pickJsonBaseline(byVariant: Record<string, VariantAgg>): string | null {
  if (byVariant["json"]) return "json";
  if (byVariant["json_pretty"]) return "json_pretty";
  if (byVariant["json_min"]) return "json_min";
  if (byVariant["json_compact"]) return "json_compact";
  return null;
}

function renderVariantEfficiency(
  lines: string[],
  run: RunResult,
  modelIds: string[],
  byModel: Record<string, AttemptResult[]>,
) {
  lines.push(`## Token Efficiency vs JSON`);
  lines.push(``);
  lines.push(
    `(Using prompt tokens as primary context-size signal, with output/total shown for reference.)`,
  );
  lines.push(``);

  const taskIdentity = buildTaskIdentityLookup(run);

  for (const modelId of modelIds) {
    const label = run.models.find((m) => m.id === modelId)?.label ?? modelId;
    const xs = byModel[modelId] as AttemptResult[];
    const okXs = xs.filter((x) => x.ok);

    const byVariant: Record<string, VariantAgg> = {};
    const byCaseVariant: Record<string, Record<string, VariantAgg>> = {};

    for (const a of okXs) {
      const parsed = taskIdentity[a.taskId] ?? {};
      if (!parsed.variant) continue;
      const promptTok = a.usage?.prompt_tokens ?? 0;
      const outputTok = a.usage?.completion_tokens ?? 0;
      const totalTok = a.usage?.total_tokens ?? (promptTok + outputTok);

      byVariant[parsed.variant] ??= { calls: 0, promptTok: 0, outputTok: 0, totalTok: 0 };
      byVariant[parsed.variant].calls += 1;
      byVariant[parsed.variant].promptTok += promptTok;
      byVariant[parsed.variant].outputTok += outputTok;
      byVariant[parsed.variant].totalTok += totalTok;

      if (parsed.caseId) {
        byCaseVariant[parsed.caseId] ??= {};
        byCaseVariant[parsed.caseId][parsed.variant] ??= {
          calls: 0,
          promptTok: 0,
          outputTok: 0,
          totalTok: 0,
        };
        byCaseVariant[parsed.caseId][parsed.variant].calls += 1;
        byCaseVariant[parsed.caseId][parsed.variant].promptTok += promptTok;
        byCaseVariant[parsed.caseId][parsed.variant].outputTok += outputTok;
        byCaseVariant[parsed.caseId][parsed.variant].totalTok += totalTok;
      }
    }

    const baselineVariant = pickJsonBaseline(byVariant);
    const jsonBase = baselineVariant ? byVariant[baselineVariant]?.promptTok : undefined;
    lines.push(`### ${label}`);
    lines.push(``);
    lines.push(`| Variant | Calls | Prompt tok | Output tok | Total tok | vs JSON (prompt) |`);
    lines.push(`|---|---:|---:|---:|---:|---:|`);

    const variants = Object.keys(byVariant).sort((a, b) => a.localeCompare(b));
    if (variants.includes("json")) {
      variants.splice(variants.indexOf("json"), 1);
      variants.unshift("json");
    }

    for (const v of variants) {
      const agg = byVariant[v];
      const deltaPct = jsonBase && jsonBase > 0
        ? ((agg.promptTok - jsonBase) / jsonBase) * 100
        : NaN;
      const deltaTxt = v === baselineVariant ? "baseline" : `${fmtNum(deltaPct, 1)}%`;
      lines.push(
        `| ${v} | ${agg.calls} | ${fmtNum(agg.promptTok, 0)} | ${fmtNum(agg.outputTok, 0)} | ${
          fmtNum(agg.totalTok, 0)
        } | ${deltaTxt} |`,
      );
    }

    if (!jsonBase || jsonBase <= 0) {
      lines.push(``);
      lines.push(`No JSON-like baseline found for this model; relative efficiency omitted.`);
      lines.push(``);
      continue;
    }
    if (baselineVariant !== "json") {
      lines.push(``);
      lines.push(
        `Using \`${baselineVariant}\` as JSON baseline for relative efficiency in this model.`,
      );
    }

    lines.push(``);
    lines.push(`Per-case prompt token efficiency vs \`json\` baseline:`);
    lines.push(``);
    lines.push(`| Case | Variant | Prompt tok | vs JSON (prompt) |`);
    lines.push(`|---|---|---:|---:|`);

    const caseIds = Object.keys(byCaseVariant).sort((a, b) => a.localeCompare(b));
    for (const caseId of caseIds) {
      const byVar = byCaseVariant[caseId];
      const caseBaselineVariant = pickJsonBaseline(byVar);
      const caseJson = caseBaselineVariant ? byVar[caseBaselineVariant]?.promptTok : undefined;
      if (!caseJson || caseJson <= 0) continue;

      const caseVariants = Object.keys(byVar).sort((a, b) => a.localeCompare(b));
      if (caseVariants.includes("json")) {
        caseVariants.splice(caseVariants.indexOf("json"), 1);
        caseVariants.unshift("json");
      }
      for (const v of caseVariants) {
        const agg = byVar[v];
        const deltaPct = v === caseBaselineVariant
          ? 0
          : ((agg.promptTok - caseJson) / caseJson) * 100;
        const deltaTxt = v === caseBaselineVariant ? "baseline" : `${fmtNum(deltaPct, 1)}%`;
        lines.push(`| ${caseId} | ${v} | ${fmtNum(agg.promptTok, 0)} | ${deltaTxt} |`);
      }
    }

    lines.push(``);
    lines.push(`Prompt-token diagram (json baseline):`);
    lines.push(``);
    lines.push("```text");
    const maxPrompt = Math.max(...Object.values(byVariant).map((x) => x.promptTok));
    for (const v of variants) {
      const agg = byVariant[v];
      const label = v === "json_cddl" ? "json_cddl (keyless)" : v;
      const deltaPct = v === baselineVariant ? 0 : ((agg.promptTok - jsonBase) / jsonBase) * 100;
      const deltaTxt = v === baselineVariant ? "baseline" : fmtDeltaPct(deltaPct);
      const line = `${label.padEnd(22)} ${sparkBar(agg.promptTok, maxPrompt)}  ${
        fmtNum(agg.promptTok, 0).padStart(8)
      }  ${deltaTxt}`;
      lines.push(line);
    }
    lines.push("```");

    lines.push(``);
  }
}

export function renderMarkdownReport(run: RunResult): string {
  const parseFormat = (taskId: string): string => {
    const parts = taskId.split(".");
    return parts.length >= 3 ? parts[parts.length - 2] : "unknown";
  };

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
  const byModel = groupBy(run.attempts, (a) => a.modelId);

  const lines: string[] = [];
  lines.push(`# Benchmark report`);
  lines.push(``);
  lines.push(`- Run ID: \`${run.runId}\``);
  lines.push(`- Started: ${run.startedAt}`);
  lines.push(`- Ended: ${run.endedAt}`);
  lines.push(`- Base URL: ${run.openrouterBaseUrl}`);
  lines.push(`- Models: ${run.models.length}`);
  lines.push(`- Tasks: ${run.tasks.length}`);
  lines.push(`- Attempts: ${totalAttempts}`);
  lines.push(
    `- Overall accuracy: ${fmtNum((totalCorrect / Math.max(1, totalAttempts)) * 100, 2)}%`,
  );
  lines.push(``);

  lines.push(`## Accuracy Matrix`);
  lines.push(``);
  lines.push(`| Model | ${formats.join(" | ")} | Overall |`);
  lines.push(`|---|${formats.map(() => "---:").join("|")}|---:|`);
  for (const m of run.models) {
    const xs = byModel[m.id] ?? [];
    const cells = formats.map((f) => {
      const ys = xs.filter((a) => parseFormat(a.taskId) === f);
      const correct = ys.filter((a) => a.score?.correct === true).length;
      return ys.length === 0
        ? "-"
        : `${fmtNum((correct / ys.length) * 100, 2)}% (${correct}/${ys.length})`;
    });
    const correctAll = xs.filter((a) => a.score?.correct === true).length;
    const overall = xs.length === 0
      ? "-"
      : `${fmtNum((correctAll / xs.length) * 100, 2)}% (${correctAll}/${xs.length})`;
    lines.push(`| ${m.label ?? m.id} | ${cells.join(" | ")} | ${overall} |`);
  }
  const totalCells = formats.map((f) => {
    const xs = run.attempts.filter((a) => parseFormat(a.taskId) === f);
    const correct = xs.filter((a) => a.score?.correct === true).length;
    return `**${
      xs.length === 0 ? "-" : `${fmtNum((correct / xs.length) * 100, 2)}% (${correct}/${xs.length})`
    }**`;
  });
  lines.push(
    `| **Total** | ${totalCells.join(" | ")} | **${
      fmtNum((totalCorrect / Math.max(1, totalAttempts)) * 100, 2)
    }% (${totalCorrect}/${totalAttempts})** |`,
  );
  lines.push(``);

  lines.push(`## Dataset Tokens (Prompt)`);
  lines.push(``);
  lines.push(`| Model | ${formats.join(" | ")} | Overall |`);
  lines.push(`|---|${formats.map(() => "---:").join("|")}|---:|`);
  for (const m of run.models) {
    const xs = byModel[m.id] ?? [];
    const cells = formats.map((f) => {
      const ys = xs.filter((a) => parseFormat(a.taskId) === f);
      const n = sum(ys.map((a) => a.usage?.prompt_tokens));
      return fmtNum(n, 0);
    });
    const all = sum(xs.map((a) => a.usage?.prompt_tokens));
    lines.push(`| ${m.label ?? m.id} | ${cells.join(" | ")} | ${fmtNum(all, 0)} |`);
  }
  const totalPromptCells = formats.map((f) => {
    const xs = run.attempts.filter((a) => parseFormat(a.taskId) === f);
    return `**${fmtNum(sum(xs.map((a) => a.usage?.prompt_tokens)), 0)}**`;
  });
  lines.push(
    `| **Total** | ${totalPromptCells.join(" | ")} | **${
      fmtNum(sum(run.attempts.map((a) => a.usage?.prompt_tokens)), 0)
    }** |`,
  );
  lines.push(``);

  lines.push(`## Ingress Price (Prompt Cost)`);
  lines.push(``);
  lines.push(`| Model | ${formats.join(" | ")} | Overall |`);
  lines.push(`|---|${formats.map(() => "---:").join("|")}|---:|`);
  for (const m of run.models) {
    const xs = byModel[m.id] ?? [];
    const cells = formats.map((f) => {
      const ys = xs.filter((a) => parseFormat(a.taskId) === f);
      const n = ys.reduce(
        (s, a) => s + (Number(a.usage?.cost_details?.upstream_inference_prompt_cost) || 0),
        0,
      );
      return fmtNum(n, 6);
    });
    const all = xs.reduce(
      (s, a) => s + (Number(a.usage?.cost_details?.upstream_inference_prompt_cost) || 0),
      0,
    );
    lines.push(`| ${m.label ?? m.id} | ${cells.join(" | ")} | ${fmtNum(all, 6)} |`);
  }
  const totalIngressCells = formats.map((f) => {
    const xs = run.attempts.filter((a) => parseFormat(a.taskId) === f);
    const n = xs.reduce(
      (s, a) => s + (Number(a.usage?.cost_details?.upstream_inference_prompt_cost) || 0),
      0,
    );
    return `**${fmtNum(n, 6)}**`;
  });
  const totalIngress = run.attempts.reduce(
    (s, a) => s + (Number(a.usage?.cost_details?.upstream_inference_prompt_cost) || 0),
    0,
  );
  lines.push(`| **Total** | ${totalIngressCells.join(" | ")} | **${fmtNum(totalIngress, 6)}** |`);
  lines.push(``);

  lines.push(`## Coverage`);
  lines.push(``);
  lines.push(`| Model | ${formats.join(" | ")} |`);
  lines.push(`|---|${formats.map(() => "---:").join("|")}|`);
  for (const m of run.models) {
    const xs = byModel[m.id] ?? [];
    const cells = formats.map((f) => {
      const got = xs.filter((a) => parseFormat(a.taskId) === f).length;
      const expected = tasksByFormat[f] ?? 0;
      return `${got}/${expected}`;
    });
    lines.push(`| ${m.label ?? m.id} | ${cells.join(" | ")} |`);
  }

  return lines.join("\n") + "\n";
}

export async function writeMarkdownReport(run: RunResult, outDir: string): Promise<string> {
  await ensureDir(outDir);
  const md = renderMarkdownReport(run);
  const p = join(outDir, `${run.runId}.report.md`);
  await Deno.writeTextFile(p, md);
  await Deno.writeTextFile(join(outDir, "latest.report.md"), md);
  return p;
}
