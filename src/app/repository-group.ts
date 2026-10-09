import { html, type TemplateResult } from "lit";
import { styleMap } from "lit/directives/style-map.js";

import type { RepositoryGroup } from "../shared/pull-requests.ts";
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

  return html`
    <section class="world pixel-frame" aria-labelledby=${headingId}>
      <header class="world-header">
        <p class="world-label typo-xs">World ${index + 1}</p>
        <h2 class="world-title typo-md" id=${headingId}>
          <a href=${repositoryPullsUrl(owner, repository)}>${repository}</a>
        </h2>
        <p class="world-count typo-small">${pluralize(pullRequests.length, "open PR")}</p>
        <div class="world-meter" style=${styleMap({ "--fill": fill })} aria-hidden="true"></div>
      </header>
      <ul class="quest-list">
        ${pullRequests.map(
          (pullRequest, position) => html`
            <li
              class="quest"
              style=${styleMap({ "--stagger": String(Math.min(position, MAX_STAGGER_STEPS)) })}
            >
              <a class="quest-link typo-default" href=${pullRequest.url}>${pullRequest.title}</a>
              <p class="quest-meta typo-small">
                <span class="quest-number">#${pullRequest.number}</span>
                ${pullRequest.draft ? html`<span class="badge">Draft</span>` : null}
                <span
                  >Updated
                  <time datetime=${pullRequest.updatedAt}
                    >${formatRelativeTime(pullRequest.updatedAt, now)}</time
                  ></span
                >
              </p>
            </li>
          `,
        )}
      </ul>
    </section>
  `;
}
