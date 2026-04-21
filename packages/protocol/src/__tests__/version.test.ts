import { describe, expect, expectTypeOf, it } from "vitest";
import {
  PROTOCOL_VERSION,
  type ProtocolVersion,
  isCompatibleProtocol,
} from "../version.js";

describe("PROTOCOL_VERSION", () => {
  it("exports the literal string '1.0.0'", () => {
    expect(PROTOCOL_VERSION).toBe("1.0.0");
  });

  it("is typed as the narrow literal, not widened string", () => {
    expectTypeOf<ProtocolVersion>().toEqualTypeOf<"1.0.0">();
    expectTypeOf(PROTOCOL_VERSION).toEqualTypeOf<"1.0.0">();
  });

  it("matches semver major.minor.patch shape", () => {
    expect(PROTOCOL_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

describe("isCompatibleProtocol", () => {
  it("accepts identical version", () => {
    const result = isCompatibleProtocol("1.0.0");
    expect(result.ok).toBe(true);
    expect(result.mismatch).toBeUndefined();
  });

  it("accepts matching major/minor with newer patch", () => {
    const result = isCompatibleProtocol("1.0.99");
    expect(result.ok).toBe(true);
    expect(result.mismatch).toBeUndefined();
  });

  it("warns (ok=true, mismatch=minor) on same major but different minor", () => {
    const result = isCompatibleProtocol("1.3.0");
    expect(result.ok).toBe(true);
    expect(result.mismatch).toBe("minor");
  });

  it("rejects (ok=false, mismatch=major) on different major", () => {
    const result = isCompatibleProtocol("2.0.0");
    expect(result.ok).toBe(false);
    expect(result.mismatch).toBe("major");
  });

  it("rejects (ok=false, mismatch=major) on major=0 (pre-release host)", () => {
    const result = isCompatibleProtocol("0.9.0");
    expect(result.ok).toBe(false);
    expect(result.mismatch).toBe("major");
  });

  it("rejects non-semver inputs (ok=false, mismatch=major)", () => {
    expect(isCompatibleProtocol("not-a-version").ok).toBe(false);
    expect(isCompatibleProtocol("").ok).toBe(false);
    expect(isCompatibleProtocol("1.0").ok).toBe(false);
  });
});
