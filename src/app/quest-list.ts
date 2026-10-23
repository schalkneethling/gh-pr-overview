import { html, type TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import type { PullRequestSummary, ReviewStatus } from "../shared/pull-requests.ts";
import { formatRelativeTime, pluralize } from "./format.ts";

// Entry animations stop staggering after this many rows so long lists settle quickly.
const MAX_STAGGER_STEPS = 12;

const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = {
  approved: "Approved",
  "changes-requested": "Changes requested",
  "awaiting-review": "Awaiting review",
};

// Drafts are not ready for review yet, so their review status would mislead.
function renderReviewStatus({ draft, reviewStatus }: PullRequestSummary): TemplateResult | null {
  if (draft || reviewStatus === null) {
    return null;
  }

  // The hidden prefix tells screen reader users what "Approved" refers to.
  return html`<span class="review-status" data-status=${reviewStatus}
    ><span class="visually-hidden">Review status: </span>${REVIEW_STATUS_LABELS[reviewStatus]}</span
  >`;
}

interface QuestOptions {
  /** Row position in its list, which staggers the entry animation. */
  position: number;
  now: number;
  /** Names the repository in the meta line, for lists that are not grouped by it. */
  showRepository?: boolean;
}

export function renderQuest(
  pullRequest: PullRequestSummary,
  { position, now, showRepository = false }: QuestOptions,
): TemplateResult {
  return html`
    <li
      class="quest"
      style=${styleMap({ "--stagger": String(Math.min(position, MAX_STAGGER_STEPS)) })}
    >
      <a class="quest-link typo-default" href=${pullRequest.url}>${pullRequest.title}</a>
      <p class="quest-meta typo-small">
        ${
          showRepository
            ? html`<span class="quest-repository"
                ><span class="visually-hidden">Repository: </span>${pullRequest.repository}</span
              >`
            : null
        }
        <span class="quest-number">#${pullRequest.number}</span>
        ${pullRequest.draft ? html`<span class="badge">Draft</span>` : null}
        <span
          >Updated
          <time datetime=${pullRequest.updatedAt}
            >${formatRelativeTime(pullRequest.updatedAt, now)}</time
          ></span
        >
        ${renderReviewStatus(pullRequest)}
      </p>
    </li>
  `;
}

/**
 * Every pull request in one panel, in the order given. Used when the player
 * sorts by date, where repositories no longer split the list. It borrows the
 * `world` panel styles; the panel just is not tied to one repository.
 */
export function renderPullRequestList(
  pullRequests: readonly PullRequestSummary[],
  { now }: { now: number },
): TemplateResult {
  return html`
    <section class="world pixel-frame" aria-labelledby="all-quests">
      <h2 class="world-title typo-md" id="all-quests">
        ${pluralize(pullRequests.length, "open PR")}
      </h2>
      <div class="world-body">
        <ul class="quest-list">
          ${pullRequests.map((pullRequest, position) =>
            renderQuest(pullRequest, { position, now, showRepository: true }),
          )}
        </ul>
      </div>
    </section>
  `;
}
