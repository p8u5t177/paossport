import type { Request, Response, NextFunction } from "express";
import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";

export const SESSION_COOKIE = "paossport_session";
const SESSION_DAYS = 14;

export function createSession(db: Database.Database): string {
  const token = randomBytes(32).toString("hex");
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  db.prepare("INSERT INTO admin_session (token, expires_at) VALUES (?, ?)").run(token, expires);
  return token;
}

export function setSessionCookie(res: Response, token: string) {
  const maxAge = SESSION_DAYS * 864e5;
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge,
    path: "/",
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
}

export function destroySession(db: Database.Database, token: string) {
  db.prepare("DELETE FROM admin_session WHERE token = ?").run(token);
}

function validSession(db: Database.Database, token: string | undefined): boolean {
  if (!token) return false;
  const row = db.prepare("SELECT expires_at FROM admin_session WHERE token = ?").get(token) as
    | { expires_at: string }
    | undefined;
  if (!row) return false;
  if (new Date(row.expires_at) < new Date()) {
    db.prepare("DELETE FROM admin_session WHERE token = ?").run(token);
    return false;
  }
  return true;
}

export function requireAdmin(db: Database.Database) {
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies[SESSION_COOKIE] as string | undefined;
    if (!validSession(db, token)) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  };
}

export function sessionValid(db: Database.Database, req: Request): boolean {
  return validSession(db, req.cookies[SESSION_COOKIE] as string | undefined);
}
