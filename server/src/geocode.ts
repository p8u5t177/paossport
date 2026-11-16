const NOMINATIM_UA = "paossport-travel-journal/1.0 (contact: local)";

type NominatimReverse = {
  display_name?: string;
  address?: {
    city?: string;
    town?: string;
    village?: string;
    municipality?: string;
    state?: string;
    country?: string;
  };
};

export async function reverseGeocodeLabel(lat: number, lng: number): Promise<string | null> {
  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lng));
  url.searchParams.set("format", "json");

  const response = await fetch(url, {
    headers: { Accept: "application/json", "User-Agent": NOMINATIM_UA },
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) return null;

  const data = (await response.json()) as NominatimReverse;
  const address = data.address;
  if (address) {
    const locality =
      address.city ?? address.town ?? address.village ?? address.municipality;
    const parts = [locality, address.state].filter(Boolean);
    if (parts.length) return parts.join(", ");
    if (address.country) return address.country;
  }
  return data.display_name?.split(",").slice(0, 2).join(",").trim() ?? null;
}
