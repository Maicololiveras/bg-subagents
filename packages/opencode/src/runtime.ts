/**
 * runOpenCodeSubagent — runs a single background subagent call inside an
 * OpenCode child session.
 *
 * Placeholder implementation for Batch 6 (adapter wiring). Real streaming +
 * progress delivery is exercised in Batch 7 integration tests with a faked
 * `ctx`. This entry point only has to satisfy the `RunOpenCodeSubagent`
 * contract (see host-compat/legacy/tool-register.ts):
 *   - honour the AbortSignal (propagates to `session.prompt` when supported)
 *   - return the payload or throw — the registry captures both.
 */
import type { ToolContext } from "./types.js";
import type { TaskBgInput } from "./host-compat/legacy/tool-register.js";

export async function runOpenCodeSubagent(
  ctx: ToolContext,
  input: TaskBgInput,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) {
    throw buildAbortError(signal);
  }

  const session = ctx.session;
  if (session === undefined) {
    throw new Error(
      "runOpenCodeSubagent: ToolContext.session is undefined — cannot invoke child session.",
    );
  }

  // Prefer `session.create + session.prompt` when both are available; the
  // child session keeps logs + cost counters separated from the parent.
  let targetSessionId: string | undefined;
  if (typeof session.create === "function") {
    const child = await session.create({
      agent: input.subagent_type,
      metadata: {
        description: input.description ?? null,
        parent_tool: "task_bg",
      },
    });
    targetSessionId = child.session_id;
  }

  if (typeof session.prompt !== "function") {
    throw new Error(
      "runOpenCodeSubagent: ToolContext.session.prompt is undefined — cannot dispatch prompt.",
    );
  }

  const promptArgs = {
    prompt: input.prompt,
    signal,
    ...(targetSessionId !== undefined ? { session_id: targetSessionId } : {}),
  };

  return session.prompt(promptArgs);
}

function buildAbortError(signal: AbortSignal): Error {
  const err = new Error(
    signal.reason instanceof Error
      ? signal.reason.message
      : typeof signal.reason === "string"
        ? signal.reason
        : "runOpenCodeSubagent: aborted before start",
  );
  err.name = "AbortError";
  return err;
}
