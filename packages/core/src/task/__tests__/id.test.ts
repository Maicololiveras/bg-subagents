/**
 * RED gate for `src/task/id.ts`.
 *
 * Covers Batch 3 spec §1.a:
 * - `generateTaskId()` returns `tsk_<12 base62 chars>` (12 chars = ≥8 spec min + headroom).
 * - 10,000 generations are all distinct (collision probe for base62^12 entropy).
 * - `isValidTaskId(s)` validates shape; rejects malformed inputs.
 * - `unsafeTaskId` is re-exported from protocol (single brand converter).
 * - `generateTaskId` uses `node:crypto.randomBytes` (spy assertion).
 * - Generated IDs parse against protocol `TaskIdSchema`.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { TaskIdSchema, unsafeTaskId as protocolUnsafeTaskId } from "@maicolextic/bg-subagents-protocol";
import {
  generateTaskId,
  isValidTaskId,
  unsafeTaskId,
  TASK_ID_PATTERN,
} from "../id.js";

describe("task id / generateTaskId", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns a branded TaskId matching /^tsk_[A-Za-z0-9]{12}$/", () => {
    const id = generateTaskId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("tsk_")).toBe(true);
    expect(id).toMatch(/^tsk_[A-Za-z0-9]{12}$/);
    expect(TASK_ID_PATTERN.test(id)).toBe(true);
  });

  it("produces 10,000 distinct IDs (collision probe)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i += 1) {
      const id = generateTaskId();
      expect(seen.has(id)).toBe(false);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it("derives entropy from node:crypto.randomBytes (entropy surface check)", async () => {
    // node:crypto is an ESM-only re-export; its bindings are frozen and
    // cannot be patched via `vi.spyOn`. We assert the entropy path indirectly
    // via vi.mock, which DOES intercept the module graph load for this test.
    vi.resetModules();
    const calls: number[] = [];
    vi.doMock("node:crypto", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:crypto")>();
      return {
        ...actual,
        randomBytes: (size: number): Buffer => {
          calls.push(size);
          return actual.randomBytes(size);
        },
      };
    });
    const mod = await import("../id.js");
    const id = mod.generateTaskId();
    expect(calls.length).toBeGreaterThan(0);
    expect(id).toMatch(/^tsk_[A-Za-z0-9]{12}$/);
    vi.doUnmock("node:crypto");
    vi.resetModules();
  });

  it("result satisfies the protocol TaskIdSchema", () => {
    const id = generateTaskId();
    const parsed = TaskIdSchema.parse(id);
    expect(parsed).toBe(id);
  });
});

describe("task id / isValidTaskId", () => {
  it("accepts freshly generated IDs", () => {
    for (let i = 0; i < 100; i += 1) {
      expect(isValidTaskId(generateTaskId())).toBe(true);
    }
  });

  it("accepts the canonical fixed example", () => {
    expect(isValidTaskId("tsk_AbCdEfGhIjKl")).toBe(true);
  });

  it("rejects malformed inputs (wrong prefix, bad length, bad chars, empty, whitespace)", () => {
    const bad: readonly unknown[] = [
      "",
      "tsk_",
      "tsk_short",
      "tsk_AbCdEfGhIjK", // 11 chars
      "tsk_AbCdEfGhIjKlm", // 13 chars
      "TSK_AbCdEfGhIjKl", // wrong-case prefix
      "task_AbCdEfGhIjKl",
      "tsk_AbCdEfGh IjK", // whitespace
      "tsk_AbCdEfGh!jKl", // bad char
      " tsk_AbCdEfGhIjKl",
      "tsk_AbCdEfGhIjKl ",
      42,
      null,
      undefined,
      {},
    ];
    for (const input of bad) {
      expect(isValidTaskId(input as string)).toBe(false);
    }
  });
});

describe("task id / unsafeTaskId (re-export from protocol)", () => {
  it("is the same reference as protocol's unsafeTaskId (single brand converter)", () => {
    expect(unsafeTaskId).toBe(protocolUnsafeTaskId);
  });

  it("casts a raw string into a branded TaskId (no runtime validation)", () => {
    const raw = "tsk_ZzZzZzZzZzZz";
    const branded = unsafeTaskId(raw);
    expect(branded).toBe(raw);
  });
});
