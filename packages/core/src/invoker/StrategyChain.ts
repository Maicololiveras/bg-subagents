/**
 * StrategyChain — aggregates ordered `BackgroundStrategy` children and picks
 * the first whose `canInvokeInBackground(spec)` returns true when asked to
 * rewrite a background invocation. OR-merges capability flags across children
 * so host adapters can expose a single probe surface.
 *
 * Foreground mode is a NOOP passthrough regardless of children — `mode ===
 * "foreground"` always resolves to `{}` because nothing needs rewriting when
 * the user explicitly declined backgrounding.
 */
import type {
  BackgroundInvoker,
  BackgroundStrategy,
  InvocationRewrite,
  InvocationSpec,
  Mode,
  StrategyCapabilities,
} from "./BackgroundInvoker.js";
import { NoViableStrategyError } from "./BackgroundInvoker.js";

export class StrategyChain implements BackgroundInvoker {
  public readonly name: string;
  readonly #children: ReadonlyArray<BackgroundStrategy>;

  constructor(children: ReadonlyArray<BackgroundStrategy>) {
    if (children.length === 0) {
      throw new Error("StrategyChain requires at least one strategy");
    }
    this.#children = children;
    this.name = `chain(${children.map((c) => c.name).join(",")})`;
  }

  public async capabilities(
    host_context?: Readonly<Record<string, unknown>>,
  ): Promise<StrategyCapabilities> {
    const caps = await Promise.all(this.#children.map((c) => c.capabilities(host_context)));
    return {
      supports_native_bg: caps.some((c) => c.supports_native_bg),
      supports_subagent_swap: caps.some((c) => c.supports_subagent_swap),
      supports_prompt_injection: caps.some((c) => c.supports_prompt_injection),
      name: this.name,
    };
  }

  public async canInvokeInBackground(spec: InvocationSpec): Promise<boolean> {
    for (const child of this.#children) {
      if (await child.canInvokeInBackground(spec)) {
        return true;
      }
    }
    return false;
  }

  public async invokeRewrite(spec: InvocationSpec, mode: Mode): Promise<InvocationRewrite> {
    // Foreground / ask paths don't touch the call — identity passthrough.
    if (mode !== "background") {
      return {};
    }
    for (const child of this.#children) {
      if (await child.canInvokeInBackground(spec)) {
        return child.invokeRewrite(spec, mode);
      }
    }
    throw new NoViableStrategyError(
      spec,
      `no child strategy could background-invoke (tried: ${this.#children.map((c) => c.name).join(", ")})`,
    );
  }
}
