/**
 * 卡池数据管道主入口(票据 06 遗留项落地)。
 *
 * 用法:
 *   npm run cards:build   — 读 config/card-pool-template.xlsx → 校验 → 写 config/cards/*.json
 *   npm run cards:check   — 只校验不写盘(CI 友好)
 *
 * 校验分级:errors(硬错,拒绝写盘)与 warnings(警告,继续写盘)。
 * 产物 JSON 提交 git;server 启动时 loadCardPool() 读入注入 engine(见 packages/server/src/cardPool.ts)。
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";import { CardDefSchema, validateDefs } from "./schemas.js";
import type { BuildIssues } from "./schemas.js";
import { parseRoleRows, parseMarketRows, parseFateRows, parseEventRows } from "./mapping.js";
import type { CardPool, CardCategory } from "@crimson/engine";

const __dirname = dirname(fileURLToPath(import.meta.url));
/** monorepo 根目录(本文件位于 packages/card-data/src/) */
const ROOT = resolve(__dirname, "../../..");
const DEFAULT_SRC = resolve(ROOT, "config/card-pool-template.xlsx");
const DEFAULT_OUT = resolve(ROOT, "config/cards");

export interface BuildResult {
  pool: CardPool;
  issues: BuildIssues;
  outDir: string;
}

/** 读 xlsx 的指定 sheet 为行数组(sheet_to_json,表头行作 key) */
function sheetToRows(path: string, sheet: string): Record<string, unknown>[] {
  const wb = XLSX.readFile(path);
  const ws = wb.Sheets[sheet];
  if (!ws) throw new Error(`模板缺少 sheet: ${sheet}`);
  return XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, { defval: null });
}

export function build(
  sourcePath = DEFAULT_SRC,
  outDir = DEFAULT_OUT,
  opts: { write?: boolean } = {},
): BuildResult {
  const write = opts.write ?? true;
  const issues: BuildIssues = { errors: [], warnings: [] };

  const roles = parseRoleRows(sheetToRows(sourcePath, "角色牌") as Record<string, unknown>[], issues);
  const market = parseMarketRows(sheetToRows(sourcePath, "黑市牌") as Record<string, unknown>[], issues);
  const fate = parseFateRows(sheetToRows(sourcePath, "命运牌") as Record<string, unknown>[], issues);
  const events = parseEventRows(sheetToRows(sourcePath, "事件牌") as Record<string, unknown>[], issues);

  // 结构层(zod)+ 业务层(重复 ID 等)校验
  for (const def of [...roles, ...market, ...fate, ...events]) {
    const parsed = CardDefSchema.safeParse(def);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        issues.errors.push(`[${def.category}:${def.id}] ${issue.path.join(".")} ${issue.message}`);
      }
    }
  }
  const biz = validateDefs([...roles, ...market, ...fate, ...events]);
  issues.errors.push(...biz.errors);
  issues.warnings.push(...biz.warnings);

  // 图片文件存在性检查:素材可能未到位,仅警告
  for (const def of [...roles, ...market, ...fate, ...events]) {
    const imgPath = resolve(ROOT, def.image);
    try {
      readFileSync(imgPath);
    } catch {
      issues.warnings.push(`[${def.category}:${def.id}] 图片不存在: ${def.image}`);
    }
  }

  if (issues.errors.length > 0) {
    throw new Error(
      `卡池校验失败(${issues.errors.length} 处硬错,${issues.warnings.length} 处警告):\n` +
        issues.errors.map((e) => `  ✗ ${e}`).join("\n"),
    );
  }

  const pool: CardPool = {
    version: new Date().toISOString().slice(0, 10),
    counts: {
      role: roles.length,
      market: market.length,
      fate: fate.length,
      event: events.length,
    } satisfies Record<CardCategory, number>,
    roles,
    market,
    fate,
    events,
  };

  mkdirSync(outDir, { recursive: true });
  if (write) {
    writeJson(outDir, "manifest.json", {
      version: pool.version,
      counts: pool.counts,
      generatedAt: new Date().toISOString(),
    });
    writeJson(outDir, "roles.json", pool.roles);
    writeJson(outDir, "market.json", pool.market);
    writeJson(outDir, "fate.json", pool.fate);
    writeJson(outDir, "events.json", pool.events);
  }

  return { pool, issues, outDir };
}

function writeJson(dir: string, file: string, data: unknown): void {
  writeFileSync(resolve(dir, file), `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

/** CLI 入口(tsx src/build.ts / --check-only)。
 * 注意:import.meta.url 中文路径会 percent-encode,须用 fileURLToPath 解码后再与 argv[1] 比较 */
if (process.argv[1] && fileURLToPath(import.meta.url).endsWith(process.argv[1])) {
  const checkOnly = process.argv.includes("--check-only");
  const result = build(undefined, undefined, { write: !checkOnly });
  const { issues, outDir } = result;
  for (const w of issues.warnings) console.warn(`  ⚠ ${w}`);
  console.log(
    `[cards] ${checkOnly ? "校验" : "转换"}完成: 角色 ${result.pool.counts.role} / 黑市 ${result.pool.counts.market} / 命运 ${result.pool.counts.fate} / 事件 ${result.pool.counts.event}`,
  );
  console.log(`[cards] 产物目录: ${outDir}${checkOnly ? "(未写盘)" : ""}`);
}
