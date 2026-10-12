import { Octokit } from "@octokit/core";

import type {
  Owner,
  OwnersPayload,
  PullRequestSummary,
  PullRequestsPayload,
  ReviewStatus,
} from "../src/shared/pull-requests.ts";
import { isRecord } from "../src/shared/is-record.ts";

export interface GitHubConfig {
  token: string;
  /** The default owner to search (GITHUB_ORG). */
  org: string;
}

/**
 * The `--limit 100` of the original command; also the Search API page maximum,
 * and the most node IDs GraphQL's `nodes(ids:)` accepts in one review status lookup.
 */
const PAGE_SIZE = 100;

// GitHub logins: alphanumeric or single hyphens, 1–39 characters.
const GITHUB_LOGIN_PATTERN = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/** GitHub answered the review status lookup with errors and no data at all. */
class GitHubGraphqlError extends Error {
  override name = "GitHubGraphqlError";
}

/** The deployment's settings are wrong; only the operator can fix it. */
export class GitHubConfigError extends Error {
  override name = "GitHubConfigError";
}

/** The request named an owner that is not a GitHub login. */
export class InvalidOwnerError extends Error {
  override name = "InvalidOwnerError";
}

function createClient(token: string, fetchImplementation: typeof fetch): Octokit {
  return new Octokit({
    auth: token,
    userAgent: "gh-pr-overview",
    request: { fetch: fetchImplementation },
  });
}

function assertValidConfig({ org }: GitHubConfig): void {
  if (!GITHUB_LOGIN_PATTERN.test(org)) {
    throw new GitHubConfigError(`GITHUB_ORG "${org}" is not a valid GitHub organization name.`);
  }
}

/** "https://api.github.com/repos/TFG-Labs/web" → "web" */
function repositoryName(repositoryUrl: string): string {
  const segments = new URL(repositoryUrl).pathname.split("/");

  return decodeURIComponent(segments.at(-1) ?? repositoryUrl);
}

/**
 * GitHub's `PullRequestReviewDecision`, mapped to the app's statuses.
 * https://docs.github.com/en/graphql/reference/enums#pullrequestreviewdecision
 *
 * The docs do not say when `reviewDecision` is null. In practice GitHub reports
 * null when the base branch does not require reviews and nobody has approved or
 * requested changes yet, so null is treated as "awaiting review".
 */
const REVIEW_DECISIONS: Readonly<Record<string, ReviewStatus>> = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "changes-requested",
  REVIEW_REQUIRED: "awaiting-review",
};

// The Search API does not report review status, so it is looked up by node ID.
const REVIEW_DECISIONS_QUERY = `
  query ($ids: [ID!]!) {
    nodes(ids: $ids) {
      ... on PullRequest {
        id
        reviewDecision
      }
    }
  }
`;

/** The parts of a GraphQL error worth logging: its type (such as NOT_FOUND) and message. */
function describeError(error: unknown): { type: string | null; message: string } {
  if (!isRecord(error)) {
    return { type: null, message: String(error) };
  }

  return {
    type: typeof error.type === "string" ? error.type : null,
    message: typeof error.message === "string" ? error.message : "",
  };
}

function toReviewStatus(reviewDecision: unknown): ReviewStatus | null {
  if (reviewDecision === null) {
    return "awaiting-review";
  }

  return typeof reviewDecision === "string" ? (REVIEW_DECISIONS[reviewDecision] ?? null) : null;
}

/**
 * Review status per pull request node ID. A pull request GitHub could not
 * resolve is left out, and the reasons are logged, so one unreadable pull
 * request does not hide the whole list.
 */
