/**
 * 票据 02 — 引擎核心状态形状。
 *
 * 设计原则：
 * 1. GameState 完全可 JSON 序列化，服务端是唯一权威持有者；
 * 2. 私密信息（手牌/弃牌区/删牌区/抽牌堆）一律完整存于 state，对外通过 redact() 裁剪——
 *    服务端按连接逐个裁剪后下发，引擎本身不做隐藏（金科玉律 1/2 的执行点在 server 分发层）；
 * 3. RNG 状态内嵌于 state（rngState），重放 = 初始 seed + 有序 Action 流，无需快照。
 */
import type { Card, Suit } from "../cards.js";

/** 回合 8 阶段，按规则书顺序 */
export type PhaseId =
  | "draw"
  | "swap"
  | "play"
  | "duel"
  | "settle"
  | "purchase"
  | "delete"
  | "reshape";

export const PHASE_ORDER: readonly PhaseId[] = [
  "draw",
  "swap",
  "play",
  "duel",
  "settle",
  "purchase",
  "delete",
  "reshape",
] as const;

/** 单个玩家的全部区域（含黑市芯片挂载记录与道具区） */
export interface PlayerZones {
  /** 抽牌堆：对所有人不可见（含本人查看也走服务端） */
  draw: Card[];
  /** 手牌：仅本人可见 */
  hand: Card[];
  /** 弃牌区：仅本人可见（金科玉律 1） */
  discard: Card[];
  /** 出牌区：对决阶段亮出后对所有人可见 */
  play: Card[];
  /** 删牌区：移出游戏，仅本人可见 */
  deleted: Card[];
  /** 强化芯片：牌实例 id → 黑市牌 defId（每张牌限 1，不可替换） */
  chips: Record<string, string>;
  /** 道具区：备用道具 defId 列表（正面朝上，公开） */
  items: string[];
}

/** 玩家区域名（chooseCard 交互的牌来源） */
export type ZoneId = "hand" | "discard" | "draw" | "play" | "deleted";

/**
 * 换牌行为变体（票据 20 角色效果）。
 * - normal：默认「弃至多 3 张 → 抽至手牌上限」
 * - drawFirst：塔罗师 先抽后弃，每次最多抽 2 弃 2
 * - anyCount：偶像 每次换牌可选任意数量（弃 4+ 得 1 血筹）
 */
export type SwapPolicy = "normal" | "drawFirst" | "anyCount";

/** 对决判定后的一张牌（含 JOKER/视为 JOKER 的赋值结果） */
export interface DuelResultCard {
  id: string;
  rank: number;
  suit: Suit;
  /** 该牌是 JOKER 或被角色/芯片视为 JOKER（枪手的 4） */
  wasJoker: boolean;
}

/**
 * 对决结果条目（票据 20）。
 * 由结算阶段写入，供结算型效果消费（广播喇叭/赌徒虹膜等需知道本回合各玩家牌型与名次）。
 */
export interface DuelResultEntry {
  playerId: string;
  /** 牌型等级（hand-evaluator 的 HandCategory 数值） */
  category: number;
  totalPoints: number;
  /** 名次，1 起 */
  rank: number;
  /** 判定出的每张牌（用于枪手删除"视为小丑的 4"等按牌回溯的效果） */
  cards: DuelResultCard[];
}

/**
 * 待决交互（M2.4 效果挂起）。
 * 同一时刻最多 1 个挂起：效果 run 写入它并返回，reducer 等待对应玩家的 resolvePrompt Action。
 * candidates:choosePlayer = 候选玩家 id 列表;chooseCard = 候选牌实例 id 列表（私密，redact 时只对目标玩家展开）。
 */
export type PendingPrompt =
  | {
      kind: "choosePlayer";
      /** 触发该交互的效果 id（resolve 时查注册表） */
      effectId: string;
      /** 等待谁输入（效果触发者，简单交互下即效果归属者） */
      playerId: string;
      candidates: string[];
      promptText?: string;
    }
  | {
      kind: "chooseCard";
      effectId: string;
      playerId: string;
      candidates: string[];
      /**
       * 候选来源区域。ZoneId 之外：
       * - "deck" = 全牌库（抽牌堆 + 弃牌区），供清洁工"从全牌库删除 1 张"这类跨区域选牌使用（票据 20）；
       * - "market" = 黑市区栏位序号（字符串化下标），供 043 再来一批"选黑市牌回堆底"使用。
       */
      from: ZoneId | "deck" | "market";
      /**
       * 交互中间态（票据 20）：挂起方写入、resolve 时原样回传。
       * 用于"选完对手再让对手选牌"这类跨玩家链式交互（026 共享信息的对手队列、033 定点爆破的宣称点数），
       * 避免为此往 GameState 里塞一次性字段。
       */
      carry?: string;
      promptText?: string;
    }
  | {
      /** 二选一/多选一（票据 20）："是否发动"类主动技能；options[0] 为默认项（超时托管取它） */
      kind: "chooseOption";
      effectId: string;
      playerId: string;
      options: { id: string; label: string }[];
      promptText?: string;
    };

