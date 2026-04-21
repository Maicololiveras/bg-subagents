/**
 * Picker interface + busy guard error.
 *
 * Design §3.1. Core types (`PickerOpts`, `PickerResult`) live in the protocol
 * package — this module re-exports them and adds the local `Picker` interface
 * + the `PickerBusyError` used by concrete implementations to reject a second
 * concurrent `prompt()` call on the same instance.
 */
import type { PickerOpts, PickerResult } from "@maicolextic/bg-subagents-protocol";

/**
 * Cross-implementation contract. Both `ClackPicker` and `BarePicker` implement
 * this and are runtime-interchangeable — callers should depend on the
 * interface, not the concrete class.
 */
export interface Picker {
  /**
   * Present the picker UI. Resolves exactly once with a {@link PickerResult};
   * rejects with {@link PickerBusyError} when a prior call is still in flight
   * on the same instance.
   */
  prompt(opts: PickerOpts): Promise<PickerResult>;
}

/**
 * Raised when `Picker.prompt()` is called while a prior call is still running.
 * Implementations must remain single-concurrent to avoid interleaved raw-mode
 * or Clack UI state.
 */
export class PickerBusyError extends Error {
  public readonly code = "PICKER_BUSY" as const;

  constructor(message: string = "Picker is already handling a prompt") {
    super(message);
    this.name = "PickerBusyError";
    Object.setPrototypeOf(this, PickerBusyError.prototype);
  }
}

export type { PickerOpts, PickerResult } from "@maicolextic/bg-subagents-protocol";
