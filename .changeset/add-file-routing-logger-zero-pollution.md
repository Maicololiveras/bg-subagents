---
"@maicolextic/bg-subagents-core": patch
---

Add centralized logger with file routing and zero-stdout guarantee (internal)

Phase 7.5 zero-pollution constraint: `createLogger(namespace)` now routes all
diagnostic output to `~/.opencode/logs/bg-subagents.log` (POSIX) or
`%APPDATA%\opencode\logs\bg-subagents.log` (Windows). stdout is reserved for
user-visible markdown cards only. `BG_SUBAGENTS_LOG_FILE` env var overrides
the default path. `BG_SUBAGENTS_DEBUG=true` additionally mirrors to stderr.
`debug()` is a strict no-op when `BG_SUBAGENTS_DEBUG` is unset.
