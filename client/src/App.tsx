import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import useEmblaCarousel from "embla-carousel-react";
import exifr from "exifr";
import {
  Link,
  Navigate,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import { PlaceInput } from "./PlaceInput";
import { RichTextEditor } from "./RichTextEditor";
import { resolveStoryHtml, storyHtmlToPlainText, storyToEditorHtml } from "./rich-text";

type Image = {
  id: string;
  url: string;
  width?: number;
  height?: number;
  alt?: string;
  focusX?: number;
  focusY?: number;
  fit?: "cover" | "contain";
  hasLocationMetadata?: boolean;
  hasDateMetadata?: boolean;
};

const FRAME_ASPECT = 4 / 5;

function clamp01(value: number) {
  return Math.min(1, Math.max(0, value));
}

function imageObjectPosition(image: Pick<Image, "focusX" | "focusY">) {
  const x = (image.focusX ?? 0.5) * 100;
  const y = (image.focusY ?? 0.5) * 100;
  return `${x}% ${y}%`;
}

function isFullPhotoFit(image: Pick<Image, "fit">) {
  return (image.fit ?? "cover") === "contain";
}

function CarouselPhoto({
  image,
  alt,
  loading = "lazy",
  focus,
}: {
  image: Image;
  alt: string;
  loading?: "eager" | "lazy";
  focus?: FocusPoint;
}) {
  if (isFullPhotoFit(image)) {
    return (
      <img
        className="carousel-photo-full"
        src={image.url}
        alt={alt}
        loading={loading}
        draggable={false}
        decoding="async"
      />
    );
  }
  const positioned = focus
    ? { focusX: focus.x, focusY: focus.y }
    : { focusX: image.focusX, focusY: image.focusY };
  return (
    <img
      src={image.url}
      alt={alt}
      loading={loading}
      draggable={false}
      decoding="async"
      className="carousel-photo-cover"
      style={{ objectPosition: imageObjectPosition(positioned) }}
    />
  );
}

function framingPanAxes(width?: number, height?: number) {
  if (!width || !height) return { x: true, y: true };
  const imageAspect = width / height;
  if (imageAspect > FRAME_ASPECT + 0.02) return { x: true, y: false };
  if (imageAspect < FRAME_ASPECT - 0.02) return { x: false, y: true };
  return { x: false, y: false };
}

const EDITOR_REFRAME_DRAG_THRESHOLD_PX = 10;

function editorSlideFramingGesture(
  image: Image,
  fit: "cover" | "contain",
  imageCount: number,
  hasFocusSave: boolean,
) {
  const axes = framingPanAxes(image.width, image.height);
  const canReframe = hasFocusSave && fit === "cover" && (axes.x || axes.y);
  if (!canReframe) {
    return { axes, reframeGestures: false, allowCarouselDrag: true, deferCarouselDrag: false };
  }
  const landscapePanOnly = axes.x && !axes.y;
  const portraitPanOnly = axes.y && !axes.x;
  if (imageCount > 1 && (landscapePanOnly || (axes.x && axes.y))) {
    return { axes, reframeGestures: false, allowCarouselDrag: true, deferCarouselDrag: false };
  }
  if (portraitPanOnly) {
    return { axes, reframeGestures: true, allowCarouselDrag: true, deferCarouselDrag: true };
  }
  return { axes, reframeGestures: true, allowCarouselDrag: false, deferCarouselDrag: false };
}

type PhotoMetadataFlags = { hasLocation: boolean; hasDate: boolean };

type FileExif = PhotoMetadataFlags & { lat?: number; lng?: number; takenAt?: string };
type PostChapter = {
  id: string;
  slug: string;
  title: string;
  trip: { id: string; slug: string; title: string };
};

type PostTrip = { id: string; slug: string; title: string };
type TravelPlace = { name?: string; lat: number; lng: number };
type TripCrossing = { from: TravelPlace; arrived: TravelPlace };

type Post = {
  id: string;
  slug: string;
  caption: string;
  contentHtml?: string;
  takenAt: string;
  publishedAt: string;
  isDraft?: boolean;
  trip?: PostTrip;
  chapter?: PostChapter;
  location?: { name?: string; lat?: number; lng?: number };
  images: Image[];
};

function StoryHtml({ html, className }: { html: string; className?: string }) {
  const trimmed = html.trim();
  if (!trimmed) return null;
  return <div className={className} dangerouslySetInnerHTML={{ __html: trimmed }} />;
}

function PostStory({ post, className }: { post: Post; className?: string }) {
  const html = resolveStoryHtml(post);
  if (html) return <StoryHtml html={html} className={className} />;
  if (!post.caption.trim()) return null;
  return <p className={className}>{post.caption}</p>;
}

type AdminChapter = { id: string; slug: string; title: string; tripId: string };
type AdminTrip = {
  id: string;
  slug: string;
  title: string;
  albumId?: string | null;
  crossing?: TripCrossing;
  chapters: AdminChapter[];
};
type AdminAlbum = { id: string; slug: string; title: string; tripCount: number; featured?: boolean };
type FeedChapter = { id: string; slug: string; title: string };
type FeedTrip = { id: string; slug: string; title: string; crossing?: TripCrossing; chapters: FeedChapter[] };
type FeedAlbum = { id: string; slug: string; title: string; featured?: boolean; trips: FeedTrip[] };
type FeedCatalog = { albums: FeedAlbum[]; trips: FeedTrip[] };

type SiteMode = {
  preview: boolean;
  postBase: string;
  postsListUrl: string;
  tripsListUrl: string;
};
const liveSite: SiteMode = {
  preview: false,
  postBase: "/p",
  postsListUrl: "/api/posts",
  tripsListUrl: "/api/trips",
};
const previewSite: SiteMode = {
  preview: true,
  postBase: "/preview/p",
  postsListUrl: "/api/preview/posts",
  tripsListUrl: "/api/preview/trips",
};

const ALL_CHAPTERS = "all";
type FeedViewMode = "timeline" | "grouped";
type TripFeedPrefs = { view: FeedViewMode; chapterId: string };

const defaultTripFeedPrefs = (): TripFeedPrefs => ({ view: "timeline", chapterId: ALL_CHAPTERS });
type Profile = {
  displayName: string;
  username: string;
  tagline: string;
  bio: string;
  avatarUrl?: string;
  avatarFocusX?: number;
  avatarFocusY?: number;
  currentLocation?: { name?: string; lat?: number; lng?: number };
  links: { label: string; href: string }[];
};

const api = async <T,>(url: string, options?: RequestInit): Promise<T> => {
  const response = await fetch(url, { credentials: "include", ...options });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(payload.error ?? "Request failed");
  }
  return response.json();
};

const formatDate = (value: string) =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric" }).format(
    new Date(value),
  );

const datetimeLocalNow = () => new Date().toISOString().slice(0, 16);

function storyShortTitle(post: Post) {
  if (post.location?.name) {
    const primary = post.location.name.split(",")[0]?.trim();
    if (primary) return primary;
  }
  const plain = storyHtmlToPlainText(post.contentHtml || post.caption);
  const words = plain.split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
  if (words) return words;
  return new Intl.DateTimeFormat("en", { month: "short", year: "numeric" }).format(new Date(post.takenAt));
}

function storyThumbnail(post: Post) {
  const lat = post.location?.lat;
  const lng = post.location?.lng;
  if (lat != null && lng != null) {
    const mapUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${lat},${lng}&zoom=12&size=160x160&maptype=mapnik&markers=${lat},${lng},lightblue1`;
    return { type: "map" as const, url: mapUrl, alt: post.location?.name || "Map" };
  }
  const cover = post.images[0];
  if (cover?.url) {
    return { type: "photo" as const, url: cover.url, alt: cover.alt || storyShortTitle(post) };
  }
  return null;
}

function postTripId(post: Post) {
  return post.chapter?.trip.id ?? post.trip?.id;
}

function journeyGroupingLabel(post: Post) {
  const tripTitle = post.chapter?.trip.title ?? post.trip?.title;
  if (!tripTitle) return null;
  if (post.chapter) return `${tripTitle} · ${post.chapter.title}`;
  return tripTitle;
}

function postsForTrip(posts: Post[], tripId: string) {
  return posts.filter((post) => postTripId(post) === tripId);
}

function tripCoverPost(posts: Post[], tripId: string) {
  return postsForTrip(posts, tripId)[0];
}

function catalogAllTrips(catalog: FeedCatalog): FeedTrip[] {
  return catalog.trips;
}

function albumMosaicUrls(posts: Post[], album: FeedAlbum): string[] {
  const urls: string[] = [];
  for (const trip of album.trips) {
    const cover = tripCoverPost(posts, trip.id);
    if (!cover) continue;
    const thumb = storyThumbnail(cover);
    if (thumb?.url) urls.push(thumb.url);
    if (urls.length >= 4) break;
  }
  return urls;
}

function TripStoryChip({
  trip,
  posts,
  selected,
  onSelect,
}: {
  trip: FeedTrip;
  posts: Post[];
  selected: boolean;
  onSelect: () => void;
}) {
  const cover = tripCoverPost(posts, trip.id);
  const thumb = cover ? storyThumbnail(cover) : null;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={`Trip: ${trip.title}`}
      className={`story-chip${selected ? " story-chip-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="story-chip-ring" aria-hidden>
        {thumb ? (
          <img
            className="story-chip-thumb"
            src={thumb.url}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <span className="story-chip-fallback">
            <Icon name="journey" size={22} />
          </span>
        )}
      </span>
      <span className="story-chip-label" title={trip.title}>
        {trip.title}
      </span>
    </button>
  );
}

function AlbumStoryChip({
  album,
  posts,
  selected,
  onSelect,
}: {
  album: FeedAlbum;
  posts: Post[];
  selected: boolean;
  onSelect: () => void;
}) {
  const mosaic = albumMosaicUrls(posts, album);
  const count = album.trips.length;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      aria-label={`Collection: ${album.title}, ${count} trips`}
      className={`story-chip story-chip-album${selected ? " story-chip-selected" : ""}`}
      onClick={onSelect}
    >
      <span className="story-chip-ring story-chip-ring-album" aria-hidden>
        {mosaic.length === 0 ? (
          <span className="story-chip-fallback">
            <Icon name="layers" size={22} />
          </span>
        ) : mosaic.length === 1 ? (
          <img
            className="story-chip-thumb"
            src={mosaic[0]}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
          />
        ) : (
          <span className="story-chip-album-mosaic">
            {mosaic.slice(0, 4).map((url, index) => (
              <img key={`${url}-${index}`} src={url} alt="" loading="lazy" decoding="async" draggable={false} />
            ))}
            {Array.from({ length: Math.max(0, 4 - mosaic.length) }, (_, index) => (
              <span key={`pad-${index}`} className="story-chip-album-mosaic-pad" />
            ))}
          </span>
        )}
      </span>
      <span className="story-chip-label" title={album.title}>
        {album.title}
      </span>
      <span className="story-chip-meta">
        {count} trip{count === 1 ? "" : "s"}
      </span>
    </button>
  );
}

function StoryCatalogSelector({
  catalog,
  posts,
  openAlbumId,
  selectedTripId,
  onOpenAlbum,
  onCloseAlbum,
  onSelectTrip,
}: {
  catalog: FeedCatalog;
  posts: Post[];
  openAlbumId: string | null;
  selectedTripId: string | null;
  onOpenAlbum: (albumId: string) => void;
  onCloseAlbum: () => void;
  onSelectTrip: (tripId: string) => void;
}) {
  const openAlbum = openAlbumId ? catalog.albums.find((album) => album.id === openAlbumId) : undefined;

  return (
    <div className="story-selector-shell">
      {openAlbum ? (
        <button type="button" className="story-album-back" onClick={onCloseAlbum}>
          ← {openAlbum.title}
        </button>
      ) : null}
      <div
        className="story-selector"
        role="tablist"
        aria-label={openAlbum ? `Trips in ${openAlbum.title}` : "Stories"}
        aria-orientation="horizontal"
      >
        {openAlbum
          ? (
            <>
              {openAlbum.trips.map((trip) => (
                <TripStoryChip
                  key={trip.id}
                  trip={trip}
                  posts={posts}
                  selected={trip.id === selectedTripId}
                  onSelect={() => onSelectTrip(trip.id)}
                />
              ))}
            </>
          )
          : (
            <>
              {catalog.albums.map((album) => (
                <AlbumStoryChip
                  key={album.id}
                  album={album}
                  posts={posts}
                  selected={false}
                  onSelect={() => onOpenAlbum(album.id)}
                />
              ))}
              {catalog.albums.length > 0 && catalog.trips.length > 0 ? (
                <div className="story-selector-divider" role="presentation" aria-hidden />
              ) : null}
              {catalog.trips.map((trip) => (
                <TripStoryChip
                  key={trip.id}
                  trip={trip}
                  posts={posts}
                  selected={trip.id === selectedTripId}
                  onSelect={() => onSelectTrip(trip.id)}
                />
              ))}
            </>
          )}
      </div>
    </div>
  );
}

