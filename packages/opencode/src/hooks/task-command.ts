/**
 * Thin parser + dispatcher for the `/task` slash-command family.
 *
 * Delegates all business logic to core's pure command impls
 * (`listCommand | showCommand | killCommand | logsCommand`). The adapter
 * layer parses OpenCode-flavored input (subcmd + args array) and hands off.
 *
 * Batch 9 polish: --agent, --since, --no-color flags; structured ParseError.
 *
 * FR-7.
 */
import type {
  CommandResult,
  CommandStdout,
  FormatOptions,
  HistoryStore,
  TaskRegistry,
  TaskState,
} from "@maicolextic/bg-subagents-core";
import {
  killCommand,
  listCommand,
  logsCommand,
  showCommand,
} from "@maicolextic/bg-subagents-core";
import type { TaskStatus } from "@maicolextic/bg-subagents-protocol";

export interface TaskCommandDeps {
  readonly registry: TaskRegistry;
  readonly history: HistoryStore;
  readonly stdout: CommandStdout;
  readonly format?: FormatOptions;
}

export type TaskSubcommand = "list" | "show" | "kill" | "logs" | "help";

export interface ParsedFlags {
  readonly status?: TaskStatus;
  readonly tail?: number;
  /** Filter list by spawning-agent name (case-insensitive substring match). */
  readonly agent?: string;
  /**
   * Filter list to tasks created on or after this timestamp (ms since epoch).
   * Derived from `--since=<ISO-8601 | duration like 1h|30m|7d>`.
   */
  readonly sinceMs?: number;
  /** When true, ANSI colors should be suppressed (--no-color). */
  readonly noColor?: boolean;
}

export interface ParseError {
  readonly flag: string;
  readonly reason: string;
}

export interface ParseResult {
  readonly subcmd: TaskSubcommand;
  readonly positional: readonly string[];
  readonly flags: ParsedFlags;
  /** Non-empty when one or more flags failed validation. */
  readonly errors: readonly ParseError[];
}

const KNOWN_STATUSES = new Set<string>([
  "running",
  "completed",
  "killed",
  "killed_on_disconnect",
  "error",
  "cancelled",
  "passthrough",
  "rejected_limit",
]);

// -----------------------------------------------------------------------------
// Duration parsing: supports ISO-8601 and shorthand like 1h, 30m, 7d, 60s
// -----------------------------------------------------------------------------

function parseSince(raw: string): { ms: number } | { error: string } {
  // Try shorthand suffix first: <number><s|m|h|d>
  const match = /^(\d+(?:\.\d+)?)(s|m|h|d)$/.exec(raw.trim());
  if (match !== null) {
    const n = Number(match[1]);
    const unit = match[2] as "s" | "m" | "h" | "d";
    const multipliers: Record<"s" | "m" | "h" | "d", number> = {
      s: 1_000,
      m: 60_000,
      h: 3_600_000,
      d: 86_400_000,
    };
    const offsetMs = n * multipliers[unit];
    return { ms: Date.now() - offsetMs };
  }
  // Try ISO-8601 / any Date-parseable string
  const ts = new Date(raw).getTime();
  if (!Number.isNaN(ts)) return { ms: ts };
  return { error: `Cannot parse "${raw}" as ISO-8601 or duration (e.g. 1h, 30m, 7d)` };
}

// -----------------------------------------------------------------------------
// Flag parser
// -----------------------------------------------------------------------------

export function parseTaskCommand(
  subcmd: string,
  args: readonly string[],
): ParseResult {
  const normalized = (subcmd || "help").toLowerCase();
  const sub: TaskSubcommand =
    normalized === "list" ||
    normalized === "show" ||
    normalized === "kill" ||
    normalized === "logs"
      ? normalized
      : "help";

  const flags: {
    status?: TaskStatus;
    tail?: number;
    agent?: string;
    sinceMs?: number;
    noColor?: boolean;
  } = {};
  const positional: string[] = [];
  const errors: ParseError[] = [];

  for (const raw of args) {
    // --status=<value>
    if (raw.startsWith("--status=")) {
      const val = raw.slice("--status=".length);
      if (KNOWN_STATUSES.has(val)) {
        flags.status = val as TaskStatus;
      } else {
        errors.push({
          flag: "--status",
          reason: `Unknown status "${val}". Valid: ${[...KNOWN_STATUSES].join(", ")}`,
        });
      }
      continue;
    }

    // --tail=<N>
    if (raw.startsWith("--tail=")) {
      const rawVal = raw.slice("--tail=".length);
      const n = Number.parseInt(rawVal, 10);
      if (!Number.isFinite(n) || rawVal.trim() !== String(n)) {
        errors.push({ flag: "--tail", reason: `"${rawVal}" is not a valid integer` });
      } else if (n < 0) {
        errors.push({ flag: "--tail", reason: `Value must be >= 0, got ${n}` });
      } else {
        flags.tail = n;
      }
      continue;
    }

    // --agent=<name>
    if (raw.startsWith("--agent=")) {
      const val = raw.slice("--agent=".length);
      if (val.length > 0) {
        flags.agent = val;
      } else {
        errors.push({ flag: "--agent", reason: "Value must not be empty" });
      }
      continue;
    }

    // --since=<ISO-8601 | duration>
    if (raw.startsWith("--since=")) {
      const val = raw.slice("--since=".length);
      const result = parseSince(val);
      if ("error" in result) {
        errors.push({ flag: "--since", reason: result.error });
      } else {
        flags.sinceMs = result.ms;
      }
      continue;
    }

    // --no-color
    if (raw === "--no-color") {
      flags.noColor = true;
      continue;
    }

    positional.push(raw);
  }

  return {
    subcmd: sub,
    positional,
    flags,
    errors,
  };
}

