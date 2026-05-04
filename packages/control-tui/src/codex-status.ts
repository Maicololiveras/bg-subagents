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

interface CodexStatusPty {
  onData: (callback: (data: string) => void) => { dispose: () => void };
  onExit: (callback: (event: { exitCode: number }) => void) => { dispose: () => void };
  kill: () => void;
}

type CodexStatusPtySpawn = (
  file: string,
  args: string[],
  options: {
    name: string;
    cols: number;
    rows: number;
    cwd: string;
    env: NodeJS.ProcessEnv;
  },
) => CodexStatusPty;

export type CodexStatusPtyFactory = () => Promise<CodexStatusPtySpawn> | CodexStatusPtySpawn;

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

export function stripAnsiForCodexStatus(text: string): string {
  return text
    .replace(/\x1B\][^\x07]*(?:\x07|\x1B\\)/g, "")
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
    .replace(/\x1B[()][A-Za-z0-9]/g, "")
    .replace(/\r/g, "\n")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

function hasCompleteCodexStatus(stdout: string): boolean {
  const clean = stripAnsiForCodexStatus(stdout);
  return Boolean(
    firstMatch(clean, /Model:\s+(.*)/) &&
      firstMatch(clean, /Account:\s+([^\s]+)/) &&
      firstMatch(clean, /Session:\s+([^\s]+)/) &&
      percentMatch(clean, /Context window:\s+(\d+)%/) &&
      percentMatch(clean, /5h limit:.*?\s+(\d+)%/) &&
      percentMatch(clean, /Weekly limit:.*?\s+(\d+)%/),
  );
}

export function parseCodexStatus(stdout: string, now = new Date()): CodexStatusSnapshot {
  const clean = stripAnsiForCodexStatus(stdout);
  const model = firstMatch(clean, /Model:\s+(.*)/);
  const account = firstMatch(clean, /Account:\s+([^\s]+)/);
  const session = firstMatch(clean, /Session:\s+([^\s]+)/);
  const usage: CodexStatusSnapshot["usage"] = {};
  const contextAvailable = percentMatch(clean, /Context window:\s+(\d+)%/);
  const limit5h = percentMatch(clean, /5h limit:.*?\s+(\d+)%/);
  const weeklyLimit = percentMatch(clean, /Weekly limit:.*?\s+(\d+)%/);
  if (contextAvailable) usage.contextAvailable = contextAvailable;
  if (limit5h) usage.limit5h = limit5h;
  if (weeklyLimit) usage.weeklyLimit = weeklyLimit;

  const snapshot: CodexStatusSnapshot = {
    timestamp: now.toISOString(),
    usage,
    raw: clean,
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

async function loadNodePtySpawn(): Promise<CodexStatusPtySpawn> {
  try {
    const nodePty = await import("node-pty");
    return nodePty.spawn as CodexStatusPtySpawn;
  } catch (err) {
    throw new Error("codex /status unavailable: node-pty could not be loaded", { cause: err });
  }
}

export function createCodexStatusExecutor(
  timeoutMs = 4000,
  ptyFactory: CodexStatusPtyFactory = loadNodePtySpawn,
): CodexStatusExecutor {
  let currentPty: CodexStatusPty | undefined;
  let currentCancel: (() => void) | undefined;
  const executor: CodexStatusExecutor = () =>
    new Promise((resolve, reject) => {
      let pty: CodexStatusPty | undefined;
      let output = "";
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;
      let dataSubscription: { dispose: () => void } | undefined;
      let exitSubscription: { dispose: () => void } | undefined;
      let cancel: (() => void) | undefined;

      const cleanup = () => {
        if (timeout) clearTimeout(timeout);
        dataSubscription?.dispose();
        exitSubscription?.dispose();
        if (currentPty === pty) currentPty = undefined;
        if (currentCancel === cancel) currentCancel = undefined;
      };

      const settle = (result: "resolve" | "reject", value: string | Error, kill = false) => {
        if (settled) return;
        settled = true;
        cleanup();
        if (kill) pty?.kill();
        if (result === "resolve") resolve(value as string);
        else reject(value);
      };

      timeout = setTimeout(() => {
        settle("reject", new Error("codex /status timed out"), true);
      }, timeoutMs);

      cancel = () => {
        if (pty) pty.kill();
        else settle("reject", new Error("codex /status cancelled"));
      };
      currentCancel = cancel;

      void (async () => {
        try {
          const spawnPty = await ptyFactory();
          if (settled) return;
          try {
            pty = spawnPty("codex", ["/status"], {
              name: process.platform === "win32" ? "xterm-256color" : "xterm-color",
              cols: 100,
              rows: 30,
              cwd: process.cwd(),
              env: process.env,
            });
          } catch (err) {
            throw new Error("codex /status unavailable: PTY could not be started", { cause: err });
          }
          currentPty = pty;
          dataSubscription = pty.onData((chunk) => {
            output += chunk;
            if (hasCompleteCodexStatus(output)) {
              settle("resolve", stripAnsiForCodexStatus(output), true);
            }
          });
          exitSubscription = pty.onExit(({ exitCode }) => {
            if (exitCode === 0) settle("resolve", stripAnsiForCodexStatus(output));
            else settle("reject", new Error(`codex /status exited with code ${exitCode}`));
          });
        } catch (err) {
          settle("reject", err instanceof Error ? err : new Error(String(err)));
        }
      })();
    });
  executor.cancel = () => currentCancel?.();
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
