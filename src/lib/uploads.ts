import { create } from "zustand";
import { supabase } from "./supabase";
import { decodeAudio, detectBpm, detectKey, peaksFromBuffer } from "./audioAnalysis";
import { inferAudioMeta, inferVersionLabel } from "./audio";
import { formatErr } from "./errors";
import type { Track, Version } from "./database.types";

export type UploadPhase =
  | "decoding"
  | "analyzing"
  | "uploading"
  | "saving"
  | "done"
  | "error";

export interface UploadJob {
  id: string;
  fileName: string;
  fileSize: number;
  trackId: string;
  trackTitle: string;
  albumId: string;
  phase: UploadPhase;
  message: string | null;
  error: string | null;
  startedAt: number;
  finishedAt: number | null;
  // 0..1 overall completion. Decode/analyze/save are coarse fixed checkpoints;
  // the upload phase uses real XHR byte-level progress between them.
  progress: number;
  // populated when the job completes successfully — consumers can pick these up
  // to refresh in-page state for the matching track.
  version: Version | null;
  trackPatch: Partial<Track> | null;
}

interface UploadState {
  jobs: UploadJob[];
  enqueue: (opts: {
    file: File;
    track: Track;
    userId: string;
    existingVersionCount: number;
  }) => string;
  dismiss: (id: string) => void;
  clearFinished: () => void;
  hasActive: () => boolean;
}

const PHASE_MESSAGES: Record<Exclude<UploadPhase, "done" | "error">, string> = {
  decoding: "Decoding audio…",
  analyzing: "Analyzing tempo and key…",
  uploading: "Uploading…",
  saving: "Saving…",
};

// Phase weighting for the overall percentage. The upload phase owns the bulk of
// the bar because that's the part that scales with file size; the rest are
// effectively fixed checkpoints.
const UPLOAD_START_PCT = 0.15;
const UPLOAD_END_PCT = 0.9;

async function uploadWithProgress(
  path: string,
  file: File,
  contentType: string,
  onProgress: (fraction: number) => void
): Promise<void> {
  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string;
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token ?? anonKey;
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${supabaseUrl}/storage/v1/object/audio/${path}`);
    xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader("apikey", anonKey);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.setRequestHeader("x-upsert", "false");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve();
      else reject(new Error(`Upload failed (HTTP ${xhr.status}): ${xhr.responseText || xhr.statusText}`));
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new Error("Upload aborted"));
    xhr.send(file);
  });
}

function newId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useUploadStore = create<UploadState>((set, get) => ({
  jobs: [],

  enqueue: ({ file, track, userId, existingVersionCount }) => {
    const id = newId();
    const job: UploadJob = {
      id,
      fileName: file.name,
      fileSize: file.size,
      trackId: track.id,
      trackTitle: track.title,
      albumId: track.album_id,
      phase: "decoding",
      message: PHASE_MESSAGES.decoding,
      error: null,
      startedAt: Date.now(),
      finishedAt: null,
      progress: 0.02,
      version: null,
      trackPatch: null,
    };
    set((s) => ({ jobs: [job, ...s.jobs] }));

    const patch = (p: Partial<UploadJob>) =>
      set((s) => ({ jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...p } : j)) }));

    // Kick off the work in a detached async function so the caller returns immediately.
    (async () => {
      try {
        const audioBuffer = await decodeAudio(file);
        const peaks = peaksFromBuffer(audioBuffer, 1024);
        const duration = audioBuffer.duration;

        patch({ phase: "analyzing", message: PHASE_MESSAGES.analyzing, progress: 0.1 });
        const detectionPromise = Promise.allSettled([
          detectBpm(audioBuffer),
          Promise.resolve(detectKey(audioBuffer)),
        ]);

        patch({ phase: "uploading", message: PHASE_MESSAGES.uploading, progress: UPLOAD_START_PCT });
        const ext = (file.name.split(".").pop() || "wav").toLowerCase();
        const path = `${userId}/${track.id}/${Date.now()}.${ext}`;
        let lastEmit = 0;
        let lastFrac = 0;
        await uploadWithProgress(path, file, file.type || "audio/mpeg", (frac) => {
          const now = Date.now();
          // Throttle: emit at most every 120ms, but always emit on big jumps.
          if (now - lastEmit < 120 && frac - lastFrac < 0.05 && frac < 1) return;
          lastEmit = now;
          lastFrac = frac;
          const pct = UPLOAD_START_PCT + frac * (UPLOAD_END_PCT - UPLOAD_START_PCT);
          patch({ progress: pct });
        });

        patch({ phase: "saving", message: PHASE_MESSAGES.saving, progress: UPLOAD_END_PCT });
        const label = inferVersionLabel(file.name, existingVersionCount);
        const ins = await supabase
          .from("versions")
          .insert({ track_id: track.id, label, storage_path: path, duration_sec: duration, peaks })
          .select()
          .single();
        if (ins.error) throw ins.error;
        const newVersion = ins.data as Version;

        const fromFilename = inferAudioMeta(file.name);
        const [bpmResult, keyResult] = await detectionPromise;
        const detectedBpm = bpmResult.status === "fulfilled" ? bpmResult.value : null;
        const detectedKeyObj = keyResult.status === "fulfilled" ? keyResult.value : null;
        const detectedKey = detectedKeyObj?.key ?? null;

        const newBpm = fromFilename.bpm ?? detectedBpm;
        const newKey = fromFilename.key ?? detectedKey;

        const trackPatch: Partial<Track> & { current_version_id: string } = {
          current_version_id: newVersion.id,
        };
        if (newBpm != null && track.bpm == null) trackPatch.bpm = newBpm;
        if (newKey != null && !track.song_key) trackPatch.song_key = newKey;

        const updateRes = await supabase.from("tracks").update(trackPatch).eq("id", track.id);
        if (updateRes.error) console.error("[upload] track update failed", updateRes.error);

        patch({
          phase: "done",
          message: null,
          finishedAt: Date.now(),
          progress: 1,
          version: newVersion,
          trackPatch,
        });
      } catch (e) {
        console.error("[upload] failed", e);
        patch({
          phase: "error",
          message: null,
          error: formatErr(e),
          finishedAt: Date.now(),
        });
      }
    })();

    return id;
  },

  dismiss: (id) => set((s) => ({ jobs: s.jobs.filter((j) => j.id !== id) })),

  clearFinished: () =>
    set((s) => ({ jobs: s.jobs.filter((j) => j.phase !== "done" && j.phase !== "error") })),

  hasActive: () => get().jobs.some((j) => j.phase !== "done" && j.phase !== "error"),
}));

export function isActivePhase(p: UploadPhase): boolean {
  return p !== "done" && p !== "error";
}

// Weighted album-level percentage across all jobs (active + completed) for an
// album. Weighting is by fileSize so a 200 MB stem doesn't get drowned out by a
// 5 MB one. Returns null when there are no jobs for the album.
export function albumProgress(jobs: UploadJob[], albumId: string): { fraction: number; jobCount: number } | null {
  const rows = jobs.filter((j) => j.albumId === albumId);
  if (rows.length === 0) return null;
  let totalBytes = 0;
  let weightedBytes = 0;
  for (const j of rows) {
    const size = Math.max(1, j.fileSize);
    totalBytes += size;
    weightedBytes += size * (j.phase === "error" ? 0 : j.progress);
  }
  return { fraction: weightedBytes / totalBytes, jobCount: rows.length };
}
