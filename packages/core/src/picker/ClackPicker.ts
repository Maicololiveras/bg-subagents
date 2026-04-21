/**
 * Default picker implementation — delegates to `@clack/prompts.select`.
 *
 * Design §3.1 / Q2. We commit to clack as the default for v0.1 with the
 * expectation that `BarePicker` handles the rare Windows quirks where clack
 * misbehaves under `CONIN$`/`CONOUT$` (switch controlled by `policy.picker.impl`).
 *
 * Contract:
 *  - One prompt in flight per instance. Second call rejects with `PickerBusyError`.
 *  - `isCancel` sentinel (Esc) → `{ kind: "cancelled", reason: "user" }`.
 *  - External `signal.abort()` → `{ kind: "cancelled", reason: "signal" }`.
 *  - `timeoutMs > 0` + no user action → `{ kind: "picked", viaTimeout: true }`.
 *  - Caller-supplied `tty` streams are forwarded to clack verbatim.
 *  - Single-option shortcut: when `opts.singleOption` is provided we skip the
 *    UI and return it immediately (spec §1.c).
 */
import * as clack from "@clack/prompts";
import type { Mode, PickerOpts, PickerResult } from "@maicolextic/bg-subagents-protocol";
import type { Picker } from "./Picker.js";
import { PickerBusyError } from "./Picker.js";
import { createCountdown } from "./timeout.js";
import type { TtyHandles } from "./tty.js";

// -----------------------------------------------------------------------------
// Public types
// -----------------------------------------------------------------------------

export interface ClackPickerOptions {
  readonly tty?: TtyHandles;
}

/**
 * Internal extension of {@link PickerOpts}. Not part of the protocol surface
 * yet — short-circuit for the single-option contract test (§1.c). Exposed so
 * adapters can reuse the shortcut without duplicating the check.
 */
export type ClackPickerOpts = PickerOpts & {
  readonly singleOption?: Mode;
};

// -----------------------------------------------------------------------------
// Implementation
// -----------------------------------------------------------------------------

type ClackValue = Mode | typeof CANCEL_SENTINEL;

const CANCEL_SENTINEL = Symbol.for("clack:cancel");

export class ClackPicker implements Picker {
  readonly #tty: TtyHandles | undefined;
  #busy = false;

  constructor(options: ClackPickerOptions = {}) {
    this.#tty = options.tty;
  }

  async prompt(opts: PickerOpts): Promise<PickerResult> {
    if (this.#busy) {
      throw new PickerBusyError();
    }
    this.#busy = true;
    try {
      const typed = opts as ClackPickerOpts;
      if (typed.singleOption !== undefined) {
        return { kind: "picked", mode: typed.singleOption, viaTimeout: false };
      }

      if (opts.signal?.aborted === true) {
        return { kind: "cancelled", reason: "signal" };
      }

      const options = buildOptions(opts.defaultMode);
      const message = renderMessage(opts);

      const selectArgs: Record<string, unknown> = {
        message,
        options,
        initialValue: opts.defaultMode,
      };
      if (this.#tty !== undefined) {
        selectArgs["input"] = this.#tty.input;
        selectArgs["output"] = this.#tty.output;
      }

      const selectFn = clack.select as unknown as (
        opts: Record<string, unknown>,
      ) => Promise<Mode | symbol>;
      const selectCall = selectFn(selectArgs) as Promise<ClackValue>;

      return await this.#race(selectCall, opts);
    } finally {
      this.#busy = false;
    }
  }

  async #race(selectCall: Promise<ClackValue>, opts: PickerOpts): Promise<PickerResult> {
    return new Promise<PickerResult>((resolve) => {
      let settled = false;
      const resolveOnce = (r: PickerResult): void => {
        if (settled) return;
        settled = true;
        resolve(r);
      };

      const countdown =
        opts.timeoutMs > 0
          ? createCountdown({
              ms: opts.timeoutMs,
              onTick: () => undefined,
              onExpire: () => {
                resolveOnce({
                  kind: "picked",
                  mode: opts.defaultMode,
                  viaTimeout: true,
                });
              },
            })
          : null;

      const abortListener = opts.signal
        ? () => {
            countdown?.cancel();
            resolveOnce({ kind: "cancelled", reason: "signal" });
          }
        : null;
      if (abortListener !== null) {
        opts.signal?.addEventListener("abort", abortListener, { once: true });
      }

      selectCall.then(
        (value) => {
          countdown?.cancel();
          if (abortListener !== null && opts.signal !== undefined) {
            opts.signal.removeEventListener("abort", abortListener);
          }
          if (clack.isCancel(value)) {
            resolveOnce({ kind: "cancelled", reason: "user" });
            return;
          }
          const mode = value as Mode;
          if (mode === "background" || mode === "foreground") {
            resolveOnce({ kind: "picked", mode, viaTimeout: false });
          } else {
            resolveOnce({ kind: "cancelled", reason: "io-unavailable" });
          }
        },
        () => {
          countdown?.cancel();
          if (abortListener !== null && opts.signal !== undefined) {
            opts.signal.removeEventListener("abort", abortListener);
          }
          resolveOnce({ kind: "cancelled", reason: "io-unavailable" });
        },
      );
    });
  }
}

// -----------------------------------------------------------------------------
// Rendering helpers
// -----------------------------------------------------------------------------

function renderMessage(opts: PickerOpts): string {
  const parts = [`bg-subagents: ${opts.agentName}`];
  if (opts.agentType !== undefined) parts.push(`(${opts.agentType})`);
  parts.push(`default=${opts.defaultMode}`);
  return parts.join(" ");
}

function buildOptions(defaultMode: Mode): Array<{ value: Mode; label: string; hint?: string }> {
  const base: Array<{ value: Mode; label: string; hint?: string }> = [
    { value: "background", label: "[B]ackground" },
    { value: "foreground", label: "[N]ormal" },
  ];
  return base.map((opt) =>
    opt.value === defaultMode ? { ...opt, hint: "default" } : opt,
  );
}
