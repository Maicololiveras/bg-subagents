/**
 * Countdown helper shared by picker implementations.
 *
 * Design §3.1. Fires `onTick` every 100 ms with remaining/elapsed ms; fires
 * `onExpire` exactly once when the total time elapses; honours an optional
 * external `AbortSignal` so higher-level cancellation paths can unwind the
 * countdown without manual bookkeeping.
 *
 * Guarantees (tested in `timeout.test.ts`):
 *  - `onExpire` fires AT MOST once, even under fake-timer abuse.
 *  - `cancel()` stops both ticks and the expiry callback.
 *  - External abort acts identically to `cancel()`.
 */
const TICK_INTERVAL_MS = 100;

export interface CountdownTick {
  readonly remainingMs: number;
  readonly elapsedMs: number;
}

export interface CountdownOpts {
  readonly ms: number;
  readonly onTick: (tick: CountdownTick) => void;
  readonly onExpire: () => void;
  readonly signal?: AbortSignal;
}

export interface CountdownHandle {
  cancel(): void;
}

export function createCountdown(opts: CountdownOpts): CountdownHandle {
  const { ms, onTick, onExpire, signal } = opts;
  const start = Date.now();
  let settled = false;
  let interval: ReturnType<typeof setInterval> | null = null;
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let abortListener: (() => void) | null = null;

  const cleanup = (): void => {
    if (interval !== null) {
      clearInterval(interval);
      interval = null;
    }
    if (timeout !== null) {
      clearTimeout(timeout);
      timeout = null;
    }
    if (abortListener !== null && signal !== undefined) {
      signal.removeEventListener("abort", abortListener);
      abortListener = null;
    }
  };

  const cancel = (): void => {
    if (settled) return;
    settled = true;
    cleanup();
  };

  if (signal !== undefined) {
    if (signal.aborted) {
      settled = true;
      return { cancel };
    }
    abortListener = () => cancel();
    signal.addEventListener("abort", abortListener, { once: true });
  }

  if (ms <= 0) {
    // Fire expiry asynchronously so the caller can wire up handles first.
    timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      onExpire();
    }, 0);
    return { cancel };
  }

  interval = setInterval(() => {
    if (settled) return;
    const elapsedMs = Date.now() - start;
    const remainingMs = Math.max(0, ms - elapsedMs);
    onTick({ remainingMs, elapsedMs });
  }, TICK_INTERVAL_MS);

  timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    cleanup();
    onExpire();
  }, ms);

  return { cancel };
}
