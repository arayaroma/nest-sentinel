// Ported from ts-sentinel/src/ratelimit/ratelimit.ts's Bucket/MemoryRateLimitStore (see that
// repo for the canonical source) — kept in sync by hand, not a live dependency (ts-sentinel is
// ESM-only, incompatible with this package's CJS/NestJS consumers via require()).

/**
 * Abstracts the rate-limit bucket backend so the default in-memory
 * implementation can later be swapped for a distributed store (e.g. Redis)
 * without changing consumers' public signature.
 */
export interface RateLimitStore {
  /** Reports whether a request identified by `key` is permitted right now, consuming a token if so. */
  allow(key: string): boolean;
}

/** A single token bucket. */
class Bucket {
  private tokens: number;
  private lastFill: number;

  constructor(
    private readonly rps: number,
    private readonly burst: number
  ) {
    this.tokens = burst;
    this.lastFill = Date.now();
  }

  allow(): boolean {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastFill) / 1000;
    this.lastFill = now;

    this.tokens = Math.min(this.burst, this.tokens + elapsedSeconds * this.rps);

    if (this.tokens < 1) {
      return false;
    }
    this.tokens -= 1;
    return true;
  }
}

/**
 * In-memory, single-process rate limit store backed by a token bucket per
 * key. Suitable for a single active instance; swap in a distributed store
 * (implementing RateLimitStore) for multi-instance deployments.
 */
export class MemoryRateLimitStore implements RateLimitStore {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly rps: number,
    private readonly burst: number
  ) {}

  allow(key: string): boolean {
    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = new Bucket(this.rps, this.burst);
      this.buckets.set(key, bucket);
    }
    return bucket.allow();
  }
}
