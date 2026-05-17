import { lazy, Suspense } from "react";
import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import AuthPage from "./pages/AuthPage";
import ResetPasswordPage from "./pages/ResetPasswordPage";
import TermsPage from "./pages/TermsPage";
import PrivacyPage from "./pages/PrivacyPage";
import LibraryPage from "./pages/LibraryPage";
import AlbumPage from "./pages/AlbumPage";
import TrackPage from "./pages/TrackPage";
import SavedPage from "./pages/SavedPage";
import ListenPage from "./pages/ListenPage";
import ProfilePage from "./pages/ProfilePage";
import AdminPage from "./pages/AdminPage";
import AppShell from "./components/AppShell";

const EditTrackPage = lazy(() => import("./pages/EditTrackPage"));

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/auth/reset" element={<ResetPasswordPage />} />
          <Route path="/terms" element={<TermsPage />} />
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/listen/:slug" element={<ListenPage />} />
          <Route element={<RequireAuth />}>
            <Route
              path="edit/:trackId"
              element={
                <Suspense fallback={<div className="fixed inset-0 bg-ink flex items-center justify-center text-muted text-sm">Loading editor…</div>}>
                  <EditTrackPage />
                </Suspense>
              }
            />
            <Route element={<AppShell />}>
              <Route index element={<LibraryPage />} />
              <Route path="album/:albumId" element={<AlbumPage />} />
              <Route path="track/:trackId" element={<TrackPage />} />
              <Route path="saved" element={<SavedPage />} />
              <Route path="profile" element={<ProfilePage />} />
              <Route path="admin" element={<AdminPage />} />
            </Route>
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function RequireAuth() {
  const { user, loading, configured } = useAuth();
  if (loading) return null;
  if (!configured || !user) return <Navigate to="/auth" replace />;
  return <Outlet />;
}
