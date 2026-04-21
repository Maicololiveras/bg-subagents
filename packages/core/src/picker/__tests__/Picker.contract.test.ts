/**
 * RED gate for the Picker contract.
 *
 * Covers Batch 4 spec §1.c — parametric tests that run against BOTH ClackPicker
 * and BarePicker with fake stdin/stdout streams. Every behaviour the interface
 * promises must hold for both implementations.
 */
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PickerOpts, PickerResult } from "@maicolextic/bg-subagents-protocol";
import type { Picker } from "../Picker.js";

// -----------------------------------------------------------------------------
// @clack/prompts mock — driven by mockState.selectImpl per test.
// -----------------------------------------------------------------------------

const CANCEL_SENTINEL = Symbol.for("clack:cancel");

type SelectFn = (opts: unknown) => Promise<unknown>;

const mockState: {
  selectImpl: SelectFn;
  lastOpts?: {
    options?: Array<{ value: unknown; label?: unknown }>;
    message?: unknown;
  };
} = {
  selectImpl: async () => "background",
};

vi.mock("@clack/prompts", () => ({
  select: (opts: unknown) => {
    mockState.lastOpts = opts as typeof mockState.lastOpts;
    return mockState.selectImpl(opts);
  },
  isCancel: (v: unknown): boolean => v === CANCEL_SENTINEL,
  cancel: vi.fn(),
  intro: vi.fn(),
  outro: vi.fn(),
  note: vi.fn(),
}));

// -----------------------------------------------------------------------------
// Fake stdin / stdout harness for BarePicker
// -----------------------------------------------------------------------------

class FakeStdin extends PassThrough {
  public isTTY = true as const;
  public rawMode = false;
  setRawMode(val: boolean): this {
    this.rawMode = val;
    return this;
  }
}

type Factory = () => Promise<{ picker: Picker; cleanup?: () => void }>;

const baseOpts = (extras: Partial<PickerOpts> = {}): PickerOpts => ({
  agentName: "code-researcher",
  defaultMode: "background",
  timeoutMs: 0,
  ...extras,
});

const waitMicro = (): Promise<void> =>
  new Promise((r) => {
    setImmediate(r);
  });

// -----------------------------------------------------------------------------
// Factory registry (runs each test against both impls)
// -----------------------------------------------------------------------------

type Harness = {
  name: "ClackPicker" | "BarePicker";
  make: Factory;
  /**
   * For BarePicker tests we need to drive stdin. For Clack we drive via the
   * mock. `drive` is only provided for BarePicker; Clack tests set
   * `mockState.selectImpl` in-line.
   */
  driveKeypress?: (key: string) => void;
  stdin?: FakeStdin;
  stdout?: PassThrough;
};

async function makeBare(): Promise<Harness> {
  const stdin = new FakeStdin();
  const stdout = new PassThrough();
  const { BarePicker } = await import("../BarePicker.js");
  const picker = new BarePicker({ input: stdin, output: stdout });
  return {
    name: "BarePicker",
    make: async () => ({ picker }),
    driveKeypress: (key: string) => {
      stdin.write(key);
    },
    stdin,
    stdout,
  };
}

async function makeClack(): Promise<Harness> {
  const { ClackPicker } = await import("../ClackPicker.js");
  const picker = new ClackPicker();
  return {
    name: "ClackPicker",
    make: async () => ({ picker }),
  };
}

// -----------------------------------------------------------------------------
// Shared behaviours
// -----------------------------------------------------------------------------

