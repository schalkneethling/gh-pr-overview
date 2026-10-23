import { html, type TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import type { RepositoryGroup } from "../shared/pull-requests.ts";
import { pluralize } from "./format.ts";
import { renderQuest } from "./quest-list.ts";

interface RepositoryGroupOptions {
  owner: string;
  index: number;
  /** The largest group size, used to scale the decorative progress bar. */
  maxCount: number;
  now: number;
  /** Whether the world is expanded; the caller owns this so it outlives the element. */
  open: boolean;
  /** Called when the player expands or collapses the world. */
  onToggle: (open: boolean) => void;
}

function repositoryPullsUrl(owner: string, repository: string): string {
  const query = encodeURIComponent("is:pr is:open author:@me");

  return `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repository)}/pulls?q=${query}`;
}

export function renderRepositoryGroup(
  { repository, pullRequests }: RepositoryGroup,
  { owner, index, maxCount, now, open, onToggle }: RepositoryGroupOptions,
): TemplateResult {
  const headingId = `world-${index}`;
  const fill = `${Math.round((pullRequests.length / maxCount) * 100)}%`;

  const onDetailsToggle = (event: Event): void => {
    if (event.currentTarget instanceof HTMLDetailsElement) {
      onToggle(event.currentTarget.open);
    }
  };

  // The whole header toggles the quest list, so the GitHub link lives in the
  // body: a link nested inside <summary> is a control within a control.
  return html`
    <section class="world pixel-frame" aria-labelledby=${headingId}>
      <details class="world-details" ?open=${open} @toggle=${onDetailsToggle}>
        <summary class="world-header">
          <p class="world-label typo-xs">World ${index + 1}</p>
          <h2 class="world-title typo-md" id=${headingId}>${repository}</h2>
          <p class="world-count typo-small">${pluralize(pullRequests.length, "open PR")}</p>
          <div class="world-meter" style=${styleMap({ "--fill": fill })} aria-hidden="true"></div>
        </summary>
        <div class="world-body">
          <ul class="quest-list">
            ${pullRequests.map((pullRequest, position) =>
              renderQuest(pullRequest, { position, now }),
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
