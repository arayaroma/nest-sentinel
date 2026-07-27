// Request-correlation ID middleware (supports OWASP A09: Security Logging
// and Monitoring Failures — not a mitigation itself, but gives every log
// line across the middleware/handler chain a correlatable ID). Same design
// as ts-sentinel's src/traceid/traceid.ts and go-sentinel's traceid.TraceID,
// ported to Express's synchronous `(req, res, next)` middleware signature
// instead of ts-sentinel's async Fetch-Handler wrapper.
//
// Extracts an inbound X-Request-ID (or X-Trace-ID as a read-only alias) if
// present, otherwise generates one via Node's native crypto.randomUUID()
// (Node 18+, no dependency needed). The response header is set BEFORE
// calling next() — mirroring go-sentinel's rationale that Express, like
// Go's http.ResponseWriter, only allows header mutation prior to the
// response being sent, so setting it here guarantees it survives a
// downstream short-circuit (e.g. a 429 from a rate limiter or an unhandled
// error later in the chain).
import { randomUUID } from 'crypto';
import type { NextFunction, Request, Response } from 'express';

export interface TraceIdOptions {
  /** Header to read/write. Defaults to "X-Request-ID". */
  header?: string;
  /** ID generator. Defaults to crypto.randomUUID(). */
  generate?: () => string;
}

/**
 * Returns Express middleware that propagates a request-correlation ID:
 * preserves an inbound X-Request-ID/X-Trace-ID or generates one, sets it on
 * `req.headers[header]` (so downstream handlers read it the same way as any
 * other header), and always sets it on the outgoing response header before
 * calling `next()`.
 */
export function traceIdMiddleware(opts: TraceIdOptions = {}): (req: Request, res: Response, next: NextFunction) => void {
  const header = opts.header ?? 'X-Request-ID';
  const headerKey = header.toLowerCase();
  const generate = opts.generate ?? (() => randomUUID());

  return (req: Request, res: Response, next: NextFunction): void => {
    const inbound = req.headers[headerKey] ?? req.headers['x-trace-id'];
    const id = (Array.isArray(inbound) ? inbound[0] : inbound) || generate();

    req.headers[headerKey] = id;
    res.setHeader(header, id);

    next();
  };
}
