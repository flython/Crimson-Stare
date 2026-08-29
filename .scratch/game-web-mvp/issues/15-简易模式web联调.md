# 15 - M2.6 简易模式 web 端联调

Type: task
Status: open
Blocked by: 11, 12, 14

## Question

简易模式（4 角色 + 24 黄边黑市牌）在 web 端完整可玩：server 建房/入房/推进 + 角色/黑市效果 + 交互 prompt 端到端跑通,验收一条完整对局。

## Notes

- 链路:web 创建/加入房间 → server 载入卡池(08) → createGame 注入角色与简易模式过滤 → 8 阶段推进(角色/黑市效果 11/12) → 交互 prompt 选择(13/14) → 结算发奖 → 终局。
- 验收:2 人简易局完整一回合(抽/换/出/决/结/购/删/整)不卡死,效果日志正确,交互选择可达。
- 协议按 04 号票据契约,`resolvePrompt` 需入协议。
- SQLite 终局摘要(04 票据)可顺带接通。
- 测试:server 层 WS 契约测试扩展 resolvePrompt;web 层手工验收清单。
