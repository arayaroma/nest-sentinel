// Single-import composition point for nest-sentinel's global middleware, analogous to
// ts-sentinel/go-sentinel's `chain(...)` — but expressed as a NestJS dynamic module since Nest's
// own DI/module system is how composition idiomatically happens here (see spec.md section 7).
//
// Only traceId and secureHeaders are wired here: both are cross-cutting, safe to apply globally
// to every route, and stateless. Guards (ApiKeyGuard, RateLimitGuard) are intentionally NOT
// wired here — NestJS guards are meant to be scoped per-route/per-controller via `@UseGuards`,
// not applied globally by default, since which routes need auth/rate-limiting is
// application-specific (unlike hardening headers/trace IDs, which are safe defaults everywhere).
import { DynamicModule, MiddlewareConsumer, Module, NestModule, Provider } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { traceIdMiddleware, TraceIdOptions } from './traceid';
import { secureHeadersMiddleware, SecureHeadersOptions } from './headers';
import { AuditLogInterceptor, AuditLogOptions } from './auditlog';

export interface SentinelModuleOptions {
  /** If provided, applies traceIdMiddleware globally with these options. */
  traceId?: TraceIdOptions;
  /** If provided, applies secureHeadersMiddleware globally with these options. */
  secureHeaders?: SecureHeadersOptions;
  /**
   * If provided, registers AuditLogInterceptor globally as an APP_INTERCEPTOR
   * — unlike RateLimitGuard/ApiKeyGuard (deliberately per-route opt-in, see
   * module doc above), most consumers want every request audited, not a
   * manually-curated subset, so audit logging defaults to global-by-default
   * here when this key is supplied.
   */
  auditLog?: AuditLogOptions;
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

    const providers: Provider[] = [];
    if (config.auditLog !== undefined) {
      const AuditLogInterceptorClass = AuditLogInterceptor(config.auditLog);
      providers.push({
        provide: APP_INTERCEPTOR,
        useValue: new AuditLogInterceptorClass(),
      });
    }

    // APP_INTERCEPTOR (like APP_GUARD/APP_FILTER) is a special multi-provider token NestJS
    // registers globally the moment it's declared in ANY loaded module's `providers` — it must
    // NOT also be re-exported (Nest throws UnknownExportException: "cannot export a
    // provider/module that is not a part of the currently processed module" if you try).
    return { module: SentinelModuleForRoot, providers, exports: [] };
  }

  configure(_consumer: MiddlewareConsumer): void {
    // No-op on the base class — real wiring happens on the per-call subclass returned by
    // forRoot(), which is what NestJS actually instantiates when a consumer imports
    // `SentinelModule.forRoot(...)`.
  }
}
