# Upstream docs PR — document tui.json in OpenCode

**Target repo**: https://github.com/anomalyco/opencode
**Target file**: `packages/web/src/content/docs/plugins.mdx`
**Target branch**: `dev`
**Status**: draft plan — pending v1.0 ship + spike evidence write-up

## Problem

The TUI plugin loader added in PR #19347 (2026-03-27) is fully functional but has ZERO mention in the public plugin documentation. External plugin authors attempting to add a TUI plugin to their `opencode.json` plugin array get rejected by the server loader with the confusing error `"must default export an object with server()"`, because `tui.json` is the correct config file (not opencode.json).

Evidence: one-day spike by @maicolextic hit this exact issue. Lost ~4 hours diagnosing what turned out to be a config-file choice.

## Proposed doc addition

Section "TUI plugins" (under "Plugins" in plugins.mdx), covering:

1. The two-file architecture: `opencode.json plugin[]` for server plugins, `tui.json plugin[]` for TUI plugins.
2. Default export shape for TUI plugins: `{ id: string, tui: TuiPlugin }` — note `id` is REQUIRED at runtime despite the SDK type marking it optional (fix the type, or document the requirement).
3. Minimal working example (copy from `tui-smoke.tsx` if license permits, or write a 20-line minimal plugin).
4. Pointer to `TuiPluginApi` surface (slots, commands, keybinds, dialogs, toasts).
5. Installation options:
   - Project-local `tui.json` in workspace
   - Global `~/.config/opencode/tui.json` for user-wide TUI plugins
   - Inline `plugin[]` in global tui.json for npm packages with `./tui` subpath export
6. Troubleshooting: if you get `must default export an object with server()`, you probably put the plugin in `opencode.json` instead of `tui.json`.

## Secondary fix (optional)

Either update `TuiPluginModule.id?: string` to `TuiPluginModule.id: string` (required), OR make the runtime loader tolerant of missing id (generate a uuid fallback). Match types to runtime or vice versa.

## Timeline

- Week 1: verify with a second independent test (maybe file a reproduction PR against OpenCode, or just submit the issue with spike evidence from @maicolextic).
- Week 2: draft docs PR content + open PR against `dev` branch.
- Post-merge: reference the new docs section in bg-subagents README so users don't have to rediscover.

## Why this matters to OpenCode

TUI plugins are the foundation for community plugin UX richness (sidebars, custom commands, theme extensions). Undocumented = underused. Documenting it unlocks a wave of community contributions.

## Author

@maicolextic — author of `@maicolextic/bg-subagents-opencode` (first external TUI plugin consumer we know of). Happy to help with review or follow-up.
