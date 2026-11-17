import "./env.js";
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
  reconcileImageDimensions,
  saveImage,
  uniqueChapterSlug,
  uniqueSlug,
  uniqueTripSlug,
} from "./media.js";
import { reverseGeocodeLabel } from "./geocode.js";
import { mapProfileLocation, type ProfileRow } from "./profile-map.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.PORT ?? 3847);
function adminSecret() {
  const value = process.env.ADMIN_SECRET?.trim();
  return value || undefined;
}
const clientDist = path.resolve(__dirname, "../../client/dist");

const db = getDb();
ensureMediaDirs();
void reconcileImageDimensions(db);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024, files: 10 },
});

const app = express();
app.set("trust proxy", 1);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));

app.use("/media", express.static(MEDIA_ROOT, { maxAge: "7d" }));

function mapChapter(chapterId: string | null | undefined) {
  if (!chapterId) return undefined;
  const chapter = db
    .prepare("SELECT id, trip_id, slug, title FROM chapter WHERE id = ?")
    .get(chapterId) as { id: string; trip_id: string; slug: string; title: string } | undefined;
  if (!chapter) return undefined;
  const trip = db
    .prepare("SELECT id, slug, title FROM trip WHERE id = ?")
    .get(chapter.trip_id) as { id: string; slug: string; title: string } | undefined;
  if (!trip) return undefined;
  return {
    id: chapter.id,
    slug: chapter.slug,
    title: chapter.title,
    trip: { id: trip.id, slug: trip.slug, title: trip.title },
  };
}

function formField(body: unknown, key: string): unknown {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as Record<string, unknown>)[key];
  if (Array.isArray(value)) return value[0];
  return value;
}

function resolveChapterId(raw: unknown): { ok: true; chapterId: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, chapterId: null };
  }
  const id = String(raw).trim();
  if (!id) return { ok: true, chapterId: null };
  const row = db.prepare("SELECT id FROM chapter WHERE id = ?").get(id);
  if (!row) return { ok: false };
  return { ok: true, chapterId: id };
}

function resolveTripId(raw: unknown): { ok: true; tripId: string | null } | { ok: false } {
  if (raw === undefined || raw === null || raw === "") {
    return { ok: true, tripId: null };
  }
  const id = String(raw).trim();
  if (!id) return { ok: true, tripId: null };
  const row = db.prepare("SELECT id FROM trip WHERE id = ?").get(id);
  if (!row) return { ok: false };
  return { ok: true, tripId: id };
}

function mapTrip(tripId: string | null | undefined) {
  if (!tripId) return undefined;
  const trip = db
    .prepare("SELECT id, slug, title FROM trip WHERE id = ?")
    .get(tripId) as { id: string; slug: string; title: string } | undefined;
  if (!trip) return undefined;
  return { id: trip.id, slug: trip.slug, title: trip.title };
}

function resolvePostOrganization(
  tripRaw: unknown,
  chapterRaw: unknown,
): { ok: true; tripId: string | null; chapterId: string | null } | { ok: false; error: string } {
  const chapterResolved = resolveChapterId(chapterRaw);
  if (!chapterResolved.ok) return { ok: false, error: "Chapter not found" };
  const tripResolved = resolveTripId(tripRaw);
  if (!tripResolved.ok) return { ok: false, error: "Trip not found" };

  let chapterId = chapterResolved.chapterId;
  let tripId = tripResolved.tripId;

  if (chapterId) {
    const chapter = db
      .prepare("SELECT trip_id FROM chapter WHERE id = ?")
      .get(chapterId) as { trip_id: string } | undefined;
    if (!chapter) return { ok: false, error: "Chapter not found" };
    if (tripId && tripId !== chapter.trip_id) {
      return { ok: false, error: "Chapter does not belong to that trip" };
    }
    tripId = chapter.trip_id;
  }

  return { ok: true, tripId, chapterId };
}

