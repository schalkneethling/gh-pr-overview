import {
  OWNER_PARAM,
  OWNERS_ENDPOINT,
  PULL_REQUESTS_ENDPOINT,
  type ApiErrorPayload,
} from "../src/shared/pull-requests.ts";
import type { AccessVerifier } from "./access.ts";
import {
  GitHubConfigError,
  InvalidOwnerError,
  listOwners,
  searchOpenPullRequests,
  type GitHubConfig,
} from "./github.ts";

export interface ApiDependencies {
  github: GitHubConfig;
  verifyAccess: AccessVerifier;
  /** Replaces the global fetch for GitHub calls; used by tests. */
  fetch?: typeof fetch;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  // The payload is private to the token owner; never cache it in shared caches.
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_HEADERS, ...headers },
  });
}

function apiError(status: number, error: string, headers?: Record<string, string>): Response {
  const body: ApiErrorPayload = { error };

  return json(body, status, headers);
}

function statusOf(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    return typeof error.status === "number" ? error.status : undefined;
  }

  return undefined;
}

function headerOf(error: unknown, name: string): unknown {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "headers" in error.response &&
    typeof error.response.headers === "object" &&
    error.response.headers !== null
  ) {
    return Object.entries(error.response.headers).find(([key]) => key === name)?.[1];
  }

  return undefined;
}

/**
 * GitHub answers both rate limits and missing permissions with 403. Rate
 * limits come with an exhausted quota or a Retry-After header.
 * https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
 */
function isRateLimited(error: unknown): boolean {
  return (
    statusOf(error) === 429 ||
    String(headerOf(error, "x-ratelimit-remaining")) === "0" ||
    headerOf(error, "retry-after") !== undefined
  );
}

/** Maps a failed GitHub call to a message the person in front of the app can act on. */
function gitHubFailure(error: unknown): Response {
  if (error instanceof GitHubConfigError) {
    return apiError(500, error.message);
  }

  if (isRateLimited(error)) {
    return apiError(
      503,
      "GitHub refused the request because of a rate limit. Wait a minute, then try again.",
    );
  }

  switch (statusOf(error)) {
    case 401:
      return apiError(
        502,
        "GitHub rejected the token. Check that GITHUB_TOKEN is valid and not expired.",
      );
    case 403:
      return apiError(
        502,
        "GitHub refused access. Check that GITHUB_TOKEN has the repo and read:org scopes.",
      );
    case 404:
    case 422:
      return apiError(
        502,
        "GitHub could not find that account. Check the GITHUB_ORG setting or pick another account.",
      );
    default:
      return apiError(502, "GitHub did not answer as expected. Try again in a moment.");
  }
}

function route(
  { pathname, searchParams }: URL,
  github: GitHubConfig,
  fetchImplementation: typeof fetch | undefined,
): (() => Promise<unknown>) | undefined {
  switch (pathname) {
    case PULL_REQUESTS_ENDPOINT:
      return () =>
        searchOpenPullRequests(
          github,
          searchParams.get(OWNER_PARAM) ?? undefined,
          fetchImplementation,
        );
    case OWNERS_ENDPOINT:
      return () => listOwners(github, fetchImplementation);
    default:
      return undefined;
  }
}

export async function handleApiRequest(
  request: Request,
  { github, verifyAccess, fetch: fetchImplementation }: ApiDependencies,
): Promise<Response> {
  // Checked before routing so unauthenticated callers learn nothing about the API.
  const access = await verifyAccess(request);

  if (!access.allowed) {
    return apiError(403, access.reason);
  }

  const url = new URL(request.url);
  const load = route(url, github, fetchImplementation);

  if (!load) {
    return apiError(404, "Not found.");
  }

  if (request.method !== "GET") {
    return apiError(405, "Method not allowed.", { allow: "GET" });
  }

  try {
    return json(await load());
  } catch (error) {
    // A bad request, not a GitHub failure: nothing was sent to GitHub.
    if (error instanceof InvalidOwnerError) {
      return apiError(400, error.message);
    }

    console.error(
      JSON.stringify({
        message: "GitHub request failed",
        status: statusOf(error) ?? null,
        error: error instanceof Error ? error.message : String(error),
      }),
    );

    return gitHubFailure(error);
  }
}
