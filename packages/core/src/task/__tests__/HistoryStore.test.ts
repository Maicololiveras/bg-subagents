/**
 * RED gate for `src/task/HistoryStore.ts`.
 *
 * Covers Batch 3 spec §1.d — append-only JSONL history with gzip rotation,
 * retention GC, Windows-safe filenames, and atomic per-line appends. Uses a
 * real temp dir (design Batch 3 note: "must verify gzip bytes").
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readdir, readFile, rm, stat, writeFile, utimes } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { HistoryStore, type HistoryEvent } from "../HistoryStore.js";

async function readAllText(filePath: string): Promise<string> {
  return (await readFile(filePath)).toString("utf8");
}

async function readGzipText(filePath: string): Promise<string> {
  return await new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    const stream = createReadStream(filePath).pipe(createGunzip());
    stream.on("data", (chunk: Buffer) => chunks.push(chunk));
    stream.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    stream.on("error", reject);
  });
}

function sampleEvent(overrides: Partial<HistoryEvent> = {}): HistoryEvent {
  return {
    type: "spawn",
    task_id: "tsk_AbCdEfGhIjKl",
    ts: Date.now(),
    meta: { agent: "code-researcher" },
    ...overrides,
  } as HistoryEvent;
}

describe("HistoryStore", () => {
  let dir: string;
  let path: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "bg-history-"));
    path = join(dir, "history.jsonl");
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("path() returns the resolved history path", () => {
    const store = new HistoryStore({ path });
    expect(store.path()).toBe(path);
  });

  it("append writes one JSON line to the active file", async () => {
    const store = new HistoryStore({ path });
    const evt = sampleEvent();
    await store.append(evt);
    await store.close();
    const text = await readAllText(path);
    expect(text.endsWith("\n")).toBe(true);
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0] ?? "") as HistoryEvent;
    expect(parsed.type).toBe("spawn");
    expect(parsed.task_id).toBe(evt.task_id);
  });

  it("serialises concurrent appends — each line is a complete JSON object", async () => {
    const store = new HistoryStore({ path });
    const ids = Array.from({ length: 50 }, (_, i) =>
      `tsk_${String(i).padStart(12, "A")}`.slice(0, 16),
    );
    await Promise.all(
      ids.map((task_id) =>
        store.append({
          type: "progress",
          task_id,
          message: `x`.repeat(200),
          ts: Date.now(),
        }),
      ),
    );
    await store.close();
    const text = await readAllText(path);
    const lines = text.trim().split("\n");
    expect(lines.length).toBe(50);
    for (const line of lines) {
      // Each line MUST be parseable — no partial/interleaved writes.
      const parsed = JSON.parse(line) as HistoryEvent;
      expect(parsed.type).toBe("progress");
    }
  });

  it("read() returns [] when the file does not exist", async () => {
    const store = new HistoryStore({ path });
    const res = await store.read();
    expect(res).toEqual([]);
    await store.close();
  });

  it("read() returns parsed entries; filter: since/until/status narrows", async () => {
    const store = new HistoryStore({ path });
    await store.append({ type: "spawn", task_id: "tsk_AaAaAaAaAaAa", ts: 1000, meta: {} });
    await store.append({
      type: "transition",
      task_id: "tsk_AaAaAaAaAaAa",
      from: "running",
      to: "completed",
      ts: 2000,
    });
    await store.append({
      type: "complete",
      task_id: "tsk_AaAaAaAaAaAa",
      status: "completed",
      ts: 3000,
    });
    await store.close();

    const all = await store.read();
    expect(all.length).toBe(3);
    const since = await store.read({ since: 1500 });
    expect(since.map((e) => e.ts)).toEqual([2000, 3000]);
    const until = await store.read({ until: 2500 });
    expect(until.map((e) => e.ts)).toEqual([1000, 2000]);
    const byStatus = await store.read({ status: "completed" });
    expect(byStatus.length).toBe(1);
    expect(byStatus[0]?.type).toBe("complete");
  });

  it("read() skips malformed lines (warn on stderr, do not throw)", async () => {
    await writeFile(
      path,
      [
        JSON.stringify({ type: "spawn", task_id: "tsk_AaAaAaAaAaAa", ts: 1, meta: {} }),
        "{ this is not json",
        JSON.stringify({
          type: "complete",
          task_id: "tsk_AaAaAaAaAaAa",
          status: "completed",
          ts: 2,
        }),
        "",
      ].join("\n"),
      "utf8",
    );
    const store = new HistoryStore({ path });
    const entries = await store.read();
    expect(entries.length).toBe(2);
    expect(entries.map((e) => e.type)).toEqual(["spawn", "complete"]);
    await store.close();
  });

  it("rotate() gzips the active file into a .gz sibling with Windows-safe timestamp", async () => {
    const store = new HistoryStore({ path });
    await store.append(sampleEvent());
    await store.append(
      sampleEvent({ type: "progress", message: "hello", ts: Date.now() }) as HistoryEvent,
    );
    await store.rotate();
    const entries = await readdir(dirname(path));
    const gz = entries.find((f) => f.endsWith(".jsonl.gz"));
    expect(gz).toBeDefined();
    expect(gz).toMatch(/^history-\d{8}-\d{6}-\d{3}\.jsonl\.gz$/);
    expect(gz).not.toContain(":");

    const gzContent = await readGzipText(join(dirname(path), gz ?? ""));
    const lines = gzContent.trim().split("\n");
    expect(lines.length).toBe(2);

    // Active file starts fresh after rotate
    const activeText = await readAllText(path).catch(() => "");
    expect(activeText).toBe("");
    await store.close();
  });

  it("rotate() when the file is empty is a no-op", async () => {
    const store = new HistoryStore({ path });
    await store.rotate();
    const entries = await readdir(dirname(path));
    const gzFiles = entries.filter((f) => f.endsWith(".gz"));
    expect(gzFiles.length).toBe(0);
    await store.close();
  });

  it("auto-rotates when active file size crosses max_bytes", async () => {
    const store = new HistoryStore({ path, max_bytes: 256 });
    // Each event is ~100 bytes serialised — 5 rows comfortably crosses 256.
    for (let i = 0; i < 6; i += 1) {
      await store.append({
        type: "progress",
        task_id: "tsk_AaAaAaAaAaAa",
        message: `tick-${i}-filler-filler-filler-filler`,
        ts: 1_700_000_000_000 + i,
      });
    }
    await store.flushRotation();
    await store.close();
    const entries = await readdir(dirname(path));
    const gz = entries.filter((f) => f.endsWith(".jsonl.gz"));
    expect(gz.length).toBeGreaterThanOrEqual(1);
    const active = await stat(path);
    // Active file size is strictly less than max_bytes after rotation took effect.
    expect(active.size).toBeLessThan(256);
  });

  it("gc({ retention_days }) deletes .jsonl.gz files older than the threshold", async () => {
    const store = new HistoryStore({ path });
    await store.append(sampleEvent());
    await store.rotate();
    const snapshotBeforeAging = await readdir(dirname(path));
    const gz = snapshotBeforeAging.find((f) => f.endsWith(".jsonl.gz"));
    expect(gz).toBeDefined();
    const oldPath = join(dirname(path), gz ?? "");
    const oldTs = Date.now() - 45 * 24 * 60 * 60 * 1000;
    await utimes(oldPath, oldTs / 1000, oldTs / 1000);

    await store.append(sampleEvent({ ts: Date.now() }));
    await store.rotate();
    const deleted = await store.gc({ retention_days: 30 });
    expect(deleted).toBe(1);
    const remaining = await readdir(dirname(path));
    expect(remaining.find((f) => f === gz)).toBeUndefined();
    // The recent rotation file remains.
    expect(remaining.filter((f) => f.endsWith(".jsonl.gz")).length).toBe(1);
    await store.close();
  });

  it("close() flushes pending writes before resolving", async () => {
    const store = new HistoryStore({ path });
    const pending = [
      store.append(sampleEvent({ ts: 1 })),
      store.append(sampleEvent({ ts: 2 })),
      store.append(sampleEvent({ ts: 3 })),
    ];
    // Do NOT await individual promises before close().
    await store.close();
    await Promise.all(pending);
    const text = await readAllText(path);
    const lines = text.trim().split("\n").filter(Boolean);
    expect(lines.length).toBe(3);
  });

  it("rotated filename never contains forbidden characters on Windows", async () => {
    const store = new HistoryStore({ path });
    await store.append(sampleEvent());
    await store.rotate();
    const entries = await readdir(dirname(path));
    const gz = entries.find((f) => f.endsWith(".jsonl.gz"));
    expect(gz).toBeDefined();
    for (const ch of [":", "*", "?", "\"", "<", ">", "|"]) {
      expect(gz).not.toContain(ch);
    }
    await store.close();
  });
});
