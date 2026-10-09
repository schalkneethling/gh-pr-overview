import {
  OWNER_PARAM,
  OWNERS_ENDPOINT,
  PULL_REQUESTS_ENDPOINT,
  type Owner,
  type OwnersPayload,
  type PullRequestSummary,
  type PullRequestsPayload,
} from "../shared/pull-requests.ts";

export class ApiError extends Error {
  override name = "ApiError";
}

const GITHUB_ORIGIN = "https://github.com/";
const AVATAR_ORIGIN = "https://avatars.githubusercontent.com/";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isAvatarUrl(value: unknown): boolean {
  // Rendered as an image source, so only GitHub avatars are allowed through.
  return typeof value === "string" && value.startsWith(AVATAR_ORIGIN);
}

function isPullRequestSummary(value: unknown): value is PullRequestSummary {
  return (
    isRecord(value) &&
    typeof value.repository === "string" &&
    typeof value.number === "number" &&
    typeof value.title === "string" &&
    typeof value.url === "string" &&
    // Rendered as an href, so only GitHub URLs are allowed through.
    value.url.startsWith(GITHUB_ORIGIN) &&
    typeof value.draft === "boolean" &&
    typeof value.updatedAt === "string"
  );
}

export function isPullRequestsPayload(value: unknown): value is PullRequestsPayload {
  return (
    isRecord(value) &&
    typeof value.owner === "string" &&
    isRecord(value.viewer) &&
    typeof value.viewer.login === "string" &&
    isAvatarUrl(value.viewer.avatarUrl) &&
    typeof value.totalCount === "number" &&
    typeof value.fetchedAt === "string" &&
    Array.isArray(value.pullRequests) &&
    value.pullRequests.every(isPullRequestSummary)
  );
}

function isOwner(value: unknown): value is Owner {
  return (
    isRecord(value) &&
    typeof value.login === "string" &&
    isAvatarUrl(value.avatarUrl) &&
    typeof value.personal === "boolean"
  );
}

export function isOwnersPayload(value: unknown): value is OwnersPayload {
  return (
    isRecord(value) &&
    typeof value.defaultOwner === "string" &&
    Array.isArray(value.owners) &&
    value.owners.every(isOwner)
  );
}

function errorMessageFrom(body: unknown, status: number): string {
  if (isRecord(body) && typeof body.error === "string") {
    return body.error;
  }

  return `The server answered with status ${status}.`;
}

async function getJson<T>(
  url: string,
  isExpected: (body: unknown) => body is T,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(url, {
      headers: { accept: "application/json" },
      signal,
    });
  } catch (error) {
    if (signal?.aborted) {
      throw error;
    }

    throw new ApiError("Could not reach the server. Check your connection and try again.");
  }

  const body: unknown = await response.json().catch(() => null);

  if (!response.ok) {
    throw new ApiError(errorMessageFrom(body, response.status));
  }

  if (!isExpected(body)) {
    throw new ApiError("The server sent data this app does not understand.");
  }

  return body;
}

/** `owner` null searches the server's default owner. */
export function fetchPullRequests(
  owner: string | null,
  signal?: AbortSignal,
): Promise<PullRequestsPayload> {
  const url =
    owner === null
      ? PULL_REQUESTS_ENDPOINT
      : `${PULL_REQUESTS_ENDPOINT}?${new URLSearchParams({ [OWNER_PARAM]: owner })}`;

  return getJson(url, isPullRequestsPayload, signal);
}

export function fetchOwners(signal?: AbortSignal): Promise<OwnersPayload> {
  return getJson(OWNERS_ENDPOINT, isOwnersPayload, signal);
}
