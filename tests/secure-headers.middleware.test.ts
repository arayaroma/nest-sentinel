import express from "express";
import request from "supertest";
import { secureHeadersMiddleware } from "../src/headers/secure-headers.middleware";

function buildApp(opts?: Parameters<typeof secureHeadersMiddleware>[0]) {
  const app = express();
  app.use(secureHeadersMiddleware(opts));
  app.get("/", (_req, res) => res.status(200).json({ ok: true }));
  return app;
}

describe("secureHeadersMiddleware", () => {
  it("sets default headers and calls next()", async () => {
    const res = await request(buildApp()).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
    expect(res.headers["x-frame-options"]).toBe("DENY");
    expect(res.headers["content-security-policy"]).toBe("default-src 'self'");
    expect(res.headers["strict-transport-security"]).toBe(
      "max-age=63072000; includeSubDomains"
    );
    expect(res.headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(res.headers["permissions-policy"]).toBeUndefined();
  });

  it("honors overrides and sets Permissions-Policy only when configured", async () => {
    const res = await request(
      buildApp({
        contentSecurityPolicy: "default-src 'none'",
        strictTransportSecurity: "max-age=100",
        frameOptions: "SAMEORIGIN",
        referrerPolicy: "no-referrer",
        permissionsPolicy: "geolocation=()",
      })
    ).get("/");

    expect(res.headers["content-security-policy"]).toBe("default-src 'none'");
    expect(res.headers["strict-transport-security"]).toBe("max-age=100");
    expect(res.headers["x-frame-options"]).toBe("SAMEORIGIN");
    expect(res.headers["referrer-policy"]).toBe("no-referrer");
    expect(res.headers["permissions-policy"]).toBe("geolocation=()");
  });
});
