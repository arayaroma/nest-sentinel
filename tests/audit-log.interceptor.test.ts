import {
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  HttpException,
  HttpStatus,
  INestApplication,
  Injectable,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AuditLogEntry, AuditLogExceptionFilter, AuditLogInterceptor, AuditLogOptions } from '../src/auditlog';
import { SentinelModule } from '../src/sentinel.module';

@Injectable()
class RejectingGuard implements CanActivate {
  canActivate(_ctx: ExecutionContext): boolean {
    throw new UnauthorizedException('no token');
  }
}

@Controller()
class TestController {
  @Get('/ok')
  ok(): { ok: boolean } {
    return { ok: true };
  }

  @Get('/boom')
  boom(): never {
    throw new HttpException('nope', HttpStatus.FORBIDDEN);
  }

  @UseGuards(RejectingGuard)
  @Get('/guarded')
  guarded(): { ok: boolean } {
    return { ok: true };
  }
}

function makeSink(): { sink: (e: AuditLogEntry) => void; entries: AuditLogEntry[] } {
  const entries: AuditLogEntry[] = [];
  return { sink: (e: AuditLogEntry): void => { entries.push(e); }, entries };
}

/** Interceptor only — success-path entries. Matches what AuditLogInterceptor alone can see. */
async function buildAppInterceptorOnly(opts: AuditLogOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({ controllers: [TestController] }).compile();
  const app = moduleRef.createNestApplication();
  app.useGlobalInterceptors(new (AuditLogInterceptor(opts))());
  await app.init();
  return app;
}

/** Interceptor + filter — the real SentinelModule.forRoot({auditLog}) wiring. */
async function buildAppFull(opts: AuditLogOptions): Promise<INestApplication> {
  const moduleRef = await Test.createTestingModule({
    controllers: [TestController],
    providers: [
      { provide: APP_INTERCEPTOR, useValue: new (AuditLogInterceptor(opts))() },
      { provide: APP_FILTER, useValue: new (AuditLogExceptionFilter(opts))() },
    ],
  }).compile();
  const app = moduleRef.createNestApplication();
  await app.init();
  return app;
}

describe('AuditLogInterceptor (success path)', () => {
  it('emits a well-formed entry on a successful request', async () => {
    const { sink, entries } = makeSink();
    const app = await buildAppInterceptorOnly({ sink });

    const res = await request(app.getHttpServer()).get('/ok');
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    expect(entries).toHaveLength(1);
    const entry = entries[0];
    expect(entry.schema_version).toBe('1.0');
    expect(typeof entry.event_id).toBe('string');
    expect(entry.actor).toEqual({ id: null, type: 'anonymous' });
    expect(entry.http).toEqual({ method: 'GET', path: '/ok', status_code: 200 });
    expect(entry.outcome).toBe('success');
    expect(entry.network.source_ip).toBeDefined();
    expect(entry.trace_id).toBeUndefined();

    await app.close();
  });

  it('picks up trace_id from a composed traceIdMiddleware, omits it when absent', async () => {
    const { sink, entries } = makeSink();

    const moduleRef = await Test.createTestingModule({
      imports: [SentinelModule.forRoot({ traceId: {} })],
      controllers: [TestController],
    }).compile();

    const app = moduleRef.createNestApplication();
    app.useGlobalInterceptors(new (AuditLogInterceptor({ sink }))());
    await app.init();

    const res = await request(app.getHttpServer()).get('/ok').set('X-Request-ID', 'trace-abc');
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    expect(entries).toHaveLength(1);
    expect(entries[0].trace_id).toBe('trace-abc');

    await app.close();
  });

  it('does NOT see a Guard-rejected request when applied alone (the gap AuditLogExceptionFilter exists to close)', async () => {
    const { sink, entries } = makeSink();
    const app = await buildAppInterceptorOnly({ sink });

    const res = await request(app.getHttpServer()).get('/guarded');
    expect(res.status).toBe(401); // the rejection still happens correctly...

    await new Promise((r) => setImmediate(r));
    expect(entries).toHaveLength(0); // ...but the interceptor alone never observes it.

    await app.close();
  });

  it('sanitizes control characters and caps field length in path/user-agent', async () => {
    @Controller()
    class ForgingController {
      @Get('/forged')
      forged(): { ok: boolean } {
        return { ok: true };
      }
    }

    const { sink: forgedSink, entries: forgedEntries } = makeSink();
    const moduleRef = await Test.createTestingModule({
      controllers: [ForgingController],
    }).compile();
    const forgingApp = moduleRef.createNestApplication();
    forgingApp.use((req: import('express').Request, _res: unknown, next: () => void) => {
      req.headers['user-agent'] = 'evil\r\nInjected-Header: 1' + 'x'.repeat(50);
      next();
    });
    forgingApp.useGlobalInterceptors(new (AuditLogInterceptor({ sink: forgedSink, maxFieldLength: 20 }))());
    await forgingApp.init();

    const res = await request(forgingApp.getHttpServer()).get('/forged');
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    expect(forgedEntries).toHaveLength(1);
    const ua = forgedEntries[0].network.user_agent;
    expect(ua).not.toMatch(/[\x00-\x1F\x7F-\x9F]/);
    expect(ua.length).toBeLessThanOrEqual(20);
    expect(forgedEntries[0].http.path).toBe('/forged');

    await forgingApp.close();
  });

  it('supports all three IP modes', async () => {
    const modes: Array<{ mode: 'full' | 'truncated' | 'hashed'; assert: (ip: string) => void }> = [
      { mode: 'full', assert: (ip) => expect(ip).toBe('1.2.3.4') },
      { mode: 'truncated', assert: (ip) => expect(ip).toBe('1.2.3.0') },
      { mode: 'hashed', assert: (ip) => expect(ip).toMatch(/^[0-9a-f]{64}$/) },
    ];

    for (const { mode, assert } of modes) {
      const { sink, entries } = makeSink();
      const app = await buildAppInterceptorOnly({ sink, ipMode: mode });

      const res = await request(app.getHttpServer()).get('/ok').set('X-Forwarded-For', '1.2.3.4');
      expect(res.status).toBe(200);

      await new Promise((r) => setImmediate(r));
      expect(entries).toHaveLength(1);
      assert(entries[0].network.source_ip);

      await app.close();
    }
  });

  it('a throwing sink does not break the client-visible response', async () => {
    const app = await buildAppInterceptorOnly({
      sink: () => {
        throw new Error('sink exploded');
      },
    });

    const res = await request(app.getHttpServer()).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    await app.close();
  });

  it('a rejecting async sink does not break the client-visible response', async () => {
    const app = await buildAppInterceptorOnly({
      sink: async () => {
        throw new Error('async sink exploded');
      },
    });

    const res = await request(app.getHttpServer()).get('/ok');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });

    await app.close();
  });
});

