import { defineConfig } from "vitest/config";
import { readFileSync } from "fs";
import { resolve } from "path";

function parseDotEnv(): Record<string, string> {
  try {
    return Object.fromEntries(
      readFileSync(resolve(process.cwd(), ".env"), "utf-8")
        .split("\n")
        .flatMap((line) => {
          const m = line.match(/^([^#=\s][^=]*)=(.*)$/);
          return m ? [[m[1].trim(), m[2].trim()]] : [];
        })
    );
  } catch {
    return {};
  }
}

export default defineConfig({
  test: {
    include: ["src/**/*.integration.test.ts"],
    env: parseDotEnv(),
    testTimeout: 30000,
  },
});
