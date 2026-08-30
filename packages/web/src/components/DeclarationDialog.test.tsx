/**
 * 票据 23 — web 组件级测试（Vitest）。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import DeclarationDialog from "./DeclarationDialog.js";
import type { Card, CardDef } from "@crimson/engine";

const CHIP_DEFS: Record<string, CardDef> = {
  "008": { id: "008", name: "变色墨水", category: "market", count: 1, effectText: "花色可视为任意", image: "", triggers: [] },
  "009": { id: "009", name: "黑色芯片", category: "market", count: 1, effectText: "花色视为♠或♣", image: "", triggers: [] },
  "010": { id: "010", name: "红色芯片", category: "market", count: 1, effectText: "花色视为♦或♥", image: "", triggers: [] },
  "011": { id: "011", name: "数字滑轨", category: "market", count: 1, effectText: "点数可视为任意", image: "", triggers: [] },
  "012": { id: "012", name: "百变影像", category: "market", count: 1, effectText: "视为任意花色与点数", image: "", triggers: [] },
};

function makeCard(id: string, suit: string, rank: number): Card {
  return { id, suit: suit as Card["suit"], rank, isJoker: false };
}

/** 测试用声明卡片类型 */
type TestDeclCard = { card: Card; chipDefId: string; chipDef: CardDef };

describe("DeclarationDialog", () => {
  it("渲染变色墨水时显示花色选择器", () => {
    const cards: TestDeclCard[] = [
      { card: makeCard("H7", "H", 7), chipDefId: "008", chipDef: CHIP_DEFS["008"]! },
    ];
    render(<DeclarationDialog cards={cards} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("声明花色")).toBeTruthy();
    expect(screen.getByText("任意花色")).toBeTruthy();
  });

  it("渲染数字滑轨时显示点数选择器", () => {
    const cards: TestDeclCard[] = [
      { card: makeCard("S10", "S", 10), chipDefId: "011", chipDef: CHIP_DEFS["011"]! },
    ];
    render(<DeclarationDialog cards={cards} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("声明点数")).toBeTruthy();
    expect(screen.getByText("任意")).toBeTruthy();
  });

  it("渲染百变影像时显示 Joker 选择器", () => {
    const cards: TestDeclCard[] = [
      { card: makeCard("D5", "D", 5), chipDefId: "012", chipDef: CHIP_DEFS["012"]! },
    ];
    render(<DeclarationDialog cards={cards} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("任意（等价 JOKER）")).toBeTruthy();
  });

  it("确认按钮调用 onConfirm 并传入 declarations", () => {
    const cards: TestDeclCard[] = [
      { card: makeCard("H7", "H", 7), chipDefId: "008", chipDef: CHIP_DEFS["008"]! },
    ];
    const onConfirm = vi.fn();
    render(<DeclarationDialog cards={cards} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("确认并出牌"));
    expect(onConfirm).toHaveBeenCalledOnce();
    const decl = onConfirm.mock.calls[0]![0] as Record<string, string>;
    expect(decl["H7"]).toBe("any");
  });

  it("选黑桃后确认，declarations 含 S", () => {
    const cards: TestDeclCard[] = [
      { card: makeCard("C2", "C", 2), chipDefId: "009", chipDef: CHIP_DEFS["009"]! },
    ];
    const onConfirm = vi.fn();
    render(<DeclarationDialog cards={cards} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("♠ 黑桃"));
    fireEvent.click(screen.getByText("确认并出牌"));
    const decl = onConfirm.mock.calls[0]![0] as Record<string, string>;
    expect(decl["C2"]).toBe("S");
  });

  it("取消按钮调用 onCancel", () => {
    const cards: TestDeclCard[] = [
      { card: makeCard("H7", "H", 7), chipDefId: "008", chipDef: CHIP_DEFS["008"]! },
    ];
    const onCancel = vi.fn();
    render(<DeclarationDialog cards={cards} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("取消出牌"));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("多类型芯片各自显示对应选择器", () => {
    const cards: TestDeclCard[] = [
      { card: makeCard("H7", "H", 7), chipDefId: "008", chipDef: CHIP_DEFS["008"]! },
      { card: makeCard("S10", "S", 10), chipDefId: "011", chipDef: CHIP_DEFS["011"]! },
    ];
    render(<DeclarationDialog cards={cards} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("声明花色")).toBeTruthy();
    expect(screen.getByText("声明点数")).toBeTruthy();
  });
});
