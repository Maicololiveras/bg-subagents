/**
 * TUI-native plan-review dialog — Phase 12.2 GREEN.
 *
 * Exports `createTuiPlanPicker(api, options?)` returning a `PlanPicker` that
 * presents one `DialogSelect` dialog per batch entry, cycling through entries
 * sequentially (single-select workaround — DialogSelect is not multi-select).
 *
 * ## Coexistence with PolicyResolver (ADR-9, OQ-1 amendment)
 *
 * This picker is ADDITIVE on top of the server-side PolicyResolver
 * (Candidate 7). PolicyResolver decisions are passed as `defaultDecisions`
 * and serve as the fallback for cancel and timeout paths. The TUI picker only
 * fires in interactive sessions where the user is actively watching the TUI.
 * Server-only / headless flows are unaffected — they never call `pickPlan`.
 *
 * ## UX — single-select cycle design decision
 *
 * `api.ui.DialogSelect` is a single-select component. To collect per-entry
 * BG/FG decisions we cycle through entries:
 *   1. `api.ui.dialog.replace(render, onClose)` shows "Entry 1 of N — <name>"
 *   2. User picks BG or FG → option.onSelect fires → decision accumulated.
 *   3. Implementation replaces dialog with entry 2, repeating until all done.
 *   4. After final selection dialog.clear() is called and the promise resolves.
 *
 * ## Cancel / Esc
 *
 * If the user presses Esc (onClose callback fires) at any step, the cycle
 * aborts, dialog.clear() is called, and `pickPlan` resolves with
 * `{ cancelled: true, decisions: defaultDecisions ?? [] }`.
 *
 * ## Timeout
 *
 * If no interaction occurs within `timeoutMs` (default 30 000ms), `pickPlan`
 * resolves with `{ cancelled: true, decisions: defaultDecisions ?? [] }`.
 * A warning is emitted via `createLogger` — NEVER via console.log / stdout.
 *
 * ## Zero stdout guarantee
 *
 * All diagnostics route through `createLogger("tui-plugin:plan-review")`.
 * No `console.log`, `console.error`, or `process.stdout.write` anywhere.
 *
 * Spec: tasks.md Phase 12.1 / 12.2
 * Design: design.md ADR-9 + OQ-1 amendment
 */

import { createLogger } from "@maicolextic/bg-subagents-core";
import type { BatchEntry, PolicyDecision } from "../plan-review/types.js";

// ---------------------------------------------------------------------------
// Logger — file-routed, zero stdout in production
// ---------------------------------------------------------------------------

const log = createLogger("tui-plugin:plan-review");

// ---------------------------------------------------------------------------
// PlanPicker — public interface for the TUI picker
//
// NOTE: PlanPicker was removed from plan-review/types.ts per OQ-1 resolution
// (no interactive picker in the server path for v1.0). It is defined HERE
// because it belongs to the TUI layer — the server path has no picker.
// Future phases (v1.1 Candidate 6) may promote this to a shared location.
// ---------------------------------------------------------------------------

export interface PickPlanResult {
  /** true if the user cancelled (Esc) or the timeout elapsed */
  cancelled: boolean;
  /** accumulated decisions — equals defaultDecisions on cancel/timeout */
  decisions: PolicyDecision[];
}

