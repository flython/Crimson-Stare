/* eslint-disable no-undef -- Node 脚本，eslint 默认环境未含 node globals */
/* eslint-disable no-undef -- Node 脚本，eslint 默认环境未含 node globals */
/**
 * 票据 18 — 卡牌图片资产同步。
 *
 * 仓库根 assets/cards/<类>/<ID>.png 是图片唯一事实源（ID→文件名约定，热替换生效）；
 * 本脚本在 web dev/build 前把它拷贝到 packages/web/public/cards，
 * 由 Vite 在开发服务器与 dist 构建中原样伺服。
 * 路径按 <web包>/../../assets/cards 解析，本地与 docker 构建（WORKDIR /app）通用。
 * 源目录缺失时跳过并提示（占位回退仍可玩，不阻塞）。
 */
import { cpSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const src = join(webRoot, "..", "..", "assets", "cards");
const dest = join(webRoot, "public", "cards");

if (!existsSync(src)) {
  console.warn(`[sync-assets] 未找到 ${src}，跳过（卡面走占位渲染）`);
  process.exit(0);
}

rmSync(dest, { recursive: true, force: true });
cpSync(src, dest, { recursive: true });
console.log(`[sync-assets] 已同步 ${src} -> ${dest}`);
