# Upstream PR to Gentle-AI — v2 plan

**Target repo**: https://github.com/Gentleman-Programming/gentle-ai
**bg-subagents version target**: v1.0.0 (pending, ~2 weeks out)
**Status**: research complete, PR pending v1.0.0 publish
**Repo language**: Go (v1.24+), TUI built with Bubbletea
**Latest release**: v1.23.0 (2026-04-23)

---

## Repo structure findings

gentle-ai is a Go TUI installer binary (`gentle-ai`/`gga`) that configures AI coding
agents on the user's machine. It is NOT a config file repo — it is a Go program with an
interactive installer that writes config files to agent locations.

### Architecture

- `internal/agents/<agent>/adapter.go` — one Go adapter per agent, implements a shared
  `Installer` interface that knows: where to detect the agent, where config lives, and
  how to write settings/MCP/system-prompt/skills.
- `internal/agents/opencode/adapter.go` — the OpenCode adapter. Key paths it writes:
  - settings: `~/.config/opencode/opencode.json` (via `model.StrategyMergeIntoSettings`)
  - AGENTS.md: `~/.config/opencode/AGENTS.md`
  - skills: `~/.config/opencode/skills/`
  - slash commands: `~/.config/opencode/commands/`
- `internal/catalog/` — Go catalogs of agents, skills, and components the TUI offers
  to install. Skills are declared as Go `Skill` structs with `ID`, `Name`, `Category`,
  and `Priority`. There is NO external JSON/YAML file that lists skills — everything is
  compiled in.
- `internal/installcmd/resolver.go` — resolves install `CommandSequence`s per platform.
  OpenCode is installed via `brew install anomalyco/tap/opencode` (macOS) or
  `npm install -g opencode-ai` (Linux/Windows). No version is pinned.
- `scripts/install.sh` + `scripts/install.ps1` — install the `gentle-ai` binary itself
  (brew tap or pre-built binary download). They do NOT install OpenCode or plugins.
- `testdata/golden/` — golden files for config output regression tests.

### Plugin / skills declaration mechanism

Skills are declared in **`internal/catalog/skills.go`** as Go `Skill` structs compiled
into the binary. Each skill has: `ID model.SkillID`, `Name string`, `Category string`,
`Priority string`. There is no external `plugins.json` or JSON config file for the
catalog — it is pure Go code. Adding a new skill means adding a new `Skill{}` entry to
`mvpSkills` in that file, plus a new `model.SkillID` constant in `internal/model/`.

Skills are then installed by the pipeline: the binary copies skill files from its
embedded assets or downloads them to `~/.config/opencode/skills/<skill-name>/`.

### OpenCode version pinning

No OpenCode version is pinned anywhere in gentle-ai. The installer resolves the latest
available version at runtime (`brew install anomalyco/tap/opencode` or `npm install -g
opencode-ai`). This means the PR does NOT need to declare a minimum OpenCode version in
gentle-ai itself — that constraint lives in bg-subagents' own `package.json`. However,
the PR description and skill doc should call out that bg-subagents requires OpenCode
v1.14.22+ (v14 hook shapes).

### Existing skills in distribution

Current `mvpSkills` in the catalog:

| Skill | Category | Priority |
|-------|----------|----------|
| sdd-init, sdd-apply, sdd-verify, sdd-explore, sdd-propose, sdd-spec, sdd-design, sdd-tasks, sdd-archive, sdd-onboard | sdd | p0 |
| go-testing | testing | p0 |
| skill-creator, judgment-day, branch-pr, issue-creation, skill-registry | workflow | p0 |

All current skills are first-party Gentleman-Programming skills. `bg-subagents` would be
the first **third-party npm-installable skill** in the catalog — a meaningful precedent.

### CONTRIBUTING.md conventions

- Issue-first: open an issue, wait for `status:approved`, THEN open the PR.
- Branch naming: `feat/<name>` (lowercase, hyphens only).
- Conventional commits: `feat(catalog): add bg-subagents skill`.
- PR must include `Closes #<issue-num>` and exactly one `type:*` label.
- All CI checks must pass: unit tests (`go test ./...`) + E2E (`cd e2e && ./docker-test.sh`).
- PR template: no explicit `.github/pull_request_template.md` found — standard body.

---

## Integration point (exact files to modify)

| File | Change |
|------|--------|
| `internal/model/ids.go` (or wherever `SkillID` constants live) | Add `SkillBgSubagents model.SkillID = "bg-subagents"` |
| `internal/catalog/skills.go` | Add one `Skill{}` entry to `mvpSkills` |
| `internal/agents/opencode/adapter.go` | No change needed — skill install is handled generically by the pipeline |
| `skills/bg-subagents/SKILL.md` | New file — the skill doc users will receive |

The `model.SkillID` constant location needs to be confirmed (the `internal/model/`
package was not read in depth — see Open Questions).

---

## Minimal integration patch (conceptual)

### `internal/catalog/skills.go` — add one entry

```go
// bg-subagents: background/foreground subagent execution picker for OpenCode
{ID: model.SkillBgSubagents, Name: "bg-subagents", Category: "workflow", Priority: "p0"},
```

This goes inside the `mvpSkills` slice, after the existing workflow skills.

### `internal/model/` — add SkillID constant

```go
SkillBgSubagents SkillID = "bg-subagents"
```

Location: wherever `SkillBranchPR`, `SkillIssueCreation`, etc. are declared (likely
`internal/model/skill_ids.go` or similar — unconfirmed, see Open Questions).

