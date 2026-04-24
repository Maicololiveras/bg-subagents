/**
 * Phase 13.5 RED — keybinds unit tests.
 *
 * Covers:
 *   - registerKeybinds(api) calls api.command.register exactly once.
 *   - The callback passed to api.command.register returns TuiCommand[] with 3 entries:
 *       { title: "Focus BG task", keybind: "ctrl+b", onSelect: fn }
 *       { title: "Focus FG task", keybind: "ctrl+f", onSelect: fn }
 *       { title: "Open task panel", keybind: "down", onSelect: fn }
 *   - onSelect for "Focus BG task" (Ctrl+B):
 *       If BG task running → api.ui.dialog.replace called.
 *       If no BG task    → api.ui.toast called with variant "info".
 *   - onSelect for "Focus FG task" (Ctrl+F):
 *       If FG task running → api.ui.dialog.replace called.
 *       If no FG task    → api.ui.toast called with variant "info".
 *   - onSelect for "Open task panel" (↓):
 *       api.ui.dialog.replace called with ALL tasks (BG + FG combined).
 *       If no tasks at all → api.ui.toast called with variant "info".
 *   - When SharedPluginState.current() is undefined, onSelect shows toast "bg-subagents not ready yet".
 *   - Zero stdout assertion.
 *
 * Spec: openspec/changes/opencode-plan-review-live-control/tasks.md Phase 13.5
 * Design: design.md ADR-9 keybind scope description
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  registerFromServer,
  clear as clearSharedState,
} from "../../tui-plugin/shared-state.js";
import { TaskRegistry } from "@maicolextic/bg-subagents-core";
import { createTaskPolicyStore } from "../../host-compat/v14/slash-commands.js";

// ---------------------------------------------------------------------------
// Module under test
// ---------------------------------------------------------------------------

import { registerKeybinds } from "../../tui-plugin/keybinds.js";

// ---------------------------------------------------------------------------
// Minimal mock of TuiPluginApi surface required by keybinds
// ---------------------------------------------------------------------------

type MockTuiCommand = {
  title: string;
  value: string;
  keybind?: string;
  onSelect?: () => void;
};

type MockCommandApi = {
  register: ReturnType<typeof vi.fn>;
  trigger: ReturnType<typeof vi.fn>;
  show: ReturnType<typeof vi.fn>;
};

type MockToast = {
  variant?: "info" | "success" | "warning" | "error";
  message: string;
};

type MockUiApi = {
  toast: ReturnType<typeof vi.fn>;
  dialog: {
    replace: ReturnType<typeof vi.fn>;
    clear: ReturnType<typeof vi.fn>;
  };
};

type MockTuiPluginApi = {
  command: MockCommandApi;
  ui: MockUiApi;
};

function makeApi(): MockTuiPluginApi {
  return {
    command: {
      register: vi.fn().mockReturnValue(() => undefined),
      trigger: vi.fn(),
      show: vi.fn(),
    },
    ui: {
      toast: vi.fn(),
      dialog: {
        replace: vi.fn(),
        clear: vi.fn(),
      },
    },
  };
}

function makeSharedState(registry?: TaskRegistry) {
  const reg = registry ?? new TaskRegistry();
  const policyStore = createTaskPolicyStore();
  return { registry: reg, policyStore };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

beforeEach(() => {
  clearSharedState();
  delete process.env["BG_SUBAGENTS_DEBUG"];
});

afterEach(() => {
  clearSharedState();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. api.command.register called exactly once
// ---------------------------------------------------------------------------

describe("registerKeybinds — api.command.register", () => {
  it("calls api.command.register exactly once", () => {
    const api = makeApi();
    registerKeybinds(api as never);

    expect(api.command.register).toHaveBeenCalledTimes(1);
  });

  it("passes a callback function to api.command.register", () => {
    const api = makeApi();
    registerKeybinds(api as never);

    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    expect(typeof cb).toBe("function");
  });

  it("callback returns an array", () => {
    const api = makeApi();
    registerKeybinds(api as never);

    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    const result = cb();
    expect(Array.isArray(result)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. Command array — 3 entries with correct shape
// ---------------------------------------------------------------------------

describe("registerKeybinds — command array shape", () => {
  function getCommands(api: MockTuiPluginApi): MockTuiCommand[] {
    registerKeybinds(api as never);
    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    return cb();
  }

  it("returns exactly 3 commands", () => {
    const api = makeApi();
    const cmds = getCommands(api);
    expect(cmds).toHaveLength(3);
  });

  it('first command has title "Focus BG task" and keybind "ctrl+b"', () => {
    const api = makeApi();
    const cmds = getCommands(api);
    const cmd = cmds[0]!;
    expect(cmd.title).toBe("Focus BG task");
    expect(cmd.keybind).toBe("ctrl+b");
    expect(typeof cmd.onSelect).toBe("function");
  });

  it('second command has title "Focus FG task" and keybind "ctrl+f"', () => {
    const api = makeApi();
    const cmds = getCommands(api);
    const cmd = cmds[1]!;
    expect(cmd.title).toBe("Focus FG task");
    expect(cmd.keybind).toBe("ctrl+f");
    expect(typeof cmd.onSelect).toBe("function");
  });

  it('third command has title "Open task panel" and keybind "down"', () => {
    const api = makeApi();
    const cmds = getCommands(api);
    const cmd = cmds[2]!;
    expect(cmd.title).toBe("Open task panel");
    expect(cmd.keybind).toBe("down");
    expect(typeof cmd.onSelect).toBe("function");
  });

  it("all commands have a non-empty value field", () => {
    const api = makeApi();
    const cmds = getCommands(api);
    for (const cmd of cmds) {
      expect(typeof cmd.value).toBe("string");
      expect(cmd.value.length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. SharedPluginState undefined — all onSelect handlers show "not ready" toast
// ---------------------------------------------------------------------------

describe("registerKeybinds — state undefined (not ready)", () => {
  function getCommands(api: MockTuiPluginApi): MockTuiCommand[] {
    registerKeybinds(api as never);
    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    return cb();
  }

  it("ctrl+b onSelect shows toast when state undefined", () => {
    const api = makeApi();
    const cmds = getCommands(api);
    cmds[0]!.onSelect!();

    expect(api.ui.toast).toHaveBeenCalledTimes(1);
    const toastArg = api.ui.toast.mock.calls[0]![0] as MockToast;
    expect(toastArg.message).toContain("bg-subagents not ready yet");
  });

  it("ctrl+f onSelect shows toast when state undefined", () => {
    const api = makeApi();
    const cmds = getCommands(api);
    cmds[1]!.onSelect!();

    expect(api.ui.toast).toHaveBeenCalledTimes(1);
    const toastArg = api.ui.toast.mock.calls[0]![0] as MockToast;
    expect(toastArg.message).toContain("bg-subagents not ready yet");
  });

  it("down onSelect shows toast when state undefined", () => {
    const api = makeApi();
    const cmds = getCommands(api);
    cmds[2]!.onSelect!();

    expect(api.ui.toast).toHaveBeenCalledTimes(1);
    const toastArg = api.ui.toast.mock.calls[0]![0] as MockToast;
    expect(toastArg.message).toContain("bg-subagents not ready yet");
  });

  it("dialog.replace NOT called when state undefined", () => {
    const api = makeApi();
    const cmds = getCommands(api);
    cmds[0]!.onSelect!();
    cmds[1]!.onSelect!();
    cmds[2]!.onSelect!();

    expect(api.ui.dialog.replace).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 4. ctrl+b — Focus BG task
// ---------------------------------------------------------------------------

describe("registerKeybinds — ctrl+b (Focus BG task)", () => {
  function getCommands(api: MockTuiPluginApi): MockTuiCommand[] {
    registerKeybinds(api as never);
    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    return cb();
  }

  it("shows toast when no BG tasks are running (registry empty)", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[0]!.onSelect!();

    expect(api.ui.toast).toHaveBeenCalledTimes(1);
    const toastArg = api.ui.toast.mock.calls[0]![0] as MockToast;
    expect(toastArg.variant).toBe("info");
    expect(typeof toastArg.message).toBe("string");
    expect(api.ui.dialog.replace).not.toHaveBeenCalled();
  });

  it("shows toast when registry has FG tasks but no BG tasks running", () => {
    const registry = new TaskRegistry();
    // Spawn a FG task
    const handle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "fg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[0]!.onSelect!();

    expect(api.ui.toast).toHaveBeenCalledTimes(1);
    const toastArg = api.ui.toast.mock.calls[0]![0] as MockToast;
    expect(toastArg.variant).toBe("info");
    expect(api.ui.dialog.replace).not.toHaveBeenCalled();
  });

  it("calls dialog.replace when a BG task is running", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[0]!.onSelect!();

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1);
    expect(api.ui.toast).not.toHaveBeenCalled();
  });

  it("dialog.replace receives a render function and an onClose callback", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[0]!.onSelect!();

    const [renderFn, onClose] = api.ui.dialog.replace.mock.calls[0] as [
      () => unknown,
      () => void
    ];
    expect(typeof renderFn).toBe("function");
    expect(typeof onClose).toBe("function");
  });

  it("does NOT show toast when BG task exists", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[0]!.onSelect!();

    expect(api.ui.toast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 5. ctrl+f — Focus FG task
// ---------------------------------------------------------------------------

describe("registerKeybinds — ctrl+f (Focus FG task)", () => {
  function getCommands(api: MockTuiPluginApi): MockTuiCommand[] {
    registerKeybinds(api as never);
    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    return cb();
  }

  it("shows toast when no FG tasks are running (registry empty)", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[1]!.onSelect!();

    expect(api.ui.toast).toHaveBeenCalledTimes(1);
    const toastArg = api.ui.toast.mock.calls[0]![0] as MockToast;
    expect(toastArg.variant).toBe("info");
    expect(api.ui.dialog.replace).not.toHaveBeenCalled();
  });

  it("shows toast when registry has BG tasks but no FG tasks running", () => {
    const registry = new TaskRegistry();
    // Spawn a BG task
    const handle = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[1]!.onSelect!();

    expect(api.ui.toast).toHaveBeenCalledTimes(1);
    const toastArg = api.ui.toast.mock.calls[0]![0] as MockToast;
    expect(toastArg.variant).toBe("info");
    expect(api.ui.dialog.replace).not.toHaveBeenCalled();
  });

  it("calls dialog.replace when a FG task is running", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "fg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[1]!.onSelect!();

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1);
    expect(api.ui.toast).not.toHaveBeenCalled();
  });

  it("dialog.replace receives a render function and an onClose callback", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "fg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[1]!.onSelect!();

    const [renderFn, onClose] = api.ui.dialog.replace.mock.calls[0] as [
      () => unknown,
      () => void
    ];
    expect(typeof renderFn).toBe("function");
    expect(typeof onClose).toBe("function");
  });

  it("does NOT show toast when FG task exists", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "fg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[1]!.onSelect!();

    expect(api.ui.toast).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// 6. down — Open task panel (ALL tasks, BG + FG)
// ---------------------------------------------------------------------------

describe("registerKeybinds — down (Open task panel)", () => {
  function getCommands(api: MockTuiPluginApi): MockTuiCommand[] {
    registerKeybinds(api as never);
    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    return cb();
  }

  it("shows toast when registry is empty", () => {
    const registry = new TaskRegistry();
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[2]!.onSelect!();

    expect(api.ui.toast).toHaveBeenCalledTimes(1);
    const toastArg = api.ui.toast.mock.calls[0]![0] as MockToast;
    expect(toastArg.variant).toBe("info");
    expect(api.ui.dialog.replace).not.toHaveBeenCalled();
  });

  it("calls dialog.replace when there is at least one task (BG)", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[2]!.onSelect!();

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1);
    expect(api.ui.toast).not.toHaveBeenCalled();
  });

  it("calls dialog.replace when there is at least one task (FG)", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "fg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[2]!.onSelect!();

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1);
    expect(api.ui.toast).not.toHaveBeenCalled();
  });

  it("calls dialog.replace when there are both BG and FG tasks", () => {
    const registry = new TaskRegistry();
    const h1 = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    h1.done.catch(() => undefined);
    const h2 = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "fg" },
      run: (_signal) => new Promise(() => undefined),
    });
    h2.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[2]!.onSelect!();

    expect(api.ui.dialog.replace).toHaveBeenCalledTimes(1);
    expect(api.ui.toast).not.toHaveBeenCalled();
  });

  it("dialog.replace receives a render function and an onClose callback", () => {
    const registry = new TaskRegistry();
    const handle = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    handle.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    const cmds = getCommands(api);
    cmds[2]!.onSelect!();

    const [renderFn, onClose] = api.ui.dialog.replace.mock.calls[0] as [
      () => unknown,
      () => void
    ];
    expect(typeof renderFn).toBe("function");
    expect(typeof onClose).toBe("function");
  });
});

// ---------------------------------------------------------------------------
// 7. Zero stdout assertion
// ---------------------------------------------------------------------------

describe("registerKeybinds — zero stdout pollution", () => {
  it("registering keybinds produces ZERO bytes on stdout", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const api = makeApi();
    registerKeybinds(api as never);

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("invoking onSelect handlers produces ZERO bytes on stdout (state undefined)", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const api = makeApi();
    registerKeybinds(api as never);
    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    const cmds = cb();

    // state is undefined — all show toast
    cmds[0]!.onSelect!();
    cmds[1]!.onSelect!();
    cmds[2]!.onSelect!();

    expect(stdoutSpy).not.toHaveBeenCalled();
  });

  it("invoking onSelect handlers produces ZERO bytes on stdout (state set, tasks present)", () => {
    const stdoutSpy = vi
      .spyOn(process.stdout, "write")
      .mockImplementation(() => true);

    const registry = new TaskRegistry();
    const h1 = registry.spawn({
      meta: { agent_name: "sdd-explore", mode: "bg" },
      run: (_signal) => new Promise(() => undefined),
    });
    h1.done.catch(() => undefined);
    const h2 = registry.spawn({
      meta: { agent_name: "sdd-apply", mode: "fg" },
      run: (_signal) => new Promise(() => undefined),
    });
    h2.done.catch(() => undefined);
    registerFromServer(makeSharedState(registry));

    const api = makeApi();
    registerKeybinds(api as never);
    const [cb] = api.command.register.mock.calls[0] as [() => MockTuiCommand[]];
    const cmds = cb();

    cmds[0]!.onSelect!();
    cmds[1]!.onSelect!();
    cmds[2]!.onSelect!();

    expect(stdoutSpy).not.toHaveBeenCalled();
  });
});
