// Ported from ts-sentinel/src/headers/secure.ts (see that repo for the canonical source) — kept
// in sync by hand, not a live dependency (ts-sentinel is ESM-only, incompatible with this
// package's CJS/NestJS consumers via require()).
//
// ts-sentinel's version wraps a Fetch handler and mutates the Response's headers after `next()`
// resolves. Express doesn't have that "wrap and mutate after" pattern for middleware — instead,
// this sets headers on Express's `res` object proactively, before calling `next()`.
import { NextFunction, Request, Response } from "express";

export interface SecureHeadersOptions {
  /** Overrides the default CSP. Defaults to "default-src 'self'". */
  contentSecurityPolicy?: string;
  /** Overrides the default HSTS value. Defaults to "max-age=63072000; includeSubDomains". */
  strictTransportSecurity?: string;
  /** Overrides X-Frame-Options. Defaults to "DENY". */
  frameOptions?: string;
  /** Overrides Referrer-Policy. Defaults to "strict-origin-when-cross-origin". */
  referrerPolicy?: string;
  /**
   * Sets Permissions-Policy. Not set at all unless provided — there's no
   * safe universal default (which features to restrict is app-specific).
   */
  permissionsPolicy?: string;
}

const DEFAULT_CSP = "default-src 'self'";
const DEFAULT_HSTS = "max-age=63072000; includeSubDomains";
const DEFAULT_FRAME_OPTIONS = "DENY";
const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";

/**
 * Returns Express middleware that sets standard hardening headers on every
 * response: X-Content-Type-Options, X-Frame-Options,
 * Content-Security-Policy, Strict-Transport-Security, Referrer-Policy, and
 * (only if configured) Permissions-Policy. Headers are set before calling
 * `next()`.
 */
export function secureHeadersMiddleware(opts: SecureHeadersOptions = {}) {
  const csp = opts.contentSecurityPolicy || DEFAULT_CSP;
  const hsts = opts.strictTransportSecurity || DEFAULT_HSTS;
  const frameOptions = opts.frameOptions || DEFAULT_FRAME_OPTIONS;
  const referrerPolicy = opts.referrerPolicy || DEFAULT_REFERRER_POLICY;

  return (req: Request, res: Response, next: NextFunction): void => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", frameOptions);
    res.setHeader("Content-Security-Policy", csp);
    res.setHeader("Strict-Transport-Security", hsts);
    res.setHeader("Referrer-Policy", referrerPolicy);
    if (opts.permissionsPolicy) {
      res.setHeader("Permissions-Policy", opts.permissionsPolicy);
    }
    next();
  };
}