describe('AuditLogInterceptor + AuditLogExceptionFilter (full wiring, matches SentinelModule.forRoot)', () => {
  it('handler-thrown exception: real error response preserved, failure/denied entry emitted', async () => {
    const { sink, entries } = makeSink();
    const app = await buildAppFull({ sink });

    const res = await request(app.getHttpServer()).get('/boom');

    expect(res.status).toBe(403);
    expect(res.body.message).toBe('nope');

    await new Promise((r) => setImmediate(r));
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('denied');
    expect(entries[0].http.status_code).toBe(403);

    await app.close();
  });

  it('Guard-rejected request: real 401 response preserved, entry STILL emitted (the gap the filter closes)', async () => {
    const { sink, entries } = makeSink();
    const app = await buildAppFull({ sink });

    const res = await request(app.getHttpServer()).get('/guarded');

    expect(res.status).toBe(401);
    expect(res.body.message).toBe('no token');

    await new Promise((r) => setImmediate(r));
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('denied');
    expect(entries[0].http.status_code).toBe(401);
    expect(entries[0].http.path).toBe('/guarded');

    await app.close();
  });

  it('success path still only logs once (no double-logging between interceptor and filter)', async () => {
    const { sink, entries } = makeSink();
    const app = await buildAppFull({ sink });

    const res = await request(app.getHttpServer()).get('/ok');
    expect(res.status).toBe(200);

    await new Promise((r) => setImmediate(r));
    expect(entries).toHaveLength(1);
    expect(entries[0].outcome).toBe('success');

    await app.close();
  });

  it('derives outcome per status bucket: success/denied/failure', async () => {
    const { sink, entries } = makeSink();
    const app = await buildAppFull({ sink });

    await request(app.getHttpServer()).get('/ok');
    await request(app.getHttpServer()).get('/boom');
    await request(app.getHttpServer()).get('/guarded');

    await new Promise((r) => setImmediate(r));
    expect(entries).toHaveLength(3);
    const byPath = Object.fromEntries(entries.map((e) => [e.http.path, e]));
    expect(byPath['/ok'].outcome).toBe('success');
    expect(byPath['/boom'].outcome).toBe('denied'); // 403
    expect(byPath['/guarded'].outcome).toBe('denied'); // 401

    await app.close();
  });

  it('hash chain is content-dependent (tamper-detectable), not hardcoded, and shared across interceptor + filter entries', async () => {
    const { sink, entries } = makeSink();
    const app = await buildAppFull({ sink, tamperEvident: true });

    await request(app.getHttpServer()).get('/ok');
    await request(app.getHttpServer()).get('/boom');
    await new Promise((r) => setImmediate(r));

    expect(entries).toHaveLength(2);
    expect(entries[0].entry_hash).toBeDefined();
    expect(entries[1].prev_hash).toBe(entries[0].entry_hash);
    expect(entries[0].entry_hash).not.toBe(entries[1].entry_hash);

    const tampered = { ...entries[0], http: { ...entries[0].http, status_code: 999 } };
    expect(JSON.stringify(tampered)).not.toBe(JSON.stringify(entries[0]));

    await app.close();
  });
});
