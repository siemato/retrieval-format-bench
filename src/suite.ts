import { Suite, Task, VariantSpec } from "./types.ts";
import { renderVariant } from "./variants.ts";

function applyTemplate(template: string, vars: Record<string, string>): string {
  let out = template;
  for (const [k, v] of Object.entries(vars)) {
    out = out.replaceAll(`{{${k}}}`, v);
  }
  return out;
}

function resolveFormatPreamble(
  suite: Suite,
  c: Suite["cases"][number],
  variantName: string,
): string {
  const casePreamble = c.formatPreambles?.[variantName];
  if (typeof casePreamble === "string") return casePreamble.trim();
  const suitePreamble = suite.formatPreambles?.[variantName];
  if (typeof suitePreamble === "string") return suitePreamble.trim();
  return "";
}

export async function readSuite(path: string): Promise<Suite> {
  const txt = await Deno.readTextFile(path);
  return JSON.parse(txt) as Suite;
}

export function expandSuiteToTasks(suite: Suite): Task[] {
  const tasks: Task[] = [];
  for (const c of suite.cases) {
    for (const [variantName, variant] of Object.entries(c.variants)) {
      const context = renderVariant(c.input, variant as VariantSpec);
      const template = c.template ?? suite.template;
      const formatPreamble = resolveFormatPreamble(suite, c, variantName);
      const formatPreambleBlock = formatPreamble ? `${formatPreamble}\n\n` : "";
      for (const q of c.questions) {
        const prompt = applyTemplate(template, {
          format: variantName,
          format_preamble: formatPreamble,
          format_preamble_block: formatPreambleBlock,
          context,
          question: q.question,
        });
        const messages = [];
        if (suite.system) messages.push({ role: "system" as const, content: suite.system });
        messages.push({ role: "user" as const, content: prompt });

        const id = `${c.id}.${variantName}.${q.id}`;
        const tags = [
          ...(q.tags ?? []),
          `suite:${suite.name}`,
          `case:${c.id}`,
          `variant:${variantName}`,
          `question:${q.id}`,
        ];
        tasks.push({
          id,
          messages,
          expected: q.expected,
          scorer: q.scorer,
          tags,
          meta: { suite: suite.name, case: c.id, variant: variantName, question: q.id },
        });
      }
    }
  }
  return tasks;
}
