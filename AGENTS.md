# crimson-stare

## Agent skills

### Issue tracker

Issues live as markdown files under `.scratch/<feature>/` in this repo. See `docs/agents/issue-tracker.md`.

### Triage labels

Default five canonical roles (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root. See `docs/agents/domain.md`.

## 工作流要求（硬性约定）

1. **需求文档化 + 票据化**：任何新需求/新功能（含对话中直接派生、直接让我"开始做"的需求）必须先文档化（更新或新增 spec / 设计文档，如 `.scratch/<feature>/spec.md` 或 `docs/` 下的设计文档），再票据化（`.scratch/<feature>/issues/NN-<slug>.md`，`Type` / `Status` / `Blocked by` 齐全，完成态打 `ready-for-agent` 标签），**claim 该票据后才允许写实现代码**。禁止跳过票据直接实现。

2. **提交底线（每个交付即提交）**：每次完成一份文档、或完成一个 issue（`Status: resolved`）后，**立即 git commit**（commit message 用中文有序列表描述变化）。不允许把多个文档/票据/实现攒到一次提交。

3. **票据驱动推进**：wayfinder 地图（`.scratch/game-web-mvp/map.md`）是路线图。推进时按 frontier（open 且未阻塞且未 claim）顺序 claim 票据，`Status` 流转 `open → claimed → resolved`；解决后把结论写进票据 `## Answer`，并在 map.md 的 `Decisions so far` 追加上下文指针。

4. **占位降级**：依赖尚未就绪的卡牌/效果（如交互机制未上线）先以占位注册（无效果 + log「效果未实现」），不阻塞主流程；依赖落地后补真身。
