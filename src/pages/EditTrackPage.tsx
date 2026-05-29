import { useEffect, useMemo, useRef, useState } from "react";

import { formatErr } from "../lib/errors";
import { useNavigate, useParams } from "react-router-dom";
import { Pause, Play, RotateCcw, SkipBack } from "lucide-react";
import { supabase } from "../lib/supabase";
import { getSignedAudioUrl, fmtTime } from "../lib/audio";
import { TrackEditor, DEFAULT_SETTINGS, EQ_FREQ_RANGES, loadAudioBufferFromUrl } from "../lib/trackEditor";
import type { EditorSettings, EQBandSettings } from "../lib/trackEditor";
import type { Track, Version, Album } from "../lib/database.types";

type Tab = "adjust" | "stems" | "eq";

export default function EditTrackPage() {
  const { trackId } = useParams<{ trackId: string }>();
  const navigate = useNavigate();
  const [track, setTrack] = useState<Track | null>(null);
  const [album, setAlbum] = useState<Album | null>(null);
  const [version, setVersion] = useState<Version | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingAudio, setLoadingAudio] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [tab, setTab] = useState<Tab>("adjust");
  const [settings, setSettings] = useState<EditorSettings>(DEFAULT_SETTINGS);
  const [saving, setSaving] = useState(false);

  const editorRef = useRef<TrackEditor | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const initialSettingsRef = useRef<EditorSettings>(DEFAULT_SETTINGS);

  // Fetch metadata
  useEffect(() => {
    if (!trackId) return;
    let cancel = false;
    (async () => {
      const tRes = await supabase.from("tracks").select("*").eq("id", trackId).single();
      if (cancel) return;
      if (tRes.error || !tRes.data) {
        setError(tRes.error?.message ?? "Track not found");
        return;
      }
      const t = tRes.data as Track;
      setTrack(t);
      if (t.editor_settings && typeof t.editor_settings === "object") {
        const hydrated = { ...DEFAULT_SETTINGS, ...(t.editor_settings as Partial<EditorSettings>) };
        initialSettingsRef.current = hydrated;
        setSettings(hydrated);
      }
      if (t.current_version_id) {
        const [vRes, aRes] = await Promise.all([
          supabase.from("versions").select("*").eq("id", t.current_version_id).single(),
          supabase.from("albums").select("*").eq("id", t.album_id).single(),
        ]);
        if (cancel) return;
        if (vRes.data) setVersion(vRes.data as Version);
        if (aRes.data) setAlbum(aRes.data as Album);
      }
    })();
    return () => {
      cancel = true;
    };
  }, [trackId]);

  // Initialize audio engine once a current version exists
  useEffect(() => {
    if (!version) return;
    let cancel = false;
    (async () => {
      try {
        const url = await getSignedAudioUrl(version.storage_path);
        const ctx = new AudioContext();
        ctxRef.current = ctx;
        const buf = await loadAudioBufferFromUrl(ctx, url);
        if (cancel) {
          ctx.close();
          return;
        }
        const editor = new TrackEditor(ctx, buf);
        // Apply any hydrated settings before user touches anything.
        const s = initialSettingsRef.current;
        editor.setSpeed(s.speed);
        editor.setPitch(s.pitchSemitones);
        s.eqBands.forEach((b, i) => editor.setEQBand(i, b));
        editor.setEQBypass(s.eqBypass);
        editor.setDelayWet(s.delayWet);
        editor.setDelayTime(s.delayTimeSec);
        editor.setDelayFeedback(s.delayFeedback);
        editor.setReverbWet(s.reverbWet);
        editor.onProgress = (sec) => {
          setPosition(sec);
          if (sec >= editor.durationSec - 0.05) {
            editor.pause();
            setIsPlaying(false);
          }
        };
        editorRef.current = editor;
        setLoadingAudio(false);
      } catch (e) {
        if (!cancel) setError(formatErr(e));
      }
    })();
    return () => {
      cancel = true;
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
      if (ctxRef.current) {
        ctxRef.current.close().catch(() => {});
        ctxRef.current = null;
      }
    };
  }, [version]);

  const togglePlay = async () => {
    const ed = editorRef.current;
    if (!ed) return;
    if (ed.isPlaying) {
      ed.pause();
      setIsPlaying(false);
    } else {
      await ed.play();
      setIsPlaying(true);
    }
  };

  const restart = () => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.seek(0);
    setPosition(0);
  };

  const update = (patch: Partial<EditorSettings>) => {
    setSettings((s) => ({ ...s, ...patch }));
    const ed = editorRef.current;
    if (!ed) return;
    if (patch.speed !== undefined) ed.setSpeed(patch.speed);
    if (patch.pitchSemitones !== undefined) ed.setPitch(patch.pitchSemitones);
    if (patch.eqBands) patch.eqBands.forEach((b, i) => ed.setEQBand(i, b));
    if (patch.eqBypass !== undefined) ed.setEQBypass(patch.eqBypass);
    if (patch.delayWet !== undefined) ed.setDelayWet(patch.delayWet);
    if (patch.delayFeedback !== undefined) ed.setDelayFeedback(patch.delayFeedback);
    if (patch.delayTimeSec !== undefined) ed.setDelayTime(patch.delayTimeSec);
    if (patch.reverbWet !== undefined) ed.setReverbWet(patch.reverbWet);
  };

  const cancel = () => {
    if (editorRef.current) editorRef.current.pause();
    navigate(-1);
  };

  const save = async () => {
    if (!trackId) return;
    if (editorRef.current) editorRef.current.pause();
    setSaving(true);
    setError(null);
    const isDefault = JSON.stringify(settings) === JSON.stringify(DEFAULT_SETTINGS);
    const { error: e } = await supabase
      .from("tracks")
      .update({ editor_settings: isDefault ? null : settings })
      .eq("id", trackId);
    setSaving(false);
    if (e) {
      setError(e.message);
      return;
    }
    navigate(-1);
  };

  const duration = editorRef.current?.durationSec ?? version?.duration_sec ?? 0;
  const percent = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div className="fixed inset-0 bg-ink flex flex-col text-white">
      <header
        className="flex items-center justify-between px-4 sm:px-6 pb-2"
        style={{ paddingTop: "max(1rem, env(safe-area-inset-top))" }}
      >
        <button
          type="button"
          onClick={cancel}
          className="px-3 py-1.5 rounded-full bg-panel2 hover:bg-edge text-sm text-white/90"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="px-3 py-1.5 rounded-full bg-panel2 hover:bg-edge text-sm text-white/90 disabled:opacity-60"
        >
          {saving ? "Saving…" : "Save"}
        </button>
      </header>

      <div className="text-center mt-2 px-6">
        <h1 className="text-xl sm:text-2xl font-semibold tracking-tight uppercase truncate">
          {track?.title ?? ""}
        </h1>
        <p className="text-xs sm:text-sm text-muted mt-1 truncate">
          {album?.title ?? ""}
        </p>
      </div>

      <div className="flex justify-center gap-2 mt-3">
        {track?.song_key && <Pill>{track.song_key}</Pill>}
        {track?.bpm && <Pill>{Math.round(track.bpm)} BPM</Pill>}
        <Pill muted>Settings</Pill>
      </div>

      <div className="px-6 mt-6 flex-1 flex flex-col min-h-0">
        <Waveform peaks={version?.peaks ?? null} percent={percent} />

        <div className="text-center text-sm text-muted mt-3 tabular-nums">
          {fmtTime(position)} / {fmtTime(duration)}
        </div>

        <div className="flex items-center justify-between mt-4 px-2">
          <IconBtn onClick={restart} aria-label="Restart">
            <SkipBack size={18} />
          </IconBtn>
          <button
            type="button"
            onClick={togglePlay}
            disabled={loadingAudio || !version}
            className="px-6 py-3 rounded-xl bg-panel2 hover:bg-edge disabled:opacity-50 disabled:cursor-not-allowed transition"
            aria-label={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? <Pause size={20} /> : <Play size={20} fill="currentColor" />}
          </button>
          <IconBtn
            onClick={() => update(DEFAULT_SETTINGS)}
            aria-label="Reset all"
            title="Reset all"
          >
            <RotateCcw size={18} />
          </IconBtn>
        </div>

        <div className="flex-1 overflow-y-auto mt-6">
          {tab === "adjust" && <AdjustTab settings={settings} onChange={update} />}
          {tab === "eq" && <EQTab settings={settings} onChange={update} />}
          {tab === "stems" && <StemsTab />}
        </div>
      </div>

      <nav className="border-t border-edge bg-panel/40 backdrop-blur flex items-center justify-around px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <TabBtn active={tab === "adjust"} onClick={() => setTab("adjust")}>Adjust</TabBtn>
        <TabBtn active={tab === "stems"} onClick={() => setTab("stems")}>Stems</TabBtn>
        <TabBtn active={tab === "eq"} onClick={() => setTab("eq")}>EQ</TabBtn>
      </nav>

      {error && (
        <div className="absolute top-16 left-1/2 -translate-x-1/2 bg-red-500/20 border border-red-500/50 text-red-200 text-sm px-3 py-2 rounded-lg max-w-xs text-center">
          {error}
        </div>
      )}
    </div>
  );
}

