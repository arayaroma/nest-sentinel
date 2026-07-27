# nest-sentinel

A NestJS port of [ts-sentinel](https://github.com/arayaroma/ts-sentinel), providing baseline HTTP
security building blocks — API key auth, rate limiting, request timeout, secure headers,
trace-id propagation, and input validation — as idiomatic Nest guards, middleware, and
interceptors. Third sibling in the sentinel family, alongside
[ts-sentinel](https://github.com/arayaroma/ts-sentinel) (Fetch-API runtimes: Astro, Cloudflare
Workers, Deno, Bun, Node) and [go-sentinel](https://github.com/arayaroma/go-sentinel) (Go's
`net/http`) — same design, same config shapes, ported to each platform's idioms.

## Install

```bash
npm install nest-sentinel
```

Peer dependencies (already present in any NestJS/Express app): `@nestjs/common`,
`@nestjs/core`, `express`, `reflect-metadata`, `rxjs`.

## What's included

| Module | Guard / Middleware / Interceptor | Purpose | OWASP |
|---|---|---|---|
| `traceid` | `traceIdMiddleware` | Request-correlation ID, propagated across the middleware chain and echoed on the response. | A09 |
| `headers` | `secureHeadersMiddleware` | Standard hardening headers (CSP, HSTS, X-Frame-Options, etc). | A05 |
| `auth` | `ApiKeyGuard` | Constant-time API key check (`crypto.timingSafeEqual`), multi-key rotation. | A07 |
| `ratelimit` | `RateLimitGuard` | Token-bucket rate limiting, per-key/IP. | A04 |
| `resource` | `TimeoutInterceptor` | Per-request wall-clock timeout (RxJS `timeout` operator). | resource exhaustion (A05-adjacent) |
| `validate` | `nonEmpty`, `maxLength`, `oneOf` | Handler-boundary input validation. | A03 |
| `auditlog` | `AuditLogInterceptor` + `AuditLogExceptionFilter` | Structured, optionally tamper-evident who/what/when/how audit trail per request, emitted to a pluggable `sink`. Both halves are needed — see below. | A09 (A08 with `tamperEvident: true`) |
| `sentinel` | `SentinelModule` | Single-import wiring for the global, stateless middleware (`traceid`, `headers`, and — if configured — `auditlog`). | — |

See [`docs/owasp-coverage.md`](docs/owasp-coverage.md) for the full OWASP Top 10 (2021) mapping.

## Reference wiring

`traceIdMiddleware` and `secureHeadersMiddleware` are cross-cutting and safe to apply globally, so
`SentinelModule.forRoot()` wires them for every route via `AppModule`'s `imports`. `ApiKeyGuard`
and `RateLimitGuard` stay scoped per-controller/per-route via `@UseGuards`, consistent with how
NestJS guards are meant to be applied (not global-by-default the way middleware is) — which
routes need auth/rate-limiting is application-specific. `TimeoutInterceptor` is likewise applied
per-controller/route via `@UseInterceptors`.

`SentinelModule.forRoot({ auditLog: {...} })` wires BOTH `AuditLogInterceptor` (as an
`APP_INTERCEPTOR`, success-path entries) AND `AuditLogExceptionFilter` (as an `APP_FILTER`,
failure-path entries) — you need both, not just the interceptor. Reason: NestJS runs
Guards → Interceptors → Pipes → Handler, so an exception a **Guard** throws (e.g. `AuthGuard`
rejecting an unauthenticated request with 401) short-circuits *before* any interceptor's
`intercept()` is ever called — an interceptor alone structurally cannot see that class of event,
which is exactly the audit signal (repeated 401s on protected routes, brute-force-adjacent
patterns) this module exists to capture. `AuditLogExceptionFilter`, registered globally, is the
one place in Nest's request lifecycle that sees exceptions from Guards/Pipes/Interceptors/
Handlers uniformly.

**Important:** registering `AuditLogExceptionFilter` globally replaces Nest's built-in exception
handling app-wide. It reproduces the same response shape (`HttpException.getResponse()`, or
`{statusCode: 500, message: "Internal server error"}` for unknown errors) so existing error
responses don't change shape as a side effect of enabling audit logging — but if you register
your own global exception filter elsewhere too, only the last-registered one wins; don't
double-register.

Unlike the guards, most consumers want *every* request audited rather than a manually-curated
subset, so both halves default to global-by-default when the `auditLog` key is supplied (omit the
key to skip audit logging entirely; apply `AuditLogInterceptor({...})`/`AuditLogExceptionFilter({...})`
per-route instead if you want a curated subset — though a per-route filter still only fires for
routes it's actually reached, so it can't recover the Guard-rejection case either unless applied
globally).

```ts
// app.module.ts
import { Module } from '@nestjs/common';
import { SentinelModule } from 'nest-sentinel';

@Module({
  imports: [
    SentinelModule.forRoot({
      traceId: {}, // defaults: reads/generates X-Request-ID
      secureHeaders: {
        permissionsPolicy: 'geolocation=(), microphone=()',
      },
      auditLog: {
        sink: async (entry) => console.log(JSON.stringify(entry)),
        resolveActor: (req) => getActorFromJwt(req), // supply for meaningful actor identity
      },
    }),
  ],
})
export class AppModule {}
```

```ts
// users.controller.ts
import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiKeyGuard, RateLimitGuard, TimeoutInterceptor } from 'nest-sentinel';

@Controller('users')
@UseGuards(
  RateLimitGuard({ rps: 5 / 60, burst: 5 }),
  ApiKeyGuard({ validKeys: [process.env.API_KEY!] }),
)
@UseInterceptors(TimeoutInterceptor(5000))
export class UsersController {
  @Get()
  findAll() {
    return { ok: true };
  }
}
```

`RateLimitGuard`/`ApiKeyGuard` are factory functions returning a guard class — same pattern as
`@nestjs/throttler`'s decorators, but with ts-sentinel-identical config shape (`rps`/`burst` for
rate limiting, `validKeys` for API keys) for consumers who want config parity across the sentinel
family instead of `@nestjs/throttler`'s own shape.

