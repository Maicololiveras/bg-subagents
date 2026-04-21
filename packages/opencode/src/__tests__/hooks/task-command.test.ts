/**
 * /task slash command parser + dispatcher tests.
 */
import { describe, expect, it } from "vitest";

import { HistoryStore, TaskRegistry } from "@maicolextic/bg-subagents-core";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handleTaskSlashCommand,
  parseTaskCommand,
} from "../../hooks/task-command.js";

function mkTmp(): string {
  return mkdtempSync(join(tmpdir(), "bgso-taskcmd-"));
}

function mkDeps() {
  const history = new HistoryStore({ path: join(mkTmp(), "history.jsonl") });
  const registry = new TaskRegistry({ history });
  const buf: string[] = [];
  const stdout = {
    write(chunk: string): void {
      buf.push(chunk);
    },
  };
  return { registry, history, stdout, buf };
}

describe("parseTaskCommand", () => {
  it("recognises `list` with no flags", () => {
    const p = parseTaskCommand("list", []);
    expect(p.subcmd).toBe("list");
    expect(p.positional).toEqual([]);
    expect(p.flags).toEqual({});
  });

  it("parses --status=running", () => {
    const p = parseTaskCommand("list", ["--status=running"]);
    expect(p.flags.status).toBe("running");
  });

  it("parses --tail=N on `logs`", () => {
    const p = parseTaskCommand("logs", ["tsk_abc123xy", "--tail=10"]);
    expect(p.flags.tail).toBe(10);
    expect(p.positional[0]).toBe("tsk_abc123xy");
  });

  it("maps unknown subcommands to `help`", () => {
    const p = parseTaskCommand("frobnicate", []);
    expect(p.subcmd).toBe("help");
  });

  it("ignores invalid --tail values", () => {
    const p = parseTaskCommand("logs", ["tsk_abc", "--tail=not-a-number"]);
    expect(p.flags.tail).toBeUndefined();
  });

  it("ignores unknown --status values", () => {
    const p = parseTaskCommand("list", ["--status=zzz"]);
    expect(p.flags.status).toBeUndefined();
  });
});

describe("handleTaskSlashCommand", () => {
  it("list prints `No tasks.` when registry is empty", async () => {
    const { registry, history, stdout, buf } = mkDeps();
    const res = await handleTaskSlashCommand("list", [], {
      registry,
      history,
      stdout,
    });
    expect(res.exit_code).toBe(0);
    expect(buf.join("")).toContain("No tasks.");
  });

  it("show <id> returns exit 1 when id does not exist", async () => {
    const { registry, history, stdout, buf } = mkDeps();
    const res = await handleTaskSlashCommand("show", ["tsk_missing1"], {
      registry,
      history,
      stdout,
    });
    expect(res.exit_code).toBe(1);
    expect(buf.join("")).toMatch(/not found/i);
  });

  it("show (no args) writes usage + exit 1", async () => {
    const { registry, history, stdout, buf } = mkDeps();
    const res = await handleTaskSlashCommand("show", [], {
      registry,
      history,
      stdout,
    });
    expect(res.exit_code).toBe(1);
    expect(buf.join("")).toMatch(/Usage: .*show/);
  });

  it("kill <id> returns exit 1 when id does not exist", async () => {
    const { registry, history, stdout, buf } = mkDeps();
    const res = await handleTaskSlashCommand("kill", ["tsk_missing1"], {
      registry,
      history,
      stdout,
    });
    expect(res.exit_code).toBe(1);
    expect(buf.join("")).toMatch(/not found/i);
  });

  it("logs <id> with no matching events returns exit 0 + empty output", async () => {
    const { registry, history, stdout, buf } = mkDeps();
    const res = await handleTaskSlashCommand("logs", ["tsk_missing1"], {
      registry,
      history,
      stdout,
    });
    expect(res.exit_code).toBe(0);
    expect(buf.join("").trim()).toBe("");
  });

  it("help prints the usage block", async () => {
    const { registry, history, stdout, buf } = mkDeps();
    const res = await handleTaskSlashCommand("help", [], {
      registry,
      history,
      stdout,
    });
    expect(res.exit_code).toBe(0);
    const out = buf.join("");
    expect(out).toContain("/task list");
    expect(out).toContain("/task show");
    expect(out).toContain("/task kill");
    expect(out).toContain("/task logs");
  });
});
