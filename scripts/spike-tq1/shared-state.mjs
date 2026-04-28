// @ts-check
/**
 * Shared state for Spike TQ-1.
 *
 * If this module is loaded ONCE (single Node process, single module URL
 * resolution), both the server entry and the tui entry share the same
 * `state` object and `INIT_TOKEN` constant.
 *
 * If OpenCode loads server and tui in separate processes (or separate
 * module graphs with isolated caches), each entry will see its OWN copy
 * of this module — INIT_TOKEN will differ between them.
 */

export const INIT_TOKEN = `${process.pid}-${Math.random().toString(36).slice(2, 10)}`;
export const INIT_TIME = Date.now();

/** @type {{
 *   counter: number;
 *   writes: Array<{ from: string; at: number; pid: number }>;
 * }} */
export const state = {
  counter: 0,
  writes: [],
};

export function bumpCounter(from) {
  state.counter += 1;
  state.writes.push({ from, at: Date.now(), pid: process.pid });
  return state.counter;
}
