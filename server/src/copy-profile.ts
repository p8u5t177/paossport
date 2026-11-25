import type Database from "better-sqlite3";
import { getDb } from "./db.js";

/** Copy profile + profile_link rows from test DB into production DB (overwrites existing). */
export function copyProfileToProduction() {
  const source = getDb("test");
  const target = getDb("production");

  const profile = source.prepare("SELECT * FROM profile WHERE id = 1").get();
  if (!profile) {
    throw new Error("No profile row in test database");
  }
  const links = source
    .prepare("SELECT label, href, sort_order FROM profile_link WHERE profile_id = 1 ORDER BY sort_order")
    .all() as Array<{ label: string; href: string; sort_order: number }>;

  const row = profile as Record<string, unknown>;

  const copy = target.transaction(() => {
    target.prepare("DELETE FROM profile_link WHERE profile_id = 1").run();
    target
      .prepare(
        `INSERT OR REPLACE INTO profile (
          id, display_name, username, tagline, bio, avatar_url, avatar_focus_x, avatar_focus_y,
          current_place_name, current_lat, current_lng, updated_at
        ) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        row.display_name,
        row.username,
        row.tagline ?? "To Nowhere. And Everywhere",
        row.bio,
        row.avatar_url ?? null,
        row.avatar_focus_x ?? 0.5,
        row.avatar_focus_y ?? 0.5,
        row.current_place_name ?? null,
        row.current_lat ?? null,
        row.current_lng ?? null,
        row.updated_at ?? new Date().toISOString(),
      );

    const insertLink = target.prepare(
      "INSERT INTO profile_link (profile_id, label, href, sort_order) VALUES (1, ?, ?, ?)",
    );
    for (const link of links) {
      insertLink.run(link.label, link.href, link.sort_order);
    }
  });

  copy();
}