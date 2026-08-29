# 06 - 卡牌 JSON 模板与数据管道

Type: grilling
Status: resolved
Blocked by: 02

## Question

卡池要持续扩充，数据管道现在定型：

- 统一 JSON 模板：角色牌/黑市牌/命运牌/事件牌的字段集（id/名称/价格/类型/颜色分类/效果ID/效果文本/图片路径/简易模式标记…）；
- 效果ID 与 02 号票据的效果注册表如何对应（命名空间、版本兼容：同名牌多张、未来加牌）；
- 交付格式约定：飞飞用 Excel 还是文本丢过来，转换脚本放哪、如何校验；
- 图片热替换约定：ID→文件名的目录结构、web 端加载与占位回退逻辑。
- 产出：schema 文档 + 转换脚本 + 一套示例卡数据入库。

## Answer

决策经飞飞确认（2026-08-29）：

1. **交付格式 = Excel**：模板已生成 `config/card-pool-template.xlsx`（说明 + 角色牌/黑市牌/命运牌/事件牌 4 张 sheet，必填列标＊，类型/时机列带下拉提示，含灰色示例行）。效果文本照抄卡面原文；同名牌用"数量"列表达。
2. **列可扩展**（飞飞明确要求）：转换脚本按**列名**识别，交付时可自行增加列；新列如需入库需说明含义，未识别列忽略并警告。
3. **图片约定**：`assets/cards/<牌类>/<图片文件名或ID>.png`，前端加载失败自动回退占位卡。
4. **效果ID 对应**：效果注册表以 `卡牌ID` 为命名空间（`effect:<牌类>:<ID>`），同名牌共享同一效果定义；引擎按注册表缺失时降级为占位（白板）不阻塞开跑。

**遗留**：转换脚本（xlsx→JSON + 必填/重复ID校验）在**首批填好的模板回来后**编写——列集合可能按卡面内容增删，现在写会基于想象返工。schema 文档随后续转换脚本一并入库。

---

## 落地记录（2026-08-30）

首批模板已填回（21 角色 + 52 黑市 + 15 命运 + 36 事件），转换脚本与 schema 已实现：

- **转换脚本**：`packages/card-data/`（Node/TS + SheetJS + zod），命令 `npm run cards:build` / `npm run cards:check`（只校验不写盘）。
- **产物**：`config/cards/{roles,market,fate,events}.json` + `manifest.json`，提交 git；server 启动时 `loadCardPool()` 读入注入引擎（`packages/server/src/cardPool.ts`）。
- **校验**：硬错=ID 唯一/必填/zod 结构/触发时机段非法；警告=未识别列/图片缺失。结构层 + 业务层双层回归测试（15 用例）。
- **类型单一事实源**：`packages/engine/src/cardPool.ts` 定义 CardDef/CardPool，转换脚本 import type 复用。
- **降级约定落地**：`packages/engine/src/effects/primitives.ts` 提供 `placeholderEffect`，注册表缺失时仅 log「效果未实现」。
- **注意**：`import.meta.url` 中文路径会 percent-encode，CLI 入口判断须 `fileURLToPath` 解码后再与 argv[1] 比较（已踩坑修复）。
- **待办**：M2.2 角色牌 21 效果注册（`effects/roles.ts`）→ M2.3 黑市牌 52 效果注册（`effects/market.ts`）。
