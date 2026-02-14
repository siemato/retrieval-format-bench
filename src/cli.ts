import { CliUsageError } from "./cli/errors.ts";
import { runCli } from "./cli/main.ts";
import { usage } from "./cli/usage.ts";

export { runCli };

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