function FeedViewRuleMenu({
  open,
  onOpenChange,
  view,
  detailLabel,
  scope,
  onViewChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  view: FeedViewMode;
  detailLabel: string;
  scope: "collection" | "trip";
  onViewChange: (view: FeedViewMode) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = anchorRef.current;
      if (root && !root.contains(event.target as Node)) onOpenChange(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onOpenChange]);

  const pickView = (next: FeedViewMode) => {
    onViewChange(next);
    onOpenChange(false);
  };

  return (
    <div className="feed-view-rule-anchor" ref={anchorRef}>
      <button
        type="button"
        className={`feed-rule-view-trigger${open ? " feed-rule-view-trigger-open" : ""}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`View: ${detailLabel}`}
        onClick={() => onOpenChange(!open)}
      >
        <span>{detailLabel}</span>
        <svg
          className={`feed-rule-view-chevron${open ? " feed-rule-view-chevron-open" : ""}`}
          width={11}
          height={11}
          viewBox="0 0 12 12"
          aria-hidden
        >
          <path
            d="M3 4.5 6 7.5 9 4.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      {open ? (
        <div
          className="feed-view-popover"
          role="dialog"
          aria-label={scope === "collection" ? "View for this collection" : "View for this trip"}
        >
          <p className="feed-view-label">View</p>
          <button
            type="button"
            className={`feed-view-option${view === "timeline" ? " feed-view-option-selected" : ""}`}
            onClick={() => pickView("timeline")}
          >
            <span className="feed-view-option-title">Timeline</span>
            <span className="feed-view-option-hint">All entries, newest first</span>
            {view === "timeline" ? <span className="feed-view-option-check" aria-hidden>✓</span> : null}
          </button>
          <button
            type="button"
            className={`feed-view-option${view === "grouped" ? " feed-view-option-selected" : ""}`}
            onClick={() => pickView("grouped")}
          >
            <span className="feed-view-option-title">{scope === "collection" ? "By trip" : "By chapter"}</span>
            <span className="feed-view-option-hint">
              {scope === "collection" ? "Browse one trip at a time" : "Browse sections inside this trip"}
            </span>
            {view === "grouped" ? <span className="feed-view-option-check" aria-hidden>✓</span> : null}
          </button>
        </div>
      ) : null}
    </div>
  );
}

function FeedChapterBar({
  chapterId,
  chapters,
  onChapterChange,
}: {
  chapterId: string;
  chapters: FeedChapter[];
  onChapterChange: (id: string) => void;
}) {
  return (
    <div className="feed-chapter-bar">
      <label className="feed-view-label" htmlFor="feed-chapter-select">
        Chapter
      </label>
      <select
        id="feed-chapter-select"
        className="feed-view-chapter-select"
        aria-label="Chapter"
        value={chapterId}
        onChange={(e) => onChapterChange(e.target.value)}
      >
        <option value={ALL_CHAPTERS}>All entries</option>
        {chapters.map((chapter) => (
          <option key={chapter.id} value={chapter.id}>
            {chapter.title}
          </option>
        ))}
      </select>
    </div>
  );
}

async function readFileExif(file: File): Promise<FileExif> {
  try {
    const exif = await exifr.parse(file, { pick: ["DateTimeOriginal", "latitude", "longitude"] });
    if (!exif) return { hasLocation: false, hasDate: false };
    const lat = typeof exif.latitude === "number" ? exif.latitude : undefined;
    const lng = typeof exif.longitude === "number" ? exif.longitude : undefined;
    const takenAt = exif.DateTimeOriginal ? new Date(exif.DateTimeOriginal).toISOString() : undefined;
    return {
      hasLocation: lat != null && lng != null,
      hasDate: Boolean(takenAt),
      lat,
      lng,
      takenAt,
    };
  } catch {
    return { hasLocation: false, hasDate: false };
  }
}

async function resolvePlaceName(lat: number, lng: number) {
  const resolved = await api<{ name: string | null }>(`/api/geocode/reverse?lat=${lat}&lng=${lng}`);
  return resolved.name;
}

function detectCurrentLocation(): Promise<{ lat: number; lng: number; name: string | null }> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation is not available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        let name: string | null = null;
        try {
          name = (await resolvePlaceName(lat, lng)) ?? null;
        } catch {
          /* coordinates still usable */
        }
        resolve({ lat, lng, name });
      },
      () => reject(new Error("Could not access your location.")),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  });
}

function PhotoMetadataOverlay({ flags }: { flags: PhotoMetadataFlags }) {
  if (!flags.hasLocation && !flags.hasDate) return null;
  return (
    <div className="photo-metadata-overlay" aria-label="Embedded photo metadata available">
      {flags.hasLocation && (
        <span>
          <Icon name="pin" size={14} /> Location
        </span>
      )}
      {flags.hasDate && <span>Date</span>}
    </div>
  );
}

function editorImageFlags(
  image: Image,
  index: number,
  legacyLocationOnFirst: boolean,
): PhotoMetadataFlags {
  return {
    hasLocation: Boolean(image.hasLocationMetadata) || (legacyLocationOnFirst && index === 0),
    hasDate: Boolean(image.hasDateMetadata),
  };
}

function isPaoOfflineBrand(name: string) {
  return /^pao\.offline$/i.test(name.trim());
}

function parseDomainDisplayName(name: string) {
  const trimmed = name.trim();
  const dot = trimmed.indexOf(".");
  if (dot <= 0) return null;
  const host = trimmed.slice(0, dot);
  const suffix = trimmed.slice(dot);
  if (!/^[a-z0-9-]+$/i.test(host) || suffix.length < 2) return null;
  const lead = host.charAt(0).toUpperCase() + host.slice(1).toLowerCase();
  return { lead, suffix: suffix.toLowerCase(), label: `${lead}${suffix.toLowerCase()}` };
}

function displayNameLead(name: string) {
  const trimmed = name.trim();
  if (!trimmed) return trimmed;
  const parsed = parseDomainDisplayName(trimmed);
  if (parsed) return parsed.lead;
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function avatarInitial(displayName: string) {
  if (isPaoOfflineBrand(displayName)) return "P";
  return displayNameLead(displayName).slice(0, 1);
}

function ProfileDisplayName({ displayName, hero = false }: { displayName: string; hero?: boolean }) {
  if (isPaoOfflineBrand(displayName)) {
    return <BrandName hero={hero} />;
  }
  const parsed = parseDomainDisplayName(displayName);
  if (parsed) {
    if (hero) {
      return (
        <span className="profile-display-name profile-display-name-hero" aria-label={parsed.label}>
          {parsed.lead}
          {parsed.suffix}
        </span>
      );
    }
    return (
      <>
        {parsed.lead}
        {parsed.suffix}
      </>
    );
  }
  if (hero) {
    const label = displayNameLead(displayName);
    return (
      <span className="profile-display-name profile-display-name-hero" aria-label={label}>
        {label}
      </span>
    );
  }
  return <>{displayNameLead(displayName)}</>;
}

function ProfileBio({ bio }: { bio: string }) {
  const text = bio.trim().replace(/\s*\n+\s*/g, " ");
  if (!text) return null;
  return <p className="bio">{text}</p>;
}

function BrandName({ hero = false, className }: { hero?: boolean; className?: string }) {
  const classes = ["brand-name", hero ? "brand-name-hero" : "", className].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-label="pao.offline">
      <span className="brand-name-pao">pao</span>
      <span className="brand-name-dot">.</span>
      <span className="brand-name-offline">offline</span>
    </span>
  );
}

function Icon({
  name,
  size = 20,
}: {
  name: "pin" | "mapPin" | "grid" | "arrow" | "share" | "plus" | "menu" | "x" | "journey" | "layers" | "plane" | "globe";
  size?: number;
}) {
  const paths = {
    pin: <path d="M12 21s7-6.2 7-13A7 7 0 1 0 5 8c0 6.8 7 13 7 13Zm0-10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
    mapPin: (
      <>
        <path d="M12 21s7-6.2 7-13A7 7 0 1 0 5 8c0 6.8 7 13 7 13Z" />
        <circle className="travel-pin-dot" cx="12" cy="8" r="3" />
      </>
    ),
    journey: <path d="M3 6.5 9 4.5l6 2 6-2v13l-6 2-6-2-6 2V6.5Z M9 4.5v13M15 6.5v13" />,
    plane: (
      <path d="M21 16v-2l-8-5V3.5a1.5 1.5 0 0 0-3 0V9l-8 5v2l8-2.5V19l-2 1.5V22l3.5-1 3.5 1v-1.5L13 19v-5.5l8 2.5z" />
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 2v20" />
        <path d="M2 12h20" />
        <path d="M3.4 9Q12 5.6 20.6 9" />
        <path d="M3.4 15Q12 18.4 20.6 15" />
        <g className="travel-globe-spin">
          <path d="M12 2C4.6 2 2.6 12 12 22" />
          <path d="M12 2c7.4 0 9.4 10 0 20" />
        </g>
      </>
    ),
    layers: <path d="M4 9.5 12 5l8 4.5-8 4.5-8-4.5Zm0 5.5 8 4.5 8-4.5M12 14v6" />,
    grid: <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />,
    arrow: <path d="m15 18-6-6 6-6" />,
    share: <path d="M12 16V3m0 0L7 8m5-5 5 5M5 13v7h14v-7" />,
    plus: <path d="M12 5v14M5 12h14" />,
    menu: <path d="M4 7h16M4 12h16M4 17h16" />,
    x: <path d="m6 6 12 12M18 6 6 18" />,
  };
  return (
    <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      {paths[name]}
    </svg>
  );
}

function Loading() {
  return (
    <main className="page-shell">
      <div className="skeleton hero-skeleton" />
      <div className="skeleton post-skeleton" />
    </main>
  );
}

function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return (
    <div className="state-card">
      <p className="eyebrow">Something drifted off course</p>
      <h2>We couldn't load the journal.</h2>
      <p>{message}</p>
      {retry && <button onClick={retry}>Try again</button>}
    </div>
  );
}

function Avatar({ profile, large = false }: { profile: Profile; large?: boolean }) {
  return (
    <div className={`avatar ${large ? "avatar-large" : ""}`}>
      {profile.avatarUrl ? (
        <img
          src={profile.avatarUrl}
          alt={`${profile.displayName}'s portrait`}
          style={{ objectPosition: `${(profile.avatarFocusX ?? 0.5) * 100}% ${(profile.avatarFocusY ?? 0.5) * 100}%` }}
        />
      ) : (
        <span>{avatarInitial(profile.displayName)}</span>
      )}
    </div>
  );
}

type FocusPoint = { x: number; y: number };

function FramingFitToggle({
  fit,
  disabled = false,
  overlay = false,
  onChange,
  stopPointerPropagation = false,
}: {
  fit: "cover" | "contain";
  disabled?: boolean;
  overlay?: boolean;
  onChange: (fit: "cover" | "contain") => void;
  stopPointerPropagation?: boolean;
}) {
  const stopPointerBubble = (event: React.PointerEvent) => {
    event.stopPropagation();
  };
  const pointerProps = stopPointerPropagation
    ? {
        onPointerDown: stopPointerBubble,
        onPointerUp: stopPointerBubble,
        onPointerCancel: stopPointerBubble,
      }
    : {};
  return (
    <div
      className={`framing-fit-toggle${overlay ? " framing-fit-toggle-overlay" : ""}`}
      role="group"
      aria-label="Framing mode"
      {...pointerProps}
    >
      <button
        type="button"
        className="framing-fit-option"
        disabled={disabled}
        aria-pressed={fit === "contain"}
        onClick={(event) => {
          if (stopPointerPropagation) event.stopPropagation();
          if (fit !== "contain") onChange("contain");
        }}
        {...pointerProps}
      >
        Full Photo
      </button>
      <button
        type="button"
        className="framing-fit-option"
        disabled={disabled}
        aria-pressed={fit === "cover"}
        onClick={(event) => {
          if (stopPointerPropagation) event.stopPropagation();
          if (fit !== "cover") onChange("cover");
        }}
        {...pointerProps}
      >
        Fill Frame
      </button>
    </div>
  );
}