### `skills/bg-subagents/SKILL.md` — new file

Content: the same skill doc already authored at
`docs/skills/bg-subagents/SKILL.md` in the bg-subagents repo. This is a snapshot;
the upstream repo is the authoritative copy.

---

## Default `bgSubagents` config to ship with gentle-ai's opencode.json template

gentle-ai does NOT ship a static `opencode.json` template. It writes to
`~/.config/opencode/opencode.json` programmatically via `model.StrategyMergeIntoSettings`.
The plugin entry for bg-subagents would be merged into the user's existing settings.

The MCP server entry that the skill doc instructs users to add manually:

```json
{
  "mcp": {
    "servers": {
      "bg-subagents": {
        "type": "stdio",
        "command": "npx",
        "args": ["-y", "@maicolextic/bg-subagents-opencode"]
      }
    }
  }
}
```

If gentle-ai were extended to auto-wire this (Phase 18 stretch goal), the merge would
target `~/.config/opencode/opencode.json` using `os.UserHomeDir()` — portable by
construction because that is how the existing adapter resolves all paths.

**Portability note**: all path resolution in gentle-ai uses `os.UserHomeDir()` in Go
(equivalent to `os.homedir()` in Node). Any config default proposed for this PR must
follow that pattern — no hardcoded `/home/<user>` or `C:\Users\<user>` paths.

---

## Install story for end users

1. User runs `gentle-ai` (the TUI) and selects OpenCode + bg-subagents from the menu.
2. The installer copies `skills/bg-subagents/SKILL.md` to
   `~/.config/opencode/skills/bg-subagents/SKILL.md` on the user's machine.
3. The user still needs to manually add the MCP server entry to `opencode.json` (or
   gentle-ai can auto-merge it if the MCP wiring step is implemented in the pipeline).
4. User runs `opencode` — bg-subagents is available as a skill and MCP server.

The manual step in point 3 is the gap between the current `gentle-ai` architecture
(skill file copy) and full auto-wiring (MCP merge). The PR can ship skill file copy
now and add MCP merge in a follow-up once the precedent is established.

---

## Dependencies + compatibility

- OpenCode version: 1.14.22+ (bg-subagents requires v14 hook shapes for `tool.execute.before`)
- Node/Bun: Node 18+ (matches gentle-ai's existing npm-based install for opencode-ai and claude-code)
- Go: 1.24+ (gentle-ai's own build requirement — no impact on the skill itself)
- Plugin peer deps: none beyond `npx` being available (ships with Node)
- No new Go dependencies introduced into gentle-ai — the change is pure catalog data + one Markdown file

---

## Open questions

1. **Where is `model.SkillID` defined?** The `internal/model/` package was listed but
   not read in depth. Need to confirm the file where `SkillBranchPR`, `SkillSDDInit`,
   etc. are declared before writing the exact patch.

2. **How does gentle-ai embed/copy skill files?** The pipeline copies skills from
   somewhere to `~/.config/opencode/skills/`. Whether this is from embedded Go assets
   (`//go:embed`), a download from a URL, or a git clone needs to be confirmed by
   reading `internal/agentbuilder/` or the pipeline steps. This determines where
   `skills/bg-subagents/SKILL.md` must live in the repo tree.

3. **Is there a precedent for third-party npm-installable skills?** All current skills
   are first-party. The maintainers may want bg-subagents marked differently
   (e.g., `Category: "third-party"` or a separate priority tier). Worth asking in the
   issue before the PR.

4. **MCP auto-merge scope for this PR**: Is the goal just skill file copy (safe,
   minimal), or full auto-wiring (MCP server entry in `opencode.json`)? Full auto-wiring
   requires touching the pipeline's MCP merge step and possibly the component catalog.
   Recommend scoping Phase 18 PR to skill file copy only — MCP merge as a follow-up.

5. **Issue approval timeline**: CONTRIBUTING.md enforces issue-first + `status:approved`
   before any PR. Michael needs to open the feature request issue early (before v1.0.0
   ships) so there is time for maintainer approval. An unapproved issue blocks the PR
   regardless of code quality.

---

## Gaps vs. existing `docs/upstream/gentle-ai-pr.md`

The existing `gentle-ai-pr.md` (v1) drafted a PR that adds **one file** —
`skills/bg-subagents/SKILL.md` — to the `skills/` directory. That approach was based on
the assumption that gentle-ai is a file-based config repo, not a compiled Go TUI.

**What v1 got right:**
- File path for the skill doc (`skills/bg-subagents/SKILL.md`) is correct.
- The PR title format and conventional commits pattern are correct.
- The compatibility matrix (OpenCode stable, Claude Code / MCP coming) is still valid.
- The checklist items are still applicable.

**What v1 is missing / now superseded:**
- v1 does not account for the Go catalog entry in `internal/catalog/skills.go` and the
  `model.SkillID` constant — the skill file alone is NOT sufficient for gentle-ai to
  surface the skill in its TUI. Both Go changes are required.
- v1 predates discovery of the `internal/agents/opencode/adapter.go` MCP merge
  strategy — the full auto-wiring path is now understood.
- v1 uses version labels (`v0.1`, `v0.2`, `v0.3`) that are now superseded by the
  v1.0.0 roadmap. The PR body needs to reflect the current versioning.
- v1 does not mention the issue-first requirement (which is a hard CI gate in gentle-ai).

**Recommendation**: treat v1 as the PR body template (reuse its structure and checklist)
but update it with the two Go file changes and the corrected version references before
submitting.
