# Benchmark Expected Behavior Contract

## 1. Scope

This document defines expected CLI behavior for the benchmark, independent of implementation
details.

## 2. Global CLI Rules

### 2.1 Exit Codes

- `0`: command completed successfully.
- non-`0`: command failed before completion or encountered a fatal error.

### 2.2 Output Channels

- Human-readable progress and summaries are printed to `stdout`.
- Errors print clear cause and corrective guidance.

### 2.3 Deterministic Preflight (Required)

Before any model calls, `bench` and `estimate` must print:

- model count,
- resolved input source,
- selected task count,
- selected format (if provided),
- planned calls.

## 3. Command Contracts

### 3.1 `bench`

Runs model inference and writes run artifacts.

#### Required Input

Exactly one of:

- `--suite <path>`
- `--tasks <path>`

#### Optional

- `--models <path>` (default allowed by product contract)
- `--format <variant>`
- `--out <dir>`
- `--concurrency <n>`
- `--temperature <n>`
- `--max-tokens <n>`
- `--include-reasoning`
- `--store-full-text`
- `--max-chars <n>`
- `--execute` (required to perform model calls; without it, bench is preflight-only)

#### Expected Success Output (shape)

- `Models: <N>`
- `Input: suite <path> (<suite_name>)` or `Input: tasks <path>`
- `Tasks: <T>`
- `Format: <variant>` (only when `--format` is set)
- `Planned calls: <N*T>`
- `Base URL: <url>`
- progress lines (`[x/y] z%`)
- `Run JSON: <out>/<runId>.json`
- `Report: <out>/<runId>.report.md`

#### Preflight-Only Behavior (Default)

When `--execute` is not provided:

- print deterministic preflight lines,
- print `Execution: skipped (preflight only). Use --execute to run model calls.`,
- exit `0`,
- create no run artifacts and make no model calls.

#### Expected Artifacts on Success

- `<out>/<runId>.json`
- `<out>/latest.json`
- `<out>/<runId>.report.md`
- `<out>/latest.report.md`

### 3.2 `estimate`

No model inference. Estimates tokens/cost.

#### Required Input

Exactly one of:

- `--suite <path>`
- `--tasks <path>`

#### Optional

- `--models <path>`
- `--format <variant>`
- `--output-tokens <n>`
- `--cache <path>`

#### Expected Success Output (shape)

- `Token estimation (heuristic): ...`
- `Models: <N>`
- `Input: ...`
- `Tasks: <T>`
- `Format: <variant>` (if set)
- `Planned calls: <N*T>`
- token totals
- per-model cost estimates
- total estimated cost

#### Expected Behavior

- Must not create run artifacts.
- May read pricing remotely or from cache per config.

### 3.3 `report`

Renders markdown report from an existing run JSON.

#### Required

- `--run <path>`

#### Optional

- `--out <dir>`

#### Expected Success Output

- `Report: <out>/<runId>.report.md`

#### Expected Artifacts

- `<out>/<runId>.report.md`
- `<out>/latest.report.md`

## 4. Argument Validation Matrix (Normative)

### 4.1 Valid

`bench --models M --suite S --format json_cddl --out runs --concurrency 4`

- must run only `json_cddl` tasks.
- must print `Tasks: <count_for_json_cddl_only>`.
- must print `Planned calls: models * tasks`.

### 4.2 Invalid: missing input source

`bench --models M`

- must fail fast.
- expected error class: missing required input source.
- no model calls.
- no new run artifact.

### 4.3 Invalid: both input sources

`bench --suite S --tasks T`

- must fail fast with conflict message.
- no model calls.

### 4.4 Invalid: unknown flag

`bench --suiet S`

- must fail fast with unknown flag message.
- no model calls.

### 4.5 Invalid: bad numeric

`bench --concurrency 0`

- must fail fast with validation message.
- no model calls.

### 4.6 Invalid format filter

`bench --suite S --format does_not_exist`

- must fail fast.
- error must include available variants from selected input.

## 5. Format Filter Contract

For `--format X`:

- task set must contain only tasks whose variant is `X`.
- report variant tables/diagrams must contain only `X` (or only available variants in run if mixed
  historical run input is used).
- planned calls must use filtered task count only.

## 6. Expected Output Examples (Normative)

### 6.1 Single-format full-suite bench

Input:

`bench --models configs/models.json --suite suites/formats.suite.json --format json_cddl --out runs --concurrency 4`

Expected preflight:

- `Models: 6` (if models file has 6)
- `Input: suite suites/formats.suite.json (...)`
- `Tasks: 48` (if suite defines 48 `json_cddl` tasks)
- `Format: json_cddl`
- `Planned calls: 288`

Expected completion:

- run/report paths printed.
- run JSON contains only `json_cddl` task IDs.

### 6.2 Full-suite all-variants bench

Input:

`bench --models configs/models.json --suite suites/formats.suite.json --out runs --concurrency 4`

Expected preflight:

- `Tasks: 336` (if suite is `7 variants * 48` each)
- `Planned calls: 2016` (if `6` models)

### 6.3 Report generation

Input:

`report --run runs/latest.json --out runs`

Expected:

- one line with generated report path.
- no model calls.

## 7. Interruption and Partial Run Expectations

If user aborts:

- command should stop promptly.
- partial execution should not be represented as a fully completed run.
- if no completed run artifact is produced, `latest.json` should remain previous completed run.
- user should be able to distinguish aborted vs completed state.

## 8. Error Transparency Expectations

Any provider/API issues during `bench`:

- preserved per attempt in run JSON.
- visible in report failure section.
- successful attempts remain counted in summary.

## 9. Non-Ambiguity Requirement

The CLI must make it impossible to silently run the wrong benchmark scope:

- explicit input source required,
- strict flag validation,
- explicit preflight summary required,
- deterministic task/planned-call reporting required.

## 10. Acceptance Checklist

- Given a command, a user can predict:
  - selected tasks,
  - planned calls,
  - artifact paths,
  - success/failure shape.
- Wrong/ambiguous invocations fail before cost-incurring model calls.
