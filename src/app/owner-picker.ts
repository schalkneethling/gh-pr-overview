import { html, nothing, type TemplateResult } from "lit";

import type { Owner } from "../shared/pull-requests.ts";
import { avatarAtSize } from "./format.ts";

export type OwnersState =
  | { status: "loading" }
  | { status: "ready"; owners: Owner[]; defaultOwner: string }
  | { status: "error"; message: string };

interface OwnerPickerOptions {
  state: OwnersState;
  /** Login of the owner whose pull requests are shown. */
  selected: string;
  onChange: (event: Event) => void;
}

/**
 * A separate template per option keeps the avatar: browsers without
 * customizable select drop an `<img>` written inside `<select>` markup, while
 * one inserted through the DOM stays (unrendered) and the option's text is
 * still the login.
 */
function renderOption(owner: Owner, selected: boolean): TemplateResult {
  return html`
    <option value=${owner.login} .selected=${selected}>
      <img
        class="owner-avatar"
        src=${avatarAtSize(owner.avatarUrl, 40)}
        alt=""
        width="20"
        height="20"
      />
      <span>${owner.login}${owner.personal ? " (you)" : nothing}</span>
    </option>
  `;
}

/**
 * Picks whose repositories to search: the viewer's account or one of their
 * organizations. Uses customizable select (`appearance: base-select`) where
 * supported; other browsers show a native select with the same options.
 */
export function renderOwnerPicker({
  state,
  selected,
  onChange,
}: OwnerPickerOptions): TemplateResult {
  if (state.status === "error") {
    return html`
      <p class="owner-picker typo-small">Could not load your accounts. ${state.message}</p>
    `;
  }

  const isLoading = state.status === "loading";

  return html`
    <div class="owner-picker">
      <label class="typo-small" for="owner">Show pull requests in</label>
      <select
        class="owner-select typo-default pixel-frame"
        id="owner"
        ?disabled=${isLoading}
        @change=${onChange}
      >
        <button><selectedcontent></selectedcontent></button>
        ${
          isLoading
            ? html`<option>Loading…</option>`
            : state.owners.map((owner) => renderOption(owner, owner.login === selected))
        }
      </select>
    </div>
  `;
}
