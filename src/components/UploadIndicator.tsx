import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Loader2, UploadCloud, X, AlertTriangle, ChevronDown, ChevronUp, RefreshCw } from "lucide-react";
import { useUploadStore, isActivePhase, albumProgress, type UploadJob } from "../lib/uploads";
import { usePlayer } from "../lib/player";

export default function UploadIndicator() {
  const jobs = useUploadStore((s) => s.jobs);
  const dismiss = useUploadStore((s) => s.dismiss);
  const hasPlayer = usePlayer((s) => Boolean(s.current));
  const [collapsed, setCollapsed] = useState(false);

  // Warn before unload while uploads are in flight.
  useEffect(() => {
    const active = jobs.some((j) => isActivePhase(j.phase));
    if (!active) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [jobs]);

  // Auto-dismiss "done" jobs after 12 seconds so the chip doesn't linger forever.
  // Longer than before so the "Reload to view" affordance is actually clickable.
  useEffect(() => {
    const done = jobs.filter((j) => j.phase === "done");
    if (done.length === 0) return;
    const timers = done.map((j) => {
      const remaining = 12000 - (Date.now() - (j.finishedAt ?? Date.now()));
      return window.setTimeout(() => dismiss(j.id), Math.max(0, remaining));
    });
    return () => timers.forEach((t) => clearTimeout(t));
  }, [jobs, dismiss]);

  const anyDone = jobs.some((j) => j.phase === "done");

  if (jobs.length === 0) return null;

  const bottomOffset = hasPlayer ? "bottom-28 sm:bottom-24" : "bottom-4";

  // Group jobs by albumId so we can show album-aggregate rows when more than one
  // track is uploading to the same album.
  const byAlbum = new Map<string, UploadJob[]>();
  for (const j of jobs) {
    const list = byAlbum.get(j.albumId) ?? [];
    list.push(j);
    byAlbum.set(j.albumId, list);
  }

  return (
    <div
      className={`fixed right-3 sm:right-6 ${bottomOffset} z-40 w-[min(380px,calc(100vw-1.5rem))]`}
      role="status"
      aria-live="polite"
    >
      <div className="bg-panel/95 backdrop-blur border border-edge rounded-xl shadow-2xl overflow-hidden">
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="w-full px-3 py-2 flex items-center gap-2 text-sm hover:bg-panel2/60 transition"
        >
          <UploadCloud size={14} className="text-muted shrink-0" />
          <span className="text-white flex-1 text-left truncate">{summarize(jobs)}</span>
          {collapsed ? <ChevronUp size={14} className="text-muted" /> : <ChevronDown size={14} className="text-muted" />}
        </button>
        {!collapsed && (
          <div className="border-t border-edge max-h-80 overflow-y-auto">
            {Array.from(byAlbum.entries()).map(([albumId, rows]) => (
              <div key={albumId}>
                {rows.length > 1 && <AlbumAggregateRow albumId={albumId} jobs={jobs} />}
                <ul className="divide-y divide-edge">
                  {rows.map((j) => (
                    <UploadRow key={j.id} job={j} onDismiss={() => dismiss(j.id)} indented={rows.length > 1} />
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {anyDone && (
          <button
            onClick={() => window.location.reload()}
            className="w-full px-3 py-2 border-t border-edge text-sm text-accent hover:bg-accent/10 transition flex items-center justify-center gap-1.5"
          >
            <RefreshCw size={14} />
            Reload to view
          </button>
        )}
      </div>
    </div>
  );
}

function summarize(jobs: UploadJob[]): string {
  const active = jobs.filter((j) => isActivePhase(j.phase));
  const errored = jobs.filter((j) => j.phase === "error").length;
  if (active.length > 0) {
    let totalBytes = 0;
    let weighted = 0;
    for (const j of active) {
      const size = Math.max(1, j.fileSize);
      totalBytes += size;
      weighted += size * j.progress;
    }
    const pct = Math.round((weighted / totalBytes) * 100);
    return active.length === 1
      ? `Uploading 1 file · ${pct}%`
      : `Uploading ${active.length} files · ${pct}%`;
  }
  if (errored > 0) return errored === 1 ? "1 upload failed" : `${errored} uploads failed`;
  return jobs.length === 1 ? "Upload complete" : `${jobs.length} uploads complete`;
}

function AlbumAggregateRow({ albumId, jobs }: { albumId: string; jobs: UploadJob[] }) {
  const agg = albumProgress(jobs, albumId);
  if (!agg) return null;
  const rows = jobs.filter((j) => j.albumId === albumId);
  const pct = Math.round(agg.fraction * 100);
  const allDone = rows.every((j) => j.phase === "done");
  const anyError = rows.some((j) => j.phase === "error");
  const active = rows.some((j) => isActivePhase(j.phase));
  return (
    <div className="px-3 py-2 bg-panel2/40 border-b border-edge">
      <div className="flex items-center gap-2 mb-1.5">
        <Link
          to={`/album/${albumId}`}
          className="text-xs uppercase tracking-wider text-muted hover:text-white truncate flex-1"
        >
          Album · {agg.jobCount} tracks
        </Link>
        <span
          className={`text-xs tabular-nums ${
            allDone ? "text-emerald-400" : anyError && !active ? "text-red-400" : "text-white"
          }`}
        >
          {pct}%
        </span>
      </div>
      <ProgressBar fraction={agg.fraction} state={anyError && !active ? "error" : allDone ? "done" : "active"} />
    </div>
  );
}

function UploadRow({ job, onDismiss, indented }: { job: UploadJob; onDismiss: () => void; indented: boolean }) {
  const active = isActivePhase(job.phase);
  const pct = Math.round(job.progress * 100);
  return (
    <li className={`py-2.5 ${indented ? "pl-6 pr-3" : "px-3"} flex items-start gap-2.5`}>
      <div className="mt-0.5 shrink-0">
        {job.phase === "done" ? (
          <CheckCircle2 size={16} className="text-emerald-400" />
        ) : job.phase === "error" ? (
          <AlertTriangle size={16} className="text-red-400" />
        ) : (
          <Loader2 size={16} className="text-accent animate-spin" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <Link
            to={`/track/${job.trackId}`}
            className="text-sm text-white truncate hover:underline flex-1 min-w-0"
            title={job.fileName}
          >
            {job.trackTitle}
          </Link>
          {active && <span className="text-xs text-muted tabular-nums shrink-0">{pct}%</span>}
        </div>
        <div className="text-xs text-muted truncate mb-1">
          {job.phase === "error"
            ? job.error || "Upload failed"
            : job.phase === "done"
              ? "Saved as new version"
              : `${job.message ?? ""} · ${job.fileName}`}
        </div>
        {(active || job.phase === "done") && (
          <ProgressBar
            fraction={job.progress}
            state={job.phase === "done" ? "done" : "active"}
          />
        )}
      </div>
      {!active && (
        <button
          onClick={onDismiss}
          className="text-muted hover:text-white shrink-0 -mr-0.5"
          aria-label="Dismiss"
        >
          <X size={14} />
        </button>
      )}
    </li>
  );
}

function ProgressBar({ fraction, state }: { fraction: number; state: "active" | "done" | "error" }) {
  const pct = Math.max(0, Math.min(1, fraction)) * 100;
  const fill =
    state === "done" ? "bg-emerald-400" : state === "error" ? "bg-red-400" : "bg-accent";
  return (
    <div className="h-1 rounded-full bg-ink overflow-hidden">
      <div
        className={`h-full ${fill} transition-[width] duration-200 ease-out`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
