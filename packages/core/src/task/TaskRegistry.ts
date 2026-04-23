/**
 * In-memory task registry.
 *
 * Design §3.3. Keeps a `Map<TaskId, TaskState>` that reflects the live state
 * machine, emits `onComplete` / `onProgress` via `node:events`, and bridges
 * cancellation through a per-task `AbortController`. Optional integration
 * with a `HistoryStore` — when present, the registry mirrors spawn /
 * transition / progress / complete events onto history.
 */
import { EventEmitter } from "node:events";
import type { TaskId, TaskStatus } from "@maicolextic/bg-subagents-protocol";
import { generateTaskId } from "./id.js";
import {
  assertTransition,
  InvalidTransitionError,
  isTerminal,
} from "./lifecycle.js";
import type { HistoryEvent, HistoryStore } from "./HistoryStore.js";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface TaskState {
  readonly id: TaskId;
  readonly status: TaskStatus;
  readonly meta: Readonly<Record<string, unknown>>;
  readonly started_at: number;
  readonly completed_at?: number;
  readonly result?: unknown;
  readonly error?: { readonly message: string; readonly stack?: string };
}

export type ProgressFn = (message: string) => void;

export interface TaskSpec<T> {
  readonly id?: TaskId;
  readonly meta?: Readonly<Record<string, unknown>>;
  /**
   * Run callback. Receives the task's `AbortSignal` (propagated to dependents
   * when `kill()` is called) and an optional `progress` reporter.
   */
  run(signal: AbortSignal, progress: ProgressFn): Promise<T>;
}

export interface TaskHandle<T> {
  readonly id: TaskId;
  readonly done: Promise<T>;
  cancel(): void;
}

export interface CompletionEvent {
  readonly task_id: TaskId;
  readonly status: TaskStatus;
  readonly result?: unknown;
  readonly error?: { readonly message: string; readonly stack?: string };
  readonly ts: number;
}

export interface ProgressEvent {
  readonly task_id: TaskId;
  readonly message: string;
  readonly ts: number;
}

export type Unsubscribe = () => void;

export interface TaskRegistryOptions {
  readonly history?: Pick<HistoryStore, "append">;
}

export interface TaskListFilter {
  readonly status?: TaskStatus;
}

// Internal event names.
const COMPLETE_EVENT = "bg:complete";
const PROGRESS_EVENT = "bg:progress";

// -----------------------------------------------------------------------------
// Registry
// -----------------------------------------------------------------------------

interface InternalRecord {
  state: TaskState;
  abort: AbortController;
  /** Resolve the `done` promise externally so kill() can settle it. */
  resolve: (value: unknown) => void;
  reject: (err: unknown) => void;
  settled: boolean;
}

export class TaskRegistry {
  readonly #tasks = new Map<TaskId, InternalRecord>();
  readonly #emitter = new EventEmitter();
  readonly #history: Pick<HistoryStore, "append"> | undefined;
  /**
   * Task ids whose completion has already been delivered to the main chat.
   * Used by the delivery layer for single-delivery guarantee — primary and
   * fallback channels both call {@link markDelivered}; only the first wins.
   * Separate from task lifecycle state so it survives task gc.
   */
  readonly #delivered = new Set<TaskId>();

  constructor(opts: TaskRegistryOptions = {}) {
    this.#emitter.setMaxListeners(0);
    this.#history = opts.history;
  }

  /**
   * Atomically record that a task's completion has been delivered to the
   * main chat. Returns `true` the first time it is called for a given id
   * and `false` on every subsequent call. This enables primary + fallback
   * delivery paths to race safely — whichever arrives first wins, the
   * other no-ops.
   *
   * Accepts ids that were never spawned (defensive — spec allows this so
   * synthetic delivery paths don't need to round-trip through `spawn`).
   */
  markDelivered(id: TaskId): boolean {
    if (this.#delivered.has(id)) return false;
    this.#delivered.add(id);
    return true;
  }

  /** Start a task. Returns immediately; the task runs via the microtask queue. */
  spawn<T>(spec: TaskSpec<T>): TaskHandle<T> {
    const id = spec.id ?? generateTaskId();
    if (this.#tasks.has(id)) {
      throw new Error(`Task ${id} already exists in the registry.`);
    }
    const abort = new AbortController();
    const meta = Object.freeze({ ...(spec.meta ?? {}) });
    const started_at = Date.now();

    let resolve!: (value: unknown) => void;
    let reject!: (err: unknown) => void;
    const done = new Promise<T>((res, rej) => {
      resolve = res as (value: unknown) => void;
      reject = rej;
    });

    const record: InternalRecord = {
      state: {
        id,
        status: "running",
        meta,
        started_at,
      },
      abort,
      resolve,
      reject,
      settled: false,
    };
    this.#tasks.set(id, record);

    // Emit spawn history entry (best-effort — failures in history must not
    // tear down the registry or cancel the task).
    this.#writeHistory({ type: "spawn", task_id: id, ts: started_at, meta });

    const progress: ProgressFn = (message) => {
      const ts = Date.now();
      this.#emitter.emit(PROGRESS_EVENT, id, {
        task_id: id,
        message,
        ts,
      } satisfies ProgressEvent);
      this.#writeHistory({ type: "progress", task_id: id, message, ts });
    };

    // Run asynchronously so the handle is returned before the callback starts.
    queueMicrotask(() => {
      const promise = (async () => spec.run(abort.signal, progress))();
      promise.then(
        (value) => this.#settleSuccess(id, value),
        (err) => this.#settleError(id, err),
      );
    });

