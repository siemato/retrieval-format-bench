import { join } from "@std/path/join";
import { readEnvConfig } from "../../config.ts";
import { OpenRouterClient } from "../../openrouter.ts";

export async function cmdModelsRefresh(_args: string[]) {
  const env = readEnvConfig();
  const client = new OpenRouterClient({
    apiKey: env.apiKey,
    baseUrl: env.baseUrl,
    httpReferer: env.httpReferer,
    xTitle: env.xTitle,
    timeoutMs: env.timeoutMs,
  });

  const data = await client.listModels();
  const outPath = join("cache", "openrouter.models.json");
  await Deno.mkdir("cache", { recursive: true });
  await Deno.writeTextFile(outPath, JSON.stringify(data, null, 2) + "\n");
  console.log(`Wrote: ${outPath}`);
}
