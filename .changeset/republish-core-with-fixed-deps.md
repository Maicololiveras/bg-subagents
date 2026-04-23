---
"@maicolextic/bg-subagents-core": patch
---

Republish core with `workspace:*` deps transformed to concrete versions. v0.1.0 on npm was published manually before the release workflow fix (PR #14) and still ships `workspace:*` literal in its package.json, breaking every consumer's `npm install`. This patch (v0.1.1) fixes that.
