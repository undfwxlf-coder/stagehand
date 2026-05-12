import { BrowserRouter, Navigate, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./lib/auth";
import AuthPage from "./pages/AuthPage";
import LibraryPage from "./pages/LibraryPage";
import AlbumPage from "./pages/AlbumPage";
import TrackPage from "./pages/TrackPage";
import SavedPage from "./pages/SavedPage";
import ListenPage from "./pages/ListenPage";
import AppShell from "./components/AppShell";

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<AuthPage />} />
          <Route path="/listen/:slug" element={<ListenPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppShell />}>
              <Route index element={<LibraryPage />} />
              <Route path="album/:albumId" element={<AlbumPage />} />
              <Route path="track/:trackId" element={<TrackPage />} />
              <Route path="saved" element={<SavedPage />} />
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
