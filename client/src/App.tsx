import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import useEmblaCarousel from "embla-carousel-react";
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

type Image = { id: string; url: string; width?: number; height?: number; alt?: string };
type Post = {
  id: string;
  slug: string;
  caption: string;
  takenAt: string;
  publishedAt: string;
  location?: { name?: string; lat?: number; lng?: number };
  images: Image[];
};
type Profile = {
  displayName: string;
  username: string;
  bio: string;
  avatarUrl?: string;
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

function Icon({ name, size = 20 }: { name: "pin" | "grid" | "arrow" | "share" | "plus" | "x"; size?: number }) {
  const paths = {
    pin: <path d="M12 21s7-6.2 7-13A7 7 0 1 0 5 8c0 6.8 7 13 7 13Zm0-10a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />,
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
        <span>{profile.displayName.slice(0, 1)}</span>
      )}
    </div>
  );
}

function Carousel({ images, linkedSlug }: { images: Image[]; linkedSlug?: string }) {
  const [emblaRef, embla] = useEmblaCarousel({ loop: images.length > 1 });
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!embla) return;
    const update = () => setSelected(embla.selectedScrollSnap());
    embla.on("select", update);
    return () => {
      embla.off("select", update);
    };
  }, [embla]);

  const content = (
    <div className="carousel" ref={emblaRef}>
      <div className="carousel-track">
        {images.map((image, index) => (
          <div className="carousel-slide" key={image.id}>
            <img
              src={image.url}
              alt={image.alt || `Travel photograph ${index + 1} of ${images.length}`}
              loading={index === 0 ? "eager" : "lazy"}
            />
          </div>
        ))}
      </div>
      {images.length > 1 && (
        <>
          <span className="image-count">{selected + 1} / {images.length}</span>
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
  return linkedSlug ? <Link to={`/p/${linkedSlug}`}>{content}</Link> : content;
}

function PostCard({ post, profile }: { post: Post; profile: Profile }) {
  return (
    <article className="post-card">
      <header className="post-header">
        <Avatar profile={profile} />
        <div>
          <strong>@{profile.username}</strong>
          {post.location?.name && <span>{post.location.name}</span>}
        </div>
        <time>{formatDate(post.takenAt)}</time>
      </header>
      <Carousel images={post.images} linkedSlug={post.slug} />
      <div className="post-copy">
        {post.location?.name && (
          <div className="location-line"><Icon name="pin" size={16} />{post.location.name}</div>
        )}
        <p><strong>@{profile.username}</strong> {post.caption}</p>
        <Link className="quiet-link" to={`/p/${post.slug}`}>View journey</Link>
      </div>
    </article>
  );
}

function Feed() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [posts, setPosts] = useState<Post[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [profileData, postsData] = await Promise.all([
        api<Profile>("/api/profile"),
        api<{ posts: Post[] }>("/api/posts"),
      ]);
      setProfile(profileData);
      setPosts(postsData.posts);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  };

  // The effect hydrates this route from the public API; state updates occur after I/O.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { void load(); }, []);
  if (loading) return <Loading />;
  if (error || !profile) return <ErrorState message={error} retry={load} />;

  return (
    <main className="page-shell feed-page">
      <section className="profile-hero">
        <div className="profile-top">
          <Avatar profile={profile} large />
          <div>
            <p className="eyebrow">Independent travel journal</p>
            <h1>{profile.displayName}</h1>
            <p className="handle">@{profile.username}</p>
          </div>
        </div>
        <p className="bio">{profile.bio}</p>
        {profile.links.length > 0 && (
          <nav className="profile-links">
            {profile.links.map((link) => <a href={link.href} key={link.href}>{link.label}</a>)}
          </nav>
        )}
      </section>
      <div className="feed-rule"><span>Latest places</span><Icon name="grid" size={16} /></div>
      {posts.length === 0 ? (
        <div className="state-card"><p className="eyebrow">The road starts here</p><h2>No posts yet.</h2><p>Visit the private admin page to publish your first journey.</p></div>
      ) : (
        <section className="feed-list">
          {posts.map((post) => <PostCard post={post} profile={profile} key={post.id} />)}
        </section>
      )}
    </main>
  );
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

function PostDetail() {
  const { slug } = useParams();
  const [post, setPost] = useState<Post | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([api<Post>(`/api/posts/${slug}`), api<Profile>("/api/profile")])
      .then(([p, pr]) => { setPost(p); setProfile(pr); })
      .catch((err) => setError(err.message));
  }, [slug]);
  if (error) return <ErrorState message={error} />;
  if (!post || !profile) return <Loading />;

  return (
    <main className="detail-page">
      <nav className="detail-nav">
        <Link to="/"><Icon name="arrow" /> <span>Journal</span></Link>
        <button onClick={() => navigator.share?.({ title: post.location?.name, url: location.href })}>
          <Icon name="share" />
        </button>
      </nav>
      <div className="detail-layout">
        <Carousel images={post.images} />
        <div className="detail-copy">
          <p className="eyebrow">{formatDate(post.takenAt)}</p>
          <h1>{post.location?.name || "A place worth remembering"}</h1>
          <p className="detail-caption">{post.caption}</p>
          <div className="author-line"><Avatar profile={profile} /><span>Photographed by <strong>{profile.displayName}</strong></span></div>
          <TravelMap post={post} />
        </div>
      </div>
    </main>
  );
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
        <div className="login-mark">N</div>
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

type AdminPost = { id: string; slug: string; caption: string; taken_at: string; place_name: string | null; thumbnail?: string };

function AdminLayout() {
  const navigate = useNavigate();
  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <Link to="/admin" className="wordmark"><span>N</span> Not Instagram</Link>
        <nav><Link to="/admin">Posts</Link><Link to="/admin/new">New journey</Link><Link to="/admin/profile">Profile</Link></nav>
        <button onClick={async () => { await api("/api/auth/logout", { method: "POST" }); navigate("/"); }}>Sign out</button>
      </aside>
      <div className="admin-mobile-nav"><Link to="/admin" className="wordmark"><span>N</span> Studio</Link><Link to="/admin/new" className="circle-button"><Icon name="plus" /></Link></div>
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
    if (!confirm(`Delete “${post.place_name || post.slug}”? This also deletes its images.`)) return;
    await api(`/api/posts/${post.id}`, { method: "DELETE" });
    await load();
  };
  return (
    <main className="admin-main">
      <header className="admin-title"><div><p className="eyebrow">Your archive</p><h1>Journeys</h1></div><Link to="/admin/new" className="primary-button"><Icon name="plus" size={18} /> New post</Link></header>
      {loading ? <div className="skeleton post-skeleton" /> : posts.length === 0 ? (
        <div className="state-card"><h2>Your journal is empty.</h2><Link to="/admin/new" className="primary-button">Publish first post</Link></div>
      ) : (
        <div className="admin-post-list">
          {posts.map((post) => (
            <article key={post.id}>
              <img src={post.thumbnail} alt="" />
              <div><strong>{post.place_name || "Untitled journey"}</strong><span>{formatDate(post.taken_at)}</span><p>{post.caption}</p></div>
              <div className="admin-actions"><Link to={`/admin/posts/${post.slug}/edit`}>Edit</Link><Link to={`/p/${post.slug}`}>View</Link><button onClick={() => remove(post)}>Delete</button></div>
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const previews = useMemo(() => files.map((file) => ({ file, url: URL.createObjectURL(file) })), [files]);
  useEffect(() => () => previews.forEach((preview) => URL.revokeObjectURL(preview.url)), [previews]);

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
    try {
      const post = await api<Post>("/api/posts", { method: "POST", body: data });
      navigate(`/p/${post.slug}`);
    } catch (err) { setError(err instanceof Error ? err.message : "Could not publish"); setBusy(false); }
  };
  return (
    <main className="admin-main editor-page">
      <header className="admin-title"><div><p className="eyebrow">Add to the archive</p><h1>New journey</h1></div></header>
      <form className="post-editor" onSubmit={submit}>
        <section className="upload-panel">
          <input ref={inputRef} hidden multiple type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => setFiles(Array.from(e.target.files || []).slice(0, 10))} />
          {previews.length ? (
            <>
              <div className="preview-main"><img src={previews[0]!.url} alt="Selected preview" /></div>
              <div className="preview-strip">{previews.map(({ file, url }, index) => <img src={url} alt={`Selected ${index + 1}`} key={file.name + index} />)}<button type="button" onClick={() => inputRef.current?.click()}><Icon name="plus" /></button></div>
            </>
          ) : (
            <button type="button" className="drop-zone" onClick={() => inputRef.current?.click()}><Icon name="plus" size={28} /><strong>Select your photographs</strong><span>JPEG, PNG or WebP · up to 10 images</span></button>
          )}
        </section>
        <section className="metadata-panel">
          <label>Place<input value={place} onChange={(e) => setPlace(e.target.value)} placeholder="Kyoto, Japan" /></label>
          <label>Date taken <span className="optional">Optional</span><input type="datetime-local" value={takenAt} onChange={(e) => setTakenAt(e.target.value)} /></label>
          <label>Story<textarea value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="What made this moment worth keeping?" rows={6} /></label>
          <div className="coordinates"><label>Latitude<input inputMode="decimal" value={lat} onChange={(e) => setLat(e.target.value)} placeholder="35.0116" /></label><label>Longitude<input inputMode="decimal" value={lng} onChange={(e) => setLng(e.target.value)} placeholder="135.7681" /></label></div>
          <p className="form-hint">Date and GPS are read from the first photo when available.</p>
          {error && <p className="form-error">{error}</p>}
          <button className="primary-button" disabled={busy} type="submit">{busy ? "Publishing…" : "Publish journey"}</button>
        </section>
      </form>
    </main>
  );
}

function ProfileEditor() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { api<Profile>("/api/profile").then(setProfile); }, []);
  if (!profile) return <Loading />;
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
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
        <label>Bio<textarea name="bio" rows={5} defaultValue={profile.bio} /></label>
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
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Post>(`/api/posts/${slug}`).then(setPost).catch((err) => setError(err.message));
  }, [slug]);
  if (error) return <ErrorState message={error} />;
  if (!post) return <Loading />;

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      await api(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          placeName: data.get("placeName"),
          caption: data.get("caption"),
          takenAt: new Date(String(data.get("takenAt"))).toISOString(),
          lat: data.get("lat") ? Number(data.get("lat")) : null,
          lng: data.get("lng") ? Number(data.get("lng")) : null,
        }),
      });
      navigate("/admin");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save changes");
      setBusy(false);
    }
  };

  return (
    <main className="admin-main editor-page">
      <header className="admin-title"><div><p className="eyebrow">Refine the story</p><h1>Edit journey</h1></div></header>
      <form className="post-editor" onSubmit={submit}>
        <section className="upload-panel">
          <Carousel images={post.images} />
          <p className="form-hint">Image replacement and reordering can be added later; metadata is editable now.</p>
        </section>
        <section className="metadata-panel">
          <label>Place<input name="placeName" defaultValue={post.location?.name} /></label>
          <label>Date taken<input name="takenAt" type="datetime-local" defaultValue={new Date(post.takenAt).toISOString().slice(0, 16)} /></label>
          <label>Story<textarea name="caption" rows={7} defaultValue={post.caption} /></label>
          <div className="coordinates">
            <label>Latitude<input name="lat" inputMode="decimal" defaultValue={post.location?.lat} /></label>
            <label>Longitude<input name="lng" inputMode="decimal" defaultValue={post.location?.lng} /></label>
          </div>
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
      <Route path="/p/:slug" element={<PostDetail />} />
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
