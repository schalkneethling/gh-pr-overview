import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import type { OwnersPayload, PullRequestsPayload } from "../src/shared/pull-requests.ts";
import { allowWithoutAccess, type AccessVerifier } from "./access.ts";
import { handleApiRequest } from "./router.ts";

const CONFIG = { token: "test-token", org: "TFG-Labs" };

const USER = {
  login: "octo-player",
  avatar_url: "https://avatars.githubusercontent.com/u/1?v=4",
};

const SEARCH = {
  total_count: 2,
  incomplete_results: false,
  items: [
    {
      node_id: "PR_web_7",
      number: 7,
      title: "Add login",
      html_url: "https://github.com/TFG-Labs/web/pull/7",
      repository_url: "https://api.github.com/repos/TFG-Labs/web",
      draft: true,
      updated_at: "2026-10-07T12:00:00Z",
    },
    {
      node_id: "PR_api_3",
      number: 3,
      title: "Speed up search",
      html_url: "https://github.com/TFG-Labs/api/pull/3",
      repository_url: "https://api.github.com/repos/TFG-Labs/api",
      updated_at: "2026-10-06T12:00:00Z",
    },
  ],
};

const REVIEW_DECISIONS = {
  data: {
    nodes: [
      { id: "PR_web_7", reviewDecision: "APPROVED" },
      { id: "PR_api_3", reviewDecision: null },
    ],
  },
};

const ORGS = [
  { login: "zeta-games", avatar_url: "https://avatars.githubusercontent.com/u/3?v=4" },
  { login: "TFG-Labs", avatar_url: "https://avatars.githubusercontent.com/u/2?v=4" },
];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

/** Stands in for api.github.com: the only external boundary the Worker talks to. */
function fakeGitHub(
  responses: {
    user?: Response;
    search?: Response;
    graphql?: Response;
    orgs?: Response;
    org?: Response;
  } = {},
) {
  const requests: Request[] = [];
  const fetchImplementation = vi.fn<typeof fetch>(async (input, init) => {
    const request = new Request(input, init);
    requests.push(request);
    const { pathname } = new URL(request.url);

    if (pathname === "/user") {
      return responses.user ?? jsonResponse(USER);
    }

    if (pathname === "/search/issues") {
      return responses.search ?? jsonResponse(SEARCH);
    }

    if (pathname === "/graphql") {
      return responses.graphql ?? jsonResponse(REVIEW_DECISIONS);
    }

    if (pathname === "/user/orgs") {
      return responses.orgs ?? jsonResponse(ORGS);
    }

    if (pathname.startsWith("/orgs/")) {
      return responses.org ?? jsonResponse({ message: "Not Found" }, 404);
    }

    return jsonResponse({ message: "Not Found" }, 404);
  });

  return { fetchImplementation, requests };
}