function EditorImageCarousel({
  images,
  legacyLocationOnFirst = false,
  onFocusSave,
  onFitChange,
  framingBusy = false,
}: {
  images: Image[];
  legacyLocationOnFirst?: boolean;
  onFocusSave?: (imageId: string, focusX: number, focusY: number) => Promise<void>;
  onFitChange?: (imageId: string, fit: "cover" | "contain") => Promise<void>;
  framingBusy?: boolean;
}) {
  const allowCarouselDragRef = useRef(true);
  const [emblaRef, embla] = useEmblaCarousel({
    loop: images.length > 1,
    watchDrag: () => allowCarouselDragRef.current,
  });
  const [selected, setSelected] = useState(0);
  const [focusById, setFocusById] = useState<Record<string, FocusPoint>>({});
  const [fitById, setFitById] = useState<Record<string, "cover" | "contain">>({});
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<
    | {
        id: string;
        startX: number;
        startY: number;
        focusX: number;
        focusY: number;
        width: number;
        height: number;
        axes: { x: boolean; y: boolean };
        started: boolean;
        deferCarouselDrag: boolean;
        pointerId: number;
      }
    | null
  >(null);

  useEffect(() => {
    if (dragging) return;
    setFocusById(
      Object.fromEntries(
        images.map((image) => [image.id, { x: image.focusX ?? 0.5, y: image.focusY ?? 0.5 }]),
      ),
    );
    setFitById(Object.fromEntries(images.map((image) => [image.id, image.fit ?? "cover"])));
  }, [images, dragging]);

  const resolveFit = (image: Image) => fitById[image.id] ?? image.fit ?? "cover";

  const setImageFit = (image: Image, next: "cover" | "contain") => {
    setFitById((current) => ({ ...current, [image.id]: next }));
  };

  const isFramingControl = (target: EventTarget | null) =>
    target instanceof Element && Boolean(target.closest(".framing-fit-toggle, .framing-tool-control, button, a"));

  useEffect(() => {
    if (!embla) return;
    const update = () => setSelected(embla.selectedScrollSnap());
    update();
    embla.on("select", update);
    embla.on("reInit", update);
    return () => {
      embla.off("select", update);
      embla.off("reInit", update);
    };
  }, [embla]);

  const finishDrag = (imageId: string) => {
    if (!dragRef.current) return;
    const focus = focusById[imageId];
    dragRef.current = null;
    setDragging(false);
    if (focus && onFocusSave) void onFocusSave(imageId, focus.x, focus.y);
  };

  const active = images[selected];
  const activeFit = active ? resolveFit(active) : "cover";
  const activeGesture = active
    ? editorSlideFramingGesture(active, activeFit, images.length, Boolean(onFocusSave))
    : null;
  const canReframe = Boolean(activeGesture?.reframeGestures);
  allowCarouselDragRef.current = activeGesture?.allowCarouselDrag ?? true;

  const beginReframeDrag = (
    event: React.PointerEvent<HTMLDivElement>,
    image: Image,
    focus: FocusPoint,
    axes: { x: boolean; y: boolean },
    deferCarouselDrag: boolean,
  ) => {
    if (!deferCarouselDrag) event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      id: image.id,
      startX: event.clientX,
      startY: event.clientY,
      focusX: focus.x,
      focusY: focus.y,
      width: event.currentTarget.clientWidth,
      height: event.currentTarget.clientHeight,
      axes,
      started: !deferCarouselDrag,
      deferCarouselDrag,
      pointerId: event.pointerId,
    };
    setDragging(!deferCarouselDrag);
  };

  return (
    <>
      <div className="carousel editor-carousel" ref={emblaRef}>
        <div className="carousel-track">
          {images.map((image, index) => {
            const focus = focusById[image.id] ?? { x: image.focusX ?? 0.5, y: image.focusY ?? 0.5 };
            const fit = resolveFit(image);
            const framedImage = { ...image, fit };
            const isActive = index === selected;
            const gesture = editorSlideFramingGesture(image, fit, images.length, Boolean(onFocusSave));
            const { axes } = gesture;
            const reframeGestures = isActive && gesture.reframeGestures;
            return (
              <div
                className={`carousel-slide photo-frame framing-frame${fit === "contain" ? " carousel-slide-contain framing-frame-contain" : ""}${reframeGestures ? " framing-frame-active" : ""}${reframeGestures && gesture.deferCarouselDrag ? " framing-frame-pan-x" : ""}${dragging && isActive ? " framing-frame-dragging" : ""}`}
                key={image.id}
                onPointerDown={
                  reframeGestures
                    ? (event) => {
                        if (isFramingControl(event.target)) return;
                        beginReframeDrag(event, image, focus, axes, gesture.deferCarouselDrag);
                      }
                    : undefined
                }
                onPointerMove={
                  reframeGestures
                    ? (event) => {
                        const drag = dragRef.current;
                        if (!drag || drag.id !== image.id) return;
                        const dx = event.clientX - drag.startX;
                        const dy = event.clientY - drag.startY;
                        if (drag.deferCarouselDrag && !drag.started) {
                          const vertical =
                            Math.abs(dy) >= EDITOR_REFRAME_DRAG_THRESHOLD_PX &&
                            Math.abs(dy) > Math.abs(dx) * 1.15;
                          if (!vertical) return;
                          drag.started = true;
                          setDragging(true);
                          event.currentTarget.setPointerCapture(drag.pointerId);
                        }
                        if (!drag.started) return;
                        const nextX = drag.axes.x ? clamp01(drag.focusX + dx / drag.width) : drag.focusX;
                        const nextY = drag.axes.y ? clamp01(drag.focusY + dy / drag.height) : drag.focusY;
                        setFocusById((current) => ({
                          ...current,
                          [image.id]: { x: nextX, y: nextY },
                        }));
                      }
                    : undefined
                }
                onPointerUp={
                  reframeGestures
                    ? (event) => {
                        if (isFramingControl(event.target)) return;
                        const drag = dragRef.current;
                        if (drag && !drag.started) {
                          dragRef.current = null;
                          return;
                        }
                        finishDrag(image.id);
                      }
                    : undefined
                }
                onPointerCancel={
                  reframeGestures
                    ? (event) => {
                        if (isFramingControl(event.target)) return;
                        const drag = dragRef.current;
                        if (drag && !drag.started) {
                          dragRef.current = null;
                          return;
                        }
                        finishDrag(image.id);
                      }
                    : undefined
                }
              >
                <CarouselPhoto
                  image={framedImage}
                  alt={image.alt || `Travel photograph ${index + 1} of ${images.length}`}
                  loading={index === 0 ? "eager" : "lazy"}
                  focus={focus}
                />
                <PhotoMetadataOverlay flags={editorImageFlags(image, index, legacyLocationOnFirst)} />
                {isActive && onFitChange && (
                  <FramingFitToggle
                    fit={fit}
                    overlay
                    disabled={framingBusy}
                    stopPointerPropagation
                    onChange={(next) => {
                      setImageFit(image, next);
                      void onFitChange(image.id, next);
                    }}
                  />
                )}
              </div>
            );
          })}
        </div>
        {images.length > 1 && (
          <>
            <span className="image-count">{selected + 1} / {images.length}</span>
            <button
              className="carousel-arrow carousel-arrow-prev"
              type="button"
              onClick={() => embla?.scrollPrev()}
              aria-label="Previous photograph"
            >
              <Icon name="arrow" size={22} />
            </button>
            <button
              className="carousel-arrow carousel-arrow-next"
              type="button"
              onClick={() => embla?.scrollNext()}
              aria-label="Next photograph"
            >
              <Icon name="arrow" size={22} />
            </button>
          </>
        )}
      </div>
      {onFocusSave && active && (
        <div className="editor-image-tools">
          <span className="editor-image-tools-label">Frame photo {selected + 1}</span>
          {onFitChange && (
            <div className="editor-image-tools-actions">
              <FramingFitToggle
                fit={activeFit}
                disabled={framingBusy}
                onChange={(next) => {
                  setImageFit(active, next);
                  void onFitChange(active.id, next);
                }}
              />
            </div>
          )}
          <p className="form-hint">
            {activeFit === "contain"
              ? `The whole image is scaled to fit inside the frame at its original proportions (never enlarged past its file size).${framingBusy ? " Saving…" : ""}`
              : canReframe
                ? `Drag to recenter the crop. Full photo fits the entire image in the frame at original proportions.${framingBusy ? " Saving…" : ""}`
                : "Full photo fits the entire image in the frame at original proportions."}
          </p>
        </div>
      )}
    </>
  );
}

