// Companion to AuditLogInterceptor (see its header comment for the full
// rationale): a global exception filter is the ONLY hook in NestJS's request
// lifecycle that sees exceptions thrown by Guards/Pipes/Interceptors/Handlers
// uniformly — Interceptors alone cannot observe a Guard-rejected request
// (Guards run before Interceptors ever start). This filter owns ALL failure-
// path audit entries; the interceptor owns success-path entries only. Once
// registered as a global APP_FILTER, this REPLACES Nest's built-in exception
// handling app-wide, so it must reproduce the same response shape Nest's
// default filter would produce, or every error response in the app changes
// shape as a side effect of enabling audit logging.
import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuditLogOptions, emitEntry, resolveOptions } from './audit-log.core';

export function AuditLogExceptionFilter(opts: AuditLogOptions): new (...args: unknown[]) => ExceptionFilter {
  const resolved = resolveOptions(opts);

  @Catch()
  class Filter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost): void {
      const ctx = host.switchToHttp();
      const req = ctx.getRequest<Request>();
      const res = ctx.getResponse<Response>();

      const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;

      const body =
        exception instanceof HttpException
          ? normalizeHttpExceptionBody(exception, status)
          : { statusCode: status, message: 'Internal server error' };

      void emitEntry(req, status, exception, resolved);

      res.status(status).json(body);
    }
  }

  return Filter;
}

/**
 * Reproduces the response shape NestJS's own default exception filter
 * produces for an HttpException: `getResponse()` is sent as-is if it's
 * already an object (Nest's built-in exceptions like BadRequestException
 * already return `{statusCode, message, error}`), or wrapped into
 * `{statusCode, message}` if the exception was constructed with a bare
 * string message.
 */
function normalizeHttpExceptionBody(exception: HttpException, status: number): unknown {
  const response = exception.getResponse();
  if (typeof response === 'string') {
    return { statusCode: status, message: response };
  }
  return response;
}
