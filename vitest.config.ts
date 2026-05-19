import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromRoot = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@maicolextic/bg-subagents-core": fromRoot("./packages/core/src/__tests__/core-public-test-facade.ts"),
      "@maicolextic/bg-subagents-protocol": fromRoot("./packages/protocol/src/__tests__/protocol-public-test-facade.ts"),
      "@opencode-ai/plugin/tool": fromRoot("./packages/opencode/src/__tests__/opencode-plugin-tool-test-shim.ts"),
      "solid-js": fromRoot("./packages/control-tui/src/__tests__/solid-js-test-shim.ts"),
    },
  },
  test: {
    globals: false,
    pool: "threads",
    include: ["packages/*/src/**/*.test.ts", "packages/*/src/**/__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", "**/coverage/**"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "json-summary"],
      include: ["packages/*/src/**/*.ts"],
      exclude: [
        "**/*.test.ts",
        "**/*.spec.ts",
        "**/__tests__/**",
        "**/dist/**",
        "**/node_modules/**",
      ],
    },
  },
});
