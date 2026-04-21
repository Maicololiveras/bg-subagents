/**
 * Public barrel for the core picker module.
 *
 * NodeNext requires `.js` extensions on internal re-exports because we ship
 * compiled ESM alongside TS sources. Types `PickerOpts` / `PickerResult` are
 * re-exported from the protocol to avoid forcing consumers to pull them in
 * through a second import path.
 */

export {
  PickerBusyError,
  type Picker,
  type PickerOpts,
  type PickerResult,
} from "./Picker.js";

export { ClackPicker, type ClackPickerOptions, type ClackPickerOpts } from "./ClackPicker.js";

export { BarePicker, type BarePickerOptions, type BarePickerStreams } from "./BarePicker.js";

export {
  acquireTty,
  __resetTtyForTests,
  type AcquireTtyOpts,
  type TtyHandles,
} from "./tty.js";

export {
  createCountdown,
  type CountdownHandle,
  type CountdownOpts,
  type CountdownTick,
} from "./timeout.js";

export { createDefaultPicker, type PickerImpl, type PickerFactoryPolicy } from "./factory.js";