function Carousel({ images, linkedSlug, postBase = "/p" }: { images: Image[]; linkedSlug?: string; postBase?: string }) {
  const [emblaRef, embla] = useEmblaCarousel({ loop: images.length > 1 });
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!embla) return;
    const update = () => setSelected(embla.selectedScrollSnap());
    update();
    embla.on("select", update);
    embla.on("reInit", update);
    return () => {
      embla.off("select", update);
      embla.off("reInit", update);
    };
  }, [embla]);

  return (
    <div className="carousel" ref={emblaRef}>
      <div className="carousel-track">
        {images.map((image, index) => {
          const fullPhoto = isFullPhotoFit(image);
          return (
            <div className={`carousel-slide${fullPhoto ? " carousel-slide-contain" : ""}`} key={image.id}>
              {linkedSlug ? (
                <Link to={`${postBase}/${linkedSlug}`} aria-label="Open journal">
                  <CarouselPhoto
                    image={image}
                    alt={image.alt || `Travel photograph ${index + 1} of ${images.length}`}
                    loading={index === 0 ? "eager" : "lazy"}
                  />
                </Link>
              ) : (
                <CarouselPhoto
                  image={image}
                  alt={image.alt || `Travel photograph ${index + 1} of ${images.length}`}
                  loading={index === 0 ? "eager" : "lazy"}
                />
              )}
            </div>
          );
        })}
      </div>
      {images.length > 1 && (
        <>
          <span className="image-count">{selected + 1} / {images.length}</span>
          <button
            className="carousel-arrow carousel-arrow-prev"
            type="button"
            onClick={() => embla?.scrollPrev()}
            aria-label="Previous photograph"
          >
            <Icon name="arrow" size={22} />
          </button>
          <button
            className="carousel-arrow carousel-arrow-next"
            type="button"
            onClick={() => embla?.scrollNext()}
            aria-label="Next photograph"
          >
            <Icon name="arrow" size={22} />
          </button>
          <div className="carousel-dots" aria-label="Carousel position">
            {images.map((image, index) => (
              <button
                key={image.id}
                className={selected === index ? "active" : ""}
                onClick={(event) => {
                  event.preventDefault();
                  embla?.scrollTo(index);
                }}
                aria-label={`Show image ${index + 1}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function PreviewSiteBanner() {
  return (
    <div className="preview-site-banner" role="status">
      <span>Preview site</span>
      <p>Drafts and unpublished journals appear here. The live site is at <Link to="/">your domain</Link>.</p>
    </div>
  );
}

function PostCard({
  post,
  profile,
  site,
  showJourneyGrouping = true,
}: {
  post: Post;
  profile: Profile;
  site: SiteMode;
  showJourneyGrouping?: boolean;
}) {
  const grouping = showJourneyGrouping ? journeyGroupingLabel(post) : null;
  return (
    <article className={`post-card${post.isDraft ? " post-card-draft" : ""}`}>
      <header className="post-header">
        <Avatar profile={profile} />
        <div>
          <strong>{profile.username}</strong>
          {post.location?.name && <span className="post-header-place">{post.location.name}</span>}
        </div>
        <div className="post-header-aside">
          {grouping && <span className="journey-grouping">{grouping}</span>}
          <time>{formatDate(post.takenAt)}</time>
        </div>
      </header>
      {post.isDraft && <p className="draft-pill">Draft — not on live site</p>}
      <Carousel images={post.images} linkedSlug={post.slug} postBase={site.postBase} />
      <div className="post-copy">
        <div className="post-copy-text">
          <strong>{profile.username}</strong>
          <PostStory post={post} className="post-story rich-story" />
        </div>
        <Link className="quiet-link" to={`${site.postBase}/${post.slug}`}>View journal</Link>
      </div>
    </article>
  );
}

const CROSSING_MAP_WIDTH = 640;
const CROSSING_MAP_HEIGHT = 280;

function mercatorPoint(place: TravelPlace) {
  const latitude = Math.max(-85.0511, Math.min(85.0511, place.lat));
  const radians = (latitude * Math.PI) / 180;
  return {
    x: (place.lng + 180) / 360,
    y: (1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2,
  };
}

function wrappedWorldDelta(value: number) {
  return ((value + 0.5) % 1 + 1) % 1 - 0.5;
}

function crossingMapLayout(crossing: TripCrossing) {
  const from = mercatorPoint(crossing.from);
  const arrived = mercatorPoint(crossing.arrived);
  const dx = wrappedWorldDelta(arrived.x - from.x);
  const dy = arrived.y - from.y;
  const centerX = from.x + dx / 2;
  const centerY = from.y + dy / 2;
  const horizontalZoom = Math.log2((CROSSING_MAP_WIDTH * 0.7) / Math.max(Math.abs(dx) * 256, 1));
  const verticalZoom = Math.log2((CROSSING_MAP_HEIGHT * 0.5) / Math.max(Math.abs(dy) * 256, 1));
  const zoom = Math.max(1, Math.min(5, Math.floor(Math.min(horizontalZoom, verticalZoom))));
  const worldSize = 256 * 2 ** zoom;
  const point = (projected: { x: number; y: number }) => ({
    x: CROSSING_MAP_WIDTH / 2 + wrappedWorldDelta(projected.x - centerX) * worldSize,
    y: CROSSING_MAP_HEIGHT / 2 + (projected.y - centerY) * worldSize,
  });
  const fromPoint = point(from);
  const arrivedPoint = point(arrived);
  const span = Math.hypot(arrivedPoint.x - fromPoint.x, arrivedPoint.y - fromPoint.y);
  const direction = {
    x: (arrivedPoint.x - fromPoint.x) / Math.max(span, 1),
    y: (arrivedPoint.y - fromPoint.y) / Math.max(span, 1),
  };
  const bend = Math.min(62, Math.max(24, span * 0.16));
  const control = {
    x: (fromPoint.x + arrivedPoint.x) / 2 - direction.y * bend,
    y: (fromPoint.y + arrivedPoint.y) / 2 + direction.x * bend,
  };
  const centerWorld = { x: centerX * worldSize, y: centerY * worldSize };
  const viewportLeft = centerWorld.x - CROSSING_MAP_WIDTH / 2;
  const viewportTop = centerWorld.y - CROSSING_MAP_HEIGHT / 2;
  const tileCount = 2 ** zoom;
  const tiles = [];
  for (
    let tileY = Math.floor(viewportTop / 256);
    tileY <= Math.floor((viewportTop + CROSSING_MAP_HEIGHT) / 256);
    tileY += 1
  ) {
    if (tileY < 0 || tileY >= tileCount) continue;
    for (
      let rawTileX = Math.floor(viewportLeft / 256);
      rawTileX <= Math.floor((viewportLeft + CROSSING_MAP_WIDTH) / 256);
      rawTileX += 1
    ) {
      const tileX = ((rawTileX % tileCount) + tileCount) % tileCount;
      tiles.push({
        key: `${zoom}-${rawTileX}-${tileY}`,
        url: `https://tile.openstreetmap.org/${zoom}/${tileX}/${tileY}.png`,
        x: rawTileX * 256 - viewportLeft,
        y: tileY * 256 - viewportTop,
      });
    }
  }
  const pointsAreClose = Math.abs(fromPoint.x - arrivedPoint.x) < 160;
  const fromLabelSide = pointsAreClose
    ? (fromPoint.x > 120 ? "left" : "right")
    : (fromPoint.x < CROSSING_MAP_WIDTH / 2 ? "right" : "left");
  const arrivedLabelSide = pointsAreClose
    ? (fromLabelSide === "left" ? "right" : "left")
    : (arrivedPoint.x < CROSSING_MAP_WIDTH / 2 ? "right" : "left");
  return {
    from: fromPoint,
    arrived: arrivedPoint,
    path: `M ${fromPoint.x} ${fromPoint.y} Q ${control.x} ${control.y} ${arrivedPoint.x} ${arrivedPoint.y}`,
    arrivalAngle: (Math.atan2(arrivedPoint.y - control.y, arrivedPoint.x - control.x) * 180) / Math.PI,
    arrivedLabelSide,
    fromLabelSide,
    tiles,
  };
}

function shortPlaceName(place: TravelPlace) {
  return place.name?.split(",")[0]?.trim() || "Origin";
}

function TripCrossingMap({ trip }: { trip: FeedTrip }) {
  if (!trip.crossing) return null;
  const layout = crossingMapLayout(trip.crossing);
  const fromName = shortPlaceName(trip.crossing.from);
  const arrivedName = shortPlaceName(trip.crossing.arrived);

  return (
    <section
      className="trip-crossing-card"
      aria-label={`${trip.title}: traveled from ${fromName} to ${arrivedName}`}
    >
      <div className="trip-crossing-heading">
        <div>
          <h2>{fromName} <span aria-hidden>→</span> {arrivedName}</h2>
        </div>
        <span className="trip-crossing-trip">{trip.title}</span>
      </div>
      <div className="trip-crossing-map">
        <svg
          viewBox={`0 0 ${CROSSING_MAP_WIDTH} ${CROSSING_MAP_HEIGHT}`}
          role="img"
          aria-label={`Map route from ${fromName} to ${arrivedName}`}
        >
          <rect className="trip-crossing-map-fallback" width="100%" height="100%" />
          <g className="trip-crossing-tiles" aria-hidden>
            {layout.tiles.map((tile) => (
              <image
                key={tile.key}
                href={tile.url}
                x={tile.x}
                y={tile.y}
                width="256"
                height="256"
              />
            ))}
          </g>
          <path className="trip-crossing-route-shadow" d={layout.path} />
          <path className="trip-crossing-route" d={layout.path} pathLength="1" />
          <g className="trip-crossing-origin" transform={`translate(${layout.from.x} ${layout.from.y})`}>
            <circle className="trip-crossing-point-halo" r="8" />
            <circle className="trip-crossing-point-dot" r="3.5" />
          </g>
          <g className="trip-crossing-destination" transform={`translate(${layout.arrived.x} ${layout.arrived.y})`}>
            <circle className="trip-crossing-point-halo" r="9" />
            <circle className="trip-crossing-point-dot" r="4" />
          </g>
          <g
            className="trip-crossing-arrival"
            transform={`translate(${layout.arrived.x} ${layout.arrived.y}) rotate(${layout.arrivalAngle}) translate(-13 0)`}
          >
            <path className="trip-crossing-arrival-shadow" d="M -8 -6 L 0 0 L -8 6" />
            <path className="trip-crossing-arrival-arrow" d="M -8 -6 L 0 0 L -8 6" />
          </g>
        </svg>
        <span
          className={`trip-crossing-label trip-crossing-label-${layout.fromLabelSide}`}
          style={{ left: `${(layout.from.x / CROSSING_MAP_WIDTH) * 100}%`, top: `${(layout.from.y / CROSSING_MAP_HEIGHT) * 100}%` }}
        >
          {fromName}
        </span>
        <span
          className={`trip-crossing-label trip-crossing-label-${layout.arrivedLabelSide}`}
          style={{ left: `${(layout.arrived.x / CROSSING_MAP_WIDTH) * 100}%`, top: `${(layout.arrived.y / CROSSING_MAP_HEIGHT) * 100}%` }}
        >
          {arrivedName}
        </span>
        <a
          className="trip-crossing-attribution"
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noreferrer"
        >
          © OpenStreetMap
        </a>
      </div>
    </section>
  );
}

function JournalFeed({ site }: { site: SiteMode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [catalog, setCatalog] = useState<FeedCatalog>({ albums: [], trips: [] });
  const [openAlbumId, setOpenAlbumId] = useState<string | null>(null);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [tripFeedPrefs, setTripFeedPrefs] = useState<Record<string, TripFeedPrefs>>({});
  const [collectionFeedViews, setCollectionFeedViews] = useState<Record<string, FeedViewMode>>({});
  const [feedViewMenuOpen, setFeedViewMenuOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const allTrips = useMemo(() => catalogAllTrips(catalog), [catalog]);

  const load = async () => {
    try {
      const [profileData, postsData, tripsData] = await Promise.all([
        api<Profile>("/api/profile"),
        api<{ posts: Post[] }>(`${site.postsListUrl}?limit=50`),
        api<FeedCatalog>(site.tripsListUrl),
      ]);
      setProfile(profileData);
      setPosts(postsData.posts);
      setCatalog({ albums: tripsData.albums ?? [], trips: tripsData.trips ?? [] });
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // The effect hydrates this route from the public API; state updates occur after I/O.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load(); }, [site.postsListUrl, site.tripsListUrl]);

  const tripBrowse = catalog.albums.length > 0 || catalog.trips.length > 0;

  useEffect(() => {
    if (!tripBrowse) {
      setSelectedTripId(null);
      setOpenAlbumId(null);
      return;
    }
    const featuredAlbum = catalog.albums.find((album) => album.featured && album.trips.length > 0);
    if (featuredAlbum) {
      setOpenAlbumId(featuredAlbum.id);
      setSelectedTripId(null);
      return;
    }
    setOpenAlbumId(null);
    setSelectedTripId(null);
  }, [catalog.albums, tripBrowse]);

  const activeAlbum = useMemo(
    () => (openAlbumId ? catalog.albums.find((album) => album.id === openAlbumId) : undefined),
    [catalog.albums, openAlbumId],
  );

  const activeTrip = useMemo(
    () => (selectedTripId ? allTrips.find((trip) => trip.id === selectedTripId) : undefined),
    [allTrips, selectedTripId],
  );

  const activeTripPrefs = useMemo(() => {
    if (!selectedTripId) return defaultTripFeedPrefs();
    return tripFeedPrefs[selectedTripId] ?? defaultTripFeedPrefs();
  }, [selectedTripId, tripFeedPrefs]);

  const tripFeedView = activeTripPrefs.view;
  const chapterId = activeTripPrefs.chapterId;
  const collectionFeedView = activeAlbum ? (collectionFeedViews[activeAlbum.id] ?? "timeline") : "timeline";

  const tripPosts = useMemo(() => {
    if (!selectedTripId) return [];
    return postsForTrip(posts, selectedTripId);
  }, [posts, selectedTripId]);

  const collectionPosts = useMemo(() => {
    if (!activeAlbum) return [];
    const tripIds = new Set(activeAlbum.trips.map((trip) => trip.id));
    return posts.filter((post) => {
      const tripId = postTripId(post);
      return tripId ? tripIds.has(tripId) : false;
    });
  }, [activeAlbum, posts]);

  const collectionTripGroups = useMemo(() => {
    if (!activeAlbum) return [];
    return activeAlbum.trips
      .map((trip) => ({ trip, posts: postsForTrip(posts, trip.id) }))
      .filter((group) => group.posts.length > 0);
  }, [activeAlbum, posts]);

  const patchTripPrefs = (tripId: string, patch: Partial<TripFeedPrefs>) => {
    setTripFeedPrefs((prev) => ({
      ...prev,
      [tripId]: { ...defaultTripFeedPrefs(), ...prev[tripId], ...patch },
    }));
  };

  const groupedFeedPosts = useMemo(() => {
    if (chapterId === ALL_CHAPTERS) return tripPosts;
    return tripPosts.filter((post) => post.chapter?.id === chapterId);
  }, [chapterId, tripPosts]);

  const feedRule = useMemo(() => {
    if (!tripBrowse) return site.preview ? "Preview feed" : "Latest places";
    if (activeTrip) return activeTrip.title;
    if (activeAlbum) return activeAlbum.title;
    return site.preview ? "Preview feed" : "Latest places";
  }, [activeAlbum, activeTrip, site.preview, tripBrowse]);

  const feedRuleDetail = useMemo(() => {
    if (!tripBrowse) return null;
    if (activeTrip) {
      if (tripFeedView === "timeline") return "Timeline · newest first";
      if (chapterId === ALL_CHAPTERS) return "By chapter · all entries";
      const chapter = activeTrip.chapters.find((item) => item.id === chapterId);
      return chapter?.title ?? "By chapter";
    }
    if (activeAlbum) return collectionFeedView === "timeline" ? "Timeline · newest first" : "By trip";
    return "Timeline · newest first";
  }, [activeAlbum, activeTrip, chapterId, collectionFeedView, tripBrowse, tripFeedView]);

  useEffect(() => {
    setFeedViewMenuOpen(false);
  }, [openAlbumId, selectedTripId]);

  const onTripSelect = (tripId: string) => {
    setSelectedTripId(tripId);
  };

  const onOpenAlbum = (albumId: string) => {
    setOpenAlbumId(albumId);
    setSelectedTripId(null);
  };

  const onCloseAlbum = () => {
    setOpenAlbumId(null);
    setSelectedTripId(null);
  };

  const onSelectTimeline = () => {
    setSelectedTripId(null);
  };

  const onFeedViewChange = (view: FeedViewMode) => {
    if (selectedTripId) {
      patchTripPrefs(selectedTripId, {
        view,
        chapterId: view === "grouped" ? ALL_CHAPTERS : activeTripPrefs.chapterId,
      });
      return;
    }
    if (activeAlbum) {
      setCollectionFeedViews((current) => ({ ...current, [activeAlbum.id]: view }));
    }
  };

  const onChapterChange = (nextChapterId: string) => {
    if (!selectedTripId) return;
    patchTripPrefs(selectedTripId, { chapterId: nextChapterId });
  };

  const canGroupByChapter = Boolean(activeTrip && activeTrip.chapters.length > 0);

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    if (!selectedTripId || canGroupByChapter || tripFeedView !== "grouped") return;
    patchTripPrefs(selectedTripId, { view: "timeline" });
  }, [canGroupByChapter, selectedTripId, tripFeedView]);

  if (loading) return <Loading />;
  if (error || !profile) return <ErrorState message={error} retry={load} />;

  const showTripFeed = tripBrowse && Boolean(activeTrip);
  const showCollectionFeed = tripBrowse && Boolean(activeAlbum) && !activeTrip;
  const timelineFeed = showTripFeed ? tripPosts : showCollectionFeed ? collectionPosts : posts;
  const showGroupedTripFeed = showTripFeed && canGroupByChapter && tripFeedView === "grouped";
  const showGroupedCollectionFeed = showCollectionFeed && collectionFeedView === "grouped";
  const canGroupCollection = Boolean(activeAlbum && activeAlbum.trips.length > 1);
  const activeFeedView = showTripFeed ? tripFeedView : collectionFeedView;

  return (
    <>
      {site.preview && <PreviewSiteBanner />}
      <header className="profile-hero">
        <div className="profile-masthead">
          <Avatar profile={profile} large />
          <h1>
            <ProfileDisplayName displayName={profile.displayName} hero />
          </h1>
          {profile.tagline ? <p className="profile-status">{profile.tagline}</p> : null}
          {profile.currentLocation?.name ? (
            <p
              className="current-location current-location-traveling"
              aria-live="polite"
              aria-label={`Currently traveling · ${profile.currentLocation.name}`}
            >
              <Icon name="mapPin" size={18} />
              <span>{profile.currentLocation.name}</span>
            </p>
          ) : null}
          {profile.bio ? <ProfileBio bio={profile.bio} /> : null}
          {tripBrowse ? (
            <div className="trip-feed-controls">
              <StoryCatalogSelector
                catalog={catalog}
                posts={posts}
                openAlbumId={openAlbumId}
                selectedTripId={selectedTripId}
                onOpenAlbum={onOpenAlbum}
                onCloseAlbum={onCloseAlbum}
                onSelectTrip={onTripSelect}
              />
            </div>
          ) : null}
        </div>
        {profile.links.length > 0 && (
          <nav className="profile-links">
            {profile.links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
          </nav>
        )}
      </header>
      <main className="page-shell feed-page">
      <div className="feed-rule">
        <div className="feed-rule-scope">
          {showTripFeed ? (
            <button
              type="button"
              className="feed-rule-clear"
              aria-label={activeAlbum ? `Show all trips in ${activeAlbum.title}` : "Show full timeline"}
              title={activeAlbum ? "Show all trips" : "Show full timeline"}
              onClick={onSelectTimeline}
            >
              <span className="feed-rule-clear-mark" aria-hidden>
                <Icon name="arrow" size={11} />
              </span>
            </button>
          ) : null}
          <span>{feedRule}</span>
        </div>
        {((showTripFeed && canGroupByChapter) || (showCollectionFeed && canGroupCollection)) && feedRuleDetail ? (
          <FeedViewRuleMenu
            open={feedViewMenuOpen}
            onOpenChange={setFeedViewMenuOpen}
            view={activeFeedView}
            detailLabel={feedRuleDetail}
            scope={showCollectionFeed ? "collection" : "trip"}
            onViewChange={onFeedViewChange}
          />
        ) : feedRuleDetail ? (
          <span className="feed-rule-detail">{feedRuleDetail}</span>
        ) : (
          <Icon name="grid" size={16} />
        )}
      </div>
      {showGroupedTripFeed && activeTrip && activeTrip.chapters.length > 0 ? (
        <FeedChapterBar
          chapterId={chapterId}
          chapters={activeTrip.chapters}
          onChapterChange={onChapterChange}
        />
      ) : null}
      {showTripFeed && activeTrip ? <TripCrossingMap trip={activeTrip} /> : null}
      {posts.length === 0 ? (
        <div className="state-card"><p className="eyebrow">The road starts here</p><h2>No journals yet.</h2><p>{site.preview ? "Save a journal from admin to see it here before publishing." : "Visit the private admin page to publish your first journal."}</p></div>
      ) : showGroupedCollectionFeed ? (
        <section className="feed-list feed-list-grouped">
          {collectionTripGroups.map(({ trip, posts: groupPosts }) => (
            <section className="feed-chapter-block" aria-labelledby={`trip-group-${trip.id}`} key={trip.id}>
              <header className="feed-chapter-heading">
                <h2 id={`trip-group-${trip.id}`}>{trip.title}</h2>
                <p>{groupPosts.length} {groupPosts.length === 1 ? "entry" : "entries"}</p>
              </header>
              <TripCrossingMap trip={trip} />
              <div className="feed-list feed-list-nested">
                {groupPosts.map((post) => (
                  <PostCard post={post} profile={profile} site={site} showJourneyGrouping={false} key={post.id} />
                ))}
              </div>
            </section>
          ))}
        </section>
      ) : showGroupedTripFeed ? (
        <section className="feed-list">
          {groupedFeedPosts.map((post) => (
            <PostCard post={post} profile={profile} site={site} showJourneyGrouping={false} key={post.id} />
          ))}
        </section>
      ) : (
        <section className="feed-list">
          {timelineFeed.map((post) => <PostCard post={post} profile={profile} site={site} key={post.id} />)}
        </section>
      )}
      {site.preview && (
        <p className="preview-footer-link">
          <Link to="/">← Live journal</Link>
        </p>
      )}
      </main>
    </>
  );
}

function Feed() {
  return <JournalFeed site={liveSite} />;
}

function PreviewFeed() {
  return <JournalFeed site={previewSite} />;
}

function TravelMap({ post }: { post: Post }) {
  if (post.location?.lat == null || post.location?.lng == null) return null;
  const { lat, lng } = post.location;
  const mapUrl = `https://www.openstreetmap.org/export/embed.html?bbox=${lng - .025}%2C${lat - .015}%2C${lng + .025}%2C${lat + .015}&layer=mapnik&marker=${lat}%2C${lng}`;
  const openUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=13/${lat}/${lng}`;
  return (
    <section className="map-card">
      <iframe src={mapUrl} title={`Map of ${post.location.name || "photo location"}`} loading="lazy" />
      <a href={openUrl} target="_blank" rel="noreferrer">Open full map <span>↗</span></a>
    </section>
  );
}

function JourneyDetail({ site }: { site: SiteMode }) {
  const { slug } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");
  const postUrl = site.preview ? `/api/preview/posts/${slug}` : `/api/posts/${slug}`;
  const journalHome = site.preview ? "/preview" : "/";

  useEffect(() => {
    Promise.all([api<Post>(postUrl), api<Profile>("/api/profile")])
      .then(([p, pr]) => { setPost(p); setProfile(pr); })
      .catch((err) => setError(err.message));
  }, [slug, postUrl]);
  if (error) return <ErrorState message={error} />;
  if (!post || !profile) return <Loading />;

  const grouping = journeyGroupingLabel(post);

  return (
    <main className="detail-page">
      {site.preview && <PreviewSiteBanner />}
      {post.isDraft && <p className="draft-pill detail-draft-pill">Draft — not visible on the live site until you publish</p>}
      <nav className="detail-nav">
        <Link to={journalHome}><Icon name="arrow" /> <span>Journal</span></Link>
        <button onClick={() => navigator.share?.({ title: post.location?.name, url: location.href })}>
          <Icon name="share" />
        </button>
      </nav>
      <div className="detail-layout">
        <Carousel images={post.images} />
        <div className="detail-copy">
          <p className="eyebrow">{formatDate(post.takenAt)}</p>
          {grouping && <p className="journey-grouping detail-grouping">{grouping}</p>}
          <h1>{post.location?.name || "A place worth remembering"}</h1>
          <PostStory post={post} className="detail-caption rich-story" />
          <div className="author-line"><Avatar profile={profile} /><span>Photographed by <strong>{profile.displayName}</strong></span></div>
          <TravelMap post={post} />
        </div>
      </div>
    </main>
  );
}

function PostDetail() {
  return <JourneyDetail site={liveSite} />;
}

function PreviewPostDetail() {
  return <JourneyDetail site={previewSite} />;
}

function AdminGate() {
  const [state, setState] = useState<"checking" | "yes" | "no">("checking");
  const location = useLocation();
  useEffect(() => {
    api<{ authenticated: boolean }>("/api/auth/me")
      .then((data) => setState(data.authenticated ? "yes" : "no"))
      .catch(() => setState("no"));
  }, [location.pathname]);
  if (state === "checking") return <Loading />;
  if (state === "no") return <Navigate to="/admin/login" replace />;
  return <Outlet />;
}

function Login() {
  const navigate = useNavigate();
  const [secret, setSecret] = useState("");
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret }),
      });
      navigate("/admin");
    } catch (err) { setError(err instanceof Error ? err.message : "Could not sign in"); }
  };
  return (
    <main className="admin-login-page">
      <section className="login-card">
        <Link to="/" className="back-link"><Icon name="arrow" size={18} /> Back to journal</Link>
        <div className="login-mark">P</div>
        <p className="eyebrow">Private access</p>
        <h1>Owner studio</h1>
        <p>Publish and manage your travel stories.</p>
        <form onSubmit={submit}>
          <label>Admin secret<input type="password" value={secret} onChange={(e) => setSecret(e.target.value)} autoFocus /></label>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" type="submit">Enter studio</button>
        </form>
      </section>
    </main>
  );
}

type AdminPost = {
  id: string;
  slug: string;
  caption: string;
  takenAt: string;
  placeName: string | null;
  isDraft: boolean;
  thumbnail?: string;
  tripTitle?: string | null;
  chapterTitle?: string | null;
};

function JourneyOrganizationFields({
  tripId,
  chapterId,
  albumId,
  onTripIdChange,
  onChapterIdChange,
  onAlbumIdChange,
}: {
  tripId: string;
  chapterId: string;
  albumId: string;
  onTripIdChange: (id: string) => void;
  onChapterIdChange: (id: string) => void;
  onAlbumIdChange: (id: string) => void;
}) {
  const [trips, setTrips] = useState<AdminTrip[]>([]);
  const [albums, setAlbums] = useState<AdminAlbum[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgError, setOrgError] = useState("");
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [newAlbumTitle, setNewAlbumTitle] = useState("");
  const [addingTrip, setAddingTrip] = useState(false);
  const [addingChapter, setAddingChapter] = useState(false);
  const [addingAlbum, setAddingAlbum] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromPlace, setFromPlace] = useState("");
  const [fromLat, setFromLat] = useState("");
  const [fromLng, setFromLng] = useState("");
  const [arrivedPlace, setArrivedPlace] = useState("");
  const [arrivedLat, setArrivedLat] = useState("");
  const [arrivedLng, setArrivedLng] = useState("");
  const [crossingSaved, setCrossingSaved] = useState(false);

  const reloadTrips = async () => {
    const data = await api<{ trips: AdminTrip[] }>("/api/admin/trips");
    setTrips(data.trips);
  };

  const reloadAlbums = async () => {
    const data = await api<{ albums: AdminAlbum[] }>("/api/admin/albums");
    setAlbums(data.albums);
  };

  useEffect(() => {
    void Promise.all([reloadTrips(), reloadAlbums()])
      .catch((err) => setOrgError(err instanceof Error ? err.message : "Could not load structure"))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (loading || !chapterId || tripId) return;
    for (const trip of trips) {
      if (trip.chapters.some((chapter) => chapter.id === chapterId)) {
        onTripIdChange(trip.id);
        return;
      }
    }
  }, [chapterId, loading, onTripIdChange, tripId, trips]);

  useEffect(() => {
    if (loading || !tripId) return;
    const trip = trips.find((item) => item.id === tripId);
    onAlbumIdChange(trip?.albumId ?? "");
  }, [loading, onAlbumIdChange, tripId, trips]);

  const chapters = useMemo(() => {
    if (!tripId) return [];
    return trips.find((trip) => trip.id === tripId)?.chapters ?? [];
  }, [tripId, trips]);

  const selectedTrip = useMemo(
    () => trips.find((trip) => trip.id === tripId),
    [tripId, trips],
  );

  // The crossing form is reset when the selected trip changes or is reloaded.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    const crossing = selectedTrip?.crossing;
    // oxlint-disable-next-line react/set-state-in-effect
    setFromPlace(crossing?.from.name ?? "");
    setFromLat(crossing ? String(crossing.from.lat) : "");
    setFromLng(crossing ? String(crossing.from.lng) : "");
    setArrivedPlace(crossing?.arrived.name ?? "");
    setArrivedLat(crossing ? String(crossing.arrived.lat) : "");
    setArrivedLng(crossing ? String(crossing.arrived.lng) : "");
  }, [selectedTrip]);

  const persistTripAlbum = async (nextTripId: string, nextAlbumId: string) => {
    await api(`/api/admin/trips/${nextTripId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ albumId: nextAlbumId || null }),
    });
    await reloadTrips();
  };

  const saveTripCrossing = async (clear = false) => {
    if (!tripId) return;
    setBusy(true);
    setOrgError("");
    setCrossingSaved(false);
    try {
      await api(`/api/admin/trips/${tripId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromPlaceName: clear ? null : fromPlace,
          fromLat: clear ? null : fromLat || null,
          fromLng: clear ? null : fromLng || null,
          arrivedPlaceName: clear ? null : arrivedPlace,
          arrivedLat: clear ? null : arrivedLat || null,
          arrivedLng: clear ? null : arrivedLng || null,
        }),
      });
      await reloadTrips();
      setCrossingSaved(true);
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Could not save crossing");
    } finally {
      setBusy(false);
    }
  };

  const createAlbum = async () => {
    const title = newAlbumTitle.trim();
    if (!title) return;
    setBusy(true);
    setOrgError("");
    try {
      const created = await api<AdminAlbum>("/api/admin/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await reloadAlbums();
      onAlbumIdChange(created.id);
      if (tripId) await persistTripAlbum(tripId, created.id);
      setAddingAlbum(false);
      setNewAlbumTitle("");
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Could not create collection");
    } finally {
      setBusy(false);
    }
  };

  const createTrip = async () => {
    const title = newTripTitle.trim();
    if (!title) return;
    setBusy(true);
    setOrgError("");
    try {
      const created = await api<AdminTrip>("/api/admin/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, albumId: albumId || null }),
      });
      await reloadTrips();
      onTripIdChange(created.id);
      onAlbumIdChange(created.albumId ?? albumId);
      onChapterIdChange("");
      setAddingTrip(false);
      setNewTripTitle("");
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Could not create trip");
    } finally {
      setBusy(false);
    }
  };

  const createChapter = async () => {
    const title = newChapterTitle.trim();
    if (!tripId || !title) return;
    setBusy(true);
    setOrgError("");
    try {
      const created = await api<AdminChapter>("/api/admin/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tripId, title }),
      });
      await reloadTrips();
      onChapterIdChange(created.id);
      setAddingChapter(false);
      setNewChapterTitle("");
    } catch (err) {
      setOrgError(err instanceof Error ? err.message : "Could not create journey");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="organization-fields">
      <p className="eyebrow">Hierarchy</p>
      <p className="form-hint">
        Optional. Collection → Trip → Journey → Journal. A trip can stand alone; add a journey when you want finer grouping within the trip.
      </p>
      {loading ? (
        <p className="form-hint">Loading trips…</p>
      ) : (
        <>
          <label>
            Trip
            <select
              value={tripId}
              onChange={(e) => {
                onTripIdChange(e.target.value);
                onChapterIdChange("");
                setCrossingSaved(false);
              }}
            >
              <option value="">None</option>
              {trips.map((trip) => (
                <option key={trip.id} value={trip.id}>
                  {trip.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Collection
            <select
              value={albumId}
              disabled={!tripId || busy}
              onChange={(e) => {
                const next = e.target.value;
                onAlbumIdChange(next);
                if (tripId) void persistTripAlbum(tripId, next).catch((err) => setOrgError(err instanceof Error ? err.message : "Could not save collection"));
              }}
            >
              <option value="">{tripId ? "None (shown on home row)" : "Choose a trip first"}</option>
              {albums.map((album) => (
                <option key={album.id} value={album.id}>
                  {album.title}
                  {album.tripCount > 0 ? ` · ${album.tripCount} trips` : ""}
                </option>
              ))}
            </select>
          </label>
          <p className="form-hint">Collections group trips in the journal selector. Each trip can belong to one collection.</p>
          {tripId ? (
            <div className="trip-crossing-editor">
              <div>
                <p className="eyebrow">Trip crossing</p>
                <p className="form-hint">Shown once above this trip’s journals, not as a separate post.</p>
              </div>
              <label>
                From
                <PlaceInput
                  value={fromPlace}
                  onChange={(value) => {
                    setFromPlace(value);
                    setFromLat("");
                    setFromLng("");
                    setCrossingSaved(false);
                  }}
                  onPick={(place) => {
                    setFromPlace(place.name);
                    setFromLat(String(place.lat));
                    setFromLng(String(place.lng));
                  }}
                  placeholder="Vancouver, Canada"
                />
              </label>
              <label>
                Arrived
                <PlaceInput
                  value={arrivedPlace}
                  onChange={(value) => {
                    setArrivedPlace(value);
                    setArrivedLat("");
                    setArrivedLng("");
                    setCrossingSaved(false);
                  }}
                  onPick={(place) => {
                    setArrivedPlace(place.name);
                    setArrivedLat(String(place.lat));
                    setArrivedLng(String(place.lng));
                  }}
                  placeholder="Auckland, New Zealand"
                />
              </label>
              {selectedTrip?.crossing ? (
                <div className="trip-crossing-admin-preview">
                  <TripCrossingMap
                    trip={{
                      id: selectedTrip.id,
                      slug: selectedTrip.slug,
                      title: selectedTrip.title,
                      crossing: selectedTrip.crossing,
                      chapters: [],
                    }}
                  />
                </div>
              ) : null}
              <div className="trip-crossing-editor-actions">
                <button type="button" className="primary-button" disabled={busy} onClick={() => void saveTripCrossing()}>
                  {busy ? "Saving…" : "Save crossing"}
                </button>
                {(fromPlace || arrivedPlace) ? (
                  <button
                    type="button"
                    className="organization-text-button"
                    disabled={busy}
                    onClick={() => void saveTripCrossing(true)}
                  >
                    Remove crossing
                  </button>
                ) : null}
              </div>
              {crossingSaved ? <p className="success">Crossing saved.</p> : null}
            </div>
          ) : null}
          {!addingAlbum ? (
            <button type="button" className="organization-text-button" onClick={() => setAddingAlbum(true)}>
              + New collection
            </button>
          ) : (
            <div className="organization-inline-add">
              <label>
                Collection title
                <input value={newAlbumTitle} onChange={(e) => setNewAlbumTitle(e.target.value)} placeholder="Africa" />
              </label>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void createAlbum()}>
                Add
              </button>
              <button
                type="button"
                className="organization-text-button"
                onClick={() => {
                  setAddingAlbum(false);
                  setNewAlbumTitle("");
                }}
              >
                Cancel
              </button>
            </div>
          )}
          {!addingTrip ? (
            <button type="button" className="organization-text-button" onClick={() => setAddingTrip(true)}>
              + New trip
            </button>
          ) : (
            <div className="organization-inline-add">
              <label>
                Trip title
                <input
                  value={newTripTitle}
                  onChange={(e) => setNewTripTitle(e.target.value)}
                  placeholder="Japan 2024"
                />
              </label>
              <button type="button" className="primary-button" disabled={busy} onClick={() => void createTrip()}>
                Add
              </button>
              <button
                type="button"
                className="organization-text-button"
                onClick={() => {
                  setAddingTrip(false);
                  setNewTripTitle("");
                }}
              >
                Cancel
              </button>
            </div>
          )}
          <label>
            Journey
            <select
              value={chapterId}
              disabled={!tripId}
              onChange={(e) => onChapterIdChange(e.target.value)}
            >
              <option value="">{tripId ? "None" : "Choose a trip first"}</option>
              {chapters.map((chapter) => (
                <option key={chapter.id} value={chapter.id}>
                  {chapter.title}
                </option>
              ))}
            </select>
          </label>
          {tripId &&
            (!addingChapter ? (
              <button type="button" className="organization-text-button" onClick={() => setAddingChapter(true)}>
                + New journey
              </button>
            ) : (
              <div className="organization-inline-add">
                <label>
                  Journey title
                  <input
                    value={newChapterTitle}
                    onChange={(e) => setNewChapterTitle(e.target.value)}
                    placeholder="Before we go"
                  />
                </label>
                <button type="button" className="primary-button" disabled={busy} onClick={() => void createChapter()}>
                  Add
                </button>
                <button
                  type="button"
                  className="organization-text-button"
                  onClick={() => {
                    setAddingChapter(false);
                    setNewChapterTitle("");
                  }}
                >
                  Cancel
                </button>
              </div>
            ))}
        </>
      )}
      {orgError && <p className="form-error">{orgError}</p>}
    </div>
  );
}

function AdminNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <>
      <Link to="/admin" onClick={onNavigate}>
        Journals
      </Link>
      <Link to="/admin/new" onClick={onNavigate}>
        New journal
      </Link>
      <Link to="/admin/albums" onClick={onNavigate}>
        Collections
      </Link>
      <Link to="/admin/profile" onClick={onNavigate}>
        Profile
      </Link>
      <a href="/" target="_blank" rel="noreferrer" onClick={onNavigate}>
        Main site
      </a>
    </>
  );
}

function AdminLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [menuOpen]);

  const closeMenu = () => setMenuOpen(false);
  const signOut = async () => {
    closeMenu();
    await api("/api/auth/logout", { method: "POST" });
    navigate("/");
  };

  return (
    <div className={`admin-shell${menuOpen ? " admin-menu-open" : ""}`}>
      <aside className="admin-sidebar">
        <Link to="/admin" className="wordmark">
          <span>P</span>
          <BrandName />
        </Link>
        <nav>
          <AdminNavLinks />
        </nav>
        <button type="button" onClick={() => void signOut()}>
          Sign out
        </button>
      </aside>
      <div className="admin-mobile-drawer" aria-hidden={!menuOpen}>
        <button
          type="button"
          className="admin-drawer-backdrop"
          aria-label="Close menu"
          onClick={closeMenu}
          tabIndex={menuOpen ? 0 : -1}
        />
        <aside
          id="admin-mobile-drawer"
          className="admin-drawer-panel"
          role="dialog"
          aria-modal="true"
          aria-label="Admin menu"
          aria-hidden={!menuOpen}
        >
          <Link to="/admin" className="wordmark" onClick={closeMenu}>
            <span>P</span>
            <BrandName />
          </Link>
          <nav>
            <AdminNavLinks onNavigate={closeMenu} />
          </nav>
          <button type="button" onClick={() => void signOut()}>
            Sign out
          </button>
        </aside>
      </div>
      <div className="admin-mobile-nav">
        <button
          type="button"
          className="admin-menu-button"
          aria-expanded={menuOpen}
          aria-controls="admin-mobile-drawer"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <Icon name={menuOpen ? "x" : "menu"} size={22} />
        </button>
        <Link to="/admin" className="wordmark">
          <span>P</span>
          <BrandName />
        </Link>
        <Link to="/admin/new" className="circle-button" aria-label="New journal">
          <Icon name="plus" />
        </Link>
      </div>
      <Outlet />
    </div>
  );
}

function AdminAlbums() {
  const [albums, setAlbums] = useState<AdminAlbum[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = () =>
    api<{ albums: AdminAlbum[] }>("/api/admin/albums")
      .then((data) => setAlbums(data.albums))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load collections"))
      .finally(() => setLoading(false));

  useEffect(() => {
    void load();
  }, []);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    const nextTitle = title.trim();
    if (!nextTitle) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/admin/albums", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: nextTitle }),
      });
      setTitle("");
      setLoading(true);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create collection");
    } finally {
      setBusy(false);
    }
  };

  const setFeatured = async (album: AdminAlbum, featured: boolean) => {
    setError("");
    setAlbums((current) =>
      current.map((item) => ({
        ...item,
        featured: featured ? item.id === album.id : item.id === album.id ? false : item.featured,
      })),
    );
    try {
      const updated = await api<AdminAlbum>(`/api/admin/albums/${album.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ featured }),
      });
      setAlbums((current) =>
        current.map((item) => {
          if (item.id === updated.id) return updated;
          if (featured) return { ...item, featured: false };
          return item;
        }),
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update collection");
      await load();
    }
  };

  return (
    <main className="admin-main">
      <header className="admin-title">
        <div>
          <p className="eyebrow">Grouping</p>
          <h1>Collections</h1>
        </div>
      </header>
      <p className="form-hint" style={{ marginBottom: 20, maxWidth: 520 }}>
        Collections appear as stacked chips on the journal home. Assign trips to a collection when creating or editing a journal. Mark one collection as featured to open it by default on the main page.
      </p>
      <form className="organization-inline-add admin-album-create" onSubmit={create}>
        <label>
          New collection
          <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Africa" />
        </label>
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Creating…" : "Create collection"}
        </button>
      </form>
      {error ? <p className="form-error">{error}</p> : null}
      {loading ? (
        <div className="skeleton post-skeleton" />
      ) : albums.length === 0 ? (
        <div className="state-card">
          <h2>No collections yet.</h2>
          <p>Create one above, then link trips from a journal’s hierarchy fields.</p>
        </div>
      ) : (
        <ul className="admin-album-list">
          {albums.map((album) => (
            <li key={album.id}>
              <div className="admin-album-row-main">
                <strong>{album.title}</strong>
                <span className="admin-album-count">
                  {album.tripCount} trip{album.tripCount === 1 ? "" : "s"}
                </span>
              </div>
              <label className="admin-album-featured">
                <input
                  type="checkbox"
                  checked={Boolean(album.featured)}
                  onChange={(e) => void setFeatured(album, e.target.checked)}
                />
                Featured
              </label>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}

function AdminDashboard() {
  const [posts, setPosts] = useState<AdminPost[]>([]);
  const [loading, setLoading] = useState(true);
  const load = () => api<{ posts: AdminPost[] }>("/api/admin/posts").then((d) => setPosts(d.posts)).finally(() => setLoading(false));
  useEffect(() => { void load(); }, []);
  const remove = async (post: AdminPost) => {
    if (!confirm(`Delete “${post.placeName || post.slug}”? This also deletes its images.`)) return;
    await api(`/api/posts/${post.id}`, { method: "DELETE" });
    await load();
  };
  const publish = async (post: AdminPost) => {
    if (!confirm(`Publish “${post.placeName || post.slug}” to the live site?`)) return;
    await api<Post>(`/api/posts/${post.id}/publish`, { method: "POST" });
    await load();
  };
  return (
    <main className="admin-main">
      <header className="admin-title">
        <div><p className="eyebrow">Your archive</p><h1>Journals</h1></div>
        <div className="admin-title-actions">
          <a className="quiet-link" href="/preview" target="_blank" rel="noreferrer">Open preview site</a>
          <Link to="/admin/new" className="primary-button"><Icon name="plus" size={18} /> New journal</Link>
        </div>
      </header>
      {loading ? <div className="skeleton post-skeleton" /> : posts.length === 0 ? (
        <div className="state-card"><h2>No journals yet.</h2><Link to="/admin/new" className="primary-button">Add first journal</Link></div>
      ) : (
        <div className="admin-post-list">
          {posts.map((post) => (
            <article key={post.id} className={post.isDraft ? "admin-post-draft" : ""}>
              <img src={post.thumbnail} alt="" />
              <div>
                <strong>{post.placeName || "Untitled journal"}</strong>
                {post.isDraft ? <span className="status-pill status-draft">Preview only</span> : <span className="status-pill status-live">Live</span>}
                <span>{formatDate(post.takenAt)}</span>
                {(post.tripTitle || post.chapterTitle) && (
                  <span className="admin-post-grouping">
                    {[post.tripTitle, post.chapterTitle].filter(Boolean).join(" · ")}
                  </span>
                )}
                <p>{storyHtmlToPlainText(post.caption) || post.caption}</p>
              </div>
              <div className="admin-actions">
                <Link to={`/admin/posts/${post.slug}/edit`}>Edit</Link>
                <Link to={`/preview/p/${post.slug}`} target="_blank" rel="noreferrer">Preview</Link>
                {post.isDraft ? (
                  <button type="button" className="publish-action" onClick={() => publish(post)}>Publish</button>
                ) : (
                  <Link to={`/p/${post.slug}`}>View live</Link>
                )}
                <button type="button" onClick={() => remove(post)}>Delete</button>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}

function NewPost() {
  const navigate = useNavigate();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [contentHtml, setContentHtml] = useState("");
  const [place, setPlace] = useState("");
  const [takenAt, setTakenAt] = useState("");
  const [publishedAt, setPublishedAt] = useState(datetimeLocalNow);
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tripId, setTripId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [albumId, setAlbumId] = useState("");
  const [fileExif, setFileExif] = useState<FileExif[]>([]);
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

  useEffect(() => {
    if (!files.length) {
      setFileExif([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const parsed = await Promise.all(files.map(readFileExif));
      if (cancelled) return;
      setFileExif(parsed);
      const withGps = parsed.find((item) => item.hasLocation && item.lat != null && item.lng != null);
      if (withGps) {
        setLat((prev) => prev || String(withGps.lat));
        setLng((prev) => prev || String(withGps.lng));
        try {
          const name = await resolvePlaceName(withGps.lat!, withGps.lng!);
          if (!cancelled && name) setPlace((prev) => prev || name);
        } catch {
          /* place can be entered manually */
        }
      }
      const withDate = parsed.find((item) => item.hasDate && item.takenAt);
      if (withDate?.takenAt) {
        setTakenAt((prev) => prev || new Date(withDate.takenAt!).toISOString().slice(0, 16));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [files]);

  const useMyLocation = () => {
    setLocating(true);
    setLocError("");
    void detectCurrentLocation()
      .then(({ lat: nextLat, lng: nextLng, name }) => {
        setLat(String(nextLat));
        setLng(String(nextLng));
        if (name) setPlace(name);
      })
      .catch((err) => setLocError(err instanceof Error ? err.message : "Could not detect location"))
      .finally(() => setLocating(false));
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!files.length) { setError("Choose at least one photo."); return; }
    setBusy(true); setError("");
    const data = new FormData();
    files.forEach((file) => data.append("images", file));
    data.append("contentHtml", contentHtml);
    // Older APIs only persist `caption`; store HTML there so formatting survives.
    data.append("caption", contentHtml || "");
    data.append("placeName", place);
    if (takenAt) data.append("takenAt", new Date(takenAt).toISOString());
    data.append("publishedAt", new Date(publishedAt).toISOString());
    if (lat) data.append("lat", lat);
    if (lng) data.append("lng", lng);
    data.append("tripId", tripId);
    data.append("chapterId", chapterId);
    try {
      if (tripId) {
        await api(`/api/admin/trips/${tripId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ albumId: albumId || null }),
        });
      }
      const post = await api<Post>("/api/posts", { method: "POST", body: data });
      if (tripId && !postTripId(post)) {
        setError("Trip didn't save. Try saving again.");
        setBusy(false);
        return;
      }
      if (chapterId && !post.chapter) {
        setError("Journey didn't save. Try saving again.");
        setBusy(false);
        return;
      }
      navigate(`/preview/p/${post.slug}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save"); setBusy(false); }
  };
  return (
    <main className="admin-main editor-page">
      <header className="admin-title"><div><p className="eyebrow">Add to the archive</p><h1>New journal</h1></div></header>
      <form className="post-editor" onSubmit={submit}>
        <section className="upload-panel">
          <input ref={inputRef} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 10))} />
          {previews.length ? (
            <>
              <div className="preview-main photo-frame">
                <img src={previews[0]!.url} alt="Selected preview" />
                {fileExif[0] && <PhotoMetadataOverlay flags={fileExif[0]} />}
              </div>
              <div className="preview-strip">
                {previews.map(({ file, url }, index) => (
                  <div className="photo-frame" key={file.name + index}>
                    <img src={url} alt={`Selected ${index + 1}`} />
                    {fileExif[index] && <PhotoMetadataOverlay flags={fileExif[index]!} />}
                  </div>
                ))}
                <button type="button" onClick={() => inputRef.current?.click()}><Icon name="plus" /></button>
              </div>
            </>
          ) : (
            <button type="button" className="drop-zone" onClick={() => inputRef.current?.click()}><Icon name="plus" size={28} /><strong>Select your photographs</strong><span>JPEG, PNG or WebP · up to 10 images</span></button>
          )}
        </section>
        <section className="metadata-panel">
          <JourneyOrganizationFields
            tripId={tripId}
            chapterId={chapterId}
            albumId={albumId}
            onTripIdChange={setTripId}
            onChapterIdChange={setChapterId}
            onAlbumIdChange={setAlbumId}
          />
          <label>
            Place
            <PlaceInput
              value={place}
              onChange={setPlace}
              onPick={(picked) => {
                setPlace(picked.name);
                setLat(String(picked.lat));
                setLng(String(picked.lng));
              }}
              placeholder="Kyoto, Japan"
            />
          </label>
          <label>Date taken <span className="optional">Optional</span><input type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} /></label>
          <label>Date posted<input type="datetime-local" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} /></label>
          <div className="story-field">
            <span className="story-field-label">Story</span>
            <RichTextEditor
              value={contentHtml}
              onChange={setContentHtml}
              placeholder="What made this moment worth keeping?"
              disabled={busy}
            />
          </div>
          <div className="coordinates"><label>Latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="35.0116" /></label><label>Longitude<input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="135.7681" /></label></div>
          <button className="primary-button location-detect-button" type="button" disabled={locating} onClick={useMyLocation}>
            {locating ? "Detecting…" : "Use my location"}
          </button>
          <p className="form-hint">Location, date, and coordinates are filled from photo metadata when available.</p>
          {locError && <p className="form-error">{locError}</p>}
          {error && <p className="form-error">{error}</p>}
          <p className="form-hint">Saves as a preview draft. Publish from the Posts list or edit screen when you are ready for the live site.</p>
          <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save to preview"}</button>
        </section>
      </form>
    </main>
  );
}

function ProfileEditor() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [avatarPreview, setAvatarPreview] = useState("");
  const [avatarFocus, setAvatarFocus] = useState<FocusPoint>({ x: 0.5, y: 0.5 });
  const avatarPreviewRef = useRef("");
  const avatarDragRef = useRef<{ startX: number; startY: number; x: number; y: number; size: number } | null>(null);
  const [place, setPlace] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  useEffect(() => {
    api<Profile>("/api/profile").then((data) => {
      setProfile(data);
      setAvatarFocus({ x: data.avatarFocusX ?? 0.5, y: data.avatarFocusY ?? 0.5 });
      setPlace(data.currentLocation?.name ?? "");
      setLat(data.currentLocation?.lat != null ? String(data.currentLocation.lat) : "");
      setLng(data.currentLocation?.lng != null ? String(data.currentLocation.lng) : "");
    });
  }, []);
  useEffect(() => () => {
    if (avatarPreviewRef.current) URL.revokeObjectURL(avatarPreviewRef.current);
  }, []);
  if (!profile) return <Loading />;

  const previewAvatar = (file?: File) => {
    if (avatarPreviewRef.current) URL.revokeObjectURL(avatarPreviewRef.current);
    const previewUrl = file ? URL.createObjectURL(file) : "";
    avatarPreviewRef.current = previewUrl;
    setAvatarPreview(previewUrl);
    if (file) setAvatarFocus({ x: 0.5, y: 0.5 });
    setSaved(false);
    setError("");
  };

  const useMyLocation = () => {
    setLocating(true);
    setLocError("");
    void detectCurrentLocation()
      .then(({ lat: nextLat, lng: nextLng, name }) => {
        setLat(String(nextLat));
        setLng(String(nextLng));
        if (name) setPlace(name);
      })
      .catch((err) => setLocError(err instanceof Error ? err.message : "Could not detect location"))
      .finally(() => setLocating(false));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setSaved(false);
    setError("");
    const data = new FormData(event.currentTarget);
    data.set("currentPlaceName", place);
    data.set("currentLat", lat);
    data.set("currentLng", lng);
    data.set("avatarFocusX", String(avatarFocus.x));
    data.set("avatarFocusY", String(avatarFocus.y));
    try {
      const updated = await api<Profile>("/api/profile", { method: "PATCH", body: data });
      setProfile(updated);
      setAvatarFocus({ x: updated.avatarFocusX ?? 0.5, y: updated.avatarFocusY ?? 0.5 });
      if (avatarPreviewRef.current) URL.revokeObjectURL(avatarPreviewRef.current);
      avatarPreviewRef.current = "";
      setAvatarPreview("");
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save profile");
    } finally {
      setSaving(false);
    }
  };
  return (
    <main className="admin-main editor-page">
      <header className="admin-title"><div><p className="eyebrow">Public identity</p><h1>Profile</h1></div></header>
      <form className="profile-form" onSubmit={submit}>
        <div className="profile-avatar-edit">
          <div
            className={`profile-avatar-framer${avatarPreview || profile.avatarUrl ? " profile-avatar-framer-active" : ""}`}
            aria-label="Profile picture crop preview"
            onPointerDown={(event) => {
              if (!avatarPreview && !profile.avatarUrl) return;
              event.currentTarget.setPointerCapture(event.pointerId);
              avatarDragRef.current = {
                startX: event.clientX,
                startY: event.clientY,
                x: avatarFocus.x,
                y: avatarFocus.y,
                size: event.currentTarget.clientWidth,
              };
            }}
            onPointerMove={(event) => {
              const drag = avatarDragRef.current;
              if (!drag) return;
              setAvatarFocus({
                x: clamp01(drag.x - (event.clientX - drag.startX) / drag.size),
                y: clamp01(drag.y - (event.clientY - drag.startY) / drag.size),
              });
            }}
            onPointerUp={() => { avatarDragRef.current = null; }}
            onPointerCancel={() => { avatarDragRef.current = null; }}
          >
            <Avatar
              profile={{
                ...profile,
                avatarUrl: avatarPreview || profile.avatarUrl,
                avatarFocusX: avatarFocus.x,
                avatarFocusY: avatarFocus.y,
              }}
              large
            />
          </div>
          <label>
            Portrait
            <input name="avatar" type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => previewAvatar(event.target.files?.[0])} />
            {(avatarPreview || profile.avatarUrl) && <span className="form-hint">Drag the picture inside the circle to reframe it.</span>}
          </label>
        </div>
        <label>Display name<input name="displayName" defaultValue={profile.displayName} /></label>
        <label>Handle<input name="username" defaultValue={profile.username} /></label>
        <label>Catch phrase<input name="tagline" defaultValue={profile.tagline} /></label>
        <label>Bio<textarea name="bio" rows={5} defaultValue={profile.bio} /></label>
        <div className="profile-location-edit">
          <p className="eyebrow">Current location</p>
          <label>
            Place
            <PlaceInput
              value={place}
              onChange={setPlace}
              onPick={(picked) => {
                setPlace(picked.name);
                setLat(String(picked.lat));
                setLng(String(picked.lng));
              }}
              placeholder="Lisbon, Portugal"
            />
          </label>
          <div className="coordinates">
            <label>Latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="38.7223" /></label>
            <label>Longitude<input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="-9.1393" /></label>
          </div>
          <button className="primary-button" type="button" disabled={locating} onClick={useMyLocation}>
            {locating ? "Detecting…" : "Use my location"}
          </button>
          <p className="form-hint">Shown on the journal home page above your bio.</p>
          {locError && <p className="form-error">{locError}</p>}
        </div>
        {saved && <p className="success">Profile saved.</p>}
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={saving} type="submit">{saving ? "Saving…" : "Save profile"}</button>
      </form>
    </main>
  );
}

function EditPost() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const [post, setPost] = useState<Post | null>(null);
  const [place, setPlace] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [takenAt, setTakenAt] = useState("");
  const [publishedAt, setPublishedAt] = useState(datetimeLocalNow);
  const [contentHtml, setContentHtml] = useState("");
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const [busy, setBusy] = useState(false);
  const [framingBusy, setFramingBusy] = useState(false);
  const [imagesBusy, setImagesBusy] = useState(false);
  const [tripId, setTripId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const [albumId, setAlbumId] = useState("");
  const addImagesRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    api<Post>(`/api/admin/posts/${slug}`)
      .then(async (loaded) => {
        if (cancelled) return;
        setPost(loaded);
        setContentHtml(storyToEditorHtml(loaded));
        setChapterId(loaded.chapter?.id ?? "");
        setTripId(loaded.trip?.id ?? loaded.chapter?.trip.id ?? "");
        setTakenAt(new Date(loaded.takenAt).toISOString().slice(0, 16));
        setPublishedAt(new Date(loaded.publishedAt).toISOString().slice(0, 16));
        const nextLat = loaded.location?.lat;
        const nextLng = loaded.location?.lng;
        let nextPlace = loaded.location?.name ?? "";
        if (nextLat != null && nextLng != null) {
          setLat(String(nextLat));
          setLng(String(nextLng));
          if (!nextPlace) {
            try {
              const resolved = await resolvePlaceName(nextLat, nextLng);
              if (resolved) nextPlace = resolved;
            } catch {
              /* manual entry still available */
            }
          }
        }
        setPlace(nextPlace);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load post"));
    return () => {
      cancelled = true;
    };
  }, [slug]);
  if (error && !post) return <ErrorState message={error} />;
  if (!post) return <Loading />;

  const legacyLocationOnFirst =
    post.location?.lat != null &&
    post.location?.lng != null &&
    !post.images.some((image) => image.hasLocationMetadata);

  const useMyLocation = () => {
    setLocating(true);
    setLocError("");
    void detectCurrentLocation()
      .then(({ lat: nextLat, lng: nextLng, name }) => {
        setLat(String(nextLat));
        setLng(String(nextLng));
        if (name) setPlace(name);
      })
      .catch((err) => setLocError(err instanceof Error ? err.message : "Could not detect location"))
      .finally(() => setLocating(false));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      if (tripId) {
        await api(`/api/admin/trips/${tripId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ albumId: albumId || null }),
        });
      }
      const updated = await api<Post>(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeName: place,
          contentHtml,
          // Older APIs only persist `caption`; store HTML there so formatting survives.
          caption: contentHtml || "",
          takenAt: new Date(takenAt).toISOString(),
          publishedAt: new Date(publishedAt).toISOString(),
          lat: lat ? Number(lat) : null,
          lng: lng ? Number(lng) : null,
          tripId: tripId || null,
          chapterId: chapterId || null,
        }),
      });
      if (tripId && !postTripId(updated)) {
        setError("Trip didn't save. Try saving again.");
        setBusy(false);
        return;
      }
      if (chapterId && !updated.chapter) {
        setError("Journey didn't save. Try saving again.");
        setBusy(false);
        return;
      }
      navigate("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
      setBusy(false);
    }
  };

  const patchImageFraming = async (
    imageId: string,
    payload: { focusX?: number; focusY?: number; fit?: "cover" | "contain" },
  ) => {
    setFramingBusy(true);
    setError("");
    try {
      const updated = await api<{ id: string; focusX: number; focusY: number; fit: "cover" | "contain" }>(
        `/api/post-images/${imageId}/focus`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
      setPost((current) =>
        current
          ? {
              ...current,
              images: current.images.map((image) =>
                image.id === updated.id
                  ? {
                      ...image,
                      focusX: updated.focusX,
                      focusY: updated.focusY,
                      fit: updated.fit,
                    }
                  : image,
              ),
            }
          : current,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save framing");
    } finally {
      setFramingBusy(false);
    }
  };

  const saveImageFocus = (imageId: string, focusX: number, focusY: number) =>
    patchImageFraming(imageId, { focusX, focusY });

  const saveImageFit = (imageId: string, fit: "cover" | "contain") =>
    patchImageFraming(imageId, {
      fit,
      ...(fit === "contain" ? { focusX: 0.5, focusY: 0.5 } : {}),
    });

  const removeImage = async (imageId: string) => {
    if (post.images.length <= 1) return;
    if (!confirm("Remove this photo from the journal?")) return;
    setImagesBusy(true);
    setError("");
    try {
      const updated = await api<Post>(`/api/post-images/${imageId}`, { method: "DELETE" });
      setPost(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove photo");
    } finally {
      setImagesBusy(false);
    }
  };

  const addImages = async (fileList: FileList | null) => {
    if (!fileList?.length) return;
    const remaining = 10 - post.images.length;
    if (remaining <= 0) {
      setError("A journal can have at most 10 photos.");
      return;
    }
    const files = Array.from(fileList).slice(0, remaining);
    const data = new FormData();
    files.forEach((file) => data.append("images", file));
    setImagesBusy(true);
    setError("");
    try {
      const updated = await api<Post>(`/api/posts/${post.id}/images`, { method: "POST", body: data });
      setPost(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add photos");
    } finally {
      setImagesBusy(false);
      if (addImagesRef.current) addImagesRef.current.value = "";
    }
  };

  const publish = async () => {
    if (!confirm("Publish this journal to the live site?")) return;
    setBusy(true);
    try {
      await api(`/api/posts/${post.id}/publish`, { method: "POST" });
      const updated = await api<Post>(`/api/admin/posts/${post.slug}`);
      setPost(updated);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not publish");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="admin-main editor-page">
      <header className="admin-title">
        <div>
          <p className="eyebrow">Refine the story</p>
          <h1>Edit journal</h1>
          {post.isDraft && <span className="status-pill status-draft">Preview only</span>}
        </div>
        <div className="admin-title-actions">
          <Link className="quiet-link" to={`/preview/p/${post.slug}`} target="_blank" rel="noreferrer">Open preview</Link>
          {post.isDraft && (
            <button className="primary-button" type="button" disabled={busy} onClick={publish}>
              {busy ? "Publishing…" : "Publish to live site"}
            </button>
          )}
        </div>
      </header>
      <form className="post-editor" onSubmit={submit}>
        <section className="upload-panel">
          <input
            ref={addImagesRef}
            hidden
            multiple
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={(e) => void addImages(e.target.files)}
          />
          <EditorImageCarousel
            images={post.images}
            legacyLocationOnFirst={legacyLocationOnFirst}
            onFocusSave={saveImageFocus}
            onFitChange={saveImageFit}
            framingBusy={framingBusy}
          />
          <div className="preview-strip editor-photo-strip">
            {post.images.map((image, index) => (
              <div className="photo-frame" key={image.id}>
                <img src={image.url} alt={`Journal photo ${index + 1}`} />
                {post.images.length > 1 && (
                  <button
                    type="button"
                    className="strip-remove"
                    disabled={imagesBusy}
                    aria-label={`Remove photo ${index + 1}`}
                    onClick={() => void removeImage(image.id)}
                  >
                    <Icon name="x" size={14} />
                  </button>
                )}
              </div>
            ))}
            {post.images.length < 10 && (
              <button type="button" disabled={imagesBusy} onClick={() => addImagesRef.current?.click()} aria-label="Add photos">
                <Icon name="plus" />
              </button>
            )}
          </div>
          <p className="form-hint">
            Add or remove photos in the strip below (up to 10). Badges show embedded GPS or date metadata. Drag the main photo to change what is centered in the frame.
            {imagesBusy ? " Updating photos…" : ""}
          </p>
        </section>
        <section className="metadata-panel">
          <JourneyOrganizationFields
            tripId={tripId}
            chapterId={chapterId}
            albumId={albumId}
            onTripIdChange={setTripId}
            onChapterIdChange={setChapterId}
            onAlbumIdChange={setAlbumId}
          />
          <label>
            Place
            <PlaceInput
              value={place}
              onChange={setPlace}
              onPick={(picked) => {
                setPlace(picked.name);
                setLat(String(picked.lat));
                setLng(String(picked.lng));
              }}
              placeholder="Kyoto, Japan"
            />
          </label>
          <label>Date taken<input type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} /></label>
          <label>Date posted<input type="datetime-local" value={publishedAt} onChange={(e) => setPublishedAt(e.target.value)} /></label>
          <div className="story-field">
            <span className="story-field-label">Story</span>
            <RichTextEditor value={contentHtml} onChange={setContentHtml} disabled={busy} />
          </div>
          <div className="coordinates">
            <label>Latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="35.0116" /></label>
            <label>Longitude<input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="135.7681" /></label>
          </div>
          <button className="primary-button location-detect-button" type="button" disabled={locating} onClick={useMyLocation}>
            {locating ? "Detecting…" : "Use my location"}
          </button>
          {locError && <p className="form-error">{locError}</p>}
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={busy} type="submit">{busy ? "Saving…" : "Save changes"}</button>
        </section>
      </form>
    </main>
  );
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Feed />} />
      <Route path="/preview" element={<PreviewFeed />} />
      <Route path="/p/:slug" element={<PostDetail />} />
      <Route path="/preview/p/:slug" element={<PreviewPostDetail />} />
      <Route path="/admin/login" element={<Login />} />
      <Route element={<AdminGate />}>
        <Route element={<AdminLayout />}>
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/new" element={<NewPost />} />
          <Route path="/admin/posts/:slug/edit" element={<EditPost />} />
          <Route path="/admin/albums" element={<AdminAlbums />} />
          <Route path="/admin/profile" element={<ProfileEditor />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
