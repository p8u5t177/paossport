import type { Request } from "express";
import { getAppConfig } from "./app-config.js";

export type DataScope = "test" | "production";

/** Always available: test uses app.db, production uses production.db under the same data directory. */
export function dualDatabaseEnabled(): boolean {
  return true;
}

export function publicDataScope(): DataScope {
  return getAppConfig().publicScope;
}

export function adminDataScope(_req?: Request): DataScope {
  return getAppConfig().adminScope;
}

export function previewDataScope(_req: Request, sessionValid: boolean): DataScope {
  if (sessionValid) return adminDataScope();
  return publicDataScope();
}