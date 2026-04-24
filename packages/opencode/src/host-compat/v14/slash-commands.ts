/**
 * Server-side slash command interceptor — Phase 8.8 + Phase 12
 *
 * Intercepts `/task *` command patterns from the `chat.message` hook (or
 * equivalent server-side message handler). Two concerns handled here:
 *
 * 1. `/task policy <bg|fg|default>` (Phase 8.8)
 *    Sets a session-level policy override consumed by messagesTransformInterceptor.
 *    Stored in an in-memory Map<sessionID, SessionOverride>.
 *
 * 2. Live Control commands `/task list|show|logs|kill|move-bg` (Phase 12)
 *    Fully implemented in Phase 12.
 *
 * Zero-pollution: NO console.log or process.stdout.write anywhere.
 * All diagnostics via createLogger("v14:slash-commands").
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 8.7–8.8, 12.3–12.6
 */

import {
  createLogger,
  TaskRegistry,
  type TaskState,
  unsafeTaskId,
} from "@maicolextic/bg-subagents-core";

const log = createLogger("v14:slash-commands");

// ---------------------------------------------------------------------------
// Types — re-exported so consumers can import from one place
// ---------------------------------------------------------------------------

export type { SessionOverride } from "@maicolextic/bg-subagents-core";

/** Return type for interceptors — either handled (with reply) or not. */
export type InterceptResult =
  | { readonly handled: true; readonly reply: string }
  | { readonly handled: false };

// ---------------------------------------------------------------------------
// TaskPolicyStore — session-scoped session override storage
// ---------------------------------------------------------------------------

/**
 * In-memory store for per-session policy overrides.
 * Keyed by sessionID. Thread-safe within a single Node.js process (single-
 * threaded JS event loop guarantees atomic Map operations).
 *
 * "default" sets are normalized to undefined (cleared) — callers need not
 * distinguish between "never set" and "explicitly cleared to default".
 */
export interface TaskPolicyStore {
  /** Returns current override for the session, or undefined if none. */
  getSessionOverride(sessionID: string): "bg" | "fg" | undefined;
  /** Set override. "default" clears any existing override. */
  setSessionOverride(sessionID: string, mode: "bg" | "fg" | "default"): void;
}

/**
 * Create a new isolated TaskPolicyStore.
 * Each call returns a fresh Map — tests must use their own instance.
 * Production code should create ONE instance and share it across interceptors.
 */
