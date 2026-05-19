import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const fromPackage = (path: string) => fileURLToPath(new URL(path, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@maicolextic/bg-subagents-core": fromPackage("../core/src/__tests__/core-public-test-facade.ts"),
      "@maicolextic/bg-subagents-protocol": fromPackage("../protocol/src/__tests__/protocol-public-test-facade.ts"),
    },
  },
  test: {
    globals: false,
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**"],
    pool: "threads",
  },
});
