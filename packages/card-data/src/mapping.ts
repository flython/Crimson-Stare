/**
 * 模板 sheet → CardDef 的字段映射(票据 06「转换脚本按列名识别,列可扩展」落地)。
 *
 * - 列名规范化:去 ＊/* 后缀与空白(黑市表头 "编号ID＊" / "黄色边框（简易模式可用）＊")
 * - 触发时机:角色/黑市解析为 (phase, timing) 列表;事件/命运保留原始文本(M3 再解析)
 * - 未识别列:忽略并收集警告(新增列不影响转换)
 */
import type { CardDef, CardTrigger } from "@crimson/engine";
import { PHASE_ALIASES } from "./schemas.js";
import type { BuildIssues } from "./schemas.js";

/** 列名规范化:去 ＊/* 与所有空白 */
export const normCol = (s: string): string => s.replace(/[＊*]/g, "").replace(/\s+/g, "");

/** 行级列名标准化:sheet_to_json 的 key 是原始表头(带 ＊/空格),统一成规范列名再取值 */
export const normRow = (r: Row): Row => {
  const out: Row = {};
  for (const [k, v] of Object.entries(r)) out[normCol(k)] = v;
  return out;
};

export type Row = Record<string, unknown>;

const asStr = (v: unknown): string => (v == null ? "" : String(v).trim());
const asNum = (v: unknown): number => {
  if (typeof v === "number") return v;
  const n = Number(asStr(v));
  return Number.isFinite(n) ? n : NaN;
};
const isYes = (v: unknown): boolean => asStr(v) === "是";
const splitTags = (v: unknown): string[] =>
  asStr(v)
    .split(/[;；]/)
    .map((s) => s.trim())
    .filter(Boolean);

const cell = (row: Row, ...names: string[]): unknown => {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== null && asStr(row[n]) !== "") return row[n];
  }
  return null;
};

/** 从效果文本推断某阶段的 timing(启发式:前→before, 结束/结束时→after, 否则 during) */
export function detectTiming(phaseLabel: string, effectText: string): CardTrigger["timing"] {
  const t = effectText.replace(/\s+/g, "");
  if (
    t.includes(`【${phaseLabel}阶段】前`) ||
    t.includes(`【${phaseLabel}】前`) ||
    t.includes(`${phaseLabel}阶段前`) ||
    t.includes(`${phaseLabel}前`)
  ) {
    return "before";
  }
  if (
    t.includes(`【${phaseLabel}阶段】结束`) ||
    t.includes(`【${phaseLabel}】结束`) ||
    t.includes(`${phaseLabel}阶段结束`) ||
    t.includes(`${phaseLabel}结束时`) ||
    t.includes(`${phaseLabel}结束后`) ||
    t.includes(`${phaseLabel}结束`)
  ) {
    return "after";
  }
  return "during";
}

/**
 * 解析触发时机:
 * - triggerCell 非空:按 ;；/ 拆分,每段匹配阶段别名 + 前/结束修饰
 * - triggerCell 空:从效果文本【阶段】标记反推;无标记→常驻效果(triggers=[])
 * - 未知段 → 返回 unknown 数组,由调用方写入 issues.errors(M2 效果注册需要精确时机,宁缺勿错)
 */
