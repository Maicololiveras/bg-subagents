---
"@maicolextic/bg-subagents-opencode": major
"@maicolextic/bg-subagents-core": minor
"@maicolextic/bg-subagents-protocol": patch
---

Release v1.0.0: server + TUI production-ready plugin

See docs/migration-v0.1-to-v1.0.md for upgrade instructions.

Major changes:
- New server-side PolicyResolver with per-agent default modes
- New /task slash commands: policy, list, show, logs, kill, move-bg
- New TUI layer: sidebar, Ctrl+B/Ctrl+F/down-arrow keybinds, plan-review dialog
- ./tui subpath export for OpenCode 1.14.23+ TUI plugin loader
- Zero stdout pollution (centralized file-routing logger)
- Cross-platform portability (no hardcoded paths)
- 788 tests green across monorepo (50 protocol + 291 core + 447 opencode)
