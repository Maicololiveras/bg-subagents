/**
 * `Hooks.chat.params` steer — injects a short system-prompt addendum telling
 * the model about the `task_bg` tool alongside the core `task`.
 *
 * Guarded by `opencode_task_bg_registered` on the host_context so plugin
 * installations that failed to register `task_bg` don't lie to the model.
 */
import type { HooksChatParamsInput, HooksChatParamsResult } from "../types.js";

const SYSTEM_ADDENDUM = [
  "",
  "Available background subagent tool:",
  "- `task_bg`: Forks a subagent in the background. Use it alongside `task` for",
  "  research, repository audits, or any long-running work (>1 minute expected)",
  "  that should not block the main conversation. The `task_bg` tool returns",
  "  immediately with a `task_id`; completion arrives later as a notification.",
  "  The user will be prompted to confirm each `task` call — prefer `task_bg`",
  "  when the work is clearly long-running or read-only research.",
].join("\n");

export interface SteerChatParamsOpts {
  /**
   * Inspect `host_context` for the current session. If `task_bg` isn't
   * registered (e.g. plugin partially failed to boot), the addendum is NOT
   * injected.
   */
  readonly isTaskBgRegistered: (sessionId: string) => boolean;
}

export type SteerChatParamsFn = (
  input: HooksChatParamsInput,
) => HooksChatParamsResult;

export function steerChatParams(opts: SteerChatParamsOpts): SteerChatParamsFn {
  return function chatParams(input) {
    if (!opts.isTaskBgRegistered(input.session_id)) {
      // No steer — plugin isn't ready or foreground-only config.
      return {};
    }
    const existing = input.system ?? "";
    const next = existing.length > 0 ? `${existing}\n${SYSTEM_ADDENDUM}` : SYSTEM_ADDENDUM;
    return { system: next };
  };
}

export { SYSTEM_ADDENDUM };
