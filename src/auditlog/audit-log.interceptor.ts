// NestJS port of ts-sentinel's src/auditlog/auditlog.ts: emits one structured,
// optionally tamper-evident AuditLogEntry per request at response time (status
// code known), distinct from `traceId` (correlation only, no persistence/
// tamper-evidence). This module never persists on its own — the consumer
// supplies a `sink` and wires it to console/file/remote storage as needed.
// Design rationale: NIST SP 800-92, OWASP Logging Vocabulary/Cheat Sheet,
// PCI-DSS Req.10, Schneier-Kelsey hash-chaining, GDPR IP-retention guidance.
//
// Implemented as a NestJS interceptor (response-only, needs the status code —
// matches how TimeoutInterceptor already works in this package) rather than
// Express middleware: Express middleware runs before the handler and can't
// easily observe the final status code the way an interceptor's
// tap/catchError on the response Observable can.
import { CallHandler, ExecutionContext, HttpException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID, createHash } from 'crypto';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';

export type ActorType = 'user' | 'service' | 'anonymous';

export interface Actor {
  id: string | null;
  type: ActorType;
}

export interface AuditLogEntry {
  schema_version: '1.0';
  event_id: string;
  timestamp: string; // RFC3339
  trace_id?: string;
  actor: Actor;
  http: {
    method: string;
    path: string; // query stripped by default
    status_code: number;
  };
  network: {
    source_ip: string;
    user_agent: string;
  };
  outcome: 'success' | 'failure' | 'denied';
  detail?: string;
  prev_hash?: string;
  entry_hash?: string;
}

export type IpMode = 'full' | 'truncated' | 'hashed';

export interface AuditLogOptions {
  /** Emits the finished entry. Required — this module never persists on its own. */
  sink: (entry: AuditLogEntry) => void | Promise<void>;
  /**
   * Derives actor identity from the request. Defaults to always
   * `{id: null, type: "anonymous"}` — since only the consuming app knows its
   * auth scheme, THIS MUST BE SUPPLIED for actor identity to be meaningful.
   */
  resolveActor?: (req: Request) => Actor | Promise<Actor>;
  /** Defaults to "truncated" (GDPR-informed default per research). */
  ipMode?: IpMode;
  /** Enables Schneier-Kelsey hash-chaining (prev_hash/entry_hash). Default false. */
  tamperEvident?: boolean;
  /** Strip query string from http.path. Default true. */
  stripQuery?: boolean;
  /** Maximum length for sanitized path/user-agent fields before truncation. Default 512. */
  maxFieldLength?: number;
}

const DEFAULT_ACTOR: Actor = { id: null, type: 'anonymous' };

/** Module-scope hash-chain state: one chain per process lifetime (see README). */
let prevHash = '';

/**
 * Returns a NestInterceptor class that emits one structured `AuditLogEntry`
 * per request via `opts.sink`, at response time (after the handler settles,
 * since the status code isn't known beforehand). Both the success path and
 * an uncaught-exception path emit an entry — the original error is always
 * rethrown after emitting, so this interceptor never swallows real errors.
 *
 * Apply via `@UseInterceptors(AuditLogInterceptor({...}))` per-route/per-
 * controller, or globally via `SentinelModule.forRoot({ auditLog: {...} })`.
 */
export function AuditLogInterceptor(opts: AuditLogOptions): new (...args: unknown[]) => NestInterceptor {
  const ipMode = opts.ipMode ?? 'truncated';
  const stripQuery = opts.stripQuery ?? true;
  const maxFieldLength = opts.maxFieldLength ?? 512;
  const tamperEvident = opts.tamperEvident ?? false;
  const resolveActor = opts.resolveActor ?? (() => DEFAULT_ACTOR);

  @Injectable()
  class Interceptor implements NestInterceptor {
    intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
      const req = ctx.switchToHttp().getRequest<Request>();
      const res = ctx.switchToHttp().getResponse<Response>();

      return next.handle().pipe(
        tap({
          next: () => {
            void emit(req, res.statusCode, undefined);
          },
        }),
        catchError((err) => {
          const status = err instanceof HttpException ? err.getStatus() : 500;
          void emit(req, status, err);
          return throwError(() => err);
        }),
      );
    }
  }

  async function emit(req: Request, statusCode: number, err: unknown): Promise<void> {
    try {
      const entry = await buildEntry(req, statusCode, err, {
        ipMode,
        stripQuery,
        maxFieldLength,
        resolveActor,
      });

      if (tamperEvident) {
        const { entry_hash, prev_hash, ...withoutHashes } = entry;
        void entry_hash;
        void prev_hash;
        const hash = computeEntryHash(withoutHashes, prevHash);
        entry.prev_hash = prevHash;
        entry.entry_hash = hash;
        prevHash = hash;
      }

      await opts.sink(entry);
    } catch (sinkErr) {
      console.error('auditLog: sink failed', sinkErr);
    }
  }

  return Interceptor;
}