function mapPost(
  post: {
    id: string;
    slug: string;
    caption: string;
    taken_at: string;
    published_at: string;
    is_draft?: number;
    chapter_id?: string | null;
    trip_id?: string | null;
    place_name: string | null;
    lat: number | null;
    lng: number | null;
  },
) {
  const images = db
    .prepare(
      `SELECT id, sort_order, storage_key, public_url, width, height, alt, has_location_metadata, has_date_metadata, focus_x, focus_y, fit_mode
       FROM post_image WHERE post_id = ? ORDER BY sort_order`,
    )
    .all(post.id) as Array<{
    id: string;
    sort_order: number;
    storage_key: string;
    public_url: string;
    width: number | null;
    height: number | null;
    alt: string | null;
    has_location_metadata: number;
    has_date_metadata: number;
    focus_x: number;
    focus_y: number;
    fit_mode: string;
  }>;
  return {
    id: post.id,
    slug: post.slug,
    caption: post.caption,
    takenAt: post.taken_at,
    publishedAt: post.published_at,
    isDraft: Boolean(post.is_draft),
    chapter: mapChapter(post.chapter_id),
    trip: mapChapter(post.chapter_id)?.trip ?? mapTrip(post.trip_id),
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
      focusX: img.focus_x,
      focusY: img.focus_y,
      fit: img.fit_mode === "contain" ? "contain" : "cover",
      hasLocationMetadata: Boolean(img.has_location_metadata),
      hasDateMetadata: Boolean(img.has_date_metadata),
    })),
  };
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true });
});

const geocodeLimiter = rateLimit({ windowMs: 60 * 1000, max: 30 });

app.get("/api/profile", (_req, res) => {
  const profile = db.prepare("SELECT * FROM profile WHERE id = 1").get() as ProfileRow;
  const links = db
    .prepare("SELECT label, href FROM profile_link WHERE profile_id = 1 ORDER BY sort_order")
    .all() as { label: string; href: string }[];
  res.json({
    displayName: profile.display_name,
    username: profile.username,
    tagline: profile.tagline,
    bio: profile.bio,
    avatarUrl: profile.avatar_url ?? undefined,
    currentLocation: mapProfileLocation(profile),
    links,
  });
});

function listPublicPosts(limit: number, cursor?: string) {
  if (cursor) {
    return db
      .prepare(
        `SELECT * FROM post WHERE is_draft = 0 AND published_at < ? ORDER BY published_at DESC LIMIT ?`,
      )
      .all(cursor, limit);
  }
  return db
    .prepare(`SELECT * FROM post WHERE is_draft = 0 ORDER BY published_at DESC LIMIT ?`)
    .all(limit);
}

function listPreviewPosts(limit: number, cursor?: string) {
  if (cursor) {
    return db
      .prepare(
        `SELECT * FROM post
         WHERE COALESCE(published_at, created_at) < ?
         ORDER BY is_draft DESC, COALESCE(published_at, created_at) DESC
         LIMIT ?`,
      )
      .all(cursor, limit);
  }
  return db
    .prepare(
      `SELECT * FROM post
       ORDER BY is_draft DESC, COALESCE(published_at, created_at) DESC
       LIMIT ?`,
    )
    .all(limit);
}

function listFeedTrips(includeDrafts: boolean) {
  const draftClause = includeDrafts ? "1 = 1" : "p.is_draft = 0";
  const trips = db
    .prepare(
      `SELECT DISTINCT t.id, t.slug, t.title, t.sort_order
       FROM trip t
       WHERE t.id IN (
         SELECT p.trip_id FROM post p WHERE p.trip_id = t.id AND ${draftClause}
         UNION
         SELECT c.trip_id FROM post p
         INNER JOIN chapter c ON c.id = p.chapter_id
         WHERE ${draftClause}
       )
       ORDER BY t.sort_order, t.title COLLATE NOCASE`,
    )
    .all() as Array<{ id: string; slug: string; title: string; sort_order: number }>;
  const chapterStmt = db.prepare(
    `SELECT DISTINCT c.id, c.slug, c.title, c.sort_order
     FROM chapter c
     INNER JOIN post p ON p.chapter_id = c.id AND ${draftClause}
     WHERE c.trip_id = ?
     ORDER BY c.sort_order, c.title COLLATE NOCASE`,
  );
  return {
    trips: trips.map((trip) => ({
      id: trip.id,
      slug: trip.slug,
      title: trip.title,
      chapters: (
        chapterStmt.all(trip.id) as Array<{ id: string; slug: string; title: string; sort_order: number }>
      ).map((chapter) => ({
        id: chapter.id,
        slug: chapter.slug,
        title: chapter.title,
      })),
    })),
  };
}

app.get("/api/trips", (_req, res) => {
  res.json(listFeedTrips(false));
});

app.get("/api/preview/trips", (_req, res) => {
  res.json(listFeedTrips(true));
});