// -----------------------------------------------------------------------------
// Dispatcher
// -----------------------------------------------------------------------------

export async function handleTaskSlashCommand(
  subcmd: string,
  args: readonly string[],
  deps: TaskCommandDeps,
): Promise<CommandResult> {
  const parsed = parseTaskCommand(subcmd, args);
  const { registry, history, stdout, format } = deps;

  // --no-color overrides whatever the caller passed in format.
  const colorOverride = parsed.flags.noColor === true ? false : undefined;
  const fmt: FormatOptions = {
    ...(format ?? {}),
    ...(colorOverride !== undefined ? { color: colorOverride } : {}),
  };

  switch (parsed.subcmd) {
    case "list": {
      const { agent: agentFilter, sinceMs, status } = parsed.flags;
      const hasClientFilter = agentFilter !== undefined || sinceMs !== undefined;

      // For --agent / --since: wrap the registry so its `.list()` applies
      // client-side predicates after the core status filter runs.
      const effectiveRegistry =
        hasClientFilter ? wrapRegistryWithPredicate(registry, agentFilter, sinceMs) : registry;

      return listCommand({
        registry: effectiveRegistry,
        history,
        stdout,
        format: fmt,
        ...(status !== undefined ? { filter: { status } } : {}),
      });
    }

    case "show": {
      const id = parsed.positional[0];
      if (id === undefined || id.length === 0) {
        stdout.write("Usage: /task show <id>\n");
        return { exit_code: 1 };
      }
      return showCommand({ registry, history, stdout, id, format: fmt });
    }

    case "kill": {
      const id = parsed.positional[0];
      if (id === undefined || id.length === 0) {
        stdout.write("Usage: /task kill <id>\n");
        return { exit_code: 1 };
      }
      return killCommand({ registry, stdout, id, format: fmt });
    }

    case "logs": {
      const id = parsed.positional[0];
      if (id === undefined || id.length === 0) {
        stdout.write("Usage: /task logs <id> [--tail=N]\n");
        return { exit_code: 1 };
      }
      return logsCommand({
        history,
        stdout,
        id,
        ...(parsed.flags.tail !== undefined ? { tail: parsed.flags.tail } : {}),
      });
    }

    case "help":
    default:
      stdout.write(
        "Usage:\n" +
          "  /task list [--status=<status>] [--agent=<name>] [--since=<ISO|duration>] [--no-color]\n" +
          "  /task show <id>\n" +
          "  /task kill <id>\n" +
          "  /task logs <id> [--tail=N]\n",
      );
      return { exit_code: 0 };
  }
}

// -----------------------------------------------------------------------------
// Client-side predicate wrapper for --agent / --since filters.
// Wraps registry.list() post-filter so core's listCommand stays untouched.
// -----------------------------------------------------------------------------

function resolveAgentName(state: TaskState): string {
  const meta = state.meta as Record<string, unknown>;
  const v = meta["agent"] ?? meta["agent_name"];
  return typeof v === "string" ? v : "";
}

function wrapRegistryWithPredicate(
  base: TaskRegistry,
  agentFilter: string | undefined,
  sinceMs: number | undefined,
): TaskRegistry {
  // Proxy: delegate everything to `base`, override `.list()`.
  const proxy = Object.create(base) as TaskRegistry;
  proxy.list = (filter) => {
    const all = base.list(filter);
    return all.filter((s) => {
      if (agentFilter !== undefined) {
        const name = resolveAgentName(s).toLowerCase();
        if (!name.includes(agentFilter.toLowerCase())) return false;
      }
      if (sinceMs !== undefined && s.started_at < sinceMs) return false;
      return true;
    });
  };
  return proxy;
}

// -----------------------------------------------------------------------------
// Exported helpers for testing internals
// -----------------------------------------------------------------------------

export { parseSince };
