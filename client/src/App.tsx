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

type PhotoMetadataFlags = { hasLocation: boolean; hasDate: boolean };

type FileExif = PhotoMetadataFlags & { lat?: number; lng?: number; takenAt?: string };
type PostChapter = {
  id: string;
  slug: string;
  title: string;
  trip: { id: string; slug: string; title: string };
};

type PostTrip = { id: string; slug: string; title: string };

type Post = {
  id: string;
  slug: string;
  caption: string;
  takenAt: string;
  publishedAt: string;
  isDraft?: boolean;
  trip?: PostTrip;
  chapter?: PostChapter;
  location?: { name?: string; lat?: number; lng?: number };
  images: Image[];
};

type AdminChapter = { id: string; slug: string; title: string; tripId: string };
type AdminTrip = { id: string; slug: string; title: string; chapters: AdminChapter[] };
type FeedChapter = { id: string; slug: string; title: string };
type FeedTrip = { id: string; slug: string; title: string; chapters: FeedChapter[] };

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

function storyShortTitle(post: Post) {
  if (post.location?.name) {
    const primary = post.location.name.split(",")[0]?.trim();
    if (primary) return primary;
  }
  const words = post.caption.trim().split(/\s+/).filter(Boolean).slice(0, 5).join(" ");
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

function TripSelector({
  trips,
  posts,
  selectedId,
  onSelect,
}: {
  trips: FeedTrip[];
  posts: Post[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <div className="story-selector-shell" aria-label="Trips">
      <div className="story-selector" role="tablist" aria-orientation="horizontal">
        {trips.map((trip) => {
          const selected = trip.id === selectedId;
          const cover = tripCoverPost(posts, trip.id);
          const thumb = cover ? storyThumbnail(cover) : null;
          return (
            <button
              key={trip.id}
              type="button"
              role="tab"
              aria-selected={selected}
              className={`story-chip${selected ? " story-chip-selected" : ""}`}
              onClick={() => onSelect(trip.id)}
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
        })}
      </div>
    </div>
  );
}

function FeedViewControls({
  view,
  chapterId,
  chapters,
  canGroup,
  onViewChange,
  onChapterChange,
}: {
  view: FeedViewMode;
  chapterId: string;
  chapters: FeedChapter[];
  canGroup: boolean;
  onViewChange: (view: FeedViewMode) => void;
  onChapterChange: (id: string) => void;
}) {
  const grouped = view === "grouped";
  return (
    <div className="feed-view-bar" role="toolbar" aria-label="View for this trip">
      <span className="feed-view-label">View</span>
      <button
        type="button"
        className={`feed-view-pill${!grouped ? " feed-view-pill-selected" : ""}`}
        aria-pressed={!grouped}
        onClick={() => onViewChange("timeline")}
      >
        Timeline
      </button>
      {canGroup ? (
        <button
          type="button"
          className={`feed-view-pill${grouped ? " feed-view-pill-selected" : ""}`}
          aria-pressed={grouped}
          onClick={() => onViewChange("grouped")}
        >
          Grouped by
        </button>
      ) : null}
      {grouped && canGroup && chapters.length > 0 ? (
        <select
          className="feed-view-chapter-select"
          aria-label="Chapter"
          value={chapterId}
          onChange={(e) => onChapterChange(e.target.value)}
        >
          <option value={ALL_CHAPTERS}>All chapters</option>
          {chapters.map((chapter) => (
            <option key={chapter.id} value={chapter.id}>
              {chapter.title}
            </option>
          ))}
        </select>
      ) : null}
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
    return <BrandName casing="title" />;
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

function BrandName({ casing = "lower", className }: { casing?: "lower" | "title"; className?: string }) {
  const label = casing === "title" ? "Pao.offline" : "pao.offline";
  const classes = ["brand-name", className].filter(Boolean).join(" ");
  return (
    <span className={classes} aria-label="pao.offline">
      {label}
    </span>
  );
}

function Icon({
  name,
  size = 20,
}: {
  name: "pin" | "grid" | "arrow" | "share" | "plus" | "x" | "journey";
  size?: number;
}) {
  const paths = {
    pin: <path d="M12 21s7-6.2 7-13A7 7 0 1 0 5 8c0 6.8 7 13 7 13Zm0-10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
    journey: <path d="M3 6.5 9 4.5l6 2 6-2v13l-6 2-6-2-6 2V6.5Z M9 4.5v13M15 6.5v13" />,
    grid: <path d="M4 4h6v6H4V4Zm10 0h6v6h-6V4ZM4 14h6v6H4v-6Zm10 0h6v6h-6v-6Z" />,
    arrow: <path d="m15 18-6-6 6-6" />,
    share: <path d="M12 16V3m0 0L7 8m5-5 5 5M5 13v7h14v-7" />,
    plus: <path d="M12 5v14M5 12h14" />,
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
        <img src={profile.avatarUrl} alt={`${profile.displayName}'s portrait`} />
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
  const [emblaRef, embla] = useEmblaCarousel({ loop: images.length > 1, watchDrag: false });
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
  const activeAxes = active ? framingPanAxes(active.width, active.height) : { x: false, y: false };
  const canReframe = Boolean(active && activeFit === "cover" && (activeAxes.x || activeAxes.y));

  return (
    <>
      <div className="carousel editor-carousel" ref={emblaRef}>
        <div className="carousel-track">
          {images.map((image, index) => {
            const focus = focusById[image.id] ?? { x: image.focusX ?? 0.5, y: image.focusY ?? 0.5 };
            const fit = resolveFit(image);
            const framedImage = { ...image, fit };
            const isActive = index === selected;
            const axes = framingPanAxes(image.width, image.height);
            const interactive = Boolean(onFocusSave && isActive && fit === "cover" && (axes.x || axes.y));
            return (
              <div
                className={`carousel-slide photo-frame framing-frame${fit === "contain" ? " carousel-slide-contain framing-frame-contain" : ""}${interactive ? " framing-frame-active" : ""}${dragging && isActive ? " framing-frame-dragging" : ""}`}
                key={image.id}
                onPointerDown={
                  interactive
                    ? (event) => {
                        if (isFramingControl(event.target)) return;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        dragRef.current = {
                          id: image.id,
                          startX: event.clientX,
                          startY: event.clientY,
                          focusX: focus.x,
                          focusY: focus.y,
                          width: event.currentTarget.clientWidth,
                          height: event.currentTarget.clientHeight,
                          axes,
                        };
                        setDragging(true);
                      }
                    : undefined
                }
                onPointerMove={
                  interactive
                    ? (event) => {
                        const drag = dragRef.current;
                        if (!drag || drag.id !== image.id) return;
                        const dx = event.clientX - drag.startX;
                        const dy = event.clientY - drag.startY;
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
                  interactive
                    ? (event) => {
                        if (isFramingControl(event.target)) return;
                        finishDrag(image.id);
                      }
                    : undefined
                }
                onPointerCancel={
                  interactive
                    ? (event) => {
                        if (isFramingControl(event.target)) return;
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
                <Link to={`${postBase}/${linkedSlug}`} aria-label="Open journey">
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
      <p>Drafts and unpublished journeys appear here. The live journal is at <Link to="/">your domain</Link>.</p>
    </div>
  );
}

function PostCard({ post, profile, site }: { post: Post; profile: Profile; site: SiteMode }) {
  const grouping = journeyGroupingLabel(post);
  return (
    <article className={`post-card${post.isDraft ? " post-card-draft" : ""}`}>
      <header className="post-header">
        <Avatar profile={profile} />
        <div>
          <strong>@{profile.username}</strong>
          {post.location?.name && <span>{post.location.name}</span>}
          {grouping && <span className="journey-grouping">{grouping}</span>}
        </div>
        <time>{formatDate(post.takenAt)}</time>
      </header>
      {post.isDraft && <p className="draft-pill">Draft — not on live site</p>}
      <Carousel images={post.images} linkedSlug={post.slug} postBase={site.postBase} />
      <div className="post-copy">
        {grouping && <p className="journey-grouping-line">{grouping}</p>}
        {post.location?.name && (
          <div className="location-line"><Icon name="pin" size={16} />{post.location.name}</div>
        )}
        <p><strong>@{profile.username}</strong> {post.caption}</p>
        <Link className="quiet-link" to={`${site.postBase}/${post.slug}`}>View journey</Link>
      </div>
    </article>
  );
}

function JournalFeed({ site }: { site: SiteMode }) {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [trips, setTrips] = useState<FeedTrip[]>([]);
  const [selectedTripId, setSelectedTripId] = useState<string | null>(null);
  const [tripFeedPrefs, setTripFeedPrefs] = useState<Record<string, TripFeedPrefs>>({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [profileData, postsData, tripsData] = await Promise.all([
        api<Profile>("/api/profile"),
        api<{ posts: Post[] }>(`${site.postsListUrl}?limit=50`),
        api<{ trips: FeedTrip[] }>(site.tripsListUrl),
      ]);
      setProfile(profileData);
      setPosts(postsData.posts);
      setTrips(tripsData.trips);
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

  const tripBrowse = trips.length > 0;

  useEffect(() => {
    if (!tripBrowse) {
      setSelectedTripId(null);
      return;
    }
    setSelectedTripId((current) =>
      current && trips.some((trip) => trip.id === current) ? current : (trips[0]?.id ?? null),
    );
  }, [trips, tripBrowse]);

  const activeTrip = useMemo(
    () => (selectedTripId ? trips.find((trip) => trip.id === selectedTripId) : undefined),
    [trips, selectedTripId],
  );

  const activeTripPrefs = useMemo(() => {
    if (!selectedTripId) return defaultTripFeedPrefs();
    return tripFeedPrefs[selectedTripId] ?? defaultTripFeedPrefs();
  }, [selectedTripId, tripFeedPrefs]);

  const feedView = activeTripPrefs.view;
  const chapterId = activeTripPrefs.chapterId;

  const tripPosts = useMemo(() => {
    if (!selectedTripId) return [];
    return postsForTrip(posts, selectedTripId);
  }, [posts, selectedTripId]);

  const patchTripPrefs = (tripId: string, patch: Partial<TripFeedPrefs>) => {
    setTripFeedPrefs((prev) => ({
      ...prev,
      [tripId]: { ...defaultTripFeedPrefs(), ...prev[tripId], ...patch },
    }));
  };

  const groupedChapters = useMemo(() => {
    if (!activeTrip) return [];
    if (chapterId === ALL_CHAPTERS) return activeTrip.chapters;
    return activeTrip.chapters.filter((chapter) => chapter.id === chapterId);
  }, [activeTrip, chapterId]);

  const feedRule = useMemo(() => {
    if (!tripBrowse) return site.preview ? "Preview feed" : "Latest places";
    if (!activeTrip) return site.preview ? "Preview feed" : "Latest places";
    if (feedView === "timeline") return activeTrip.title;
    if (chapterId === ALL_CHAPTERS) return activeTrip.title;
    const chapter = activeTrip.chapters.find((item) => item.id === chapterId);
    return chapter?.title ?? activeTrip.title;
  }, [activeTrip, chapterId, feedView, site.preview, tripBrowse]);

  const feedRuleDetail = useMemo(() => {
    if (!tripBrowse) return null;
    if (feedView === "timeline") return "Timeline · newest first";
    if (chapterId === ALL_CHAPTERS) return "Grouped by chapter";
    return "One chapter";
  }, [chapterId, feedView, tripBrowse]);

  const onTripSelect = (tripId: string) => {
    setSelectedTripId(tripId);
  };

  const onFeedViewChange = (view: FeedViewMode) => {
    if (!selectedTripId) return;
    patchTripPrefs(selectedTripId, {
      view,
      chapterId: view === "grouped" ? ALL_CHAPTERS : activeTripPrefs.chapterId,
    });
  };

  const onChapterChange = (nextChapterId: string) => {
    if (!selectedTripId) return;
    patchTripPrefs(selectedTripId, { chapterId: nextChapterId });
  };

  const canGroupByChapter = Boolean(activeTrip && activeTrip.chapters.length > 0);

  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => {
    if (!selectedTripId || canGroupByChapter || feedView !== "grouped") return;
    patchTripPrefs(selectedTripId, { view: "timeline" });
  }, [canGroupByChapter, feedView, selectedTripId]);

  if (loading) return <Loading />;
  if (error || !profile) return <ErrorState message={error} retry={load} />;

  const showTripFeed = tripBrowse && Boolean(activeTrip);
  const timelineFeed = showTripFeed ? tripPosts : posts;
  const showGroupedFeed = showTripFeed && canGroupByChapter && feedView === "grouped";

  return (
    <>
      {site.preview && <PreviewSiteBanner />}
      <header className="profile-hero">
        <div className="profile-masthead">
          <Avatar profile={profile} large />
          <h1>
            <ProfileDisplayName displayName={profile.displayName} hero />
          </h1>
          {(profile.tagline || profile.currentLocation?.name) && (
            <div className="profile-meta">
              {profile.tagline && <p className="profile-status">{profile.tagline}</p>}
              {profile.currentLocation?.name && (
                <p className="current-location" aria-live="polite">
                  <Icon name="pin" size={16} />
                  {profile.currentLocation.name}
                </p>
              )}
            </div>
          )}
          {profile.bio && <p className="bio">{profile.bio}</p>}
          {tripBrowse && selectedTripId && activeTrip ? (
            <div className="trip-feed-controls">
              <TripSelector
                trips={trips}
                posts={posts}
                selectedId={selectedTripId}
                onSelect={onTripSelect}
              />
              {canGroupByChapter ? (
                <FeedViewControls
                  view={feedView}
                  chapterId={chapterId}
                  chapters={activeTrip.chapters}
                  canGroup={canGroupByChapter}
                  onViewChange={onFeedViewChange}
                  onChapterChange={onChapterChange}
                />
              ) : null}
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
        <span>{feedRule}</span>
        {feedRuleDetail ? <span className="feed-rule-detail">{feedRuleDetail}</span> : <Icon name="grid" size={16} />}
      </div>
      {posts.length === 0 ? (
        <div className="state-card"><p className="eyebrow">The road starts here</p><h2>No posts yet.</h2><p>{site.preview ? "Save a journey from admin to see it here before publishing." : "Visit the private admin page to publish your first journey."}</p></div>
      ) : showGroupedFeed ? (
        <div className="feed-list feed-list-grouped">
          {groupedChapters.map((chapter) => {
            const chapterPosts = tripPosts.filter((post) => post.chapter?.id === chapter.id);
            if (chapterPosts.length === 0) return null;
            return (
              <section key={chapter.id} className="feed-chapter-block">
                <header className="feed-chapter-heading">
                  <h2>{chapter.title}</h2>
                  <p>
                    {chapterPosts.length} journey{chapterPosts.length === 1 ? "" : "s"}
                  </p>
                </header>
                <div className="feed-list feed-list-nested">
                  {chapterPosts.map((post) => (
                    <PostCard post={post} profile={profile} site={site} key={post.id} />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
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
          <p className="detail-caption">{post.caption}</p>
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
  onTripIdChange,
  onChapterIdChange,
}: {
  tripId: string;
  chapterId: string;
  onTripIdChange: (id: string) => void;
  onChapterIdChange: (id: string) => void;
}) {
  const [trips, setTrips] = useState<AdminTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgError, setOrgError] = useState("");
  const [newTripTitle, setNewTripTitle] = useState("");
  const [newChapterTitle, setNewChapterTitle] = useState("");
  const [addingTrip, setAddingTrip] = useState(false);
  const [addingChapter, setAddingChapter] = useState(false);
  const [busy, setBusy] = useState(false);

  const reloadTrips = async () => {
    const data = await api<{ trips: AdminTrip[] }>("/api/admin/trips");
    setTrips(data.trips);
  };

  useEffect(() => {
    void reloadTrips()
      .catch((err) => setOrgError(err instanceof Error ? err.message : "Could not load trips"))
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

  const chapters = useMemo(() => {
    if (!tripId) return [];
    return trips.find((trip) => trip.id === tripId)?.chapters ?? [];
  }, [tripId, trips]);

  const createTrip = async () => {
    const title = newTripTitle.trim();
    if (!title) return;
    setBusy(true);
    setOrgError("");
    try {
      const created = await api<AdminTrip>("/api/admin/trips", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      await reloadTrips();
      onTripIdChange(created.id);
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
      setOrgError(err instanceof Error ? err.message : "Could not create chapter");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="organization-fields">
      <p className="eyebrow">Journal structure</p>
      <p className="form-hint">
        Optional. Trip can be saved on its own; add a chapter when you want finer grouping on the journal.
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
            Chapter
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
                + New chapter
              </button>
            ) : (
              <div className="organization-inline-add">
                <label>
                  Chapter title
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

function AdminLayout() {
  const navigate = useNavigate();
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link to="/admin" className="wordmark"><span>P</span><BrandName /></Link>
        <nav><Link to="/admin">Posts</Link><Link to="/admin/new">New journey</Link><Link to="/admin/profile">Profile</Link></nav>
        <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); navigate("/"); }}>Sign out</button>
      </aside>
      <div className="admin-mobile-nav"><Link to="/admin" className="wordmark"><span>P</span><BrandName /></Link><Link to="/admin/new" className="circle-button"><Icon name="plus" /></Link></div>
      <Outlet />
    </div>
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
        <div><p className="eyebrow">Your archive</p><h1>Journeys</h1></div>
        <div className="admin-title-actions">
          <a className="quiet-link" href="/preview" target="_blank" rel="noreferrer">Open preview site</a>
          <Link to="/admin/new" className="primary-button"><Icon name="plus" size={18} /> New post</Link>
        </div>
      </header>
      {loading ? <div className="skeleton post-skeleton" /> : posts.length === 0 ? (
        <div className="state-card"><h2>Your journal is empty.</h2><Link to="/admin/new" className="primary-button">Add first journey</Link></div>
      ) : (
        <div className="admin-post-list">
          {posts.map((post) => (
            <article key={post.id} className={post.isDraft ? "admin-post-draft" : ""}>
              <img src={post.thumbnail} alt="" />
              <div>
                <strong>{post.placeName || "Untitled journey"}</strong>
                {post.isDraft ? <span className="status-pill status-draft">Preview only</span> : <span className="status-pill status-live">Live</span>}
                <span>{formatDate(post.takenAt)}</span>
                {(post.tripTitle || post.chapterTitle) && (
                  <span className="admin-post-grouping">
                    {[post.tripTitle, post.chapterTitle].filter(Boolean).join(" · ")}
                  </span>
                )}
                <p>{post.caption}</p>
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
  const [caption, setCaption] = useState("");
  const [place, setPlace] = useState("");
  const [takenAt, setTakenAt] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tripId, setTripId] = useState("");
  const [chapterId, setChapterId] = useState("");
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
    data.append("caption", caption);
    data.append("placeName", place);
    if (takenAt) data.append("takenAt", new Date(takenAt).toISOString());
    if (lat) data.append("lat", lat);
    if (lng) data.append("lng", lng);
    data.append("tripId", tripId);
    data.append("chapterId", chapterId);
    try {
      const post = await api<Post>("/api/posts", { method: "POST", body: data });
      if (tripId && !postTripId(post)) {
        setError("Trip didn't save. Try saving again.");
        setBusy(false);
        return;
      }
      if (chapterId && !post.chapter) {
        setError("Chapter didn't save. Try saving again.");
        setBusy(false);
        return;
      }
      navigate(`/preview/p/${post.slug}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not save"); setBusy(false); }
  };
  return (
    <main className="admin-main editor-page">
      <header className="admin-title"><div><p className="eyebrow">Add to the archive</p><h1>New journey</h1></div></header>
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
            onTripIdChange={setTripId}
            onChapterIdChange={setChapterId}
          />
          <label>Place<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Kyoto, Japan" /></label>
          <label>Date taken <span className="optional">Optional</span><input type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} /></label>
          <label>Story<textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What made this moment worth keeping?" rows={6} /></label>
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
  const [place, setPlace] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  useEffect(() => {
    api<Profile>("/api/profile").then((data) => {
      setProfile(data);
      setPlace(data.currentLocation?.name ?? "");
      setLat(data.currentLocation?.lat != null ? String(data.currentLocation.lat) : "");
      setLng(data.currentLocation?.lng != null ? String(data.currentLocation.lng) : "");
    });
  }, []);
  if (!profile) return <Loading />;

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
    const data = new FormData(event.currentTarget);
    data.set("currentPlaceName", place);
    data.set("currentLat", lat);
    data.set("currentLng", lng);
    await api("/api/profile", { method: "PATCH", body: data });
    setSaved(true);
  };
  return (
    <main className="admin-main editor-page">
      <header className="admin-title"><div><p className="eyebrow">Public identity</p><h1>Profile</h1></div></header>
      <form className="profile-form" onSubmit={submit}>
        <div className="profile-avatar-edit"><Avatar profile={profile} large /><label>Portrait<input name="avatar" type="file" accept="image/*" /></label></div>
        <label>Display name<input name="displayName" defaultValue={profile.displayName} /></label>
        <label>Handle<input name="username" defaultValue={profile.username} /></label>
        <label>Catch phrase<input name="tagline" defaultValue={profile.tagline} /></label>
        <label>Bio<textarea name="bio" rows={5} defaultValue={profile.bio} /></label>
        <div className="profile-location-edit">
          <p className="eyebrow">Current location</p>
          <label>Place<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Lisbon, Portugal" /></label>
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
        <button className="primary-button" type="submit">Save profile</button>
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
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState("");
  const [busy, setBusy] = useState(false);
  const [framingBusy, setFramingBusy] = useState(false);
  const [imagesBusy, setImagesBusy] = useState(false);
  const [tripId, setTripId] = useState("");
  const [chapterId, setChapterId] = useState("");
  const addImagesRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let cancelled = false;
    api<Post>(`/api/admin/posts/${slug}`)
      .then(async (loaded) => {
        if (cancelled) return;
        setPost(loaded);
        setCaption(loaded.caption);
        setChapterId(loaded.chapter?.id ?? "");
        setTripId(loaded.trip?.id ?? loaded.chapter?.trip.id ?? "");
        setTakenAt(new Date(loaded.takenAt).toISOString().slice(0, 16));
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
      const updated = await api<Post>(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeName: place,
          caption,
          takenAt: new Date(takenAt).toISOString(),
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
        setError("Chapter didn't save. Try saving again.");
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
    if (!confirm("Remove this photo from the journey?")) return;
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
      setError("A journey can have at most 10 photos.");
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
    if (!confirm("Publish this journey to the live site?")) return;
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
          <h1>Edit journey</h1>
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
                <img src={image.url} alt={`Journey photo ${index + 1}`} />
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
            onTripIdChange={setTripId}
            onChapterIdChange={setChapterId}
          />
          <label>Place<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Kyoto, Japan" /></label>
          <label>Date taken<input type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} /></label>
          <label>Story<textarea value={caption} onChange={(e) => setCaption(e.target.value)} rows={7} /></label>
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
          <Route path="/admin/profile" element={<ProfileEditor />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
