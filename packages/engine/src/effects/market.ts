/**
 * 黑市牌效果注册（票据 12，M2.3）。
 *
 * 每个黑市牌一个 EffectDef，id = "market:<defId>"，source = "blackMarket"；
 * 购买结算走 handlePurchase（whiteboard 按注册表分发：秘密交易 run 立即结算，强化芯片 run 挂起选牌 + resolve 插入并应用，
 * 备用道具 run 存 items——whiteboard 按 "备用道具" 识别而 JSON subtype 为 "道具"，故统一注册 run 存道具区）。
 *
 * 强化芯片（金科玉律 3/4/7）：
 * - 每牌限 1 芯片不可替换；插入后点数 2-14 校验；无合法目标则弃置该黑市牌（费用不退）。
 * - 数值类（校准器/限流阀）在 resolve 用 addPermanentRank(cardId, delta)（含 2-14 校验）；
 * - 花色/牌型类（变色墨水/双生镜片/百变影像等）是对决时生效的声明效果：插入（chipInstall）已实现，
 *   生效逻辑依赖 hand-evaluator 支持芯片视图，本轮以 TODO 注释占位（不改 hand-evaluator）。
 * - 血筹镀层（出/夺）为简单声明类：以 (duel, during) EffectDef 注册，run 对芯片持有者实际生效。
 *
 * 阶段时机效果：triggerText 含【对决】【结算】的牌，注册对应 (phase, timing) 的 EffectDef（可复用同一 run 工厂）。
 *
 * 规则来源：docs/血色牌局_规则书.md（§5.6 黑市牌处理、金科玉律 3/4/7/10）+ config/cards/market.json 的 effectText。
 * 实现约束：只组合 primitives/interactive 原语，同模式卡用工厂复用；缺原语在本地组合；
 * 未实现的效果注册 TODO 占位 run（保留购买结算链路，不挂起不报错）。
 */
import type { GameState, PlayerState } from "../core/state.js";
import type { EffectDef } from "../core/effects.js";
import { registerEffect, getEffect } from "../core/effects.js";
import {
  addPermanentRank,
  deleteCards,
  deleteFromDiscard,
  findPlayer,
  gainChips,
  getPlayer,
  logText,
  rollDice,
  spendChips,
} from "./primitives.js";
import { promptChooseCard, promptChoosePlayer } from "./interactive.js";

/**
 * 强化芯片插入（购买结算）。
 * - run：列出弃牌堆合法候选（未挂芯片、非 JOKER、点数增量后仍在 2-14）并挂起选牌；无候选则弃置该黑市牌；
 * - resolve：把芯片挂到所选牌上（zones.chips[cardId] = defId），数值类同步 addPermanentRank。
 * delta=0 表示声明类芯片（不改点数，只挂载）；noJoker 默认 true：JOKER 无花色/点数，数值类不可插，
 * 声明类对其亦无意义（对决阶段 JOKER 本就任意花色点数），故一律排除。
 */
function chipInstall({
  defId,
  delta = 0,
  noJoker = true,
  promptText,
}: {
  defId: string;
  delta?: number;
  noJoker?: boolean;
  promptText?: string;
}): EffectDef {
  return {
    id: `market:${defId}`,
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const candidates = p.zones.discard
        .filter((c) => {
          if (c.id in p.zones.chips) return false; // 金科玉律 3：每牌限 1 芯片
          if (c.isJoker) return !noJoker; // JOKER 无点数/花色，默认不可插
          if (delta !== 0) {
            const next = (c.rank ?? 0) + delta;
            return next >= 2 && next <= 14; // 金科玉律 4：点数范围 2-14
          }
          return true;
        })
        .map((c) => c.id);
      if (candidates.length === 0) {
        logText(state, `${ctx.effectId} 无合法插入目标，该黑市牌弃置（费用不退）`);
        return;
      }
      promptChooseCard(state, ctx.effectId, ctx.playerId!, candidates, "discard", promptText ?? "选择插入芯片的牌");
    },
    resolve: (state, ctx, choice) => {
      const cardId = Array.isArray(choice) ? choice[0]! : choice;
      const p = getPlayer(state, ctx);
      p.zones.chips[cardId] = defId;
      logText(state, `${p.name} 将强化芯片 ${defId} 插入 ${cardId}`);
      if (delta !== 0) addPermanentRank(cardId, delta)(state, ctx);
    },
  };
}

