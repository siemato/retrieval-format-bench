import { stringify as yamlStringify } from "@std/yaml";
import { stringify as csvStringify } from "@std/csv/stringify";
import { stringify as xmlStringify } from "@libs/xml";
import { VariantSpec } from "./types.ts";

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function isPrimitive(x: unknown): x is string | number | boolean | null {
  return x === null || ["string", "number", "boolean"].includes(typeof x);
}

function stableKeysUnion(rows: Array<Record<string, unknown>>): string[] {
  const set = new Set<string>();
  for (const r of rows) for (const k of Object.keys(r)) set.add(k);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function fence(lang: string, body: string): string {
  const trimmed = body.endsWith("\n") ? body.slice(0, -1) : body;
  return `\`\`\`${lang}\n${trimmed}\n\`\`\`\n`;
}

function renderJson(input: unknown, pretty: boolean): string {
  const body = pretty ? JSON.stringify(input, null, 2) : JSON.stringify(input);
  return fence("json", body);
}

function renderYaml(input: unknown): string {
  const y = yamlStringify(input);
  return fence("yaml", y);
}

function asRecordArray(x: unknown): Array<Record<string, unknown>> | null {
  if (!Array.isArray(x)) return null;
  const out: Array<Record<string, unknown>> = [];
  for (const el of x) {
    if (!isRecord(el)) return null;
    out.push(el);
  }
  return out;
}

function renderCsvForRows(rows: Array<Record<string, unknown>>, delimiter: string): string {
  const columns = stableKeysUnion(rows);
  const csv = csvStringify(rows, { headers: true, columns, separator: delimiter });
  return csv.endsWith("\n") ? csv.slice(0, -1) : csv;
}

function scalarToString(x: string | number | boolean | null): string {
  if (x === null) return "null";
  return String(x);
}

function flattenToPathValueRows(input: unknown): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];

  const walk = (node: unknown, path: string[]) => {
    if (isPrimitive(node)) {
      rows.push({ path: path.join("."), value: scalarToString(node) });
      return;
    }

    if (Array.isArray(node)) {
      if (node.length === 0) {
        rows.push({ path: path.join("."), value: "[]" });
        return;
      }
      for (let i = 0; i < node.length; i++) walk(node[i], [...path, String(i)]);
      return;
    }

    if (isRecord(node)) {
      const keys = Object.keys(node).sort((a, b) => a.localeCompare(b));
      if (keys.length === 0) rows.push({ path: path.join("."), value: "{}" });
      for (const k of keys) walk((node as Record<string, unknown>)[k], [...path, k]);
      return;
    }
  };

  walk(input, []);
  return rows;
}

/**
 * CSV rendering:
 * - If input is an array of objects => single CSV.
 * - If input is an object whose properties contain arrays of objects => multiple CSV sections:
 *     # key
 *     <csv>
 */
function renderCsv(input: unknown, delimiter: string): string {
  const direct = asRecordArray(input);
  if (direct) return fence("csv", renderCsvForRows(direct, delimiter));

  if (isRecord(input)) {
    const keys = Object.keys(input).sort((a, b) => a.localeCompare(b));
    const sections: string[] = [];
    for (const k of keys) {
      const rows = asRecordArray((input as Record<string, unknown>)[k]);
      if (!rows) continue;

      if (sections.length > 0) sections.push("");
      sections.push(`# ${k}`);
      sections.push(renderCsvForRows(rows, delimiter));
    }
    if (sections.length === 0) {
      // Fallback for deeply nested objects: emit key-path/value rows.
      const flatRows = flattenToPathValueRows(input);
      if (flatRows.length > 0) return fence("csv", renderCsvForRows(flatRows, delimiter));
    }
    return fence("csv", sections.join("\n"));
  }

  throw new Error(
    "csv variant requires an array of objects or an object with at least one property that is an array of objects",
  );
}

/* ----------------------------- TOON renderer ---------------------------- */

function toonNeedsQuoting(s: string, delimiter: string): boolean {
  if (s.length === 0) return true;
  if (s !== s.trim()) return true;
  if (s.includes("\n") || s.includes("\r") || s.includes("\t")) return true;
  if (s.includes('"')) return true;
  if (s.includes(":")) return true;
  if (s.includes(delimiter)) return true;
  if (s.startsWith("-")) return true;
  // Avoid ambiguity with keywords and numbers.
  if (/^(true|false|null)$/i.test(s)) return true;
  if (/^-?\d+(\.\d+)?$/.test(s)) return true;
  return false;
}

