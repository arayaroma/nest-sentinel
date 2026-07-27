// Shared entry-building logic between AuditLogInterceptor (success path) and
// AuditLogExceptionFilter (failure path — see that file's header comment for
// why a filter, not just the interceptor's catchError, is needed to see
// Guard-rejected requests). Both need the exact same field derivation and
// hash-chain sequence, so this is factored out rather than duplicated.
import type { Request } from 'express';
import { randomUUID, createHash } from 'crypto';

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

export const DEFAULT_ACTOR: Actor = { id: null, type: 'anonymous' };

/**
 * Module-scope hash-chain state, SHARED across the interceptor (success
 * entries) and exception filter (failure entries) so one chain covers the
 * whole request stream regardless of which of the two emitted a given
 * entry. One chain per process lifetime (see README).
 */
let prevHash = '';

export interface ResolvedOptions {
  sink: (entry: AuditLogEntry) => void | Promise<void>;
  ipMode: IpMode;
  stripQuery: boolean;
  maxFieldLength: number;
  tamperEvident: boolean;
  resolveActor: (req: Request) => Actor | Promise<Actor>;
}

export function resolveOptions(opts: AuditLogOptions): ResolvedOptions {
  return {
    sink: opts.sink,
    ipMode: opts.ipMode ?? 'truncated',
    stripQuery: opts.stripQuery ?? true,
    maxFieldLength: opts.maxFieldLength ?? 512,
    tamperEvident: opts.tamperEvident ?? false,
    resolveActor: opts.resolveActor ?? (() => DEFAULT_ACTOR),
  };
}

export async function emitEntry(
  req: Request,
  statusCode: number,
  err: unknown,
  opts: ResolvedOptions,
): Promise<void> {
  try {
    const entry = await buildEntry(req, statusCode, err, opts);

    if (opts.tamperEvident) {
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

async function buildEntry(
  req: Request,
  statusCode: number,
  err: unknown,
  opts: ResolvedOptions,
): Promise<AuditLogEntry> {
  const rawPath = opts.stripQuery ? req.path : (req.originalUrl ?? req.url);
  const path = sanitizeField(rawPath ?? '', opts.maxFieldLength);

  const rawUserAgent = req.headers['user-agent'];
  const userAgentValue = Array.isArray(rawUserAgent) ? rawUserAgent[0] : (rawUserAgent ?? '');
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
