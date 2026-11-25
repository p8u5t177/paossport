import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";

export type PlacePick = {
  name: string;
  lat: number;
  lng: number;
};

type PlaceInputProps = {
  value: string;
  onChange: (value: string) => void;
  onPick: (place: PlacePick) => void;
  placeholder?: string;
};

export function PlaceInput({ value, onChange, onPick, placeholder }: PlaceInputProps) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const suppressSearchRef = useRef(false);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<PlacePick[]>([]);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [error, setError] = useState("");

  useEffect(() => {
    if (suppressSearchRef.current) {
      suppressSearchRef.current = false;
      setResults([]);
      setOpen(false);
      setLoading(false);
      setError("");
      setActiveIndex(-1);
      return;
    }

    const query = value.trim();
    if (query.length < 2) {
      setResults([]);
      setOpen(false);
      setLoading(false);
      setError("");
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError("");
      void fetch(`/api/geocode/search?q=${encodeURIComponent(query)}`, {
        credentials: "include",
        signal: controller.signal,
      })
        .then(async (response) => {
          if (!response.ok) {
            const payload = await response.json().catch(() => null);
            const message =
              payload && typeof payload === "object" && "error" in payload && typeof payload.error === "string"
                ? payload.error
                : response.status === 401
                  ? "Sign in to search places"
                  : response.status === 429
                    ? "Too many searches — wait a moment"
                    : "Could not search places";
            throw new Error(message);
          }
          return response.json() as Promise<{ results: PlacePick[] }>;
        })
        .then((data) => {
          setResults(data.results ?? []);
          setOpen(true);
          setActiveIndex(-1);
        })
        .catch((err) => {
          if (controller.signal.aborted) return;
          setResults([]);
          setOpen(false);
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (!controller.signal.aborted) setLoading(false);
        });
    }, 300);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [value]);

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setActiveIndex(-1);
      }
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, []);

  const pick = (place: PlacePick) => {
    suppressSearchRef.current = true;
    onPick(place);
    setOpen(false);
    setActiveIndex(-1);
    setResults([]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (!open || results.length === 0) {
      if (event.key === "Escape") setOpen(false);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? results.length - 1 : index - 1));
    } else if (event.key === "Enter" && activeIndex >= 0) {
      event.preventDefault();
      const selected = results[activeIndex];
      if (selected) pick(selected);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      setActiveIndex(-1);
    }
  };

  return (
    <div className="place-input" ref={rootRef}>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (results.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeIndex >= 0 ? `${listId}-option-${activeIndex}` : undefined}
        autoComplete="off"
      />
      {loading && <p className="place-input-status">Searching…</p>}
      {!loading && error && <p className="form-error">{error}</p>}
      {open && results.length > 0 && (
        <ul className="place-suggestions" id={listId} role="listbox">
          {results.map((place, index) => (
            <li key={`${place.name}-${place.lat}-${place.lng}`}>
              <button
                type="button"
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={index === activeIndex ? "is-active" : undefined}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => pick(place)}
              >
                {place.name}
              </button>
            </li>
          ))}
        </ul>
      )}
      {open && !loading && value.trim().length >= 2 && results.length === 0 && !error && (
        <p className="place-input-status">No matching places</p>
      )}
    </div>
  );
}
