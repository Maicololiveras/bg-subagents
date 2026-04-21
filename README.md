# bg-subagents

[![CI](https://github.com/Maicololiveras/bg-subagents/actions/workflows/ci.yml/badge.svg)](https://github.com/Maicololiveras/bg-subagents/actions/workflows/ci.yml)
[![Compat](https://github.com/Maicololiveras/bg-subagents/actions/workflows/compat.yml/badge.svg)](https://github.com/Maicololiveras/bg-subagents/actions/workflows/compat.yml)
[![npm](https://img.shields.io/npm/v/@maicolextic/bg-subagents-opencode)](https://www.npmjs.com/package/@maicolextic/bg-subagents-opencode)

Monorepo for background subagent plugins across multiple AI coding hosts.

## Status

**v0.0.0 — scaffolding only. NOT yet usable.**

This repository is in the initial scaffolding phase. No packages, no runtime, no install path. The structure is being laid down so subsequent batches can add the protocol, core, and host adapter packages.

## Planned packages

- `@maicolextic/bg-subagents-protocol` — zero-dep types and zod schemas (v0.1.0)
- `@maicolextic/bg-subagents-core` — pure domain: picker, policy, task registry, history store (v0.1.0)
- `@maicolextic/bg-subagents-opencode` — OpenCode plugin adapter (v0.1.0)
- `@bg-subagents/claude-code` — Claude Code plugin adapter (v0.2.0)
- `@bg-subagents/mcp` — MCP server adapter (v0.3.0)

## Reference

Full design, specs, tasks, and roadmap live in the project's SDD artifact store (Engram topic keys):

- `sdd/opencode-background-subagent-plugin/proposal` — locked decisions
- `sdd/opencode-background-subagent-plugin/spec` — functional and non-functional requirements
- `sdd/opencode-background-subagent-plugin/design` — architecture and layout
- `sdd/opencode-background-subagent-plugin/tasks` — batch-by-batch task breakdown

Project: `opencode-bg-subagents`.

## Contributing

Work in progress. External contributions are not accepted until v0.1.0 is tagged and published.

## License

MIT. See `LICENSE`.
