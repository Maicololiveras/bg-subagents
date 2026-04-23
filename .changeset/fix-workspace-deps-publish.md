---
"@maicolextic/bg-subagents-opencode": patch
---

Fix publish: `workspace:*` deps were being uploaded to npm literally (via `npm publish` under `changeset publish`), causing `npm install` to fail with `EUNSUPPORTEDPROTOCOL`. Switch release workflow to `pnpm publish` (pnpm >= 10.8), which transforms `workspace:*` to concrete versions AND supports OIDC Trusted Publishing.

v0.1.1 on npm is broken (do not install) — this patch republishes as 0.1.2 with fixed dep resolution.
