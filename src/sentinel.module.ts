// Single-import composition point for nest-sentinel's global middleware, analogous to
// ts-sentinel/go-sentinel's `chain(...)` — but expressed as a NestJS dynamic module since Nest's
// own DI/module system is how composition idiomatically happens here (see spec.md section 7).
//
// Only traceId and secureHeaders are wired here: both are cross-cutting, safe to apply globally
// to every route, and stateless. Guards (ApiKeyGuard, RateLimitGuard) are intentionally NOT
// wired here — NestJS guards are meant to be scoped per-route/per-controller via `@UseGuards`,
// not applied globally by default, since which routes need auth/rate-limiting is
// application-specific (unlike hardening headers/trace IDs, which are safe defaults everywhere).
import { DynamicModule, MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { traceIdMiddleware, TraceIdOptions } from './traceid';
import { secureHeadersMiddleware, SecureHeadersOptions } from './headers';

export interface SentinelModuleOptions {
  /** If provided, applies traceIdMiddleware globally with these options. */
  traceId?: TraceIdOptions;
  /** If provided, applies secureHeadersMiddleware globally with these options. */
  secureHeaders?: SecureHeadersOptions;
}

/**
 * Dynamic module wiring nest-sentinel's global, stateless middleware. Import via
 * `SentinelModule.forRoot({ traceId: {...}, secureHeaders: {...} })` in `AppModule`'s
 * `imports`. Either key is optional — omit one to skip applying that middleware entirely.
 *
 * `forRoot` returns a per-call subclass capturing `config` in a closure rather than threading it
 * through Nest's DI container: `configure()` runs on the module class instance directly, before
 * NestJS's own provider-resolution semantics are relevant here, so a closure is the simplest
 * correct way to get `config` from `forRoot` into `configure` for this instance.
 */
@Module({})
export class SentinelModule implements NestModule {
  static forRoot(config: SentinelModuleOptions): DynamicModule {
    @Module({})
    class SentinelModuleForRoot implements NestModule {
      configure(consumer: MiddlewareConsumer): void {
        if (config.traceId !== undefined) {
          consumer.apply(traceIdMiddleware(config.traceId)).forRoutes('*');
        }
        if (config.secureHeaders !== undefined) {
          consumer.apply(secureHeadersMiddleware(config.secureHeaders)).forRoutes('*');
        }
      }
    }

    return { module: SentinelModuleForRoot };
  }

  configure(_consumer: MiddlewareConsumer): void {
    // No-op on the base class — real wiring happens on the per-call subclass returned by
    // forRoot(), which is what NestJS actually instantiates when a consumer imports
    // `SentinelModule.forRoot(...)`.
  }
}
