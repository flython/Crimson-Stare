/**
 * Vitest workspace 配置：让 vitest 从根目录跑时能正确隔离各 workspace 的环境。
 * npm run test --workspaces 会调用各 workspace 的 test script，
 * 每个 workspace 有自己的 vitest.config.ts 即可。
 * 本文件仅用于"从根目录直接跑 npx vitest run"时提供 workspace 指引。
 */
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  test: {
    // 从根目录跑时只收集 engine/server（Node 环境），web 走自己 workspace
    include: [
      "packages/engine/tests/**/*.test.ts",
      "packages/server/tests/**/*.test.ts",
    ],
    projects: [
      {
        name: "engine",
        config: resolve("packages/engine/vitest.config.ts"),
      },
      {
        name: "server",
        config: resolve("packages/server/vitest.config.ts"),
      },
    ],
  },
});
