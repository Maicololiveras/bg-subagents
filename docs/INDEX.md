# Docs Index

Navigation aid for all documentation in this repository. One-line description per file.

---

## Getting started

| Doc | What it covers |
|-----|---------------|
| [../README.md](../README.md) | Project overview, status, quickstart, install, `/task` commands, policy JSONC sample, troubleshooting, roadmap |
| [../packages/opencode/README.md](../packages/opencode/README.md) | Full plugin reference: install, config, `/task` commands, policy, TUI keybinds, architecture, troubleshooting |
| [installation.md](installation.md) | Consolidated install guide: npm path, gentle-ai path, local dev path, verification, troubleshooting |

---

## Migration

| Doc | What it covers |
|-----|---------------|
| [migration-v0.1-to-v1.0.md](migration-v0.1-to-v1.0.md) | Breaking changes from v0.x, step-by-step upgrade, new features, rollback instructions |

---

## Architecture

| Doc | What it covers |
|-----|---------------|
| [architecture.md](architecture.md) | Component diagram, hook wiring table, data flow, SharedPluginState bridge |
| [policy-schema.md](policy-schema.md) | Full policy JSONC field reference with types, defaults, and descriptions |
| [release-process.md](release-process.md) | Changesets workflow, publish procedure, versioning conventions |
| [opencode-notes.md](opencode-notes.md) | Working notes on OpenCode internals and hook surface |
| [opencode-1.14-verification.md](opencode-1.14-verification.md) | Verification log for OpenCode 1.14.x compatibility |

---

## Integrations

| Doc | What it covers |
|-----|---------------|
| [integrations/gentle-ai.md](integrations/gentle-ai.md) | Gentle-AI integration status, mechanism (3 source edits), MCP auto-wiring plan, contact |

---

## Upstream status

| Doc | What it covers |
|-----|---------------|
| [upstream/gentle-ai-feature-request-issue.md](upstream/gentle-ai-feature-request-issue.md) | Issue body filed as #373 at Gentleman-Programming/gentle-ai |
| [upstream/gentle-ai-pr.md](upstream/gentle-ai-pr.md) | PR body draft for gentle-ai — ready to submit once #373 is approved |
| [upstream/gentle-ai-pr-v2.md](upstream/gentle-ai-pr-v2.md) | Deep analysis of gentle-ai repo structure; exact files, open questions, gaps vs v1 |
| [upstream/gentle-ai-issue.md](upstream/gentle-ai-issue.md) | Earlier draft of the gentle-ai issue (superseded by gentle-ai-feature-request-issue.md) |
| [upstream/opencode-docs-pr.md](upstream/opencode-docs-pr.md) | Feature request / PR plan for tui.json docs in anomalyco/opencode |
| [upstream/opencode-docs-pr-draft.mdx](upstream/opencode-docs-pr-draft.mdx) | Ready-to-paste MDX content for the OpenCode docs PR |
| [upstream/opencode-tui-loader-issue.md](upstream/opencode-tui-loader-issue.md) | Issue filed at anomalyco/opencode for TUI plugin loader public surface |
| [upstream/opencode-contribution-plan.md](upstream/opencode-contribution-plan.md) | Plan for upstream OpenCode contributions (loader, docs) |
| [upstream/presentation/README.md](upstream/presentation/README.md) | How to view and customize the interactive HTML presentation |
| [upstream/presentation/bg-vs-fg-interactive.html](upstream/presentation/bg-vs-fg-interactive.html) | Self-contained interactive presentation — open in browser, no build needed |
| [upstream/presentation/bg-vs-fg-interactive.jsx](upstream/presentation/bg-vs-fg-interactive.jsx) | React component source for the interactive presentation |

---

## Skills

| Doc | What it covers |
|-----|---------------|
| [skills/bg-subagents/SKILL.md](skills/bg-subagents/SKILL.md) | Skill doc with YAML front-matter — submitted to gentle-ai; authoritative copy lives here |

---

## Development

| Doc | What it covers |
|-----|---------------|
| [../openspec/](../openspec/) | SDD artifact trail: proposals, specs, design, tasks for all changes |
| [../scripts/](../scripts/) | Utility scripts (publish, ci helpers) |
| [schema/policy-v1.json](schema/policy-v1.json) | JSON Schema for `policy.jsonc` validation |
| [spikes/](spikes/) | Exploration outputs from investigative spikes |
