import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X, Music, Disc3 } from "lucide-react";
import { supabase } from "../lib/supabase";

type AlbumResult = {
  kind: "album";
  id: string;
  title: string;
  artwork_url: string | null;
};

type TrackResult = {
  kind: "track";
  id: string;
  title: string;
  album_id: string;
  album_title: string | null;
  album_artwork_url: string | null;
};

type Result = AlbumResult | TrackResult;

export default function HeaderSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mobileInputRef = useRef<HTMLInputElement | null>(null);

  const trimmed = query.trim();

  // Debounced search
  useEffect(() => {
    if (!trimmed) {
      setResults([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      const pattern = `%${trimmed.replace(/[%_]/g, "\\$&")}%`;
      const [albumsRes, tracksRes] = await Promise.all([
        supabase
          .from("albums")
          .select("id, title, artwork_url")
          .ilike("title", pattern)
          .limit(5),
        supabase
          .from("tracks")
          .select("id, title, album_id, albums(title, artwork_url)")
          .ilike("title", pattern)
          .limit(8),
      ]);

      const albums: AlbumResult[] = (albumsRes.data ?? []).map((a: any) => ({
        kind: "album",
        id: a.id,
        title: a.title,
        artwork_url: a.artwork_url,
      }));
      const tracks: TrackResult[] = (tracksRes.data ?? []).map((t: any) => ({
        kind: "track",
        id: t.id,
        title: t.title,
        album_id: t.album_id,
        album_title: t.albums?.title ?? null,
        album_artwork_url: t.albums?.artwork_url ?? null,
      }));

      setResults([...albums, ...tracks]);
      setActiveIdx(-1);
      setLoading(false);
    }, 180);
    return () => clearTimeout(handle);
  }, [trimmed]);

  // Click outside closes desktop dropdown
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Focus mobile input when opening
  useEffect(() => {
    if (mobileOpen) {
      setTimeout(() => mobileInputRef.current?.focus(), 0);
    }
  }, [mobileOpen]);

  // Cmd/Ctrl+K to focus
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        if (window.matchMedia("(min-width: 640px)").matches) {
          inputRef.current?.focus();
          setOpen(true);
        } else {
          setMobileOpen(true);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const grouped = useMemo(() => {
    const albums = results.filter((r): r is AlbumResult => r.kind === "album");
    const tracks = results.filter((r): r is TrackResult => r.kind === "track");
    return { albums, tracks };
  }, [results]);

  const navigateTo = (r: Result) => {
    if (r.kind === "album") navigate(`/album/${r.id}`);
    else navigate(`/track/${r.id}`);
    closeAll();
  };

  const closeAll = () => {
    setQuery("");
    setResults([]);
    setOpen(false);
    setMobileOpen(false);
    setActiveIdx(-1);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      closeAll();
      return;
    }
    if (results.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => (i <= 0 ? results.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const target = activeIdx >= 0 ? results[activeIdx] : results[0];
      if (target) navigateTo(target);
    }
  };

  const showDropdown = open && trimmed.length > 0;

  const renderResults = (onPick: (r: Result) => void) => {
    if (loading && results.length === 0) {
      return <div className="px-3 py-4 text-sm text-muted">Searching…</div>;
    }
    if (!loading && results.length === 0) {
      return <div className="px-3 py-4 text-sm text-muted">No matches for “{trimmed}”.</div>;
    }
    let runningIdx = -1;
    return (
      <div className="py-1">
        {grouped.albums.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted">Albums</div>
            {grouped.albums.map((a) => {
              runningIdx++;
              const idx = runningIdx;
              return (
                <button
                  key={`a-${a.id}`}
                  type="button"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => onPick(a)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${
                    activeIdx === idx ? "bg-panel2" : "hover:bg-panel2/60"
                  }`}
                >
                  <Thumb url={a.artwork_url} fallback={<Disc3 size={14} />} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{a.title}</div>
                    <div className="text-[11px] text-muted">Album</div>
                  </div>
                </button>
              );
            })}
          </>
        )}
        {grouped.tracks.length > 0 && (
          <>
            <div className="px-3 pt-2 pb-1 text-[10px] uppercase tracking-wider text-muted">Tracks</div>
            {grouped.tracks.map((t) => {
              runningIdx++;
              const idx = runningIdx;
              return (
                <button
                  key={`t-${t.id}`}
                  type="button"
                  onMouseEnter={() => setActiveIdx(idx)}
                  onClick={() => onPick(t)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-left transition ${
                    activeIdx === idx ? "bg-panel2" : "hover:bg-panel2/60"
                  }`}
                >
                  <Thumb url={t.album_artwork_url} fallback={<Music size={14} />} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{t.title}</div>
                    <div className="text-[11px] text-muted truncate">
                      {t.album_title ? `Track · ${t.album_title}` : "Track"}
                    </div>
                  </div>
                </button>
              );
            })}
          </>
        )}
      </div>
    );
  };

  return (
    <>
      {/* Desktop: inline search */}
      <div ref={wrapRef} className="hidden sm:block relative w-56 md:w-72">
        <div className="relative">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder="Search tracks and albums"
            aria-label="Search tracks and albums"
            className="w-full bg-panel2 border border-edge focus:border-accent focus:outline-none rounded-md pl-8 pr-8 py-1.5 text-sm text-white placeholder:text-muted"
          />
          {query && (
            <button
              type="button"
              onClick={closeAll}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-white"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {showDropdown && (
          <div className="absolute right-0 mt-1.5 w-80 max-w-[90vw] bg-panel border border-edge rounded-lg shadow-xl overflow-hidden max-h-[60vh] overflow-y-auto z-30">
            {renderResults(navigateTo)}
          </div>
        )}
      </div>

      {/* Mobile: icon button */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        aria-label="Search"
        className="sm:hidden w-8 h-8 rounded-full bg-panel2 border border-edge hover:border-muted/60 flex items-center justify-center text-muted"
      >
        <Search size={15} />
      </button>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="sm:hidden fixed inset-0 z-40 bg-ink/95 backdrop-blur flex flex-col">
          <div className="flex items-center gap-2 px-3 py-2 border-b border-edge">
            <div className="relative flex-1">
              <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted pointer-events-none" />
              <input
                ref={mobileInputRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search tracks and albums"
                aria-label="Search tracks and albums"
                className="w-full bg-panel2 border border-edge focus:border-accent focus:outline-none rounded-md pl-8 pr-3 py-2 text-sm text-white placeholder:text-muted"
              />
            </div>
            <button
              type="button"
              onClick={closeAll}
              className="text-muted hover:text-white text-sm px-2 py-1"
            >
              Cancel
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {trimmed ? renderResults(navigateTo) : (
              <div className="px-3 py-4 text-sm text-muted">Type to search your tracks and albums.</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}

function Thumb({ url, fallback }: { url: string | null; fallback: React.ReactNode }) {
  return (
    <div className="w-8 h-8 rounded bg-panel2 border border-edge overflow-hidden flex items-center justify-center text-muted shrink-0">
      {url ? <img src={url} alt="" className="w-full h-full object-cover" /> : fallback}
    </div>
  );
}