function Pill({ children, muted }: { children: React.ReactNode; muted?: boolean }) {
  return (
    <span
      className={`text-xs px-3 py-1 rounded-full border ${
        muted
          ? "border-edge text-muted bg-panel2/50"
          : "border-edge text-white bg-panel2"
      }`}
    >
      {children}
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  onClick: () => void;
} & React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-12 h-12 rounded-xl bg-panel2 hover:bg-edge transition flex items-center justify-center text-white"
      {...rest}
    >
      {children}
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-5 py-2 rounded-full text-sm transition ${
        active ? "bg-panel2 text-white" : "text-muted hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function Waveform({ peaks, percent }: { peaks: number[] | null; percent: number }) {
  const bars = useMemo(() => {
    if (!peaks || peaks.length === 0) {
      return Array.from({ length: 96 }, () => 0.05 + Math.random() * 0.4);
    }
    // Downsample to ~96 bars
    const target = 96;
    const stride = Math.max(1, Math.floor(peaks.length / target));
    const out: number[] = [];
    for (let i = 0; i < peaks.length; i += stride) {
      let max = 0;
      for (let j = 0; j < stride && i + j < peaks.length; j++) {
        max = Math.max(max, Math.abs(peaks[i + j]));
      }
      out.push(max);
    }
    return out;
  }, [peaks]);

  return (
    <div className="relative w-full h-44 sm:h-56 flex items-center justify-center">
      <div className="absolute inset-0 flex items-center gap-[2px] px-1">
        {bars.map((v, i) => (
          <div
            key={i}
            className="flex-1 bg-white/85 rounded-full"
            style={{ height: `${Math.max(4, v * 100)}%` }}
          />
        ))}
      </div>
      <div
        className="absolute top-0 bottom-0 w-[2px] bg-accent shadow-[0_0_8px_rgba(187,10,33,0.6)]"
        style={{ left: `${percent}%` }}
      />
    </div>
  );
}

function AdjustTab({
  settings,
  onChange,
}: {
  settings: EditorSettings;
  onChange: (patch: Partial<EditorSettings>) => void;
}) {
  return (
    <div className="space-y-6 pb-4">
      <SliderRow
        label="Speed"
        value={settings.speed}
        min={0.5}
        max={2}
        step={0.01}
        format={(v) => `${v.toFixed(2)}x`}
        onChange={(v) => onChange({ speed: v })}
        onReset={() => onChange({ speed: 1 })}
      />
      <SliderRow
        label="Pitch"
        value={settings.pitchSemitones}
        min={-12}
        max={12}
        step={1}
        format={(v) => (v > 0 ? `+${v} st` : `${v} st`)}
        onChange={(v) => onChange({ pitchSemitones: v })}
        onReset={() => onChange({ pitchSemitones: 0 })}
      />
    </div>
  );
}

function EQTab({
  settings,
  onChange,
}: {
  settings: EditorSettings;
  onChange: (patch: Partial<EditorSettings>) => void;
}) {
  const updateBand = (idx: number, patch: Partial<EQBandSettings>) => {
    const next = settings.eqBands.map((b, i) => (i === idx ? { ...b, ...patch } : b));
    onChange({ eqBands: next });
  };

  return (
    <div className="space-y-6 pb-4">
      <section>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm text-white font-medium">Equalizer</h3>
          <button
            type="button"
            onClick={() => onChange({ eqBypass: !settings.eqBypass })}
            className={`text-[11px] uppercase tracking-wider px-3 py-1 rounded-full border transition ${
              settings.eqBypass
                ? "bg-accent/15 border-accent/40 text-accent"
                : "bg-panel2 border-edge text-muted hover:text-white"
            }`}
            aria-pressed={settings.eqBypass}
          >
            Bypass
          </button>
        </div>
        <EQGraph
          bands={settings.eqBands}
          bypassed={settings.eqBypass}
          onChange={updateBand}
        />
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted mb-2">Delay</h3>
        <div className="space-y-3">
          <SliderRow
            label="Amount"
            value={settings.delayWet}
            min={0}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onChange({ delayWet: v })}
            onReset={() => onChange({ delayWet: 0 })}
          />
          <SliderRow
            label="Time"
            value={settings.delayTimeSec}
            min={0.05}
            max={1}
            step={0.01}
            format={(v) => `${Math.round(v * 1000)} ms`}
            onChange={(v) => onChange({ delayTimeSec: v })}
            onReset={() => onChange({ delayTimeSec: 0.35 })}
          />
          <SliderRow
            label="Feedback"
            value={settings.delayFeedback}
            min={0}
            max={0.9}
            step={0.01}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onChange({ delayFeedback: v })}
            onReset={() => onChange({ delayFeedback: 0.35 })}
          />
        </div>
      </section>

      <section>
        <h3 className="text-xs uppercase tracking-wider text-muted mb-2">Reverb</h3>
        <SliderRow
          label="Amount"
          value={settings.reverbWet}
          min={0}
          max={1}
          step={0.01}
          format={(v) => `${Math.round(v * 100)}%`}
          onChange={(v) => onChange({ reverbWet: v })}
          onReset={() => onChange({ reverbWet: 0 })}
        />
      </section>
    </div>
  );
}

