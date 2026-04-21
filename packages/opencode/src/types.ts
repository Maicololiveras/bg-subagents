/**
 * Local mirror of the subset of the OpenCode plugin runtime surface we touch.
 *
 * OpenCode injects its plugin context at boot — it is NOT an npm peer dep for
 * v0.1 (see NOTES.md). The shapes here are declared minimally: anything we
 * don't consume stays `unknown` so unexpected host fields don't break the
 * typecheck.
 *
 * Every cross-boundary cast `as unknown as X` on these types MUST carry the
 * comment:
 *     // OpenCode host-types boundary — see packages/opencode/NOTES.md
 */

// -----------------------------------------------------------------------------
// Tool definition (what Hooks.tool registers)
// -----------------------------------------------------------------------------

/**
 * Shape OpenCode expects when a plugin registers a new tool via `Hooks.tool`.
 * Only the pieces we actually emit are typed. The rest is modelled as `unknown`
 * so we don't pretend to know more than we do.
 */
export interface HookToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  execute(
    input: Readonly<Record<string, unknown>>,
    ctx: ToolContext,
  ): Promise<unknown>;
}

/**
 * Per-tool context passed to `execute`. Only the fields we consume are
 * declared; the host may (and does) pass more.
 */
export interface ToolContext {
  readonly session: SessionApi;
  readonly bus?: Bus | undefined;
  readonly log?: HostLogger | undefined;
  readonly signal?: AbortSignal | undefined;
}

// -----------------------------------------------------------------------------
// Hooks.tool.execute.before shapes
// -----------------------------------------------------------------------------

/**
 * Input handed to `Hooks.tool.execute.before`. Typed against our own internal
 * use — real OpenCode payloads may carry additional opaque fields which we
 * pass through unchanged.
 */
export interface HooksToolBeforeInput {
  readonly tool_name: string;
  readonly tool_input: Readonly<Record<string, unknown>>;
  readonly session_id: string;
}

/**
 * Result `Hooks.tool.execute.before` may return. `continue: true` means "let
 * the host invoke the original tool"; `continue: false` with a `replacement`
 * swaps the call to another tool. `deny_reason` is our structured cancel
 * code.
 */
export type HooksToolBeforeResult =
  | { readonly continue: true; readonly updatedInput?: Readonly<Record<string, unknown>> }
  | {
      readonly continue: false;
      readonly replacement?: {
        readonly tool_name: string;
        readonly input: Readonly<Record<string, unknown>>;
      };
      readonly deny_reason?: string;
    };

// -----------------------------------------------------------------------------
// Hooks.chat.params
// -----------------------------------------------------------------------------

/** Minimal chat.params input — only `system` is mutated by our steer. */
export interface HooksChatParamsInput {
  readonly system?: string | undefined;
  readonly session_id: string;
}

export interface HooksChatParamsResult {
  readonly system?: string;
}

// -----------------------------------------------------------------------------
// Bus
// -----------------------------------------------------------------------------

/**
 * OpenCode event bus. The real runtime provides a richer surface; we only
 * exercise `emit`. Absence is valid and signals the UI is headless.
 */
export interface Bus {
  emit(event: BusEvent): void | Promise<void>;
}

/** Events we emit on the Bus. Kebab-case namespace per OpenCode convention. */
export interface BusEvent {
  readonly type: string;
  readonly [key: string]: unknown;
}

// -----------------------------------------------------------------------------
// Session API (for runtime.ts / chat-message fallback)
// -----------------------------------------------------------------------------

export interface SessionApi {
  /** Create a child session for a background subagent run. */
  create?(opts: SessionCreateOpts): Promise<SessionHandle>;
  /** Send a prompt to the current or a specified session. */
  prompt?(opts: SessionPromptOpts): Promise<unknown>;
  /**
   * Inject a synthetic assistant message into the user-facing chat transcript.
   * Used by `chatMessageFallback` when no bus subscriber acks within the
   * timeout window.
   */
  writeAssistantMessage?(opts: AssistantMessageOpts): Promise<void> | void;
}

export interface SessionCreateOpts {
  readonly agent?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface SessionPromptOpts {
  readonly session_id?: string;
  readonly prompt: string;
  readonly signal?: AbortSignal;
}

export interface SessionHandle {
  readonly session_id: string;
}

export interface AssistantMessageOpts {
  readonly session_id: string;
  readonly content: string;
}

// -----------------------------------------------------------------------------
// Host logger (optional — falls through to core createLogger)
// -----------------------------------------------------------------------------

export interface HostLogger {
  info(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  warn(msg: string, fields?: Readonly<Record<string, unknown>>): void;
  error(msg: string, fields?: Readonly<Record<string, unknown>>): void;
}

// -----------------------------------------------------------------------------
// Plugin module + Hooks shape (what the OpenCode host consumes)
// -----------------------------------------------------------------------------

/**
 * Object returned from `plugin.server({ ... })`. Every hook is optional — the
 * host calls whichever ones we provide. Minimal shape: only the five we wire.
 */
export interface Hooks {
  readonly tool?: ReadonlyArray<HookToolDefinition>;
  readonly ["tool.execute.before"]?: (
    input: HooksToolBeforeInput,
  ) => Promise<HooksToolBeforeResult> | HooksToolBeforeResult;
  readonly ["chat.params"]?: (
    input: HooksChatParamsInput,
  ) => Promise<HooksChatParamsResult> | HooksChatParamsResult;
  readonly event?: (event: BusEvent) => void | Promise<void>;
  readonly ["chat.message"]?: (event: BusEvent) => void | Promise<void>;
}

/** Plugin server context injected by OpenCode at boot. */
export interface PluginServerContext {
  readonly session_id?: string;
  readonly bus?: Bus | undefined;
  readonly session?: SessionApi | undefined;
  readonly log?: HostLogger | undefined;
}

/**
 * Default-export contract: the module exports a `PluginModule` whose
 * `server()` function returns the wired `Hooks`. OpenCode boots by calling
 * `(await import("@maicolextic/bg-subagents-opencode")).default.server(ctx)`.
 */
export interface PluginModule {
  server(ctx: PluginServerContext): Promise<Hooks>;
}
