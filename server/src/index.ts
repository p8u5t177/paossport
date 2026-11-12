import "dotenv/config";
import express from "express";
import cookieParser from "cookie-parser";
import rateLimit from "express-rate-limit";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { v4 as uuid } from "uuid";
import { getDb } from "./db.js";
import {
  clearSessionCookie,
  createSession,
  destroySession,
  requireAdmin,
  SESSION_COOKIE,
  sessionValid,
  setSessionCookie,
} from "./auth.js";
import {
  MEDIA_ROOT,
  deleteImageByUrl,
  ensureMediaDirs,
  saveImage,
  uniqueSlug,
} from "./media.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3847);
const ADMIN_SECRET = process.env.ADMIN_SECRET;
const clientDist = path.resolve(__dirname, "../../client/dist");

const db = getDb();
ensureMediaDirs();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

const app = express();
app.set("trust proxy", 1);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.use("/media", express.static(MEDIA_ROOT, { maxAge: "7d" }));

function mapPost(
  post: {
    id: string;
    slug: string;
    caption: string;
    taken_at: string;
    published_at: string;
    place_name: string | null;
    lat: number | null;
    lng: number | null;
  },
) {
  const images = db
    .prepare(
      `SELECT id, sort_order, public_url, width, height, alt FROM post_image WHERE post_id = ? ORDER BY sort_order`,
    )
    .all(post.id) as Array<{
    id: string;
    sort_order: number;
    public_url: string;
    width: number | null;
    height: number | null;
    alt: string | null;
  }>;
  return {
    id: post.id,
    slug: post.slug,
    caption: post.caption,
    takenAt: post.taken_at,
    publishedAt: post.published_at,
    location:
      post.lat != null && post.lng != null
        ? { name: post.place_name ?? undefined, lat: post.lat, lng: post.lng }
        : post.place_name
          ? { name: post.place_name, lat: post.lat ?? undefined, lng: post.lng ?? undefined }
          : undefined,
    images: images.map((img) => ({
      id: img.id,
      url: img.public_url,
      width: img.width ?? undefined,
      height: img.height ?? undefined,
      alt: img.alt ?? undefined,
    })),
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/profile", (_req, res) => {
  const profile = db.prepare("SELECT * FROM profile WHERE id = 1").get() as {
    display_name: string;
    username: string;
    bio: string;
    avatar_url: string | null;
  };
  const links = db
    .prepare("SELECT label, href FROM profile_link WHERE profile_id = 1 ORDER BY sort_order")
    .all() as { label: string; href: string }[];
  res.json({
    displayName: profile.display_name,
    username: profile.username,
    bio: profile.bio,
    avatarUrl: profile.avatar_url ?? undefined,
    links,
  });
});

app.get("/api/posts", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 12), 50);
  const cursor = req.query.cursor as string | undefined;
  let rows;
  if (cursor) {
    rows = db
      .prepare(
        `SELECT * FROM post WHERE published_at < ? ORDER BY published_at DESC LIMIT ?`,
      )
      .all(cursor, limit);
  } else {
    rows = db
      .prepare(`SELECT * FROM post ORDER BY published_at DESC LIMIT ?`)
      .all(limit);
  }
  const posts = (rows as Parameters<typeof mapPost>[0][]).map(mapPost);
  const nextCursor =
    posts.length === limit ? posts[posts.length - 1]?.publishedAt : undefined;
  res.json({ posts, nextCursor });
});

