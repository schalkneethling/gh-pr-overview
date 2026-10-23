import { html, type TemplateResult } from "lit";

import { PULL_REQUEST_SORTS, type PullRequestSort } from "../shared/pull-requests.ts";

interface SortPickerOptions {
  selected: PullRequestSort;
  /** True while there is nothing to order. */
  disabled: boolean;
  onChange: (event: Event) => void;
}

export const SORT_LABELS: Readonly<Record<PullRequestSort, string>> = {
  repository: "Grouped by repository",
  oldest: "Oldest updated first",
  newest: "Newest updated first",
};

/**
 * Picks how pull requests are ordered. Shares the owner picker's customizable
 * select styling; its options are plain text, so there is nothing to work
 * around in the markup.
 */
export function renderSortPicker({
  selected,
  disabled,
  onChange,
}: SortPickerOptions): TemplateResult {
  return html`
    <div class="picker">
      <label class="typo-small" for="sort">Sort by</label>
      <select
        class="picker-select typo-default pixel-frame"
        id="sort"
        ?disabled=${disabled}
        @change=${onChange}
      >
        <button><selectedcontent></selectedcontent></button>
        ${PULL_REQUEST_SORTS.map(
          (sort) =>
            html`<option value=${sort} .selected=${sort === selected}>
              ${SORT_LABELS[sort]}
            </option>`,
        )}
      </select>
    </div>
  `;
}
