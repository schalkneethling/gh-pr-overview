import { describe, expect, it } from "vite-plus/test";

import {
  formatAsText,
  groupByRepository,
  sortByUpdated,
  type PullRequestSummary,
} from "./pull-requests.ts";

function pullRequest(overrides: Partial<PullRequestSummary>): PullRequestSummary {
  return {
    repository: "web",
    number: 1,
    title: "Fix things",
    url: "https://github.com/TFG-Labs/web/pull/1",
    draft: false,
    updatedAt: "2026-10-01T10:00:00Z",
    reviewStatus: "awaiting-review",
    ...overrides,
  };
}

describe("groupByRepository", () => {
  it("groups pull requests by repository, sorted by repository name", () => {
    const groups = groupByRepository([
      pullRequest({ repository: "web", number: 1 }),
      pullRequest({ repository: "api", number: 2 }),
      pullRequest({ repository: "web", number: 3 }),
    ]);

    expect(groups.map(({ repository }) => repository)).toEqual(["api", "web"]);
    expect(groups[1]?.pullRequests.map(({ number }) => number)).toEqual([1, 3]);
  });

  it("returns no groups for no pull requests", () => {
    expect(groupByRepository([])).toEqual([]);
  });

  it("does not mutate its input", () => {
    const input = [pullRequest({ repository: "b" }), pullRequest({ repository: "a" })];
    const snapshot = structuredClone(input);

    groupByRepository(input);

    expect(input).toEqual(snapshot);
  });
});

describe("formatAsText", () => {
  it("matches the gh CLI jq output: blank line, 'name (count)', then indented 'url  title' rows", () => {
    const text = formatAsText(
      groupByRepository([
        pullRequest({
          repository: "web",
          title: "Add login",
          url: "https://github.com/TFG-Labs/web/pull/7",
        }),
        pullRequest({
          repository: "api",
          title: "Speed up search",
          url: "https://github.com/TFG-Labs/api/pull/3",
        }),
        pullRequest({
          repository: "web",
          title: "Fix footer",
          url: "https://github.com/TFG-Labs/web/pull/9",
        }),
      ]),
    );

    expect(text).toBe(
      [
        "",
        "api (1)",
        "  https://github.com/TFG-Labs/api/pull/3  Speed up search",
        "",
        "web (2)",
        "  https://github.com/TFG-Labs/web/pull/7  Add login",
        "  https://github.com/TFG-Labs/web/pull/9  Fix footer",
      ].join("\n"),
    );
  });

  it("returns an empty string when there is nothing to copy", () => {
    expect(formatAsText([])).toBe("");
  });
});

describe("sortByUpdated", () => {
  const march = pullRequest({ number: 1, updatedAt: "2026-03-01T10:00:00Z" });
  const june = pullRequest({ number: 2, updatedAt: "2026-06-01T10:00:00Z" });
  const may = pullRequest({ number: 3, updatedAt: "2026-05-01T10:00:00Z" });

  it("puts the least recently updated first for oldest", () => {
    expect(sortByUpdated([june, march, may], "oldest").map(({ number }) => number)).toEqual([
      1, 3, 2,
    ]);
  });

  it("puts the most recently updated first for newest", () => {
    expect(sortByUpdated([march, june, may], "newest").map(({ number }) => number)).toEqual([
      2, 3, 1,
    ]);
  });

  it("keeps the incoming order for equal timestamps", () => {
    const first = pullRequest({ number: 10, updatedAt: "2026-03-01T10:00:00Z" });
    const second = pullRequest({ number: 11, updatedAt: "2026-03-01T10:00:00Z" });

    expect(sortByUpdated([first, second], "newest").map(({ number }) => number)).toEqual([10, 11]);
    expect(sortByUpdated([first, second], "oldest").map(({ number }) => number)).toEqual([10, 11]);
  });

  it("does not mutate its input", () => {
    const input = [june, march];

    sortByUpdated(input, "oldest");

    expect(input).toEqual([june, march]);
  });
});