export interface PlayerState {
  id: string;
  name: string;
  /** 座位号 0..n-1，顺时针排列 */
  seat: number;
  /** 角色牌 defId，M2 前为 null（白板局） */
  characterId: string | null;
  /** 性别（用于魅魔58效果）；'M'=♂，'F'=♀，'?'=同时视为♂与♀ */
  gender?: "M" | "F" | "?";
  /** 血筹（公开信息，金科玉律 12） */
  chips: number;
  tickets: number;
  /** 本回合剩余换牌次数 */
  swapLeft: number;
  /** 购买阶段是否已翻面（不可再购买） */
  purchaseFlipped: boolean;
  /** 当前阶段是否已完成个人操作（等待其他玩家） */
  phaseReady: boolean;
  /** 本回合角色技能失效（暂时失忆等，undefined=正常） */
  skillDisabled?: boolean;
  /** 本回合强化芯片失效（磁山隧道等，undefined=正常） */
  chipsDisabled?: boolean;
  /** 手牌上限加成（魔术师 +1 等，undefined=0） */
  handLimitBonus?: number;
  /** 对决总点数加成（赌场荷官 +20 等，undefined=0） */
  duelPointsBonus?: number;
  /** 换牌次数加成（酒保 +1 等，undefined=0） */
  swapBonus?: number;
  // —— 以下为票据 20 新增的效果状态（全部可选，缺省即无，保持重放兼容） ——
  /** 换牌行为变体（塔罗师先抽后弃 / 偶像任意数量），undefined=normal */
  swapPolicy?: SwapPolicy;
  /** 下回合换牌次数修正（餐车投毒 -2），undefined=0 */
  nextTurnSwapDelta?: number;
  /** 下回合技能失效（暂时失忆），undefined=正常 */
  nextTurnSkillDisabled?: boolean;
  /** 本回合跳过的阶段（闭店礼跳过购买 / 冻结车厢跳过重整 / 广播喇叭失败） */
  skipPhases?: PhaseId[];
  /**
   * 本回合获得的【车票】（卡面旧记 [星星]/★）。
   * 武士按它兑换血筹、赌徒虹膜按它扣减（最低 0，不追溯往回合所得）。
   */
  ticketsGainedThisTurn?: number;
  /** 宣告记录：effectId/道具 defId → 宣告值（广播喇叭/赌徒虹膜/魔术橡皮/荷官证/职业赌徒） */
  declarations?: Record<string, string>;
  /** 本回合是否已购买过（吉祥物首次购买半价判定） */
  purchasedThisTurn?: boolean;
  /** 本回合额外免费删牌额度（黑客 +1 / 高中生执行一次删牌） */
  freeDeleteExtra?: number;
  /** 单张强化芯片失效的牌 id 列表（消磁枪 / 屏蔽器），区别于全局 chipsDisabled */
  disabledChipCards?: string[];
  zones: PlayerZones;
  /** 本回合必须跳过删牌阶段（女仆25）；由 whiteboard delete 阶段入口检查 */
  skipDeletePhase?: boolean;
  /** 本回合只可支付血筹删牌（飞车党26、双生子兄28） */
  paidDeleteOnly?: boolean;
  /** 无面人(38)：当前临时获得的角色技能来源 defId */
  temporaryRoleSource?: string;
  /** 无面人(38)：临时技能在哪类阶段开始时过期 */
  roleSkillExpiresAt?: PhaseId;
  /** 捣蛋鬼(22)：必须跳过重整阶段 */
  mustSkipReshape?: boolean;
  /** 捣蛋鬼(22)：技能无法被无效 */
  skillImmune?: boolean;
  /** 白蔷薇(40)：本回合是否已获得首个换牌者奖励 */
  firstSwapBonusTaken?: boolean;
  /** 双重人格公主(53)：当前人格 'normal' | 'manic' */
  currentPersona?: "normal" | "manic";
  /** 双重人格公主(53)：弃牌堆是否正面朝上（躁狂人格=弃牌堆对他人可见） */
  personaDiscardFaceUp?: boolean;
  /** 编剧(52)：本回合是否已获得恰好50的奖励（防重复） */
  编剧BonusTaken?: boolean;
  /** 资本家(60)：本阶段是否已兑换过 */
  exchangeThisPhase?: boolean;
  /** 猪神病人(48)：上回合交血筹的玩家 id */
  lastPigPattedBy?: string;
}

