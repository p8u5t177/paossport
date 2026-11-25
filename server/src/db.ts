import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { normalizeStoryInput } from "./rich-text.js";
import type { DataScope } from "./data-scope.js";

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(process.cwd(), "..", "data"));
const testDbPath = process.env.DATABASE_PATH?.trim() || path.join(dataDir, "app.db");
const productionDbPath =
  process.env.DATABASE_PATH_PRODUCTION?.trim() || path.join(dataDir, "production.db");

const openDatabases = new Map<string, Database.Database>();

export function dataDirectory() {
  return dataDir;
}

function resolveDbPath(scope: DataScope): string {
  if (scope === "production") return productionDbPath;
  return testDbPath;
}

export function getDb(scope: DataScope = "test") {
  const dbPath = resolveDbPath(scope);
  const existing = openDatabases.get(dbPath);
  if (existing) return existing;

  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      display_name TEXT NOT NULL DEFAULT 'Traveler',
      username TEXT NOT NULL DEFAULT 'traveler',
      tagline TEXT NOT NULL DEFAULT 'To Nowhere. And Everywhere',
      bio TEXT NOT NULL DEFAULT '',
      avatar_url TEXT,
      avatar_focus_x REAL NOT NULL DEFAULT 0.5,
      avatar_focus_y REAL NOT NULL DEFAULT 0.5,
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
      content_html TEXT NOT NULL DEFAULT '',
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

    CREATE TABLE IF NOT EXISTS trip (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      from_place_name TEXT,
      from_lat REAL,
      from_lng REAL,
      arrived_place_name TEXT,
      arrived_lat REAL,
      arrived_lng REAL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS chapter (
      id TEXT PRIMARY KEY,
      trip_id TEXT NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
      slug TEXT NOT NULL,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(trip_id, slug)
    );

    CREATE TABLE IF NOT EXISTS album (
      id TEXT PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS album_trip (
      album_id TEXT NOT NULL REFERENCES album(id) ON DELETE CASCADE,
      trip_id TEXT NOT NULL REFERENCES trip(id) ON DELETE CASCADE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (album_id, trip_id)
    );

    CREATE UNIQUE INDEX IF NOT EXISTS album_trip_trip_id ON album_trip(trip_id);

    INSERT OR IGNORE INTO profile (id, display_name, username, bio)
    VALUES (1, 'Alex Rivera', 'alexr', 'Muted maps and loud sunsets. A travel journal without the noise.');
  `);

  const profileCols = db.prepare("PRAGMA table_info(profile)").all() as { name: string }[];
  const profileColNames = new Set(profileCols.map((col) => col.name));
  if (!profileColNames.has("tagline")) {
    db.exec(`ALTER TABLE profile ADD COLUMN tagline TEXT NOT NULL DEFAULT 'To Nowhere. And Everywhere'`);
  }
  if (!profileColNames.has("current_place_name")) {
    db.exec(`ALTER TABLE profile ADD COLUMN current_place_name TEXT`);
  }
  if (!profileColNames.has("current_lat")) {
    db.exec(`ALTER TABLE profile ADD COLUMN current_lat REAL`);
  }
  if (!profileColNames.has("current_lng")) {
    db.exec(`ALTER TABLE profile ADD COLUMN current_lng REAL`);
  }
  if (!profileColNames.has("avatar_focus_x")) {
    db.exec(`ALTER TABLE profile ADD COLUMN avatar_focus_x REAL NOT NULL DEFAULT 0.5`);
  }
  if (!profileColNames.has("avatar_focus_y")) {
    db.exec(`ALTER TABLE profile ADD COLUMN avatar_focus_y REAL NOT NULL DEFAULT 0.5`);
  }

  const postCols = db.prepare("PRAGMA table_info(post)").all() as { name: string }[];
  const postColNames = new Set(postCols.map((col) => col.name));
  if (!postColNames.has("is_draft")) {
    db.exec(`ALTER TABLE post ADD COLUMN is_draft INTEGER NOT NULL DEFAULT 0`);
  }
  if (!postColNames.has("chapter_id")) {
    db.exec(`ALTER TABLE post ADD COLUMN chapter_id TEXT REFERENCES chapter(id) ON DELETE SET NULL`);
  }
  if (!postColNames.has("trip_id")) {
    db.exec(`ALTER TABLE post ADD COLUMN trip_id TEXT REFERENCES trip(id) ON DELETE SET NULL`);
  }
  if (!postColNames.has("content_html")) {
    db.exec(`ALTER TABLE post ADD COLUMN content_html TEXT NOT NULL DEFAULT ''`);
    const legacy = db
      .prepare(`SELECT id, caption FROM post WHERE content_html = '' AND caption != ''`)
      .all() as { id: string; caption: string }[];
    const setStory = db.prepare(`UPDATE post SET content_html = ?, caption = ? WHERE id = ?`);
    for (const row of legacy) {
      const story = normalizeStoryInput(row.caption);
      setStory.run(story.contentHtml, story.caption, row.id);
    }
  }

  const tripCols = db.prepare("PRAGMA table_info(trip)").all() as { name: string }[];
  const tripColNames = new Set(tripCols.map((col) => col.name));
  if (!tripColNames.has("from_place_name")) {
    db.exec(`ALTER TABLE trip ADD COLUMN from_place_name TEXT`);
  }
  if (!tripColNames.has("from_lat")) {
    db.exec(`ALTER TABLE trip ADD COLUMN from_lat REAL`);
  }
  if (!tripColNames.has("from_lng")) {
    db.exec(`ALTER TABLE trip ADD COLUMN from_lng REAL`);
  }
  if (!tripColNames.has("arrived_place_name")) {
    db.exec(`ALTER TABLE trip ADD COLUMN arrived_place_name TEXT`);
  }
  if (!tripColNames.has("arrived_lat")) {
    db.exec(`ALTER TABLE trip ADD COLUMN arrived_lat REAL`);
  }
  if (!tripColNames.has("arrived_lng")) {
    db.exec(`ALTER TABLE trip ADD COLUMN arrived_lng REAL`);
  }

  const imageCols = db.prepare("PRAGMA table_info(post_image)").all() as { name: string }[];
  const imageColNames = new Set(imageCols.map((col) => col.name));
  if (!imageColNames.has("has_location_metadata")) {
    db.exec(`ALTER TABLE post_image ADD COLUMN has_location_metadata INTEGER NOT NULL DEFAULT 0`);
  }
  if (!imageColNames.has("has_date_metadata")) {
    db.exec(`ALTER TABLE post_image ADD COLUMN has_date_metadata INTEGER NOT NULL DEFAULT 0`);
  }
  if (!imageColNames.has("focus_x")) {
    db.exec(`ALTER TABLE post_image ADD COLUMN focus_x REAL NOT NULL DEFAULT 0.5`);
  }
  if (!imageColNames.has("focus_y")) {
    db.exec(`ALTER TABLE post_image ADD COLUMN focus_y REAL NOT NULL DEFAULT 0.5`);
  }
  if (!imageColNames.has("fit_mode")) {
    db.exec(`ALTER TABLE post_image ADD COLUMN fit_mode TEXT NOT NULL DEFAULT 'cover'`);
  }
  if (!imageColNames.has("feed_public_url")) {
    db.exec(`ALTER TABLE post_image ADD COLUMN feed_public_url TEXT`);
  }

  const albumCols = db.prepare("PRAGMA table_info(album)").all() as { name: string }[];
  const albumColNames = new Set(albumCols.map((col) => col.name));
  if (!albumColNames.has("is_featured")) {
    db.exec(`ALTER TABLE album ADD COLUMN is_featured INTEGER NOT NULL DEFAULT 0`);
  }

  openDatabases.set(dbPath, db);
  return db;
}

export type PostRow = {
  id: string;
  slug: string;
  caption: string;
  content_html: string;
  taken_at: string;
  published_at: string;
  is_draft: number;
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