interface BuildOpts {
  ipMode: IpMode;
  stripQuery: boolean;
  maxFieldLength: number;
  resolveActor: (req: Request) => Actor | Promise<Actor>;
}

async function buildEntry(
  req: Request,
  statusCode: number,
  err: unknown,
  opts: BuildOpts,
): Promise<AuditLogEntry> {
  const rawPath = opts.stripQuery ? req.path : req.originalUrl ?? req.url;
  const path = sanitizeField(rawPath ?? '', opts.maxFieldLength);

  const rawUserAgent = req.headers['user-agent'];
  const userAgentValue = Array.isArray(rawUserAgent) ? rawUserAgent[0] : rawUserAgent ?? '';
  const userAgent = sanitizeField(userAgentValue, opts.maxFieldLength);

  const rawIp = extractIp(req);
  const sourceIp = applyIpMode(rawIp, opts.ipMode);

  const actor = await opts.resolveActor(req);

  const entry: AuditLogEntry = {
    schema_version: '1.0',
    event_id: randomUUID(),
    timestamp: new Date().toISOString(),
    actor,
    http: {
      method: req.method,
      path,
      status_code: statusCode,
    },
    network: {
      source_ip: sourceIp,
      user_agent: userAgent,
    },
    outcome: deriveOutcome(statusCode),
  };

  if (err instanceof Error) {
    entry.detail = err.message;
  }

  const traceIdHeader = req.headers['x-request-id'];
  const traceIdValue = Array.isArray(traceIdHeader) ? traceIdHeader[0] : traceIdHeader;
  if (traceIdValue) {
    entry.trace_id = traceIdValue;
  }

  return entry;
}

/**
 * Derives the client IP the same way `ratelimit.guard.ts`'s `defaultKeyFunc`
 * does for the IP portion (X-Forwarded-For first entry, then req.ip) —
 * intentionally duplicated rather than shared: the two modules have subtly
 * different needs (this one never considers an API key), and factoring a
 * few-line function out would create an awkward cross-module dependency for
 * no real reuse benefit.
 */
function extractIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded).split(',')[0]?.trim();
    if (first) {
      return first;
    }
  }
  return req.ip ?? 'unknown';
}

function applyIpMode(ip: string, mode: IpMode): string {
  if (ip === 'unknown') {
    return ip;
  }
  switch (mode) {
    case 'full':
      return ip;
    case 'truncated':
      return truncateIp(ip);
    case 'hashed':
      return hashIp(ip);
  }
}

/**
 * Pseudonymizes an IP address by zeroing the last IPv4 octet or the last 80
 * bits (5 groups) of IPv6 — standard truncation pattern for GDPR-informed
 * logging defaults. Falls back to returning the input unchanged if it
 * doesn't parse as a recognizable IPv4/IPv6 literal.
 */
function truncateIp(ip: string): string {
  const ipv4Parts = ip.split('.');
  if (ipv4Parts.length === 4 && ipv4Parts.every((p) => /^\d{1,3}$/.test(p))) {
    return `${ipv4Parts[0]}.${ipv4Parts[1]}.${ipv4Parts[2]}.0`;
  }
  if (ip.includes(':')) {
    const groups = ip.split(':');
    const kept = groups.slice(0, 3);
    while (kept.length < 8) {
      kept.push('0');
    }
    return kept.join(':');
  }
  return ip;
}

/**
 * SHA-256 hash of the raw IP via Node's stdlib `crypto`. One-way, but NOT
 * anonymization in the GDPR sense (a hash of a bounded input space is
 * trivially reversible by dictionary/rainbow-table attack); this mode is
 * documented as pseudonymization, not anonymization.
 */
function hashIp(ip: string): string {
  return createHash('sha256').update(ip).digest('hex');
}

/**
 * Strips control characters (CR/LF and other C0/C1 control codes) from a
 * field to prevent log-injection (OWASP), then caps its length to
 * `maxLength`. Must run before the entry object is built, not after.
 */
function sanitizeField(value: string, maxLength: number): string {
  // eslint-disable-next-line no-control-regex
  const stripped = value.replace(/[\x00-\x1F\x7F-\x9F]/g, '');
  return stripped.length > maxLength ? stripped.slice(0, maxLength) : stripped;
}

/** status < 400 -> success; 401/403 -> denied; other >= 400 -> failure. */
function deriveOutcome(status: number): 'success' | 'failure' | 'denied' {
  if (status < 400) {
    return 'success';
  }
  if (status === 401 || status === 403) {
    return 'denied';
  }
  return 'failure';
}

function computeEntryHash(entryWithoutHashes: Omit<AuditLogEntry, 'entry_hash' | 'prev_hash'>, prev: string): string {
  return createHash('sha256').update(JSON.stringify(entryWithoutHashes) + prev).digest('hex');
}
