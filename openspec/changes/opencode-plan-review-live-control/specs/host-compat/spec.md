# host-compat Specification

## Purpose

Detects the OpenCode plugin API version at runtime and routes plugin initialization to the correct compatibility codepath (legacy or OpenCode 1.14+). Enables a single npm package to serve both user populations without breakage.

## Requirements

### Requirement: Runtime Version Detection

The plugin MUST inspect the shape of the context passed to `plugin.server(ctx)` and classify it as one of:
- `"v14"` — OpenCode 1.14+ API
- `"legacy"` — pre-1.14 API (approximately 1.10–1.13)
- `"unknown"` — neither shape matches

The classification MUST be deterministic based on presence of specific fields and MUST complete in under 50ms.

#### Scenario: Detect OpenCode 1.14+ API

- GIVEN the plugin receives a ctx object with `client: OpencodeClient` and NO `bus`, `session`, or `session_id` fields
- WHEN `detectHostVersion(ctx)` is called
- THEN it returns `"v14"`

#### Scenario: Detect legacy API

- GIVEN the plugin receives a ctx object with `session_id: string`, `bus: {emit}`, and `session: SessionApi` fields
- WHEN `detectHostVersion(ctx)` is called
- THEN it returns `"legacy"`

#### Scenario: Detect unknown host

- GIVEN the plugin receives a ctx object with neither `client` nor `session`/`bus`
- WHEN `detectHostVersion(ctx)` is called
- THEN it returns `"unknown"`

### Requirement: Routing to Correct Codepath

The plugin's `server(ctx)` entry point MUST route to the version-specific hook builder:
- `"v14"` → builds hooks via `buildV14Hooks(ctx)`
- `"legacy"` → builds hooks via `buildLegacyHooks(ctx)`
- `"unknown"` → emits a warning, attempts legacy path, and registers MINIMAL hooks (tool only, no interception)

#### Scenario: Route to v14 builder

- GIVEN `detectHostVersion(ctx)` returns `"v14"`
- WHEN `server(ctx)` executes
- THEN `buildV14Hooks(ctx)` is invoked exactly once
- AND the returned `Hooks` object conforms to the OpenCode 1.14+ `Hooks` interface (object `tool`, mutation-based hooks)

#### Scenario: Route to legacy builder

- GIVEN `detectHostVersion(ctx)` returns `"legacy"`
- WHEN `server(ctx)` executes
- THEN `buildLegacyHooks(ctx)` is invoked exactly once
- AND the returned `Hooks` object conforms to the legacy API (array `tool`, object-return hooks)

#### Scenario: Unknown host graceful degradation

- GIVEN `detectHostVersion(ctx)` returns `"unknown"`
- WHEN `server(ctx)` executes
- THEN a warn log is emitted with message `host-compat:unknown-api` and the detected ctx keys
- AND the plugin attempts `buildLegacyHooks(ctx)` as fallback
- AND if that throws, the plugin returns an empty `Hooks` object (no crash)

### Requirement: Force-Override via Environment Variable

The system SHOULD honor the environment variable `BG_SUBAGENTS_FORCE_COMPAT` with allowed values `legacy` or `v14` to override auto-detection.

#### Scenario: Force legacy via env

- GIVEN `process.env.BG_SUBAGENTS_FORCE_COMPAT === "legacy"`
- AND ctx shape would normally detect as `"v14"`
- WHEN `detectHostVersion(ctx)` is called
- THEN it returns `"legacy"`
- AND an info log is emitted with `host-compat:forced` and value `legacy`

#### Scenario: Invalid force value ignored

- GIVEN `process.env.BG_SUBAGENTS_FORCE_COMPAT === "invalid"`
- WHEN `detectHostVersion(ctx)` is called
- THEN the env var is ignored and normal auto-detection runs
- AND a warn log is emitted with `host-compat:bad-force-value`

### Requirement: No Crash on Missing Capabilities

If the detected codepath requires a capability that is missing at runtime (e.g., `client.tool.cancel` not present in OpenCode 1.14+), the plugin MUST degrade gracefully: the missing feature becomes a no-op, other features continue to work, and a warn log is emitted explaining the degradation.

#### Scenario: Missing client method

- GIVEN the v14 codepath is active
- AND `ctx.client.tool.cancel` is undefined
- WHEN a user triggers the Live Control `move-bg` flow
- THEN the flow aborts with a user-visible toast: "Move-to-background unavailable in this OpenCode version"
- AND the plugin does not crash
- AND a warn log is emitted with `live-control:cancel-unavailable`

### Requirement: Detection Result Cached Per Session

The detection result MUST be computed once per `server(ctx)` call and cached for the lifetime of that session. Re-detection during the same session is prohibited to ensure consistent behavior.

#### Scenario: Single detection per session

- GIVEN `server(ctx)` is called
- WHEN any hook within that session queries the host version
- THEN the cached value from the initial detection is returned
- AND `detectHostVersion(ctx)` is NOT re-invoked
