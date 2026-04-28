# Project: opencode-bg-subagents

## Purpose

Background subagent orchestration plugin for OpenCode CLI (and in v0.3, Claude Code + MCP clients). Lets users mark subagent delegations as background (non-blocking) vs foreground (blocking), with a batch picker at plan review time and live control during execution.

## Stack

| Layer | Technology |
|---|---|
| Language | TypeScript 5.7.3 |
| Runtime | Node >=22 |
| Monorepo | pnpm 9.15.9 workspaces (`packages/*`, `tooling/*`) |
| Test runner | Vitest 2.1.8 (~432 tests gate) |
| Build | tsc per package (via `pnpm -r run build`) |
| Release | Changesets 2.27.9 + GitHub Actions (`release.yml`) |
| Provenance | npm OIDC Trusted Publishing + sigstore |

## Packages Published

- `@maicolextic/bg-subagents-protocol@1.0.0` — zero-dep contract (types, Zod schemas, `PROTOCOL_VERSION`)
- `@maicolextic/bg-subagents-core@0.1.1` — pure domain core (policy, picker, task registry, history)
- `@maicolextic/bg-subagents-opencode@0.1.4` — OpenCode host adapter (BROKEN vs OpenCode 1.14+, fix pending)

## Architecture Patterns

- **Protocol → Core → Adapter**: Protocol defines contracts; core is pure (zero host deps); adapters wire core into host (OpenCode today, Claude Code v0.3, MCP v0.3).
- **Strategy chain** in core for task swap: OpenCode-specific → native-background → subagent-swap → prompt-injection (fallbacks).
- **Hook-based integration**: Uses host plugin hooks (`tool`, `tool.execute.before`, `chat.params`) — but OpenCode 1.14 broke the API shape we were built against.

## Critical Context for Upcoming Change

1. **OpenCode API mismatch**: Plugin built against OpenCode ~1.10 API. OpenCode 1.14.20+ changed hook signatures: `tool.execute.before` now `(input, output) => Promise<void>` with mutation; `input.tool` (not `tool_name`); `args` in output not input; ToolDefinition expects Zod schemas not JSON Schema. See engram `blocker/opencode-api-mismatch-v0.1.4`.
2. **Release infra is solid**: Validated end-to-end today with Trusted Publishing + provenance. See engram `release/v0.1.1-shipped`.
3. **Target**: PR upstream to `Gentleman-Programming/gentle-ai` once functional end-to-end in real OpenCode.
4. **Multi-version compat required**: Must detect OpenCode version at runtime and branch between legacy + 1.14+ API shapes.

## Conventions

- **Commit format**: Conventional commits (`fix:`, `feat:`, `chore:`, `docs:`, `refactor:`)
- **Branch naming**: `fix/<desc>`, `feat/<desc>`, `chore/<desc>`
- **No AI attribution** on commits (user rule: no Co-Authored-By)
- **Releases**: Changesets patch bumps, PR-driven, CI auto-publishes
- **Testing**: TDD enabled (`pnpm -r run test` — 432 tests must stay green)

## Persistence

- **Artifact store**: hybrid (openspec files committable + engram cross-session)
- **Engram project key**: `opencode-bg-subagents`
- **File root**: `openspec/` in repo root; `.atl/skill-registry.md` for skill catalog
