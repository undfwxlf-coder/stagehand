import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSentry, SentryErrorBoundary } from './lib/sentry'

// Defer Sentry init until the browser is idle. The Error Boundary itself is
// safe to mount immediately — it works whether or not init has fired (any
// errors thrown before init are simply not reported, which is fine for the
// first few hundred ms).
if (typeof window !== 'undefined') {
  if ('requestIdleCallback' in window) {
    (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback?.(initSentry)
  } else {
    setTimeout(initSentry, 1500)
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <SentryErrorBoundary fallback={<ErrorFallback />}>
      <App />
    </SentryErrorBoundary>
  </StrictMode>,
)

function ErrorFallback() {
  return (
    <div className="min-h-screen flex items-center justify-center px-6 text-center">
      <div className="max-w-md">
        <h1 className="text-xl text-white mb-2">Something went wrong</h1>
        <p className="text-sm text-muted mb-4">
          The error has been reported. Reload the page to try again.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-accent hover:bg-accent/90 text-white text-sm font-medium px-4 py-2 rounded-lg"
        >
          Reload
        </button>
      </div>
    </div>
  )
}
