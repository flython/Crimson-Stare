/**
 * 票据 28 — CardPicker 空选支持（allowEmpty）组件级测试。
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CardPicker from "./CardPicker.js";
import type { Card } from "@crimson/engine";

function makeCard(id: string, suit: string, rank: number): Card {
  return { id, suit: suit as Card["suit"], rank, isJoker: false };
}

describe("CardPicker allowEmpty", () => {
  const cards = [makeCard("S7", "S", 7), makeCard("H9", "H", 9)];

  it("默认不显示跳过按钮，空选时确认按钮禁用", () => {
    const onConfirm = vi.fn();
    render(
      <CardPicker candidates={["S7", "H9"]} from="discard" cards={cards} onConfirm={onConfirm} />,
    );
    expect(screen.queryByText("跳过（不选）")).toBeNull();
    const confirm = screen.getByText("确认选择") as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it("allowEmpty 时显示跳过按钮，点击以空数组回调 onConfirm", () => {
    const onConfirm = vi.fn();
    render(
      <CardPicker
        candidates={["S7", "H9"]}
        from="discard"
        cards={cards}
        allowEmpty
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("跳过（不选）"));
    expect(onConfirm).toHaveBeenCalledOnce();
    expect(onConfirm.mock.calls[0]![0]).toEqual([]);
  });

  it("allowEmpty 时空选直接确认也以空数组回调（跳过/放弃语义，票据 28）", () => {
    const onConfirm = vi.fn();
    render(
      <CardPicker
        candidates={["S7", "H9"]}
        from="discard"
        cards={cards}
        allowEmpty
        onConfirm={onConfirm}
      />,
    );
    const confirm = screen.getByText("确认选择") as HTMLButtonElement;
    expect(confirm.disabled).toBe(false); // 空选不禁用
    fireEvent.click(confirm);
    expect(onConfirm.mock.calls[0]![0]).toEqual([]);
  });

  it("选中后确认回调选中的牌 id（有选时空选语义不影响正常选择）", () => {
    const onConfirm = vi.fn();
    render(
      <CardPicker
        candidates={["S7", "H9"]}
        from="discard"
        cards={cards}
        allowEmpty
        onConfirm={onConfirm}
      />,
    );
    fireEvent.click(screen.getByText("7"));
    fireEvent.click(screen.getByText("确认选择（1）"));
    expect(onConfirm.mock.calls[0]![0]).toEqual(["S7"]);
  });
});