app.get("/api/posts/:slug", (req, res) => {
  const post = db.prepare("SELECT * FROM post WHERE slug = ?").get(req.params.slug);
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(mapPost(post as Parameters<typeof mapPost>[0]));
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

app.post("/api/auth/login", loginLimiter, (req, res) => {
  if (!ADMIN_SECRET) {
    res.status(503).json({ error: "Admin access is not configured" });
    return;
  }
  const { secret } = req.body as { secret?: string };
  if (secret !== ADMIN_SECRET) {
    res.status(401).json({ error: "Invalid secret" });
    return;
  }
  const token = createSession(db);
  setSessionCookie(res, token);
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  const token = req.cookies[SESSION_COOKIE] as string | undefined;
  if (token) destroySession(db, token);
  clearSessionCookie(res);
  res.json({ ok: true });
});

app.get("/api/auth/me", (req, res) => {
  res.json({ authenticated: sessionValid(db, req) });
});

const admin = requireAdmin(db);

app.get("/api/admin/posts", admin, (_req, res) => {
  const rows = db
    .prepare(`SELECT id, slug, caption, taken_at, published_at, place_name FROM post ORDER BY published_at DESC`)
    .all();
  const posts = (rows as { id: string; slug: string; caption: string; taken_at: string; published_at: string; place_name: string | null }[]).map((r) => {
    const thumb = db
      .prepare(`SELECT public_url FROM post_image WHERE post_id = ? ORDER BY sort_order LIMIT 1`)
      .get(r.id) as { public_url: string } | undefined;
    return { ...r, thumbnail: thumb?.public_url };
  });
  res.json({ posts });
});

app.post("/api/posts", admin, upload.array("images", 10), async (req, res) => {
  try {
    const files = req.files as Express.Multer.File[];
    if (!files?.length) {
      res.status(400).json({ error: "At least one image required" });
      return;
    }
    const caption = String(req.body.caption ?? "");
    const placeName = req.body.placeName ? String(req.body.placeName) : null;
    const requestedTakenAt = req.body.takenAt ? String(req.body.takenAt) : undefined;
    const requestedLat = req.body.lat ? Number(req.body.lat) : undefined;
    const requestedLng = req.body.lng ? Number(req.body.lng) : undefined;
    const takenAt = requestedTakenAt ?? new Date().toISOString();
    const slugBase = req.body.slug ? String(req.body.slug) : placeName ?? takenAt;
    const slug = uniqueSlug(db, slugBase);
    const postId = uuid();

    const saved = [];
    let metaTaken = takenAt;
    let metaLat = requestedLat ?? null;
    let metaLng = requestedLng ?? null;
    for (let i = 0; i < files.length; i++) {
      const s = await saveImage(files[i]!);
      if (i === 0 && !requestedTakenAt && s.exif.takenAt) metaTaken = s.exif.takenAt;
      if (i === 0 && requestedLat == null && s.exif.lat != null) metaLat = s.exif.lat;
      if (i === 0 && requestedLng == null && s.exif.lng != null) metaLng = s.exif.lng;
      saved.push(s);
    }

    db.prepare(
      `INSERT INTO post (id, slug, caption, taken_at, place_name, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(postId, slug, caption, metaTaken, placeName, metaLat, metaLng);

    const insertImg = db.prepare(
      `INSERT INTO post_image (id, post_id, sort_order, storage_key, public_url, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < saved.length; i++) {
      const s = saved[i]!;
      insertImg.run(s.id, postId, i, s.storageKey, s.publicUrl, s.width, s.height);
    }

    const post = db.prepare("SELECT * FROM post WHERE id = ?").get(postId);
    res.status(201).json(mapPost(post as Parameters<typeof mapPost>[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.patch("/api/posts/:id", admin, (req, res) => {
  const existing = db.prepare("SELECT * FROM post WHERE id = ?").get(req.params.id) as
    | Parameters<typeof mapPost>[0]
    | undefined;
  if (!existing) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const body = req.body as {
    caption?: string;
    placeName?: string;
    takenAt?: string;
    lat?: number | null;
    lng?: number | null;
  };
  const caption = body.caption ?? existing.caption;
  const placeName = body.placeName ?? existing.place_name;
  const takenAt = body.takenAt ?? existing.taken_at;
  const lat = body.lat === undefined ? existing.lat : body.lat;
  const lng = body.lng === undefined ? existing.lng : body.lng;
  db.prepare(
    `UPDATE post
     SET caption = ?, place_name = ?, taken_at = ?, lat = ?, lng = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(caption, placeName, takenAt, lat, lng, req.params.id);
  const updated = db.prepare("SELECT * FROM post WHERE id = ?").get(req.params.id);
  res.json(mapPost(updated as Parameters<typeof mapPost>[0]));
});

app.delete("/api/posts/:id", admin, (req, res) => {
  const images = db
    .prepare("SELECT public_url FROM post_image WHERE post_id = ?")
    .all(req.params.id) as { public_url: string }[];
  for (const img of images) deleteImageByUrl(img.public_url);
  db.prepare("DELETE FROM post WHERE id = ?").run(req.params.id);
  res.json({ ok: true });
});

app.patch("/api/profile", admin, upload.single("avatar"), async (req, res) => {
  const displayName = req.body.displayName ? String(req.body.displayName) : undefined;
  const username = req.body.username ? String(req.body.username) : undefined;
  const bio = req.body.bio != null ? String(req.body.bio) : undefined;
  let avatarUrl: string | undefined;
  if (req.file) {
    const saved = await saveImage(req.file);
    avatarUrl = saved.publicUrl;
  }
  const cur = db.prepare("SELECT * FROM profile WHERE id = 1").get() as {
    display_name: string;
    username: string;
    bio: string;
    avatar_url: string | null;
  };
  db.prepare(
    `UPDATE profile SET display_name = ?, username = ?, bio = ?, avatar_url = COALESCE(?, avatar_url), updated_at = datetime('now') WHERE id = 1`,
  ).run(
    displayName ?? cur.display_name,
    username ?? cur.username,
    bio ?? cur.bio,
    avatarUrl ?? null,
  );
  res.json({ ok: true });
});

if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`API http://localhost:${PORT}`);
});
