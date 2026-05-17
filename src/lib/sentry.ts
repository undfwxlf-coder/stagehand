import * as Sentry from "@sentry/react";

const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;
const ENV = (import.meta.env.MODE as string | undefined) ?? "production";

let initialized = false;

export function initSentry(): void {
  if (initialized) return;
  if (!DSN) {
    // No DSN configured — silently skip. Local dev and any environment
    // without VITE_SENTRY_DSN set will just no-op every Sentry call.
    return;
  }
  Sentry.init({
    dsn: DSN,
    environment: ENV,
    // Browser performance + replay are off by default to keep the free
    // tier usage focused on error events. Toggle later if needed.
    tracesSampleRate: 0,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
    // Filter out the noisiest, lowest-signal errors before they count
    // against the free-tier quota.
    ignoreErrors: [
      // ResizeObserver loop benign warnings
      "ResizeObserver loop completed with undelivered notifications",
      "ResizeObserver loop limit exceeded",
      // User clicked away during fetch
      "AbortError",
      "The user aborted a request",
      // Browser extension noise
      /chrome-extension/,
      /moz-extension/,
    ],
  });
  initialized = true;
}

export function setSentryUser(user: { id: string; email?: string | null } | null): void {
  if (!initialized) return;
  if (user) Sentry.setUser({ id: user.id, email: user.email ?? undefined });
  else Sentry.setUser(null);
}

export const SentryErrorBoundary = Sentry.ErrorBoundary;
