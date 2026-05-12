import { supabase } from "./supabase";

export async function getSignedAudioUrl(storagePath: string, expiresInSec = 3600): Promise<string> {
  const { data, error } = await supabase.storage.from("audio").createSignedUrl(storagePath, expiresInSec);
  if (error) throw error;
  return data.signedUrl;
}

export async function downloadAudio(url: string, suggestedFilename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (HTTP ${res.status})`);
  const blob = await res.blob();
  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = suggestedFilename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(objUrl), 1500);
}

export function safeFilename(s: string): string {
  return s.replace(/[\\/:*?"<>|]+/g, "").trim().slice(0, 80) || "track";
}

export function fmtTime(sec: number): string {
  if (!isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

const STAGE_LABELS: { pattern: RegExp; label: string }[] = [
  { pattern: /\brough\s*mix\b/i, label: "rough mix" },
  { pattern: /\brough\b/i, label: "rough" },
  { pattern: /\bdemo\b/i, label: "demo" },
  { pattern: /\bidea\b/i, label: "idea" },
  { pattern: /\bsketch\b/i, label: "sketch" },
  { pattern: /\bmaster(ed)?\b/i, label: "master" },
  { pattern: /\bmix(ed|down)?\b/i, label: "mix" },
  { pattern: /\bfinal\b/i, label: "final" },
  { pattern: /\bwip\b/i, label: "WIP" },
  { pattern: /\bbounce\b/i, label: "bounce" },
];

export function inferVersionLabel(filename: string, existingCount: number): string {
  const stem = filename.replace(/\.[^.]+$/, "");
  const num = stem.match(/\b(?:v|ver|version|rev)\.?\s*(\d{1,3})\b/i);
  if (num) return `v${parseInt(num[1], 10)}`;
  for (const { pattern, label } of STAGE_LABELS) {
    if (pattern.test(stem)) return label;
  }
  return `v${existingCount + 1}`;
}

export interface InferredAudioMeta {
  bpm: number | null;
  key: string | null;
}

export function inferAudioMeta(filename: string): InferredAudioMeta {
  const stem = filename.replace(/\.[^.]+$/, "");
  return { bpm: extractBpm(stem), key: extractKey(stem) };
}

function extractBpm(stem: string): number | null {
  // "120 bpm", "120bpm", "bpm 120", "120.5 bpm"
  let m = stem.match(/(\d{2,3}(?:\.\d+)?)\s*(?:bpm|BPM)\b/);
  if (!m) m = stem.match(/\b(?:bpm|BPM)[\s_\-]*(\d{2,3}(?:\.\d+)?)/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (n < 30 || n > 300) return null;
  return Math.round(n * 10) / 10;
}

function extractKey(stem: string): string | null {
  // Normalize unicode sharps/flats
  const s = stem.replace(/♯/g, "#").replace(/♭/g, "b");
  // Strong match: explicit major/minor word
  let m = s.match(/(?:^|[\s_\-(/])([A-G][#b]?)\s*(major|minor)\b/i);
  if (m) return normalizeKey(m[1], /^maj/i.test(m[2]));
  // Short form: Cmaj / Cmin / Cm / C# / etc, but require a separator before so we don't grab a stray letter from a song title
  m = s.match(/(?:^|[\s_\-(/])([A-G][#b]?)(maj|min|m)(?=$|[\s_\-)/])/);
  if (m) {
    const isMajor = m[2] === "maj";
    const isMinor = m[2] === "m" || m[2] === "min";
    return normalizeKey(m[1], isMajor && !isMinor);
  }
  return null;
}

function normalizeKey(root: string, major: boolean): string {
  const r = root[0].toUpperCase() + (root.slice(1) || "");
  return major ? `${r}` : `${r}m`;
}
