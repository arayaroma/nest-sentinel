import { Controller, Get, INestApplication, UseInterceptors } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { TimeoutInterceptor } from '../src/resource/timeout.interceptor';

@Controller()
class TestController {
  @Get('/slow')
  @UseInterceptors(TimeoutInterceptor(50))
  async slow(): Promise<{ ok: boolean }> {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return { ok: true };
  }

  @Get('/fast')
  @UseInterceptors(TimeoutInterceptor(50))
  async fast(): Promise<{ ok: boolean }> {
    return { ok: true };
  }
}

describe('TimeoutInterceptor (integration)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [TestController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns 408 when the handler exceeds the configured timeout', async () => {
    const res = await request(app.getHttpServer()).get('/slow');
    expect(res.status).toBe(408);
  });

  it('succeeds normally when the handler responds within the timeout', async () => {
    const res = await request(app.getHttpServer()).get('/fast');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
