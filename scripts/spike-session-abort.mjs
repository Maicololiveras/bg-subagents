// @ts-check
/**
 * Spike SQ-1 — client.session.abort cancels in-flight tool execution
 *
 * Goal: verify that calling `client.session.abort({sessionID})` while a tool is
 * actively executing causes `ToolContext.abort: AbortSignal` to fire, allowing
 * cooperative cancellation inside the tool.
 *
 * Types verified:
 *   sdk.gen.d.ts:600 — Session.abort({sessionID, directory?})
 *   plugin/dist/tool.d.ts:17 — ToolContext.abort: AbortSignal
 *
 * Observe:
 *   (a) Does ctx.abort.aborted flip to true after client.session.abort fires?
 *   (b) How fast? (latency between abort call and signal firing)
 *   (c) Does the tool's return value still matter, or is it discarded?
 *   (d) Does the session recover to accept new prompts after abort?
 *
 * Execution (Michael runs this):
 *   1. Backup your ~/.config/opencode/opencode.json.
 *   2. Replace the "plugin" array with:
 *        "plugin": ["file:///C:/SDK/bg-subagents/scripts/spike-session-abort.mjs"]
 *   3. Start opencode, open a session.
 *   4. Ask the agent:
 *        "invoke the spike_slow tool"
 *      The tool starts a 60s cooperative loop and self-aborts at 3s by calling
 *      client.session.abort on its own session.
 *   5. Expected GO: tool finishes in ~3-4s, log shows aborted=true after the
 *      self-abort call.
 *      Expected NO-GO: tool runs the full 60s ignoring the abort (AbortSignal
 *      never propagates), OR prompt hangs and session becomes unresponsive.
 *   6. After completion, try a follow-up prompt like "say hi" — does the
 *      session respond normally or is it wedged?
 *   7. Alternative flow: if you want to test EXTERNAL abort instead of
 *      self-abort, pass arg { external: true } via the agent — the tool will
 *      NOT self-abort and will run 60s. You then need to trigger abort from
 *      somewhere else (another terminal: `curl -X POST {serverUrl}/session/{id}/abort`
 *      — serverUrl is logged at BOOT).
 *   8. Restore opencode.json. Paste docs/spikes/sq-1-output.log.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG_PATH = resolve(__dirname, "..", "docs", "spikes", "sq-1-output.log");
const MARKER = "[SPIKE-SQ1]";

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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** @type {import("@opencode-ai/plugin").PluginModule} */
const spike = {
  id: "spike-sq-1-session-abort",
  async server(input) {
    const { client, serverUrl } = input;
    log(
      `BOOT server() pid=${process.pid} serverUrl=${serverUrl} client.session=${typeof client?.session}`,
    );

    let invocationCount = 0;

    return {
      tool: {
        spike_slow: {
          description:
            "Spike SQ-1. Runs a 60s cooperative loop. By default self-aborts its session after ~3s to verify ctx.abort propagates. Pass {external:true} to skip self-abort (useful for testing external abort).",
          args: {},
          async execute(args, ctx) {
            invocationCount += 1;
            const invId = `inv#${invocationCount}`;
            const external = Boolean(args?.external);
            const sessionID = ctx?.sessionID;
            log(
              `${invId} START sessionID=${sessionID} external=${external} abort.aborted=${ctx?.abort?.aborted}`,
            );

            const t0 = Date.now();
            let tick = 0;
            const maxTicks = 60;
            let selfAbortFired = false;

            while (tick < maxTicks && !ctx?.abort?.aborted) {
              tick += 1;
              const elapsed = Date.now() - t0;
              log(
                `${invId} TICK ${tick} elapsed=${elapsed}ms aborted=${ctx?.abort?.aborted}`,
              );

              if (!external && !selfAbortFired && tick === 3) {
                log(`${invId} SELF-ABORT firing client.session.abort...`);
                selfAbortFired = true;
                try {
                  const res = await client.session.abort({ sessionID });
                  log(`${invId} SELF-ABORT call resolved res=${JSON.stringify(res).slice(0, 300)}`);
                } catch (err) {
                  log(`${invId} SELF-ABORT THREW ${err?.name}: ${err?.message}`);
                }
              }

              await sleep(1000);
            }

            const totalElapsed = Date.now() - t0;
            const exitReason = ctx?.abort?.aborted
              ? "ctx.abort.aborted=true"
              : `max ticks reached (${maxTicks})`;
            log(
              `${invId} EXIT reason=${exitReason} totalElapsed=${totalElapsed}ms ticks=${tick}`,
            );

            return {
              output: `spike_slow done — ${exitReason} after ${totalElapsed}ms (${tick} ticks). Check docs/spikes/sq-1-output.log.`,
            };
          },
        },

        spike_abort_now: {
          description:
            "Spike SQ-1 helper. Calls client.session.abort on the current session. Use this if you want to verify external-abort flow by invoking spike_slow({external:true}) first, then this tool — but note the LLM cannot invoke this while spike_slow is running (session is busy).",
          args: {},
          async execute(_args, ctx) {
            const sessionID = ctx?.sessionID;
            log(`HELPER spike_abort_now called sessionID=${sessionID}`);
            try {
              const res = await client.session.abort({ sessionID });
              log(`HELPER abort resolved res=${JSON.stringify(res).slice(0, 300)}`);
              return { output: `abort fired on ${sessionID}` };
            } catch (err) {
              log(`HELPER abort THREW ${err?.name}: ${err?.message}`);
              return { output: `abort threw: ${err?.message}` };
            }
          },
        },
      },
    };
  },
};

export default spike;
