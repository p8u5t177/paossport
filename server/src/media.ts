import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import exifr from "exifr";
import { v4 as uuid } from "uuid";

export const MEDIA_ROOT = path.resolve(
  process.env.MEDIA_ROOT ?? path.join(process.cwd(), "media"),
);

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

export const MASTER_MAX_EDGE = 2000;
export const FEED_MAX_EDGE = 960;
const MASTER_WEBP_QUALITY = 85;
const FEED_WEBP_QUALITY = 80;

export function feedStorageKeyForMaster(storageKey: string) {
  return storageKey.replace(/\.webp$/i, "-feed.webp");
}

function mediaPath(storageKey: string) {
  return path.join(MEDIA_ROOT, storageKey.replace(/\\/g, "/"));
}

function publicUrlForStorageKey(storageKey: string) {
  return `/media/${storageKey.replace(/\\/g, "/")}`;
}

export function ensureMediaDirs() {
  fs.mkdirSync(MEDIA_ROOT, { recursive: true });
}

export async function parseExif(buffer: Buffer) {
  try {
    const exif = await exifr.parse(buffer, { pick: ["DateTimeOriginal", "latitude", "longitude"] });
    if (!exif) return {};
    return {
      takenAt: exif.DateTimeOriginal ? new Date(exif.DateTimeOriginal).toISOString() : undefined,
      lat: typeof exif.latitude === "number" ? exif.latitude : undefined,
      lng: typeof exif.longitude === "number" ? exif.longitude : undefined,
    };
  } catch {
    return {};
  }
}

async function writeFeedVariant(source: Buffer | string, dest: string) {
  await sharp(source)
    .rotate()
    .resize({ width: FEED_MAX_EDGE, height: FEED_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: FEED_WEBP_QUALITY })
    .toFile(dest);
}

export async function ensureFeedVariantForStorageKey(storageKey: string): Promise<string | null> {
  const masterPath = mediaPath(storageKey);
  if (!masterPath.startsWith(MEDIA_ROOT) || !fs.existsSync(masterPath)) return null;
  const feedKey = feedStorageKeyForMaster(storageKey);
  const feedPath = mediaPath(feedKey);
  if (!fs.existsSync(feedPath)) {
    await writeFeedVariant(masterPath, feedPath);
  }
  return publicUrlForStorageKey(feedKey);
}

export async function saveImage(
  file: Pick<Express.Multer.File, "buffer" | "mimetype">,
  options?: { feedVariant?: boolean },
) {
  if (!ALLOWED.has(file.mimetype)) {
    throw new Error("Invalid file type");
  }
  const feedVariant = options?.feedVariant !== false;
  const now = new Date();
  const sub = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(MEDIA_ROOT, sub);
  fs.mkdirSync(dir, { recursive: true });
  const id = uuid();
  const filename = `${id}.webp`;
  const dest = path.join(dir, filename);
  const meta = await sharp(file.buffer)
    .rotate()
    .resize({ width: MASTER_MAX_EDGE, height: MASTER_MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .webp({ quality: MASTER_WEBP_QUALITY })
    .withMetadata({ orientation: 1 })
    .toFile(dest);
  const storageKey = path.join(sub, filename);
  const publicUrl = publicUrlForStorageKey(storageKey);
  let feedPublicUrl: string | undefined;
  if (feedVariant) {
    const feedFilename = `${id}-feed.webp`;
    const feedDest = path.join(dir, feedFilename);
    await writeFeedVariant(file.buffer, feedDest);
    feedPublicUrl = publicUrlForStorageKey(path.join(sub, feedFilename));
  }
  const exif = await parseExif(file.buffer);
  return {
    id,
    storageKey,
    publicUrl,
    feedPublicUrl,
    width: meta.width,
    height: meta.height,
    exif,
  };
}

export async function readImageDimensions(storageKey: string) {
  try {
    const full = path.join(MEDIA_ROOT, storageKey.replace(/\\/g, "/"));
    if (!full.startsWith(MEDIA_ROOT) || !fs.existsSync(full)) return null;
    const meta = await sharp(full).metadata();
    if (meta.width && meta.height) return { width: meta.width, height: meta.height };
  } catch {
    /* fall through */
  }
  return null;
}

export async function reconcileImageDimensions(db: import("better-sqlite3").Database) {
  const rows = db.prepare("SELECT id, storage_key, width, height FROM post_image").all() as Array<{
    id: string;
    storage_key: string;
    width: number | null;
    height: number | null;
  }>;
  const update = db.prepare("UPDATE post_image SET width = ?, height = ? WHERE id = ?");
  for (const row of rows) {
    const dims = await readImageDimensions(row.storage_key);
    if (!dims) continue;
    if (dims.width !== row.width || dims.height !== row.height) {
      update.run(dims.width, dims.height, row.id);
    }
  }
}

export function deletePostImageFiles(storageKey: string) {
  const master = mediaPath(storageKey);
  const feed = mediaPath(feedStorageKeyForMaster(storageKey));
  for (const full of [master, feed]) {
    if (full.startsWith(MEDIA_ROOT) && fs.existsSync(full)) fs.unlinkSync(full);
  }
}

export function deleteImageByUrl(publicUrl: string) {
  if (!publicUrl.startsWith("/media/")) return;
  const rel = publicUrl.slice("/media/".length);
  deletePostImageFiles(rel);
}

export async function reconcileImageFeedVariants(db: import("better-sqlite3").Database) {
  const rows = db
    .prepare(
      `SELECT id, storage_key, feed_public_url FROM post_image
       WHERE feed_public_url IS NULL OR feed_public_url = ''`,
    )
    .all() as Array<{ id: string; storage_key: string; feed_public_url: string | null }>;
  const update = db.prepare("UPDATE post_image SET feed_public_url = ? WHERE id = ?");
  for (const row of rows) {
    const feedUrl = await ensureFeedVariantForStorageKey(row.storage_key);
    if (feedUrl) update.run(feedUrl, row.id);
  }
}

function slugify(input: string): string {
  return (
    input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 64) || "post"
  );
}

export function uniqueSlug(db: import("better-sqlite3").Database, base: string): string {
  let slug = slugify(base);
  let n = 0;
  while (db.prepare("SELECT 1 FROM post WHERE slug = ?").get(slug)) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

export function uniqueTripSlug(db: import("better-sqlite3").Database, base: string): string {
  let slug = slugify(base === "" ? "trip" : base);
  let n = 0;
  while (db.prepare("SELECT 1 FROM trip WHERE slug = ?").get(slug)) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

export function uniqueAlbumSlug(db: import("better-sqlite3").Database, base: string): string {
  let slug = slugify(base === "" ? "album" : base);
  let n = 0;
  while (db.prepare("SELECT 1 FROM album WHERE slug = ?").get(slug)) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}

export function uniqueChapterSlug(
  db: import("better-sqlite3").Database,
  tripId: string,
  base: string,
): string {
  let slug = slugify(base === "" ? "chapter" : base);
  let n = 0;
  while (db.prepare("SELECT 1 FROM chapter WHERE trip_id = ? AND slug = ?").get(tripId, slug)) {
    n += 1;
    slug = `${slugify(base)}-${n}`;
  }
  return slug;
}
