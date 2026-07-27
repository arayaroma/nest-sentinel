// NestJS port of ts-sentinel's src/auditlog/auditlog.ts: emits one structured,
// optionally tamper-evident AuditLogEntry per request at response time (status
// code known), distinct from `traceId` (correlation only, no persistence/
// tamper-evidence). This module never persists on its own — the consumer
// supplies a `sink` and wires it to console/file/remote storage as needed.
// Design rationale: NIST SP 800-92, OWASP Logging Vocabulary/Cheat Sheet,
// PCI-DSS Req.10, Schneier-Kelsey hash-chaining, GDPR IP-retention guidance.
//
// SUCCESS PATH ONLY. Failures (including exceptions Guards/Pipes throw before
// the handler ever runs — e.g. AuthGuard rejecting an unauthenticated request
// with 401) are handled by `AuditLogExceptionFilter` instead: NestJS runs
// Guards -> Interceptors -> Pipes -> Handler, so a Guard-thrown exception
// short-circuits BEFORE this interceptor's `intercept()` is ever called — an
// interceptor alone structurally cannot see that class of event, which is
// exactly the audit signal (repeated 401s on protected routes) this module
// exists to capture. Both halves share hash-chain state (audit-log.core.ts)
// so one chain covers the whole request stream regardless of which emitted
// a given entry.
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { tap } from 'rxjs/operators';
import { AuditLogOptions, emitEntry, resolveOptions } from './audit-log.core';

export type { ActorType, Actor, AuditLogEntry, IpMode, AuditLogOptions } from './audit-log.core';

/**
 * Returns a NestInterceptor class that emits one structured `AuditLogEntry`
 * via `opts.sink` for every request that completes successfully (status code
 * known once the handler settles). See the module-level comment above for
 * why failures are NOT handled here — pair this with `AuditLogExceptionFilter`
 * (or use `SentinelModule.forRoot({ auditLog: {...} })`, which wires both).
 *
 * Apply via `@UseInterceptors(AuditLogInterceptor({...}))` per-route/per-
 * controller, or globally via `SentinelModule.forRoot({ auditLog: {...} })`.
 */
export function AuditLogInterceptor(opts: AuditLogOptions): new (...args: unknown[]) => NestInterceptor {
  const resolved = resolveOptions(opts);

  @Injectable()
  class Interceptor implements NestInterceptor {
    intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
      const req = ctx.switchToHttp().getRequest<Request>();
      const res = ctx.switchToHttp().getResponse<Response>();

      return next.handle().pipe(
        tap({
          next: () => {
            void emitEntry(req, res.statusCode, undefined, resolved);
          },
        }),
      );
    }
  }

  return Interceptor;
}
