import { describe, expect, it } from "vitest";

import { extractResultFromJsonStream } from "../runtime.js";

describe("extractResultFromJsonStream", () => {
  it("extracts text from OpenCode run text events instead of returning raw NDJSON", () => {
    const stdout = [
      JSON.stringify({ type: "step_start", part: { type: "step-start" } }),
      JSON.stringify({
        type: "text",
        part: {
          type: "text",
          text: "Resumen compacto del agente.",
        },
      }),
    ].join("\n");

    expect(extractResultFromJsonStream(stdout)).toBe("Resumen compacto del agente.");
  });

  it("keeps the last structured text chunk", () => {
    const stdout = [
      JSON.stringify({ type: "text", part: { type: "text", text: "primero" } }),
      JSON.stringify({ type: "text", part: { type: "text", text: "final" } }),
    ].join("\n");

    expect(extractResultFromJsonStream(stdout)).toBe("final");
  });
});
