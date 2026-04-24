/**
 * Public barrel for @maicolextic/bg-subagents-opencode.
 *
 * Consumers import from the root; OpenCode itself picks up the default export
 * (the `PluginModule`) via `import … from "@maicolextic/bg-subagents-opencode"`.
 */

export { default, buildServer, type BuildServerOverrides } from "./plugin.js";

export {
  buildHostContext,
  clearHostContext,
  __resetHostContextCacheForTests,
  type BuildHostContextCaps,
  type OpenCodeHostContext,
} from "./host-context.js";

export { OpenCodeTaskSwapStrategy } from "./strategies/OpenCodeTaskSwapStrategy.js";

export {
  registerTaskBgTool,
  type RegisterTaskBgOpts,
  type RunOpenCodeSubagent,
  type TaskBgInput,
  type TaskBgResult,
} from "./host-compat/legacy/tool-register.js";

export {
  interceptTaskTool,
  type InterceptTaskFn,
  type InterceptTaskOpts,
} from "./host-compat/legacy/tool-before.js";

export { steerChatParams, type SteerChatParamsFn, type SteerChatParamsOpts } from "./host-compat/legacy/chat-params.js";

export {
  wireBusEvents,
  TASK_COMPLETE_BUS_EVENT,
  type WireBusEventsHandle,
  type WireBusEventsOpts,
} from "./host-compat/legacy/event.js";

export {
  chatMessageFallback,
  DEFAULT_ACK_TIMEOUT_MS,
  type ChatMessageFallbackHandle,
  type ChatMessageFallbackOpts,
} from "./host-compat/legacy/chat-message-fallback.js";

export {
  handleTaskSlashCommand,
  parseTaskCommand,
  type ParseResult,
  type ParsedFlags,
  type TaskCommandDeps,
  type TaskSubcommand,
} from "./host-compat/legacy/task-command.js";

export { runOpenCodeSubagent } from "./runtime.js";

export type {
  Bus,
  BusEvent,
  HookToolDefinition,
  Hooks,
  HooksChatParamsInput,
  HooksChatParamsResult,
  HooksToolBeforeInput,
  HooksToolBeforeResult,
  HostLogger,
  PluginModule,
  PluginServerContext,
  SessionApi,
  SessionCreateOpts,
  SessionHandle,
  SessionPromptOpts,
  ToolContext,
} from "./types.js";
