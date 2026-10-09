// @vitest-environment happy-dom
import { screen, within } from "@testing-library/dom";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { OwnersPayload, PullRequestsPayload } from "../shared/pull-requests.ts";
import "./pr-quest-app.ts";

function payload(overrides: Partial<PullRequestsPayload> = {}): PullRequestsPayload {
  return {
    owner: "TFG-Labs",
    viewer: { login: "octo-player", avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4" },
    totalCount: 3,
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
      {
        repository: "api",
        number: 3,
        title: "Speed up search",
        url: "https://github.com/TFG-Labs/api/pull/3",
        draft: true,
        updatedAt: "2026-10-06T12:00:00Z",
      },
      {
        repository: "web",
        number: 9,
        title: "Fix footer",
        url: "https://github.com/TFG-Labs/web/pull/9",
        draft: false,
        updatedAt: "2026-10-05T12:00:00Z",
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const OWNERS: OwnersPayload = {
  defaultOwner: "TFG-Labs",
  owners: [
    {
      login: "octo-player",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      personal: true,
    },
    {
      login: "TFG-Labs",
      avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
      personal: false,
    },
  ],
};

const fetchMock = vi.fn<typeof fetch>();

type Reply = (url: URL) => Response;

function urlOf(input: Parameters<typeof fetch>[0]): URL {
  return new URL(input instanceof Request ? input.url : input, "https://pr-quest.example");
}

/**
 * Stands in for the Worker API. `pullRequests` replies in turn, the last one
 * repeating; each call builds a fresh Response because a body reads only once.
 */
function serve(pullRequests: Reply | Reply[], owners: Reply = () => jsonResponse(OWNERS)): void {
  const queue = Array.isArray(pullRequests) ? [...pullRequests] : [pullRequests];

  fetchMock.mockImplementation(async (input) => {
    const url = urlOf(input);

    if (url.pathname === "/api/owners") {
      return owners(url);
    }

    const reply = queue.length > 1 ? queue.shift() : queue[0];

    if (!reply) {
      throw new Error("No reply configured");
    }

    return reply(url);
  });
}

function pullRequestRequests(): URL[] {
  return fetchMock.mock.calls
    .map(([input]) => urlOf(input))
    .filter(({ pathname }) => pathname === "/api/pull-requests");
}

function mount(): void {
  document.body.append(document.createElement("pr-quest-app"));
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  document.body.replaceChildren();
  localStorage.clear();
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("PR Quest app", () => {
  describe("when pull requests load", () => {
    it("groups pull requests under a heading per repository, in name order", async () => {
      serve(() => jsonResponse(payload()));
      mount();

      const headings = await screen.findAllByRole("heading", { level: 2 });

      expect(headings.map((heading) => heading.textContent?.trim())).toEqual(["api", "web"]);

      const web = screen.getByRole("region", { name: "web" });
      const links = within(within(web).getByRole("list")).getAllByRole("link");

      expect(links.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
        ["Add login", "https://github.com/TFG-Labs/web/pull/7"],
        ["Fix footer", "https://github.com/TFG-Labs/web/pull/9"],
      ]);
      expect(within(web).getByText("2 open PRs")).toBeTruthy();
    });

    it("shows totals for open pull requests, repositories, and drafts", async () => {
      serve(() => jsonResponse(payload()));
      mount();

      const openPrs = await screen.findByText("Open PRs");

      expect(openPrs.nextElementSibling?.textContent).toBe("3");
      expect(screen.getByText("Repositories").nextElementSibling?.textContent).toBe("2");
      expect(screen.getByText("Drafts").nextElementSibling?.textContent).toBe("1");
    });

    it("marks draft pull requests", async () => {
      serve(() => jsonResponse(payload()));
      mount();

      const api = await screen.findByRole("region", { name: "api" });

      expect(within(api).getByText("Draft")).toBeTruthy();
    });

    it("names the organisation and the signed-in player", async () => {
      serve(() => jsonResponse(payload()));
      mount();

      expect(await screen.findByText("octo-player")).toBeTruthy();
      expect(
        screen.getByRole("heading", { level: 1 }).textContent?.replace(/\s+/g, " ").trim(),
      ).toBe("Open pull requests in TFG-Labs");
    });

    it("announces how much was loaded", async () => {
      serve(() => jsonResponse(payload()));
      mount();

      await screen.findByRole("region", { name: "api" });

      expect(screen.getByRole("status").textContent).toBe(
        "Loaded 3 pull requests across 2 repositories.",
      );
    });

    it("says when GitHub has more results than were fetched", async () => {
      serve(() => jsonResponse(payload({ totalCount: 140 })));
      mount();

      expect(await screen.findByText(/Showing the 3 most recently updated of 140\./)).toBeTruthy();
    });
  });

  describe("filtering", () => {
    it("narrows the list to pull requests whose title, repository, or number matches", async () => {
      const user = userEvent.setup();
      serve(() => jsonResponse(payload()));
      mount();

      await screen.findByRole("region", { name: "api" });
      await user.type(screen.getByRole("searchbox", { name: /filter/i }), "footer");

      expect(screen.queryByRole("region", { name: "api" })).toBeNull();
      expect(screen.getByRole("link", { name: "Fix footer" })).toBeTruthy();
      expect(screen.queryByRole("link", { name: "Add login" })).toBeNull();
      expect(screen.getByRole("status").textContent).toBe("Showing 1 of 3 pull requests.");

      await user.clear(screen.getByRole("searchbox", { name: /filter/i }));
      await user.type(screen.getByRole("searchbox", { name: /filter/i }), "#3");

      expect(screen.getByRole("link", { name: "Speed up search" })).toBeTruthy();
      expect(screen.queryByRole("region", { name: "web" })).toBeNull();
    });

    it("explains when nothing matches", async () => {
      const user = userEvent.setup();
      serve(() => jsonResponse(payload()));
      mount();

      await screen.findByRole("region", { name: "api" });
      await user.type(screen.getByRole("searchbox", { name: /filter/i }), "zebra");

      expect(screen.getByRole("heading", { name: "No matches" })).toBeTruthy();
      expect(screen.getByText("No pull request matches “zebra”.")).toBeTruthy();
    });
  });

  describe("when there are no open pull requests", () => {
    it("celebrates an empty quest log and disables list actions", async () => {
      serve(() => jsonResponse(payload({ pullRequests: [], totalCount: 0 })));
      mount();

      expect(await screen.findByRole("heading", { name: "All clear!" })).toBeTruthy();
      expect(screen.getByText("You have no open pull requests in TFG-Labs.")).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Copy as text" }).disabled).toBe(
        true,
      );
    });
  });

  describe("when loading fails", () => {
    it("shows the server's error and recovers on Continue", async () => {
      const user = userEvent.setup();
      serve([
        () => jsonResponse({ error: "GitHub rejected the token." }, 502),
        () => jsonResponse(payload()),
      ]);
      mount();

      const alert = await screen.findByRole("alert");

      expect(within(alert).getByRole("heading", { name: "Game over" })).toBeTruthy();
      expect(within(alert).getByText("GitHub rejected the token.")).toBeTruthy();

      await user.click(within(alert).getByRole("button", { name: "Continue?" }));

      expect(await screen.findByRole("region", { name: "api" })).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("explains a network failure in plain words", async () => {
      fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
      mount();

      expect(
        within(await screen.findByRole("alert")).getByText(
          "Could not reach the server. Check your connection and try again.",
        ),
      ).toBeTruthy();
    });
  });

  describe("choosing whose pull requests to show", () => {
    it("offers the personal account and organizations, starting on the default", async () => {
      serve(() => jsonResponse(payload()));
      mount();

      const picker = await screen.findByRole<HTMLSelectElement>("combobox", {
        name: "Show pull requests in",
      });
      await screen.findByRole("option", { name: "octo-player (you)" });

      expect(
        within(picker)
          .getAllByRole("option")
          .map((option) => option.textContent?.replace(/\s+/g, " ").trim()),
      ).toEqual(["octo-player (you)", "TFG-Labs"]);
      expect(picker.value).toBe("TFG-Labs");
      expect(pullRequestRequests()[0]?.search).toBe("");
    });

    it("loads the chosen owner's pull requests and remembers the choice", async () => {
      const user = userEvent.setup();
      serve((url) =>
        jsonResponse(
          url.searchParams.get("owner") === "octo-player"
            ? payload({ owner: "octo-player", pullRequests: [], totalCount: 0 })
            : payload(),
        ),
      );
      mount();

      await screen.findByRole("region", { name: "api" });
      await screen.findByRole("option", { name: "octo-player (you)" });
      await user.selectOptions(
        screen.getByRole("combobox", { name: "Show pull requests in" }),
        "octo-player",
      );

      expect(
        await screen.findByText("You have no open pull requests in octo-player."),
      ).toBeTruthy();
      expect(pullRequestRequests().at(-1)?.searchParams.get("owner")).toBe("octo-player");
      expect(localStorage.getItem("pr-quest:owner")).toBe("octo-player");
    });

    it("starts on the remembered owner", async () => {
      localStorage.setItem("pr-quest:owner", "octo-player");
      serve(() => jsonResponse(payload({ owner: "octo-player" })));
      mount();

      await screen.findByRole("option", { name: "octo-player (you)" });

      expect(pullRequestRequests()[0]?.searchParams.get("owner")).toBe("octo-player");
      expect(
        screen.getByRole<HTMLSelectElement>("combobox", { name: "Show pull requests in" }).value,
      ).toBe("octo-player");
    });

    it("falls back to the default when the remembered owner is no longer listed", async () => {
      localStorage.setItem("pr-quest:owner", "old-org");
      serve(() => jsonResponse(payload()));
      mount();

      await screen.findByRole("option", { name: "octo-player (you)" });

      await vi.waitFor(() => {
        expect(pullRequestRequests().at(-1)?.search).toBe("");
      });
      expect(localStorage.getItem("pr-quest:owner")).toBeNull();
    });

    it("still shows pull requests when the accounts cannot load", async () => {
      serve(
        () => jsonResponse(payload()),
        () => jsonResponse({ error: "GitHub refused access." }, 502),
      );
      mount();

      expect(await screen.findByRole("region", { name: "api" })).toBeTruthy();
      expect(
        await screen.findByText("Could not load your accounts. GitHub refused access."),
      ).toBeTruthy();
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  });

  describe("Copy as text", () => {
    it("copies the visible pull requests in the gh CLI text format", async () => {
      const user = userEvent.setup();
      serve(() => jsonResponse(payload()));
      mount();

      await screen.findByRole("region", { name: "api" });
      await user.click(screen.getByRole("button", { name: "Copy as text" }));

      expect(await navigator.clipboard.readText()).toBe(
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
      expect(screen.getByRole("status").textContent).toBe("Copied 3 pull requests as text.");
    });
  });

  describe("Sound", () => {
    it("is off by default and toggles as a pressed button", async () => {
      const user = userEvent.setup();
      serve(() => jsonResponse(payload()));
      mount();

      const sound = await screen.findByRole("button", { name: /sound/i });

      expect(sound.getAttribute("aria-pressed")).toBe("false");

      await user.click(sound);

      expect(sound.getAttribute("aria-pressed")).toBe("true");
    });
  });
});
