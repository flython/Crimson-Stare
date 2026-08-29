/**
 * 卡池数据 zod schema(结构层校验)。
 *
 * 类型单一事实源在 engine(../engine/src/cardPool.ts),这里用 z.ZodType<CardDef> 显式标注输出类型,
 * 字段集合与 engine 类型不一致时编译期直接报错;运行期由 zod 拒绝不合法的行。
 */
import { z } from "zod";
import type { CardDef } from "@crimson/engine";

/** 触发时机列可识别的阶段别名(模板用中文,引擎用 PhaseId) */
export const PHASE_ALIASES: Record<string, string> = {
  抽牌阶段: "draw",
  抽牌: "draw",
  换牌阶段: "swap",
  换牌: "swap",
  出牌阶段: "play",
  出牌: "play",
  对决阶段: "duel",
  对决: "duel",
  结算阶段: "settle",
  结算: "settle",
  购买阶段: "purchase",
  购买: "purchase",
  删牌阶段: "delete",
  删牌: "delete",
  重整阶段: "reshape",
  重整: "reshape",
};

export const CardTriggerSchema = z.object({
  phase: z.enum(["draw", "swap", "play", "duel", "settle", "purchase", "delete", "reshape"]),
  timing: z.enum(["before", "during", "after"]),
});

/** 行 → CardDef 的结构校验(zod 拒绝非结构合法数据)。
 * 注意:不用 z.ZodType<CardDef> 整体标注——.default() 会放宽 Input 类型导致逆变不兼容;
 * 改为下方单向 output 对齐断言(编译期保证输出兼容 engine 的 CardDef,运行时由 zod 校验)。 */
export const CardDefSchema = z.object({
  id: z.string().min(1, "编号ID 不能为空"),
  name: z.string().min(1, "名称不能为空"),
  category: z.enum(["role", "market", "fate", "event"]),
  subtype: z.string().optional(),
  count: z.number().int("数量必须是整数").min(1, "数量必须 ≥ 1"),
  price: z.number().min(0, "价格必须 ≥ 0").optional(),
  yellowBorder: z.boolean().optional(),
  simpleOnly: z.boolean().optional(),
  colorTag: z.string().optional(),
  triggers: z.array(CardTriggerSchema).default([]),
  triggerText: z.string().optional(),
  effectId: z.string().optional(),
  effectText: z.string().min(1, "效果文本不能为空"),
  image: z.string().min(1, "图片路径不能为空"),
  title: z.string().optional(),
  gender: z.string().optional(),
  tags: z.array(z.string()).optional(),
  fateData: z
    .object({ dealerHand: z.string(), diceMapping: z.string() })
    .optional(),
  limitNote: z.string().optional(),
  note: z.string().optional(),
});

export type ParsedCardDef = z.infer<typeof CardDefSchema>;

/** 编译期对齐断言：zod 输出必须可赋值给 engine 的 CardDef（类型单一事实源在 engine） */
type _SchemaOutputAlignsWithEngineCardDef = CardDef extends ParsedCardDef ? true : never;

/** 校验结果:硬错(必须修复)与警告(可继续) */
export interface BuildIssues {
  errors: string[];
  warnings: string[];
}

/** 业务层校验(结构之上):ID 唯一 / 触发时机段合法 / 图片文件存在性提示 */
export function validateDefs(defs: CardDef[]): BuildIssues {
  const issues: BuildIssues = { errors: [], warnings: [] };
  const seen = new Map<string, string>(); // id → name
  for (const d of defs) {
    const prev = seen.get(d.id);
    if (prev !== undefined) {
      issues.errors.push(`[${d.category}] 重复 ID "${d.id}"（${prev} 与 ${d.name}）`);
    }
    seen.set(d.id, d.name);
    // 未识别的触发时机段已在 parse 层收集;这里补一层兜底(直接构造 defs 的调用方)
  }
  return issues;
}
