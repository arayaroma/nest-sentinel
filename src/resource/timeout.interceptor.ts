// Bounds per-request wall-clock time. NestJS sibling of ts-sentinel's
// resource/timeout.ts (Fetch-API Promise-racing) and go-sentinel's
// resource.WithTimeout — this is a NEW idiomatic-Nest implementation, not a
// port: NestJS interceptors operate on RxJS Observables, so we use RxJS's
// own `timeout` operator on the handler's observable chain rather than
// racing Promises manually.
//
// Same caveat ts-sentinel's doc comment calls out: a handler that ignores
// the timeout (e.g. one still awaiting a slow downstream call) keeps
// running in the background after this interceptor has already returned
// the error response to the client — RxJS's `timeout` unsubscribes from the
// source observable but cannot forcibly cancel in-flight async work inside
// the handler. Handlers that need real cancellation should accept an
// AbortSignal/CancellationToken of their own; out of scope here.
import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
  RequestTimeoutException,
} from '@nestjs/common';
import { Observable, throwError, TimeoutError } from 'rxjs';
import { catchError, timeout } from 'rxjs/operators';

/**
 * Returns a NestInterceptor class that aborts the request with a 408
 * Request Timeout (`RequestTimeoutException`) if the handler's observable
 * doesn't emit within `ms` milliseconds. Apply via
 * `@UseInterceptors(TimeoutInterceptor(ms))`.
 */
export function TimeoutInterceptor(ms: number): new (...args: unknown[]) => NestInterceptor {
  @Injectable()
  class Interceptor implements NestInterceptor {
    intercept(_ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
      return next.handle().pipe(
        timeout(ms),
        catchError((err) => {
          if (err instanceof TimeoutError) {
            return throwError(() => new RequestTimeoutException('request timeout'));
          }
          return throwError(() => err);
        }),
      );
    }
  }
  return Interceptor;
}
