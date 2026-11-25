import type { Plugin } from "vite";
import { reverseGeocodeLabel, searchPlaces } from "../server/src/geocode.ts";

/**
 * When the Vite client proxies /api to a remote host (DEV_API_ORIGIN), that
 * host may not yet expose geocode routes. Handle search/reverse locally so
 * admin Place autocomplete still works against remote content.
 */
export function geocodeDevFallback(): Plugin {
  return {
    name: "geocode-dev-fallback",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.method !== "GET" || !req.url?.startsWith("/api/geocode/")) {
          next();
          return;
        }

        try {
          const parsed = new URL(req.url, "http://vite.local");

          if (parsed.pathname === "/api/geocode/search") {
            const q = (parsed.searchParams.get("q") ?? "").trim();
            if (q.length < 2 || q.length > 100) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "q must be 2–100 characters" }));
              return;
            }
            const results = await searchPlaces(q);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ results }));
            return;
          }

          if (parsed.pathname === "/api/geocode/reverse") {
            const lat = Number(parsed.searchParams.get("lat"));
            const lng = Number(parsed.searchParams.get("lng"));
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
              res.statusCode = 400;
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ error: "lat and lng are required" }));
              return;
            }
            const name = await reverseGeocodeLabel(lat, lng);
            res.statusCode = 200;
            res.setHeader("Content-Type", "application/json");
            res.end(JSON.stringify({ name }));
            return;
          }
        } catch (error) {
          console.error("geocode-dev-fallback", error);
          res.statusCode = 200;
          res.setHeader("Content-Type", "application/json");
          if (req.url?.startsWith("/api/geocode/search")) {
            res.end(JSON.stringify({ results: [] }));
          } else {
            res.end(JSON.stringify({ name: null }));
          }
          return;
        }

        next();
      });
    },
  };
}
