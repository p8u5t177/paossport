import { AsyncLocalStorage } from "node:async_hooks";
import type { Request, Response, NextFunction } from "express";
import type Database from "better-sqlite3";
import { getDb } from "./db.js";
import { adminDataScope, previewDataScope, publicDataScope } from "./data-scope.js";
import { sessionValid } from "./auth.js";

const storage = new AsyncLocalStorage<Database.Database>();

export function activeDb(): Database.Database {
  const db = storage.getStore();
  if (!db) {
    throw new Error("Database not available for this request");
  }
  return db;
}

function bindDb(db: Database.Database) {
  return (_req: Request, _res: Response, next: NextFunction) => {
    storage.run(db, () => next());
  };
}

export function attachPublicDb() {
  return bindDb(getDb(publicDataScope()));
}

export function attachPreviewDb(sessionDb: Database.Database) {
  return (req: Request, res: Response, next: NextFunction) => {
    const scope = previewDataScope(req, sessionValid(sessionDb, req));
    storage.run(getDb(scope), () => next());
  };
}


export function attachAdminDb(sessionDb: Database.Database) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!sessionValid(sessionDb, req)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    storage.run(getDb(adminDataScope(req)), () => next());
  };
}