import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import Logo from "../components/Logo";
import { useAuth } from "../lib/auth";
import { supabase } from "../lib/supabase";

export default function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const navigate = useNavigate();

  // The recovery link drops the user here with a hash like
  // #access_token=...&type=recovery. Supabase JS auto-detects it and
  // establishes a recovery session; if that hasn't happened yet by the
  // time the page mounts, we wait for the PASSWORD_RECOVERY event.
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [recoveryErr, setRecoveryErr] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancel) return;
      if (data.session) setRecoveryReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((evt, session) => {
      if (cancel) return;
      if (evt === "PASSWORD_RECOVERY" && session) setRecoveryReady(true);
      else if (evt === "SIGNED_IN" && session) setRecoveryReady(true);
    });
    // Bail out after a few seconds if the URL never produced a session.
    const timeout = window.setTimeout(() => {
      if (cancel) return;
      setRecoveryErr((prev) => prev ?? null);
      // Don't navigate away — let the user see the form + error so they can
      // request a fresh link from /auth.
    }, 4000);
    return () => {
      cancel = true;
      sub.subscription.unsubscribe();
      window.clearTimeout(timeout);
    };
  }, []);

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (password.length < 6) {
      setErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirm) {
      setErr("Passwords don't match.");
      return;
    }
    setBusy(true);
    const result = await updatePassword(password);
    setBusy(false);
    if (result.error) {
      setErr(result.error);
      return;
    }
    setDone(true);
    window.setTimeout(() => navigate("/", { replace: true }), 1200);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-6 overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(60% 50% at 50% 0%, rgba(255,94,58,0.18) 0%, rgba(255,94,58,0) 60%), radial-gradient(50% 60% at 100% 100%, rgba(110,160,255,0.10) 0%, rgba(110,160,255,0) 60%)",
        }}
      />
      <div className="relative max-w-md w-full">
        <div className="flex flex-col items-center mb-8">
          <Link to="/" aria-label="Stagehand home" className="hover:opacity-90 transition">
            <Logo size={44} />
          </Link>
          <h1 className="mt-4 text-3xl font-semibold text-white tracking-tight">Set new password</h1>
        </div>

        {done ? (
          <div className="bg-panel border border-edge rounded-2xl p-6 text-center space-y-2">
            <p className="text-[#F0EDDF]/90 text-sm">Password updated.</p>
            <p className="text-muted text-xs">Taking you to your library…</p>
          </div>
        ) : (
          <form onSubmit={submit} className="bg-panel border border-edge rounded-2xl p-6 space-y-4">
            <label className="block">
              <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">
                New password
              </span>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                minLength={6}
                autoFocus
                className="w-full bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-muted"
              />
            </label>
            <label className="block">
              <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">
                Confirm password
              </span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                required
                minLength={6}
                className="w-full bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-muted"
              />
            </label>

            {err && <p className="text-sm text-red-400">{err}</p>}
            {!recoveryReady && !recoveryErr && (
              <p className="text-xs text-muted">Verifying reset link…</p>
            )}

            <button
              type="submit"
              disabled={busy || !recoveryReady}
              className="w-full bg-accent hover:bg-accent/90 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
            >
              {busy ? "Updating…" : "Update password"}
            </button>

            <Link
              to="/auth"
              className="block text-center text-xs text-muted hover:text-white transition"
            >
              ← Back to sign in
            </Link>
          </form>
        )}
      </div>
    </div>
  );
}
