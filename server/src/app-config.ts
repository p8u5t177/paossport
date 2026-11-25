import type Database from "better-sqlite3";
import type { DataScope } from "./data-scope.js";

const KEYS = {
  adminDataScope: "admin_data_scope",
  publicDataScope: "public_data_scope",
} as const;

export type AppConfigSnapshot = {
  adminScope: DataScope;
  publicScope: DataScope;
};

let cached: AppConfigSnapshot | null = null;
let configDbRef: Database.Database | null = null;

function parseScope(value: string | undefined, fallback: DataScope): DataScope {
  if (value === "production") return "production";
  if (value === "test") return "test";
  return fallback;
}

function readScope(configDb: Database.Database, key: string, fallback: DataScope): DataScope {
  const row = configDb.prepare("SELECT value FROM app_config WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return parseScope(row?.value, fallback);
}

export function ensureAppConfigTable(configDb: Database.Database) {
  configDb.exec(`
    CREATE TABLE IF NOT EXISTS app_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT OR IGNORE INTO app_config (key, value) VALUES ('${KEYS.adminDataScope}', 'test');
    INSERT OR IGNORE INTO app_config (key, value) VALUES ('${KEYS.publicDataScope}', 'test');
  `);
}

export function loadAppConfig(configDb: Database.Database): AppConfigSnapshot {
  configDbRef = configDb;
  ensureAppConfigTable(configDb);
  cached = {
    adminScope: readScope(configDb, KEYS.adminDataScope, "test"),
    publicScope: readScope(configDb, KEYS.publicDataScope, "test"),
  };
  return cached;
}

export function getAppConfig(): AppConfigSnapshot {
  if (!cached) {
    if (configDbRef) return loadAppConfig(configDbRef);
    return { adminScope: "test", publicScope: "test" };
  }
  return cached;
}

export function updateAppConfig(
  configDb: Database.Database,
  patch: Partial<AppConfigSnapshot>,
): AppConfigSnapshot {
  ensureAppConfigTable(configDb);
  const upsert = configDb.prepare(
    `INSERT INTO app_config (key, value, updated_at) VALUES (?, ?, datetime('now'))
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
  );
  if (patch.adminScope) upsert.run(KEYS.adminDataScope, patch.adminScope);
  if (patch.publicScope) upsert.run(KEYS.publicDataScope, patch.publicScope);
  return loadAppConfig(configDb);
}