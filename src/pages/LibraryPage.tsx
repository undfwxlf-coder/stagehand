import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { useAuth } from "../lib/auth";
import { useLibraryStore } from "../lib/library";
import type { Album, AlbumStatus } from "../lib/database.types";
import { Music } from "lucide-react";

const STATUS_COLORS: Record<AlbumStatus, string> = {
  writing: "bg-slate-500/20 text-slate-300",
  recording: "bg-blue-500/20 text-blue-300",
  mixing: "bg-purple-500/20 text-purple-300",
  mastering: "bg-amber-500/20 text-amber-300",
  released: "bg-emerald-500/20 text-emerald-300",
};

export default function LibraryPage() {
  const { user } = useAuth();
  const albums = useLibraryStore((s) => s.albums);
  const collabs = useLibraryStore((s) => s.collabs);
  const loaded = useLibraryStore((s) => s.loaded);
  const refreshing = useLibraryStore((s) => s.refreshing);
  const loadLibrary = useLibraryStore((s) => s.load);
  const prependAlbum = useLibraryStore((s) => s.prepend);
  const [showNew, setShowNew] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // Hydrate on first mount; on subsequent mounts run a quiet background refresh.
  useEffect(() => {
    loadLibrary();
  }, [loadLibrary]);

  const loading = !loaded && refreshing;

  const createAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTitle.trim() || !user) return;
    setCreating(true);
    const { data, error } = await supabase
      .from("albums")
      .insert({ owner_id: user.id, title: newTitle.trim() })
      .select()
      .single();
    setCreating(false);
    if (error) {
      alert(error.message);
      return;
    }
    prependAlbum(data as Album);
    setNewTitle("");
    setShowNew(false);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8">
      <div className="flex items-end justify-between gap-3 mb-5 sm:mb-6">
        <div className="min-w-0">
          <h1 className="text-xl sm:text-2xl font-semibold text-white">Your library</h1>
          <p className="text-xs sm:text-sm text-muted mt-1">Albums and EPs you're working on.</p>
        </div>
        <button
          onClick={() => setShowNew((v) => !v)}
          className="bg-accent hover:bg-accent/90 text-white text-sm font-medium px-3 sm:px-4 py-2 rounded-lg transition shrink-0"
        >
          <span className="hidden sm:inline">+ New album</span>
          <span className="sm:hidden">+ New</span>
        </button>
      </div>

      {showNew && (
        <form onSubmit={createAlbum} className="bg-panel border border-edge rounded-xl p-3 sm:p-4 mb-6 flex flex-wrap gap-2 sm:gap-3">
          <input
            autoFocus
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            placeholder="Album title"
            className="flex-1 min-w-0 bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-muted"
          />
          <button
            type="submit"
            disabled={creating}
            className="bg-accent hover:bg-accent/90 disabled:opacity-60 text-white text-sm font-medium px-4 py-2 rounded-lg"
          >
            Create
          </button>
          <button
            type="button"
            onClick={() => setShowNew(false)}
            className="text-muted hover:text-white text-sm px-3 py-2"
          >
            Cancel
          </button>
        </form>
      )}

      {loading ? (
        <SkeletonGrid />
      ) : albums.length === 0 && collabs.length === 0 ? (
        <EmptyState onCreate={() => setShowNew(true)} />
      ) : (
        <>
          {albums.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
              {albums.map((a) => (
                <Link
                  key={a.id}
                  to={`/album/${a.id}`}
                  className="group bg-panel border border-edge rounded-xl overflow-hidden hover:border-accent/60 transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.97] active:duration-100"
                >
                  <div className="aspect-square bg-gradient-to-br from-panel2 to-ink flex items-center justify-center text-edge group-hover:text-muted transition">
                    {a.artwork_url ? (
                      <img src={a.artwork_url} alt="" className="w-full h-full object-cover" />
                    ) : (
                      <Music size={40} strokeWidth={1.2} />
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-sm text-white truncate">{a.title}</div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <span className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded ${STATUS_COLORS[a.status]}`}>
                        {a.status}
                      </span>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}

          {collabs.length > 0 && (
            <div className={albums.length > 0 ? "mt-10" : ""}>
              <h2 className="text-sm sm:text-base font-medium text-white mb-3">Shared with me</h2>
              <p className="text-xs text-muted mb-4">Projects you're a collaborator on.</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
                {collabs.map((a) => (
                  <Link
                    key={a.id}
                    to={`/album/${a.id}`}
                    className="group bg-panel border border-edge rounded-xl overflow-hidden hover:border-accent/60 transition-[transform,border-color] duration-150 ease-out hover:-translate-y-0.5 active:scale-[0.97] active:duration-100 relative"
                  >
                    <span className="absolute top-2 right-2 z-10 text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/70 text-white/90 backdrop-blur">
                      Editor
                    </span>
                    <div className="aspect-square bg-gradient-to-br from-panel2 to-ink flex items-center justify-center text-edge group-hover:text-muted transition">
                      {a.artwork_url ? (
                        <img src={a.artwork_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <Music size={40} strokeWidth={1.2} />
                      )}
                    </div>
                    <div className="p-3">
                      <div className="text-sm text-white truncate">{a.title}</div>
                      <div className="mt-1.5 flex items-center gap-2 min-w-0">
                        <span className="text-[10px] text-muted truncate">
                          {a.owner_artist_name ?? "Unknown artist"}
                        </span>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3 sm:gap-5">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="bg-panel border border-edge rounded-xl overflow-hidden animate-pulse">
          <div className="aspect-square bg-panel2" />
          <div className="p-3 space-y-2">
            <div className="h-3 bg-panel2 rounded w-3/4" />
            <div className="h-2 bg-panel2 rounded w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onCreate }: { onCreate: () => void }) {
  return (
    <div className="bg-panel border border-dashed border-edge rounded-2xl py-20 text-center">
      <Music size={48} strokeWidth={1.2} className="mx-auto mb-3 text-muted" />
      <h2 className="text-lg text-white">No albums yet</h2>
      <p className="text-sm text-muted mt-1 mb-5">Start a new project to track your songs and stash demos.</p>
      <button
        onClick={onCreate}
        className="bg-accent hover:bg-accent/90 text-white text-sm font-medium px-5 py-2.5 rounded-lg"
      >
        Create your first album
      </button>
    </div>
  );
}