/** 找持有某芯片的所有玩家（阶段时机效果按持有者生效，不依赖 ctx.playerId——resolveTiming 对 blackMarket 源以 players[0] 触发） */
function chipHolders(state: GameState, chipDefId: string): PlayerState[] {
  return state.players.filter((p) => Object.values(p.zones.chips).includes(chipDefId));
}

/** 备用道具：购买存入道具区（使用结算 M2.4 遗留，本轮先注册 run 保证购买链路） */
function itemEffect(defId: string): EffectDef {
  return {
    id: `market:${defId}`,
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      p.zones.items.push(defId);
      logText(state, `${p.name} 获得备用道具 ${defId}（存入道具区，使用结算 M2.4 遗留）`);
    },
  };
}

/** 秘密交易占位：依赖缺失状态/交互的牌，注册 run 仅记 TODO 日志（保持购买链路，不挂起不报错） */
function placeholderTrade(defId: string, reason: string): EffectDef {
  return {
    id: `market:${defId}`,
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      logText(state, `${ctx.effectId} ${reason}（TODO 占位）`);
    },
  };
}

/** 闭店礼：获得血筹并跳过本回合购买（purchaseFlipped+phaseReady） */
function closingBonus(defId: string, chips: number): EffectDef {
  return {
    id: `market:${defId}`,
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      gainChips(chips)(state, ctx);
      p.purchaseFlipped = true;
      p.phaseReady = true;
      logText(state, `${p.name} 获得 ${chips} 血筹，跳过本回合购买`);
    },
  };
}

