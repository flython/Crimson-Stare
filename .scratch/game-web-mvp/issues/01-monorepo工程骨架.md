# 01 - 初始化 monorepo 工程骨架

Type: task
Status: resolved

## Question

工程骨架长什么样才能让后续所有票据直接开工：workspaces 选型（npm workspaces 即可，不引 turborepo/pnpm 的理由要写下来）、`engine`/`server`/`web` 三包目录与 TS 项目引用、Vitest 配置（engine 测试为主 seam）、共享 ESLint/Prettier、根级 build/dev 脚本、基础 .gitignore。产出：骨架代码提交入库，`npm run dev` 与 `npm test` 可跑（空测试通过）。

## Answer

选型结论：

- **npm workspaces**（不引 turborepo/pnpm）：Node 22 自带、零额外工具与安装；三包规模小，任务缓存与硬链接 store 的收益不抵复杂度。规模涨了再迁。
- **TS 基线**：根 `tsconfig.base.json`（strict + noUncheckedIndexedAccess），各包继承。engine ESM 输出 dist 供 server 引用；开发期 web 通过 vite alias 直引 engine 源码免 build，server 用 tsx watch 直跑源码。
- **engine**：`vitest` 为主 seam 测试设施，`main/types` 指向 dist。
- **server**：`ws` + `tsx`，端口 env 可配（默认 8080），占位入口验证 engine 引用链路（连接即回 hello 消息）。
- **web**：React 18 + Vite 5，dev 代理 `/ws` → ws://localhost:8080，与 compose 反代约定一致。
- **根级脚本**：`build` / `test` / `lint`（eslint 9 flat config + typescript-eslint）/ `lint:prettier` / `dev:server` / `dev:web`。
- ESLint/Prettier 共享配置置于根级，未启用类型感知 lint（规模不需要）。

验证：`npm run build` 三包通过；`npm test` 17 用例通过；server `tsx` 启动后 ws 可连（启动日志确认）。

## Comments

- 2026-08-29 解决并提交。
