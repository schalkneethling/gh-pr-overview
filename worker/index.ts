import { ENV } from "varlock/env";

import { allowWithoutAccess, createAccessVerifier } from "./access.ts";
import { handleApiRequest } from "./router.ts";

// `vp dev` has no Cloudflare Access in front of the Worker. Every build
// (import.meta.env.DEV is false) enforces it, and fails closed when the Access
// settings are missing.
const verifyAccess = import.meta.env.DEV
  ? allowWithoutAccess
  : createAccessVerifier({
      teamDomain: ENV.CF_ACCESS_TEAM_DOMAIN ?? "",
      audience: ENV.CF_ACCESS_AUD ?? "",
    });

// Static assets are served by the platform. Only /api/* reaches this Worker
// (see `assets.run_worker_first` in wrangler.jsonc).
export default {
  async fetch(request) {
    return handleApiRequest(request, {
      github: { token: ENV.GITHUB_TOKEN, org: ENV.GITHUB_ORG },
      verifyAccess,
    });
  },
} satisfies ExportedHandler<Env>;
