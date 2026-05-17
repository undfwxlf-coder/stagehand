import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { initSentry, SentryErrorBoundary } from './lib/sentry'

initSentry()

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
