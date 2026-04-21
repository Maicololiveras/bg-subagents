/**
 * Append-only JSONL history with gzip rotation + retention GC.
 *
 * Design §3.4 + §5.2 — 10 MB rotation threshold (configurable) and 30-day
 * retention (configurable). Every write is serialised through an internal
 * single-slot queue so concurrent `append` + `rotate` never race.
 *
 * File layout (a single directory per deployment):
 *   history.jsonl                                 active append target
 *   history-YYYYMMDD-HHMMSS-SSS.jsonl.gz          rotated archive (1 per cycle)
 *
 * Windows-safe filenames: timestamps use `-` only (no `:` / `.` separators).
 *
 * Line discipline: each `append` writes ONE `JSON.stringify(evt) + "\n"` to
 * the active file via `fs.promises.appendFile` which issues a single
 * `fs.write` syscall — atomic per call on all supported platforms. On top of
 * that, the queue ensures a single in-flight write at a time per store
 * instance, so callers from different async contexts never interleave.
 */
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";
import { dirname, join, basename } from "node:path";
import type { TaskStatus } from "@maicolextic/bg-subagents-protocol";

// -----------------------------------------------------------------------------
// Event shape — kept local to avoid coupling the protocol package to disk
// concerns. If adapters need this shape over the wire, migrate it into protocol
// via a MINOR bump.
// -----------------------------------------------------------------------------

export type HistoryEvent =
  | {
      readonly type: "spawn";
      readonly task_id: string;
      readonly ts: number;
      readonly meta: Readonly<Record<string, unknown>>;
    }
  | {
      readonly type: "transition";
      readonly task_id: string;
      readonly from: TaskStatus;
      readonly to: TaskStatus;
      readonly ts: number;
    }
  | {
      readonly type: "progress";
      readonly task_id: string;
      readonly message: string;
      readonly ts: number;
    }
  | {
      readonly type: "complete";
      readonly task_id: string;
      readonly status: TaskStatus;
      readonly result?: unknown;
      readonly error?: { readonly message: string; readonly stack?: string };
      readonly ts: number;
    };

export interface HistoryReadFilter {
  readonly since?: number;
  readonly until?: number;
  readonly status?: TaskStatus;
}

export interface HistoryStoreOptions {
  readonly path: string;
  /** Rotate when active file ≥ max_bytes. Default 10 MB. */
  readonly max_bytes?: number;
  /** Retention (days) for rotated archives. Default 30. */
  readonly retention_days?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;
const DEFAULT_RETENTION_DAYS = 30;

export class HistoryStore {
  readonly #path: string;
  readonly #maxBytes: number;
  readonly #retentionDays: number;

  // Serialises write/rotation work onto a single tail promise.
  #queue: Promise<unknown> = Promise.resolve();
  #rotating = false;
  #directoryEnsured = false;

  constructor(opts: HistoryStoreOptions) {
    this.#path = opts.path;
    this.#maxBytes = opts.max_bytes ?? DEFAULT_MAX_BYTES;
    this.#retentionDays = opts.retention_days ?? DEFAULT_RETENTION_DAYS;
  }

  /** Absolute path to the active history file. */
  path(): string {
    return this.#path;
  }

  /** Enqueue an append. Resolves after the write hits the queue head. */
  async append(evt: HistoryEvent): Promise<void> {
    await this.#enqueue(async () => {
      await this.#ensureDirectory();
      const line = `${JSON.stringify(evt)}\n`;
      await appendFile(this.#path, line, "utf8");
      await this.#maybeRotate();
    });
  }