function toonScalar(x: unknown, delimiter: string): string {
  if (x === null) return "null";
  if (typeof x === "boolean") return x ? "true" : "false";
  if (typeof x === "number") return Number.isFinite(x) ? String(x) : "null";
  if (typeof x === "string") {
    return toonNeedsQuoting(x, delimiter) ? JSON.stringify(x) : x;
  }
  // Fallback: JSON string
  return JSON.stringify(x);
}

function isUniformPrimitiveObjectArray(arr: unknown[]): arr is Array<Record<string, unknown>> {
  if (arr.length === 0) return false;
  if (!arr.every(isRecord)) return false;
  const rows = arr as Array<Record<string, unknown>>;
  const keys0 = Object.keys(rows[0]).sort((a, b) => a.localeCompare(b));
  for (const r of rows) {
    const keys = Object.keys(r).sort((a, b) => a.localeCompare(b));
    if (keys.join("\u0000") !== keys0.join("\u0000")) return false;
    for (const k of keys0) {
      if (!isPrimitive(r[k])) return false;
    }
  }
  return true;
}

type ToonOptions = {
  delimiter: string;
  lengthMarker?: string;
  indent: string;
};

function toonLen(n: number, marker?: string): string {
  return marker ? `${marker}${n}` : `${n}`;
}

function encodeToon(value: unknown, opts: ToonOptions): string {
  const out: string[] = [];
  const indentUnit = opts.indent;
  const d = opts.delimiter;

  const encArray = (arr: unknown[], depth: number, key?: string) => {
    const indent = indentUnit.repeat(depth);
    const lenStr = toonLen(arr.length, opts.lengthMarker);

    // Primitive array
    if (arr.every(isPrimitive)) {
      const vals = arr.map((x) => toonScalar(x, d)).join(d);
      out.push(indent + (key ? `${key}[${lenStr}]: ${vals}` : `[${lenStr}]: ${vals}`));
      return;
    }

    // Uniform array of primitive objects -> tabular
    if (isUniformPrimitiveObjectArray(arr)) {
      const rows = arr as Array<Record<string, unknown>>;
      const fields = Object.keys(rows[0]).sort((a, b) => a.localeCompare(b));
      const fieldList = fields.join(",");
      out.push(indent + (key ? `${key}[${lenStr}]{${fieldList}}:` : `[${lenStr}]{${fieldList}}:`));
      for (const r of rows) {
        const row = fields.map((f) => toonScalar(r[f], d)).join(d);
        out.push(indent + indentUnit + row);
      }
      return;
    }

    // Mixed/non-uniform -> list format
    out.push(indent + (key ? `${key}[${lenStr}]:` : `[${lenStr}]:`));

    const itemIndent = indent + indentUnit;

    for (const el of arr) {
      if (isPrimitive(el)) {
        out.push(itemIndent + `- ${toonScalar(el, d)}`);
      } else if (isRecord(el)) {
        const keys = Object.keys(el).sort((a, b) => a.localeCompare(b));
        if (keys.length === 0) {
          out.push(itemIndent + `-`);
          continue;
        }
        const first = keys[0];
        const firstVal = (el as Record<string, unknown>)[first];
        if (Array.isArray(firstVal)) {
          out.push(itemIndent + `- ${first}[${toonLen(firstVal.length, opts.lengthMarker)}]:`);
          // encode array under this list item, nested one more level
          encArray(firstVal, depth + 2, undefined);
        } else if (isRecord(firstVal)) {
          out.push(itemIndent + `- ${first}:`);
          enc(firstVal, depth + 2);
        } else {
          out.push(itemIndent + `- ${first}: ${toonScalar(firstVal, d)}`);
        }
        for (const k of keys.slice(1)) {
          const vv = (el as Record<string, unknown>)[k];
          if (Array.isArray(vv)) {
            encArray(vv, depth + 2, k);
          } else if (isRecord(vv)) {
            out.push(itemIndent + indentUnit + `${k}:`);
            enc(vv, depth + 3);
          } else {
            out.push(itemIndent + indentUnit + `${k}: ${toonScalar(vv, d)}`);
          }
        }
      } else if (Array.isArray(el)) {
        // Array inside list
        if (el.every(isPrimitive)) {
          const vals = el.map((x) => toonScalar(x, d)).join(d);
          out.push(itemIndent + `- [${toonLen(el.length, opts.lengthMarker)}]: ${vals}`);
        } else {
          out.push(itemIndent + `- [${toonLen(el.length, opts.lengthMarker)}]:`);
          encArray(el, depth + 2, undefined);
        }
      } else {
        out.push(itemIndent + `- ${JSON.stringify(el)}`);
      }
    }
  };

  const enc = (v: unknown, depth: number, keyPrefix?: string) => {
    const indent = indentUnit.repeat(depth);

    // Helper to emit a single line.
    const line = (s: string) => out.push(indent + s);

    if (isRecord(v)) {
      const keys = Object.keys(v).sort((a, b) => a.localeCompare(b));
      for (const k of keys) {
        const vv = (v as Record<string, unknown>)[k];
        if (Array.isArray(vv)) {
          encArray(vv, depth, k);
        } else if (isRecord(vv)) {
          line(`${k}:`);
          enc(vv, depth + 1);
        } else {
          line(`${k}: ${toonScalar(vv, d)}`);
        }
      }
      return;
    }

    if (Array.isArray(v)) {
      encArray(v, depth, keyPrefix);
      return;
    }

    // Root primitive
    if (keyPrefix) line(`${keyPrefix}: ${toonScalar(v, d)}`);
    else line(`${toonScalar(v, d)}`);
  };

  enc(value, 0);
  return out.join("\n") + "\n";
}

