/**
 * runOpenCodeSubagent — v0.4 process-based BG (REWRITE 2026-04-27).
 *
 * Architecture pivot: instead of awaiting session.prompt(child) which blocks
 * the parent OpenCode session in 1.14.28, we spawn a TOTALLY SEPARATE process
 * via the `opencode run` CLI. The child process is OS-isolated from the parent:
 *
 *   parent OpenCode TUI session
 *       │ (orchestrator — NEVER blocks)
 *       │
 *       ├─ User messages → orchestrator responds freely
 *       │
 *       ├─ task_bg tool execute:
 *       │   ├─ child = spawn('opencode', ['run', '--prompt', P, '--agent', X,
 *       │   │                              '--format', 'json',
 *       │   │                              '--dangerously-skip-permissions',
 *       │   │                              '--pure']) ← independent OS process
 *       │   ├─ Watcher streams stdout (JSON events) for monitoring
 *       │   └─ return { task_id, status: "running" } INMEDIATO
 *       │
 *       └─ On child exit:
 *           └─ client.session.prompt({sessionID: parent, noReply: true,
 *                                     parts: [{type: "text", text: result}]})
 *
 * Key advantages over v1.0 architecture:
 *   - Bypass tool-intercept hooks (broken in 1.14.28)
 *   - True parallelism (multiple OS processes, not Node fibers)
 *   - Zero shared state with parent → zero blocking
 *   - Result delivery via noReply (proven to work in delivery.ts)
 *   - Cancellation via SIGTERM
 *   - --pure flag prevents recursive plugin loading
 *
 * Pattern proven by `claude -p` (Anthropic Claude Code's print mode).
 *
 * Spec: engram topic v0.4/architecture/process-based-bg
 */
import { spawn, type ChildProcess } from "node:child_process";
import type { ToolContext } from "./types.js";
import type { TaskBgInput } from "./host-compat/legacy/tool-register.js";

// -----------------------------------------------------------------------------
// OpencodeClient shape — minimal, just what we use for noReply delivery.
// -----------------------------------------------------------------------------

export interface SubagentDeliveryClient {
  readonly session: {
    prompt(options: {
      path: { id: string };
      body: {
        noReply: boolean;
        parts: Array<{ type: "text"; text: string }>;
      };
    }): Promise<unknown>;
  };
}

export interface SubagentRunResult {
  readonly task_id: string;
  readonly child_pid: number;
  readonly child_session_id?: string;
  readonly mode: "process-spawn";
  readonly exit_code?: number;
  readonly result_text?: string;
  readonly error?: string;
}