  /**
   * Force a rotation: gzip the active file to a timestamped sibling and start
   * fresh. No-op when the active file is missing or empty.
   */
  async rotate(): Promise<void> {
    await this.#enqueue(async () => {
      await this.#rotateNow();
    });
  }

  /** Drain any pending auto-rotate work scheduled by prior appends. */
  async flushRotation(): Promise<void> {
    await this.#enqueue(async () => undefined);
  }

  /** Read + optionally filter historical events. Skips malformed lines. */
  async read(filter: HistoryReadFilter = {}): Promise<HistoryEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.#path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
    const lines = raw.split("\n");
    const out: HistoryEvent[] = [];
    for (const line of lines) {
      if (line.length === 0) continue;
      let parsed: HistoryEvent;
      try {
        parsed = JSON.parse(line) as HistoryEvent;
      } catch {
        // eslint-disable-next-line no-console
        console.warn(
          `[bg-subagents] skipping malformed history line: ${line.slice(0, 80)}…`,
        );
        continue;
      }
      if (!this.#matchFilter(parsed, filter)) continue;
      out.push(parsed);
    }
    return out;
  }

  /** Delete rotated `.jsonl.gz` archives older than `retention_days`. */
  async gc(opts: { readonly retention_days?: number } = {}): Promise<number> {
    const threshold = Date.now() - (opts.retention_days ?? this.#retentionDays) *
      24 * 60 * 60 * 1000;
    const dir = dirname(this.#path);
    let deleted = 0;
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return 0;
      throw err;
    }
    for (const name of entries) {
      if (!name.endsWith(".jsonl.gz")) continue;
      const full = join(dir, name);
      const st = await stat(full);
      if (st.mtimeMs < threshold) {
        await rm(full, { force: true });
        deleted += 1;
      }
    }
    return deleted;
  }

  /** Drain pending work and release any held resources. */
  async close(): Promise<void> {
    await this.#enqueue(async () => undefined);
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  #enqueue<T>(work: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(work, work);
    // Track the tail; suppress the rejection on the chain so one failing task
    // doesn't permanently poison subsequent writes.
    this.#queue = next.catch(() => undefined);
    return next;
  }

  async #ensureDirectory(): Promise<void> {
    if (this.#directoryEnsured) return;
    await mkdir(dirname(this.#path), { recursive: true });
    this.#directoryEnsured = true;
  }

  async #maybeRotate(): Promise<void> {
    if (this.#rotating) return;
    let st;
    try {
      st = await stat(this.#path);
    } catch {
      return;
    }
    if (st.size >= this.#maxBytes) {
      await this.#rotateNow();
    }
  }

  async #rotateNow(): Promise<void> {
    if (this.#rotating) return;
    this.#rotating = true;
    try {
      let st;
      try {
        st = await stat(this.#path);
      } catch {
        return;
      }
      if (st.size === 0) return;
      const stamp = this.#timestamp();
      const dir = dirname(this.#path);
      const base = basename(this.#path, ".jsonl");
      const rotatedJsonl = join(dir, `${base}-${stamp}.jsonl`);
      const rotatedGz = `${rotatedJsonl}.gz`;
      await rename(this.#path, rotatedJsonl);
      // Start a fresh, empty active file immediately so subsequent consumers
      // (callers doing `fs.stat(path)` right after rotation) don't hit ENOENT.
      await writeFile(this.#path, "", "utf8");
      await pipeline(
        createReadStream(rotatedJsonl),
        createGzip(),
        createWriteStream(rotatedGz),
      );
      await rm(rotatedJsonl, { force: true });
    } finally {
      this.#rotating = false;
    }
  }

  #timestamp(): string {
    const now = new Date();
    const yyyy = now.getUTCFullYear().toString().padStart(4, "0");
    const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = now.getUTCDate().toString().padStart(2, "0");
    const hh = now.getUTCHours().toString().padStart(2, "0");
    const mi = now.getUTCMinutes().toString().padStart(2, "0");
    const ss = now.getUTCSeconds().toString().padStart(2, "0");
    const ms = now.getUTCMilliseconds().toString().padStart(3, "0");
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}-${ms}`;
  }

  #matchFilter(evt: HistoryEvent, filter: HistoryReadFilter): boolean {
    if (filter.since !== undefined && evt.ts < filter.since) return false;
    if (filter.until !== undefined && evt.ts > filter.until) return false;
    if (filter.status !== undefined) {
      if (evt.type !== "complete") return false;
      if (evt.status !== filter.status) return false;
    }
    return true;
  }
}