function renderToon(input: unknown, delimiter: "," | "|" | "\t", lengthMarker?: string): string {
  const opts: ToonOptions = { delimiter, lengthMarker, indent: "  " };
  const body = encodeToon(input, opts);
  return fence("toon", body);
}

/* ----------------------------- XML renderer ----------------------------- */

function sanitizeXmlName(name: string): string {
  // XML names: start with letter or underscore; contain letters, digits, hyphen, underscore, period.
  let out = name.replaceAll(" ", "_").replaceAll(/[^A-Za-z0-9_.-]/g, "_");
  if (!/^[A-Za-z_]/.test(out)) out = `x_${out}`;
  return out;
}

function singularizeTag(plural: string): string {
  // Very small heuristic; good enough for common plural keys.
  if (plural.endsWith("ies") && plural.length > 3) return plural.slice(0, -3) + "y";
  if (plural.endsWith("s") && plural.length > 1) return plural.slice(0, -1);
  return "item";
}

function xmlify(value: unknown, keyHint?: string): unknown {
  if (value === null || value === undefined) return "";
  if (isPrimitive(value)) return value;

  if (Array.isArray(value)) {
    const itemTag = sanitizeXmlName(singularizeTag(keyHint ?? "items"));
    return { [itemTag]: value.map((el) => xmlify(el, itemTag)) };
  }

  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
      const v = (value as Record<string, unknown>)[k];
      out[sanitizeXmlName(k)] = xmlify(v, k);
    }
    return out;
  }

  return String(value);
}

function renderXml(input: unknown, rootName = "dataset", pretty = true): string {
  const rootTag = sanitizeXmlName(rootName);
  const ast: Record<string, unknown> = {
    "@version": "1.0",
    "@encoding": "UTF-8",
    [rootTag]: xmlify(input, rootTag),
  };

  const xml = xmlStringify(ast, pretty ? { format: { indent: "  " } } : undefined);
  return fence("xml", xml);
}

/* --------------------------- JSON+CDDL renderer -------------------------- */

type CddlTransform = { path: string; order: string[] };

function parsePath(path: string): string[] {
  const p = path.trim();
  if (p === "" || p === "/") return [];
  const parts = p.split("/").filter((x) => x.length > 0);
  return parts;
}

function applyTransform(root: unknown, transform: CddlTransform): unknown {
  const segs = parsePath(transform.path);

  const rec = (node: any, idx: number): any => {
    if (idx === segs.length) {
      if (!isRecord(node)) return node;
      return transform.order.map((k) => (node as Record<string, unknown>)[k] ?? null);
    }

    const seg = segs[idx];
    if (seg === "*") {
      if (!Array.isArray(node)) return node;
      for (let i = 0; i < node.length; i++) node[i] = rec(node[i], idx + 1);
      return node;
    }

    if (!isRecord(node)) return node;
    const key = seg;
    if (!(key in node)) return node;
    (node as any)[key] = rec((node as any)[key], idx + 1);
    return node;
  };

  return rec(root as any, 0);
}

