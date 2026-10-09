import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vite-plus/test";

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
