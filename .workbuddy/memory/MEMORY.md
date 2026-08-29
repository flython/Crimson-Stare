# crimson-stare 项目长期备忘

## 提交规范（硬性）
- commit message 必须使用中文有序列表（1. 2. 3.）描述变化。

## 血色牌局 Web 版
- spec：`.scratch/game-web-mvp/spec.md`，wayfinder 地图：`.scratch/game-web-mvp/map.md`（票据在 issues/）。
- MVP 范围：标准局 2-4 人、简易模式、单人模式（三机械荷官+15命运牌）；事件牌（含黑心商贩）、捣蛋鬼、组队、暗藏杀机全部排除。
- 架构：TS monorepo（engine/server/web）、服务端权威 WebSocket、SQLite 存牌局记录、docker-compose 双服务（nginx+Node）。
- 引擎效果系统：硬编码注册表，不做 DSL；卡池数据 JSON 化，图片按 ID→文件名热替换，占位卡渲染。
- 测试 seam：engine 公开 API（主）+ WS 消息契约（次），Vitest。
- UI：暗色牌桌，基色 #e9404b / #583c42 / #ffc840，横屏最优，触屏+鼠标。
- 奖励表配置化（2人局 4票/4筹；3人局 4票/2票2筹/4筹；4人局 4票/2票2筹/1票3筹/4筹）。
- 素材依赖：飞飞 M2 前给简易模式牌池文本（4角色+黄边黑市牌），M3 前确认命运牌文本。
- 里程碑：M1 白板标准局 → M2 黑市+角色+简易模式 → M3 单人荷官。