/** 注册黑市牌全部效果（模块加载时执行一次） */
export function registerMarketEffects(): void {
  // ── 强化芯片：数值类（校准器/限流阀，金科玉律 3/4）────────────────────────
  for (const [defId, delta] of [
    ["001", 1],
    ["002", 2],
    ["003", 3],
    ["004", 4],
    ["005", -1],
    ["006", -2],
    ["007", -3],
  ] as const) {
    registerEffect(chipInstall({ defId, delta, promptText: `选择插入芯片（点数 ${delta > 0 ? "+" : ""}${delta}）的牌` }));
  }

  // ── 强化芯片：声明类（插入已实现；对决/结算生效依赖 hand-evaluator 芯片视图，TODO）──
  for (const defId of ["008", "009", "010", "011", "012", "017", "019", "020"]) {
    registerEffect(chipInstall({ defId }));
  }
  // TODO: 008 变色墨水（花色任意）/009 黑色芯片（♠♣）/010 红色芯片（♦♥）/011 数字滑轨（点数任意）/
  // 012 百变影像（花色点数任意）/017 双生镜片（视为 2 张，不可插 JOKER）的对决声明，
  // 019/020 血筹镀层（胜/败）"结算时若持有【临时特权证】"（引擎需特权证持有判定）——均需 hand-evaluator/状态扩展，留后续票据。

  // 021/022 血筹镀层（出/夺）：简单声明类，对决时实际生效（见下方阶段时机效果）
  registerEffect(chipInstall({ defId: "021" }));
  registerEffect(chipInstall({ defId: "022" }));

  // ── 秘密交易：黄边 ────────────────────────────────────────────────
  registerEffect(cheapDelete()); // 027 廉价删除
  registerEffect(violentDelete()); // 031 暴力删除
  registerEffect(freeTopCard()); // 034 货箱盲掏
  registerEffect(diceGain()); // 036 对赌协议
  registerEffect(placeholderTrade("037", "特权分红：依赖【临时特权证】持有判定，MVP 未实现"));
  registerEffect(placeholderTrade("043", "再来一批：黑市区选牌入堆底/补位/再购买交互，MVP 未实现"));

  // ── 秘密交易：非黄边（尽量注册简单/自动类）──────────────────────────────
  registerEffect(closingBonus("028", 4)); // 闭店礼·小
  registerEffect(closingBonus("029", 7)); // 闭店礼·中
  registerEffect(closingBonus("030", 11)); // 闭店礼·大
  registerEffect(passGrab()); // 039 鬼手探囊
  registerEffect(shareChips()); // 041 血筹分享
  registerEffect(pluckChip()); // 042 拔除芯片
  // TODO: 026 共享信息（自己删 2 张+每位对手各删 1 张）、032 精准删除（抽3删0-2弃余）、033 定点爆破（宣称点数）、
  // 035 黑厢抢夺（轮流掷骰比大小，暗拍留 M3）、038 冻结车厢（跳过重整需新状态）、040 餐车投毒（下回合换牌-2 需新状态）、
  // 044 暂时失忆（下回合技能失效需新状态）——多目标交互或需状态扩展，留 M2.4。

  // ── 备用道具（JSON subtype="道具"；whiteboard 按 "备用道具" 识别，故统一注册 run 存 items）──
  for (const defId of ["045", "046", "047", "048", "049", "050", "051", "052"]) {
    registerEffect(itemEffect(defId));
  }
  // TODO: 道具"使用时"结算（M2.4 后）：045 信号干扰器（swap 后随机弃1抽1）/046 广播喇叭（宣称临时特权证，成败奖惩）/
  // 047 赌徒虹膜（猜对手牌型）/048 皮下密信（花2血筹抽3）/049 防护屏障（取消针对自己的秘密交易）/
  // 050 魔术橡皮（宣称牌型视为高牌）/051 消磁枪（令一张芯片失效）/052 荷官证（改比总点数）——使用时机与 target 交互留 M2.4。

  // ── 强化芯片：非黄边（简单类注册，复杂类 TODO）────────────────────────────
  registerEffect(chipInstall({ defId: "013" })); // 空白模板：无效果
  // TODO: 014 仿制印章（视为出牌区另一张）、015 复制芯片（复制他人芯片）、016 磁力线圈（重洗前挑牌放顶）、
  // 018 加密线路（若持有【临时特权证】得 2 【车票】）、023 弹簧夹层（花血筹临时改点数）、024 屏蔽器（令一张芯片失效）、
  // 025 自毁芯片（结算末删本回合打出牌）——对决/结算声明或需状态扩展，留后续。

  // ── 阶段时机效果（对决/结算 during，resolveTiming 触发）───────────────────
  registerEffect({
    id: "market:021:during:duel",
    source: "blackMarket",
    phase: "duel",
    timing: "during",
    run: (state) => {
      for (const p of chipHolders(state, "021")) {
        p.chips += 2;
        logText(state, `${p.name} 血筹镀层（出）：对决获得 2 血筹`);
      }
    },
  });
  registerEffect({
    id: "market:022:during:duel",
    source: "blackMarket",
    phase: "duel",
    timing: "during",
    run: (state, ctx) => {
      const holder = chipHolders(state, "022")[0];
      if (!holder || state.pendingPrompt) return;
      const opponents = state.players.filter((p) => p.id !== holder.id).map((p) => p.id);
      if (opponents.length === 0) return;
      promptChoosePlayer(state, "market:022:during:duel", holder.id, opponents, "选择抢夺 1 血筹的对手");
    },
    resolve: (state, ctx, choice) => {
      const holder = chipHolders(state, "022")[0];
      if (!holder) return;
      const targetId = Array.isArray(choice) ? choice[0]! : choice;
      spendChips(1)(state, { ...ctx, playerId: targetId });
      gainChips(1)(state, { ...ctx, playerId: holder.id });
    },
  });
  // TODO: 008-012/017 的花色-点数声明、019/020 的"结算时若持有【临时特权证】" 对应 (duel/settle, during) 注册 —— 待 hand-evaluator 芯片视图。

  // ── 秘密交易（购买立即结算，非交互自动类）─────────────────────────────────
}

/** 027 廉价删除：可免费删除至多 2 张自己弃牌堆的牌（金科玉律 10 带芯片一同删除） */
function cheapDelete(): EffectDef {
  return {
    id: "market:027",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const candidates = p.zones.discard.map((c) => c.id);
      if (candidates.length === 0) {
        logText(state, "market:027 无可删牌，效果无目标");
        return;
      }
      promptChooseCard(state, "market:027", ctx.playerId!, candidates, "discard", "选择要删除的牌（至多 2 张）");
    },
    resolve: (state, ctx, choice) => {
      const ids = Array.isArray(choice) ? choice : [choice];
      if (ids.length === 0) {
        logText(state, "market:027 未选择删除任何牌");
        return;
      }
      deleteCards(ids, { free: 2 })(state, ctx);
    },
  };
}