app.get("/api/posts", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 12), 50);
  const cursor = req.query.cursor as string | undefined;
  const rows = listPublicPosts(limit, cursor);
  const posts = (rows as Parameters<typeof mapPost>[0][]).map(mapPost);
  const nextCursor =
    posts.length === limit ? posts[posts.length - 1]?.publishedAt : undefined;
  res.json({ posts, nextCursor });
});

app.get("/api/preview/posts", (req, res) => {
  const limit = Math.min(Number(req.query.limit ?? 12), 50);
  const cursor = req.query.cursor as string | undefined;
  const rows = listPreviewPosts(limit, cursor);
  const posts = (rows as Parameters<typeof mapPost>[0][]).map(mapPost);
  const last = posts[posts.length - 1];
  const nextCursor =
    posts.length === limit && last
      ? last.publishedAt || (rows as { created_at: string }[])[rows.length - 1]?.created_at
      : undefined;
  res.json({ posts, nextCursor });
});

app.get("/api/posts/:slug", (req, res) => {
  const post = db
    .prepare("SELECT * FROM post WHERE slug = ? AND is_draft = 0")
    .get(req.params.slug);
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(mapPost(post as Parameters<typeof mapPost>[0]));
});

app.get("/api/preview/posts/:slug", (req, res) => {
  const post = db.prepare("SELECT * FROM post WHERE slug = ?").get(req.params.slug);
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(mapPost(post as Parameters<typeof mapPost>[0]));
});

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });

