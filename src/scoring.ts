import { ScoreResult, ScorerSpec } from "./types.ts";

function normStr(s: string, trim?: boolean, caseInsensitive?: boolean): string {
  let out = s;
  if (trim) out = out.trim();
  if (caseInsensitive) out = out.toLowerCase();
  return out;
}

function toNumber(x: unknown): number | null {
  if (typeof x === "number") return x;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x.trim());
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// Very small JSONPath subset: dot-separated keys + array indices in brackets.
// Examples:
// - $.foo.bar
// - $.items[0].sku
function getJsonPath(obj: unknown, path: string): unknown {
  const p = path.trim();
  if (!p.startsWith("$.")) throw new Error(`jsonPath must start with "$.": ${path}`);
  let cur: any = obj;
  const parts = p.slice(2).split(".");
  for (const part of parts) {
    const m = part.match(/^([A-Za-z0-9_\-]+)(\[(\d+)\])?$/);
    if (!m) throw new Error(`Unsupported jsonPath segment: ${part}`);
    const key = m[1];
    cur = cur?.[key];
    if (m[3] !== undefined) {
      const idx = Number(m[3]);
      cur = Array.isArray(cur) ? cur[idx] : undefined;
    }
  }
  return cur;
}

export function scoreOutput(
  outputText: string,
  expected: unknown,
  scorer?: ScorerSpec,
): ScoreResult {
  if (!scorer) {
    // Default: exact string match after trimming.
    const ok = normStr(outputText, true, false) === normStr(String(expected ?? ""), true, false);
    return { correct: ok, details: ok ? "exact" : "mismatch" };
  }

  switch (scorer.type) {
    case "exact": {
      const got = normStr(outputText, scorer.trim, scorer.caseInsensitive);
      const exp = normStr(String(expected ?? ""), scorer.trim, scorer.caseInsensitive);
      const ok = got === exp;
      return { correct: ok, details: ok ? "exact" : `expected "${exp}", got "${got}"` };
    }

    case "contains": {
      const got = scorer.caseInsensitive ? outputText.toLowerCase() : outputText;
      const sub = scorer.caseInsensitive ? scorer.substring.toLowerCase() : scorer.substring;
      const ok = got.includes(sub);
      return { correct: ok, details: ok ? "contains" : `missing substring "${scorer.substring}"` };
    }

    case "regex": {
      const re = new RegExp(scorer.pattern, scorer.flags);
      const ok = re.test(outputText);
      return {
        correct: ok,
        details: ok ? "regex" : `no match for /${scorer.pattern}/${scorer.flags ?? ""}`,
      };
    }

    case "number": {
      const tol = scorer.tolerance ?? 0;
      const got = toNumber(outputText);
      const exp = toNumber(expected);
      if (got === null || exp === null) {
        return { correct: false, details: "not a number" };
      }
      const ok = Math.abs(got - exp) <= tol;
      return { correct: ok, details: ok ? "number" : `expected ${exp}±${tol}, got ${got}` };
    }

    case "jsonPath": {
      let parsed: unknown;
      try {
        parsed = JSON.parse(outputText);
      } catch (_err) {
        return { correct: false, details: "invalid JSON" };
      }
      let got: unknown;
      try {
        got = getJsonPath(parsed, scorer.path);
      } catch (err) {
        return { correct: false, details: `jsonPath error: ${(err as Error).message}` };
      }
      const ok = scorer.strict
        ? Object.is(got, scorer.expected)
        : JSON.stringify(got) === JSON.stringify(scorer.expected);
      return {
        correct: ok,
        details: ok
          ? "jsonPath"
          : `expected ${JSON.stringify(scorer.expected)}, got ${JSON.stringify(got)}`,
      };
    }

    default: {
      const neverScorer: never = scorer;
      throw new Error(`Unknown scorer: ${(neverScorer as any).type}`);
    }
  }
}
