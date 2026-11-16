export type ProfileRow = {
  display_name: string;
  username: string;
  tagline: string;
  bio: string;
  avatar_url: string | null;
  current_place_name: string | null;
  current_lat: number | null;
  current_lng: number | null;
};

export function mapProfileLocation(profile: Pick<ProfileRow, "current_place_name" | "current_lat" | "current_lng">) {
  if (!profile.current_place_name && profile.current_lat == null && profile.current_lng == null) {
    return undefined;
  }
  return {
    name: profile.current_place_name ?? undefined,
    lat: profile.current_lat ?? undefined,
    lng: profile.current_lng ?? undefined,
  };
}
