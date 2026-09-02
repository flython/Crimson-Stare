# 28 - CardPicker 支持空选择（026/032/033 等可跳过效果）

Type: task
Status: resolved

## Question

issue 24 #14 / map 20 遗留：部分效果允许玩家跳过选择（026/032 用 `chooseCard.carry` 做跨玩家链式交互、033 金科玉律 2 下对手自选删 1），但 `web/src/components/CardPicker.tsx` 当前**不允许空选**，导致这些效果的「跳过/放弃」分支在前端无法触发。

## 待实现

1. **CardPicker.tsx**：增加可选「跳过/取消」按钮（`allowEmpty` prop），空选时返回空数组发 `resolvePrompt`。
2. **resolvePrompt.ts**：透传空 choice 到 engine `resolvePrompt`（引擎侧 026/032/033 的 validateChoice 已允许空，需确认空数组通过校验）。
3. 回归测试：组件级测试空选路径 + e2e 一条可跳过效果（033）断言。

## Notes

- 引擎 `resolvePrompt` 空选择在票据 15 已做过「chooseCard 空选择兜底改选首候选」——需复核 15 的兜底是否与此冲突（15 是数值芯片自动填首候选，26/32/33 是玩家主动跳过，二者语义不同）。
- 先核对 engine 26/032/033 的 resolve 是否显式处理空数组，再决定前端发空还是发占位。