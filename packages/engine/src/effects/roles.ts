/**
 * 角色牌效果注册（票据 11，M2.2）。
 *
 * 占位骨架（由 subAgent 填充）：
 * - roleSetup：游戏开始时应用一次的常驻/初始效果（赌场荷官对决点数、银行职员初始血筹、魔术师手牌上限、酒保换牌次数等）
 * - registerRoleEffects：注册阶段效果（EffectDef，roleId 命名空间）与动作钩子（swapZero 等）
 *
 * 规则来源：docs/血色牌局_规则书.md + config/cards/roles.json 的 effectText（冲突时卡面文本优先，金科玉律 14）。
 * 实现约束：只组合 primitives/interactive 原语，同模式卡用工厂复用；未实现的效果不注册（由 placeholderEffect 降级）。
 */
import type { EffectBody } from "./primitives.js";

/** 游戏开始时应用一次（createGame 设置 characterId 后调用；key = effectId 前缀 "role:XX"） */
export const roleSetup: Record<string, EffectBody> = {};

/** 注册角色阶段效果与动作钩子（模块加载时执行一次） */
export function registerRoleEffects(): void {}

registerRoleEffects();
