/**
 * Factory for the default picker implementation.
 *
 * Reserves a future `policy.picker` sub-field (not yet in the protocol schema;
 * see Q5 / Batch 21) so host adapters can choose between `clack` and `bare`
 * without coupling to a specific constructor. Default is `"auto"` — try Clack
 * first, fall back to Bare if instantiation fails synchronously.
 */
import type { Picker } from "./Picker.js";
import { ClackPicker, type ClackPickerOptions } from "./ClackPicker.js";
import { BarePicker, type BarePickerOptions } from "./BarePicker.js";

export type PickerImpl = "clack" | "bare" | "auto";

export interface PickerFactoryPolicy {
  readonly picker?: {
    readonly impl?: PickerImpl;
  };
}

export interface PickerFactoryOptions {
  readonly clack?: ClackPickerOptions;
  readonly bare?: BarePickerOptions;
}

/**
 * Pick the appropriate picker implementation based on a (loosely typed)
 * policy fragment. The fragment is optional — callers can pass just {} and
 * get the `"auto"` default.
 */
export function createDefaultPicker(
  policy: PickerFactoryPolicy = {},
  options: PickerFactoryOptions = {},
): Picker {
  const impl = policy.picker?.impl ?? "auto";

  if (impl === "bare") {
    return new BarePicker(options.bare ?? {});
  }

  if (impl === "clack") {
    return new ClackPicker(options.clack ?? {});
  }

  // "auto" — prefer clack; if instantiation throws (e.g. bad platform), fall
  // back to BarePicker so the picker surface remains available.
  try {
    return new ClackPicker(options.clack ?? {});
  } catch {
    return new BarePicker(options.bare ?? {});
  }
}
