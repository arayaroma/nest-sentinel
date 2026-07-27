import { Controller, Get, INestApplication, Module, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { ApiKeyGuard } from "../src/auth/apikey.guard";

const VALID_KEYS = ["secret-key-1", "secret-key-2"];

@Controller("protected")
class ProtectedController {
  @Get()
  @UseGuards(ApiKeyGuard({ validKeys: VALID_KEYS }))
  get() {
    return { ok: true };
  }
}

@Module({ controllers: [ProtectedController] })
class TestModule {}

describe("ApiKeyGuard (integration)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [TestModule],
    }).compile();

    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("allows a request with a valid API key", async () => {
    const res = await request(app.getHttpServer())
      .get("/protected")
      .set("X-API-Key", "secret-key-1");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("allows a request with the second valid API key", async () => {
    const res = await request(app.getHttpServer())
      .get("/protected")
      .set("X-API-Key", "secret-key-2");

    expect(res.status).toBe(200);
  });

  it("rejects a request with a missing API key", async () => {
    const res = await request(app.getHttpServer()).get("/protected");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });

  it("rejects a request with a wrong API key", async () => {
    const res = await request(app.getHttpServer())
      .get("/protected")
      .set("X-API-Key", "wrong-key");

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "unauthorized" });
  });
});
