import { html, type TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import type { PullRequestSummary, RepositoryGroup, ReviewStatus } from "../shared/pull-requests.ts";
import { formatRelativeTime, pluralize } from "./format.ts";

interface RepositoryGroupOptions {
  owner: string;
  index: number;
  /** The largest group size, used to scale the decorative progress bar. */
  maxCount: number;
  now: number;
}

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

function repositoryPullsUrl(owner: string, repository: string): string {
  const query = encodeURIComponent("is:pr is:open author:@me");

  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?q=${query}`;
}

export function renderRepositoryGroup(
  { repository, pullRequests }: RepositoryGroup,
  { owner, index, maxCount, now }: RepositoryGroupOptions,
): TemplateResult {
  const headingId = `world-${index}`;
  const fill = `${Math.round((pullRequests.length / maxCount) * 100)}%`;

  // The whole header toggles the quest list, so the GitHub link lives in the
  // body: a link nested inside <summary> is a control within a control.
  return html`
    <section class="world pixel-frame" aria-labelledby=${headingId}>
      <details class="world-details" open>
        <summary class="world-header">
          <p class="world-label typo-xs">World ${index + 1}</p>
          <h2 class="world-title typo-md" id=${headingId}>${repository}</h2>
          <p class="world-count typo-small">${pluralize(pullRequests.length, "open PR")}</p>
          <div class="world-meter" style=${styleMap({ "--fill": fill })} aria-hidden="true"></div>
        </summary>
        <div class="world-body">
          <ul class="quest-list">
            ${pullRequests.map(
              (pullRequest, position) => html`
                <li
                  class="quest"
                  style=${styleMap({ "--stagger": String(Math.min(position, MAX_STAGGER_STEPS)) })}
                >
                  <a class="quest-link typo-default" href=${pullRequest.url}
                    >${pullRequest.title}</a
                  >
                  <p class="quest-meta typo-small">
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
              `,
            )}
          </ul>
          <p class="world-more typo-small">
            <a href=${repositoryPullsUrl(owner, repository)}>View ${repository} PRs on GitHub</a>
          </p>
        </div>
      </details>
    </section>
  `;
}
