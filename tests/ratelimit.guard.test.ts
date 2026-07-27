import "reflect-metadata";
import { Controller, Get, INestApplication, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { RateLimitGuard, RateLimitGlobalGuard } from "../src/ratelimit";

// Real @nestjs/testing integration test: builds an actual Nest application (via
// createNestApplication + supertest against its HTTP listener) with a controller route guarded
// by RateLimitGuard, and drives it through Nest's real request pipeline. A unit test that only
// calls guard.canActivate() directly would not exercise DI/@UseGuards wiring — see design.md.

@Controller()
class PerKeyController {
  @Get("limited")
  @UseGuards(RateLimitGuard({ rps: 0, burst: 2 }))
  limited() {
    return { ok: true };
  }
}

@Controller()
class GlobalController {
  @Get("global-limited")
  @UseGuards(RateLimitGlobalGuard({ rps: 0, burst: 1 }))
  limited() {
    return { ok: true };
  }
}

describe("RateLimitGuard (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PerKeyController, GlobalController],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows requests within the burst limit and rejects beyond it with 429", async () => {
    const server = app.getHttpServer();

    // burst=2, rps=0 (no refill) -> first two requests from the same key succeed.
    await request(server).get("/limited").expect(200, { ok: true });
    await request(server).get("/limited").expect(200, { ok: true });

    // Third request from the same (default-keyed, e.g. shared test-client IP) exceeds the burst.
    const res = await request(server).get("/limited").expect(429);
    expect(res.body).toEqual({ error: "rate limit exceeded" });
  });

  it("enforces a single shared bucket across all callers for RateLimitGlobalGuard", async () => {
    const server = app.getHttpServer();

    // burst=1, rps=0 -> only the first request across ALL callers succeeds.
    await request(server).get("/global-limited").expect(200, { ok: true });

    const res = await request(server).get("/global-limited").expect(429);
    expect(res.body).toEqual({ error: "rate limit exceeded" });
  });
});