app.post("/api/auth/login", loginLimiter, (req, res) => {
  const expected = adminSecret();
  if (!expected) {
    res.status(503).json({ error: "Admin access is not configured" });
    return;
  }
  const { secret } = req.body as { secret?: string };
  if (secret?.trim() !== expected) {
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

app.get("/api/admin/posts/:slug", admin, (req, res) => {
  const post = db.prepare("SELECT * FROM post WHERE slug = ?").get(req.params.slug);
  if (!post) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(mapPost(post as Parameters<typeof mapPost>[0]));
});

app.get("/api/admin/trips", admin, (_req, res) => {
  const trips = db
    .prepare(`SELECT id, slug, title, sort_order FROM trip ORDER BY sort_order, title COLLATE NOCASE`)
    .all() as Array<{ id: string; slug: string; title: string; sort_order: number }>;
  const chapters = db
    .prepare(
      `SELECT id, trip_id, slug, title, sort_order FROM chapter ORDER BY sort_order, title COLLATE NOCASE`,
    )
    .all() as Array<{ id: string; trip_id: string; slug: string; title: string; sort_order: number }>;
  res.json({
    trips: trips.map((trip) => ({
      id: trip.id,
      slug: trip.slug,
      title: trip.title,
      chapters: chapters
        .filter((chapter) => chapter.trip_id === trip.id)
        .map((chapter) => ({
          id: chapter.id,
          slug: chapter.slug,
          title: chapter.title,
          tripId: chapter.trip_id,
        })),
    })),
  });
});

app.post("/api/admin/trips", admin, (req, res) => {
  const title = String(req.body.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "Trip title required" });
    return;
  }
  const id = uuid();
  const slug = uniqueTripSlug(db, title);
  db.prepare(
    `INSERT INTO trip (id, slug, title, sort_order) VALUES (?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM trip), 0))`,
  ).run(id, slug, title);
  res.status(201).json({ id, slug, title, chapters: [] });
});

app.post("/api/admin/chapters", admin, (req, res) => {
  const tripId = String(req.body.tripId ?? "");
  const title = String(req.body.title ?? "").trim();
  if (!tripId) {
    res.status(400).json({ error: "Trip required" });
    return;
  }
  if (!title) {
    res.status(400).json({ error: "Chapter title required" });
    return;
  }
  const trip = db.prepare("SELECT id FROM trip WHERE id = ?").get(tripId);
  if (!trip) {
    res.status(400).json({ error: "Trip not found" });
    return;
  }
  const id = uuid();
  const slug = uniqueChapterSlug(db, tripId, title);
  db.prepare(
    `INSERT INTO chapter (id, trip_id, slug, title, sort_order)
     VALUES (?, ?, ?, ?, COALESCE((SELECT MAX(sort_order) + 1 FROM chapter WHERE trip_id = ?), 0))`,
  ).run(id, tripId, slug, title, tripId);
  res.status(201).json({ id, slug, title, tripId });
});

app.get("/api/admin/posts", admin, (_req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.slug, p.caption, p.taken_at, p.published_at, p.place_name, p.is_draft,
              c.title AS chapter_title, t.title AS trip_title
       FROM post p
       LEFT JOIN chapter c ON c.id = p.chapter_id
       LEFT JOIN trip t ON t.id = COALESCE(c.trip_id, p.trip_id)
       ORDER BY p.is_draft DESC, COALESCE(p.published_at, p.created_at) DESC`,
    )
    .all();
  const posts = (
    rows as {
      id: string;
      slug: string;
      caption: string;
      taken_at: string;
      published_at: string;
      place_name: string | null;
      is_draft: number;
      chapter_title: string | null;
      trip_title: string | null;
    }[]
  ).map((r) => {
    const thumb = db
      .prepare(`SELECT public_url FROM post_image WHERE post_id = ? ORDER BY sort_order LIMIT 1`)
      .get(r.id) as { public_url: string } | undefined;
    return {
      id: r.id,
      slug: r.slug,
      caption: r.caption,
      takenAt: r.taken_at,
      publishedAt: r.published_at,
      placeName: r.place_name,
      isDraft: Boolean(r.is_draft),
      thumbnail: thumb?.public_url,
      tripTitle: r.trip_title,
      chapterTitle: r.chapter_title,
    };
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
    const organization = resolvePostOrganization(
      formField(req.body, "tripId"),
      formField(req.body, "chapterId"),
    );
    if (!organization.ok) {
      res.status(400).json({ error: organization.error });
      return;
    }

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
      `INSERT INTO post (id, slug, caption, taken_at, place_name, lat, lng, trip_id, chapter_id, is_draft, published_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
    ).run(
      postId,
      slug,
      caption,
      metaTaken,
      placeName,
      metaLat,
      metaLng,
      organization.tripId,
      organization.chapterId,
    );

    const insertImg = db.prepare(
      `INSERT INTO post_image (id, post_id, sort_order, storage_key, public_url, width, height, has_location_metadata, has_date_metadata)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    for (let i = 0; i < saved.length; i++) {
      const s = saved[i]!;
      const hasLocation = s.exif.lat != null && s.exif.lng != null;
      const hasDate = Boolean(s.exif.takenAt);
      insertImg.run(
        s.id,
        postId,
        i,
        s.storageKey,
        s.publicUrl,
        s.width,
        s.height,
        hasLocation ? 1 : 0,
        hasDate ? 1 : 0,
      );
    }

    if (!placeName && metaLat != null && metaLng != null) {
      try {
        const resolved = await reverseGeocodeLabel(metaLat, metaLng);
        if (resolved) {
          db.prepare(`UPDATE post SET place_name = ? WHERE id = ?`).run(resolved, postId);
        }
      } catch (e) {
        console.error("reverse-geocode on publish", e);
      }
    }

    const post = db.prepare("SELECT * FROM post WHERE id = ?").get(postId);
    res.status(201).json(mapPost(post as Parameters<typeof mapPost>[0]));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.post("/api/posts/:id/publish", admin, (req, res) => {
  const existing = db.prepare("SELECT * FROM post WHERE id = ?").get(req.params.id) as
    | Parameters<typeof mapPost>[0]
    | undefined;
  if (!existing) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  if ((existing as { is_draft?: number }).is_draft) {
    db.prepare(`UPDATE post SET is_draft = 0, published_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(
      req.params.id,
    );
  }
  const updated = db.prepare("SELECT * FROM post WHERE id = ?").get(req.params.id);
  res.json(mapPost(updated as Parameters<typeof mapPost>[0]));
});

function clamp01(value: number) {
  if (!Number.isFinite(value)) return 0.5;
  return Math.min(1, Math.max(0, value));
}

app.patch("/api/post-images/:id/focus", admin, (req, res) => {
  const row = db.prepare("SELECT id FROM post_image WHERE id = ?").get(req.params.id) as { id: string } | undefined;
  if (!row) {
    res.status(404).json({ error: "Image not found" });
    return;
  }
  const existing = db.prepare("SELECT focus_x, focus_y, fit_mode FROM post_image WHERE id = ?").get(row.id) as {
    focus_x: number;
    focus_y: number;
    fit_mode: string;
  };
  const body = req.body as { focusX?: number; focusY?: number; fit?: string };
  const focusX = body.focusX === undefined ? existing.focus_x : clamp01(Number(body.focusX));
  const focusY = body.focusY === undefined ? existing.focus_y : clamp01(Number(body.focusY));
  const fit = body.fit === "contain" || body.fit === "cover" ? body.fit : existing.fit_mode === "contain" ? "contain" : "cover";
  db.prepare(`UPDATE post_image SET focus_x = ?, focus_y = ?, fit_mode = ? WHERE id = ?`).run(focusX, focusY, fit, row.id);
  db.prepare(`UPDATE post SET updated_at = datetime('now') WHERE id = (SELECT post_id FROM post_image WHERE id = ?)`).run(
    row.id,
  );
  res.json({ id: row.id, focusX, focusY, fit: fit === "contain" ? "contain" : "cover" });
});

async function appendPostImages(postId: string, files: Express.Multer.File[]) {
  const existingCount = (
    db.prepare("SELECT COUNT(*) as count FROM post_image WHERE post_id = ?").get(postId) as { count: number }
  ).count;
  if (existingCount + files.length > 10) {
    throw new Error("TOO_MANY_IMAGES");
  }
  const insertImg = db.prepare(
    `INSERT INTO post_image (id, post_id, sort_order, storage_key, public_url, width, height, has_location_metadata, has_date_metadata)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < files.length; i++) {
    const s = await saveImage(files[i]!);
    const hasLocation = s.exif.lat != null && s.exif.lng != null;
    const hasDate = Boolean(s.exif.takenAt);
    insertImg.run(
      s.id,
      postId,
      existingCount + i,
      s.storageKey,
      s.publicUrl,
      s.width,
      s.height,
      hasLocation ? 1 : 0,
      hasDate ? 1 : 0,
    );
  }
  db.prepare(`UPDATE post SET updated_at = datetime('now') WHERE id = ?`).run(postId);
}

app.post("/api/posts/:id/images", admin, upload.array("images", 10), async (req, res) => {
  const postId = String(req.params.id);
  const existing = db.prepare("SELECT id FROM post WHERE id = ?").get(postId) as { id: string } | undefined;
  if (!existing) {
    res.status(404).json({ error: "Post not found" });
    return;
  }
  const files = req.files as Express.Multer.File[] | undefined;
  if (!files?.length) {
    res.status(400).json({ error: "At least one image required" });
    return;
  }
  try {
    await appendPostImages(postId, files);
    const updated = db.prepare("SELECT * FROM post WHERE id = ?").get(postId);
    res.json(mapPost(updated as Parameters<typeof mapPost>[0]));
  } catch (e) {
    if (e instanceof Error && e.message === "TOO_MANY_IMAGES") {
      res.status(400).json({ error: "A journey can have at most 10 photos" });
      return;
    }
    console.error(e);
    res.status(500).json({ error: "Upload failed" });
  }
});

app.delete("/api/post-images/:id", admin, (req, res) => {
  const row = db.prepare("SELECT id, post_id, public_url FROM post_image WHERE id = ?").get(req.params.id) as
    | { id: string; post_id: string; public_url: string }
    | undefined;
  if (!row) {
    res.status(404).json({ error: "Image not found" });
    return;
  }
  const count = (
    db.prepare("SELECT COUNT(*) as count FROM post_image WHERE post_id = ?").get(row.post_id) as { count: number }
  ).count;
  if (count <= 1) {
    res.status(400).json({ error: "Keep at least one photo on the journey" });
    return;
  }
  deleteImageByUrl(row.public_url);
  db.prepare("DELETE FROM post_image WHERE id = ?").run(row.id);
  const remaining = db
    .prepare("SELECT id FROM post_image WHERE post_id = ? ORDER BY sort_order, id")
    .all(row.post_id) as { id: string }[];
  const setOrder = db.prepare("UPDATE post_image SET sort_order = ? WHERE id = ?");
  remaining.forEach((img, index) => setOrder.run(index, img.id));
  db.prepare(`UPDATE post SET updated_at = datetime('now') WHERE id = ?`).run(row.post_id);
  const updated = db.prepare("SELECT * FROM post WHERE id = ?").get(row.post_id);
  res.json(mapPost(updated as Parameters<typeof mapPost>[0]));
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
    chapterId?: string | null;
    tripId?: string | null;
  };
  const caption = body.caption ?? existing.caption;
  const placeName = body.placeName ?? existing.place_name;
  const takenAt = body.takenAt ?? existing.taken_at;
  const lat = body.lat === undefined ? existing.lat : body.lat;
  const lng = body.lng === undefined ? existing.lng : body.lng;

  const existingRow = existing as { chapter_id?: string | null; trip_id?: string | null };
  const tripRaw = body.tripId !== undefined ? body.tripId : existingRow.trip_id;
  const chapterRaw = body.chapterId !== undefined ? body.chapterId : existingRow.chapter_id;
  const organization = resolvePostOrganization(tripRaw, chapterRaw);
  if (!organization.ok) {
    res.status(400).json({ error: organization.error });
    return;
  }

  db.prepare(
    `UPDATE post
     SET caption = ?, place_name = ?, taken_at = ?, lat = ?, lng = ?, trip_id = ?, chapter_id = ?, updated_at = datetime('now')
     WHERE id = ?`,
  ).run(
    caption,
    placeName,
    takenAt,
    lat,
    lng,
    organization.tripId,
    organization.chapterId,
    req.params.id,
  );
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

app.get("/api/geocode/reverse", admin, geocodeLimiter, async (req, res) => {
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    res.status(400).json({ error: "lat and lng are required" });
    return;
  }
  try {
    const name = await reverseGeocodeLabel(lat, lng);
    res.json({ name });
  } catch (e) {
    console.error("reverse-geocode", e);
    res.json({ name: null });
  }
});

app.patch("/api/profile", admin, upload.single("avatar"), async (req, res) => {
  const displayName = req.body.displayName ? String(req.body.displayName) : undefined;
  const username = req.body.username ? String(req.body.username) : undefined;
  const tagline = req.body.tagline != null ? String(req.body.tagline) : undefined;
  const bio = req.body.bio != null ? String(req.body.bio) : undefined;
  let avatarUrl: string | undefined;
  if (req.file) {
    const saved = await saveImage(req.file);
    avatarUrl = saved.publicUrl;
  }
  const cur = db.prepare("SELECT * FROM profile WHERE id = 1").get() as ProfileRow;
  const coord = (value: unknown) => {
    if (value === undefined) return undefined;
    if (value === "" || value == null) return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  };
  const currentPlaceName =
    req.body.currentPlaceName !== undefined
      ? req.body.currentPlaceName
        ? String(req.body.currentPlaceName)
        : null
      : cur.current_place_name;
  const currentLat = req.body.currentLat !== undefined ? coord(req.body.currentLat) : cur.current_lat;
  const currentLng = req.body.currentLng !== undefined ? coord(req.body.currentLng) : cur.current_lng;
  db.prepare(
  `UPDATE profile SET display_name = ?, username = ?, tagline = ?, bio = ?, avatar_url = COALESCE(?, avatar_url),
     current_place_name = ?, current_lat = ?, current_lng = ?, updated_at = datetime('now') WHERE id = 1`,
  ).run(
    displayName ?? cur.display_name,
    username ?? cur.username,
    tagline ?? cur.tagline,
    bio ?? cur.bio,
    avatarUrl ?? null,
    currentPlaceName,
    currentLat,
    currentLng,
  );
  res.json({ ok: true });
});

const serveClient = process.env.NODE_ENV === "production" && fs.existsSync(clientDist);
if (serveClient) {
  app.use(express.static(clientDist));
  app.get("*", (req, res, next) => {
    if (req.path.startsWith("/api") || req.path.startsWith("/media")) {
      next();
      return;
    }
    res.sendFile(path.join(clientDist, "index.html"));
  });
} else if (process.env.NODE_ENV !== "production") {
  app.get("/", (_req, res) => {
    res
      .status(200)
      .type("html")
      .send(
        `<!doctype html><html><body style="font-family:system-ui,sans-serif;padding:2rem;max-width:40rem;line-height:1.5">` +
          `<p><strong>API is running.</strong> Open the Vite dev UI at <a href="http://127.0.0.1:3848">http://127.0.0.1:3848</a> (or your machine’s LAN URL on port <code>3848</code>).</p>` +
          `<p>Port ${PORT} serves <code>/api</code> and <code>/media</code> only in development so an old <code>client/dist</code> build is not served by mistake.</p>` +
          `</body></html>`,
      );
  });
}

app.listen(PORT, () => {
  console.log(`API http://localhost:${PORT}`);
});
