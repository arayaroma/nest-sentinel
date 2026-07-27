// RateLimitGuard/RateLimitGlobalGuard: NestJS CanActivate guards wrapping the ported
// MemoryRateLimitStore token-bucket core. Mirrors ts-sentinel's rateLimit/rateLimitGlobal
// concept, but derives the key from Express's Request (req.headers, req.ip) instead of
// ts-sentinel's apiKeyOrIp (which reads a Fetch API Headers object — wrong shape for Express).
import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
} from "@nestjs/common";
import type { Request } from "express";
import { MemoryRateLimitStore, type RateLimitStore } from "./store";

export interface RateLimitOptions {
  /** Sustained requests-per-second rate allowed per key. */
  rps: number;
  /** Maximum number of requests allowed in a burst above rps. */
  burst: number;
  /** Derives the rate-limit key from a request. Defaults to defaultKeyFunc. */
  keyFunc?: (req: Request) => string;
  /** Bucket backend. Defaults to a new in-memory store. */
  store?: RateLimitStore;
}

/** Derives the rate-limit key from X-API-Key, then X-Forwarded-For, then req.ip. */
function defaultKeyFunc(req: Request): string {
  const apiKey = req.headers["x-api-key"];
  if (apiKey) {
    return "key:" + (Array.isArray(apiKey) ? apiKey[0] : apiKey);
  }
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(",")[0]?.trim();
    if (first) {
      return "ip:" + first;
    }
  }
  return "ip:" + (req.ip ?? "unknown");
}

/** Constant bucket key used by RateLimitGlobalGuard — one shared bucket for the whole service. */
const GLOBAL_KEY = "__global__";

/**
 * Returns a per-route NestJS guard (@UseGuards(RateLimitGuard({...}))) enforcing a token-bucket
 * rate limit keyed per caller. Requests over the limit throw a 429 HttpException with
 * { error: "rate limit exceeded" }.
 */
export function RateLimitGuard(opts: RateLimitOptions): new (...args: unknown[]) => CanActivate {
  @Injectable()
  class Guard implements CanActivate {
    private readonly store: RateLimitStore = opts.store ?? new MemoryRateLimitStore(opts.rps, opts.burst);

    canActivate(ctx: ExecutionContext): boolean {
      const req = ctx.switchToHttp().getRequest<Request>();
      const key = (opts.keyFunc ?? defaultKeyFunc)(req);
      if (!this.store.allow(key)) {
        throw new HttpException({ error: "rate limit exceeded" }, HttpStatus.TOO_MANY_REQUESTS);
      }
      return true;
    }
  }
  return Guard;
}

/**
 * Returns a guard enforcing a single, shared token-bucket rate limit across all callers,
 * independent of caller identity — mirrors ts-sentinel's rateLimitGlobal.
 */
export function RateLimitGlobalGuard(
  opts: Omit<RateLimitOptions, "keyFunc">
): new (...args: unknown[]) => CanActivate {
  return RateLimitGuard({ ...opts, keyFunc: () => GLOBAL_KEY });
}
