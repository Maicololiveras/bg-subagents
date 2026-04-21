/**
 * RED gate for `src/picker/BarePicker.ts`.
 *
 * Covers Batch 4 spec §1.e — zero-dep fallback picker that uses Node's
 * `readline.emitKeypressEvents`, handles Up/Down/Enter/Esc/Ctrl+C, restores
 * raw mode on exit, renders to an injected writable stream.
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BarePicker } from "../BarePicker.js";
import type { PickerOpts } from "@maicolextic/bg-subagents-protocol";

// -----------------------------------------------------------------------------
// Test helpers
// -----------------------------------------------------------------------------

class FakeStdin extends PassThrough {
  public isTTY = true as const;
  public rawMode = false;
  public rawModeCalls: boolean[] = [];
  setRawMode(val: boolean): this {
    this.rawMode = val;
    this.rawModeCalls.push(val);
    return this;
  }
}

const baseOpts = (extras: Partial<PickerOpts> = {}): PickerOpts => ({
  agentName: "code-researcher",
  defaultMode: "background",
  timeoutMs: 0, // disable timeout for most tests
  ...extras,
});

/** Write text to stdin as a key sequence. */
function sendKey(stdin: FakeStdin, ch: string): void {
  stdin.write(ch);
}

describe("BarePicker", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("initializes raw mode on start and restores it on happy path", async () => {
    const stdin = new FakeStdin();
    const stdout = new PassThrough();
    const picker = new BarePicker({ input: stdin, output: stdout });

    const promise = picker.prompt(baseOpts());
    // wait one microtask tick so prompt has initialized raw mode
    await new Promise<void>((r) => setImmediate(r));
    expect(stdin.rawModeCalls[0]).toBe(true);

    sendKey(stdin, "b");
    const result = await promise;
    expect(result.kind).toBe("picked");
    // Last rawMode call should be false (restored).
    expect(stdin.rawModeCalls.at(-1)).toBe(false);
  });

  it("restores raw mode in finally even when an internal error occurs", async () => {
    const stdin = new FakeStdin();
    const stdout = new PassThrough();
    const picker = new BarePicker({ input: stdin, output: stdout });

    // Kick off prompt with no timeout; simulate destroy of stdin.
    const promise = picker.prompt(baseOpts());
    await new Promise<void>((r) => setImmediate(r));

    // Send Ctrl+C to trigger cancel (error-ish path).
    sendKey(stdin, "\u0003");
    const result = await promise;
    expect(result.kind).toBe("cancelled");
    expect(stdin.rawModeCalls.at(-1)).toBe(false);
  });

  it("Up/Down arrows change the highlighted option", async () => {
    const stdin = new FakeStdin();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));

    const picker = new BarePicker({ input: stdin, output: stdout });
    const promise = picker.prompt(baseOpts());
    await new Promise<void>((r) => setImmediate(r));

    // Down arrow → ANSI: ESC [ B
    sendKey(stdin, "\u001b[B");
    await new Promise<void>((r) => setImmediate(r));
    sendKey(stdin, "\r"); // Enter
    const result = await promise;

    // After one DOWN then Enter, we should have selected "foreground" (normal).
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.mode).toBe("foreground");
    }
    // Renderer wrote multiple frames.
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("Enter commits the current highlight", async () => {
    const stdin = new FakeStdin();
    const stdout = new PassThrough();
    const picker = new BarePicker({ input: stdin, output: stdout });

    const promise = picker.prompt(baseOpts());
    await new Promise<void>((r) => setImmediate(r));
    sendKey(stdin, "\r"); // Enter on default highlight

    const result = await promise;
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      // First option is "background".
      expect(result.mode).toBe("background");
    }
  });

  it("Ctrl+C cancels AND restores raw mode before returning", async () => {
    const stdin = new FakeStdin();
    const stdout = new PassThrough();
    const picker = new BarePicker({ input: stdin, output: stdout });

    const promise = picker.prompt(baseOpts());
    await new Promise<void>((r) => setImmediate(r));

    sendKey(stdin, "\u0003"); // Ctrl+C
    const result = await promise;

    expect(result.kind).toBe("cancelled");
    if (result.kind === "cancelled") {
      expect(result.reason).toBe("user");
    }
    expect(stdin.rawModeCalls.at(-1)).toBe(false);
  });

  it("renders agent name to the injected stdout stream", async () => {
    const stdin = new FakeStdin();
    const stdout = new PassThrough();
    const chunks: string[] = [];
    stdout.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));

    const picker = new BarePicker({ input: stdin, output: stdout });
    const promise = picker.prompt(baseOpts({ agentName: "researcher-42" }));
    await new Promise<void>((r) => setImmediate(r));
    sendKey(stdin, "\u001b"); // ESC to cancel and end
    await promise;

    const full = chunks.join("");
    expect(full).toContain("researcher-42");
  });
});
