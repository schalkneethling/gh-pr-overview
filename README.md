# PR Quest

Your open GitHub pull requests in one organization or your personal account, grouped by repository, with a 16-bit look.

It is a web version of this command:

```sh
gh search prs --author @me --state open --owner TFG-Labs --limit 100 \
  --json repository,url,title \
  --jq 'group_by(.repository.name)[] | "\n\(.[0].repository.name) (\(length))", (.[] | "  \(.url)  \(.title)")'
```

**Show pull requests in** switches between your personal account and your organizations. The page remembers your choice. **Copy as text** copies the same plain-text output, limited to what the filter shows.

## How it works

- **Front end** (`src/`): a Lit app rendered into light DOM, so the global typography and token styles apply.
- **API** (`worker/`): a Cloudflare Worker with two routes. Both use `@octokit/core`.
  - `GET /api/pull-requests?owner=<login>` calls the GitHub Search API with `is:pr is:open author:@me user:<login>`, sorted by most recently updated, 100 results maximum. `user:` is the qualifier `gh search prs --owner` uses; it matches users and organizations. Without `owner`, it searches `GITHUB_ORG`.
  - `GET /api/owners` lists your personal account and your organizations (`GET /user/orgs`). `GITHUB_ORG` is always in the list.
- **Static assets**: Workers static assets serve the built app. Only `/api/*` runs the Worker (`run_worker_first` in `wrangler.jsonc`).
- **Secrets**: [Varlock](https://varlock.dev) resolves `GITHUB_TOKEN` from 1Password. The token stays in the Worker and never goes to the browser.

## Setup

1. Install dependencies:

   ```sh
   vp install
   ```

2. Create a GitHub token and save it in 1Password.
   - A classic token needs the `repo` and `read:org` scopes. This is the recommended token: it can search every account in the picker.
   - A fine-grained token needs read-only **Pull requests** and **Metadata** access. It covers only one account, and GitHub gives it an empty organization list, so the picker shows only your personal account and `GITHUB_ORG`. The organization may need to approve fine-grained tokens.
   - If the organization enforces SAML SSO, authorize the token for it. If you do not, GitHub search silently leaves out that organization's private repositories.

3. In `.env.schema`, set `GITHUB_TOKEN` to your item's secret reference. In 1Password, open the field menu and choose **Copy Secret Reference**.

4. For local development, install the [1Password CLI](https://www.1password.dev/cli/get-started/) and turn on its desktop app integration. Varlock then uses the desktop app; you do not need a service account.

## Develop

```sh
vp dev       # app + Worker in workerd, secrets from 1Password
vp test      # unit and component tests (no network, no 1Password)
vp check     # format, lint, type check
```

After you change `.env.schema` or `wrangler.jsonc`, regenerate the types with `vp run types`.

## Deploy to Cloudflare

```sh
vp run deploy
```

This builds the app, then runs `varlock-wrangler deploy`. That command uploads `GITHUB_TOKEN` as a Cloudflare secret and the other settings as vars. The app is served at `https://gh-pr-overview.<your-subdomain>.workers.dev`.

> [!WARNING]
> `varlock-wrangler deploy` replaces **all** vars and secrets on the Worker with the ones in `.env.schema`. Do not set secrets with `wrangler secret put`; the next deploy removes them.

## Cloudflare Access

The Worker shows your pull requests, private repositories included, so two layers protect it:

1. **Cloudflare Access at the edge** asks visitors to sign in before they reach the page or the API.
2. **The Worker verifies the Access token** (`Cf-Access-Jwt-Assertion`) on every `/api/*` request. It refuses everything when `CF_ACCESS_TEAM_DOMAIN` or `CF_ACCESS_AUD` is missing, so a deployment never serves data without Access. `vp dev` skips this check because no Access runs locally.

To set it up:

1. In the Cloudflare dashboard, go to **Workers & Pages** > **gh-pr-overview** > **Access**, and select **Protect this Worker behind Access** with **All traffic**. Zero Trust must be enabled on the account.
2. Limit the Access policy to the people who may sign in, for example an **Emails** include rule with your address.
3. Copy the team domain (**Zero Trust** > **Settings**) and the application's **Application Audience (AUD) Tag** into `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` in `.env.schema`.
4. Run `vp run deploy` again. Varlock writes these values into the build, so a change needs a new deploy.

For CI, create a 1Password service account that can read the vault, and set its token as `OP_TOKEN` in the CI environment.
