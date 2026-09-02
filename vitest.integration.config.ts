import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    // Integration tests hit real APIs — allow more time
    testTimeout: 30000,
  },
});
