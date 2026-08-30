/**
 * 票据 19 — SQLite 局摘要存储（protocol.md v1 既定：仅终局写一条）。
 *
 * 用 Node 内置 node:sqlite（零依赖，Node 22.13+ 可用，docker node:22-alpine 自带）。
 * node:sqlite 较新、Vite/Vitest 内建清单未收录，故用 process.getBuiltinModule 运行时获取，
 * 不写 import 语句（打包器无需解析该模块）。
 * DB_PATH 未设置时为禁用态（record 为 no-op）——测试与本地开发不需要落库。
 * 表结构按 protocol.md：game_records(id, mode, player_count, started_at, ended_at, winner, summary_json)。
 */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** node:sqlite 最小接口面（本模块只用 exec + prepare.run） */
interface SqliteDbLike {
  exec(sql: string): void;
  prepare(sql: string): { run(...params: unknown[]): unknown };
}

function openSqlite(dbPath: string): SqliteDbLike {
  const sqlite = process.getBuiltinModule("node:sqlite") as unknown as {
    DatabaseSync: new (path: string) => SqliteDbLike;
  };
  return new sqlite.DatabaseSync(dbPath);
}

export interface GameSummaryRow {
  /** 房间 id */
  id: string;
  mode: string;
  playerCount: number;
  startedAt: number;
  endedAt: number;
  /** 胜者 playerId（多人并列逗号分隔） */
  winner: string;
  /** 摘要 JSON：回合数、各玩家终局票/筹/角色、胜者昵称 */
  summaryJson: string;
}

export class SummaryStore {
  private readonly db: SqliteDbLike | null;

  constructor(dbPath?: string) {
    if (!dbPath) {
      this.db = null;
      return;
    }
    mkdirSync(dirname(dbPath), { recursive: true });
    this.db = openSqlite(dbPath);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS game_records (
        id TEXT PRIMARY KEY,
        mode TEXT NOT NULL,
        player_count INTEGER NOT NULL,
        started_at INTEGER NOT NULL,
        ended_at INTEGER NOT NULL,
        winner TEXT NOT NULL,
        summary_json TEXT NOT NULL
      )
    `);
  }

  record(row: GameSummaryRow): void {
    if (!this.db) return;
    this.db
      .prepare(
        `INSERT OR REPLACE INTO game_records (id, mode, player_count, started_at, ended_at, winner, summary_json)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(row.id, row.mode, row.playerCount, row.startedAt, row.endedAt, row.winner, row.summaryJson);
  }
}
