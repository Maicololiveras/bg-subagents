/**
 * Actions on active subagent tasks — invoked from command palette entries
 * generated dynamically per task.
 *
 * The CORE move: `moveTaskToBg`. When the orchestrator delegates a task
 * synchronously (via native `task` tool), the parent session blocks waiting
 * for the child to finish. This action:
 *
 *   1. ABORTS the child session via api.client.session.abort
 *      → orchestrator's task tool call returns "cancelled" immediately
 *      → parent unblocks
 *
 *   2. CREATES a new child session via api.client.session.create
 *      → preserves agent type + full skill/MCP powers
 *
 *   3. promptAsync the new child
 *      → returns immediately, child runs in true BG
 *
 *   4. The events subscription (events.ts) tracks the new child
 *      → on session.idle, delivers result to parent via prompt({noReply})
 *
 *   5. Toast confirmation to user
 *
 * Net effect: a synchronous orchestrator delegation is converted, mid-flight,
 * into a true background dispatch — without touching server-side hooks.
 */

import { formatCompactAgentDelivery } from "@maicolextic/bg-subagents-core";
import type { ActiveTask, TaskRegistry } from "./events.js";
import { isProjectedActionEnabled } from "./activity-projection.js";

export interface ActionContext {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  readonly api: any;
  readonly registry: TaskRegistry;
  readonly logger?: {
    info(msg: string, fields?: Record<string, unknown>): void;
    warn(msg: string, fields?: Record<string, unknown>): void;
    error(msg: string, fields?: Record<string, unknown>): void;
  };
}

export function projectedActionEnabled(task: ActiveTask, action: "move-to-BG" | "kill" | "cancel"): boolean {
  return isProjectedActionEnabled(task, action);
}

