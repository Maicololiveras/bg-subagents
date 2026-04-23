---
"@maicolextic/bg-subagents-opencode": patch
---

Fix workspace:* deps in published packages. `npm publish` (used by `changeset publish` for OIDC Trusted Publishing support) does not transform `workspace:*` protocol, and `pnpm publish` does not support OIDC auth. Solution: transform workspace deps to concrete versions via script before publishing. v0.1.1 and v0.1.2 on npm are broken — this republishes as 0.1.3 with fully resolved deps.