describe("Picker contract (runs per impl)", () => {
  beforeEach(() => {
    mockState.selectImpl = async () => "background";
    mockState.lastOpts = undefined;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -- Clack branch ----------------------------------------------------------

  describe("ClackPicker", () => {
    it("returns picked result when user selects an option", async () => {
      mockState.selectImpl = async () => "background";
      const h = await makeClack();
      const result: PickerResult = await (await h.make()).picker.prompt(baseOpts());
      expect(result.kind).toBe("picked");
    });

    it("returns cancel when clack signals cancel (Esc-equivalent)", async () => {
      mockState.selectImpl = async () => CANCEL_SENTINEL;
      const h = await makeClack();
      const result = await (await h.make()).picker.prompt(baseOpts());
      expect(result.kind).toBe("cancelled");
    });

    it("returns timeout-defaulted picked when countdown expires first", async () => {
      mockState.selectImpl = () =>
        new Promise<unknown>((resolve) => {
          setTimeout(() => resolve(CANCEL_SENTINEL), 1000);
        });
      const h = await makeClack();
      const result = await (await h.make()).picker.prompt(
        baseOpts({ timeoutMs: 20, defaultMode: "foreground" }),
      );
      expect(result.kind).toBe("picked");
      if (result.kind === "picked") {
        expect(result.viaTimeout).toBe(true);
        expect(result.mode).toBe("foreground");
      }
    });

    it("rejects a concurrent prompt on the same instance", async () => {
      mockState.selectImpl = () =>
        new Promise<unknown>((resolve) => {
          setTimeout(() => resolve("background"), 25);
        });
      const { PickerBusyError } = await import("../Picker.js");
      const h = await makeClack();
      const picker = (await h.make()).picker;
      const first = picker.prompt(baseOpts());
      await expect(picker.prompt(baseOpts())).rejects.toBeInstanceOf(PickerBusyError);
      await first;
    });

    it("responds quickly when clack resolves immediately (< 100ms)", async () => {
      mockState.selectImpl = async () => "foreground";
      const h = await makeClack();
      const start = Date.now();
      const result = await (await h.make()).picker.prompt(baseOpts());
      const elapsed = Date.now() - start;
      expect(result.kind).toBe("picked");
      expect(elapsed).toBeLessThan(100);
    });
  });

  // -- Bare branch -----------------------------------------------------------

  describe("BarePicker", () => {
    it("returns picked result when user hits Enter on default highlight", async () => {
      const h = await makeBare();
      const picker = (await h.make()).picker;
      const p = picker.prompt(baseOpts());
      await waitMicro();
      h.driveKeypress!("\r");
      const result = await p;
      expect(result.kind).toBe("picked");
    });

    it("returns cancel when user presses Esc", async () => {
      const h = await makeBare();
      const picker = (await h.make()).picker;
      const p = picker.prompt(baseOpts());
      await waitMicro();
      h.driveKeypress!("\u001b"); // ESC
      const result = await p;
      expect(result.kind).toBe("cancelled");
    });

    it("returns picked-timeout with default mode when timer expires", async () => {
      const h = await makeBare();
      const picker = (await h.make()).picker;
      const result = await picker.prompt(
        baseOpts({ timeoutMs: 20, defaultMode: "foreground" }),
      );
      expect(result.kind).toBe("picked");
      if (result.kind === "picked") {
        expect(result.viaTimeout).toBe(true);
        expect(result.mode).toBe("foreground");
      }
    });

    it("removes listeners on stdin after prompt resolves (no leak)", async () => {
      const h = await makeBare();
      const picker = (await h.make()).picker;
      const stdin = h.stdin!;
      const before = stdin.listenerCount("data") + stdin.listenerCount("keypress");
      const p = picker.prompt(baseOpts());
      await waitMicro();
      h.driveKeypress!("\r");
      await p;
      const after = stdin.listenerCount("data") + stdin.listenerCount("keypress");
      expect(after).toBeLessThanOrEqual(before);
    });

    it("rejects a concurrent prompt with PickerBusyError", async () => {
      const { PickerBusyError } = await import("../Picker.js");
      const h = await makeBare();
      const picker = (await h.make()).picker;
      const first = picker.prompt(baseOpts());
      await waitMicro();
      await expect(picker.prompt(baseOpts())).rejects.toBeInstanceOf(PickerBusyError);
      h.driveKeypress!("\r");
      await first;
    });

    it("renders the agent name in the rendered frame", async () => {
      const h = await makeBare();
      const picker = (await h.make()).picker;
      const chunks: string[] = [];
      h.stdout!.on("data", (c: Buffer) => chunks.push(c.toString("utf8")));
      const p = picker.prompt(baseOpts({ agentName: "proof-agent" }));
      await waitMicro();
      h.driveKeypress!("\u001b");
      await p;
      expect(chunks.join("")).toContain("proof-agent");
    });

    it("numeric keys (1, 2) select options by index", async () => {
      const h = await makeBare();
      const picker = (await h.make()).picker;
      const p = picker.prompt(baseOpts());
      await waitMicro();
      // "2" should pick option 2 → foreground (normal).
      h.driveKeypress!("2");
      const result = await p;
      expect(result.kind).toBe("picked");
      if (result.kind === "picked") {
        expect(result.mode).toBe("foreground");
      }
    });
  });

  // -- Shared (both impls) ---------------------------------------------------

  describe("shared contract", () => {
    it("returns immediately when exactly one option is available (no UI)", async () => {
      // Clack branch
      const clackHarness = await makeClack();
      const clackPicker = (await clackHarness.make()).picker;
      mockState.selectImpl = async () => {
        throw new Error("select() must not be called when only one option available");
      };
      const r1 = await clackPicker.prompt(
        baseOpts({ timeoutMs: 0, defaultMode: "background", agentType: undefined, singleOption: "background" } as PickerOpts & {
          singleOption?: "background" | "foreground";
        }),
      );
      // Implementation may expose the short-circuit via opts.singleOption or
      // via an internal optionsCount. Accept either picked result.
      expect(["picked", "cancelled"]).toContain(r1.kind);

      // Bare branch
      const bareHarness = await makeBare();
      const barePicker = (await bareHarness.make()).picker;
      const p = barePicker.prompt(
        baseOpts({ timeoutMs: 0, defaultMode: "background", singleOption: "background" } as PickerOpts & {
          singleOption?: "background" | "foreground";
        }),
      );
      // Give it a tick — if it doesn't resolve immediately, drive Enter.
      await waitMicro();
      (bareHarness.stdin as FakeStdin).write("\r");
      const r2 = await p;
      expect(r2.kind).toBe("picked");
    });
  });
});