## Why no dependency on ts-sentinel

`ts-sentinel` ships as pure ESM (`"type": "module"`). NestJS/webpack backends are predominantly
CJS. A real `dependencies` entry on `ts-sentinel` would make `nest-sentinel` throw
`ERR_REQUIRE_ESM` for any consumer resolving it via `require()`/CJS module resolution — a real,
not theoretical, dual-package-hazard footgun for a security-critical dependency. Instead, the two
genuinely framework-agnostic pieces are **ported** (copied and adapted, credited in a source
comment), not live-shared:

- `src/validate/validate.ts` — `nonEmpty`/`maxLength`/`oneOf`/`ValidationError`, byte-identical
  logic to `ts-sentinel/src/validate/validate.ts`.
- `src/ratelimit/store.ts` — the token-bucket core (`MemoryRateLimitStore`), byte-identical logic
  to `ts-sentinel/src/ratelimit/ratelimit.ts`'s `Bucket`/`MemoryRateLimitStore`.

This is a deliberate tradeoff: a small manual-sync cost (keep these two files in sync by hand if
either sentinel changes) in exchange for zero ESM/CJS interop risk for every consumer. Everything
else (`ApiKeyGuard`, `SecureHeadersMiddleware`, `TimeoutInterceptor`, `TraceIdMiddleware`) is a
fresh, idiomatic-Nest implementation — not a port — since Express/Nest's request/response and
RxJS-observable models don't map 1:1 onto ts-sentinel's Fetch `Request`/`Response` wrapping.

## Body size limits: no `maxBodyBytes` module

Unlike ts-sentinel's `maxBodyBytes`, nest-sentinel does not ship a body-size-limit module — Nest
on Express already has a native, better-tested way to do this via `body-parser`'s `limit` option,
and duplicating it would just be a worse reimplementation. Configure it in `main.ts`:

```ts
// main.ts
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.useBodyParser('json', { limit: '1mb' });
  app.useBodyParser('urlencoded', { limit: '1mb', extended: true });
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

`useBodyParser` (current in Nest 10/11) lets you override the limit for the registered parsers
without disabling Nest's default body-parsing setup. If you need a parser Nest doesn't register
by default (e.g. `text` or `raw`), register it explicitly with the same method — see the
[NestJS FAQ on raw body/body parsers](https://docs.nestjs.com/faq/raw-body) — or, for full manual
control, pass `{ bodyParser: false }` to `NestFactory.create` and wire `express.json({ limit })`
etc. yourself before Nest's routing takes over.

## What `AuditLogInterceptor` deliberately does not do

- **No persistence.** `AuditLogInterceptor` never writes to disk, a database, or a remote log
  service itself — it hands a structured `AuditLogEntry` to the `sink` you supply, and you wire
  that to console/file/remote storage. This keeps nest-sentinel dependency-free and lets you reuse
  whatever logging infrastructure you already have.
- **No Merkle-tree checkpoints.** Tamper-evidence in v1 is a linear Schneier-Kelsey hash chain
  (`tamperEvident: true` — each entry's `entry_hash` folds in the previous entry's hash), which is
  enough to detect any modification or reordering of a single instance's log stream. Merkle-tree
  checkpointing (as used by Certificate Transparency, for independently-verifiable audit proofs
  across many logs) is a higher-assurance mechanism deferred until a real consumer need emerges.
  Note also that the hash chain is module-scope, per-process state: a restart starts a fresh chain
  from an empty `prev_hash`, which is a detectable, honest boundary rather than a bug.
- **No retention enforcement.** `AuditLogInterceptor` emits entries; how long they're kept, when
  they're purged, and how access to them is controlled is the sink/storage layer's responsibility,
  not this module's.

This design follows research on audit-log design covering NIST SP 800-92, the OWASP Logging
Vocabulary Cheat Sheet, PCI-DSS Req.10, Schneier-Kelsey hash-chaining, and GDPR IP-retention
guidance (informing the `truncated` default for `ipMode`) — same rationale as ts-sentinel's
`auditLog`, ported to NestJS's interceptor model.

## Testing

```bash
npm run build
npm run typecheck
npm test
```

## Non-goals

- Not a framework or router — built on top of NestJS, not a replacement for any of it.
- Not a billing/alerting dashboard.
- Not user/session identity management — scope is API-key-style service auth.
- No Fastify adapter support in v1 (Express only) — see `.sdd/changes/nest-sentinel-v1/proposal.md`.
