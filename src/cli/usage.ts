export function usage(): string {
  return `
retrieval-format-bench

Commands:
  bench            Plan or run a benchmark (models × tasks) via OpenRouter
  report           Generate a Markdown report from a run JSON
  models:refresh   Fetch OpenRouter /models metadata and cache it (optional)
  estimate         Estimate token usage + USD cost for a benchmark run (no model calls)

Examples:
  deno task bench -- --models configs/models.json --suite suites/formats.suite.json --out runs
  deno task bench -- --models configs/models.json --suite suites/formats.suite.json --format json_cddl --out runs --execute
  deno task bench -- --models configs/models.json --suite suites/formats.suite.json --task-ids-file tasks/missing.txt --out runs --execute
  deno task report -- --run runs/latest.json --out runs
  deno task estimate -- --models configs/models.json --suite suites/formats.suite.json --output-tokens 16

Flags for bench:
  --models <path>        Models JSON file (default: configs/models.json)
  --suite <path>         Suite JSON file (required if --tasks is not used)
  --tasks <path>         Tasks JSONL file (required if --suite is not used)
  --format <name>        Run only one format/variant (e.g. json, yaml, csv, json_cddl)
  --task-ids <csv>       Run only selected task IDs (comma-separated)
  --task-ids-file <path> Run only selected task IDs from file (one per line; # comments allowed)
  --out <dir>            Output directory for run JSON (default: runs)
  --concurrency <n>      Parallel requests (default: 4)
  --temperature <n>      Temperature (optional)
  --max-tokens <n>       max_tokens (optional)
  --include-reasoning    Request reasoning tokens (optional)
  --store-full-text      Store full response content in run JSON (default: truncate)
  --max-chars <n>        Truncate stored content to this many chars (default: 4000)
  --execute              Execute model calls (default is preflight-only)

Flags for report:
  --run <path>           Path to run JSON (required)
  --out <dir>            Output directory (default: runs)

Flags for estimate:
  --models <path>        Models JSON file (default: configs/models.json)
  --suite <path>         Suite JSON file (required if --tasks is not used)
  --tasks <path>         Tasks JSONL file (required if --suite is not used)
  --format <name>        Estimate only one format/variant
  --output-tokens <n>    Assume this many completion tokens per call (optional)
  --cache <path>         Path to cached /models JSON (default: cache/openrouter.models.json)
`;
}
