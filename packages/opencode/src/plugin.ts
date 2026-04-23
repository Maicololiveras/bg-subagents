/**
 * @maicolextic/bg-subagents-opencode — default export (PluginModule).
 *
 * OpenCode boots the plugin by:
 *   const mod = (await import("@maicolextic/bg-subagents-opencode")).default;
 *   const hooks = await mod.server(ctx);
 *
 * The `server(ctx)` function returns a `Hooks` object wired to the live
 * session. Legacy path (OpenCode pre-1.14) is implemented in
 * `host-compat/legacy/index.ts` as `buildLegacyHooks`. The v14 path will
 * land in Phase 10 of the opencode-plan-review-live-control change and
 * route via `detectHostVersion(ctx)`.
 *
 * `buildServer` is kept as a back-compat alias for existing callers and
 * tests — it delegates to `buildLegacyHooks`. Overrides shape is the
 * same, re-exported as `BuildServerOverrides`.
 */

import {
  buildLegacyHooks,
  type BuildLegacyHooksOverrides,
} from "./host-compat/legacy/index.js";
import type { Hooks, PluginModule, PluginServerContext } from "./types.js";

// -----------------------------------------------------------------------------
// Back-compat re-exports
// -----------------------------------------------------------------------------

export type BuildServerOverrides = BuildLegacyHooksOverrides;

export async function buildServer(
  ctx: PluginServerContext,
  overrides: BuildServerOverrides = {},
): Promise<Hooks> {
  return buildLegacyHooks(ctx, overrides);
}

// -----------------------------------------------------------------------------
// Default PluginModule export
// -----------------------------------------------------------------------------

const pluginModule: PluginModule = {
  async server(ctx: PluginServerContext): Promise<Hooks> {
    return buildServer(ctx);
  },
};

export default pluginModule;
