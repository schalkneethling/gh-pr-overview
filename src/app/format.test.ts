import { describe, expect, it } from "vite-plus/test";

import { avatarAtSize, formatRelativeTime, pluralize } from "./format.ts";

const NOW = Date.parse("2026-10-08T12:00:00Z");

describe("formatRelativeTime", () => {
  it.each([
    ["2026-10-08T11:59:30Z", "now"],
    ["2026-10-08T11:55:00Z", "5 minutes ago"],
    ["2026-10-08T09:00:00Z", "3 hours ago"],
    ["2026-10-07T12:00:00Z", "yesterday"],
    ["2026-10-05T12:00:00Z", "3 days ago"],
    ["2026-09-24T12:00:00Z", "2 weeks ago"],
    ["2026-07-08T12:00:00Z", "3 months ago"],
    ["2024-10-08T12:00:00Z", "2 years ago"],
  ])("formats %s as %s", (isoDate, expected) => {
    expect(formatRelativeTime(isoDate, NOW)).toBe(expected);
  });
});

describe("pluralize", () => {
  it("uses the singular for exactly one", () => {
    expect(pluralize(1, "repository", "repositories")).toBe("1 repository");
  });

  it("uses the plural for zero and many", () => {
    expect(pluralize(0, "open PR")).toBe("0 open PRs");
    expect(pluralize(4, "repository", "repositories")).toBe("4 repositories");
  });
});

describe("avatarAtSize", () => {
  it("sets the size, keeping GitHub's other parameters", () => {
    expect(avatarAtSize("https://avatars.githubusercontent.com/u/1?v=4", 24)).toBe(
      "https://avatars.githubusercontent.com/u/1?v=4&s=24",
    );
  });

  it("replaces an existing size", () => {
    expect(avatarAtSize("https://avatars.githubusercontent.com/u/1?s=460", 40)).toBe(
      "https://avatars.githubusercontent.com/u/1?s=40",
    );
  });
});
