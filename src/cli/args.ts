import { parseArgs } from "@std/cli/parse-args";
import { CliUsageError } from "./errors.ts";

export function normalizeCliArgs(args: string[]): string[] {
  // Support invocation patterns like: deno task bench -- --flag ...
  return args.filter((a, i) => !(i === 0 && a === "--"));
}

export function assertNoUnknownFlags(args: string[], allowed: ReadonlySet<string>): void {
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const eq = arg.indexOf("=");
    const name = (eq >= 0 ? arg.slice(2, eq) : arg.slice(2)).trim();
    if (!name) continue;
    if (!allowed.has(name)) {
      throw new CliUsageError(`Unknown flag: --${name}`);
    }
  }
}

export function parseCommandArgs(
  args: string[],
  opts: Parameters<typeof parseArgs>[1],
  allowed: ReadonlySet<string>,
) {
  const normalized = normalizeCliArgs(args);
  assertNoUnknownFlags(normalized, allowed);
  return parseArgs(normalized, opts);
}

export function parsePositiveNumber(raw: unknown, flagName: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) {
    throw new CliUsageError(`${flagName} must be a number > 0 (got ${String(raw)})`);
  }
  return n;
}

export function parseNonNegativeNumber(raw: unknown, flagName: string): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) {
    throw new CliUsageError(`${flagName} must be a number >= 0 (got ${String(raw)})`);
  }
  return n;
}

export function parseOptionalPositiveNumber(raw: unknown, flagName: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  return parsePositiveNumber(raw, flagName);
}

export function parseOptionalNonNegativeNumber(raw: unknown, flagName: string): number | undefined {
  if (raw === undefined || raw === "") return undefined;
  return parseNonNegativeNumber(raw, flagName);
}
