import { Link } from "react-router-dom";
import Logo from "./Logo";

export default function LegalPageShell({
  title,
  effectiveDate,
  children,
}: {
  title: string;
  effectiveDate: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-edge bg-panel/60 backdrop-blur">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">
          <Link to="/" aria-label="Stagehand home" className="hover:opacity-90 transition">
            <Logo size={22} withWordmark />
          </Link>
          <Link to="/" className="text-xs text-muted hover:text-white">
            Stagehand
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4 sm:px-6 py-10">
        <article className="max-w-3xl mx-auto">
          <p className="text-xs uppercase tracking-wider text-muted">Stagehand · Legal</p>
          <h1 className="mt-2 text-3xl sm:text-4xl font-semibold text-white tracking-tight">
            {title}
          </h1>
          <p className="mt-2 text-sm text-muted">Effective {effectiveDate}.</p>

          <div className="prose prose-invert mt-8 text-white max-w-none [&_h2]:text-white [&_h2]:text-xl [&_h2]:font-semibold [&_h2]:mt-10 [&_h2]:mb-3 [&_h3]:text-white [&_h3]:text-base [&_h3]:font-semibold [&_h3]:mt-6 [&_h3]:mb-2 [&_p]:text-white/85 [&_p]:leading-relaxed [&_p]:mb-4 [&_ul]:text-white/85 [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:mb-4 [&_ul]:space-y-1.5 [&_li]:leading-relaxed [&_a]:text-accent [&_a]:underline [&_strong]:text-white">
            {children}
          </div>
        </article>
      </main>

      <footer className="border-t border-edge py-5 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto flex items-center justify-between text-xs text-muted">
          <span>Stagehand</span>
          <div className="flex gap-4">
            <Link to="/terms" className="hover:text-white">Terms</Link>
            <Link to="/privacy" className="hover:text-white">Privacy</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
