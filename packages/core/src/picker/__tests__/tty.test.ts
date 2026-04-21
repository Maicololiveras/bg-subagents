/**
 * RED gate for `src/picker/tty.ts`.
 *
 * Covers Batch 4 spec §1.a — cross-platform TTY acquisition with ref counting,
 * graceful fallback on failure, and a forced-fallback escape hatch.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("acquireTty()", () => {
  const originalIsTTY = process.stdin.isTTY;
  const originalPlatform = process.platform;

  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    Object.defineProperty(process, "platform", {
      value: originalPlatform,
      configurable: true,
    });
  });

  it("returns handles when stdin is a TTY on a POSIX platform", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const openSpy = vi.fn().mockReturnValue(42);
    const closeSpy = vi.fn();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, openSync: openSpy, closeSync: closeSpy };
    });

    const { acquireTty } = await import("../tty.js");
    const handles = acquireTty();
    expect(handles).not.toBeNull();
    expect(handles?.input).toBeDefined();
    expect(handles?.output).toBeDefined();
    expect(handles?.release).toBeTypeOf("function");
    handles?.release();
  });

  it("returns null when stdin is not a TTY (piped stdio)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: false, configurable: true });
    const { acquireTty } = await import("../tty.js");
    const handles = acquireTty();
    expect(handles).toBeNull();
  });

  it("opens /dev/tty on POSIX platforms", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const paths: string[] = [];
    const openSpy = vi.fn((p: string) => {
      paths.push(p);
      return paths.length + 10;
    });
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, openSync: openSpy, closeSync: vi.fn() };
    });

    const { acquireTty } = await import("../tty.js");
    const handles = acquireTty();
    expect(handles).not.toBeNull();
    expect(paths.some((p) => p === "/dev/tty")).toBe(true);
    handles?.release();
  });

  it("opens CONIN$ / CONOUT$ on Windows", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });

    const paths: string[] = [];
    const openSpy = vi.fn((p: string) => {
      paths.push(p);
      return paths.length + 20;
    });
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, openSync: openSpy, closeSync: vi.fn() };
    });

    const { acquireTty } = await import("../tty.js");
    const handles = acquireTty();
    expect(handles).not.toBeNull();
    const joined = paths.join("|");
    expect(joined).toMatch(/CONIN\$/);
    expect(joined).toMatch(/CONOUT\$/);
    handles?.release();
  });

  it("releases underlying file handles on .release()", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const openedFds: number[] = [];
    const closedFds: number[] = [];
    const openSpy = vi.fn(() => {
      const fd = 100 + openedFds.length;
      openedFds.push(fd);
      return fd;
    });
    const closeSpy = vi.fn((fd: number) => {
      closedFds.push(fd);
    });
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, openSync: openSpy, closeSync: closeSpy };
    });

    const { acquireTty } = await import("../tty.js");
    const handles = acquireTty();
    expect(handles).not.toBeNull();
    expect(openedFds.length).toBeGreaterThanOrEqual(1);
    handles?.release();
    // All opened fds should have been closed at least once.
    for (const fd of openedFds) {
      expect(closedFds).toContain(fd);
    }
  });

  it("ref-counts concurrent acquisitions (release-once-per-acquire)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const openedFds: number[] = [];
    const closedFds: number[] = [];
    const openSpy = vi.fn(() => {
      const fd = 200 + openedFds.length;
      openedFds.push(fd);
      return fd;
    });
    const closeSpy = vi.fn((fd: number) => {
      closedFds.push(fd);
    });
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, openSync: openSpy, closeSync: closeSpy };
    });

    const { acquireTty } = await import("../tty.js");
    const first = acquireTty();
    const second = acquireTty();
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();

    // Under refcount semantics, releasing once should NOT close fds.
    first?.release();
    expect(closedFds.length).toBe(0);

    // Release the second reference too — now fds should close.
    second?.release();
    for (const fd of openedFds) {
      expect(closedFds).toContain(fd);
    }
  });

  it("returns null when forceFallback is true (no device open attempted)", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const openSpy = vi.fn();
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, openSync: openSpy, closeSync: vi.fn() };
    });

    const { acquireTty } = await import("../tty.js");
    const handles = acquireTty({ forceFallback: true });
    expect(handles).toBeNull();
    expect(openSpy).not.toHaveBeenCalled();
  });

  it("returns null (with warning) when device open throws", async () => {
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process, "platform", { value: "linux", configurable: true });

    const openSpy = vi.fn(() => {
      throw new Error("ENOENT: no such device");
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, openSync: openSpy, closeSync: vi.fn() };
    });

    const { acquireTty } = await import("../tty.js");
    const handles = acquireTty();
    expect(handles).toBeNull();
    expect(warnSpy).toHaveBeenCalled();
  });
});
