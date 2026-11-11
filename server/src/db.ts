import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "..", "data"));
const dbPath = process.env.DATABASE_PATH ?? path.join(dataDir, "app.db");

export function getDb() {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL DEFAULT 'Traveler',
      username TEXT NOT NULL DEFAULT 'traveler',
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS profile_link (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id INTEGER NOT NULL DEFAULT 1 REFERENCES profile(id),
      label TEXT NOT NULL,
      href TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS post (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      caption TEXT NOT NULL DEFAULT '',
      taken_at TEXT NOT NULL,
      published_at TEXT NOT NULL DEFAULT (datetime('now')),
      place_name TEXT,
      lat REAL,
      lng REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS post_image (
      id TEXT PRIMARY KEY,
      post_id TEXT NOT NULL REFERENCES post(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      storage_key TEXT NOT NULL,
      public_url TEXT NOT NULL,
      width INTEGER,
      height INTEGER,
      alt TEXT
    );

    CREATE TABLE IF NOT EXISTS admin_session (
      token TEXT PRIMARY KEY,
      expires_at TEXT NOT NULL
    );

    INSERT OR IGNORE INTO profile (id, display_name, username, bio)
    VALUES (1, 'Alex Rivera', 'alexr', 'Muted maps and loud sunsets. A travel journal without the noise.');
  `);
  return db;
}

export type PostRow = {
  id: string;
  slug: string;
  caption: string;
  taken_at: string;
  published_at: string;
  place_name: string | null;
  lat: number | null;
  lng: number | null;
};

export type PostImageRow = {
  id: string;
  post_id: string;
  sort_order: number;
  public_url: string;
  width: number | null;
  height: number | null;
  alt: string | null;
};
