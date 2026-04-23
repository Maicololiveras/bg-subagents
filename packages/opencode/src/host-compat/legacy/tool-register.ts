/**
 * `task_bg` tool registration (Hooks.tool).
 *
 * Defines a sibling tool to the core `task` that spawns a subagent as a
 * background task via `core.TaskRegistry.spawn`. Returns immediately with
 * `{ task_id, status: "running" }`; the actual subagent work happens inside
 * the fiber-like run callback the caller (plugin.ts) passes in.
 *
 * Design §4.1: register task_bg + steer via chat.params.
 */
import type { Logger, TaskRegistry } from "@maicolextic/bg-subagents-core";

import type { HookToolDefinition, ToolContext } from "../../types.js";

const TOOL_NAME = "task_bg";
const TOOL_DESCRIPTION =
  "Fork a subagent task in the background. Returns immediately with a task_id; the subagent runs independently and emits a completion event when done. Use for long-running research, audits, or cleanup that should not block the main conversation.";

/**
 * Minimum parameters schema the OpenCode host understands. Kept as a plain
 * JSON-Schema-ish object (no zod at this layer — the host dictates format).
 */
const TOOL_PARAMETERS: Readonly<Record<string, unknown>> = Object.freeze({
  type: "object",
  required: ["subagent_type", "prompt"],
  properties: {
    subagent_type: {
      type: "string",
      description:
        "Subagent type identifier. Same identifiers as the core `task` tool.",
    },
    prompt: {
      type: "string",
      description: "Prompt text passed to the subagent.",
    },
    description: {
      type: "string",
      description: "Optional short human-readable description of the task.",
    },
    policy_override: {
      type: "string",
      enum: ["background", "foreground"],
      description:
        "Force this invocation into a specific mode, bypassing the resolved policy. Rarely used; prefer letting the picker/policy decide.",
    },
  },
  additionalProperties: false,
});

/**
 * Input shape derived from `TOOL_PARAMETERS`. Re-declared locally so we can
 * type-narrow at the call site.
 */
export interface TaskBgInput {
  readonly subagent_type: string;
  readonly prompt: string;
  readonly description?: string;
  readonly policy_override?: "background" | "foreground";
}

export interface TaskBgResult {
  readonly task_id: string;
  readonly status: "running";
}

/**
 * Callback invoked once per `task_bg` call. Supplied by `plugin.ts` so tests
 * can inject fakes. Receives the parsed input + the task's abort signal and
 * returns the settled payload (whatever the subagent produced). The
 * registry handles history + completion events.
 */
export type RunOpenCodeSubagent = (
  ctx: ToolContext,
  input: TaskBgInput,
  signal: AbortSignal,
) => Promise<unknown>;

export interface RegisterTaskBgOpts {
  readonly registry: TaskRegistry;
  readonly run: RunOpenCodeSubagent;
  readonly logger?: Logger;
}

/**
 * Build the tool definition for `task_bg`. The caller appends the returned
 * object to the `Hooks.tool` array returned from `plugin.server()`.
 */
export function registerTaskBgTool(opts: RegisterTaskBgOpts): HookToolDefinition {
  const { registry, run, logger } = opts;

  return {
    name: TOOL_NAME,
    description: TOOL_DESCRIPTION,
    parameters: TOOL_PARAMETERS,
    async execute(rawInput, ctx): Promise<TaskBgResult> {
      const parsed = parseInput(rawInput);
      if (parsed === null) {
        logger?.warn("task_bg:invalid-input", { raw: rawInput });
        throw new Error(
          "task_bg requires `subagent_type: string` and `prompt: string`.",
        );
      }

      const handle = registry.spawn({
        meta: {
          tool: TOOL_NAME,
          subagent_type: parsed.subagent_type,
          description: parsed.description ?? null,
        },
        run: async (signal) => run(ctx, parsed, signal),
      });

      logger?.info("task_bg:spawned", {
        task_id: handle.id,
        subagent_type: parsed.subagent_type,
      });

      // Surface any failure from the fiber into the registry's internal
      // settle paths — swallow here so the tool result returns immediately.
      handle.done.catch(() => undefined);

      return { task_id: handle.id, status: "running" };
    },
  };
}

function parseInput(raw: Readonly<Record<string, unknown>>): TaskBgInput | null {
  const subagent_type = raw["subagent_type"];
  const prompt = raw["prompt"];
  if (typeof subagent_type !== "string" || subagent_type.length === 0) return null;
  if (typeof prompt !== "string" || prompt.length === 0) return null;

  const description =
    typeof raw["description"] === "string" ? (raw["description"] as string) : undefined;
  const override = raw["policy_override"];
  const policy_override =
    override === "background" || override === "foreground"
      ? (override as "background" | "foreground")
      : undefined;

  const out: TaskBgInput = {
    subagent_type,
    prompt,
    ...(description !== undefined ? { description } : {}),
    ...(policy_override !== undefined ? { policy_override } : {}),
  };
  return out;
}

export { TOOL_NAME as TASK_BG_TOOL_NAME, TOOL_DESCRIPTION, TOOL_PARAMETERS };
