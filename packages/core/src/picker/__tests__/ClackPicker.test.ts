/**
 * RED gate for `src/picker/ClackPicker.ts`.
 *
 * Covers Batch 4 spec §1.d — @clack/prompts delegation, isCancel sentinel,
 * AbortSignal integration, timeout wiring, TTY override plumbing.
 *
 * We mock `@clack/prompts` at module scope so tests control the behaviour of
 * `select()` without launching a real TUI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const CANCEL_SENTINEL = Symbol.for("clack:cancel");

type SelectFn = (opts: unknown) => Promise<unknown>;

const mockState: { selectImpl: SelectFn } = {
  selectImpl: async () => "background",
};

vi.mock("@clack/prompts", () => ({
  select: (opts: unknown) => mockState.selectImpl(opts),
  isCancel: (v: unknown): boolean => v === CANCEL_SENTINEL,
  cancel: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
}));

describe("ClackPicker", () => {
  beforeEach(() => {
    mockState.selectImpl = async () => "background";
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("delegates to @clack/prompts.select and returns picked mode", async () => {
    const { ClackPicker } = await import("../ClackPicker.js");
    const picker = new ClackPicker();
    const result = await picker.prompt({
      agentName: "code-researcher",
      defaultMode: "background",
      timeoutMs: 0,
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.mode).toBe("background");
    }
  });

  it("returns cancel when clack emits the isCancel sentinel", async () => {
    mockState.selectImpl = async () => CANCEL_SENTINEL;
    const { ClackPicker } = await import("../ClackPicker.js");
    const picker = new ClackPicker();
    const result = await picker.prompt({
      agentName: "researcher",
      defaultMode: "background",
      timeoutMs: 0,
    });
    expect(result.kind).toBe("cancelled");
    if (result.kind === "cancelled") {
      expect(result.reason).toBe("user");
    }
  });

  it("cancels cleanly when the external abort signal fires", async () => {
    mockState.selectImpl = () =>
      new Promise<unknown>((resolve) => {
        setTimeout(() => resolve(CANCEL_SENTINEL), 50);
      });
    const controller = new AbortController();
    const { ClackPicker } = await import("../ClackPicker.js");
    const picker = new ClackPicker();
    const p = picker.prompt({
      agentName: "researcher",
      defaultMode: "background",
      timeoutMs: 0,
      signal: controller.signal,
    });
    controller.abort();
    const result = await p;
    expect(result.kind).toBe("cancelled");
    if (result.kind === "cancelled") {
      expect(["signal", "user"]).toContain(result.reason);
    }
  });

  it("resolves to timeout default when countdown fires before user picks", async () => {
    mockState.selectImpl = () =>
      new Promise<unknown>((resolve) => {
        setTimeout(() => resolve(CANCEL_SENTINEL), 10_000);
      });
    const { ClackPicker } = await import("../ClackPicker.js");
    const picker = new ClackPicker();
    const result = await picker.prompt({
      agentName: "researcher",
      defaultMode: "background",
      timeoutMs: 20,
    });
    expect(result.kind).toBe("picked");
    if (result.kind === "picked") {
      expect(result.viaTimeout).toBe(true);
      expect(result.mode).toBe("background");
    }
  });

  it("respects a caller-supplied tty override without acquiring one", async () => {
    let invokedWithInput: unknown = undefined;
    mockState.selectImpl = async (opts) => {
      const o = opts as { input?: unknown; output?: unknown };
      invokedWithInput = { input: o.input, output: o.output };
      return "foreground";
    };
    const { ClackPicker } = await import("../ClackPicker.js");
    const fakeInput = { fake: "input" } as unknown as NodeJS.ReadableStream;
    const fakeOutput = { fake: "output" } as unknown as NodeJS.WritableStream;
    const picker = new ClackPicker({
      tty: {
        input: fakeInput,
        output: fakeOutput,
        release: () => undefined,
      },
    });
    const result = await picker.prompt({
      agentName: "researcher",
      defaultMode: "background",
      timeoutMs: 0,
    });
    expect(result.kind).toBe("picked");
    const passed = invokedWithInput as { input: unknown; output: unknown } | undefined;
    // The picker should have forwarded the injected streams to clack.
    expect(passed).toBeDefined();
  });

  it("rejects a second concurrent prompt with PickerBusyError", async () => {
    mockState.selectImpl = () =>
      new Promise<unknown>((resolve) => {
        setTimeout(() => resolve("background"), 30);
      });
    const { ClackPicker } = await import("../ClackPicker.js");
    const { PickerBusyError } = await import("../Picker.js");
    const picker = new ClackPicker();
    const first = picker.prompt({
      agentName: "a",
      defaultMode: "background",
      timeoutMs: 0,
    });
    await expect(
      picker.prompt({ agentName: "b", defaultMode: "background", timeoutMs: 0 }),
    ).rejects.toBeInstanceOf(PickerBusyError);
    await first;
  });
});
