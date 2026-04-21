/**
 * Public barrel for the core task module.
 *
 * NodeNext requires `.js` extensions on internal re-exports because we ship
 * compiled ESM alongside TS sources.
 */

export {
  generateTaskId,
  isValidTaskId,
  unsafeTaskId,
  TASK_ID_PATTERN,
} from "./id.js";

export {
  TRANSITIONS,
  TERMINAL_STATUSES,
  canTransition,
  assertTransition,
  isTerminal,
  InvalidTransitionError,
  type InvalidTransitionContext,
  type TerminalStatus,
} from "./lifecycle.js";

export {
  TaskRegistry,
  type CompletionEvent,
  type ProgressEvent,
  type ProgressFn,
  type TaskHandle,
  type TaskListFilter,
  type TaskRegistryOptions,
  type TaskSpec,
  type TaskState,
  type Unsubscribe,
} from "./TaskRegistry.js";

export {
  HistoryStore,
  type HistoryEvent,
  type HistoryReadFilter,
  type HistoryStoreOptions,
} from "./HistoryStore.js";