function extractPath(root: unknown, path: string): unknown {
  const segs = parsePath(path);
  let cur: unknown = root;

  for (const seg of segs) {
    if (Array.isArray(cur) && /^\d+$/.test(seg)) {
      cur = cur[Number(seg)];
      continue;
    }
    if (isRecord(cur)) {
      cur = (cur as Record<string, unknown>)[seg];
      continue;
    }
    return undefined;
  }

  return cur;
}

function renderCddlJson(
  input: unknown,
  schema: string,
  transforms: CddlTransform[],
  compact: boolean,
  rootPath?: string,
): string {
  // Deep clone so we don't mutate suite input.
  let clone = JSON.parse(JSON.stringify(input)) as unknown;

  // Apply deeper transforms first so we don't lose object keys before transforming children.
  const sorted = [...transforms].sort((a, b) => {
    const da = parsePath(a.path).length;
    const db = parsePath(b.path).length;
    return db - da;
  });

  for (const t of sorted) clone = applyTransform(clone, t);

  const projected = rootPath && rootPath.trim() !== "" ? extractPath(clone, rootPath) : clone;
  if (projected === undefined) {
    throw new Error(`cddl_json rootPath not found: ${rootPath}`);
  }

  const jsonBody = compact ? JSON.stringify(projected) : JSON.stringify(projected, null, 2);
  const schemaBody = schema.trimEnd() + "\n";
  return fence("cddl", schemaBody) + "\n" + fence("json", jsonBody);
}

export function renderVariant(input: unknown, variant: VariantSpec): string {
  switch (variant.type) {
    case "text":
      return String(input);

    case "json": {
      const pretty = variant.pretty ?? true;
      return renderJson(input, pretty);
    }

    case "yaml":
      return renderYaml(input);

    case "csv": {
      const delimiter = variant.delimiter ?? ",";
      return renderCsv(input, delimiter);
    }

    case "toon": {
      const delimiter = variant.delimiter ?? ",";
      const lengthMarker = variant.lengthMarker;
      return renderToon(input, delimiter, lengthMarker);
    }

    case "xml": {
      const rootName = variant.rootName ?? "dataset";
      const pretty = variant.pretty ?? true;
      return renderXml(input, rootName, pretty);
    }

    case "cddl_json": {
      const compact = variant.compact ?? true;
      return renderCddlJson(input, variant.schema, variant.transforms, compact, variant.rootPath);
    }

    case "markdown": {
      // Keep legacy support (not used by the default suite).
      const mode = variant.mode ?? "table";
      return fence("markdown", renderMarkdown(input, mode));
    }

    default: {
      const neverVariant: never = variant;
      throw new Error(`Unknown variant: ${(neverVariant as any).type}`);
    }
  }
}

/* -------------------------- Legacy markdown renderer --------------------- */

function mdEscapeCell(s: string): string {
  // Escape pipes so tables don't break.
  return s.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function renderMarkdown(input: unknown, mode: "table" | "bullets"): string {
  const lines: string[] = [];

  if (mode === "table" && Array.isArray(input) && input.every(isRecord)) {
    const rows = input as Array<Record<string, unknown>>;
    const header = stableKeysUnion(rows);
    lines.push(`| ${header.join(" | ")} |`);
    lines.push(`| ${header.map(() => "---").join(" | ")} |`);
    for (const r of rows) {
      const cells = header.map((k) => {
        const v = r[k];
        const s = v === null || v === undefined
          ? ""
          : (typeof v === "string" ? v : JSON.stringify(v));
        return mdEscapeCell(s);
      });
      lines.push(`| ${cells.join(" | ")} |`);
    }
    return lines.join("\n");
  }

  // Generic bullets rendering.
  const renderAny = (x: unknown, indent: string) => {
    if (Array.isArray(x)) {
      for (const el of x) {
        if (isPrimitive(el)) lines.push(`${indent}- ${String(el)}`);
        else if (isRecord(el)) {
          lines.push(`${indent}-`);
          renderAny(el, indent + "  ");
        } else {
          lines.push(`${indent}- ${JSON.stringify(el)}`);
        }
      }
      return;
    }
    if (isRecord(x)) {
      const keys = Object.keys(x).sort((a, b) => a.localeCompare(b));
      for (const k of keys) {
        const v = (x as Record<string, unknown>)[k];
        if (isPrimitive(v)) lines.push(`${indent}- **${k}**: ${String(v)}`);
        else {
          lines.push(`${indent}- **${k}**:`);
          renderAny(v, indent + "  ");
        }
      }
      return;
    }
    lines.push(`${indent}${String(x)}`);
  };

  renderAny(input, "");
  return lines.join("\n");
}