export function parseTriggers(
  triggerCell: unknown,
  effectText: string,
): { triggers: CardTrigger[]; unknown: string[] } {
  const triggers: CardTrigger[] = [];
  const unknown: string[] = [];
  const raw = asStr(triggerCell);

  if (raw === "") {
    // 效果文本【】反推:收集出现的阶段标签
    const re = /【([^】]+)】/g;
    const labels = new Set<string>();
    let m: RegExpExecArray | null;
    while ((m = re.exec(effectText)) !== null) {
      const label = m[1]!.replace(/\s+/g, "");
      if (PHASE_ALIASES[label]) labels.add(label);
    }
    for (const label of labels) {
      const phase = PHASE_ALIASES[label]! as CardTrigger["phase"];
      triggers.push({ phase, timing: detectTiming(label, effectText) });
    }
    return { triggers, unknown };
  }

  const segments = raw.split(/[;；]/).map((s) => s.trim()).filter(Boolean);
  for (const seg of segments) {
    const compact = seg.replace(/\s+/g, "");
    if (compact === "常驻" || compact === "立即" || compact === "游戏开始") {
      // 常驻/立即/游戏开始:不进入 8 阶段时间点框架,由效果层特殊处理
      continue;
    }
    let timing: CardTrigger["timing"] = "during";
    let label = compact;
    if (label.endsWith("前")) {
      timing = "before";
      label = label.slice(0, -1);
    } else if (label.endsWith("结束")) {
      timing = "after";
      label = label.slice(0, -2);
    }
    const phase = PHASE_ALIASES[label];
    if (!phase) {
      unknown.push(seg);
      continue;
    }
    // 效果文本可细化 timing(如触发时机列"结算"但文本是"结算阶段结束时")
    const refined = detectTiming(label, effectText);
    triggers.push({ phase: phase as CardTrigger["phase"], timing: refined === "during" ? timing : refined });
  }
  return { triggers, unknown };
}

/** 图片路径:列有值用列值,空则按 类别/ID 推导(票据 06 约定) */
function resolveImage(cat: CardDef["category"], id: string, col: unknown): string {
  const s = asStr(col);
  return s !== "" ? s : `assets/cards/${cat}/${id}.png`;
}

function collectUnknownCols(row: Row, known: string[], issues: BuildIssues, tag: string): void {
  for (const key of Object.keys(row)) {
    if (!known.includes(key) && !known.includes(key.replace(/[＊*]/g, "").replace(/\s+/g, ""))) {
      const v = row[key];
      if (v !== null && v !== undefined && asStr(v) !== "") {
        issues.warnings.push(`[${tag}] 未识别列 "${key}" 已忽略（值: ${asStr(v).slice(0, 30)}）`);
      }
    }
  }
}

const KNOWN_ROLE_COLS = ["编号ID", "名称", "称号", "性别", "特性标签", "简易模式可用", "触发时机", "技能效果文本", "图片文件名", "备注"];

/** 角色牌 sheet → CardDef[] */
export function parseRoleRows(rows: Row[], issues: BuildIssues): CardDef[] {
  const defs: CardDef[] = [];
  for (const raw of rows) {
    const row = normRow(raw);
    const known = KNOWN_ROLE_COLS;
    collectUnknownCols(row, known, issues, "角色牌");
    const id = asStr(cell(row, "编号ID"));
    if (id === "") continue; // 空行
    const effectText = asStr(cell(row, "技能效果文本"));
    const { triggers, unknown } = parseTriggers(cell(row, "触发时机"), effectText);
    for (const u of unknown) issues.errors.push(`[角色牌:${id}] 无法识别的触发时机段 "${u}"`);
    defs.push({
      id,
      name: asStr(cell(row, "名称")),
      category: "role",
      title: asStr(cell(row, "称号")) || undefined,
      gender: asStr(cell(row, "性别")) || undefined,
      tags: splitTags(cell(row, "特性标签")).length ? splitTags(cell(row, "特性标签")) : undefined,
      colorTag: asStr(cell(row, "特性标签")) || undefined,
      simpleOnly: isYes(cell(row, "简易模式可用")),
      count: 1,
      triggers,
      effectId: `role:${id}`,
      effectText,
      image: resolveImage("role", id, cell(row, "图片文件名")),
      note: asStr(cell(row, "备注")) || undefined,
    });
  }
  return defs;
}

const KNOWN_MARKET_COLS = ["编号ID", "名称", "价格", "类型", "数量", "黄色边框（简易模式可用）", "颜色分类", "触发时机", "效果文本", "图片文件名", "备注"];