export interface SubagentRunnerOpts {
  readonly client: SubagentDeliveryClient;
  /** Override the opencode binary path (default: "opencode" via PATH). */
  readonly opencodeBinary?: string;
  /** Override cwd for the child (default: process.cwd()). */
  readonly cwd?: string;
  /** Default timeout in ms before SIGKILL (default: 10 minutes). */
  readonly timeoutMs?: number;
  /** Optional logger for diagnostics. */
  readonly logger?: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Build a subagent runner bound to the given OpencodeClient.
 *
 * Returned function matches the registry's `run` contract: takes ctx + input
 * + signal, returns a Promise that resolves when the child exits. The Promise
 * is intentionally NOT awaited by the registry's spawn — handle.done captures
 * it for the watcher / TUI. The PARENT'S tool execute returns immediately
 * after calling registry.spawn — that is what unblocks the orchestrator.
 */
export function createSubagentRunner(opts: SubagentRunnerOpts) {
  const {
    client,
    opencodeBinary = "opencode",
    cwd = process.cwd(),
    timeoutMs = DEFAULT_TIMEOUT_MS,
    logger,
  } = opts;

  return async function runOpenCodeSubagentProcess(
    ctx: ToolContext,
    input: TaskBgInput,
    signal: AbortSignal,
  ): Promise<SubagentRunResult> {
    if (signal.aborted) {
      throw new Error("aborted before start");
    }

    const taskId = `tsk_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    const parentSessionID = (ctx as { sessionID?: string }).sessionID ?? "";

    // ---------------------------------------------------------------------------
    // Spawn the child OpenCode process — totally independent from parent.
    // ---------------------------------------------------------------------------
    const args = [
      "run",
      "--agent",
      input.subagent_type,
      "--format",
      "json",
      "--dangerously-skip-permissions",
      "--pure", // CRITICAL: prevent the child from loading plugins (avoid recursion)
      input.prompt,
    ];

    logger?.info("subagent-process:spawn", {
      task_id: taskId,
      agent: input.subagent_type,
      bin: opencodeBinary,
      cwd,
      args_redacted: args.slice(0, args.length - 1), // hide the prompt
    });

    let child: ChildProcess;
    try {
      child = spawn(opencodeBinary, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
    } catch (err) {
      logger?.error("subagent-process:spawn-failed", {
        task_id: taskId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }

    if (child.pid === undefined) {
      throw new Error(`Failed to spawn opencode child process for task ${taskId}`);
    }

    const stdoutChunks: string[] = [];
    const stderrChunks: string[] = [];

    child.stdout?.on("data", (chunk: Buffer) => {
      stdoutChunks.push(chunk.toString("utf8"));
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderrChunks.push(chunk.toString("utf8"));
    });

    // Honor abort signal — kill child if parent aborts.
    const onAbort = () => {
      logger?.warn("subagent-process:aborted", { task_id: taskId, pid: child.pid });
      try {
        child.kill("SIGTERM");
        // Force kill after grace period
        setTimeout(() => {
          try {
            child.kill("SIGKILL");
          } catch {
            // already dead
          }
        }, 3000).unref();
      } catch {
        // ignore — child may already be dead
      }
    };
    signal.addEventListener("abort", onAbort, { once: true });

    // Timeout — defensive kill
    const timeoutHandle = setTimeout(() => {
      logger?.warn("subagent-process:timeout", { task_id: taskId, timeout_ms: timeoutMs });
      try {
        child.kill("SIGTERM");
      } catch {
        // ignore
      }
    }, timeoutMs);
    timeoutHandle.unref();

    // ---------------------------------------------------------------------------
    // Wait for child exit, then deliver result to parent.
    // ---------------------------------------------------------------------------
    return new Promise<SubagentRunResult>((resolve) => {
      child.on("exit", (code, signalName) => {
        clearTimeout(timeoutHandle);
        signal.removeEventListener("abort", onAbort);

        const stdout = stdoutChunks.join("");
        const stderr = stderrChunks.join("");

        logger?.info("subagent-process:exit", {
          task_id: taskId,
          pid: child.pid,
          code,
          signal: signalName,
          stdout_bytes: stdout.length,
          stderr_bytes: stderr.length,
        });

        // Best-effort extract final result text from JSON output.
        const resultText =
          code === 0 ? extractResultFromJsonStream(stdout) : null;

        // Deliver to parent via noReply — even on errors (so user sees what happened).
        if (parentSessionID) {
          const deliveryText =
            code === 0 && resultText !== null
              ? formatSuccessDelivery(taskId, input, resultText)
              : formatErrorDelivery(taskId, input, code, signalName, stderr);

          client.session
            .prompt({
              path: { id: parentSessionID },
              body: {
                noReply: true,
                parts: [{ type: "text", text: deliveryText }],
              },
            })
            .catch((err: unknown) => {
              logger?.error("subagent-process:delivery-failed", {
                task_id: taskId,
                error: err instanceof Error ? err.message : String(err),
              });
            });
        }

        resolve({
          task_id: taskId,
          child_pid: child.pid ?? -1,
          mode: "process-spawn",
          ...(code !== null ? { exit_code: code } : {}),
          ...(resultText !== null ? { result_text: resultText } : {}),
          ...(code !== 0
            ? { error: `exit ${code} signal ${signalName ?? "none"}` }
            : {}),
        });
      });

      child.on("error", (err) => {
        clearTimeout(timeoutHandle);
        signal.removeEventListener("abort", onAbort);
        logger?.error("subagent-process:error", {
          task_id: taskId,
          error: err.message,
        });
        // Resolve with error — don't reject (registry handles failures)
        resolve({
          task_id: taskId,
          child_pid: child.pid ?? -1,
          mode: "process-spawn",
          error: err.message,
        });
      });
    });
  };
}

// -----------------------------------------------------------------------------
// JSON event stream parsing — opencode run --format json emits NDJSON
// (one event per line). The final assistant text is in the last "message"
// event with type "text" parts.
// -----------------------------------------------------------------------------

function extractResultFromJsonStream(stdout: string): string | null {
  // Each line is a JSON object. Find the last assistant message text.
  const lines = stdout.split("\n").filter((l) => l.trim().length > 0);
  let finalText: string | null = null;

  for (const line of lines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Look for assistant message events with text parts.
    const parts = (event["parts"] ?? (event as { message?: { parts?: unknown[] } }).message?.parts) as
      | Array<Record<string, unknown>>
      | undefined;
    if (!Array.isArray(parts)) continue;

    for (const part of parts) {
      if (part["type"] === "text" && typeof part["text"] === "string") {
        finalText = part["text"] as string;
      }
    }
  }

  // Fallback: if no structured part found, return the whole stdout (truncated).
  if (finalText === null && stdout.length > 0) {
    const trimmed = stdout.trim();
    finalText = trimmed.length > 4000 ? trimmed.slice(0, 4000) + "\n\n…(truncated)" : trimmed;
  }

  return finalText;
}

function formatSuccessDelivery(
  taskId: string,
  input: TaskBgInput,
  resultText: string,
): string {
  const description = input.description ? ` — ${input.description}` : "";
  return `**[${input.subagent_type}]**${description}  · _${taskId}_  · ✓ done\n\n${resultText}`;
}

function formatErrorDelivery(
  taskId: string,
  input: TaskBgInput,
  code: number | null,
  signalName: NodeJS.Signals | null,
  stderr: string,
): string {
  const description = input.description ? ` — ${input.description}` : "";
  const stderrSnippet = stderr.length > 500 ? stderr.slice(0, 500) + "…" : stderr;
  return [
    `**[${input.subagent_type}]**${description}  · _${taskId}_  · ✗ failed`,
    "",
    `Exit: ${code ?? "null"} (signal: ${signalName ?? "none"})`,
    "",
    "```",
    stderrSnippet || "(no stderr)",
    "```",
  ].join("\n");
}

// -----------------------------------------------------------------------------
// Backward-compatible export — old direct call signature.
// Used by tests and legacy host-compat. The real production wiring uses
// createSubagentRunner(opts) above.
// -----------------------------------------------------------------------------

/**
 * @deprecated v0.4 process-based runner requires a client. Use
 * `createSubagentRunner(opts)` and bind once at plugin boot. This export
 * remains for back-compat with legacy host that doesn't have a client.
 */
export async function runOpenCodeSubagent(
  ctx: ToolContext,
  input: TaskBgInput,
  signal: AbortSignal,
): Promise<unknown> {
  // Without a client, we can still spawn but cannot deliver to parent.
  // This path runs the child process and returns its raw stdout.
  const noopClient: SubagentDeliveryClient = {
    session: {
      prompt: async () => undefined,
    },
  };
  const runner = createSubagentRunner({ client: noopClient });
  return runner(ctx, input, signal);
}
