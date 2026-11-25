const NOMINATIM_UA = "paossport-travel-journal/1.0 (contact: local)";

type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  municipality?: string;
  county?: string;
  state?: string;
  province?: string;
  region?: string;
  country?: string;
};

type NominatimReverse = {
  display_name?: string;
  address?: NominatimAddress;
};

type NominatimSearchHit = {
  display_name?: string;
  lat?: string;
  lon?: string;
  class?: string;
  type?: string;
  address?: NominatimAddress;
};

export type PlaceSuggestion = {
  name: string;
  lat: number;
  lng: number;
};

function tidyPlacePart(value?: string): string | undefined {
  if (!value) return undefined;
  // Nominatim sometimes returns bilingual names like "New Zealand / Aotearoa".
  return value.split(" / ")[0]?.trim() || undefined;
}

function localityFromAddress(address?: NominatimAddress): string | undefined {
  if (!address) return undefined;
  return tidyPlacePart(
    address.city ??
      address.town ??
      address.village ??
      address.municipality ??
      address.province ??
      address.county ??
      address.state ??
      address.region,
  );
}

function formatPlaceLabel(address?: NominatimAddress, displayName?: string): string | null {
  if (address) {
    const locality = localityFromAddress(address);
    const state = tidyPlacePart(address.state ?? address.province ?? address.region);
    const country = tidyPlacePart(address.country);
    if (locality) {
      const suffix = country && country !== locality ? country : state && state !== locality ? state : undefined;
      return [locality, suffix].filter(Boolean).join(", ");
    }
    if (state && country && state !== country) {
      return `${state}, ${country}`;
    }
    if (country || state) return country ?? state ?? null;
  }
  return displayName?.split(",").slice(0, 2).join(",").trim() ?? null;
}

function placeRank(hit: NominatimSearchHit): number {
  const type = hit.type ?? "";
  const cls = hit.class ?? "";
  if (cls === "place" && (type === "city" || type === "town")) return 0;
  if (cls === "place" && (type === "village" || type === "hamlet" || type === "municipality")) return 1;
  if (cls === "boundary" && type === "administrative") return 2;
  if (cls === "place" || cls === "boundary") return 3;
  return 4;
}

function nominatimHeaders(): Record<string, string> {
  return {
    Accept: "application/json",
    "Accept-Language": "en",
    "User-Agent": NOMINATIM_UA,
  };
}

export async function reverseGeocodeLabel(lat: number, lng: number): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url, {
    headers: nominatimHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;

  const data = (await response.json()) as NominatimReverse;
  return formatPlaceLabel(data.address, data.display_name);
}

export async function searchPlaces(
  query: string,
  options?: { limit?: number },
): Promise<PlaceSuggestion[]> {
  const limit = Math.min(Math.max(options?.limit ?? 6, 1), 10);
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", query);
  url.searchParams.set("format", "json");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("limit", String(limit));
  url.searchParams.set("accept-language", "en");

  const response = await fetch(url, {
    headers: nominatimHeaders(),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return [];

  const data = (await response.json()) as NominatimSearchHit[];
  if (!Array.isArray(data)) return [];

  const ranked = [...data].sort((a, b) => placeRank(a) - placeRank(b));
  const seen = new Set<string>();
  const results: PlaceSuggestion[] = [];

  for (const hit of ranked) {
    const lat = Number(hit.lat);
    const lng = Number(hit.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const address = hit.address;
    // Autocomplete is for cities/regions — skip bare country hits.
    if (address && !localityFromAddress(address)) continue;
    const name = formatPlaceLabel(address, hit.display_name);
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ name, lat, lng });
    if (results.length >= limit) break;
  }

  return results;
}
