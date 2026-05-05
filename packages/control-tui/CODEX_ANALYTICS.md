# Codex Web Analytics Status

Use the ChatGPT Codex analytics provider only when you want the TUI status monitor to read the web usage page instead of `codex /status`.

## Quick Path

1. Install `playwright-core` in the consumer environment if it is not already available.
2. Make sure Chrome is installed, or set `BG_SUBAGENTS_CODEX_ANALYTICS_BROWSER_CHANNEL=msedge`.
3. Enable the provider with `BG_SUBAGENTS_CODEX_STATUS_SOURCE=web`.
4. Log in once with the dedicated profile at `~/.config/bg-subagents/codex-analytics-browser-profile`.

## Behavior

| Topic | Decision |
| --- | --- |
| Default source | The CLI provider remains the default. Web analytics is opt-in. |
| Poll interval | Web analytics defaults to 15 minutes. Override with `BG_SUBAGENTS_CODEX_ANALYTICS_INTERVAL_MS`. |
| Sensitive data | Snapshots store parsed usage and sanitized visible text only; HTML and email lines are not persisted. |
| Browser dependency | The provider dynamically imports `playwright-core` so normal CLI status does not require Playwright. |

Set `BG_SUBAGENTS_CODEX_ANALYTICS_HEADLESS=true` after the profile is already logged in if you do not want a visible browser window.
