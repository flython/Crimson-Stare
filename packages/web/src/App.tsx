import { ENGINE_VERSION } from "@crimson/engine";

export default function App() {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        background: "#2a1d20",
        color: "#e9404b",
        fontFamily: "system-ui, sans-serif",
        touchAction: "manipulation",
      }}
    >
      <h1 style={{ fontSize: 42, letterSpacing: 8 }}>血色牌局</h1>
      <p style={{ color: "#ffc840" }}>归乡特快 · 发车准备中（engine v{ENGINE_VERSION}）</p>
    </div>
  );
}
