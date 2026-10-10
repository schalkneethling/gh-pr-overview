import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { ACCESS_JWT_HEADER, createAccessVerifier, type AccessVerifier } from "./access.ts";

const TEAM_DOMAIN = "https://pr-quest.cloudflareaccess.com";
const AUDIENCE = "test-application-aud";

let privateKey: CryptoKey;
let verify: AccessVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair("RS256");
  privateKey = pair.privateKey;

  const publicJwk = { ...(await exportJWK(pair.publicKey)), alg: "RS256", kid: "test-key" };
  // Stands in for https://<team>.cloudflareaccess.com/cdn-cgi/access/certs.
  verify = createAccessVerifier(
    { teamDomain: TEAM_DOMAIN, audience: AUDIENCE },
    createLocalJWKSet({ keys: [publicJwk] }),
  );
});

function signAccessToken(
  claims: { issuer?: string; audience?: string; expiresIn?: string } = {},
): Promise<string> {
  return new SignJWT({ email: "player@example.com" })
    .setProtectedHeader({ alg: "RS256", kid: "test-key" })
    .setIssuer(claims.issuer ?? TEAM_DOMAIN)
    .setAudience(claims.audience ?? AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(claims.expiresIn ?? "5m")
    .sign(privateKey);
}

function requestWith(token?: string): Request {
  const headers = new Headers();

  if (token) {
    headers.set(ACCESS_JWT_HEADER, token);
  }

  return new Request("https://pr-quest.example/api/pull-requests", { headers });
}

describe("Cloudflare Access verification", () => {
  let log: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    log = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("allows a request with a valid Access token for this application", async () => {
    expect(await verify(requestWith(await signAccessToken()))).toEqual({ allowed: true });
  });

  it("refuses a request without an Access token", async () => {
    expect(await verify(requestWith())).toEqual({
      allowed: false,
      reason: "Sign in through Cloudflare Access to use this app.",
    });
  });

  it.each([
    ["another Access application", { audience: "other-application-aud" }],
    ["another Access team", { issuer: "https://someone-else.cloudflareaccess.com" }],
    ["an expired session", { expiresIn: "-1m" }],
  ])("refuses a token issued for %s", async (_case, claims) => {
    const result = await verify(requestWith(await signAccessToken(claims)));

    expect(result.allowed).toBe(false);
  });

  it("logs the audience Access sent when it belongs to another application", async () => {
    const token = await signAccessToken({ audience: "other-application-aud" });

    await verify(requestWith(token));

    expect(log).toHaveBeenCalledOnce();
    expect(JSON.parse(log.mock.calls[0][0] as string)).toMatchObject({
      message: "Cloudflare Access token refused",
      code: "ERR_JWT_CLAIM_VALIDATION_FAILED",
      claim: "aud",
      received: "other-application-aud",
    });
  });

  it("never logs the token or who signed in", async () => {
    const token = await signAccessToken({ expiresIn: "-1m" });

    await verify(requestWith(token));

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("ERR_JWT_EXPIRED");
    expect(logged).not.toContain(token);
    expect(logged).not.toContain("player@example.com");
  });

  it("refuses a token signed with a key Access did not publish", async () => {
    const stranger = await generateKeyPair("RS256");
    const forged = await new SignJWT({ email: "player@example.com" })
      .setProtectedHeader({ alg: "RS256", kid: "test-key" })
      .setIssuer(TEAM_DOMAIN)
      .setAudience(AUDIENCE)
      .setExpirationTime("5m")
      .sign(stranger.privateKey);

    expect((await verify(requestWith(forged))).allowed).toBe(false);
  });

  it("refuses garbage in the Access header", async () => {
    expect((await verify(requestWith("not-a-jwt"))).allowed).toBe(false);
  });

  describe("when the deployment is missing Access settings", () => {
    it.each([
      ["no team domain", { teamDomain: "", audience: AUDIENCE }],
      ["no audience", { teamDomain: TEAM_DOMAIN, audience: "" }],
      [
        "a team domain that is not Cloudflare Access",
        { teamDomain: "https://evil.example", audience: AUDIENCE },
      ],
    ])("fails closed with %s, even for a valid token", async (_case, config) => {
      const result = await createAccessVerifier(config)(requestWith(await signAccessToken()));

      expect(result).toEqual({
        allowed: false,
        reason: "Cloudflare Access is not configured for this deployment.",
      });
    });
  });
});
