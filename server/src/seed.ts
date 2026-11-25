import { getDb } from "./db.js";
import path from "node:path";
import fs from "node:fs";
import sharp from "sharp";
import { v4 as uuid } from "uuid";
import { MEDIA_ROOT, ensureMediaDirs } from "./media.js";
import { plainTextToHtml } from "./rich-text.js";

async function makePlaceholder(
  destDir: string,
  name: string,
  w: number,
  h: number,
  scene: "coast" | "city" | "cafe",
) {
  const file = path.join(destDir, `${name}.webp`);
  const art =
    scene === "coast"
      ? `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#bccac1"/><stop offset="1" stop-color="#728f80"/>
            </linearGradient>
            <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".8" numOctaves="3" stitchTiles="stitch"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .12 0"/></filter>
          </defs>
          <rect width="100%" height="100%" fill="url(#sky)"/>
          <path d="M0 920 Q260 760 520 910 T1200 820 V1500 H0Z" fill="#365848"/>
          <path d="M0 1090 Q320 930 660 1100 T1200 1010 V1500 H0Z" fill="#637b6b"/>
          <ellipse cx="390" cy="430" rx="410" ry="120" fill="#eef0e7" opacity=".34"/>
          <ellipse cx="850" cy="520" rx="500" ry="150" fill="#f7f4ec" opacity=".2"/>
          <rect width="100%" height="100%" filter="url(#grain)" opacity=".45"/>
        </svg>`
      : scene === "city"
        ? `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="night" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stop-color="#253e3b"/><stop offset="1" stop-color="#182b2e"/>
            </linearGradient>
            <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".65" numOctaves="4"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .15 0"/></filter>
          </defs>
          <rect width="100%" height="100%" fill="url(#night)"/>
          <path d="M0 0 H320 L460 1500 H0Z" fill="#38514a"/>
          <path d="M1200 0 H860 L730 1500 H1200Z" fill="#2f4541"/>
          <rect x="245" y="160" width="42" height="860" rx="18" fill="#d8aa50"/>
          <rect x="865" y="290" width="55" height="760" rx="20" fill="#c86f58"/>
          <path d="M430 1500 L600 600 L770 1500Z" fill="#718d83" opacity=".45"/>
          <ellipse cx="600" cy="1290" rx="420" ry="75" fill="#c86f58" opacity=".25"/>
          <rect width="100%" height="100%" filter="url(#grain)" opacity=".5"/>
        </svg>`
        : `<svg width="${w}" height="${h}" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="room" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stop-color="#7094ad"/><stop offset="1" stop-color="#315b77"/>
            </linearGradient>
            <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency=".72" numOctaves="3"/><feColorMatrix values="1 0 0 0 0 0 1 0 0 0 0 0 1 0 0 0 0 0 .13 0"/></filter>
          </defs>
          <rect width="100%" height="100%" fill="url(#room)"/>
          <rect x="120" y="180" width="960" height="680" rx="30" fill="#d6e1e8" opacity=".28"/>
          <circle cx="600" cy="710" r="190" fill="#d8a84e"/>
          <circle cx="600" cy="710" r="130" fill="#f3f7fa"/>
          <circle cx="600" cy="710" r="82" fill="#8d533f"/>
          <rect x="170" y="1050" width="860" height="90" rx="40" fill="#17364c" opacity=".65"/>
          <rect width="100%" height="100%" filter="url(#grain)" opacity=".48"/>
        </svg>`;
  await sharp(Buffer.from(art))
    .resize(w, h)
    .webp()
    .toFile(file);
  return file;
}

async function main() {
  const db = getDb();
  ensureMediaDirs();
  const sub = "2026/11";
  const dir = path.join(MEDIA_ROOT, sub);
  fs.mkdirSync(dir, { recursive: true });

  const posts = [
    {
      slug: "stanley-park-fog",
      caption: "Fog lifted for six minutes along the seawall. Worth the cold fingers.",
      place: "Stanley Park, Vancouver",
      lat: 49.3043,
      lng: -123.1442,
      taken: "2026-11-08T14:20:00.000Z",
      scenes: ["coast"] as const,
    },
    {
      slug: "commercial-drive-neon",
      caption: "Late ramen and neon in the gutters after rain.",
      place: "Commercial Drive, Vancouver",
      lat: 49.2713,
      lng: -123.0696,
      taken: "2026-11-06T22:10:00.000Z",
      scenes: ["city", "cafe", "city"] as const,
    },
  ];

  for (const p of posts) {
    const existing = db.prepare("SELECT id FROM post WHERE slug = ?").get(p.slug) as
      | { id: string }
      | undefined;
    const postId = existing?.id ?? uuid();
    if (!existing) {
      db.prepare(
        `INSERT INTO post (id, slug, caption, content_html, taken_at, place_name, lat, lng) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(postId, p.slug, p.caption, plainTextToHtml(p.caption), p.taken, p.place, p.lat, p.lng);
    }

    const currentCount = (
      db.prepare("SELECT COUNT(*) AS count FROM post_image WHERE post_id = ?").get(postId) as {
        count: number;
      }
    ).count;
    for (let index = currentCount; index < p.scenes.length; index += 1) {
      const imgId = uuid();
      const key = `${sub}/${imgId}.webp`;
      await makePlaceholder(dir, imgId, 1200, 1500, p.scenes[index]!);
      const publicUrl = `/media/${key}`;
      db.prepare(
        `INSERT INTO post_image (id, post_id, sort_order, storage_key, public_url, width, height) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(imgId, postId, index, key, publicUrl, 1200, 1500);
    }
  }
  console.log("Seed complete.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
