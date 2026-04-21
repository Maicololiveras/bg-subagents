import { defineConfig } from "vitest/config";

export default defineConfig({
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
