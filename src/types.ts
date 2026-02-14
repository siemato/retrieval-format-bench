export type Role = "system" | "user" | "assistant" | "tool" | "developer";

export interface ChatMessage {
  role: Role;
  content: string;
  // Tool calling fields intentionally omitted for this benchmark runner.
}

export interface ModelSpec {
  id: string;
  label?: string;
}

export type ScorerSpec =
  | { type: "exact"; trim?: boolean; caseInsensitive?: boolean }
  | { type: "contains"; substring: string; caseInsensitive?: boolean }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "number"; tolerance?: number }
  | { type: "jsonPath"; path: string; expected: unknown; strict?: boolean };

export interface Task {
  id: string;
  prompt?: string;
  messages?: ChatMessage[];
  expected?: unknown;
  scorer?: ScorerSpec;
  tags?: string[];
  meta?: Record<string, unknown>;
}

export type VariantSpec =
  | { type: "json"; pretty?: boolean }
  | { type: "yaml" }
  | { type: "text" }
  | { type: "csv"; delimiter?: string }
  | { type: "markdown"; mode?: "table" | "bullets" }
  | { type: "toon"; delimiter?: "," | "|" | "	"; lengthMarker?: string }
  | { type: "xml"; rootName?: string; pretty?: boolean }
  | {
    type: "cddl_json";
    schema: string;
    transforms: Array<{ path: string; order: string[] }>;
    compact?: boolean;
    rootPath?: string;
  };

export interface SuiteQuestion {
  id: string;
  question: string;
  expected: unknown;
  scorer?: ScorerSpec;
  tags?: string[];
}

export interface SuiteCase {
  id: string;
  input: unknown;
  variants: Record<string, VariantSpec>;
  // Optional per-variant terse prompt guidance for this case only.
  formatPreambles?: Record<string, string>;
  questions: SuiteQuestion[];
  template?: string;
}

export interface Suite {
  name: string;
  description?: string;
  system?: string;
  template: string;
  // Optional global per-variant terse prompt guidance.
  formatPreambles?: Record<string, string>;
  cases: SuiteCase[];
}

export interface OpenRouterUsage {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
  cost?: number; // "credits" per OpenRouter usage accounting docs
  prompt_tokens_details?: {
    cached_tokens?: number;
    cache_write_tokens?: number;
    audio_tokens?: number;
    [k: string]: unknown;
  };
  completion_tokens_details?: {
    reasoning_tokens?: number;
    [k: string]: unknown;
  };
  cost_details?: {
    upstream_inference_cost?: number;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

export interface OpenRouterChoice {
  index: number;
  message: { role: "assistant"; content: string };
  finish_reason?: string | null;
}

export interface OpenRouterChatCompletionResponse {
  id: string;
  object: string;
  created?: number;
  model?: string;
  choices: OpenRouterChoice[];
  usage?: OpenRouterUsage;
  [k: string]: unknown;
}

export interface ScoreResult {
  correct: boolean;
  details?: string;
}

export interface AttemptResult {
  taskId: string;
  modelId: string;
  modelLabel?: string;
  ok: boolean;

  startedAt: string;
  endedAt: string;
  latencyMs: number;

  responseText?: string;
  finishReason?: string | null;

  usage?: OpenRouterUsage;

  expected?: unknown;
  score?: ScoreResult;

  error?: string;
}

export interface RunResult {
  runId: string;
  startedAt: string;
  endedAt: string;

  openrouterBaseUrl: string;
  models: ModelSpec[];

  // Effective generation settings
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;

  tasks: { id: string; tags?: string[] }[];
  attempts: AttemptResult[];
}
