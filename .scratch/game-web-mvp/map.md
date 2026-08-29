# Map: 血色牌局 Web 版 MVP

Labels: wayfinder:map

## Destination

spec.md（`.scratch/game-web-mvp/spec.md`）全部 user stories 达成：内部成员通过浏览器（触屏+鼠标）以标准局 2-4 人、简易模式、单人模式游玩《血色牌局》，docker-compose 一键部署。路线主线：M1 白板标准局全流程 → M2 黑市+角色+简易模式 → M3 单人机械荷官。

## Notes

- 领域：桌游数字化。规则书全文是唯一权威；spec 的"规则细节锚点"节是实现速查。
- 测试 seam 已定：① engine 包公开 API（纯函数状态机，主 seam）② server WebSocket 消息契约（次级）。不在 UI 层测。
- 提交规范：**commit message 必须使用中文有序列表描述变化**。
- UI 基色：血红 `#e9404b` / 暗红 `#583c42` / 提示金 `#ffc840`，暗色牌桌，横屏最优。
- 卡牌文本由飞飞逐步提供：M2 前给简易模式牌池，M3 前确认命运牌。开发期间一切卡面用占位渲染。
- 引擎效果系统定为硬编码注册表（不做 DSL），卡池数据 JSON 化。

## Decisions so far

- [Grilling 定稿设计共识](../spec.md)：MVP 范围（标准局2-4人/简易/单人，排除捣蛋鬼、组队、暗藏杀机、事件牌）、TS monorepo 三包、服务端权威、效果硬编码注册表、奖励表配置化、无账号昵称进房、托管最小操作原则、暗色 UI 三基色。
- [01 - 初始化 monorepo 工程骨架](issues/01-monorepo工程骨架.md)：npm workspaces（不引 turborepo/pnpm），engine/server/web 三包就绪，根级 build/test/lint/dev 脚本，web 开发期 alias 直引 engine 源码。
- [03 - 牌型判定与 JOKER 求解器](issues/03-牌型判定与JOKER求解器.md)：15 级牌型枚举按规则书排序；>5 张枚举 5 张子集+整组判六/七条家族；JOKER 逐张枚举赋值取 (牌型,点数) 字典序最优；规则书示例用例通过。

## Not yet specified

- 首批牌池（简易模式 4 角色 + 黄边黑市牌）文本到手后的效果函数实现排期与拆分。
- 单人模式实现细节决策：命运牌库洗切时机、荷官托管出牌的交互呈现、Mortis 重掷流程的状态机表达——依赖引擎抽象定型与卡牌管道。
- SQLite 存档 schema（牌局记录/复盘数据结构）——依赖引擎状态的可序列化形状。
- 内测反馈循环：内部游玩后的数值平衡调整流程（奖励表配置热更新？）。
- 牌桌动效与音效打磨范围。

## Out of scope

- 捣蛋鬼（5人局）、组队挑战赛（6-8人）与独狼、暗藏杀机变体、列车事件扩展（含黑心商贩）——spec 明确排除，缺文本或用户确认不做。
- 反作弊、账号系统、注册登录。
- 效果 DSL / 数据驱动效果引擎——卡池稳定后再评估。
- 完整版美术资源、排行榜、战绩统计、观战模式。