/** 黑市牌 sheet → CardDef[] */
export function parseMarketRows(rows: Row[], issues: BuildIssues): CardDef[] {
  const defs: CardDef[] = [];
  for (const raw of rows) {
    const row = normRow(raw);
    const known = KNOWN_MARKET_COLS;
    collectUnknownCols(row, known, issues, "黑市牌");
    const id = asStr(cell(row, "编号ID"));
    if (id === "") continue;
    const effectText = asStr(cell(row, "效果文本"));
    const { triggers, unknown } = parseTriggers(cell(row, "触发时机"), effectText);
    for (const u of unknown) issues.errors.push(`[黑市牌:${id}] 无法识别的触发时机段 "${u}"`);
    defs.push({
      id,
      name: asStr(cell(row, "名称")),
      category: "market",
      subtype: asStr(cell(row, "类型")) || undefined,
      price: asNum(cell(row, "价格")),
      count: asNum(cell(row, "数量")) || 1,
      yellowBorder: isYes(cell(row, "黄色边框（简易模式可用）")),
      colorTag: asStr(cell(row, "颜色分类")) || undefined,
      triggers,
      effectId: `market:${id}`,
      effectText,
      image: resolveImage("market", id, cell(row, "图片文件名")),
      note: asStr(cell(row, "备注")) || undefined,
    });
  }
  return defs;
}

const KNOWN_FATE_COLS = ["编号ID", "序号", "类型", "荷官出牌区信息", "骰子点数对应牌型", "命运事件效果文本", "图片文件名", "备注"];

/** 命运牌 sheet → CardDef[](事件/命运保留触发时机原文,M3 再解析) */
export function parseFateRows(rows: Row[], issues: BuildIssues): CardDef[] {
  const defs: CardDef[] = [];
  for (const raw of rows) {
    const row = normRow(raw);
    const known = KNOWN_FATE_COLS;
    collectUnknownCols(row, known, issues, "命运牌");
    const id = asStr(cell(row, "编号ID"));
    if (id === "") continue;
    const effectText = asStr(cell(row, "命运事件效果文本"));
    defs.push({
      id,
      name: `命运牌${asStr(cell(row, "序号"))}`,
      category: "fate",
      subtype: asStr(cell(row, "类型")) || undefined,
      count: 1,
      triggers: [],
      triggerText: "",
      effectId: `fate:${id}`,
      effectText,
      image: resolveImage("fate", id, cell(row, "图片文件名")),
      fateData: {
        dealerHand: asStr(cell(row, "荷官出牌区信息")),
        diceMapping: asStr(cell(row, "骰子点数对应牌型")),
      },
      note: asStr(cell(row, "备注")) || undefined,
    });
  }
  return defs;
}

const KNOWN_EVENT_COLS = ["编号ID", "名称", "触发时机", "效果文本", "限用说明", "图片文件名", "备注"];

/** 事件牌 sheet → CardDef[](触发时机原样保留,MVP 排除 handler) */
export function parseEventRows(rows: Row[], issues: BuildIssues): CardDef[] {
  const defs: CardDef[] = [];
  for (const raw of rows) {
    const row = normRow(raw);
    const known = KNOWN_EVENT_COLS;
    collectUnknownCols(row, known, issues, "事件牌");
    const id = asStr(cell(row, "编号ID"));
    if (id === "") continue;
    defs.push({
      id,
      name: asStr(cell(row, "名称")),
      category: "event",
      count: 1,
      triggers: [],
      triggerText: asStr(cell(row, "触发时机")) || undefined,
      effectId: `event:${id}`,
      effectText: asStr(cell(row, "效果文本")),
      image: resolveImage("event", id, cell(row, "图片文件名")),
      limitNote: asStr(cell(row, "限用说明")) || undefined,
      note: asStr(cell(row, "备注")) || undefined,
    });
  }
  return defs;
}
