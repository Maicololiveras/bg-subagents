// @ts-check
/**
 * Spike DQ-1 — client.session.prompt({ noReply: true })
 *
 * Goal: verify at runtime what `noReply: true` actually does. The type says:
 *   plugin/dist/v2/gen/sdk.gen.d.ts:666-684 — prompt({ sessionID, noReply?, parts?, ... })
 *   also on promptAsync at :712-730.
 *
 * Observe:
 *   (a) Does setting noReply:true skip the LLM turn entirely (no assistant
 *       stream, no assistant message appended)?
 *   (b) Does the `parts` payload still land in the session transcript as a
 *       user turn? (Can we use this as a synthetic-delivery channel?)
 *   (c) What does the promise resolve to? (messageID? undefined? error?)
 *   (d) If the session has a running stream, does noReply interrupt it or
 *       queue?
 *
 * Execution (Michael runs this):
 *   1. Backup your current ~/.config/opencode/opencode.json.
 *   2. Replace the "plugin" array with:
 *        "plugin": ["file:///C:/SDK/bg-subagents/scripts/spike-noreply-prompt.mjs"]
 *   3. Start `opencode`, open a session, send ANY small prompt (e.g. "hi")
 *      so there IS a sessionID for the tool to use.
 *   4. After the assistant replies, run the tool by asking:
 *          "invoke the spike_dq1 tool please"
 *      (or however your agent invokes a listed tool).
 *   5. Observe:
 *      - Does a new user message appear with the text "SPIKE-DQ1 synthetic
 *        delivery {n}"?
 *      - Does the assistant start streaming a reply? (should NOT)
 *      - Any error banner in the UI?
 *   6. Send the tool 2-3 more times to see determinism.
 *   7. Restore opencode.json. Paste docs/spikes/dq-1-output.log.
 *
 * GO  => parts land as user turn, no assistant stream follows.
 * NO-GO => tool throws, OR assistant does stream anyway, OR parts don't appear.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "..", "docs", "spikes", "dq-1-output.log");
const MARKER = "[SPIKE-DQ1]";

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

// Try to resolve zod via the plugin host's own bundled copy.
// If this fails, we fall back to an empty `args: {}` and log the outcome.
let z = null;
try {
  const toolMod = await import("@opencode-ai/plugin/tool");
  z = toolMod?.tool?.schema ?? null;
  log(`BOOT resolved zod via @opencode-ai/plugin/tool — typeof z=${typeof z}`);
} catch (err) {
  log(`BOOT could NOT resolve @opencode-ai/plugin/tool — ${err?.message ?? err}`);
}

/** @type {import("@opencode-ai/plugin").PluginModule} */
const spike = {
  id: "spike-dq-1-noreply-prompt",
  async server(input) {
    const { client } = input;
    log(
      `BOOT server() PluginInput keys=[${Object.keys(input).join(",")}] pid=${process.pid}`,
    );
    log(`BOOT client typeof=${typeof client} client.session=${typeof client?.session}`);

    let invocationCount = 0;

    const argsShape = z ? {} : {}; // both cases empty; log which path we took
    log(`BOOT tool.args shape will be empty object, z-resolved=${z !== null}`);

    return {
      tool: {
        spike_dq1: {
          description:
            "Spike DQ-1 probe. Calls client.session.prompt({noReply:true}) with a synthetic text part and reports what happens. Takes no arguments.",
          args: argsShape,
          async execute(_args, ctx) {
            invocationCount += 1;
            const invId = `inv#${invocationCount}`;
            log(`${invId} tool invoked ctx.sessionID=${ctx?.sessionID}`);

            const payload = {
              sessionID: ctx.sessionID,
              noReply: true,
              parts: [
                {
                  type: "text",
                  text: `${MARKER} synthetic delivery ${invId}`,
                },
              ],
            };
            log(`${invId} calling client.session.prompt payload=${JSON.stringify(payload)}`);

            const t0 = Date.now();
            try {
              const result = await client.session.prompt(payload);
              const dt = Date.now() - t0;
              log(
                `${invId} prompt resolved dt=${dt}ms result.type=${typeof result} result.keys=[${result ? Object.keys(result).join(",") : "<no-keys>"}]`,
              );
              log(
                `${invId} result body (first 400 chars)=${JSON.stringify(result).slice(0, 400)}`,
              );
              return {
                output: `noReply probe completed in ${dt}ms — see docs/spikes/dq-1-output.log`,
              };
            } catch (err) {
              const dt = Date.now() - t0;
              log(
                `${invId} prompt THREW dt=${dt}ms name=${err?.name} message=${err?.message}`,
              );
              log(`${invId} err stack=${String(err?.stack).slice(0, 600)}`);
              return {
                output: `noReply probe FAILED after ${dt}ms: ${err?.message} — see log`,
              };
            }
          },
        },
      },
    };
  },
};

export default spike;
