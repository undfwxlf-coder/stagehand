import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Activity, Lock, Music, Share2, Users } from "lucide-react";
import {
  type AdminPlay,
  type AdminShare,
  type AdminSignup,
  type AdminStats,
  fetchAdminStats,
  fetchRecentPlays,
  fetchRecentShares,
  fetchRecentSignups,
  useIsAdmin,
} from "../lib/admin";
import { formatErr } from "../lib/errors";

export default function AdminPage() {
  const { isAdmin, loading: adminLoading } = useIsAdmin();
  const navigate = useNavigate();

  useEffect(() => {
    if (!adminLoading && !isAdmin) navigate("/", { replace: true });
  }, [adminLoading, isAdmin, navigate]);

  const [stats, setStats] = useState<AdminStats | null>(null);
  const [signups, setSignups] = useState<AdminSignup[]>([]);
  const [plays, setPlays] = useState<AdminPlay[]>([]);
  const [shares, setShares] = useState<AdminShare[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const reload = async () => {
    setErr(null);
    setLoading(true);
    try {
      const [s, su, pl, sh] = await Promise.all([
        fetchAdminStats(),
        fetchRecentSignups(30),
        fetchRecentPlays(50),
        fetchRecentShares(30),
      ]);
      setStats(s);
      setSignups(su);
      setPlays(pl);
      setShares(sh);
    } catch (e) {
      setErr(formatErr(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) void reload();
  }, [isAdmin]);

  if (adminLoading || !isAdmin) {
    return <div className="max-w-7xl mx-auto px-4 sm:px-6 py-8 text-muted">Loading…</div>;
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-8">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted flex items-center gap-1.5">
            <Lock size={12} /> Admin
          </div>
          <h1 className="text-2xl sm:text-3xl font-semibold text-white tracking-tight mt-1">
            Overview
          </h1>
        </div>
        <button
          onClick={reload}
          disabled={loading}
          className="bg-panel2 hover:bg-edge border border-edge text-white text-sm font-medium px-3 py-2 rounded-lg disabled:opacity-60"
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {err && <p className="text-sm text-red-400">{err}</p>}

      {/* Stat grid */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          icon={<Users size={16} />}
          label="Users"
          value={stats?.users ?? 0}
          sub={
            stats
              ? `+${stats.signups_24h} today · +${stats.signups_7d} this week`
              : "—"
          }
        />
        <StatCard
          icon={<Music size={16} />}
          label="Projects"
          value={stats?.albums ?? 0}
          sub={stats ? `${stats.tracks} tracks · ${stats.versions} versions` : "—"}
        />
        <StatCard
          icon={<Activity size={16} />}
          label="Plays"
          value={stats?.plays ?? 0}
          sub={
            stats
              ? `+${stats.plays_24h} today · +${stats.plays_7d} this week`
              : "—"
          }
        />
        <StatCard
          icon={<Share2 size={16} />}
          label="Shares"
          value={stats?.shares_active ?? 0}
          sub={stats ? `${stats.shares_total} total · ${stats.saves} saves` : "—"}
        />
      </div>

      {/* Signups */}
      <Section title="Recent signups" subtitle={`${signups.length} newest users`}>
        {signups.length === 0 ? (
          <Empty label="No signups yet" />
        ) : (
          <ul className="divide-y divide-edge">
            {signups.map((s) => (
              <li key={s.user_id} className="px-4 py-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-panel2 border border-edge flex items-center justify-center text-xs font-medium text-muted shrink-0">
                  {(s.artist_name || s.email || "?").charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {s.artist_name || <span className="text-muted">No artist name</span>}
                  </div>
                  <div className="text-xs text-muted truncate">{s.email}</div>
                </div>
                <div className="text-xs text-muted shrink-0 text-right">
                  <div>{fmtDate(s.created_at)}</div>
                  <div>
                    {s.album_count} {s.album_count === 1 ? "project" : "projects"} · {s.track_count}{" "}
                    {s.track_count === 1 ? "track" : "tracks"}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Plays */}
      <Section title="Recent plays" subtitle={`${plays.length} most recent listen events`}>
        {plays.length === 0 ? (
          <Empty label="No plays yet" />
        ) : (
          <ul className="divide-y divide-edge">
            {plays.map((p) => (
              <li key={p.play_id} className="px-4 py-3 flex items-center gap-3">
                <Activity size={14} className="text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate">
                    {p.track_title || "Unknown track"}
                    {p.album_title && (
                      <span className="text-muted"> — {p.album_title}</span>
                    )}
                  </div>
                  <div className="text-xs text-muted truncate">
                    by {p.owner_artist_name || "?"} · listener:{" "}
                    {p.listener_artist_name || p.listener_email || "Anonymous"}
                    {p.share_slug && <> · via /{p.share_slug}</>}
                  </div>
                </div>
                <div className="text-xs text-muted shrink-0">{fmtDateTime(p.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      {/* Shares */}
      <Section title="Recent shares" subtitle={`${shares.length} most recent share links`}>
        {shares.length === 0 ? (
          <Empty label="No shares yet" />
        ) : (
          <ul className="divide-y divide-edge">
            {shares.map((s) => (
              <li key={s.id} className="px-4 py-3 flex items-center gap-3">
                <Share2 size={14} className="text-muted shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate flex items-center gap-2">
                    <span className="truncate">{s.target_title || "Untitled"}</span>
                    <Pill>{s.type}</Pill>
                    <Pill tone={s.revoked ? "muted" : s.visibility === "disabled" ? "muted" : "ok"}>
                      {s.revoked ? "revoked" : s.visibility}
                    </Pill>
                  </div>
                  <div className="text-xs text-muted truncate">
                    by {s.owner_artist_name || s.owner_email || "?"} · {s.play_count} plays
                    {s.expires_at && <> · expires {fmtDate(s.expires_at)}</>}
                  </div>
                </div>
                <div className="text-xs text-muted shrink-0">{fmtDate(s.created_at)}</div>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  sub,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  sub: string;
}) {
  return (
    <div className="rounded-xl bg-panel2 border border-edge px-4 py-4">
      <div className="text-xs text-muted flex items-center gap-1.5">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold text-white mt-1 tabular-nums">
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-muted mt-1 truncate">{sub}</div>
    </div>
  );
}

function Section({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="text-base font-semibold text-white">{title}</h2>
        {subtitle && <div className="text-xs text-muted">{subtitle}</div>}
      </div>
      <div className="rounded-xl bg-panel border border-edge overflow-hidden">{children}</div>
    </section>
  );
}

function Empty({ label }: { label: string }) {
  return <p className="px-4 py-8 text-sm text-muted text-center">{label}</p>;
}

function Pill({
  children,
  tone = "ok",
}: {
  children: React.ReactNode;
  tone?: "ok" | "muted";
}) {
  const cls =
    tone === "muted"
      ? "bg-edge text-muted"
      : "bg-emerald-500/15 text-emerald-300";
  return (
    <span className={`text-[10px] uppercase tracking-wider px-1.5 py-0.5 rounded ${cls}`}>
      {children}
    </span>
  );
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString();
}

function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) {
    return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}
