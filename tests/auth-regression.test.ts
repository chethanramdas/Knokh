import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { convexTest } from "convex-test";
import { decodeJwt, exportPKCS8, generateKeyPair } from "jose";
import schema from "../src/convex/schema";
import { api } from "../src/convex/_generated/api";
const modules = import.meta.glob([
  "../src/convex/**/*.ts",
  "../src/convex/_generated/*.js",
  "!../src/convex/**/*.d.ts",
]);
let deliveredCode = "";
beforeEach(async () => {
  const { privateKey } = await generateKeyPair("RS256", { extractable: true });
  vi.stubEnv("JWT_PRIVATE_KEY", await exportPKCS8(privateKey));
  vi.stubEnv("CONVEX_SITE_URL", "https://auth-fixture.invalid");
  vi.stubEnv("SITE_URL", "https://store-fixture.invalid");
  vi.stubEnv("RESEND_API_KEY", "isolated-test-placeholder");
  vi.stubEnv("RESEND_FROM_EMAIL", "Store <noreply@example.test>");
  deliveredCode = "";
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input) !== "https://api.resend.com/emails")
        throw new Error("Unexpected network access in isolated auth test");
      const body = JSON.parse(String(init?.body)) as { text: string };
      deliveredCode = body.text.match(/code is (\d{6})/)?.[1] ?? "";
      return new Response(JSON.stringify({ id: "isolated-mail-fixture" }), {
        status: 200,
      });
    }),
  );
});
afterEach(() => {
  deliveredCode = "";
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});
const email = "customer@example.test";
describe("existing email OTP authentication after security updates", () => {
  test("six-digit OTP is hashed, single-use, and creates a customer session", async () => {
    const t = convexTest(schema, modules);
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email },
    });
    expect(/^\d{6}$/.test(deliveredCode)).toBe(true);
    const codes = await t.run((ctx) =>
      ctx.db.query("authVerificationCodes").collect(),
    );
    expect(codes.length).toBe(1);
    expect(codes[0].expirationTime - Date.now()).toBeGreaterThan(
      14 * 60 * 1000,
    );
    expect(codes[0].expirationTime - Date.now()).toBeLessThanOrEqual(
      15 * 60 * 1000,
    );
    expect(JSON.stringify(codes).includes(deliveredCode)).toBe(false);
    const code = deliveredCode;
    const result = await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email, code },
    });
    expect(Boolean(result.tokens?.token)).toBe(true);
    const claims = decodeJwt(result.tokens!.token);
    const signedIn = t.withIdentity({
      subject: claims.sub!,
      issuer: "https://auth-fixture.invalid",
    });
    const user = await signedIn.query(api.users.currentUser, {});
    expect(user?.email).toBe(email);
    expect(user?.role === "admin").toBe(false);
    expect(Boolean(user?.emailVerificationTime)).toBe(true);
    await expect(
      t.action(api.auth.signIn, {
        provider: "email-otp",
        params: { email, code },
      }),
    ).rejects.toThrow();
    const refreshed = await t.action(api.auth.signIn, {
      refreshToken: result.tokens!.refreshToken,
    });
    expect(Boolean(refreshed.tokens?.token)).toBe(true);
    await signedIn.action(api.auth.signOut, {});
    expect(
      (await t.run((ctx) => ctx.db.query("authSessions").collect())).length,
    ).toBe(0);
  });
  test("a rejected OTP does not consume the valid OTP", async () => {
    const t = convexTest(schema, modules);
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email },
    });
    const code = deliveredCode;
    const wrongCode = (code[0] === "0" ? "1" : "0") + code.slice(1);
    await expect(
      t.action(api.auth.signIn, {
        provider: "email-otp",
        params: { email, code: wrongCode },
      }),
    ).rejects.toThrow();
    const result = await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email, code },
    });
    expect(Boolean(result.tokens?.token)).toBe(true);
  });
  test("existing verified administrator role survives email login", async () => {
    const t = convexTest(schema, modules);
    await t.run((ctx) =>
      ctx.db.insert("users", {
        email,
        emailVerificationTime: 1,
        role: "admin",
      }),
    );
    await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email },
    });
    const result = await t.action(api.auth.signIn, {
      provider: "email-otp",
      params: { email, code: deliveredCode },
    });
    const claims = decodeJwt(result.tokens!.token);
    const user = await t
      .withIdentity({
        subject: claims.sub!,
        issuer: "https://auth-fixture.invalid",
      })
      .query(api.users.currentUser, {});
    expect(user?.role).toBe("admin");
  });
  test("missing email credentials fail closed", async () => {
    vi.stubEnv("RESEND_API_KEY", "");
    const t = convexTest(schema, modules);
    await expect(
      t.action(api.auth.signIn, { provider: "email-otp", params: { email } }),
    ).rejects.toThrow(/not configured/);
    expect(deliveredCode).toBe("");
  });
});
