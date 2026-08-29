/**
 * 卡池数据模型(票据 06 遗留项落地)。
 *
 * 单一事实源:engine 定义 CardDef/CardPool 类型;
 * card-data 包的 zod schema 与转换脚本按此对齐(转换侧 import type 复用本类型),
 * server 启动时 loadCardPool() 读 config/cards/*.json 得到 CardPool 注入 createGame。
 *
 * 字段命名与 config/cards/*.json 完全一致(JSON 是类型的外化)。
 */
import type { PhaseId } from "./core/state.js";
import type { Timing } from "./core/effects.js";

export type CardCategory = "role" | "market" | "fate" | "event";

/** 效果触发点:阶段 + 时间点(与 effects.ts 的 (phase, timing) 对齐) */
export interface CardTrigger {
  phase: PhaseId;
  timing: Timing;
}

/** 命运牌专用:荷官出牌区信息 + 骰子点数→牌型映射(单人模式 M3 消费) */
export interface FateData {
  dealerHand: string;
  diceMapping: string;
}

/** 一张卡的定义(同名牌用 count 表达,引擎建牌池时展开为实例) */
export interface CardDef {
  /** 模板编号,全局唯一,如 "01" / "001" / "F1" / "E1" */
  id: string;
  name: string;
  category: CardCategory;
  /** 黑市:强化芯片/秘密交易/道具;命运:基础/高级 */
  subtype?: string;
  /** 同名牌张数 */
  count: number;
  /** 黑市牌价格 */
  price?: number;
  /** 黑市:黄色边框=简易模式可用 */
  yellowBorder?: boolean;
  /** 角色:简易模式可用 */
  simpleOnly?: boolean;
  /** 牌型绿/容错蓝/互动暗红(黑市)或特性标签(角色) */
  colorTag?: string;
  /** 引擎效果注册点(可为空=常驻效果由 reducer 持续评估) */
  triggers: CardTrigger[];
  /** 触发时机列原始文本(事件/命运保留,M3 再解析) */
  triggerText?: string;
  /** 效果注册表 key,如 "role:01" / "market:001";缺失时引擎降级为占位效果 */
  effectId?: string;
  /** 卡面效果原文,UI 展示用;引擎不解析 */
  effectText: string;
  image: string;
  /** 角色:称号 */
  title?: string;
  /** 角色:性别 */
  gender?: string;
  /** 角色:特性标签数组 */
  tags?: string[];
  fateData?: FateData;
  /** 事件:限用说明 */
  limitNote?: string;
  note?: string;
}

/** 全量卡池(一次转换产出,server 启动时整体载入) */
export interface CardPool {
  version: string;
  counts: Record<CardCategory, number>;
  roles: CardDef[];
  market: CardDef[];
  fate: CardDef[];
  events: CardDef[];
}
