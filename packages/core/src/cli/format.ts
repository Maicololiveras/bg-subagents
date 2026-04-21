/**
 * Pure CLI formatters for the /task command surface.
 *
 * No emojis (per Michael's CLAUDE.md). ASCII tags only. ANSI color is guarded
 * by `NO_COLOR` env + the caller's `color` flag — callers are responsible for
 * deciding based on `process.stdout.isTTY` + policy.
 *
 * FR-7 + NFR-11 + CLAUDE.md rules.
 */
import type { TaskStatus } from "@maicolextic/bg-subagents-protocol";

import type { TaskState } from "../task/TaskRegistry.js";

// -----------------------------------------------------------------------------
// Public options
// -----------------------------------------------------------------------------

export interface FormatOptions {
  /** Enable ANSI color codes. Callers should pass `false` when NOT a TTY. */
  readonly color?: boolean;
}

// -----------------------------------------------------------------------------
// Column widths (fixed-width table)
// -----------------------------------------------------------------------------

const COL_ID_WIDTH = 18; // tsk_<12 chars> + padding
const COL_STATUS_WIDTH = 10;
const COL_DURATION_WIDTH = 10;
const COL_AGENT_MAX = 30;

// -----------------------------------------------------------------------------
// Status helpers — ASCII tags, no emoji
// -----------------------------------------------------------------------------

const STATUS_TAGS: Readonly<Record<TaskStatus, string>> = {
  running: "[RUN]",
  completed: "[OK]",
  error: "[ERR]",
  killed: "[KIL]",
  killed_on_disconnect: "[DIS]",
  cancelled: "[CAN]",
  passthrough: "[PTH]",
  rejected_limit: "[LIM]",
};

const STATUS_COLORS: Readonly<Record<TaskStatus, string>> = {
  running: "\u001b[33m", // yellow
  completed: "\u001b[32m", // green
  error: "\u001b[31m", // red
  killed: "\u001b[35m", // magenta
  killed_on_disconnect: "\u001b[35m",
  cancelled: "\u001b[90m", // dim
  passthrough: "\u001b[36m", // cyan
  rejected_limit: "\u001b[31m",
};

const ANSI_RESET = "\u001b[0m";

function shouldColor(opts: FormatOptions): boolean {
  if (opts.color !== true) return false;
  const noColor = process.env["NO_COLOR"];
  if (noColor !== undefined && noColor.length > 0) return false;
  return true;
}

// -----------------------------------------------------------------------------
// formatStatus
// -----------------------------------------------------------------------------

export function formatStatus(status: TaskStatus, opts: FormatOptions = {}): string {
  const tag = STATUS_TAGS[status] ?? "[???]";
  const label = `${tag} ${status}`;
  if (!shouldColor(opts)) return label;
  const color = STATUS_COLORS[status] ?? "";
  return `${color}${label}${ANSI_RESET}`;
}

// -----------------------------------------------------------------------------
// formatDuration — compact human form
// -----------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "0s";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h${minutes}m`;
  if (minutes > 0) return `${minutes}m${seconds}s`;
  return `${seconds}s`;
}

// -----------------------------------------------------------------------------
// Truncation helper
// -----------------------------------------------------------------------------

function truncate(input: string, max: number): string {
  if (input.length <= max) return input;
  return `${input.slice(0, max - 1)}\u2026`;
}

function padRight(input: string, width: number): string {
  if (input.length >= width) return input;
  return input + " ".repeat(width - input.length);
}

// -----------------------------------------------------------------------------
// Task line + detail + header
// -----------------------------------------------------------------------------

function resolveAgent(state: TaskState): string {
  const meta = state.meta as Record<string, unknown>;
  const agent = meta["agent"] ?? meta["agent_name"];
  if (typeof agent === "string" && agent.length > 0) return agent;
  return "<unknown>";
}

function resolveDurationMs(state: TaskState): number {
  const end = state.completed_at ?? Date.now();
  return Math.max(0, end - state.started_at);
}

export function formatTaskListHeader(opts: FormatOptions = {}): string {
  const parts = [
    padRight("ID", COL_ID_WIDTH),
    padRight("STATUS", COL_STATUS_WIDTH),
    padRight("DURATION", COL_DURATION_WIDTH),
    "AGENT",
  ];
  const line = parts.join("  ");
  if (!shouldColor(opts)) return line;
  return `\u001b[1m${line}${ANSI_RESET}`;
}

export function formatTaskLine(state: TaskState, opts: FormatOptions = {}): string {
  const id = padRight(state.id, COL_ID_WIDTH);
  const statusText = shouldColor(opts)
    ? formatStatus(state.status, opts)
    : padRight(state.status, COL_STATUS_WIDTH);
  const duration = padRight(formatDuration(resolveDurationMs(state)), COL_DURATION_WIDTH);
  const agent = truncate(resolveAgent(state), COL_AGENT_MAX);
  return `${id}  ${statusText}  ${duration}  ${agent}`;
}

export function formatTaskDetail(state: TaskState, opts: FormatOptions = {}): string {
  const lines: string[] = [];
  lines.push(`id:       ${state.id}`);
  lines.push(`status:   ${formatStatus(state.status, opts)}`);
  lines.push(`agent:    ${resolveAgent(state)}`);
  lines.push(`started:  ${new Date(state.started_at).toISOString()}`);
  if (state.completed_at !== undefined) {
    lines.push(`completed:${new Date(state.completed_at).toISOString()}`);
  }
  lines.push(`duration: ${formatDuration(resolveDurationMs(state))}`);
  if (state.result !== undefined) {
    lines.push(`result:   ${safeStringify(state.result)}`);
  }
  if (state.error !== undefined) {
    lines.push(`error:    ${state.error.message}`);
    if (typeof state.error.stack === "string") {
      lines.push(`stack:    ${state.error.stack.split("\n")[0] ?? ""}`);
    }
  }
  const metaKeys = Object.keys(state.meta).filter((k) => k !== "agent" && k !== "agent_name");
  if (metaKeys.length > 0) {
    lines.push("meta:");
    for (const key of metaKeys) {
      lines.push(`  ${key}: ${safeStringify((state.meta as Record<string, unknown>)[key])}`);
    }
  }
  return lines.join("\n");
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// -----------------------------------------------------------------------------
// Error formatting
// -----------------------------------------------------------------------------

export function formatError(err: Error, opts: FormatOptions = {}): string {
  const code = (err as unknown as { code?: unknown }).code;
  const tag = typeof code === "string" && code.length > 0 ? code : err.name;
  const head = `[${tag}] ${err.message}`;
  const stackLine = typeof err.stack === "string" ? err.stack.split("\n")[1] : undefined;
  const trimmed = stackLine !== undefined ? stackLine.trim() : "";
  const out = trimmed.length > 0 ? `${head}\n  ${trimmed}` : head;
  if (!shouldColor(opts)) return out;
  return `\u001b[31m${out}${ANSI_RESET}`;
}
