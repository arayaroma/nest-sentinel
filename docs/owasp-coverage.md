# OWASP Top 10 (2021) Coverage

How nest-sentinel maps to each OWASP Top 10 2021 category: a shipped guard/middleware/interceptor,
a documented caller responsibility, or explicitly out of scope. Mirrors ts-sentinel's and
go-sentinel's coverage docs, NestJS naming.

| # | Category | Coverage |
|---|----------|----------|
| A01 | Broken Access Control | Caller responsibility. `ApiKeyGuard` authenticates the caller but authorization (which keys/identities may access which resources) is application-specific routing/RBAC logic outside nest-sentinel's scope. |
| A02 | Cryptographic Failures | Out of scope for v1. nest-sentinel does not handle data at rest or TLS termination (the platform's/reverse-proxy's job); `SecureHeadersMiddleware`'s `Strict-Transport-Security` header does enforce HTTPS on the client side once TLS is present. |
| A03 | Injection | `validate` module (`nonEmpty`, `maxLength`, `oneOf`) reduces malformed-input surface at the handler boundary. Caller responsibility for the rest: use parameterized queries/an ORM's query builder — nest-sentinel does not touch persistence. |
| A04 | Insecure Design | `RateLimitGuard` addresses one concrete insecure-design failure mode (unbounded request volume per caller) at the guard level; broader architecture-level design guidance is this document and the README's reference wiring, same as the other sentinel siblings. |
| A05 | Security Misconfiguration | `SecureHeadersMiddleware` (nosniff, frame options, CSP, HSTS, referrer policy). `TimeoutInterceptor` guards against a resource-exhaustion misconfiguration (unbounded handler wall-clock time); body-size misconfiguration is documented as a caller responsibility via Express's native `body-parser` `limit` (see README) rather than a custom module. |
| A06 | Vulnerable and Outdated Components | Out of scope for v1's runtime, but structurally addressed: nest-sentinel's own runtime dependencies are limited to NestJS/Express/RxJS peer deps it already requires anyway — no extra third-party surface beyond that. Caller responsibility to keep dependencies patched (`npm audit`). |
| A07 | Identification and Authentication Failures | `ApiKeyGuard` — constant-time key comparison (`crypto.timingSafeEqual`, timing-attack resistant), fails closed (401) on missing/invalid keys, supports multi-key rotation. |
| A08 | Software and Data Integrity Failures | Partially addressed: `AuditLogInterceptor`'s optional `tamperEvident: true` hash-chaining (Schneier-Kelsey) makes the emitted audit trail tamper-evident — any modification or reordering of a single instance's log stream breaks the `prev_hash`/`entry_hash` linkage. This covers integrity of the log stream itself, not deserialization or CI/CD supply-chain surface, which remain out of scope for v1. |
| A09 | Security Logging and Monitoring Failures | Direct hit: `AuditLogInterceptor` emits a structured `AuditLogEntry` per request (actor, method, path, status, source IP, outcome) to a caller-supplied `sink`, composing with `TraceIdMiddleware`'s correlation ID (read from `X-Request-ID`, omitted if absent — never fabricated). `TraceIdMiddleware` itself remains a supporting mechanism only (propagates a request-correlation ID across the chain, echoed on the response — including short-circuited 401/429/408s — so logs for a single request can be correlated end to end); `AuditLogInterceptor` is the actual logging/monitoring mitigation. Caller responsibility: wire `sink` to real storage, and supply `resolveActor` for meaningful actor identity (the default is always `{id: null, type: "anonymous"}`). |
| A10 | Server-Side Request Forgery (SSRF) | Out of scope — nest-sentinel never makes outbound requests on the application's behalf. Caller responsibility for any outbound HTTP calls the service itself makes. |

## Notes

- "Caller responsibility" items are intentionally not guards/middleware: they require
  application/business-logic context (which query, which route, which outbound call) that a
  generic library can't safely supply.
- "Out of scope" items are flagged rather than silently omitted, so adopters know a shipped
  `ApiKeyGuard`/`RateLimitGuard`/`SecureHeadersMiddleware` stack is not a complete security
  program by itself.
- `RateLimitGlobalGuard` (same module) mirrors ts-sentinel's `rateLimitGlobal` — a single shared
  aggregate cap independent of caller identity, for closing the gap where a distributed caller
  spreads requests across many keys/IPs each individually under the per-key limit.