async function fetchReviewStatuses(
  octokit: Octokit,
  ids: readonly string[],
): Promise<Map<string, ReviewStatus>> {
  const statuses = new Map<string, ReviewStatus>();

  if (ids.length === 0) {
    return statuses;
  }

  const { data: body }: { data: unknown } = await octokit.request("POST /graphql", {
    query: REVIEW_DECISIONS_QUERY,
    variables: { ids },
  });

  const errors = isRecord(body) && Array.isArray(body.errors) ? body.errors.map(describeError) : [];
  const data = isRecord(body) ? body.data : undefined;

  // GitHub answers request-level failures, such as its GraphQL rate limit, with
  // HTTP 200, errors, and no data. Only errors about single nodes are tolerated.
  if (!isRecord(data)) {
    throw new GitHubGraphqlError(
      `GitHub answered the review status lookup without data: ${JSON.stringify(errors)}`,
    );
  }

  if (errors.length > 0) {
    console.error(
      JSON.stringify({
        message: "GitHub could not report the review status of some pull requests",
        errors,
      }),
    );
  }

  const { nodes } = data;

  for (const node of Array.isArray(nodes) ? nodes : []) {
    if (!isRecord(node) || typeof node.id !== "string" || !("reviewDecision" in node)) {
      continue;
    }

    const status = toReviewStatus(node.reviewDecision);

    if (status) {
      statuses.set(node.id, status);
    }
  }

  return statuses;
}

/**
 * Equivalent of:
 * gh search prs --author @me --state open --owner <owner> --limit 100
 *
 * `owner` defaults to the configured org. It can be a user or an organization:
 * like `gh`, the search uses the `user:` qualifier, which matches both.
 */
export async function searchOpenPullRequests(
  config: GitHubConfig,
  owner: string = config.org,
  fetchImplementation: typeof fetch = fetch,
): Promise<PullRequestsPayload> {
  assertValidConfig(config);

  // The owner is interpolated into a search query, so it must be a bare login.
  if (!GITHUB_LOGIN_PATTERN.test(owner)) {
    throw new InvalidOwnerError(`"${owner}" is not a valid GitHub account name.`);
  }

  const octokit = createClient(config.token, fetchImplementation);

  const [viewer, search] = await Promise.all([
    octokit.request("GET /user"),
    octokit.request("GET /search/issues", {
      q: `is:pr is:open author:@me user:${owner}`,
      sort: "updated",
      order: "desc",
      per_page: PAGE_SIZE,
    }),
  ]);

  const reviewStatuses = await fetchReviewStatuses(
    octokit,
    search.data.items.map(({ node_id }) => node_id),
  );

  const pullRequests: PullRequestSummary[] = search.data.items.map((item) => ({
    repository: repositoryName(item.repository_url),
    number: item.number,
    title: item.title,
    url: item.html_url,
    draft: item.draft ?? false,
    updatedAt: item.updated_at,
    reviewStatus: reviewStatuses.get(item.node_id) ?? null,
  }));

  return {
    owner,
    viewer: { login: viewer.data.login, avatarUrl: viewer.data.avatar_url },
    totalCount: search.data.total_count,
    pullRequests,
    fetchedAt: new Date().toISOString(),
  };
}

function sameLogin(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

/**
 * The accounts the viewer can pick: their personal account and their
 * organizations. The configured org is always included, because fine-grained
 * tokens get an empty organization list from GitHub.
 */
export async function listOwners(
  config: GitHubConfig,
  fetchImplementation: typeof fetch = fetch,
): Promise<OwnersPayload> {
  assertValidConfig(config);

  const octokit = createClient(config.token, fetchImplementation);

  const [viewer, organizations] = await Promise.all([
    octokit.request("GET /user"),
    octokit.request("GET /user/orgs", { per_page: PAGE_SIZE }),
  ]);

  const orgs: Owner[] = organizations.data.map(({ login, avatar_url }) => ({
    login,
    avatarUrl: avatar_url,
    personal: false,
  }));

  const knowsDefault =
    sameLogin(viewer.data.login, config.org) ||
    orgs.some(({ login }) => sameLogin(login, config.org));

  if (!knowsDefault) {
    const { data } = await octokit.request("GET /orgs/{org}", { org: config.org });

    orgs.push({ login: data.login, avatarUrl: data.avatar_url, personal: false });
  }

  orgs.sort((a, b) => a.login.localeCompare(b.login));

  const owners: Owner[] = [
    { login: viewer.data.login, avatarUrl: viewer.data.avatar_url, personal: true },
    ...orgs,
  ];

  return {
    // GitHub's spelling, so the browser can match it against the logins exactly.
    defaultOwner: owners.find(({ login }) => sameLogin(login, config.org))?.login ?? config.org,
    owners,
  };
}