export interface PlanPicker {
  /**
   * Show the per-entry BG/FG picker dialog for the given batch.
   * Resolves once all entries are decided, or on cancel/timeout.
   */
  pickPlan(batch: BatchEntry[]): Promise<PickPlanResult>;
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface TuiPlanPickerOptions {
  /** Milliseconds before the picker times out and resolves with defaults. Default: 30_000. */
  timeoutMs?: number;
  /**
   * Fallback decisions used on cancel (Esc) or timeout.
   * Typically the PolicyResolver decisions for this batch.
   * If not provided, resolves with an empty array.
   */
  defaultDecisions?: PolicyDecision[];
}

// ---------------------------------------------------------------------------
// Minimal TuiPluginApi surface we depend on (avoids peer-dep import at
// module-load time — the full API is passed in at runtime).
// ---------------------------------------------------------------------------

type DialogSelectOption<Value = unknown> = {
  title: string;
  value: Value;
  description?: string;
  onSelect?: () => void;
};

type JsxElement = unknown; // opaque — we only produce it, never inspect it

type DialogSelectProps<Value = unknown> = {
  title: string;
  options: DialogSelectOption<Value>[];
  onSelect?: (option: DialogSelectOption<Value>) => void;
};

type DialogStack = {
  replace: (render: () => JsxElement, onClose?: () => void) => void;
  clear: () => void;
};

type MinimalTuiApi = {
  ui: {
    DialogSelect: <Value = unknown>(props: DialogSelectProps<Value>) => JsxElement;
    dialog: DialogStack;
  };
};

// ---------------------------------------------------------------------------
// Option value shape
// ---------------------------------------------------------------------------

type OptionValue = {
  mode: "background" | "foreground";
  entry: BatchEntry;
};

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a TUI plan picker backed by `api.ui.dialog.replace` + `api.ui.DialogSelect`.
 *
 * @param api - TuiPluginApi (passed as `never` in tests to avoid peer-dep resolution;
 *              cast to MinimalTuiApi internally).
 * @param options - Optional configuration (timeout, default decisions).
 */
export function createTuiPlanPicker(
  api: MinimalTuiApi,
  options?: TuiPlanPickerOptions,
): PlanPicker {
  const timeoutMs = options?.timeoutMs ?? 30_000;
  const defaultDecisions = options?.defaultDecisions ?? [];

  return {
    pickPlan(batch: BatchEntry[]): Promise<PickPlanResult> {
      // Fast path: empty batch → resolve immediately, no dialog needed.
      if (batch.length === 0) {
        return Promise.resolve({ cancelled: false, decisions: [] });
      }

      return new Promise<PickPlanResult>((resolve) => {
        const accumulated: PolicyDecision[] = [];
        let settled = false;

        // ----------------------------------------------------------------
        // Settle helpers — ensure we resolve exactly once
        // ----------------------------------------------------------------

        function settle(result: PickPlanResult): void {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          api.ui.dialog.clear();
          resolve(result);
        }

        function cancelWithDefaults(): void {
          log.warn("TUI plan picker cancelled — falling back to PolicyResolver defaults");
          settle({ cancelled: true, decisions: defaultDecisions });
        }

        // ----------------------------------------------------------------
        // Timeout guard
        // ----------------------------------------------------------------

        const timer = setTimeout(() => {
          if (!settled) {
            log.warn(
              `TUI plan picker timed out after ${timeoutMs}ms — falling back to PolicyResolver defaults`,
            );
            settle({ cancelled: true, decisions: defaultDecisions });
          }
        }, timeoutMs);

        // ----------------------------------------------------------------
        // Cycle — show dialog for each entry in sequence
        // ----------------------------------------------------------------

        function showEntry(index: number): void {
          if (settled) return;

          const entry = batch[index]!;
          const total = batch.length;
          const humanIndex = index + 1;

          const title = `Plan Review — ${humanIndex} of ${total} — ${entry.agent_name}`;

          const options: DialogSelectOption<OptionValue>[] = [
            {
              title: "Background",
              description: "Run as a background subagent (task_bg)",
              value: { mode: "background", entry },
              onSelect(): void {
                accumulated.push({
                  call_id: entry.call_id,
                  agent_name: entry.agent_name,
                  mode: "background",
                });
                advance(index);
              },
            },
            {
              title: "Foreground",
              description: "Run inline in the current session (task)",
              value: { mode: "foreground", entry },
              onSelect(): void {
                accumulated.push({
                  call_id: entry.call_id,
                  agent_name: entry.agent_name,
                  mode: "foreground",
                });
                advance(index);
              },
            },
          ];

          api.ui.dialog.replace(
            () => api.ui.DialogSelect({ title, options }),
            cancelWithDefaults,
          );
        }

        function advance(completedIndex: number): void {
          const nextIndex = completedIndex + 1;
          if (nextIndex < batch.length) {
            // Show the next entry's dialog
            showEntry(nextIndex);
          } else {
            // All entries decided — resolve with the accumulated decisions
            settle({ cancelled: false, decisions: accumulated });
          }
        }

        // Kick off the cycle at entry 0
        showEntry(0);
      });
    },
  };
}
