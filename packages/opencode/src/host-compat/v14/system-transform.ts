/**
 * v14 `experimental.chat.system.transform` hook.
 *
 * On OpenCode 1.14+ the legacy `chat.params.system` pattern is replaced by
 * a dedicated hook whose `output.system` is a `string[]` that the host
 * concatenates into the final system prompt. This module produces the
 * handler that pushes a `task_bg` advertisement into that array so the
 * model knows the background-subagent tool is available.
 *
 * Mirrors `host-compat/legacy/chat-params.ts` in intent; differs in:
 *   - v14 hooks MUTATE `output` in place (no return value).
 *   - `output.system` is an array, not a string.
 *   - Same SYSTEM_ADDENDUM text is shared across both paths to keep the
 *     model's view of `task_bg` identical regardless of host version.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import { SYSTEM_ADDENDUM } from "../legacy/chat-params.js";

export { SYSTEM_ADDENDUM };

export interface SystemTransformOpts {
  /**
   * Returns `true` when `task_bg` has been registered for this session.
   * Guards against advertising a tool the host wouldn't find.
   */
  readonly isTaskBgRegistered: (sessionId: string) => boolean;
}

export type SystemTransformHook = (
  input: { sessionID?: string; model: unknown },
  output: { system: string[] },
) => Promise<void>;

export function buildSystemTransform(
  opts: SystemTransformOpts,
): SystemTransformHook {
  return async function systemTransform(input, output) {
    const sessionID = input.sessionID ?? "session_unknown";
    if (!opts.isTaskBgRegistered(sessionID)) {
      return;
    }
    output.system.push(SYSTEM_ADDENDUM);
  };
}