export function createTaskPolicyStore(): TaskPolicyStore {
  const overrides = new Map<string, "bg" | "fg">();

  return {
    getSessionOverride(sessionID: string): "bg" | "fg" | undefined {
      return overrides.get(sessionID);
    },

    setSessionOverride(sessionID: string, mode: "bg" | "fg" | "default"): void {
      if (mode === "default") {
        overrides.delete(sessionID);
        log.debug("session policy override cleared", { sessionID });
      } else {
        overrides.set(sessionID, mode);
        log.debug("session policy override set", { sessionID, mode });
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton store — shared between all interceptors in the same process
// ---------------------------------------------------------------------------

let _sharedStore: TaskPolicyStore | undefined;

/**
 * Get or create the shared singleton TaskPolicyStore.
 * Used by messagesTransformInterceptor and slash command interceptor to
 * share the same session override state without explicit DI.
 *
 * Tests should use createTaskPolicyStore() directly for isolation.
 */
export function getSharedPolicyStore(): TaskPolicyStore {
  if (!_sharedStore) {
    _sharedStore = createTaskPolicyStore();
  }
  return _sharedStore;
}

// ---------------------------------------------------------------------------
// /task policy interceptor
// ---------------------------------------------------------------------------

const VALID_MODES = new Set<string>(["bg", "fg", "default"]);

/**
 * Intercept a `/task policy <mode>` message.
 *
 * @param text - Raw message text from the user.
 * @param sessionID - Current session identifier.
 * @param store - The TaskPolicyStore to update.
 * @returns InterceptResult — handled: true + reply if matched, false otherwise.
 */
export function interceptTaskPolicyCommand(
  text: string,
  sessionID: string,
  store: TaskPolicyStore,
): InterceptResult {
  const trimmed = text.trim();

  // Match: /task policy <mode>
  const match = /^\/task\s+policy\s+(\S+)$/i.exec(trimmed);
  if (!match) {
    return { handled: false };
  }

  const mode = match[1]!.toLowerCase();

  if (!VALID_MODES.has(mode)) {
    log.warn("invalid /task policy mode", { sessionID, mode });
    return {
      handled: true,
      reply: `**[bg-subagents]** Invalid mode \`${mode}\`. Valid modes: \`bg\`, \`fg\`, \`default\`.`,
    };
  }

  store.setSessionOverride(sessionID, mode as "bg" | "fg" | "default");

  let reply: string;
  if (mode === "default") {
    reply =
      "**[bg-subagents]** Policy override cleared. Per-agent config defaults restored for next turn.";
  } else {
    const label = mode === "bg" ? "background" : "foreground";
    reply = `**[bg-subagents]** Policy override set to \`${mode}\`. All task calls next turn → **${label}**.`;
  }

  log.info("task policy command handled", { sessionID, mode });
  return { handled: true, reply };
}

// ---------------------------------------------------------------------------
// Live Control — Phase 12: /task move-bg
// ---------------------------------------------------------------------------

const logMoveBg = createLogger("v14:task-move-bg");

/**
 * Intercept `/task move-bg <task-id>`.
 *
 * Flow:
 *   1. Parse the task id from the message.
 *   2. Look it up in the registry.
 *   3. If not found → error.
 *   4. If already BG (meta.mode === "bg") → no-op.
 *   5. If running FG → kill + re-spawn with mode=bg.
 *
 * @param text - Raw user message text.
 * @param sessionID - Current session ID.
 * @param registry - TaskRegistry instance for lookup + cancel + re-spawn.
 * @param store - TaskPolicyStore (unused in core flow, injected for future use).
 * @returns Promise<InterceptResult>
 */
export async function interceptTaskMoveBgCommand(
  text: string,
  sessionID: string,
  registry: TaskRegistry,
  store: TaskPolicyStore,
): Promise<InterceptResult> {
  const trimmed = text.trim();

  // Match: /task move-bg [<id>]
  const moveBgRe = /^\/task\s+move-bg(?:\s+(\S+))?$/i;
  const match = moveBgRe.exec(trimmed);
  if (!match) {
    return { handled: false };
  }

  const taskId = match[1];
  if (!taskId || taskId.trim() === "") {
    logMoveBg.warn("move-bg called with missing task id", { sessionID });
    return {
      handled: true,
      reply: "**[bg-subagents]** Missing task id. Usage: `/task move-bg <task-id>`.",
    };
  }

  // Cast to branded TaskId (registry.get requires TaskId, not plain string)
  const taskState: TaskState | undefined = registry.get(unsafeTaskId(taskId));

  if (!taskState) {
    logMoveBg.warn("move-bg: task not found", { sessionID, taskId });
    return {
      handled: true,
      reply: `**[bg-subagents]** Task \`${taskId}\` not found.`,
    };
  }

  // Already BG — no-op
  if (taskState.meta["mode"] === "bg") {
    logMoveBg.info("move-bg: task already in BG", { sessionID, taskId });
    return {
      handled: true,
      reply: `**[bg-subagents]** Task \`${taskId}\` is already in BG mode. No-op.`,
    };
  }

  // Kill the FG task
  logMoveBg.info("move-bg: killing FG task", { sessionID, taskId });
  await registry.kill(unsafeTaskId(taskId));

  // Re-spawn with same meta but mode=bg
  const newMeta = { ...taskState.meta, mode: "bg" };
  const newHandle = registry.spawn({
    meta: newMeta,
    run: (signal) =>
      new Promise<void>((_resolve, reject) => {
        // Background placeholder — real invocation handled by the invoker layer.
        // Resolves cleanly when killed/aborted so no orphan rejections.
        signal.addEventListener("abort", () => reject(new Error("bg-task-aborted")), { once: true });
      }),
  });
  // Suppress unhandled rejection from the background placeholder done promise.
  newHandle.done.catch(() => undefined);

  logMoveBg.info("move-bg: re-spawned as BG", {
    sessionID,
    oldId: taskId,
    newId: newHandle.id,
  });

  return {
    handled: true,
    reply: `**[bg-subagents]** Task \`${taskId}\` moved to background. New task id: \`${newHandle.id}\`.`,
  };
}

// ---------------------------------------------------------------------------
// Live Control — Phase 12: /task list|show|logs|kill
// ---------------------------------------------------------------------------

const logList = createLogger("v14:task-list");
const logShow = createLogger("v14:task-show");
const logLogs = createLogger("v14:task-logs");
const logKill = createLogger("v14:task-kill");

/** Elapsed time formatter (ms → human string). */
function formatElapsed(startedAt: number): string {
  const ms = Date.now() - startedAt;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s`;
  return `${Math.floor(ms / 60_000)}m${Math.floor((ms % 60_000) / 1000)}s`;
}

/**
 * `/task list` — returns a markdown table of all registry tasks.
 */
export function interceptTaskListCommand(
  registry: TaskRegistry,
  logger = logList,
): InterceptResult {
  const tasks = registry.list();
  logger.debug("task list requested", { count: tasks.length });

  if (tasks.length === 0) {
    return {
      handled: true,
      reply: "**[bg-subagents]** No active tasks.",
    };
  }

  const rows = tasks.map((t) => {
    const mode = String(t.meta["mode"] ?? "unknown");
    const elapsed = formatElapsed(t.started_at);
    return `| \`${t.id}\` | ${mode} | ${t.status} | ${elapsed} |`;
  });

  const table = [
    "| Task ID | Mode | Status | Elapsed |",
    "|---------|------|--------|---------|",
    ...rows,
  ].join("\n");

  return {
    handled: true,
    reply: `**[bg-subagents]** Active tasks:\n\n${table}`,
  };
}

/**
 * `/task show <id>` — returns a detailed task card.
 */
export function interceptTaskShowCommand(
  taskId: string,
  registry: TaskRegistry,
  logger = logShow,
): InterceptResult {
  const task = registry.get(unsafeTaskId(taskId));
  if (!task) {
    logger.warn("task show: not found", { taskId });
    return {
      handled: true,
      reply: `**[bg-subagents]** Task \`${taskId}\` not found.`,
    };
  }

  const mode = String(task.meta["mode"] ?? "unknown");
  const agent = String(task.meta["agent"] ?? "unknown");
  const prompt = String(task.meta["prompt"] ?? "");
  const promptPreview = prompt.length > 80 ? `${prompt.slice(0, 80)}…` : prompt;
  const elapsed = formatElapsed(task.started_at);

  const card = [
    `**[bg-subagents]** Task \`${taskId}\``,
    `- **Agent**: ${agent}`,
    `- **Mode**: ${mode}`,
    `- **Status**: ${task.status}`,
    `- **Elapsed**: ${elapsed}`,
    promptPreview ? `- **Prompt**: ${promptPreview}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  logger.info("task show returned", { taskId });
  return { handled: true, reply: card };
}

/**
 * `/task logs <id>` — returns logs for the task (from meta.logs buffer if present).
 */
export function interceptTaskLogsCommand(
  taskId: string,
  registry: TaskRegistry,
  logger = logLogs,
): InterceptResult {
  const task = registry.get(unsafeTaskId(taskId));
  if (!task) {
    logger.warn("task logs: not found", { taskId });
    return {
      handled: true,
      reply: `**[bg-subagents]** Task \`${taskId}\` not found.`,
    };
  }

  // Logs are stored in meta.logs as string[] or string (injected by invoker layer).
  const rawLogs = task.meta["logs"];
  let logsText = "";
  if (Array.isArray(rawLogs)) {
    logsText = (rawLogs as unknown[]).map(String).join("\n");
  } else if (typeof rawLogs === "string") {
    logsText = rawLogs;
  }

  const reply = logsText
    ? `**[bg-subagents]** Logs for \`${taskId}\`:\n\`\`\`\n${logsText}\n\`\`\``
    : `**[bg-subagents]** No logs available for \`${taskId}\`.`;

  logger.info("task logs returned", { taskId });
  return { handled: true, reply };
}

/**
 * `/task kill <id>` — cancels the task via registry.
 */
export async function interceptTaskKillCommand(
  taskId: string,
  registry: TaskRegistry,
  logger = logKill,
): Promise<InterceptResult> {
  const task = registry.get(unsafeTaskId(taskId));
  if (!task) {
    logger.warn("task kill: not found", { taskId });
    return {
      handled: true,
      reply: `**[bg-subagents]** Task \`${taskId}\` not found.`,
    };
  }

  // Already terminal
  const terminalStatuses = new Set(["completed", "killed", "error"]);
  if (terminalStatuses.has(task.status)) {
    logger.info("task kill: already completed", { taskId, status: task.status });
    return {
      handled: true,
      reply: `**[bg-subagents]** Task \`${taskId}\` is already ${task.status}.`,
    };
  }

  await registry.kill(unsafeTaskId(taskId));
  logger.info("task kill: killed", { taskId });
  return {
    handled: true,
    reply: `**[bg-subagents]** Task \`${taskId}\` cancelled.`,
  };
}

// ---------------------------------------------------------------------------
// Unified dispatcher — Phase 12.6
// ---------------------------------------------------------------------------

const VALID_SUBCOMMANDS = ["list", "show", "logs", "kill", "move-bg", "policy"];

/**
 * Dispatcher for all `/task <subcommand>` messages.
 * Routes to the appropriate handler based on the subcommand.
 * Falls back to `/task policy` handler for that specific subcommand.
 *
 * @param text - Raw user message text.
 * @param sessionID - Current session ID.
 * @param registry - TaskRegistry for Live Control commands.
 * @param store - TaskPolicyStore for /task policy.
 * @returns Promise<InterceptResult>
 */
export async function interceptTaskCommand(
  text: string,
  sessionID: string,
  registry: TaskRegistry = new TaskRegistry(),
  store: TaskPolicyStore = getSharedPolicyStore(),
): Promise<InterceptResult> {
  const trimmed = text.trim();

  // Must start with /task
  if (!/^\/task\s/i.test(trimmed) && !/^\/task$/i.test(trimmed)) {
    return { handled: false };
  }

  // Extract subcommand
  const subCmdMatch = /^\/task\s+(\S+)/i.exec(trimmed);
  const subCmd = subCmdMatch ? subCmdMatch[1]!.toLowerCase() : "";

  switch (subCmd) {
    case "policy":
      return interceptTaskPolicyCommand(trimmed, sessionID, store);

    case "move-bg":
      return interceptTaskMoveBgCommand(trimmed, sessionID, registry, store);

    case "list":
      return interceptTaskListCommand(registry);

    case "show": {
      const idMatch = /^\/task\s+show\s+(\S+)/i.exec(trimmed);
      const id = idMatch?.[1] ?? "";
      if (!id) {
        return { handled: true, reply: "**[bg-subagents]** Usage: `/task show <task-id>`." };
      }
      return interceptTaskShowCommand(id, registry);
    }

    case "logs": {
      const idMatch = /^\/task\s+logs\s+(\S+)/i.exec(trimmed);
      const id = idMatch?.[1] ?? "";
      if (!id) {
        return { handled: true, reply: "**[bg-subagents]** Usage: `/task logs <task-id>`." };
      }
      return interceptTaskLogsCommand(id, registry);
    }

    case "kill": {
      const idMatch = /^\/task\s+kill\s+(\S+)/i.exec(trimmed);
      const id = idMatch?.[1] ?? "";
      if (!id) {
        return { handled: true, reply: "**[bg-subagents]** Usage: `/task kill <task-id>`." };
      }
      return interceptTaskKillCommand(id, registry);
    }

    default: {
      // Unknown subcommand
      const validList = VALID_SUBCOMMANDS.map((s) => `\`${s}\``).join(", ");
      return {
        handled: true,
        reply: `**[bg-subagents]** Unknown subcommand \`${subCmd}\`. Valid subcommands: ${validList}.`,
      };
    }
  }
}
