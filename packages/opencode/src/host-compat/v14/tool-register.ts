/**
 * v14 task_bg tool registration.
 *
 * On OpenCode 1.14+ the plugin SDK expects tools under `Hooks.tool` to be an
 * OBJECT keyed by tool name, where each value is a `ToolDefinition`:
 *
 *   { description: string, args: z.ZodRawShape, execute: (args, ctx) => Promise<ToolResult> }
 *
 * This module builds a single `ToolDefinition` for `task_bg`. The caller
 * assembles `{ task_bg: registerTaskBgToolV14(...) }` into the Hooks object.
 *
 * Zod note: we import `z` from `@opencode-ai/plugin/tool` (the re-export) to
 * guarantee we use the same Zod instance the plugin host bundles (Zod 4.1.8).
 * Importing our own Zod 3 would produce schemas the host-side parser does
 * not recognize. Verified via Phase 1 spike findings.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/specs/host-compat/spec.md
 */

import type { Logger, TaskRegistry } from "@maicolextic/bg-subagents-core";
import { tool, type ToolContext, type ToolResult } from "@opencode-ai/plugin/tool";

const z = tool.schema;

const TOOL_DESCRIPTION =
  "Fork a subagent task in the background. Returns immediately with a task_id; the subagent runs independently and emits a completion event when done. Use for long-running research, audits, or cleanup that should not block the main conversation.";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface TaskBgInputV14 {
  readonly subagent_type: string;
  readonly prompt: string;
  readonly description?: string;
  readonly policy_override?: "background" | "foreground";
}

export type RunOpenCodeSubagentV14 = (
  ctx: ToolContext,
  input: TaskBgInputV14,
  signal: AbortSignal,
) => Promise<unknown>;

export interface RegisterTaskBgToolV14Opts {
  readonly registry: TaskRegistry;
  readonly run: RunOpenCodeSubagentV14;
  readonly logger?: Logger;
}

// -----------------------------------------------------------------------------
// Factory
// -----------------------------------------------------------------------------
//
// We use the re-exported `tool()` helper purely so TypeScript surfaces an
// explicit ToolDefinition shape instead of inferring through the deep Zod
// internals (TS2742 — non-portable type inference across pnpm stores). The
// helper is identity at runtime.

type V14TaskBgToolDefinition = {
  description: string;
  args: Record<string, unknown>;
  execute: (args: TaskBgInputV14, ctx: ToolContext) => Promise<ToolResult>;
};

export function registerTaskBgToolV14(
  opts: RegisterTaskBgToolV14Opts,
): V14TaskBgToolDefinition {
  const { registry, run, logger } = opts;

  return tool({
    description: TOOL_DESCRIPTION,
    args: {
      subagent_type: z
        .string()
        .min(1)
        .describe(
          "Subagent type identifier. Same identifiers as the core `task` tool.",
        ),
      prompt: z.string().min(1).describe("Prompt text passed to the subagent."),
      description: z
        .string()
        .optional()
        .describe("Optional short human-readable description of the task."),
      policy_override: z
        .enum(["background", "foreground"])
        .optional()
        .describe(
          "Force this invocation into a specific mode, bypassing the resolved policy. Rarely used; prefer letting the picker/policy decide.",
        ),
    },
    async execute(args, ctx): Promise<ToolResult> {
      const parsed: TaskBgInputV14 = {
        subagent_type: args.subagent_type,
        prompt: args.prompt,
        ...(args.description !== undefined
          ? { description: args.description }
          : {}),
        ...(args.policy_override !== undefined
          ? { policy_override: args.policy_override }
          : {}),
      };

      const handle = registry.spawn({
        meta: {
          tool: "task_bg",
          subagent_type: parsed.subagent_type,
          description: parsed.description ?? null,
          // Real sessionID captured at execute time — authoritative for
          // delivery (createV14Delivery resolves sessionID from this meta
          // field rather than the boot placeholder).
          session_id: ctx.sessionID,
        },
        run: async (signal: AbortSignal) => run(ctx, parsed, signal),
      });

      logger?.info("task_bg:spawned", {
        task_id: handle.id,
        subagent_type: parsed.subagent_type,
      });

      // Swallow fiber failures here — registry handles the settle path.
      handle.done.catch(() => undefined);

      // Compact output — keep the chat transcript clean. Full detail stays
      // in metadata for downstream consumers (sidebar, /task view, etc.).
      const describe =
        parsed.description !== undefined && parsed.description.length > 0
          ? ` (${parsed.description})`
          : "";
      return {
        output: `Task ${handle.id}${describe} — running in background.`,
        metadata: {
          task_id: handle.id,
          status: "running",
          subagent_type: parsed.subagent_type,
          ...(parsed.description !== undefined
            ? { description: parsed.description }
            : {}),
        },
      };
    },
  }) as V14TaskBgToolDefinition;
}

export { TOOL_DESCRIPTION as TASK_BG_V14_DESCRIPTION };
