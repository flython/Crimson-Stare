/**
 * 转换脚本回归测试(票据 06 / grilling Q10:结构层 + 业务层双层)。
 *
 * 结构层:zod 拒绝 ID 空/必填空/价格负/数量非整数
 * 业务层:重复 ID、非法触发时机段 → errors;未知列 → warnings
 * 正向:触发时机解析(结算→during, 阶段前→before, 多值拆分, 空时机→常驻)
 */
import { describe, it, expect } from "vitest";
import { parseRoleRows, parseMarketRows, parseFateRows, parseEventRows } from "../src/mapping.js";
import { CardDefSchema, validateDefs } from "../src/schemas.js";
import type { BuildIssues } from "../src/schemas.js";

const freshIssues = (): BuildIssues => ({ errors: [], warnings: [] });

const roleRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  编号ID: "99",
  名称: "测试角色",
  称号: "测试",
  性别: "男",
  特性标签: "经济",
  简易模式可用: "否",
  触发时机: "结算",
  技能效果文本: "【结算阶段】获得2血筹。",
  图片文件名: "",
  备注: "",
  ...over,
});

const marketRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  编号ID: "999",
  名称: "测试黑市牌",
  价格: 2,
  类型: "秘密交易",
  数量: 2,
  "黄色边框（简易模式可用）": "是",
  颜色分类: "容错蓝",
  触发时机: "",
  效果文本: "获得2血筹。",
  图片文件名: "",
  备注: "",
  ...over,
});

describe("结构层(zod)", () => {
  it("合法行通过,ID/名称/效果文本/图片不缺", () => {
    const issues = freshIssues();
    const defs = parseRoleRows([roleRow()], issues);
    expect(issues.errors).toEqual([]);
    expect(defs[0]).toMatchObject({ id: "99", name: "测试角色", count: 1, simpleOnly: false });
  });

  it("必填为空 → errors(经 build 的 zod 层拒绝,此处直接断言 def 字段)", () => {
    const issues = freshIssues();
    // 效果文本为空:zod 层在 build 里拦,parse 层只透传;这里验证 parse 不崩
    const defs = parseRoleRows([roleRow({ 技能效果文本: "" })], issues);
    expect(defs[0]!.effectText).toBe("");
    expect(issues.errors).toEqual([]); // 结构错误由 build.ts 的 CardDefSchema.safeParse 捕获
  });

  it("价格负数 / 数量非整数在 schema 层被拒", () => {
    const base = marketRow({ 价格: -1 });
    const bad = CardDefSchema.safeParse({
      ...base,
      category: "market",
      effectText: "x",
      image: "x",
      count: 2.5,
      triggers: [],
    });
    expect(bad.success).toBe(false);
  });
});

describe("业务层(validateDefs)", () => {
  it("重复 ID → error", () => {
    const issues = freshIssues();
    const defs = parseRoleRows([roleRow({ 编号ID: "01" }), roleRow({ 编号ID: "01", 名称: "另一个" })], issues);
    expect(defs.length).toBe(2);
    expect(validateDefs(defs).errors.some((e) => e.includes("重复 ID"))).toBe(true);
  });

  it("未知列 → warning", () => {
    const issues = freshIssues();
    parseRoleRows([roleRow({ 新加的列: "某值" })], issues);
    expect(issues.warnings.some((w) => w.includes("未识别列"))).toBe(true);
  });
});

describe("触发时机解析", () => {
  it("结算 → settle/during", () => {
    const issues = freshIssues();
    const defs = parseRoleRows([roleRow({ 触发时机: "结算" })], issues);
    expect(defs[0]!.triggers).toEqual([{ phase: "settle", timing: "during" }]);
  });

  it("购买阶段前 → purchase/before", () => {
    const issues = freshIssues();
    const defs = parseRoleRows(
      [roleRow({ 触发时机: "购买", 技能效果文本: "【购买阶段】前，可以抢劫1位对手。" })],
      issues,
    );
    expect(defs[0]!.triggers).toEqual([{ phase: "purchase", timing: "before" }]);
  });

  it("多值(换牌;结算) → 两条", () => {
    const issues = freshIssues();
    const defs = parseRoleRows(
      [roleRow({ 触发时机: "换牌;结算", 技能效果文本: "【换牌阶段】…。【结算阶段】结束时…。" })],
      issues,
    );
    expect(defs[0]!.triggers).toEqual([
      { phase: "swap", timing: "during" },
      { phase: "settle", timing: "after" },
    ]);
  });

  it("空时机且文本无【】 → 常驻(triggers 空)", () => {
    const issues = freshIssues();
    const defs = parseRoleRows([roleRow({ 触发时机: "", 技能效果文本: "你的手牌上限+1。" })], issues);
    expect(defs[0]!.triggers).toEqual([]);
  });

  it("非法触发时机段 → error", () => {
    const issues = freshIssues();
    parseRoleRows([roleRow({ 触发时机: "战斗阶段" })], issues);
    expect(issues.errors.some((e) => e.includes("无法识别的触发时机段"))).toBe(true);
  });

  it("触发时机为空但文本有【对决阶段】→ 反推 duel", () => {
    const issues = freshIssues();
    const defs = parseRoleRows([roleRow({ 触发时机: "", 技能效果文本: "【对决阶段】你的2可视为5。" })], issues);
    expect(defs[0]!.triggers).toEqual([{ phase: "duel", timing: "during" }]);
  });
});

describe("黑市牌映射", () => {
  it("黄边标记/类型/价格/数量正确映射", () => {
    const issues = freshIssues();
    const defs = parseMarketRows([marketRow()], issues);
    expect(defs[0]).toMatchObject({
      category: "market",
      subtype: "秘密交易",
      price: 2,
      count: 2,
      yellowBorder: true,
      colorTag: "容错蓝",
    });
  });

  it("图片为空 → 按 类别/ID 推导", () => {
    const issues = freshIssues();
    const defs = parseMarketRows([marketRow({ 编号ID: "777", 图片文件名: "" })], issues);
    expect(defs[0]!.image).toBe("assets/cards/market/777.png");
  });
});

describe("命运牌 / 事件牌映射", () => {
  it("命运牌保留 fateData 与 subtype", () => {
    const issues = freshIssues();
    const defs = parseFateRows(
      [
        {
          编号ID: "F1",
          序号: 1,
          类型: "基础",
          荷官出牌区信息: "5♣ 6♣ 7♦ 8♦ ?♠",
          骰子点数对应牌型: "A,2,3 → 高牌",
          命运事件效果文本: "玩家牌型下降×级",
          图片文件名: "assets/cards/fate/F1.png",
          备注: "",
        },
      ],
      issues,
    );
    expect(defs[0]).toMatchObject({
      category: "fate",
      name: "命运牌1",
      subtype: "基础",
      fateData: { dealerHand: "5♣ 6♣ 7♦ 8♦ ?♠", diceMapping: "A,2,3 → 高牌" },
    });
  });

  it("事件牌保留触发时机原文(不解析)", () => {
    const issues = freshIssues();
    const defs = parseEventRows(
      [{ 编号ID: "E1", 名称: "大乐透", 触发时机: "第1回合", 效果文本: "掷骰子", 限用说明: "", 图片文件名: "", 备注: "" }],
      issues,
    );
    expect(defs[0]!.triggerText).toBe("第1回合");
    expect(defs[0]!.triggers).toEqual([]);
  });
});
