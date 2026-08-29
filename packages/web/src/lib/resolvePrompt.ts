/**
 * 票据 14 — resolvePrompt 发送函数。
 *
 * 遗留标注（联调待 15 号票据确认）：
 * - `docs/protocol.md` 未定义 `resolvePrompt` 顶层消息，按票据约定定义 `{ type: "resolvePrompt", choice }`；
 * - playerId 由 server 从连接身份推断，客户端不携带；
 * - 引擎 Action 形状为 `{ type: "resolvePrompt"; playerId; choice }`（engine/src/game/whiteboard.ts），
 *   最终走 protocol 的 `action` 包装（`{ type: "action", action }`）还是本顶层消息，由 15 号联调定。
 */
export function sendResolvePrompt(ws: WebSocket, choice: string | string[]): void {
  ws.send(JSON.stringify({ type: "resolvePrompt", choice }));
}
