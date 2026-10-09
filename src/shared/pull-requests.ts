/**
 * The contract between the Worker API and the browser app. Both sides import
 * these types, so a change here is a change to the API.
 */

export interface PullRequestSummary {
  repository: string;
  number: number;
  title: string;
  url: string;
  draft: boolean;
  updatedAt: string;
}

export interface Viewer {
  login: string;
  avatarUrl: string;
}

export interface PullRequestsPayload {
  owner: string;
  viewer: Viewer;
  totalCount: number;
  pullRequests: PullRequestSummary[];
  fetchedAt: string;
}

/** A GitHub account whose repositories can be searched: the viewer or one of their organizations. */
export interface Owner {
  login: string;
  avatarUrl: string;
  /** True for the viewer's personal account, false for an organization. */
  personal: boolean;
}

export interface OwnersPayload {
  /** The owner `/api/pull-requests` searches when the request names none. */
  defaultOwner: string;
  /** The viewer's personal account first, then organizations by name. */
  owners: Owner[];
}

export interface ApiErrorPayload {
  error: string;
}

export interface RepositoryGroup {
  repository: string;
  pullRequests: PullRequestSummary[];
}

export const PULL_REQUESTS_ENDPOINT = "/api/pull-requests";
export const OWNERS_ENDPOINT = "/api/owners";
/** Query parameter of PULL_REQUESTS_ENDPOINT that picks the owner to search. */
export const OWNER_PARAM = "owner";

/**
 * Mirrors `jq 'group_by(.repository.name)'`: one group per repository, groups
 * sorted by repository name, pull requests keep their incoming order.
 */
export function groupByRepository(pullRequests: readonly PullRequestSummary[]): RepositoryGroup[] {
  const groups = new Map<string, PullRequestSummary[]>();

  for (const pullRequest of pullRequests) {
    const group = groups.get(pullRequest.repository);

    if (group) {
      group.push(pullRequest);
    } else {
      groups.set(pullRequest.repository, [pullRequest]);
    }
  }

  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([repository, items]) => ({ repository, pullRequests: items }));
}

/**
 * Produces the same plain-text shape as the `gh search prs ... --jq` command
 * this app replaces, so the output can be pasted into chat or a stand-up note.
 */
export function formatAsText(groups: readonly RepositoryGroup[]): string {
  return groups
    .flatMap(({ repository, pullRequests }) => [
      "",
      `${repository} (${pullRequests.length})`,
      ...pullRequests.map(({ url, title }) => `  ${url}  ${title}`),
    ])
    .join("\n");
}
