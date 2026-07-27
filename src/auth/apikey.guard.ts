// Ported from ts-sentinel/src/auth/apikey.ts's isValidKey/constantTimeEqual (see that repo for
// the canonical source) — kept in sync by hand, not a live dependency (ts-sentinel is ESM-only,
// incompatible with this package's CJS/NestJS consumers via require()).
//
// Unlike ts-sentinel (which targets any Fetch-API runtime and so uses Web Crypto's subtle digest
// for constant-time comparison), this package targets Node/NestJS specifically, so it uses
// Node's built-in `crypto.timingSafeEqual` directly.
import { timingSafeEqual } from "node:crypto";
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException, Type } from "@nestjs/common";
import { Request } from "express";

export interface ApiKeyGuardOptions {
  /** Header carrying the API key. Defaults to "X-API-Key" (case-insensitive, per Express). */
  header?: string;
  /** Set of keys accepted as valid. Multiple keys allow zero-downtime rotation. */
  validKeys: string[];
}

const DEFAULT_HEADER = "x-api-key";

/**
 * Constant-time comparison of two strings using Node's `crypto.timingSafeEqual`.
 * `timingSafeEqual` throws if the two buffers differ in length, so unequal-length
 * inputs are compared against a same-length, zero-padded copy first — this keeps
 * the comparison itself constant-time-ish while never throwing, and every valid
 * key is still checked regardless of whether an earlier one matched, so the
 * overall check doesn't short-circuit in a way that would leak which key (if any)
 * matched via timing.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);

  if (bufA.length !== bufB.length) {
    // Compare `a` against itself (always same length) so this branch still
    // performs a timingSafeEqual call, then report the true (unequal) result.
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

function isValidKey(key: string, validKeys: string[]): boolean {
  let found = false;
  for (const valid of validKeys) {
    // Always compare against every configured key (not short-circuiting on
    // match) to keep timing independent of which key, if any, matches.
    if (constantTimeEqual(key, valid)) {
      found = true;
    }
  }
  return found;
}

/**
 * Returns a NestJS guard class that rejects requests whose API key (read from
 * opts.header, or X-API-Key by default) does not match one of
 * opts.validKeys. Comparison is constant-time to avoid timing attacks.
 * Missing or mismatching keys fail closed with 401 and a JSON body
 * {"error": "unauthorized"}.
 */
export function ApiKeyGuard(opts: ApiKeyGuardOptions): Type<CanActivate> {
  const header = (opts.header || DEFAULT_HEADER).toLowerCase();

  @Injectable()
  class ApiKeyGuardImpl implements CanActivate {
    canActivate(context: ExecutionContext): boolean {
      const req = context.switchToHttp().getRequest<Request>();
      const rawKey = req.headers[header];
      const key = Array.isArray(rawKey) ? rawKey[0] : rawKey;

      if (!key || !isValidKey(key, opts.validKeys)) {
        throw new UnauthorizedException({ error: "unauthorized" });
      }
      return true;
    }
  }

  return ApiKeyGuardImpl;
}