/** Move an active task from FG (blocking parent) to BG (truly async). */
export async function moveTaskToBg(
  ctx: ActionContext,
  task: ActiveTask,
): Promise<{ ok: boolean; newChildID?: string; error?: string }> {
  const { api, registry, logger } = ctx;

  if (!projectedActionEnabled(task, "move-to-BG")) {
    return { ok: false, error: "Projection policy denied move-to-BG for this task state" };
  }

  if (task.status !== "running") {
    return { ok: false, error: `Task is ${task.status}, cannot move to BG` };
  }

  // 0. Recover the original prompt from the child's messages BEFORE aborting.
  //    OpenCode's task tool injects the orchestrator's prompt as the first
  //    user-role message in the child session. We need it to seed the new BG
  //    child so it picks up where the original left off.
  let recoveredPrompt: string | undefined = task.prompt;
  if (!recoveredPrompt) {
    try {
      // SDK v2 signature: { sessionID } — NOT { path: { id } } (that was old shape)
      const msgs = await api.client.session.messages({
        sessionID: task.childSessionID,
      });
      const messagesRaw = msgs?.data ?? msgs;
      const messages = Array.isArray(messagesRaw) ? messagesRaw : [];
      for (const m of messages) {
        const role = m?.info?.role;
        const parts = Array.isArray(m?.parts) ? m.parts : [];
        if (role === "user") {
          const textPart = parts.find(
            (p: { type?: string; text?: string }) =>
              p?.type === "text" && typeof p.text === "string" && p.text.length > 0,
          );
          if (textPart?.text) {
            recoveredPrompt = textPart.text;
            logger?.info("moveTaskToBg: recovered prompt from child", {
              child: task.childSessionID,
              prompt_len: textPart.text.length,
            });
            break;
          }
        }
      }
      if (!recoveredPrompt) {
        logger?.warn("moveTaskToBg: could not extract user prompt from child", {
          child: task.childSessionID,
          message_count: messages.length,
        });
      }
    } catch (err) {
      logger?.warn("moveTaskToBg: prompt-recovery fetch failed", {
        child: task.childSessionID,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // 1. Abort the original child to release parent's task tool call
  try {
    logger?.info("moveTaskToBg: aborting child", {
      child: task.childSessionID,
      agent: task.agent,
      has_prompt: Boolean(recoveredPrompt),
    });
    // SDK v2 signature: { sessionID } — flat shape
    await api.client.session.abort({ sessionID: task.childSessionID });
  } catch (err) {
    logger?.warn("moveTaskToBg: abort failed", {
      child: task.childSessionID,
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: `Abort failed: ${err}` };
  }

  // Mark the original as cancelled in our registry
  registry.markStatus(task.childSessionID, "cancelled", {
    latestEvent: "aborted before BG respawn",
  });

  // 2. Create a new child session (agent is set on the prompt call, not create)
  // SDK v2 signature: flat { parentID?, title?, ... } — no `body` wrapper, no `agent` field here
  let newChild: { id: string } | undefined;
  try {
    const created = await api.client.session.create({
      ...(task.parentSessionID ? { parentID: task.parentSessionID } : {}),
      ...(task.description ? { title: task.description } : {}),
    });
    // SDK returns { data: Session } per hey-api convention; accept both shapes defensively
    newChild =
      (created?.data?.id ? created.data : created) as { id: string };
  } catch (err) {
    logger?.warn("moveTaskToBg: create new child failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: `Create new child failed: ${err}` };
  }

  if (!newChild?.id) {
    return { ok: false, error: "New child created but no id returned" };
  }

  // 3. promptAsync — fire and (don't) forget — run truly async
  // SDK v2: flat { sessionID, agent, parts, ... } — agent goes here, not on create
  if (recoveredPrompt) {
    try {
      await api.client.session.promptAsync({
        sessionID: newChild.id,
        agent: task.agent,
        parts: [{ type: "text", text: recoveredPrompt }],
      });
      logger?.info("moveTaskToBg: promptAsync sent", {
        new_child: newChild.id,
        prompt_len: recoveredPrompt.length,
        agent: task.agent,
      });
    } catch (err) {
      logger?.warn("moveTaskToBg: promptAsync failed", {
        new_child: newChild.id,
        error: err instanceof Error ? err.message : String(err),
      });
      // Don't fail — child session exists, the user can re-prompt manually
    }
  } else {
    logger?.warn("moveTaskToBg: original prompt unknown — child created empty", {
      new_child: newChild.id,
      hint: "user may need to manually prompt the new child",
    });
  }

  // 4. Update registry: mark original as bg-detached, add the new child as a task
  registry.markStatus(task.childSessionID, "bg-detached", {
    newChildSessionID: newChild.id,
    mode: "BG",
    latestEvent: `moved to BG: ${newChild.id}`,
    detailRef: `child session/logs: ${newChild.id}`,
  });

  registry.upsertTask({
    childSessionID: newChild.id,
    parentSessionID: task.parentSessionID,
    agent: task.agent,
    started: Date.now(),
    status: "running",
    mode: "BG",
    latestEvent: "BG prompt dispatched",
    detailRef: `child session/logs: ${newChild.id}`,
    ...(recoveredPrompt ? { prompt: recoveredPrompt } : {}),
    ...(task.description
      ? { description: `${task.description} (BG, mid-flight moved)` }
      : { description: "(moved to BG mid-flight)" }),
  });

  // 5. Toast
  api.ui?.toast?.({
    variant: "success",
    title: "bg-control",
    message: `${task.agent} moved to BG — orchestrator unblocked`,
  });

  return { ok: true, newChildID: newChild.id };
}

/** Kill an active task — abort the child session, no replacement. */
export async function killTask(
  ctx: ActionContext,
  task: ActiveTask,
): Promise<{ ok: boolean; error?: string }> {
  const { api, registry, logger } = ctx;
  if (!projectedActionEnabled(task, "kill")) {
    return { ok: false, error: "Projection policy denied kill for this task state" };
  }
  try {
    // SDK v2 flat signature
    await api.client.session.abort({ sessionID: task.childSessionID });
    registry.markStatus(task.childSessionID, "cancelled", {
      latestEvent: "killed by user",
    });
    api.ui?.toast?.({
      variant: "info",
      title: "bg-control",
      message: `Killed ${task.agent} task`,
    });
    return { ok: true };
  } catch (err) {
    logger?.warn("killTask: abort failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return { ok: false, error: String(err) };
  }
}

/**
 * Deliver completed BG task result to its parent session via noReply.
 * Called from events.ts when session.idle fires for a tracked BG-detached task.
 */
export async function deliverBgResult(
  ctx: ActionContext,
  task: ActiveTask,
): Promise<void> {
  const { api, logger } = ctx;
  const deliveryTask = resolveDeliveryTask(ctx.registry, task);
  if (deliveryTask.delivered) {
    logger?.info("deliverBgResult: already delivered, skipping", {
      child: deliveryTask.childSessionID,
      parent: deliveryTask.parentSessionID,
    });
    return;
  }

  if (!deliveryTask.parentSessionID) {
    logger?.warn("deliverBgResult: no parent session, skipping", {
      child: deliveryTask.childSessionID,
    });
    return;
  }

  ctx.registry.markStatus(deliveryTask.childSessionID, deliveryTask.status, {
    delivered: true,
    latestEvent: "delivery claimed",
    detailRef: `child session/logs: ${deliveryTask.childSessionID}`,
  });

  // Fetch final messages from the child
  let resultText = `Subagent **${deliveryTask.agent}** completed.`;
  try {
    // SDK v2 flat signature: { sessionID }
    const msgs = await api.client.session.messages({
      sessionID: deliveryTask.childSessionID,
    });
    // SDK can return either an array directly or { data: [...] }; normalise.
    // Previously we used spread which crashed when msgs was a non-iterable
    // object. Array.isArray + slice() avoids the spread-on-non-iterable error.
    const messagesRaw = msgs?.data ?? msgs;
    const messages: Array<{
      info?: { role?: string };
      parts?: Array<{ type?: string; text?: string }>;
    }> = Array.isArray(messagesRaw) ? messagesRaw : [];
    // Find the last assistant message text — iterate in reverse using slice()
    const reversed = messages.slice().reverse();
    for (const m of reversed) {
      if (m?.info?.role === "assistant" && Array.isArray(m.parts)) {
        const textPart = m.parts.find(
          (p) => p?.type === "text" && typeof p.text === "string" && p.text.length > 0,
        );
        if (textPart?.text) {
          resultText = textPart.text;
          break;
        }
      }
    }
    logger?.info("deliverBgResult: extracted result", {
      child: deliveryTask.childSessionID,
      message_count: messages.length,
      result_len: resultText.length,
    });
  } catch (err) {
    logger?.warn("deliverBgResult: fetch messages failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Inject to parent via noReply
  try {
    const formatted = formatCompactAgentDelivery({
      taskId: deliveryTask.childSessionID,
      agent: deliveryTask.agent,
      status: "completed",
      resultText,
      reference: `child session/logs: ${deliveryTask.childSessionID}`,
      ...(deliveryTask.description ? { description: deliveryTask.description } : {}),
    });

    // SDK v2: flat { sessionID, noReply, parts }
    await api.client.session.prompt({
      sessionID: deliveryTask.parentSessionID,
      noReply: true,
      parts: [{ type: "text", text: formatted }],
    });

    logger?.info("deliverBgResult: result delivered to parent", {
      parent: deliveryTask.parentSessionID,
      agent: deliveryTask.agent,
    });
    ctx.registry.markStatus(deliveryTask.childSessionID, "done", {
      delivered: true,
      latestEvent: "result delivered",
      detailRef: `child session/logs: ${deliveryTask.childSessionID}`,
    });

    api.ui?.toast?.({
      variant: "success",
      title: "bg-control",
      message: `${deliveryTask.agent} done · result delivered`,
    });
  } catch (err) {
    ctx.registry.markStatus(deliveryTask.childSessionID, deliveryTask.status, {
      delivered: false,
      latestEvent: "delivery failed; retry pending",
      detailRef: `child session/logs: ${deliveryTask.childSessionID}`,
    });
    logger?.warn("deliverBgResult: delivery failed", {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

function resolveDeliveryTask(registry: TaskRegistry, task: ActiveTask): ActiveTask {
  if (task.newChildSessionID) {
    return registry.getTask(task.newChildSessionID) ?? task;
  }
  return registry.getTask(task.childSessionID) ?? task;
}
