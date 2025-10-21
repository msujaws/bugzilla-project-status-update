import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./tests/setup/vitest.setup.ts"],
    include: ["tests/**/*.test.ts"],
    exclude: ["node_modules", "dist", ".wrangler"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
    },
  },
});