function StemsTab() {
  return (
    <div className="py-10 text-center">
      <p className="text-sm text-muted">Vocals · Drums · Bass · Other</p>
      <p className="text-xs text-muted/70 mt-2 max-w-xs mx-auto">
        Stem separation is coming soon. You'll be able to isolate each part of the track for solo, mute, and level control.
      </p>
      <span className="inline-block mt-4 text-[10px] uppercase tracking-wider text-accent bg-accent/10 px-2 py-0.5 rounded">
        Coming soon
      </span>
    </div>
  );
}

function EQGraph({
  bands,
  bypassed,
  onChange,
}: {
  bands: EQBandSettings[];
  bypassed: boolean;
  onChange: (idx: number, patch: Partial<EQBandSettings>) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [W, setW] = useState(800);
  const H = 180;
  const PAD_X = 18;
  const PAD_Y = 18;
  const innerW = W - PAD_X * 2;
  const innerH = H - PAD_Y * 2;

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setW(Math.max(280, el.clientWidth));
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const F_MIN = 20;
  const F_MAX = 20000;
  const GAIN_MAX = 12;

  const freqToX = (f: number) => {
    const t = Math.log(f / F_MIN) / Math.log(F_MAX / F_MIN);
    return PAD_X + t * innerW;
  };
  const xToFreq = (x: number) => {
    const t = (x - PAD_X) / innerW;
    return F_MIN * Math.pow(F_MAX / F_MIN, Math.max(0, Math.min(1, t)));
  };
  const gainToY = (g: number) => PAD_Y + ((GAIN_MAX - g) / (GAIN_MAX * 2)) * innerH;
  const yToGain = (y: number) => GAIN_MAX - ((y - PAD_Y) / innerH) * (GAIN_MAX * 2);

  const points = bands.map((b) => ({
    x: freqToX(b.frequency),
    y: gainToY(bypassed ? 0 : b.gain),
  }));

  // Smooth curve through points using a Catmull-Rom-ish approximation.
  const curve = (() => {
    if (points.length < 2) return "";
    const pts = [
      { x: PAD_X, y: points[0].y },
      ...points,
      { x: W - PAD_X, y: points[points.length - 1].y },
    ];
    let d = `M ${pts[0].x} ${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[Math.max(0, i - 1)];
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const p3 = pts[Math.min(pts.length - 1, i + 2)];
      const c1x = p1.x + (p2.x - p0.x) / 6;
      const c1y = p1.y + (p2.y - p0.y) / 6;
      const c2x = p2.x - (p3.x - p1.x) / 6;
      const c2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${c1x} ${c1y}, ${c2x} ${c2y}, ${p2.x} ${p2.y}`;
    }
    return d;
  })();

  const eventToLocal = (e: React.PointerEvent) => {
    const svg = svgRef.current;
    if (!svg) return { x: 0, y: 0 };
    const rect = svg.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * W;
    const y = ((e.clientY - rect.top) / rect.height) * H;
    return { x, y };
  };

  const onPointerDown = (e: React.PointerEvent, idx: number) => {
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    setDragIdx(idx);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (dragIdx === null) return;
    const { x, y } = eventToLocal(e);
    const [fMin, fMax] = EQ_FREQ_RANGES[dragIdx];
    const rawFreq = xToFreq(x);
    const freq = Math.max(fMin, Math.min(fMax, rawFreq));
    const gain = Math.max(-GAIN_MAX, Math.min(GAIN_MAX, yToGain(y)));
    onChange(dragIdx, { frequency: freq, gain });
  };

  const onPointerUp = () => setDragIdx(null);

  return (
    <div ref={containerRef} className="bg-panel/60 border border-edge rounded-2xl p-3">
      <div className="relative">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          preserveAspectRatio="none"
          className={`block w-full h-44 select-none touch-none ${bypassed ? "opacity-40" : ""}`}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
        >
          {/* 0 dB baseline */}
          <line
            x1={PAD_X}
            x2={W - PAD_X}
            y1={gainToY(0)}
            y2={gainToY(0)}
            stroke="rgba(255,255,255,0.12)"
            strokeDasharray="2 4"
          />
          {/* Curve through bands */}
          <path d={curve} fill="none" stroke="white" strokeWidth={2} strokeLinecap="round" />
          {/* Drag handles */}
          {points.map((p, i) => (
            <circle
              key={i}
              cx={p.x}
              cy={p.y}
              r={dragIdx === i ? 11 : 9}
              fill="white"
              stroke="rgba(0,0,0,0.4)"
              strokeWidth={1}
              style={{ cursor: "grab", touchAction: "none" }}
              onPointerDown={(e) => onPointerDown(e, i)}
            />
          ))}
        </svg>
        {/* Labels positioned under their handle's x — track dots as they're dragged */}
        {bands.map((b, i) => {
          const leftPct = (points[i].x / W) * 100;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onChange(i, { gain: 0 })}
              className="absolute -translate-x-1/2 text-[10px] text-muted hover:text-white transition tabular-nums text-center whitespace-nowrap"
              style={{ left: `${leftPct}%`, top: "100%" }}
              title="Tap to reset gain"
            >
              <div>{formatHz(b.frequency)}</div>
              <div className="text-white/70">
                {b.gain > 0 ? "+" : ""}
                {b.gain.toFixed(1)} dB
              </div>
            </button>
          );
        })}
      </div>
      <div className="h-9" />
    </div>
  );
}

function formatHz(hz: number): string {
  if (hz >= 1000) return `${(hz / 1000).toFixed(hz >= 10000 ? 0 : 1)}k`;
  return `${Math.round(hz)}`;
}

function SliderRow({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
  onReset,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
  onReset: () => void;
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm text-white">{label}</span>
        <button
          type="button"
          onClick={onReset}
          className="text-xs text-muted hover:text-white tabular-nums"
          aria-label={`Reset ${label}`}
          title="Tap to reset"
        >
          {format(value)}
        </button>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full accent-accent"
      />
    </div>
  );
}
