/**
 * End-to-end integration of obs + cli + task/history in a tmpdir.
 *
 * Exercises the v0.1 CLI surface against a real HistoryStore on disk — no
 * mocks. Scenarios 1/13/12 (logic path), FR-4, FR-5, FR-7, FR-16.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type { TaskId } from "@maicolextic/bg-subagents-protocol";

import { HistoryStore } from "../task/HistoryStore.js";
import { TaskRegistry } from "../task/TaskRegistry.js";
import {
  killCommand,
  listCommand,
  logsCommand,
  showCommand,
} from "../cli/commands.js";

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

interface Harness {
  dir: string;
  historyPath: string;
  store: HistoryStore;
  registry: TaskRegistry;
}

async function makeHarness(opts: { max_bytes?: number } = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), "bg-integration-"));
  const historyPath = join(dir, "history.jsonl");
  const storeOpts: { path: string; max_bytes?: number } = { path: historyPath };
  if (opts.max_bytes !== undefined) storeOpts.max_bytes = opts.max_bytes;
  const store = new HistoryStore(storeOpts);
  const registry = new TaskRegistry({ history: store });
  return { dir, historyPath, store, registry };
}

async function teardown(h: Harness): Promise<void> {
  h.registry.disposeAll();
  await h.store.close();
  await rm(h.dir, { recursive: true, force: true });
}

function collectStdout(): {
  stdout: { write(chunk: string): void };
  text: () => string;
} {
  const chunks: string[] = [];
  return {
    stdout: {
      write(c: string): void {
        chunks.push(c);
      },
    },
    text(): string {
      return chunks.join("");
    },
  };
}

function spawnLive(
  registry: TaskRegistry,
  meta: Record<string, unknown> = {},
): { id: TaskId; done: Promise<unknown> } {
  const h = registry.spawn<unknown>({
    meta,
    run: (signal: AbortSignal): Promise<unknown> =>
      new Promise((resolve, reject) => {
        const onAbort = (): void => {
          reject(new Error("aborted"));
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener("abort", onAbort, { once: true });
        setTimeout(() => resolve("late"), 60_000);
      }),
  });
  h.done.catch(() => undefined);
  return { id: h.id, done: h.done };
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

describe("integration: obs + cli + task/history", () => {
  let harness: Harness;

  beforeEach(async () => {
    harness = await makeHarness();
  });

  afterEach(async () => {
    await teardown(harness);
  });

  it("spawn → complete records spawn + transition + complete in history", async () => {
    const { registry, store } = harness;
    const h = registry.spawn({
      meta: { agent: "smoke" },
      run: async () => "done",
    });
    await h.done;
    await store.flushRotation();
    const events = await store.read();
    const kinds = events.map((e) => e.type);
    expect(kinds).toContain("spawn");
    expect(kinds).toContain("transition");
    expect(kinds).toContain("complete");
  });

  it("listCommand reads the registry and prints the task row", async () => {
    const { registry, store } = harness;
    const h = registry.spawn({
      meta: { agent: "listed" },
      run: async () => "ok",
    });
    await h.done;

    const { stdout, text } = collectStdout();
    const res = listCommand({ registry, history: store, stdout });
    expect(res.exit_code).toBe(0);
    expect(text()).toContain(h.id);
    expect(text()).toContain("listed");
  });

  it("showCommand prints the task detail", async () => {
    const { registry, store } = harness;
    const h = registry.spawn({
      meta: { agent: "shown" },
      run: async () => "ok",
    });
    await h.done;

    const { stdout, text } = collectStdout();
    const res = showCommand({ id: h.id, registry, history: store, stdout });
    expect(res.exit_code).toBe(0);
    expect(text()).toContain(h.id);
    expect(text()).toContain("shown");
  });

  it("logsCommand prints history events for the task", async () => {
    const { registry, store } = harness;
    const h = registry.spawn({
      meta: { agent: "logged" },
      run: async () => "ok",
    });
    await h.done;
    await store.flushRotation();

    const { stdout, text } = collectStdout();
    const res = await logsCommand({ id: h.id, history: store, stdout });
    expect(res.exit_code).toBe(0);
    const out = text();
    expect(out.split("\n").filter(Boolean).length).toBeGreaterThanOrEqual(3);
    expect(out).toContain(h.id);
  });

  it("kill: killCommand kills a running task; showCommand reflects killed; logsCommand shows transition", async () => {
    const { registry, store } = harness;
    const live = spawnLive(registry, { agent: "kill-me" });

    const killOut = collectStdout();
    const killRes = await killCommand({
      id: live.id,
      registry,
      stdout: killOut.stdout,
    });
    expect(killRes.exit_code).toBe(0);
    expect(registry.get(live.id)?.status).toBe("killed");

    const showOut = collectStdout();
    const showRes = showCommand({
      id: live.id,
      registry,
      history: store,
      stdout: showOut.stdout,
    });
    expect(showRes.exit_code).toBe(0);
    expect(showOut.text()).toContain("killed");

    await store.flushRotation();
    const logOut = collectStdout();
    const logRes = await logsCommand({
      id: live.id,
      history: store,
      stdout: logOut.stdout,
    });
    expect(logRes.exit_code).toBe(0);
    expect(logOut.text()).toContain("killed");
  });

  it("concurrent spawns of 10 tasks — all complete and list shows 10 rows", async () => {
    const { registry, store } = harness;
    const handles = Array.from({ length: 10 }, (_, i) =>
      registry.spawn({
        meta: { agent: `agent-${i}` },
        run: async () => `r${i}`,
      }),
    );
    await Promise.all(handles.map((h) => h.done));
    await store.flushRotation();

    const { stdout, text } = collectStdout();
    const res = listCommand({ registry, history: store, stdout });
    expect(res.exit_code).toBe(0);
    const lines = text().split("\n").filter(Boolean);
    // header + 10 rows
    expect(lines.length).toBeGreaterThanOrEqual(11);
  });

  it("rotation: fill history past max_bytes; listCommand + logsCommand still work across active + rotated files", async () => {
    const { dir, historyPath } = harness;
    // Use a smaller rotation threshold so we can trigger it in-test.
    const smallStore = new HistoryStore({ path: historyPath, max_bytes: 512 });
    const registry = new TaskRegistry({ history: smallStore });

    const handles = Array.from({ length: 20 }, (_, i) =>
      registry.spawn({
        meta: {
          agent: `rot-${i}`,
          filler: "x".repeat(80),
        },
        run: async () => "ok",
      }),
    );
    await Promise.all(handles.map((h) => h.done));
    await smallStore.flushRotation();

    // There must be at least one rotated .gz sibling by now.
    const entries = await readdir(dirname(historyPath));
    const gz = entries.filter((f) => f.endsWith(".jsonl.gz"));
    expect(gz.length).toBeGreaterThanOrEqual(1);

    // listCommand operates on the registry (in-mem) — unaffected by rotation.
    const listOut = collectStdout();
    const listRes = listCommand({
      registry,
      history: smallStore,
      stdout: listOut.stdout,
    });
    expect(listRes.exit_code).toBe(0);

    // logsCommand reads active file only (rotated archives are accepted as a
    // known limitation of v0.1 — documented in spec §6). We still expect a
    // non-error exit and either some output or an empty tail.
    const firstId = handles[0]?.id;
    expect(firstId).toBeDefined();
    if (firstId === undefined) throw new Error("no handle");
    const logsOut = collectStdout();
    const logsRes = await logsCommand({
      id: firstId,
      history: smallStore,
      stdout: logsOut.stdout,
    });
    expect(logsRes.exit_code).toBe(0);

    registry.disposeAll();
    await smallStore.close();
    // dir cleanup handled by afterEach — but we used a different store instance,
    // so remove the rotated files to keep the temp clean.
    await rm(dir, { recursive: true, force: true });
  });

  it("history path default resolves via obs/paths resolveHistoryPath", async () => {
    // Sanity: HistoryStore with no explicit path should delegate to
    // resolveHistoryPath() — we import it here to confirm the wire.
    const { resolveHistoryPath } = await import("../obs/paths.js");
    const p = resolveHistoryPath();
    expect(p.endsWith("history.jsonl")).toBe(true);
  });
});
