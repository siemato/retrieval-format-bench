# retrieval-format-bench

The core idea is simple: give models the same data and the same questions, but change the data
format (JSON, YAML, CSV, XML, and others), then measure how well each model answers.

## Why this exists

This project uncovers format handling quality, not production retrieval architecture.

You should not treat this as a recommendation to stuff large datasets into prompts for real-world
retrieval. In practice, that is usually the wrong tool for the job. What this benchmark mostly tests
is: "Can the model work with this format at all, and how reliably?"

If you use the results that way, they are useful.

## What is benchmarked

Each benchmark task follows this shape:

`(data in format X) + (question) -> (short answer)`

The runner evaluates answer correctness and can estimate/track cost.

Current suite variants include:

- JSON (pretty)
- JSON compact (minified)
- YAML
- TOON (token-oriented object notation)
- CSV (flat/tabular)
- XML
- JSON+CDDL (schema-guided keyless arrays on wire)

## Setup

1. Install Deno 2.x.
2. Create a `.env` file in the project root.
3. Put your OpenRouter token in it.

Example `.env`:

```env
OPENROUTER_API_KEY=your_openrouter_token_here
```

Optional values (only if you need them):

```env
OPENROUTER_BASE_URL=https://openrouter.ai/api/v1
OPENROUTER_HTTP_REFERER=https://example.com
OPENROUTER_X_TITLE=retrieval-format-bench
```

## Quickstart

Preflight (build tasks, validate config, no model calls):

```bash
deno task bench -- --models configs/models.json --suite suites/formats.suite.json --out runs --concurrency 4
```

Execute the benchmark (actual model calls):

```bash
deno task bench -- --models configs/models.json --suite suites/formats.suite.json --out runs --concurrency 4 --execute
```

Run one format across all models:

```bash
deno task bench -- --models configs/models.json --suite suites/formats.suite.json --format json_cddl --out runs --concurrency 4 --execute
```

Estimate cost before running:

```bash
deno task estimate -- --models configs/models.json --suite suites/formats.suite.json --output-tokens 16
```

Generate a report from an existing run:

```bash
deno task report -- --run runs/latest.json --out runs
```

## Config basics

- Models: edit `configs/models.json` with the OpenRouter model IDs you want to compare.
- Suites: define cases in `suites/*.suite.json` (`input`, `variants`, `questions`, scoring rules).
- Direct tasks: use `tasks/*.jsonl` when you want fully custom prompts/messages.

## Scoring

Supported scorers:

- `exact`
- `contains`
- `regex`
- `number` (with tolerance)
- `jsonPath` (subset like `$.a.b[0].c`)

Default scorer is trimmed exact string match.

## Notes

- `bench` and `estimate` require exactly one input source: `--suite` or `--tasks`.
- `bench` only executes model calls when `--execute` is present.
- Unknown flags fail fast to avoid accidental mis-runs.
