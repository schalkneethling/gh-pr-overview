import { html, LitElement, nothing, type TemplateResult } from "lit";

import {
  formatAsText,
  groupByRepository,
  type PullRequestSummary,
  type PullRequestsPayload,
  type Viewer,
} from "../shared/pull-requests.ts";
import { fetchOwners, fetchPullRequests } from "./api.ts";
import { avatarAtSize, pluralize } from "./format.ts";
import { renderOwnerPicker, type OwnersState } from "./owner-picker.ts";
import {
  readOwnerPreference,
  readSoundPreference,
  writeOwnerPreference,
  writeSoundPreference,
} from "./preferences.ts";
import { renderRepositoryGroup } from "./repository-group.ts";
import { createCuePlayer, type Cue } from "./sound.ts";

type RequestState =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "error"; message: string };

const timeFormat = new Intl.DateTimeFormat("en", { timeStyle: "short" });

function matchesQuery(pullRequest: PullRequestSummary, query: string): boolean {
  const needle = query.trim().toLowerCase();

  if (needle === "") {
    return true;
  }

  return (
    pullRequest.title.toLowerCase().includes(needle) ||
    pullRequest.repository.toLowerCase().includes(needle) ||
    `#${pullRequest.number}`.includes(needle)
  );
}

/**
 * The whole app. Renders into light DOM so the shared typography and token
 * stylesheets apply without being duplicated into a shadow root.
 */
export class PrQuestApp extends LitElement {
  static override properties = {
    request: { state: true },
    payload: { state: true },
    owners: { state: true },
    selectedOwner: { state: true },
    query: { state: true },
    soundEnabled: { state: true },
    announcement: { state: true },
  };

  declare request: RequestState;
  declare payload: PullRequestsPayload | null;
  declare owners: OwnersState;
  /** null searches the server's default owner. */
  declare selectedOwner: string | null;
  declare query: string;
  declare soundEnabled: boolean;
  declare announcement: string;

  #abortController: AbortController | undefined;
  #ownersAbortController: AbortController | undefined;
  #playCue = createCuePlayer();

  constructor() {
    super();
    this.request = { status: "loading" };
    this.payload = null;
    this.owners = { status: "loading" };
    this.selectedOwner = readOwnerPreference();
    this.query = "";
    this.soundEnabled = readSoundPreference();
    this.announcement = "";
  }

  protected override createRenderRoot(): HTMLElement {
    return this;
  }

  override connectedCallback(): void {
    super.connectedCallback();
    void this.load();
    void this.#loadOwners();
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#abortController?.abort();
    this.#ownersAbortController?.abort();
  }

  async load(): Promise<void> {
    this.#abortController?.abort();
    const controller = new AbortController();
    this.#abortController = controller;

    this.request = { status: "loading" };
    this.announcement = "Loading your pull requests…";

    try {
      const payload = await fetchPullRequests(this.selectedOwner, controller.signal);

      this.payload = payload;
      this.request = { status: "ready" };
      this.announcement = `Loaded ${pluralize(payload.pullRequests.length, "pull request")} across ${pluralize(groupByRepository(payload.pullRequests).length, "repository", "repositories")}.`;
      this.#cue("success");
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : "Something went wrong.";
      this.request = { status: "error", message };
      this.announcement = "";
      this.#cue("error");
    }
  }

  async #loadOwners(): Promise<void> {
    const controller = new AbortController();
    this.#ownersAbortController = controller;