function get(path: string, method = "GET"): Request {
  return new Request(`https://pr-quest.example${path}`, { method });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/pull-requests", () => {
  it("runs the same search as `gh search prs --author @me --state open --owner TFG-Labs --limit 100`", async () => {
    const github = fakeGitHub();

    await handleApiRequest(get("/api/pull-requests"), {
      github: CONFIG,
      verifyAccess: allowWithoutAccess,
      fetch: github.fetchImplementation,
    });

    const search = github.requests.find(
      (request) => new URL(request.url).pathname === "/search/issues",
    );
    const params = new URL(search?.url ?? "").searchParams;

    // `gh search prs --owner` uses the `user:` qualifier, which matches organizations too.
    expect(params.get("q")).toBe("is:pr is:open author:@me user:TFG-Labs");
    expect(params.get("per_page")).toBe("100");
    expect(search?.headers.get("authorization")).toBe("token test-token");
  });

  it("returns the viewer and a flat list of pull requests with repository names", async () => {
    const github = fakeGitHub();

    const response = await handleApiRequest(get("/api/pull-requests"), {
      github: CONFIG,
      verifyAccess: allowWithoutAccess,
      fetch: github.fetchImplementation,
    });
    const body = (await response.json()) as PullRequestsPayload;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      owner: "TFG-Labs",
      viewer: { login: "octo-player", avatarUrl: USER.avatar_url },
      totalCount: 2,
      pullRequests: [
        {
          repository: "web",
          number: 7,
          title: "Add login",
          url: "https://github.com/TFG-Labs/web/pull/7",
          draft: true,
          updatedAt: "2026-10-07T12:00:00Z",
          reviewStatus: "approved",
        },
        {
          repository: "api",
          number: 3,
          title: "Speed up search",
          url: "https://github.com/TFG-Labs/api/pull/3",
          draft: false,
          updatedAt: "2026-10-06T12:00:00Z",
          reviewStatus: "awaiting-review",
        },
      ],
    });
    expect(Number.isNaN(Date.parse(body.fetchedAt))).toBe(false);
  });

  describe("review status", () => {
    async function reviewStatuses(github: ReturnType<typeof fakeGitHub>) {
      const response = await handleApiRequest(get("/api/pull-requests"), {
        github: CONFIG,
        verifyAccess: allowWithoutAccess,
        fetch: github.fetchImplementation,
      });
      const body = (await response.json()) as PullRequestsPayload;

      return body.pullRequests.map(({ reviewStatus }) => reviewStatus);
    }

    function graphql(nodes: unknown[], errors?: unknown[]): Response {
      return jsonResponse({ data: { nodes }, ...(errors ? { errors } : {}) });
    }

    it("looks up the review decision of every pull request the search found", async () => {
      const github = fakeGitHub();

      await reviewStatuses(github);

      const lookup = github.requests.find(
        (request) => new URL(request.url).pathname === "/graphql",
      );
      const body = (await lookup?.json()) as { variables: { ids: string[] } };

      expect(lookup?.method).toBe("POST");
      expect(body.variables.ids).toEqual(["PR_web_7", "PR_api_3"]);
    });

    it.each([
      ["APPROVED", "approved"],
      ["CHANGES_REQUESTED", "changes-requested"],
      ["REVIEW_REQUIRED", "awaiting-review"],
      // The base branch does not require reviews and nobody has reviewed yet.
      [null, "awaiting-review"],
    ])("reports GitHub's %j decision as %j", async (reviewDecision, reviewStatus) => {
      const github = fakeGitHub({
        graphql: graphql([
          { id: "PR_web_7", reviewDecision },
          { id: "PR_api_3", reviewDecision },
        ]),
      });

      expect(await reviewStatuses(github)).toEqual([reviewStatus, reviewStatus]);
    });

    it("still lists a pull request GitHub could not resolve, without a status, and logs why", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const github = fakeGitHub({
        graphql: graphql(
          [{ id: "PR_web_7", reviewDecision: "APPROVED" }, null],
          [{ message: "Could not resolve to a node with the global id of 'PR_api_3'" }],
        ),
      });

      expect(await reviewStatuses(github)).toEqual(["approved", null]);
      expect(JSON.stringify(log.mock.calls)).toContain("PR_api_3");
    });

    it("skips nodes that are not pull requests", async () => {
      const github = fakeGitHub({
        graphql: graphql([{}, { id: "PR_api_3", reviewDecision: "APPROVED" }]),
      });

      expect(await reviewStatuses(github)).toEqual([null, "approved"]);
    });

    it("fails the request when GitHub answers the lookup with errors and no data", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      // GitHub's answer to a spent GraphQL rate limit: HTTP 200, errors, no data.
      const github = fakeGitHub({
        graphql: jsonResponse({
          errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }],
        }),
      });

      const response = await handleApiRequest(get("/api/pull-requests"), {
        github: CONFIG,
        verifyAccess: allowWithoutAccess,
        fetch: github.fetchImplementation,
      });

      expect(response.status).toBe(502);
      expect(((await response.json()) as { error: string }).error).toMatch(
        /did not answer as expected/,
      );
      expect(JSON.stringify(log.mock.calls)).toContain("RATE_LIMITED");
    });

    it("leaves the status empty for a decision it does not know", async () => {
      const github = fakeGitHub({
        graphql: graphql([
          { id: "PR_web_7", reviewDecision: "SOMETHING_NEW" },
          { id: "PR_api_3", reviewDecision: "APPROVED" },
        ]),
      });

      expect(await reviewStatuses(github)).toEqual([null, "approved"]);
    });

    it("skips the lookup when the search found nothing", async () => {
      const github = fakeGitHub({
        search: jsonResponse({ total_count: 0, incomplete_results: false, items: [] }),
      });

      expect(await reviewStatuses(github)).toEqual([]);
      expect(github.requests.some((request) => new URL(request.url).pathname === "/graphql")).toBe(
        false,
      );
    });

    it("maps a failed lookup like any other GitHub failure", async () => {
      vi.spyOn(console, "error").mockImplementation(() => {});
      const github = fakeGitHub({ graphql: jsonResponse({ message: "nope" }, 401) });

      const response = await handleApiRequest(get("/api/pull-requests"), {
        github: CONFIG,
        verifyAccess: allowWithoutAccess,
        fetch: github.fetchImplementation,
      });

      expect(response.status).toBe(502);
      expect(((await response.json()) as { error: string }).error).toMatch(
        /GitHub rejected the token/,
      );
    });
  });

  it("searches the owner named in the request", async () => {
    const github = fakeGitHub();

    const response = await handleApiRequest(get("/api/pull-requests?owner=octo-player"), {
      github: CONFIG,
      verifyAccess: allowWithoutAccess,
      fetch: github.fetchImplementation,
    });
    const search = github.requests.find(
      (request) => new URL(request.url).pathname === "/search/issues",
    );

    expect(new URL(search?.url ?? "").searchParams.get("q")).toBe(
      "is:pr is:open author:@me user:octo-player",
    );
    expect(((await response.json()) as PullRequestsPayload).owner).toBe("octo-player");
  });

  it.each(["TFG-Labs is:closed", "", "-leading-hyphen"])(
    "refuses the owner %j with 400 before calling GitHub",
    async (owner) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const github = fakeGitHub();

      const response = await handleApiRequest(
        get(`/api/pull-requests?${new URLSearchParams({ owner }).toString()}`),
        { github: CONFIG, verifyAccess: allowWithoutAccess, fetch: github.fetchImplementation },
      );

      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toMatch(
        /not a valid GitHub account name/,
      );
      expect(github.fetchImplementation).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalled();
    },
  );

  describe("when GitHub fails", () => {
    it.each([
      [401, {}, 502, /GitHub rejected the token/],
      [403, { "x-ratelimit-remaining": "0" }, 503, /rate limit/],
      [403, { "retry-after": "60" }, 503, /rate limit/],
      [429, {}, 503, /rate limit/],
      [403, {}, 502, /repo and read:org scopes/],
      [422, {}, 502, /could not find that account/],
      [500, {}, 502, /did not answer as expected/],
    ])(
      "maps GitHub %i %j to %i with an actionable message",
      async (gitHubStatus, headers, status, message) => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const github = fakeGitHub({
          search: jsonResponse({ message: "nope" }, gitHubStatus, headers),
        });

        const response = await handleApiRequest(get("/api/pull-requests"), {
          github: CONFIG,
          verifyAccess: allowWithoutAccess,
          fetch: github.fetchImplementation,
        });
        const body = (await response.json()) as { error: string };

        expect(response.status).toBe(status);
        expect(body.error).toMatch(message);
      },
    );

    it("never echoes the token in the error response or the log", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      const github = fakeGitHub({ user: jsonResponse({ message: "Bad credentials" }, 401) });

      const response = await handleApiRequest(get("/api/pull-requests"), {
        github: CONFIG,
        verifyAccess: allowWithoutAccess,
        fetch: github.fetchImplementation,
      });

      expect(await response.text()).not.toContain(CONFIG.token);
      expect(JSON.stringify(log.mock.calls)).not.toContain(CONFIG.token);
    });
  });

  it("refuses an org that would change the search query", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const github = fakeGitHub();

    const response = await handleApiRequest(get("/api/pull-requests"), {
      github: { ...CONFIG, org: "TFG-Labs is:closed" },
      verifyAccess: allowWithoutAccess,
      fetch: github.fetchImplementation,
    });

    expect(response.status).toBe(500);
    expect(github.fetchImplementation).not.toHaveBeenCalled();
  });
});

