/**
 * Zero-dep fallback picker.
 *
 * Design §3.1 / Q2 fallback. Hand-rolled readline-based picker for the case
 * where `@clack/prompts` misbehaves (notably on Windows under `CONIN$`).
 * Uses ONLY Node built-ins: `readline.emitKeypressEvents`, `setRawMode`.
 *
 * Rendering is intentionally minimal + monochrome so it works in legacy cmd
 * terminals that strip extended ANSI. The active option is marked with `>`.
 *
 * Contract:
 *  - One prompt in flight per instance. Second call rejects with `PickerBusyError`.
 *  - Raw mode is ALWAYS restored (try/finally) even on cancel/error paths.
 *  - Enter / numeric keys / `b` `n` pick; Esc / Ctrl+C cancel.
 *  - `timeoutMs > 0` triggers `{ kind: "picked", viaTimeout: true }` on expiry.
 */
import type { Mode, PickerOpts, PickerResult } from "@maicolextic/bg-subagents-protocol";
import type { Picker } from "./Picker.js";
import { PickerBusyError } from "./Picker.js";
import { createCountdown } from "./timeout.js";

// -----------------------------------------------------------------------------
// Internal option shape
// -----------------------------------------------------------------------------

interface OptionRow {
  readonly value: Mode;
  readonly label: string;
  readonly keys: readonly string[];
}

const OPTIONS: readonly OptionRow[] = [
  { value: "background", label: "[B]ackground", keys: ["b", "B", "1"] },
  { value: "foreground", label: "[N]ormal", keys: ["n", "N", "2"] },
];

// -----------------------------------------------------------------------------
// Minimal TTY-stream contract — enough to test with a PassThrough.
// -----------------------------------------------------------------------------

export interface BarePickerStreams {
  readonly input: NodeJS.ReadableStream & {
    setRawMode?: (v: boolean) => unknown;
    isTTY?: boolean;
  };
  readonly output: NodeJS.WritableStream;
}

export interface BarePickerOptions {
  readonly input?: BarePickerStreams["input"];
  readonly output?: BarePickerStreams["output"];
}

/**
 * Internal shape for short-circuit contract test (§1.c).
 */
type BarePickerOpts = PickerOpts & { readonly singleOption?: Mode };

// -----------------------------------------------------------------------------
// Picker
// -----------------------------------------------------------------------------

export class BarePicker implements Picker {
  readonly #input: BarePickerStreams["input"];
  readonly #output: NodeJS.WritableStream;
  #busy = false;

  constructor(opts: BarePickerOptions = {}) {
    this.#input = opts.input ?? (process.stdin as unknown as BarePickerStreams["input"]);
    this.#output = opts.output ?? (process.stdout as unknown as NodeJS.WritableStream);
  }

  async prompt(opts: PickerOpts): Promise<PickerResult> {
    if (this.#busy) {
      throw new PickerBusyError();
    }
    this.#busy = true;
    try {
      const typed = opts as BarePickerOpts;
      if (typed.singleOption !== undefined) {
        return { kind: "picked", mode: typed.singleOption, viaTimeout: false };
      }
      if (opts.signal?.aborted === true) {
        return { kind: "cancelled", reason: "signal" };
      }
      return await this.#run(opts);
    } finally {
      this.#busy = false;
    }
  }

  async #run(opts: PickerOpts): Promise<PickerResult> {
    const rawModeSupported = typeof this.#input.setRawMode === "function";
    // Attach raw mode — swallow errors on non-TTY streams that still expose setRawMode.
    if (rawModeSupported) {
      try {
        this.#input.setRawMode?.(true);
      } catch {
        // ignore
      }
    }

    let activeIndex = defaultIndex(opts.defaultMode);

    const render = (): void => {
      // Clear + render a fresh frame. Minimal ANSI that cmd.exe tolerates.
      const lines: string[] = [];
      lines.push(`bg-subagents: ${opts.agentName}${opts.agentType !== undefined ? ` (${opts.agentType})` : ""}`);
      lines.push(`default=${opts.defaultMode}`);
      for (let i = 0; i < OPTIONS.length; i += 1) {
        const row = OPTIONS[i]!;
        const prefix = i === activeIndex ? "> " : "  ";
        lines.push(`${prefix}${row.label}`);
      }
      lines.push("[Enter] confirm  [Esc/Ctrl+C] cancel");
      const text = `${lines.join("\n")}\n`;
      this.#output.write(text);
    };

    render();

    return new Promise<PickerResult>((resolve) => {
      let settled = false;

      const handleByteRun = (buf: Buffer): void => {
        // Full CSI arrow sequence: ESC [ A | B.
        if (buf.length >= 3 && buf[0] === 0x1b && buf[1] === 0x5b) {
          const code = buf[2]!;
          if (code === 0x41) {
            activeIndex = (activeIndex + OPTIONS.length - 1) % OPTIONS.length;
            render();
            return;
          }
          if (code === 0x42) {
            activeIndex = (activeIndex + 1) % OPTIONS.length;
            render();
            return;
          }
        }
        if (buf.length >= 1) {
          const byte = buf[0]!;
          if (byte === 0x03) {
            finish({ kind: "cancelled", reason: "user" });
            return;
          }
          if (byte === 0x1b && buf.length === 1) {
            finish({ kind: "cancelled", reason: "user" });
            return;
          }
          if (byte === 0x0d || byte === 0x0a) {
            const picked = OPTIONS[activeIndex]!;
            finish({ kind: "picked", mode: picked.value, viaTimeout: false });
            return;
          }
          const ch = String.fromCharCode(byte);
          const match = OPTIONS.find((o) => o.keys.includes(ch));
          if (match !== undefined) {
            finish({ kind: "picked", mode: match.value, viaTimeout: false });
            return;
          }
        }
      };

      const dataListener = (chunk: Buffer | string): void => {
        if (settled) return;
        const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
        handleByteRun(buf);
      };

      const abortListener = opts.signal
        ? () => finish({ kind: "cancelled", reason: "signal" })
        : null;
      if (abortListener !== null) {
        opts.signal?.addEventListener("abort", abortListener, { once: true });
      }

      const countdown =
        opts.timeoutMs > 0
          ? createCountdown({
              ms: opts.timeoutMs,
              onTick: () => undefined,
              onExpire: () => {
                finish({
                  kind: "picked",
                  mode: opts.defaultMode,
                  viaTimeout: true,
                });
              },
            })
          : null;

      const cleanup = (): void => {
        this.#input.off("data", dataListener);
        if (abortListener !== null && opts.signal !== undefined) {
          opts.signal.removeEventListener("abort", abortListener);
        }
        countdown?.cancel();
        if (rawModeSupported) {
          try {
            this.#input.setRawMode?.(false);
          } catch {
            // ignore
          }
        }
      };

      const finish = (r: PickerResult): void => {
        if (settled) return;
        settled = true;
        cleanup();
        resolve(r);
      };

      this.#input.on("data", dataListener);
    });
  }
}

function defaultIndex(mode: Mode): number {
  const idx = OPTIONS.findIndex((o) => o.value === mode);
  return idx >= 0 ? idx : 0;
}
