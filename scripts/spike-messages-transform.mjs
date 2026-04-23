// @ts-check
/**
 * Spike EQ-1 — experimental.chat.messages.transform
 *
 * Goal: verify at runtime on OpenCode 1.14.22 that the
 * `experimental.chat.messages.transform` plugin hook:
 *   (a) fires pre-LLM-execution (i.e. before the assistant replies)
 *   (b) receives a mutable `output.messages: {info, parts}[]`
 *   (c) persists part additions and removals into the actual turn
 *
 * Types verified statically (sdd/opencode-plan-review-live-control/verification/types):
 *   plugin/dist/index.d.ts:255-260
 *   (input: {}, output: { messages: [{info: Message, parts: Part[]}] }) => Promise<void>
 *
 * Execution (Michael runs this):
 *   1. Backup your current ~/.config/opencode/opencode.json.
 *   2. Replace the "plugin" array with:
 *        "plugin": ["file:///C:/SDK/bg-subagents/scripts/spike-messages-transform.mjs"]
 *      (Keep the rest of the config intact — agents, etc.)
 *   3. Start `opencode` and open a session.
 *   4. Send ANY short prompt (e.g. "hello").
 *   5. WATCH the UI. Read `docs/spikes/eq-1-output.log`.
 *   6. Send 2-3 more prompts so we see multiple invocations.
 *   7. Restore your original opencode.json.
 *   8. Paste the full log file back to me.
 *
 * What to look for in the UI:
 *   - After you submit a prompt, BEFORE the assistant starts replying, does a
 *     red marker text appear appended to your own message? That confirms (c) add.
 *   - Does a neutral marker disappear from the message if added previously?
 *     That confirms (c) remove.
 *
 * What the log should contain per fire:
 *   - timestamp
 *   - input keys (should be "[]" — empty object)
 *   - output.messages length + shape snapshot
 *   - each message's info.role + parts.length
 *   - mutation performed
 *   - output.messages length + shape AFTER mutation (local view)
 *
 * GO  => hook fires, `output.messages` contains the user turn, our mutation is
 *        visible in the UI transcript.
 * NO-GO => hook never fires, OR mutation is ignored (UI shows original parts).
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "..", "docs", "spikes", "eq-1-output.log");
const MARKER = "[SPIKE-EQ1]";

function ensureLogDir() {
  try {
    mkdirSync(dirname(LOG_PATH), { recursive: true });
  } catch {}
}

function log(entry) {
  ensureLogDir();
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  try {
    appendFileSync(LOG_PATH, line, "utf8");
  } catch (err) {
    console.error(`${MARKER} log write failed:`, err);
  }
  console.error(`${MARKER} ${entry}`);
}

function safeShape(value, depth = 0) {
  if (depth > 3) return "<depth-cut>";
  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `Array(${value.length})`;
  const t = typeof value;
  if (t !== "object") return t;
  const keys = Object.keys(value);
  return `{${keys.slice(0, 8).join(",")}${keys.length > 8 ? ",…" : ""}}`;
}

/** @type {import("@opencode-ai/plugin").PluginModule} */
const spike = {
  id: "spike-eq-1-messages-transform",
  async server(input) {
    log(
      `BOOT server() called — PluginInput keys=[${Object.keys(input).join(",")}] pid=${process.pid}`,
    );
    log(
      `BOOT project=${safeShape(input.project)} directory=${input.directory} worktree=${input.worktree} serverUrl=${input.serverUrl}`,
    );

    let fireCount = 0;

    return {
      "experimental.chat.messages.transform": async (hookInput, hookOutput) => {
        fireCount += 1;
        const fireId = `fire#${fireCount}`;

        log(`${fireId} FIRED input=${JSON.stringify(hookInput)}`);

        const msgs = hookOutput?.messages ?? [];
        log(`${fireId} output.messages.length=${msgs.length}`);

        msgs.forEach((m, i) => {
          const role = m?.info?.role ?? "<no-role>";
          const partsLen = Array.isArray(m?.parts) ? m.parts.length : -1;
          const partTypes = Array.isArray(m?.parts)
            ? m.parts.map((p) => p?.type ?? "?").join(",")
            : "<not-array>";
          log(
            `${fireId}   msg[${i}] role=${role} parts.length=${partsLen} types=[${partTypes}]`,
          );
        });

        // MUTATION: append a synthetic text part to the LAST user message's parts
        // array if there is one. If the hook's mutation persists, this text
        // should be visible in the UI's transcript of the user turn.
        const lastUserIdx = [...msgs]
          .map((m, i) => ({ m, i }))
          .reverse()
          .find(({ m }) => m?.info?.role === "user")?.i;

        if (lastUserIdx !== undefined) {
          const before = msgs[lastUserIdx]?.parts?.length ?? -1;
          msgs[lastUserIdx]?.parts?.push({
            type: "text",
            text: `${MARKER} mutation from plugin ${fireId}`,
          });
          const after = msgs[lastUserIdx]?.parts?.length ?? -1;
          log(
            `${fireId} MUTATION appended text part to msg[${lastUserIdx}] parts.length before=${before} after=${after}`,
          );
        } else {
          log(`${fireId} MUTATION skipped — no user message found`);
        }

        log(`${fireId} DONE`);
      },

      // Canary hook — if BOOT logs appear but messages.transform never fires,
      // this hook confirms the plugin IS loaded and the hook system IS working.
      "chat.params": async (_inp, _out) => {
        log(`CANARY chat.params fired — plugin is loaded, hooks do fire`);
      },
    };
  },
};

export default spike;