    return {
      id,
      done,
      cancel: () => {
        this.kill(id).catch(() => undefined);
      },
    };
  }

  get(id: TaskId): TaskState | undefined {
    return this.#tasks.get(id)?.state;
  }

  list(filter: TaskListFilter = {}): readonly TaskState[] {
    const out: TaskState[] = [];
    for (const rec of this.#tasks.values()) {
      if (filter.status !== undefined && rec.state.status !== filter.status) {
        continue;
      }
      out.push(rec.state);
    }
    return out;
  }

  size(): number {
    return this.#tasks.size;
  }

  async kill(id: TaskId): Promise<void> {
    const rec = this.#tasks.get(id);
    if (rec === undefined) return;
    if (rec.settled) return;
    try {
      assertTransition(rec.state.status, "killed", id);
    } catch (err) {
      // If the task is already settled to another terminal status, treat kill
      // as a no-op rather than propagating an InvalidTransitionError.
      if (err instanceof InvalidTransitionError && isTerminal(rec.state.status)) {
        return;
      }
      throw err;
    }
    const ts = Date.now();
    const next: TaskState = {
      ...rec.state,
      status: "killed",
      completed_at: ts,
    };
    rec.state = next;
    rec.settled = true;
    rec.abort.abort();
    const killError = new Error(`Task ${id} was killed`);
    rec.reject(killError);
    this.#writeHistory({
      type: "transition",
      task_id: id,
      from: "running",
      to: "killed",
      ts,
    });
    this.#writeHistory({
      type: "complete",
      task_id: id,
      status: "killed",
      ts,
    });
    this.#emitter.emit(COMPLETE_EVENT, {
      task_id: id,
      status: "killed",
      ts,
    } satisfies CompletionEvent);
  }

  onComplete(cb: (event: CompletionEvent) => void): Unsubscribe {
    const listener = (event: CompletionEvent): void => cb(event);
    this.#emitter.on(COMPLETE_EVENT, listener);
    return () => this.#emitter.off(COMPLETE_EVENT, listener);
  }

  onProgress(
    id: TaskId,
    cb: (event: ProgressEvent) => void,
  ): Unsubscribe {
    const listener = (evtId: TaskId, event: ProgressEvent): void => {
      if (evtId === id) cb(event);
    };
    this.#emitter.on(PROGRESS_EVENT, listener);
    return () => this.#emitter.off(PROGRESS_EVENT, listener);
  }

  /** Evict terminal tasks older than `olderThanMs`. Returns eviction count. */
  gc(opts: { readonly olderThanMs: number }): number {
    const cutoff = Date.now() - opts.olderThanMs;
    let evicted = 0;
    for (const [id, rec] of this.#tasks) {
      if (!isTerminal(rec.state.status)) continue;
      const completed = rec.state.completed_at ?? rec.state.started_at;
      if (completed <= cutoff) {
        this.#tasks.delete(id);
        evicted += 1;
      }
    }
    return evicted;
  }

  /** Drop all task records + listeners. Does NOT await in-flight callbacks. */
  disposeAll(): void {
    for (const rec of this.#tasks.values()) {
      if (!rec.settled) {
        rec.abort.abort();
        rec.settled = true;
        rec.reject(new Error(`Task ${rec.state.id} disposed`));
      }
    }
    this.#tasks.clear();
    this.#emitter.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  #settleSuccess(id: TaskId, value: unknown): void {
    const rec = this.#tasks.get(id);
    if (rec === undefined || rec.settled) return;
    const ts = Date.now();
    try {
      assertTransition(rec.state.status, "completed", id);
    } catch {
      return;
    }
    rec.state = {
      ...rec.state,
      status: "completed",
      completed_at: ts,
      result: value,
    };
    rec.settled = true;
    rec.resolve(value);
    this.#writeHistory({
      type: "transition",
      task_id: id,
      from: "running",
      to: "completed",
      ts,
    });
    this.#writeHistory({
      type: "complete",
      task_id: id,
      status: "completed",
      result: value,
      ts,
    });
    this.#emitter.emit(COMPLETE_EVENT, {
      task_id: id,
      status: "completed",
      result: value,
      ts,
    } satisfies CompletionEvent);
  }

  #settleError(id: TaskId, err: unknown): void {
    const rec = this.#tasks.get(id);
    if (rec === undefined || rec.settled) return;
    const ts = Date.now();
    try {
      assertTransition(rec.state.status, "error", id);
    } catch {
      return;
    }
    const baseError = {
      message: err instanceof Error ? err.message : String(err),
    };
    const stack =
      err instanceof Error && typeof err.stack === "string" ? err.stack : undefined;
    const error: NonNullable<CompletionEvent["error"]> =
      stack !== undefined ? { ...baseError, stack } : baseError;
    rec.state = {
      ...rec.state,
      status: "error",
      completed_at: ts,
      error,
    };
    rec.settled = true;
    rec.reject(err);
    this.#writeHistory({
      type: "transition",
      task_id: id,
      from: "running",
      to: "error",
      ts,
    });
    this.#writeHistory({
      type: "complete",
      task_id: id,
      status: "error",
      error,
      ts,
    });
    this.#emitter.emit(COMPLETE_EVENT, {
      task_id: id,
      status: "error",
      error,
      ts,
    } satisfies CompletionEvent);
  }

  #writeHistory(evt: HistoryEvent): void {
    if (this.#history === undefined) return;
    // Fire-and-forget: swallow history errors so registry semantics are
    // independent of disk availability.
    void this.#history.append(evt).catch(() => undefined);
  }
}
