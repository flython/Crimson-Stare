import { useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";

export interface DiceRollAnimationProps {
  /** 服务端掷骰结果（1-6）；null = 未投出/等待中 */
  result: number | null;
  /** 滚动动画时长 ms（默认 500，票据约定 0.5s 后显示结果） */
  durationMs?: number;
  /** 动画结束回调 */
  onDone?: () => void;
  /** 骰子边长 px */
  size?: number;
}

/** 3×3 点阵（位置 1-9），各点数占位 */
const DIE_PIPS: Record<number, number[]> = {
  1: [5],
  2: [3, 7],
  3: [3, 5, 7],
  4: [1, 3, 7, 9],
  5: [1, 3, 5, 7, 9],
  6: [1, 3, 4, 6, 7, 9],
};

function pipStyle(pos: number): CSSProperties {
  return {
    gridRowStart: Math.ceil(pos / 3),
    gridColumnStart: ((pos - 1) % 3) + 1,
  };
}

/**
 * DiceRollAnimation — 服务端掷骰结果的前端播放组件（纯展示）。
 * result 变更后播放 0.5s 滚动动画（旋转 + 面数轮换），随后定格显示结果并回调 onDone。
 */
export default function DiceRollAnimation({
  result,
  durationMs = 500,
  onDone,
  size = 64,
}: DiceRollAnimationProps) {
  const [face, setFace] = useState<number | null>(result);
  const [rolling, setRolling] = useState(false);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  useEffect(() => {
    if (result === null) {
      setFace(null);
      setRolling(false);
      return;
    }
    setRolling(true);
    const tick = window.setInterval(() => {
      setFace(1 + Math.floor(Math.random() * 6));
    }, 80);
    const timer = window.setTimeout(() => {
      window.clearInterval(tick);
      setFace(result);
      setRolling(false);
      onDoneRef.current?.();
    }, durationMs);
    return () => {
      window.clearInterval(tick);
      window.clearTimeout(timer);
    };
  }, [result, durationMs]);

  const pips = face !== null ? (DIE_PIPS[face] ?? []) : [];

  return (
    <div
      className={`dice${rolling ? " rolling" : ""}${!rolling && face !== null ? " result" : ""}`}
      style={{ width: size, height: size }}
      role="status"
      aria-label={rolling ? "掷骰中…" : `掷骰结果 ${face ?? "—"}`}
    >
      {pips.map((pos) => (
        <span key={pos} className="dice-pip" style={pipStyle(pos)} />
      ))}
    </div>
  );
}
