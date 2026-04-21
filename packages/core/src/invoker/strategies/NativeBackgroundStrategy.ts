/**
 * NativeBackgroundStrategy — placeholder strategy for hosts that expose a
 * first-class `background: true` flag on their subagent tool call.
 *
 * v0.1 ships this as a scaffold: adapters opt in by setting
 * `host_context.native_bg_supported === true` before invoking the chain. The
 * real feature-detection probe (Claude Code schema sniff) lands in the
 * `@bg-subagents/claude-code` adapter batches.
 *
 * Capability memoization: `capabilities()` is identity-keyed on the
 * `host_context` reference. Callers that reuse the same object across calls
 * hit the cache (see `cacheHits`).
 */
import type {
  BackgroundStrategy,
  InvocationRewrite,
  InvocationSpec,
  Mode,
  StrategyCapabilities,
} from "../BackgroundInvoker.js";

/** Sentinel used when the caller omits a `host_context`. */
const NO_HOST_CONTEXT: Readonly<Record<string, unknown>> = Object.freeze({});

export class NativeBackgroundStrategy implements BackgroundStrategy {
  public readonly name = "native";

  /**
   * Identity-keyed capability cache. Exposed as a read-only counter so tests
   * can assert hit rates without probing internals.
   */
  readonly #capsCache = new WeakMap<object, StrategyCapabilities>();
  #cacheHits = 0;

  public get cacheHits(): number {
    return this.#cacheHits;
  }

  public async capabilities(
    host_context?: Readonly<Record<string, unknown>>,
  ): Promise<StrategyCapabilities> {
    const ctx = host_context ?? NO_HOST_CONTEXT;
    const cached = this.#capsCache.get(ctx);
    if (cached !== undefined) {
      this.#cacheHits += 1;
      return cached;
    }
    const supports_native_bg = ctx["native_bg_supported"] === true;
    const caps: StrategyCapabilities = Object.freeze({
      supports_native_bg,
      supports_subagent_swap: false,
      supports_prompt_injection: false,
      name: this.name,
    });
    this.#capsCache.set(ctx, caps);
    return caps;
  }

  public async canInvokeInBackground(spec: InvocationSpec): Promise<boolean> {
    const ctx = spec.host_context ?? NO_HOST_CONTEXT;
    return ctx["native_bg_supported"] === true;
  }

  public async invokeRewrite(spec: InvocationSpec, mode: Mode): Promise<InvocationRewrite> {
    if (mode !== "background") {
      return {};
    }
    void spec;
    return {
      extra_input: { background: true },
      note: "native host-supported background flag set",
    };
  }
}
