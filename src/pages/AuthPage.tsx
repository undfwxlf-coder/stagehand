import { useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../lib/auth";
import Logo from "../components/Logo";

// Only same-origin pathname targets are honored as a post-auth redirect —
// anything starting with "//" (protocol-relative) or "http(s)://" is dropped
// so a forged ?next= query can't bounce the user to an external site.
function safeNextPath(next: string | null): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}

export default function AuthPage() {
  const { user, loading, configured, signIn, signUp, resetPassword } = useAuth();
  const [searchParams] = useSearchParams();
  const nextPath = safeNextPath(searchParams.get("next"));
  const [mode, setMode] = useState<"signin" | "signup" | "forgot">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [artistName, setArtistName] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  if (loading) return null;
  if (user) return <Navigate to={nextPath} replace />;

  if (!configured) {
    return (
      <AuthShell>
        <div className="bg-panel border border-edge rounded-2xl p-8 text-center">
          <p className="text-muted text-sm">
            Supabase isn't configured yet. Add <code className="text-white">VITE_SUPABASE_URL</code> and{" "}
            <code className="text-white">VITE_SUPABASE_ANON_KEY</code> to your <code className="text-white">.env</code>{" "}
            file, then restart the dev server.
          </p>
        </div>
      </AuthShell>
    );
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setInfo(null);
    setBusy(true);
    let result: { error: string | null };
    if (mode === "signin") result = await signIn(email, password);
    else if (mode === "signup") result = await signUp(email, password, artistName);
    else result = await resetPassword(email);
    setBusy(false);
    if (result.error) {
      setErr(result.error);
      return;
    }
    if (mode === "signup") {
      setInfo("Check your email to confirm your account, then sign in.");
      setMode("signin");
    } else if (mode === "forgot") {
      setInfo("Check your email for a password reset link.");
    }
  };

  const goForgot = () => {
    setMode("forgot");
    setErr(null);
    setInfo(null);
    setPassword("");
  };

  const goSignin = () => {
    setMode("signin");
    setErr(null);
    setInfo(null);
  };

  return (
    <AuthShell>
      <form onSubmit={submit} className="bg-panel border border-edge rounded-2xl p-6 space-y-4">
          {mode !== "forgot" && (
            <div className="flex gap-1 p-1 bg-ink rounded-lg">
              <button
                type="button"
                onClick={() => setMode("signin")}
                className={`flex-1 py-2 text-sm rounded-md transition ${
                  mode === "signin" ? "bg-panel2 text-white" : "text-muted"
                }`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => setMode("signup")}
                className={`flex-1 py-2 text-sm rounded-md transition ${
                  mode === "signup" ? "bg-panel2 text-white" : "text-muted"
                }`}
              >
                Create account
              </button>
            </div>
          )}

          {mode === "forgot" && (
            <div>
              <h2 className="text-white font-semibold text-lg">Reset password</h2>
              <p className="text-xs text-muted mt-1">
                Enter the email you signed up with. We'll send you a link to set a new password.
              </p>
            </div>
          )}

          {mode === "signup" && (
            <Field
              label="Artist name"
              type="text"
              value={artistName}
              onChange={setArtistName}
              placeholder="What should we call you?"
              required
            />
          )}
          <Field label="Email" type="email" value={email} onChange={setEmail} required />
          {mode !== "forgot" && (
            <Field
              label="Password"
              type="password"
              value={password}
              onChange={setPassword}
              required
              minLength={6}
            />
          )}

          {mode === "signin" && (
            <div className="-mt-1 flex justify-end">
              <button
                type="button"
                onClick={goForgot}
                className="text-xs text-muted hover:text-white transition"
              >
                Forgot password?
              </button>
            </div>
          )}

          {err && <p className="text-sm text-red-400">{err}</p>}
          {info && <p className="text-sm text-[#F0EDDF]/90">{info}</p>}

          {mode === "signup" && (
            <p className="text-xs text-muted leading-relaxed">
              By creating an account you agree to our{" "}
              <Link to="/terms" className="text-white hover:underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" className="text-white hover:underline">
                Privacy Policy
              </Link>
              .
            </p>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full bg-accent hover:bg-accent/90 disabled:opacity-60 text-white font-medium py-2.5 rounded-lg transition"
          >
            {busy
              ? "Working…"
              : mode === "signin"
              ? "Sign in"
              : mode === "signup"
              ? "Create account"
              : "Send reset link"}
          </button>

          {mode === "forgot" && (
            <button
              type="button"
              onClick={goSignin}
              className="w-full text-xs text-muted hover:text-white transition"
            >
              ← Back to sign in
            </button>
          )}
        </form>
    </AuthShell>
  );
}

function AuthShell({ children }: { children: React.ReactNode }) {
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
          <a href="/" aria-label="Stagehand home" className="hover:opacity-90 transition">
            <Logo size={44} />
          </a>
          <h1 className="mt-4 text-3xl font-semibold text-white tracking-tight">Stagehand</h1>
          <p className="text-muted text-sm mt-1.5 text-center">
            An album studio for working artists.
            <br />
            Track progress, stash demos, listen anywhere.
          </p>
        </div>
        {children}
        <p className="mt-6 text-center text-xs text-muted">
          Your unreleased music stays private. Streaming uses time-limited links.
        </p>
        <div className="mt-3 flex justify-center gap-4 text-xs text-muted">
          <Link to="/terms" className="hover:text-white">Terms</Link>
          <Link to="/privacy" className="hover:text-white">Privacy</Link>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  type,
  value,
  onChange,
  placeholder,
  required,
  minLength,
}: {
  label: string;
  type: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  required?: boolean;
  minLength?: number;
}) {
  return (
    <label className="block">
      <span className="block text-xs uppercase tracking-wider text-muted mb-1.5">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        className="w-full bg-ink border border-edge focus:border-accent focus:outline-none rounded-lg px-3 py-2 text-white placeholder:text-muted"
      />
    </label>
  );
}
