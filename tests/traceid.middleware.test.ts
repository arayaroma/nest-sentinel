import express, { NextFunction, Request, Response } from 'express';
import request from 'supertest';
import { traceIdMiddleware } from '../src/traceid/traceid.middleware';

function buildApp(): express.Express {
  const app = express();
  app.use(traceIdMiddleware());

  app.get('/ok', (req: Request, res: Response) => {
    res.json({ traceId: req.headers['x-request-id'] });
  });

  app.get('/boom', (_req: Request, _res: Response, next: NextFunction) => {
    next(new Error('boom'));
  });

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    res.status(500).json({ error: err.message });
  });

  return app;
}

describe('traceIdMiddleware', () => {
  it('echoes an inbound X-Request-ID unchanged', async () => {
    const app = buildApp();
    const res = await request(app).get('/ok').set('X-Request-ID', 'my-fixed-id');

    expect(res.headers['x-request-id']).toBe('my-fixed-id');
    expect(res.body.traceId).toBe('my-fixed-id');
  });

  it('generates a UUID when no inbound ID is present', async () => {
    const app = buildApp();
    const res = await request(app).get('/ok');

    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    expect(res.headers['x-request-id']).toMatch(uuidRegex);
  });

  it('sets the response header before next(), even if the downstream handler errors', async () => {
    const app = buildApp();
    const res = await request(app).get('/boom').set('X-Request-ID', 'error-path-id');

    expect(res.status).toBe(500);
    expect(res.headers['x-request-id']).toBe('error-path-id');
  });
});
