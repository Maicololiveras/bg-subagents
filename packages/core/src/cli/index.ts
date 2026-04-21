/**
 * Public barrel for the core cli module.
 *
 * NodeNext requires `.js` extensions on internal re-exports because we ship
 * compiled ESM alongside TS sources.
 */

export {
  killCommand,
  listCommand,
  logsCommand,
  showCommand,
  type CommandResult,
  type CommandStdout,
  type KillCommandDeps,
  type ListCommandDeps,
  type LogsCommandDeps,
  type ShowCommandDeps,
} from "./commands.js";

export {
  formatDuration,
  formatError,
  formatStatus,
  formatTaskDetail,
  formatTaskLine,
  formatTaskListHeader,
  type FormatOptions,
} from "./format.js";