describe("GET /api/owners", () => {
  async function owners(github: ReturnType<typeof fakeGitHub>, config = CONFIG) {
    const response = await handleApiRequest(get("/api/owners"), {
      github: config,
      verifyAccess: allowWithoutAccess,
      fetch: github.fetchImplementation,
    });

    return { response, body: (await response.json()) as OwnersPayload };
  }

  it("lists the personal account first, then organizations by name", async () => {
    const { response, body } = await owners(fakeGitHub());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      defaultOwner: "TFG-Labs",
      owners: [
        { login: "octo-player", avatarUrl: USER.avatar_url, personal: true },
        { login: "TFG-Labs", avatarUrl: ORGS[1]?.avatar_url, personal: false },
        { login: "zeta-games", avatarUrl: ORGS[0]?.avatar_url, personal: false },
      ],
    });
  });

  it("uses GitHub's spelling of the default owner", async () => {
    const { body } = await owners(fakeGitHub(), { ...CONFIG, org: "tfg-labs" });

    expect(body.defaultOwner).toBe("TFG-Labs");
  });

  it("adds the default org when GitHub lists no organizations (fine-grained tokens)", async () => {
    const github = fakeGitHub({
      orgs: jsonResponse([]),
      org: jsonResponse({ login: "TFG-Labs", avatar_url: ORGS[1]?.avatar_url }),
    });

    const { body } = await owners(github);

    expect(body.owners.map(({ login }) => login)).toEqual(["octo-player", "TFG-Labs"]);
    expect(
      github.requests.some((request) => new URL(request.url).pathname === "/orgs/TFG-Labs"),
    ).toBe(true);
  });

  it("asks for read:org when GitHub refuses to list organizations", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});

    const { response, body } = await owners(
      fakeGitHub({ orgs: jsonResponse({ message: "Forbidden" }, 403) }),
    );

    expect(response.status).toBe(502);
    expect(JSON.stringify(body)).toMatch(/read:org/);
  });
});

describe("other API routes", () => {
  it("answers unknown paths with a JSON 404", async () => {
    const response = await handleApiRequest(get("/api/nope"), {
      github: CONFIG,
      verifyAccess: allowWithoutAccess,
      fetch: fakeGitHub().fetchImplementation,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found." });
  });

  it("only allows GET", async () => {
    const response = await handleApiRequest(get("/api/pull-requests", "POST"), {
      github: CONFIG,
      verifyAccess: allowWithoutAccess,
      fetch: fakeGitHub().fetchImplementation,
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET");
  });
});

describe("Cloudflare Access gate", () => {
  const deny: AccessVerifier = async () => ({ allowed: false, reason: "Sign in first." });

  it.each(["/api/pull-requests", "/api/owners", "/api/nope"])(
    "refuses %s with 403 before routing or calling GitHub",
    async (path) => {
      const github = fakeGitHub();

      const response = await handleApiRequest(get(path), {
        github: CONFIG,
        verifyAccess: deny,
        fetch: github.fetchImplementation,
      });

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Sign in first." });
      expect(github.fetchImplementation).not.toHaveBeenCalled();
    },
  );
});
