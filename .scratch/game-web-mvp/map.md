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
- [07 - docker-compose 部署方案](issues/07-docker-compose部署方案.md)：web(nginx+反代/ws)+server 双服务多阶段构建；SQLite 卷 /data；配置只读挂载热改不换镜像；本机实测构建/启动/WS握手/清理全通过。
- [02 - 引擎核心抽象定型](issues/02-引擎核心抽象定型.md)（飞飞已确认）：GameState 全序列化+rngState 内嵌（重放=种子+Action流）；redactState 按观察者裁剪（可见性执行点在 server 分发层）；EffectDef 硬编码注册表，结算队列按来源优先级+特权证顺时针排序；GameConfig 收敛进 engine 单一事实源；白板局 reducer 跑通 8 阶段。
- [05 - 牌桌 UI 交互原型](issues/05-牌桌UI交互原型.md)（飞飞已拍板 v4 为基线）：可点击假数据原型 `prototypes/table-ui.html`；实体牌桌四向布局、个人操作台两行结构、程序控制阶段推进（endPhase + 全员结束标记 + 转场动画）、宣告三步面板、芯片插入弹窗、max-height 560px 横屏手机断点、头像点击看技能；结论整合进 spec.md「UI 与交互决策」节，实装以 spec 为准。
- [04 - WebSocket 协议](issues/04-WebSocket协议与重连托管.md)：契约文档 `docs/protocol.md`；全量快照广播（redact 后）不做 diff；掉线立即/超时120s托管，最小操作原则；房间仅内存、终局写 SQLite 摘要。
- [06 - 卡牌数据管道](issues/06-卡牌JSON模板与数据管道.md)：交付格式=Excel，模板 `config/card-pool-template.xlsx`（列可扩展，脚本按列名识别）；图片约定 `assets/cards/<牌类>/<ID>.png` + 占位回退；转换脚本待首批填好的模板回来后编写。
- [08 - 卡池数据管道落地](issues/08-卡池数据管道落地.md)：转换脚本 `packages/card-data/`（SheetJS+zod，`cards:build`/`cards:check`）+ 产物 `config/cards/*.json`（21/52/15/36）+ server 启动 `loadCardPool()` 注入；结构层+业务层双层校验。
- [09 - 效果原语库](issues/09-效果原语库.md)：`effects/primitives.ts` 17 个原语（gainChips/addPermanentRank/deleteCards/placeholderEffect 等）；PlayerState 加 skillDisabled/chipsDisabled/handLimitBonus/duelPointsBonus/swapBonus；EffectContext 加 effectId。
- [13 - 交互机制（效果挂起）](issues/13-交互机制效果挂起.md)：`GameState.pendingPrompt` + `resolvePrompt` Action + `EffectDef.resolve` 两段式效果；挂起门禁（只接受目标玩家）；validateChoice 校验；autoResolve 超时托管（promptTimeoutSec/timeoutPolicy 入 GameConfig）；redact 裁剪（目标玩家见候选，他人见 waitingFor）。server WS 接线留 15。
- [14 - UI 交互组件](issues/14-UI交互组件.md)：web 包 4 个交互组件落地——TargetPicker（选玩家）/CardPicker（选牌，多选）/PendingPromptBanner（顶部横幅三态，接 stateUpdate.pendingPrompt）/DiceRollAnimation（0.5s 掷骰动画）；简易模式入口开放、标准/单人灰显「敬请期待 M3」；resolvePrompt 顶层消息暂按 `{type:"resolvePrompt",choice}` 定义（playerId 由 server 推断），是否走 protocol 的 action 包装待 15 联调。
- [12 - 黑市牌效果注册](issues/12-黑市牌效果注册.md)：52 张黑市牌注册完成（24 黄边全量 + 非黄边尽量）。强化芯片工厂 chipInstall（金科玉律 3/4：每牌限 1、点数 2-14 校验、无目标弃置，数值类 resolve 用 addPermanentRank）；血筹镀层（出/夺）以 (duel,during) 注册对持有者实际生效；秘密交易立即结算（027/031/034/036/039 + 闭店礼/血筹分享/拔除芯片）；道具统一注册 run 存 items（规避 whiteboard"备用道具"与 JSON"道具"命名不一致）。依赖[皇冠]状态/黑市区 slot 交互/hand-evaluator 芯片视图的声明效果占位 TODO，遗留已记录。

## Not yet specified

- 单人模式实现细节决策：命运牌库洗切时机、荷官托管出牌的交互呈现、Mortis 重掷流程的状态机表达——依赖引擎抽象定型与卡牌管道（M3，先不急）。
- 内测反馈循环：内部游玩后的数值平衡调整流程（奖励表配置热更新？）。
- 牌桌动效与音效打磨范围。

> M2 剩余执行已票据化（open, ready-for-agent）：[10 - M2 卡牌逻辑与数据管道 spec](issues/10-M2卡牌逻辑与数据管道spec.md) 为执行蓝本；[11 - 角色牌效果注册](issues/11-角色牌效果注册.md)、[12 - 黑市牌效果注册](issues/12-黑市牌效果注册.md)、[13 - 交互机制（效果挂起）](issues/13-交互机制效果挂起.md)、[14 - UI 交互组件](issues/14-UI交互组件.md)、[15 - 简易模式 web 端联调](issues/15-简易模式web联调.md)。12、13、14 已 resolved；11 已被并行任务 claim。当前 frontier = 15（14 已解除其阻塞，可直接领取）。

## Out of scope

- 捣蛋鬼（5人局）、组队挑战赛（6-8人）与独狼、暗藏杀机变体、列车事件扩展（含黑心商贩）——spec 明确排除，缺文本或用户确认不做。
- 反作弊、账号系统、注册登录。
- 效果 DSL / 数据驱动效果引擎——卡池稳定后再评估。
- 完整版美术资源、排行榜、战绩统计、观战模式。
