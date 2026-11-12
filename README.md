# paossport

A quiet, mobile-first travel photo journal. Visitors browse photographs, captions, dates, and map locations without accounts, likes, subscriptions, or Instagram prompts. The owner publishes through a private admin studio.

## Stack

- React 19 + Vite + TypeScript
- React Router and Embla Carousel
- Node/Express REST API
- SQLite with local media storage
- Sharp image processing and EXIF extraction
- Tailwind CSS build tooling with custom responsive CSS

## Run locally

```bash
npm install
cp .env.example .env
npm run seed
npm run dev
```

Open the web app at `http://localhost:3848`. The API runs on `http://localhost:3847` and is proxied by Vite.

The admin studio is at `/admin`. Set `ADMIN_SECRET` before starting the app; without it, the public journal still works but admin login remains disabled.

## Production

```bash
npm run build
ADMIN_SECRET="a-long-random-secret" npm start
```

The Node server serves the built React app, REST API, and uploaded media from port `3847` by default. Use a host with persistent disk (Fly.io, Railway, or a VPS) and persist:

- `data/app.db`
- `server/media/`

Back up both together. Uploaded images are converted to WebP, auto-rotated, and constrained to 2000×2000 pixels.

## Admin workflow

1. Visit `/admin` and enter the admin secret.
2. Create a journey with 1–10 images, place, date, caption, and optional coordinates.
3. Date and GPS metadata are read from the first image when available.
4. Edit the public profile or delete posts from the dashboard.

Public visitors never receive an admin session or see an admin link.
