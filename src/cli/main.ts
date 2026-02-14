import { cmdBench } from "./commands/bench.ts";
import { cmdEstimate } from "./commands/estimate.ts";
import { cmdModelsRefresh } from "./commands/models_refresh.ts";
import { cmdReport } from "./commands/report.ts";
import { CliUsageError } from "./errors.ts";
import { usage } from "./usage.ts";

export async function runCli(argv: string[]): Promise<void> {
  const [cmd, ...rest] = argv;

  switch (cmd) {
    case "bench":
      await cmdBench(rest);
      return;
    case "report":
      await cmdReport(rest);
      return;
    case "models:refresh":
      await cmdModelsRefresh(rest);
      return;
    case "estimate":
      await cmdEstimate(rest);
      return;
    case "-h":
    case "--help":
    case undefined:
      console.log(usage());
      return;
    default:
      throw new CliUsageError(`Unknown command: ${cmd}`);
  }
}

if (import.meta.main) {
  try {
    await runCli(Deno.args);
  } catch (err) {
    const message = (err as Error).stack ?? String(err);
    console.error(message);
    if (err instanceof CliUsageError) {
      console.log(usage());
      Deno.exit(2);
    }
    Deno.exit(1);
  }
}
