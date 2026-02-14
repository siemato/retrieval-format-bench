export class Semaphore {
  #capacity: number;
  #available: number;
  #queue: Array<() => void> = [];

  constructor(capacity: number) {
    if (!Number.isFinite(capacity) || capacity <= 0) {
      throw new Error(`Semaphore capacity must be > 0, got: ${capacity}`);
    }
    this.#capacity = capacity;
    this.#available = capacity;
  }

  async acquire(): Promise<() => void> {
    if (this.#available > 0) {
      this.#available -= 1;
      return () => this.release();
    }

    await new Promise<void>((resolve) => this.#queue.push(resolve));
    this.#available -= 1;
    return () => this.release();
  }

  private release() {
    this.#available += 1;
    if (this.#available > this.#capacity) {
      // Shouldn't happen, but avoid runaway counts.
      this.#available = this.#capacity;
    }
    const next = this.#queue.shift();
    if (next) next();
  }
}
