/**
 * fakePluginContext — factory for a fully-typed fake OpenCode plugin context.
 *
 * Records all calls to:
 *   - Hooks.tool.execute.before  (via execBeforeLog)
 *   - Hooks.chat.params          (via chatParamsLog)
 *   - Bus.emit                   (via busEmits)
 *   - SessionApi.create          (via sessionCreates)
 *   - SessionApi.prompt          (via sessionPrompts)
 *   - SessionApi.writeAssistantMessage (via assistantMessages)
 *
 * Configurable return values for each Session method allow tests to control
 * the runtime path without real network calls.
 */
import type {
  Bus,
  BusEvent,
  PluginServerContext,
  SessionApi,
  SessionCreateOpts,
  SessionHandle,
  SessionPromptOpts,
  AssistantMessageOpts,
} from "../../types.js";

// ---------------------------------------------------------------------------
// Recorded call shapes
// ---------------------------------------------------------------------------

export interface BusEmitRecord {
  readonly event: BusEvent;
}

export interface SessionCreateRecord {
  readonly opts: SessionCreateOpts;
}

export interface SessionPromptRecord {
  readonly opts: SessionPromptOpts;
}

export interface SessionWriteRecord {
  readonly opts: AssistantMessageOpts;
}

// ---------------------------------------------------------------------------
// Configuration for fake returns
// ---------------------------------------------------------------------------

export interface FakePluginContextConfig {
  /** session_id injected into the context. Defaults to "sess_integration_1". */
  readonly session_id?: string;
  /**
   * Return value for `session.create`. Defaults to `{ session_id: "child_sess_1" }`.
   * Pass `null` to make `session.create` undefined (headless — no child session).
   */
  readonly sessionCreateResult?: SessionHandle | null;
  /**
   * Return value for `session.prompt`. Defaults to `"ok"`.
   * Pass `null` to make `session.prompt` undefined.
   */
  readonly sessionPromptResult?: unknown | null;
  /**
   * Whether to include a `bus` in the context. Defaults to true.
   */
  readonly withBus?: boolean;
}

// ---------------------------------------------------------------------------
// Fake context shape
// ---------------------------------------------------------------------------

export interface FakePluginContext {
  /** The PluginServerContext to pass to buildServer(). */
  readonly ctx: PluginServerContext;

  // Recorded calls — read these in assertions.
  readonly busEmits: BusEmitRecord[];
  readonly sessionCreates: SessionCreateRecord[];
  readonly sessionPrompts: SessionPromptRecord[];
  readonly assistantMessages: SessionWriteRecord[];
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function makeFakePluginContext(
  config: FakePluginContextConfig = {},
): FakePluginContext {
  const session_id = config.session_id ?? "sess_integration_1";
  const withBus = config.withBus ?? true;
  const sessionCreateResult =
    config.sessionCreateResult === undefined
      ? ({ session_id: "child_sess_1" } satisfies SessionHandle)
      : config.sessionCreateResult;
  const sessionPromptResult =
    config.sessionPromptResult === undefined ? "ok" : config.sessionPromptResult;

  // Recorded call logs — mutated by each spy call below.
  const busEmits: BusEmitRecord[] = [];
  const sessionCreates: SessionCreateRecord[] = [];
  const sessionPrompts: SessionPromptRecord[] = [];
  const assistantMessages: SessionWriteRecord[] = [];

  // --- Bus ---
  const bus: Bus | undefined = withBus
    ? {
        emit(event: BusEvent): void {
          busEmits.push({ event });
        },
      }
    : undefined;

  // --- SessionApi ---
  const session: SessionApi = {};

  if (sessionCreateResult !== null) {
    const result = sessionCreateResult; // narrow for closure
    session.create = async (opts: SessionCreateOpts): Promise<SessionHandle> => {
      sessionCreates.push({ opts });
      return result;
    };
  }

  if (sessionPromptResult !== null) {
    const result = sessionPromptResult; // narrow for closure
    session.prompt = async (opts: SessionPromptOpts): Promise<unknown> => {
      sessionPrompts.push({ opts });
      return result;
    };
  }

  session.writeAssistantMessage = (opts: AssistantMessageOpts): void => {
    assistantMessages.push({ opts });
  };

  // --- Assembled context ---
  const ctx: PluginServerContext = {
    session_id,
    bus,
    session,
  };

  return {
    ctx,
    busEmits,
    sessionCreates,
    sessionPrompts,
    assistantMessages,
  };
}
