import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import exifr from "exifr";
import { v4 as uuid } from "uuid";

export const MEDIA_ROOT = path.resolve(
  process.env.MEDIA_ROOT ?? path.join(process.cwd(), "media"),
);

const ALLOWED = new Set(["image/jpeg", "image/png", "image/webp"]);

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

export async function saveImage(file: Pick<Express.Multer.File, "buffer" | "mimetype">) {
  if (!ALLOWED.has(file.mimetype)) {
    throw new Error("Invalid file type");
  }
  const now = new Date();
  const sub = `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dir = path.join(MEDIA_ROOT, sub);
  fs.mkdirSync(dir, { recursive: true });
  const id = uuid();
  const filename = `${id}.webp`;
  const dest = path.join(dir, filename);
  const meta = await sharp(file.buffer)
    .rotate()
    .resize({ width: 2000, height: 2000, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 85 })
    .withMetadata({ orientation: 1 })
    .toFile(dest);
  const storageKey = path.join(sub, filename);
  const publicUrl = `/media/${storageKey.replace(/\\/g, "/")}`;
  const exif = await parseExif(file.buffer);
  return {
    id,
    storageKey,
    publicUrl,
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

export function deleteImageByUrl(publicUrl: string) {
  if (!publicUrl.startsWith("/media/")) return;
  const rel = publicUrl.slice("/media/".length);
  const full = path.join(MEDIA_ROOT, rel);
  if (full.startsWith(MEDIA_ROOT) && fs.existsSync(full)) fs.unlinkSync(full);
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
