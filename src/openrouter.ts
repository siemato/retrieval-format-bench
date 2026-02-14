import { ChatMessage, OpenRouterChatCompletionResponse } from "./types.ts";

export interface OpenRouterClientOptions {
  apiKey: string;
  baseUrl?: string; // default https://openrouter.ai/api/v1
  httpReferer?: string;
  xTitle?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export interface ChatCompletionOptions {
  temperature?: number;
  maxTokens?: number;
  includeReasoning?: boolean;
  // You can pass arbitrary provider/model parameters here if you need them.
  extra?: Record<string, unknown>;
}

export class OpenRouterClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #httpReferer?: string;
  readonly #xTitle?: string;
  readonly #timeoutMs: number;
  readonly #maxRetries: number;

  constructor(opts: OpenRouterClientOptions) {
    if (!opts.apiKey) throw new Error("OpenRouter apiKey is required");
    this.#apiKey = opts.apiKey;
    this.#baseUrl = (opts.baseUrl ?? "https://openrouter.ai/api/v1").replace(/\/$/, "");
    this.#httpReferer = opts.httpReferer;
    this.#xTitle = opts.xTitle;
    this.#timeoutMs = opts.timeoutMs ?? 120_000;
    this.#maxRetries = opts.maxRetries ?? 4;
  }

  get baseUrl(): string {
    return this.#baseUrl;
  }

  private headers(): Headers {
    const h = new Headers();
    h.set("Authorization", `Bearer ${this.#apiKey}`);
    h.set("Content-Type", "application/json");
    // Optional OpenRouter attribution headers
    if (this.#httpReferer) h.set("HTTP-Referer", this.#httpReferer);
    if (this.#xTitle) h.set("X-Title", this.#xTitle);
    return h;
  }

  async chatCompletion(
    model: string,
    messages: ChatMessage[],
    options: ChatCompletionOptions = {},
  ): Promise<OpenRouterChatCompletionResponse> {
    const body: Record<string, unknown> = {
      model,
      messages,
    };
    if (options.temperature !== undefined) body.temperature = options.temperature;
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens;

    // OpenRouter supports reasoning tokens via `include_reasoning: true` (optional).
    if (options.includeReasoning) body.include_reasoning = true;

    if (options.extra) {
      for (const [k, v] of Object.entries(options.extra)) body[k] = v;
    }

    const url = `${this.#baseUrl}/chat/completions`;
    return await this.#fetchJsonWithRetry(url, body);
  }

  async listModels(): Promise<unknown> {
    const url = `${this.#baseUrl}/models`;
    const resp = await fetch(url, { headers: this.headers() });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`OpenRouter listModels failed (${resp.status}): ${txt}`);
    }
    return await resp.json();
  }

  async getGeneration(id: string): Promise<unknown> {
    const url = `${this.#baseUrl}/generation?id=${encodeURIComponent(id)}`;
    const resp = await fetch(url, { headers: this.headers() });
    if (!resp.ok) {
      const txt = await resp.text();
      throw new Error(`OpenRouter getGeneration failed (${resp.status}): ${txt}`);
    }
    return await resp.json();
  }

  async #fetchJsonWithRetry(url: string, body: unknown): Promise<any> {
    let attempt = 0;
    let lastErr: Error | null = null;

    while (attempt <= this.#maxRetries) {
      attempt += 1;
      const ctrl = new AbortController();
      const timeout = setTimeout(() => ctrl.abort(), this.#timeoutMs);

      try {
        const resp = await fetch(url, {
          method: "POST",
          headers: this.headers(),
          body: JSON.stringify(body),
          signal: ctrl.signal,
        });

        clearTimeout(timeout);

        if (resp.ok) return await resp.json();

        const status = resp.status;
        const text = await resp.text();

        // Retry on rate limits and transient upstream failures.
        if (status === 429 || status === 502 || status === 503 || status === 504) {
          lastErr = new Error(`HTTP ${status}: ${text}`);
          await this.#sleep(this.#backoffMs(attempt));
          continue;
        }

        // Other errors: do not retry.
        throw new Error(`OpenRouter request failed (${status}): ${text}`);
      } catch (err) {
        clearTimeout(timeout);

        const e = err as Error;
        // Abort / network errors: retry
        lastErr = e;
        if (attempt <= this.#maxRetries) {
          await this.#sleep(this.#backoffMs(attempt));
          continue;
        }
        break;
      }
    }

    throw lastErr ?? new Error("OpenRouter request failed (unknown error)");
  }

  #backoffMs(attempt: number): number {
    // Exponential backoff with jitter.
    const base = Math.min(30_000, 500 * 2 ** (attempt - 1));
    const jitter = Math.floor(Math.random() * 250);
    return base + jitter;
  }

  async #sleep(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
  }
}