/** 031 暴力删除：选择自己或一位对手，删除其抽牌堆顶 3 张（目标抽牌堆须至少有 3 张） */
function violentDelete(): EffectDef {
  return {
    id: "market:031",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const candidates = state.players.filter((pl) => pl.zones.draw.length >= 3).map((pl) => pl.id);
      if (candidates.length === 0) {
        logText(state, "market:031 无人抽牌堆有 3 张牌，该黑市牌弃置");
        return;
      }
      promptChoosePlayer(state, "market:031", ctx.playerId!, candidates, "选择删除谁抽牌堆顶的 3 张牌");
    },
    resolve: (state, ctx, choice) => {
      const target = findPlayer(state, Array.isArray(choice) ? choice[0]! : choice);
      const picks = target.zones.draw.splice(0, 3);
      target.zones.deleted.push(...picks);
      logText(state, `${target.name} 抽牌堆顶 ${picks.length} 张牌被删除（暴力删除）`);
    },
  };
}

/** 034 货箱盲掏：免费获得黑市牌堆顶的 1 张牌，并按该牌类型走购买结算（强化芯片挂起/秘密交易立即/道具存 items） */
function freeTopCard(): EffectDef {
  return {
    id: "market:034",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const top = state.blackMarket.supply.shift();
      if (!top) {
        logText(state, "market:034 黑市供应堆已空，无牌可拿");
        return;
      }
      const def = getEffect(`market:${top.defId}`);
      if (def) {
        def.run(state, { config: ctx.config, playerId: ctx.playerId, effectId: def.id });
        return;
      }
      if (top.subtype === "备用道具" || top.subtype === "道具") {
        p.zones.items.push(top.defId);
        logText(state, `${p.name} 免费获得备用道具 ${top.defId}`);
        return;
      }
      logText(state, `market:034 免费获得 ${top.defId}（效果未实现）`);
    },
  };
}

/** 036 对赌协议：投一次骰子，获得骰子点数的血筹 */
function diceGain(): EffectDef {
  return {
    id: "market:036",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const n = rollDice(state);
      gainChips(n)(state, ctx);
    },
  };
}

/** 039 鬼手探囊：获得临时特权证 */
function passGrab(): EffectDef {
  return {
    id: "market:039",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      state.passHolderSeat = p.seat;
      logText(state, `${p.name} 获得临时特权证（鬼手探囊）`);
    },
  };
}

/** 041 血筹分享：获得 5 血筹，其他每位对手获得 1 血筹 */
function shareChips(): EffectDef {
  return {
    id: "market:041",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      gainChips(5)(state, ctx);
      for (const pl of state.players) {
        if (pl.id !== p.id) gainChips(1)(state, { ...ctx, playerId: pl.id });
      }
    },
  };
}

/** 042 拔除芯片：拔除自己弃牌堆中的 1 张强化芯片（连同所在牌删除），获得 4 血筹 */
function pluckChip(): EffectDef {
  return {
    id: "market:042",
    source: "blackMarket",
    phase: "purchase",
    timing: "during",
    run: (state, ctx) => {
      const p = getPlayer(state, ctx);
      const candidates = p.zones.discard.filter((c) => c.id in p.zones.chips).map((c) => c.id);
      if (candidates.length === 0) {
        logText(state, "market:042 弃牌堆无带强化芯片的牌，该黑市牌弃置");
        return;
      }
      promptChooseCard(state, "market:042", ctx.playerId!, candidates, "discard", "选择要拔除的强化芯片所在牌");
    },
    resolve: (state, ctx, choice) => {
      const cardId = Array.isArray(choice) ? choice[0]! : choice;
      deleteFromDiscard(cardId)(state, ctx);
      gainChips(4)(state, ctx);
    },
  };
}

registerMarketEffects();
