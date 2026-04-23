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

import { createLogger } from "@maicolextic/bg-subagents-core";

import {
  buildLegacyHooks,
  type BuildLegacyHooksOverrides,
} from "./host-compat/legacy/index.js";
import { buildV14Hooks } from "./host-compat/v14/index.js";
import { detectHostVersion } from "./host-compat/version-detect.js";
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
// Default PluginModule export — routes via detectHostVersion
// -----------------------------------------------------------------------------

const pluginModule: PluginModule = {
  async server(ctx: PluginServerContext): Promise<Hooks> {
    const logger = createLogger({});
    const version = detectHostVersion(ctx, { logger });
    if (version === "v14") {
      logger.info("host-compat:routed", { version });
      return (await buildV14Hooks(ctx as never, { logger })) as unknown as Hooks;
    }
    if (version === "legacy") {
      logger.info("host-compat:routed", { version });
      return buildLegacyHooks(ctx);
    }
    // Unknown — spec says warn + attempt legacy fallback, then empty hooks.
    logger.warn("host-compat:unknown-api", {
      ctx_keys: ctx && typeof ctx === "object" ? Object.keys(ctx) : [],
    });
    try {
      return await buildLegacyHooks(ctx);
    } catch (err) {
      logger.warn("host-compat:unknown-legacy-fallback-failed", {
        error: err instanceof Error ? err.message : String(err),
      });
      return {};
    }
  },
};

export default pluginModule;