    try {
      const { owners, defaultOwner } = await fetchOwners(controller.signal);

      this.owners = { status: "ready", owners, defaultOwner };

      // A remembered owner the viewer no longer belongs to: fall back to the default.
      if (
        this.selectedOwner !== null &&
        !owners.some(({ login }) => login === this.selectedOwner)
      ) {
        this.#selectOwner(null);
      }
    } catch (error) {
      if (controller.signal.aborted) {
        return;
      }

      this.owners = {
        status: "error",
        message: error instanceof Error ? error.message : "Something went wrong.",
      };
    }
  }

  #selectOwner(owner: string | null): void {
    this.selectedOwner = owner;
    writeOwnerPreference(owner);
    // The previous owner's pull requests must not show under the new one.
    this.payload = null;
    void this.load();
  }

  #cue(cue: Cue): void {
    if (this.soundEnabled) {
      this.#playCue(cue);
    }
  }

  #visiblePullRequests(): PullRequestSummary[] {
    return (this.payload?.pullRequests ?? []).filter((pullRequest) =>
      matchesQuery(pullRequest, this.query),
    );
  }

  #onRefresh = (): void => {
    this.#cue("start");
    void this.load();
  };

  #onFilterInput = (event: InputEvent): void => {
    if (!(event.target instanceof HTMLInputElement)) {
      return;
    }

    this.query = event.target.value;
    const total = this.payload?.pullRequests.length ?? 0;

    this.announcement =
      this.query.trim() === ""
        ? `Showing all ${pluralize(total, "pull request")}.`
        : `Showing ${this.#visiblePullRequests().length} of ${pluralize(total, "pull request")}.`;
  };

  #onFilterSubmit = (event: SubmitEvent): void => {
    // Filtering is live; submitting (Enter) must not reload the page.
    event.preventDefault();
  };

  #onOwnerChange = (event: Event): void => {
    if (!(event.target instanceof HTMLSelectElement)) {
      return;
    }

    this.#cue("start");
    this.#selectOwner(event.target.value);
  };

  #onToggleSound = (): void => {
    this.soundEnabled = !this.soundEnabled;
    writeSoundPreference(this.soundEnabled);
    this.#cue("start");
  };

  #onCopy = async (): Promise<void> => {
    const visible = this.#visiblePullRequests();

    try {
      await navigator.clipboard.writeText(formatAsText(groupByRepository(visible)));
      this.announcement = `Copied ${pluralize(visible.length, "pull request")} as text.`;
      this.#cue("copy");
    } catch {
      this.announcement = "Copying failed. Your browser blocked clipboard access.";
      this.#cue("error");
    }
  };

  protected override render(): TemplateResult {
    return html`
      <header class="site-header">
        <p class="brand typo-lg">
          <img class="brand-sprite" src="/favicon.svg" alt="" width="48" height="48" />
          PR Quest
        </p>
        ${this.#renderPlayer()}
      </header>
      <main id="main-content" class="stage">
        <h1 class="title typo-display">
          Open pull requests
          ${this.payload ? html`<span class="title-owner">in ${this.payload.owner}</span>` : nothing}
        </h1>
        ${this.#renderHud()} ${this.#renderControls()}
        <p class="status-line typo-small" role="status">${this.announcement}</p>
        <div class="results" aria-busy=${this.request.status === "loading" ? "true" : "false"}>
          ${this.#renderResults()}
        </div>
      </main>
      ${this.#renderFooter()}
    `;
  }

  /** Known from either request, so the header stays put while switching owners. */
  #viewer(): Viewer | null {
    if (this.payload) {
      return this.payload.viewer;
    }

    const personal =
      this.owners.status === "ready" ? this.owners.owners.find(({ personal }) => personal) : null;

    return personal ? { login: personal.login, avatarUrl: personal.avatarUrl } : null;
  }

  #renderPlayer(): TemplateResult | typeof nothing {
    const viewer = this.#viewer();

    if (!viewer) {
      return nothing;
    }

    const { login, avatarUrl } = viewer;

    return html`
      <p class="player typo-small">
        <img
          class="player-avatar"
          src=${avatarAtSize(avatarUrl, 24)}
          alt=""
          width="48"
          height="48"
        />
        <span><span class="player-label">Player 1</span> ${login}</span>
      </p>
    `;
  }

  #renderHud(): TemplateResult | typeof nothing {
    if (!this.payload) {
      return nothing;
    }

    const { pullRequests } = this.payload;
    const repositories = groupByRepository(pullRequests).length;
    const drafts = pullRequests.filter(({ draft }) => draft).length;

    return html`
      <dl class="hud">
        <div class="hud-stat pixel-frame">
          <dt class="typo-xs">Open PRs</dt>
          <dd class="typo-xxl">${pullRequests.length}</dd>
        </div>
        <div class="hud-stat pixel-frame">
          <dt class="typo-xs">Repositories</dt>
          <dd class="typo-xxl">${repositories}</dd>
        </div>
        <div class="hud-stat pixel-frame">
          <dt class="typo-xs">Drafts</dt>
          <dd class="typo-xxl">${drafts}</dd>
        </div>
      </dl>
    `;
  }

  #renderControls(): TemplateResult {
    const hasData = this.payload !== null && this.payload.pullRequests.length > 0;
    const hasVisible = this.#visiblePullRequests().length > 0;
    const isLoading = this.request.status === "loading";

    return html`
      <div class="controls">
        ${renderOwnerPicker({
          state: this.owners,
          selected:
            this.selectedOwner ?? (this.owners.status === "ready" ? this.owners.defaultOwner : ""),
          onChange: this.#onOwnerChange,
        })}
        <search class="filter">
          <form @submit=${this.#onFilterSubmit}>
            <label class="filter-label typo-small" for="filter"
              >Filter by title, repository, or #number</label
            >
            <input
              class="filter-input typo-default pixel-frame"
              id="filter"
              type="search"
              autocomplete="off"
              spellcheck="false"
              .value=${this.query}
              ?disabled=${!hasData}
              @input=${this.#onFilterInput}
            />
          </form>
        </search>
        <div class="actions">
          <button
            class="button typo-small pixel-frame"
            type="button"
            ?disabled=${isLoading}
            @click=${this.#onRefresh}
          >
            ${isLoading ? "Loading…" : "Refresh"}
          </button>
          <button
            class="button typo-small pixel-frame"
            type="button"
            ?disabled=${!hasVisible}
            @click=${this.#onCopy}
          >
            Copy as text
          </button>
          <button
            class="button button-quiet typo-small pixel-frame"
            type="button"
            aria-pressed=${this.soundEnabled ? "true" : "false"}
            @click=${this.#onToggleSound}
          >
            Sound
          </button>
        </div>
      </div>
    `;
  }

  #renderResults(): TemplateResult {
    const { request, payload } = this;

    if (request.status === "error") {
      return html`
        <div class="game-over pixel-frame" role="alert">
          <h2 class="game-over-title typo-xl">Game over</h2>
          <p class="typo-default">${request.message}</p>
          <button class="button typo-small pixel-frame" type="button" @click=${this.#onRefresh}>
            Continue?
          </button>
        </div>
        ${payload ? this.#renderGroups(payload) : nothing}
      `;
    }

    if (!payload) {
      return html`
        <div class="loading pixel-frame">
          <p class="loading-text typo-md">Loading</p>
          <div class="loading-bar" aria-hidden="true"></div>
        </div>
      `;
    }

    return this.#renderGroups(payload);
  }

  #renderGroups(payload: PullRequestsPayload): TemplateResult {
    if (payload.pullRequests.length === 0) {
      return html`
        <div class="all-clear pixel-frame">
          <h2 class="typo-xl">All clear!</h2>
          <p class="typo-default">You have no open pull requests in ${payload.owner}.</p>
        </div>
      `;
    }

    const groups = groupByRepository(this.#visiblePullRequests());

    if (groups.length === 0) {
      return html`
        <div class="all-clear pixel-frame">
          <h2 class="typo-xl">No matches</h2>
          <p class="typo-default">No pull request matches “${this.query.trim()}”.</p>
        </div>
      `;
    }

    const maxCount = Math.max(...groups.map(({ pullRequests }) => pullRequests.length));
    const now = Date.now();

    return html`${groups.map((group, index) =>
      renderRepositoryGroup(group, { owner: payload.owner, index, maxCount, now }),
    )}`;
  }

  #renderFooter(): TemplateResult | typeof nothing {
    if (!this.payload) {
      return nothing;
    }

    const { pullRequests, totalCount, fetchedAt } = this.payload;
    const truncated = totalCount > pullRequests.length;

    return html`
      <footer class="site-footer typo-xs">
        <p>
          Last fetched <time datetime=${fetchedAt}>${timeFormat.format(new Date(fetchedAt))}</time>
          from GitHub search.
          ${
            truncated
              ? html`Showing the ${pullRequests.length} most recently updated of ${totalCount}.`
              : nothing
          }
        </p>
      </footer>
    `;
  }
}

customElements.define("pr-quest-app", PrQuestApp);

declare global {
  interface HTMLElementTagNameMap {
    "pr-quest-app": PrQuestApp;
  }
}
