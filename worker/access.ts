import { createRemoteJWKSet, errors, jwtVerify, type JWTVerifyGetKey } from "jose";

/**
 * Verifies the Cloudflare Access JWT on API requests. Access already blocks
 * unauthenticated visitors at the edge; this is the second line of defense in
 * case the Worker is reached without Access (Access turned off, a new route,
 * or a misconfigured application).
 *
 * `ctx.access` cannot be used here: Workers with static assets run behind an
 * internal router that does not pass it to the user Worker.
 * https://developers.cloudflare.com/workers/configuration/cloudflare-access/
 */

export interface AccessConfig {
  /** e.g. https://your-team.cloudflareaccess.com */
  teamDomain: string;
  /** The Access application's Application Audience (AUD) tag. */
  audience: string;
}

export type AccessResult = { allowed: true } | { allowed: false; reason: string };

export type AccessVerifier = (request: Request) => Promise<AccessResult>;

export const ACCESS_JWT_HEADER = "cf-access-jwt-assertion";

const TEAM_DOMAIN_PATTERN = /^https:\/\/[a-z\d-]+\.cloudflareaccess\.com$/;

/** Only for `vp dev`, where there is no Access in front of the Worker. */
export const allowWithoutAccess: AccessVerifier = async () => ({ allowed: true });

export function createAccessVerifier(
  { teamDomain, audience }: AccessConfig,
  getKey?: JWTVerifyGetKey,
): AccessVerifier {
  // Fail closed: a deployment without complete Access settings serves no data.
  if (!TEAM_DOMAIN_PATTERN.test(teamDomain) || audience === "") {
    return async () => ({
      allowed: false,
      reason: "Cloudflare Access is not configured for this deployment.",
    });
  }

  // Remote key sets cache the signing keys, so keep one per verifier.
  const keys = getKey ?? createRemoteJWKSet(new URL(`${teamDomain}/cdn-cgi/access/certs`));

  return async (request) => {
    const token = request.headers.get(ACCESS_JWT_HEADER);

    if (!token) {
      return { allowed: false, reason: "Sign in through Cloudflare Access to use this app." };
    }

    try {
      await jwtVerify(token, keys, {
        issuer: teamDomain,
        audience,
        algorithms: ["RS256"],
      });

      return { allowed: true };
    } catch (error) {
      console.error(JSON.stringify(describeRejection(error)));

      return {
        allowed: false,
        reason: "Your Cloudflare Access session is not valid. Reload the page to sign in again.",
      };
    }
  };
}

/** Claims that identify the Access team and application, never the person. */
const IDENTIFYING_CLAIMS = new Set(["iss", "aud"]);

/**
 * Says why a token was refused, for the Worker logs. Never includes the token,
 * and of its claims only `iss` or `aud`, so a team or audience mismatch shows
 * the value Access sent without logging who signed in.
 */
function describeRejection(error: unknown) {
  const rejection = {
    message: "Cloudflare Access token refused",
    code: error instanceof errors.JOSEError ? error.code : null,
    error: error instanceof Error ? error.message : String(error),
  };

  if (error instanceof errors.JWTClaimValidationFailed || error instanceof errors.JWTExpired) {
    return {
      ...rejection,
      claim: error.claim,
      reason: error.reason,
      received: IDENTIFYING_CLAIMS.has(error.claim) ? (error.payload[error.claim] ?? null) : null,
    };
  }

  return rejection;
}
