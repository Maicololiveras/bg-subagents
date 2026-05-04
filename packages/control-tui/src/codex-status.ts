import { spawn } from "node:child_process";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CodexStatusSnapshot {
  timestamp: string;
  model?: string;
  account?: string;
  session?: string;
  usage: {
    contextAvailable?: string;
    limit5h?: string;
    weeklyLimit?: string;
  };
  raw: string;
  error?: string;
}

export interface CodexStatusLogger {
  warn?: (message: string, fields?: Record<string, unknown>) => void;
}

export type CodexStatusExecutor = (() => Promise<string>) & { cancel?: () => void };

export interface CodexStatusPollState {
  inFlight: boolean;
  snapshot?: CodexStatusSnapshot;
}

export interface CodexStatusMonitorOptions {
  intervalMs?: number;
  timeoutMs?: number;
  outputPath?: string;
  onSnapshot?: (snapshot: CodexStatusSnapshot) => void;
  logger?: CodexStatusLogger;
  executor?: CodexStatusExecutor;
}

export const CODEX_STATUS_PATH = join(
  homedir(),
  ".config",
  "bg-subagents",
  "codex_status.json",
);

function firstMatch(raw: string, pattern: RegExp): string | undefined {
  return raw.match(pattern)?.[1]?.trim();
}

function percentMatch(raw: string, pattern: RegExp): string | undefined {
  const value = firstMatch(raw, pattern);
  return value ? `${value}%` : undefined;
}

export function parseCodexStatus(stdout: string, now = new Date()): CodexStatusSnapshot {
  const model = firstMatch(stdout, /Model:\s+(.*)/);
  const account = firstMatch(stdout, /Account:\s+([^\s]+)/);
  const session = firstMatch(stdout, /Session:\s+([^\s]+)/);
  const usage: CodexStatusSnapshot["usage"] = {};
  const contextAvailable = percentMatch(stdout, /Context window:\s+(\d+)%/);
  const limit5h = percentMatch(stdout, /5h limit:.*?\s+(\d+)%/);
  const weeklyLimit = percentMatch(stdout, /Weekly limit:.*?\s+(\d+)%/);
  if (contextAvailable) usage.contextAvailable = contextAvailable;
  if (limit5h) usage.limit5h = limit5h;
  if (weeklyLimit) usage.weeklyLimit = weeklyLimit;

  const snapshot: CodexStatusSnapshot = {
    timestamp: now.toISOString(),
    usage,
    raw: stdout,
  };
  if (model) snapshot.model = model;
  if (account) snapshot.account = account;
  if (session) snapshot.session = session;
  return snapshot;
}

export function formatCodexStatusLines(snapshot?: CodexStatusSnapshot): string[] {
  if (!snapshot) return ["Codex status: esperando..."];
  if (snapshot.error) return ["Codex status: no disponible"];

  const model = snapshot.model ?? "codex";
  const context = snapshot.usage.contextAvailable;
  const limit5h = snapshot.usage.limit5h;
  const weekly = snapshot.usage.weeklyLimit;
  const first = context ? `${model} · ${context} ctx` : model;
  const second = [limit5h ? `5h ${limit5h}` : undefined, weekly ? `week ${weekly}` : undefined]
    .filter(Boolean)
    .join(" · ");

  return second ? [first, second] : [first];
}

export function writeCodexStatusSnapshot(
  snapshot: CodexStatusSnapshot,
  outputPath = CODEX_STATUS_PATH,
): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  const tmpPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  renameSync(tmpPath, outputPath);
}

export function createCodexStatusExecutor(timeoutMs = 4000): CodexStatusExecutor {
  let currentChild: ReturnType<typeof spawn> | undefined;
  const executor: CodexStatusExecutor = () =>
    new Promise((resolve, reject) => {
      const child = spawn("codex", ["/status"], { shell: false });
      currentChild = child;
      let stdout = "";
      let stderr = "";
      let settled = false;

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error("codex /status timed out"));
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });
      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        currentChild = undefined;
        reject(err);
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        currentChild = undefined;
        if (code === 0) {
          resolve(stdout);
        } else {
          reject(new Error(`codex /status exited with code ${code}: ${stderr.trim()}`));
        }
      });
    });
  executor.cancel = () => currentChild?.kill();
  return executor;
}

export async function runCodexStatusPoll(options: {
  state: CodexStatusPollState;
  executor: CodexStatusExecutor;
  outputPath?: string;
  onSnapshot?: (snapshot: CodexStatusSnapshot) => void;
  logger?: CodexStatusLogger;
  now?: Date;
}): Promise<CodexStatusSnapshot | undefined> {
  if (options.state.inFlight) return undefined;
  options.state.inFlight = true;

  try {
    const stdout = await options.executor();
    const snapshot = parseCodexStatus(stdout, options.now);
    options.state.snapshot = snapshot;
    writeCodexStatusSnapshot(snapshot, options.outputPath);
    options.onSnapshot?.(snapshot);
    return snapshot;
  } catch (err) {
    const snapshot: CodexStatusSnapshot = {
      timestamp: (options.now ?? new Date()).toISOString(),
      usage: {},
      raw: "",
      error: err instanceof Error ? err.message : String(err),
    };
    options.state.snapshot = snapshot;
    writeCodexStatusSnapshot(snapshot, options.outputPath);
    options.onSnapshot?.(snapshot);
    options.logger?.warn?.("codex status poll failed", { error: snapshot.error });
    return snapshot;
  } finally {
    options.state.inFlight = false;
  }
}

export function createCodexStatusMonitor(options: CodexStatusMonitorOptions = {}) {
  const intervalMs = options.intervalMs ?? 5000;
  const state: CodexStatusPollState = { inFlight: false };
  const executor = options.executor ?? createCodexStatusExecutor(options.timeoutMs ?? 4000);
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = true;

  const poll = async () => {
    const pollOptions: Parameters<typeof runCodexStatusPoll>[0] = {
      state,
      executor,
    };
    if (options.outputPath) pollOptions.outputPath = options.outputPath;
    if (options.onSnapshot) {
      pollOptions.onSnapshot = (snapshot) => {
        if (!stopped) options.onSnapshot?.(snapshot);
      };
    }
    if (options.logger) pollOptions.logger = options.logger;
    await runCodexStatusPoll(pollOptions);
    if (!stopped) timer = setTimeout(poll, intervalMs);
  };

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      void poll();
    },
    stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
      executor.cancel?.();
    },
    getSnapshot() {
      return state.snapshot;
    },
  };
}
