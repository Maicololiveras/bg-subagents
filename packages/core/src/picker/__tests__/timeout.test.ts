/**
 * RED gate for `src/picker/timeout.ts`.
 *
 * Covers Batch 4 spec §1.b — countdown helper that ticks every 100 ms, expires
 * once, honours external AbortSignal, and reports elapsed/remaining accurately.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCountdown } from "../timeout.js";

describe("createCountdown()", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ticks every ~100ms until expire", () => {
    const ticks: number[] = [];
    const expireSpy = vi.fn();
    const countdown = createCountdown({
      ms: 1000,
      onTick: ({ remainingMs }) => ticks.push(remainingMs),
      onExpire: expireSpy,
    });
    vi.advanceTimersByTime(1000);
    countdown.cancel();
    // 1000ms / 100ms = 10 ticks; allow small jitter tolerance.
    expect(ticks.length).toBeGreaterThanOrEqual(8);
    expect(ticks.length).toBeLessThanOrEqual(11);
    expect(expireSpy).toHaveBeenCalledTimes(1);
  });

  it("fires onExpire exactly once even if timer bleed occurs", () => {
    const expireSpy = vi.fn();
    createCountdown({
      ms: 300,
      onTick: () => undefined,
      onExpire: expireSpy,
    });
    vi.advanceTimersByTime(5000); // way past expiry
    expect(expireSpy).toHaveBeenCalledTimes(1);
  });

  it("cancel() stops future ticks and prevents onExpire", () => {
    const tickSpy = vi.fn();
    const expireSpy = vi.fn();
    const countdown = createCountdown({
      ms: 1000,
      onTick: tickSpy,
      onExpire: expireSpy,
    });
    vi.advanceTimersByTime(250);
    const ticksBefore = tickSpy.mock.calls.length;
    countdown.cancel();
    vi.advanceTimersByTime(5000);
    expect(tickSpy.mock.calls.length).toBe(ticksBefore);
    expect(expireSpy).not.toHaveBeenCalled();
  });

  it("external AbortSignal cancels the countdown like .cancel()", () => {
    const tickSpy = vi.fn();
    const expireSpy = vi.fn();
    const controller = new AbortController();
    createCountdown({
      ms: 1000,
      onTick: tickSpy,
      onExpire: expireSpy,
      signal: controller.signal,
    });
    vi.advanceTimersByTime(200);
    controller.abort();
    vi.advanceTimersByTime(5000);
    expect(expireSpy).not.toHaveBeenCalled();
  });

  it("produces 18-22 ticks over 2000ms at 100ms cadence", () => {
    const ticks: number[] = [];
    createCountdown({
      ms: 2000,
      onTick: ({ remainingMs }) => ticks.push(remainingMs),
      onExpire: () => undefined,
    });
    vi.advanceTimersByTime(2000);
    expect(ticks.length).toBeGreaterThanOrEqual(18);
    expect(ticks.length).toBeLessThanOrEqual(22);
  });

  it("onTick receives accurate remainingMs + elapsedMs", () => {
    const samples: Array<{ remainingMs: number; elapsedMs: number }> = [];
    createCountdown({
      ms: 500,
      onTick: (s) => samples.push({ remainingMs: s.remainingMs, elapsedMs: s.elapsedMs }),
      onExpire: () => undefined,
    });
    vi.advanceTimersByTime(500);
    expect(samples.length).toBeGreaterThan(0);
    for (const s of samples) {
      expect(s.remainingMs).toBeGreaterThanOrEqual(0);
      expect(s.elapsedMs).toBeGreaterThanOrEqual(0);
      expect(s.remainingMs + s.elapsedMs).toBeGreaterThanOrEqual(400);
      expect(s.remainingMs + s.elapsedMs).toBeLessThanOrEqual(600);
    }
  });
});
