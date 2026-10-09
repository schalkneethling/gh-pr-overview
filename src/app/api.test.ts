import { describe, expect, it } from "vite-plus/test";

import { isOwnersPayload, isPullRequestsPayload } from "./api.ts";

const valid = {
  owner: "TFG-Labs",
  viewer: { login: "octo-player", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
  totalCount: 1,
  fetchedAt: "2026-10-08T12:00:00Z",
  pullRequests: [
    {
      repository: "web",
      number: 7,
      title: "Add login",
      url: "https://github.com/TFG-Labs/web/pull/7",
      draft: false,
      updatedAt: "2026-10-07T12:00:00Z",
    },
  ],
};

describe("isPullRequestsPayload", () => {
  it("accepts a well-formed payload", () => {
    expect(isPullRequestsPayload(valid)).toBe(true);
  });

  it("rejects pull request URLs that do not point at github.com", () => {
    const hostile = {
      ...valid,
      pullRequests: [{ ...valid.pullRequests[0], url: "javascript:alert(1)" }],
    };

    expect(isPullRequestsPayload(hostile)).toBe(false);
  });

  it("rejects avatar URLs from other hosts", () => {
    const hostile = {
      ...valid,
      viewer: { ...valid.viewer, avatarUrl: "https://tracker.example/pixel.gif" },
    };

    expect(isPullRequestsPayload(hostile)).toBe(false);
  });

  it.each([null, "text", [], {}])("rejects %j", (value) => {
    expect(isPullRequestsPayload(value)).toBe(false);
  });
});

describe("isOwnersPayload", () => {
  const owners = {
    defaultOwner: "TFG-Labs",
    owners: [
      {
        login: "octo-player",
        avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
        personal: true,
      },
    ],
  };

  it("accepts a well-formed payload", () => {
    expect(isOwnersPayload(owners)).toBe(true);
  });

  it("rejects avatar URLs from other hosts", () => {
    const hostile = {
      ...owners,
      owners: [{ ...owners.owners[0], avatarUrl: "https://tracker.example/pixel.gif" }],
    };

    expect(isOwnersPayload(hostile)).toBe(false);
  });

  it.each([null, [], {}, { defaultOwner: "TFG-Labs" }])("rejects %j", (value) => {
    expect(isOwnersPayload(value)).toBe(false);
  });
});