/** 黑市区一个栏位 */
export interface BlackMarketSlot {
  /** 黑市牌定义 id（数据管道票据 06 提供），空位为 null */
  defId: string | null;
  price: number;
  /** 叠加在牌上的血筹（购买阶段结束时最右两格各 +1） */
  bonusChips: number;
  /** 黑市牌类型（强化芯片/秘密交易/道具），购买处理分发用（M2.3） */
  subtype?: string;
}

export interface BlackMarketState {
  slots: BlackMarketSlot[];
  /** 供应堆（背面朝上，洗混后的 defId+price 序列） */
  supply: { defId: string; price: number; subtype?: string }[];
  /**
   * 道具回收站：使用后的道具背面朝上弃入此处（规则 5.6）。
   * 道具不可重复使用。
   */
  recycle: string[];
}

export interface LogEntry {
  turn: number;
  phase: PhaseId;
  text: string;
}

/**
 * 阶段推进挂起点（票据 20）。
 * 交互可能挂在阶段钩子里（如"对决前猜测特权证"挂起于 duel/before），此时阶段主体不能先跑完。
 * 记录"钩子已跑完、主体待执行"的位置，resolvePrompt 后据此继续推进。
 */
export interface Suspended {
  phase: PhaseId;
  /** afterDone=离开该阶段的 after 钩子已跑完；beforeDone=进入该阶段的 before 钩子已跑完 */
  step: "afterDone" | "beforeDone";
}

export interface GameState {
  players: PlayerState[]; // 按座位顺时针
  phase: PhaseId;
  turn: number; // 从 1 开始
  /** 临时特权证持有者座位；null 仅存在于开局分配前 */
  passHolderSeat: number | null;
  /** 简易模式（规则 10.1：去 J/Q/K/A 牌库、无免费删牌），票据 24 核对修复 */
  simple?: boolean;
  blackMarket: BlackMarketState;
  /** 事件牌（MVP 默认关闭，保留字段） */
  eventCardId: string | null;
  /** 待决交互（M2.4）；非空时 reducer 只接受该玩家的 resolvePrompt */
  pendingPrompt: PendingPrompt | null;
  /** 本回合对决结果（结算阶段写入；结算型效果消费，票据 20） */
  duelResult?: DuelResultEntry[];
  /** 阶段推进被交互挂起的位置（票据 20）；非空表示 pendingPrompt 解除后需继续推进 */
  suspended?: Suspended;
  /** mulberry32 内部状态（32 位无符号），重放根 */
  rngState: number;
  log: LogEntry[];
  finished: boolean;
  /** 胜者 playerId 列表（平局可多人） */
  winners: string[];
  /** 窥天师(44)：天意暗置区（第一回合购买阶段前放入黑市顶7张） */
  天意Slots?: Card[];
  /** 我的名字？(42)：自定义牌型名称 */
  role42CustomHandName?: string;
  /** 江东之主(47)：永久持有特权证（对手无法获得）；创建游戏时设置 */
  permanentPassHolder?: boolean;
  /** 无面人(38)：角色牌堆（开局构建，每回合抽2选1） */
  role38CharacterDeck?: Card[];
  /**
   * 开局删除队列（createGame 发牌后处理）。
   * role:05 特型演员：开局删除手牌中的2；role:21 黑客：初始构筑删除（等飞飞确认文字后实现）。
   * 每项处理后清空；本字段仅在 createGame 返回前有意义。
   */
  setupDeleteQueue?: SetupDeleteEntry[];
}

/** 开局删除队列条目 */
export interface SetupDeleteEntry {
  playerId: string;
  /** 删除几张 */
  count: number;
  /** 仅删除此 rank 的牌（省略则不限） */
  rank?: number;
}
