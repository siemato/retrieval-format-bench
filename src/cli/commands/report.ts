import { writeMarkdownReport } from "../../report.ts";
import { RunResult } from "../../types.ts";
import { parseCommandArgs } from "../args.ts";
import { CliUsageError } from "../errors.ts";
import { usage } from "../usage.ts";

const REPORT_ALLOWED = new Set(["run", "out", "help"]);

export async function cmdReport(args: string[]) {
  const parsed = parseCommandArgs(
    args,
    {
      string: ["run", "out"],
      boolean: ["help"],
      default: { out: "runs" },
    },
    REPORT_ALLOWED,
  );

  if (parsed.help) {
    console.log(usage());
    return;
  }

  if (!parsed.run) {
    throw new CliUsageError("report requires --run <path>");
  }

  const runPath = String(parsed.run);
  const outDir = String(parsed.out);

  const txt = await Deno.readTextFile(runPath);
  const run = JSON.parse(txt) as RunResult;

  const reportPath = await writeMarkdownReport(run, outDir);
  console.log(`Report: ${reportPath}`);
}
