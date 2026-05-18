# Stagehand — Progress

A private workspace for music artists to track albums, store unreleased music, share with collaborators, listen anywhere, and edit a track's playback (speed / pitch / EQ / FX) before deciding it's ready. Public web app, mobile-first, deployed on Netlify.

- **Live**: https://stagehandstudio.netlify.app
- **Repo**: https://github.com/undfwxlf-coder/stagehand (private)
- **Supabase project**: `ccsewcccfgqofvxsavne`
- **Status**: invite-only beta, soft-launching to a small artist friend cohort

---

## What's built

### Core
- Email / password auth (Supabase) with email-confirmation flow. `emailRedirectTo: window.location.origin` is set on signup so confirmation links always come back to the active host (avoiding the historical "site URL drifted from the deployed domain → confirmation link 404s" trap).
- **Forgot password flow** — Auth page has a "Forgot password?" link that swaps the form to a single email field. `resetPasswordForEmail` sends a recovery link; recipient lands on `/auth/reset` and sets a new password. The reset page waits for the `PASSWORD_RECOVERY` (or `SIGNED_IN`) auth event before enabling the submit button.
- Profile auto-created on signup, artist name carried through `raw_user_meta_data`.
- Library: album grid, create / rename / delete albums, status pipeline (writing → recording → mixing → mastering → released).
- Cover art upload (public `artwork` bucket).
- Mobile-first layout — every page works on phone-sized viewports; iOS safe-area honored.

### Header (AppShell)
- Logo on the left, `Library / Saved` (and `Admin` for admins) nav in the middle, search + notifications bell + avatar on the right.
- **HeaderSearch**: debounced (180ms) `ilike` across `albums.title` and `tracks.title`; grouped dropdown with album-artwork thumbs and parent-album subtitle on track rows; keyboard nav (↑↓ / Enter / Esc), ⌘ / Ctrl+K shortcut; mobile renders a search-icon button that opens a full-screen overlay. RLS scopes results to the signed-in owner.
- **Notifications bell**: shows recent plays on owned tracks with an unread badge; rows link to `/track/:id`. History persists; `lastSeenAt` is stored in localStorage. Self-plays are filtered out.
- **Notification toasts**: slide in from the top-right whenever a new play arrives via Realtime; 5s auto-dismiss; tap to jump to the track.
- Page-fade transition keyed on `location.pathname` (180ms).
- Footer has Terms / Privacy links.

### Profile
- `/profile` route gated by `RequireAuth`, lives inside `AppShell`.
- Circular avatar (tap to upload to `artwork` bucket under `${user.id}/avatar/...`), initial-letter fallback.
- Inline artist-name editor (pencil → input → save / cancel).
- Joined date + email row.
- Settings list, grouped:
  - **Account**: Email · Purchases (stubbed, "Soon" pill)
  - **Support**: Tell a friend · Send feedback (mailto template) · Contact us · Stagehand on Instagram
  - **Legal**: Terms of Service · Privacy Policy (now real in-app routes)
  - Sign out in its own destructive group at the bottom.
- Profile name dual-writes `profiles.artist_name` AND `auth.user_metadata.artist_name`, so existing `user.user_metadata.artist_name` reads (PlayerBar / AlbumPage / TrackPage) stay correct.

### Tracks
- Album page with track list.
- Drag-to-reorder via `@dnd-kit/sortable` (desktop only, persists positions).
- Inline rename (pencil on hover, double-click, or Enter / Esc keyboard).
- Per-track status pipeline (idea → demo → tracking → mixing → mastering → released).
- BPM + key fields, editable inline.
- Allow-download toggle (lives in the details sheet AND in the redesigned track share sheet, bound to `tracks.allow_download`).
- **Album rename + delete**: inline pencil-edit on the album title plus an `…` overflow menu with Rename and Delete. Delete cascades through DB (`tracks` → `versions` → `share_links`). Library cache stays in sync.
- **Track delete**: destructive row at the bottom of the track details sheet; same cascade.
- **+ Add track popover**: single **+ Add track** button opens a popover with **From audio file** (multi-select, background-upload pipeline) and **Empty track** (creates an "Untitled" row).

### Track Details Sheet
- `⋯` button on every track row opens a bottom sheet (slides up on mobile, centered modal on desktop).
- Header: artwork + title + `artist · album · BPM · key`.
- **Track sharing** card with status dot + Copy link / Share.
- Action list: Replace audio · Insights · Notes · Allow / Disable downloads · Add to queue · Export audio · Delete track.
- Sub-views (Insights, Notes) swap into the sheet inline; back arrow returns; Esc closes (or steps back).
- **Manage sharing…** opens the redesigned `ShareModal` at `z-[60]`.

### Album Details Sheet
- **Share project** button on AlbumPage opens an `AlbumDetailsSheet` (same sheet pattern). UI copy uses "project" throughout, DB / code identifiers stay "album".
- Header: cover + title + `artist · status · N tracks`.
- **Project sharing** card with status dot + Copy link / Share.
- Action list: Change cover · Rename project · Delete project.
- **Manage sharing…** opens the redesigned `AlbumShareModal` at `z-[60]`.

### Share sheets (current design)
- Both `AlbumShareModal` and `ShareModal` share the same pattern, restructured to look like a music-app share flow rather than a permissions panel (intentionally distinct from the [untitled] mockup we initially modeled them on — see the Competitive section).
- Hero: large centered artwork (80–96px), bold tracking-tight title, soft accent ambient glow behind the artwork. The subtitle below the title is the live access summary ("Anyone with the link can listen", "Invite only · 3 people joined", "Private · only you can see this").
- **Visibility selector**: horizontal iOS-style segmented pill control with four options — Private · Invite · Public · Paid (Paid is stubbed with an inline "Soon" caption). Active pill is a white background with ink text + soft shadow; inactive pills are translucent. No dropdown — the segments switch state directly when tapped.
- **Inline Members roster** (only when Invite is active) — avatar + artist name + "joined Xh ago", driven by `list_share_members` RPC.
- **"More options"** collapsible disclosure: Allow editing (Soon), Allow downloads (wired to `tracks.allow_download` in the track sheet), Require account (wired for Public mode). Reset link is also tucked here.
- Sticky bottom action bar: pill-shaped **Copy link** (white) and **Share** (glass, uses Web Share API with copy fallback).
- All cards use the `glass-raised` utility (translucent white tint, blur, hairline border, inner top highlight). Modal corners are `rounded-3xl` for the iOS sheet feel. Backdrop is `backdrop-blur-xl` over `bg-black/70`.

### Track Page (stripped down)
- `/track/<id>` shows: back link · title + **Edit button** · tempo / key strip + Re-detect · Versions (upload, play, make-current, share, download, delete per version).
- Download toggle and Insights / Notes tabs live in the details sheet.
- The Edit button navigates to the full-screen editor at `/edit/:trackId`.

### Track Editor
- Route: `/edit/:trackId`, lives **outside** `AppShell` (full-screen, Cancel / Save chrome).
- Loaded as a **code-split `React.lazy` chunk** so the main bundle isn't paying for `soundtouchjs`.
- Three tabs: **Adjust** (Speed + Pitch via `soundtouchjs` `PitchShifter`), **EQ** (4-band parametric EQ drawn as a draggable graph + Delay / Reverb sliders), **Stems** ("Coming soon").
- Save persistence via `tracks.editor_settings` JSONB column; defaults write `null` to keep rows clean.
- Audio chain: `PitchShifter` → 4-band biquad EQ → splits into dry / delay (with feedback loop) / convolution reverb → master gain → destination. Reverb impulse is synthesized at construction (no IR shipped).

### Versions and uploads
- Upload WAV / MP3 / AIFF / FLAC / M4A.
- Waveform peaks pre-computed in browser via Web Audio API.
- **Background uploads** (`useUploadStore`): work survives navigation. Floating chip (bottom-right, above the player) shows per-job phase, errors, and a clickable track-title link. Completed jobs auto-dismiss after 12s. A `beforeunload` prompt fires while jobs are active. A "Reload to view" button appears for surfaces that don't auto-merge.
- **Per-track + album-aggregate percentages**: raw XHR against `${SUPABASE_URL}/storage/v1/object/audio/<path>` exposes `xhr.upload.onprogress`. Each job carries a `progress` (0..1) on a phase budget (decode / analyze 0–15%, upload 15–90%, save 90–100%). Emits throttled (≥120ms or ≥5% jump). Album-aggregate row weighted by file size.
- **Drag-and-drop import**: drop audio anywhere on the album track-list to create a new track per file; drop on a specific row to add a new version to that track instead.

### Audio analysis (real, content-based)
- **BPM**: `web-audio-beat-detector`, 3 segments, folded into 60–180 range, median-clustered to defeat half- / double-time outliers.
- **Key**: custom chromagram + Krumhansl-Schmuckler with energy-weighted frames and peakedness filter.
- **Re-detect button** on track page.
- Filename hints take priority over content detection.

### Player (Now Playing-ready, gapless)
- Persistent bottom player bar with wavesurfer.js.
- Volume + mute, persisted to localStorage.
- Mobile: title + play controls + thin tap-to-seek progress bar; waveform hidden.
- **Gapless auto-advance**: single `WaveSurfer` instance created lazily on the first track and reused via `ws.load(nextUrl)`. Hidden `<audio preload="auto">` points at `queue[idx + 1]` to warm the HTTP cache. `finishingRef` swallows the trailing `pause` after natural end so the next track auto-plays.
- **`navigator.mediaSession` wired**: title / artist / album / artwork pushed to iOS Control Center and Android lock screen on every track change. Action handlers for play / pause / next / prev / seekto. `setPositionState` reports duration + position.

### Sharing — current model
- **Per-track and per-album shares** (polymorphic `share_links` with track XOR album).
- Album shares carry a JSONB `payload` snapshot of every track at share-creation time. Track shares store `version_id` + `signed_url`.
- **Live edits propagate to existing share links** via the `resyncSharesForTrack` / `resyncAlbumSharesFireAndForget` helpers in `src/lib/share.ts`. Called after every meaningful edit (rename, audio replace, BPM / key, reorder, add / delete track). Re-signs storage URLs per-share using each share's remaining TTL. Listener never sees stale data.
- **Visibility modes**:
  - **Private** — link revoked, only the artist sees the project / track. Picking Private from the segmented control revokes the active link.
  - **Invite** — expiring join-token model (see next section).
  - **Public** — anyone with the link. Optional `Require account` toggle gates to signed-in users.
  - **Paid** — stubbed with a "Soon" badge in the UI; visibility value not yet writable.
- Slugged URLs at `/listen/<slug>`.
- Revoke kill-switch per link (`revoked` flag; once true, the link 404s permanently).
- "Reset project / track link" revokes the current link and creates a fresh one with the same settings.

### Invite shares (v2 — expiring join links + member roster)
- An invite link is a **join token**, not a permanent gate. Anyone signed in who opens the link gets added to `share_members` for that share. Members keep access *forever* (until the link is revoked); the link's `expires_at` only controls who can still *join*.
- Default join window is **7 days** when an artist picks the Invite segment.
- The share sheet shows a live **Members** card with avatar + display name + "joined Xm/h/d ago" once the link is active.
- Migration `migration_share_members.sql`:
  - `share_members(share_link_id, user_id, joined_at)` table with unique index.
  - `resolve_share` rewritten: signed-in caller auto-joins on first visit if the join window is still open; existing members get continued access regardless of expiry.
  - `record_play` updated: invite-share plays require active membership; expiry doesn't block members.
  - `list_share_members(share_link_id)` SECURITY DEFINER RPC returns the full roster to the share's owner only.
- Audio URLs for invite shares are pre-signed for the storage maximum (10y) regardless of `expires_at` so members can still play after the join window closes (`signedTtlFor` in `src/lib/share.ts`).
- The older email-based `share_invites` table is no longer consulted by the new flow but is left in place for back-compat. Any legacy invite share's listener simply auto-joins on next visit.

### Share link previews / unfurls
- Netlify Edge Function `netlify/edge-functions/share-preview.ts` (path config `/listen/*`).
- On every `/listen/<slug>` request: calls `context.next()` for the static `index.html`, hits the `resolve_share_preview` RPC, then rewrites `<title>`, `og:title`, `og:description`, `og:image`, `twitter:image`.
- Backed by `resolve_share_preview` RPC (SECURITY DEFINER) — read-only, never consumes single-use links, never returns audio URLs.

### Listen page (recipient view)
- Resolves via `resolve_share` SECURITY DEFINER RPC — single round trip with rich status codes (`expired`, `revoked`, `disabled`, `consumed`, `requires_signin`, `not_invited`, `not_found`, `ok`).
- Single-track and album-track-list views; footer copy adapts to share type.
- Save (for signed-in listeners) and Download (where the artist allowed it).
- **Album-share auto-advance**: tracks play in payload (= position) order. A per-instance `advanced` flag guards against multi-fire `finish` events from wavesurfer (which on certain audio files / mobile Safari could otherwise skip 2+ tracks). `wantsPlayOnReadyRef` carries the play intent across the wavesurfer rebuild so the next track auto-plays instead of loading paused. Same intent fires when the listener clicks a different row in the list.

### Saves
- Polymorphic `saves` table (track_id XOR album_id).
- Saved page shows Saved albums (grid) + Saved tracks (list).
- Playback uses the original artist's share link's signed URL; server-side withholds if revoked / expired / disabled / consumed.
- Per-row Download where `allow_download` is true.

### Timestamped comments
- Signed-in listeners can pin reactions (🔥 ❤️ 😍 👏 💯 🤯) or short text comments to a specific playhead position on any shared track. Composer chip shows the live `@ M:SS` mark; clicking a comment's timestamp seeks the player to that moment.
- Visible in **both** the listener view (`/listen/<slug>`) and the artist's `TrackPage` (`/track/<id>`).
- **Visibility scoping**: track owner sees every comment across every share of the track. A listener on share X sees comments left through share X (plus their own). Different invite groups stay isolated — Band A's notes don't leak to Band B's listening session.
- Access via three SECURITY DEFINER RPCs (`list_track_comments`, `post_track_comment`, `delete_track_comment`) that re-use the same `record_play` / `resolve_share` access logic (invite-membership check, expiry, require_account). RLS keeps inserts/deletes locked to the RPCs.
- `track_comments` is in the `supabase_realtime` publication so the artist's notifications bell can pick up new comments in real time (subscription wiring TBD — follow-up).
- Composer is suppressed for anonymous public-share listeners — they see comments but get a "Sign in to leave a comment" CTA. Matches the established trust model on saves.
- Comment author can delete their own; track owner can delete any. No editing in v1 — delete + repost.
- Anchored to the **track**, not the version. We store `version_id` at post-time as metadata so the artist can see "this was left on v2 mix" even after the audio is replaced.
- `usePlayer.seekTo(sec)` was added so the comment-row click on `TrackPage` can scrub the global player bar (the artist isn't using a page-local wavesurfer there).

### Insights (per-track)
- Inside the track details sheet (sub-view).
- Stat cards (plays, saves) + listener feed (artist name for signed-in, "Anonymous" otherwise) + saves feed.

### Library cache
- `useLibraryStore` (zustand) holds the album list with stale-while-revalidate `load()` — first visit fetches and stores; subsequent visits read cached albums immediately and refetch in the background.

### Error display
- Centralized `formatErr(e: unknown): string` in `src/lib/errors.ts`. Pulls human text out of Supabase plain-object errors and falls back to JSON-stringify so an unknown shape surfaces something rather than `[object Object]`.

### Branding & icons
- 3-bar SVG mark — single source in `public/favicon.svg` and `src/components/Logo.tsx`.
- High-res PNG rasters committed: `logo-{192,512,1024,2048,4096}.png`, `apple-touch-icon.png` (180), `og-image.png` (1200). Regen via `npm run gen:icons` (uses `@resvg/resvg-js`).
- `public/manifest.webmanifest` declares icons for PWA install.
- All UI buttons use `lucide-react` icons. Play icons get `fill="currentColor"` + 1px x-nudge.

### Admin (`/admin`)
- Hardcoded allowlist table `admins(user_id)` plus four SECURITY DEFINER RPCs: `is_admin`, `admin_stats`, `admin_recent_signups`, `admin_recent_plays`, `admin_recent_shares`. Each RPC gates on `exists(select 1 from admins where user_id = auth.uid())` so non-admins get a not-authorized error.
- `src/lib/admin.ts` wraps the RPCs and exposes a `useIsAdmin()` hook.
- `src/pages/AdminPage.tsx`:
  - 4-card stat grid: Users · Projects · Plays · Shares (each with 24h + 7d deltas).
  - Recent signups feed (artist name + email + project / track counts + joined date).
  - Recent plays feed (track + album + listener attribution + via-slug if from a share).
  - Recent shares feed (target title + type + visibility + revoked state + owner).
  - Refresh button up top.
- `AppShell` shows the Admin tab only when `useIsAdmin()` resolves true. AdminPage itself redirects to `/` if a non-admin lands on it.

### Error monitoring (Sentry)
- `src/lib/sentry.ts` initializes `@sentry/react` with `VITE_SENTRY_DSN`. No-ops gracefully when the env var isn't set, so local dev never errors.
- `main.tsx` wraps `<App />` in `Sentry.ErrorBoundary` with a fallback (Reload button) so a single component crash doesn't white-screen the whole app.
- `AuthProvider` calls `setSentryUser({ id, email })` on every session change, so every error is attributed to a specific signed-in user.
- Performance + replay sample rates are 0 to focus the free-tier quota on real errors. Noise filters strip `ResizeObserver loop`, `AbortError`, and browser-extension errors before they count against quota.

### Terms of Service + Privacy Policy
- `/terms` and `/privacy` public routes backed by a shared `LegalPageShell`. Drafts are tailored to Stagehand (artist IP retention affirmed, no-AI-training clause, sub-processor list, DMCA notice procedure). Beta-status disclaimer up top. Effective dated.
- Discoverable from: Profile → Legal section, AppShell footer, AuthPage footer, AuthPage signup mode ("By creating an account you agree to…" disclaimer above the Create button).
- **These are starter drafts, not lawyer-reviewed.** See "Things that need a decision" below.

---

## Core architectural decisions

| Decision | Why |
|---|---|
| **Vite + React + TS + Tailwind v3** | Static SPA, deploys clean to Netlify, fast dev loop. |
| **Supabase (auth + Postgres + Storage)** | Auth, DB, and S3-compatible storage in one; client talks directly via RLS. |
| **Netlify hosting** | Static + SPA redirect rule in `netlify.toml`; auto-deploys from GitHub `main`. Edge Functions for OG rewrite — still no traditional backend server. |
| **Audio in private `audio` bucket, art in public `artwork` bucket** | Audio is sensitive (unreleased), art needs cheap public URLs. Avatars piggyback on `artwork` under `${user.id}/avatar/...`. |
| **Signed URLs (1 hr default), longer for share links, 10y for invite shares** | Prevents URL leakage for streaming. Share link's signed URL expires when the share does. Invite shares get a 10-year audio URL because members outlive the join window. |
| **SECURITY DEFINER RPCs for public access** | `resolve_share`, `resolve_share_preview`, `record_play`, `list_my_saves`, `list_share_members`, all four `admin_*` RPCs — bypass RLS cleanly without creating cross-table recursion in policies. |
| **Polymorphic share_links and saves (track XOR album)** | Single set of code paths for shares / saves; check constraint enforces exactly-one. |
| **Browser-side audio analysis** | No backend audio worker; FFT + tempo detection in main thread. ~6s on a 4-min song. Worker is a future optimization. |
| **`soundtouchjs` for the track editor's speed / pitch** | Native `<audio>` `playbackRate` couples speed and pitch. soundtouchjs `PitchShifter` decouples both axes via Web Audio. Main-thread script-processor for now; worklet is the upgrade path. |
| **Synthetic reverb IR** | Noise-burst exponential-decay impulse generated at construction. Sounds OK and saves shipping an IR file. |
| **Editor route lives outside `AppShell` and is code-split** | Editor is a full-screen, modal-style experience and pulls in soundtouchjs — both reasons not to load it for users who never open it. |
| **Editor settings as a JSONB column (`tracks.editor_settings`)** | Single `update({ editor_settings })` call. New tabs can grow the shape without migrations. Default-state writes `null` to keep rows clean. |
| **Background upload pipeline lives in a zustand store, not a component** | Component unmounts on navigation; the work shouldn't. The store owns the job, exposes phase / progress reactively, and a global `<UploadIndicator />` mounted in AppShell renders it anywhere. |
| **Raw XHR for the audio upload step, not supabase-js `.upload()`** | Need `xhr.upload.onprogress` for byte-level percent. Replicate the same Storage REST endpoint, auth, and headers; intercept progress events. RLS still applies. |
| **Gapless playback via one wavesurfer instance + preloaded `<audio>` for queue[idx+1]** | A persistent instance avoids ~200ms setup cost on every track change; a hidden `<audio preload="auto">` warms the browser HTTP cache so the next `ws.load(url)` is effectively from disk. Result: track transitions feel like continuous playback. |
| **`finishingRef` flag in PlayerBar + per-instance `advanced` flag on ListenPage** | wavesurfer fires `finish` and then `pause` (and sometimes `finish` more than once near boundaries on certain files). Without these flags the auto-advance either stops on the next track or skips 2+ tracks. |
| **PlayerTrack carries `storagePath` OR `audioUrl`, resolved lazily** | Queue items for owned tracks pass `storagePath`; player signs on demand with an in-memory cache. Saved share-link tracks pass a pre-signed `audioUrl` (listener can't read the storage path). Same player code path. |
| **Supabase Realtime on `plays` for notifications** | Realtime respects RLS — owners can read plays on their tracks, so subscribing to `INSERT` with no filter naturally scopes server-side to owned tracks. |
| **`useLibraryStore` (zustand) with stale-while-revalidate** | Removes the skeleton-grid flash on remount. Same pattern as `useProfileStore`. |
| **Page-fade transition keyed on `pathname`** | One `<div key={pathname} className="animate-[pagein_180ms_ease-out]">` around `<Outlet />`. Pure CSS keyframe, no animation library. |
| **Detection only auto-applies on empty fields; Re-detect overrides** | Don't clobber manual values silently. |
| **Single-use shares burn on first `resolve_share`, not first play** | Simplest semantic: opening the page consumes it. |
| **Never-expires share signs the storage URL for 10 years** | Supabase signed URLs are JWTs with arbitrary TTLs; 10y avoids re-signing infrastructure. |
| **Invite shares: `expires_at` is the join cutoff, not the access cutoff** | Members keep access past expiry. Audio URLs for invite shares always signed for 10y regardless of expires_at. |
| **Invite shares: `share_members` table for membership, not `share_invites`** | Email-list invites required the artist to know everyone's address up front. Join-token model (Discord / Notion) matches the artist-shares-with-friends use case better. |
| **Live share resync on every edit** | Artists treat a share link as "the link to this song" not "the link to a snapshot." `resyncSharesForTrack` / `resyncAlbumSharesFireAndForget` re-sign and update payload after every meaningful edit so listeners always see current state. Fire-and-forget; idempotent. |
| **Mobile-first** | Every feature must work on phones. A few "extreme" features (drag-to-reorder, EQ graph dragging at very small sizes) can be desktop-leaning as a documented trade-off. |
| **MediaSession lives in PlayerBar, not pages** | The bar is the single source of truth for active audio; setting MediaMetadata there means every entry point gets correct lock-screen UI for free. |
| **High-res raster icons generated from a generous-viewBox SVG at build-script time** | iOS Now Playing rasterizes whatever artwork URL you give it. A 32×32 favicon yields a blurry image. Pre-rendered 1024+ PNGs solve it without runtime cost. |
| **Track details sheet / Album details sheet as primary entry points** | Cleaner UX than dropping a settings modal in the user's lap. Sharing is one card inside the sheet; "Manage sharing…" defers the full link controls. |
| **OG previews via Netlify Edge Function** | The SPA serves the same static `index.html` for every URL. OG scrapers don't run JS — an edge function is the only place to inject per-share metadata without a real backend. |
| **`resolve_share_preview` is separate from `resolve_share`** | Preview RPC must not consume single-use shares (scrapers can't burn a link) and must not return audio URLs. Different security profile = different function. |
| **Centralized `formatErr` for error display** | Supabase responses bubble up as plain objects, not Error instances. `String(e)` produces `[object Object]`. `formatErr` pulls `.message` / `.details` and falls back to JSON stringify. |
| **Admin layer is its own opt-in** | `admins(user_id)` allowlist + SECURITY DEFINER RPCs. Non-admins can never invoke admin RPCs even if they figure out the names. AppShell hides the nav tab and AdminPage redirects on `useIsAdmin()` resolving false. |
| **Sentry initialized only when DSN env var is set** | Local dev and any unconfigured environment no-op gracefully. No accidental error spam to a production project from a developer's laptop. |
| **Visual share-sheet redesign is structurally distinct from [untitled]** | Initial share UI was modeled on [untitled] mockups the user supplied. After clarifying source, restructured: segmented pill control (not dropdown), title subtitle for status (not separate card), collapsed "More options" disclosure (not settings stack), no separate "Make private" button (the Private segment does the revoke). Functionality is unchanged; visual / structural identity is now ours. |

---

## Schema, RPCs, migrations

### Tables (current)

- `profiles` (id → auth.users, artist_name, avatar_url)
- `albums` (owner_id, title, artwork_url, status, target_release_date) — `ON DELETE CASCADE` to tracks
- `tracks` (album_id, title, position, status, notes, bpm, song_key, allow_download, play_count, current_version_id, **editor_settings jsonb**)
- `versions` (track_id, label, storage_path, duration_sec, peaks)
- `share_links` (**polymorphic**: track_id nullable, album_id nullable, exactly-one via check; slug, signed_url nullable, payload jsonb, expires_at nullable, revoked, visibility, require_account, single_use, consumed_at, play_count)
- `share_invites` (legacy, email-based — no longer written by the new invite flow but kept for back-compat)
- `share_members` (**new** — share_link_id, user_id, joined_at; unique on (share_link_id, user_id))
- `saves` (polymorphic: track_id XOR album_id; user_id, share_link_id)
- `plays` (track_id, user_id nullable, share_slug nullable, created_at) — **must be in the `supabase_realtime` publication** for notification toasts
- `track_comments` (**new** — track_id, share_link_id nullable, version_id nullable, user_id, body, timestamp_sec, is_reaction, created_at) — also in the `supabase_realtime` publication
- `admins` (user_id → auth.users, added_at)

### Key RPCs

- `resolve_share(slug)` — returns share + track / version OR share + album / tracks payload, with status codes. For invite shares, auto-joins the caller if the join window is still open; members get continued access past expiry.
- `resolve_share_preview(slug)` — read-only preview for the OG edge function.
- `record_play(track_id, slug?)` — validates the share (membership-aware for invite shares), inserts a play row, increments counters.
- `list_my_saves()` — returns mixed array of saved tracks and saved albums as JSON.
- `list_share_members(share_link_id)` — returns the roster of a given invite share's members; gated server-side to the share's owner.
- `list_track_comments(track_id, slug?)` / `post_track_comment(...)` / `delete_track_comment(comment_id)` — timestamped comments. Reuses the same access logic as `resolve_share` / `record_play` (invite membership, expiry, require_account). Owner sees every comment across all shares; listeners on share X see comments through share X only.
- `is_admin()` — boolean for client + RLS use.
- `admin_stats()` — top-level counts and 24h / 7d deltas.
- `admin_recent_signups(limit)` / `admin_recent_plays(limit)` / `admin_recent_shares(limit)` — feeds for the admin dashboard.

### Migrations status

- ✅ `migration_share_optional_expiry_single_use.sql` — applied. Adds nullable `expires_at`, `single_use`, `consumed_at`; original `resolve_share`. Idempotent.
- ✅ `migration_share_preview.sql` — applied. Adds `resolve_share_preview`. Idempotent.
- ✅ `migration_editor_settings.sql` — applied. Adds `tracks.editor_settings jsonb`. Idempotent.
- ✅ `migration_polymorphic_shares_saves.sql` — applied. Polymorphic `share_links.album_id`, `share_invites` / `saves` / `plays` tables, `record_play` + `list_my_saves`, plays added to `supabase_realtime` publication, share_links RLS rewritten so album owners can insert album shares. Defensive ALTERs for pre-existing saves / plays tables (including the composite-PK case where saves was created with `(user_id, track_id)` as the primary key). Idempotent.
- ⏳ `migration_audio_bucket_size.sql` — **still needs to be run**. Raises the `audio` bucket's per-file limit to 1 GiB. Also requires bumping the project-level Global file size limit in Supabase Dashboard → Storage → Settings.
- ⏳ `migration_admin.sql` — **needs to be run** before `/admin` works. Adds `admins` table + RLS, `is_admin()`, `admin_stats`, `admin_recent_signups`, `admin_recent_plays`, `admin_recent_shares`. After running, insert your own user_id into `admins`: `insert into admins (user_id) values ((select id from auth.users where email = 'YOU@EXAMPLE.COM'));`.
- ⏳ `migration_share_members.sql` — **needs to be run** for the new invite-v2 flow. Adds `share_members` table + RLS, rewrites `resolve_share` for membership-based access, updates `record_play` for membership semantics, adds `list_share_members`. Idempotent.
- ⏳ `migration_track_status_waiting_on_feature.sql` — **needs to be run** to allow the new `waiting_on_feature` track status. Drops and re-adds the `tracks.status` CHECK constraint with the new value included. Idempotent.
- ⏳ `migration_track_comments.sql` — **needs to be run** for timestamped comments. Adds `track_comments` table + RLS, the three RPCs (`list_track_comments`, `post_track_comment`, `delete_track_comment`), and adds the table to the `supabase_realtime` publication. Idempotent.

### Environment / dashboard config that has to be done manually

- **Supabase → Authentication → URL Configuration** — Site URL = `https://stagehandstudio.netlify.app`, Redirect URLs include `https://stagehandstudio.netlify.app`, `https://stagehandstudio.netlify.app/**`, `http://localhost:5173`, `http://localhost:5173/**` (the `/**` wildcards cover all paths including `/auth/reset`).
- **Netlify → Site settings → Environment variables** — `VITE_SENTRY_DSN` set to your Sentry project DSN. Without it, Sentry silently no-ops (intentional — local dev never errors).
- **Sentry** — sign up at sentry.io, create a React project, copy the DSN, paste into Netlify env var, redeploy.

---

## Competitive context

The closest existing product is **[untitled]** by Sin Titulo, Inc. — iOS / Android / macOS, $22.6M raised, 100k MAU, 3 years in market. [untitled.stream](https://untitled.stream/). The user supplied mockups that were screenshots from their app; the original share-sheet IA we built was modeled directly on those screenshots.

**After confirming the source**, the share sheets were restructured to be visually + structurally distinct (segmented pill control instead of dropdown, title subtitle instead of "Who has access" card, "More options" disclosure instead of a settings stack, no separate "Make private" affordance, "project" terminology). Features are unchanged — features aren't copyrightable; trade dress is.

**Stagehand differentiators worth investing in:**
- **Web-first.** Recipients hear a track instantly in any browser; [untitled] needs the app installed.
- **Project workflow.** Status pipeline + version history + notes + the EQ / FX editor positions Stagehand as a *studio* tool, not a *file vault*.
- **Live edits propagate to existing shares** (resync). [untitled] doesn't advertise this.
- **OG link previews + listener-side delight** (waveform, save-to-library, listener feed, MediaSession lock-screen UI).
- **Free tier with full features.**

**What we don't have that they do (and might want eventually):**
- Native iOS / Android / macOS apps + offline listening + AirDrop / iMessage upload + in-app recording + Instagram Stories integration + working stem splitting + direct fan monetization.

**Filed-trademark recommendation:** USPTO TEAS Plus application for "Stagehand" + the 3-bar mark in Class 9 (downloadable software) and Class 42 (SaaS), ~$250–$350 per class DIY. Before any meaningful press.

---

## Currently-tracked bugs / known limitations

### Schema gaps still possible on fresh Supabase projects
- A new Supabase project hits `column share_links.album_id does not exist` until `migration_polymorphic_shares_saves.sql` is applied; then `42501 (RLS violation)` on album share insert until the new policy lands (also in that migration). Now resolved going forward — but if you ever rebuild from scratch, run that migration *and* `migration_share_members.sql`.

### Storage isn't swept on album / track / version delete
DB cascades clean up `albums → tracks → versions → share_links` rows, but audio files in the `audio` bucket and artwork in the `artwork` bucket stay as orphans. Doesn't break anything — consumes space. Server-side trigger or scheduled function is the fix.

### Audio decode happens in the main thread before upload
`decodeAudio(file)` reads the whole file into an `ArrayBuffer` and decodes to a float32 `AudioBuffer` for peaks + BPM + key. A 500 MB WAV peaks at ~1 GB of RAM and can OOM mobile Safari. Decision: keep this for the analysis benefit; expect failures at the "Decoding audio…" step on very large files on phones. Web Worker / chunked decode is the eventual fix.

### Auto-advance "gapless" still has a tiny decoder-init latency
Persistent-wavesurfer + HTTP-cache-preload eliminates the multi-second fetch + decode gap, but there's ~30–80ms of decoder-init at the first sample of each track. Sample-accurate gapless would need Web Audio API scheduling — a bigger change.

### Editor seek is approximate
`soundtouchjs` `PitchShifter` doesn't support seeking. Our `seek(sec)` slices the `AudioBuffer` and recreates the shifter — works, but a tiny gap on big jumps and a fresh copy of the buffer is made each time.

### Editor runs on a ScriptProcessorNode (deprecated)
`soundtouchjs` uses a `ScriptProcessorNode` internally. Fine on desktop and modern phones; can stutter on older Androids under heavy load. AudioWorklet is the upgrade path.

### Editor reverb is a synthetic IR
Decent for v1 (noise burst, exponential decay) — not a real room impulse. Swap for a curated set of IRs later.

### Stems tab is stubbed
Three implementation paths in "Things that need a decision."

### Notification toasts depend on Realtime being enabled
The `plays` table must be in the `supabase_realtime` publication. The polymorphic-shares migration adds it automatically; the bell's history (initial 20-row fetch) works either way.

### Per-version Share button on TrackPage still opens the redesigned ShareModal directly
The new sheet flow expects to be reached via the track details sheet; per-version Share on TrackPage bypasses that path. Not a bug per se, but mildly inconsistent UX. Either fully unify with the details sheet pattern or drop per-version Share as a v1 feature.

### "Allow editing" toggle is stubbed
Visible with a "Soon" badge in the More options disclosure. Requires DB column (`tracks.collab_editing` or similar) + RLS policy that lets collaborators write + a collaborator-management UI. Future work.

### "Paid" visibility is stubbed
Selecting Paid in the segmented control is blocked. Requires Stripe integration + webhook to grant access on payment + payment confirmation UI. Future work.

### "Who has access" avatar stack is text-only
The current implementation shows a status summary string instead of a real avatar stack. Adding the avatar stack is straightforward now that `list_share_members` exists — pull the first ~3 members and render their avatars + a "+N more" overflow.

### OG preview cache invalidation
Slack / Twitter / Facebook etc. cache OG previews aggressively. Changing album cover doesn't propagate until the platform re-scrapes. Not fixable from our side.

### Build size
With `web-audio-beat-detector` + `fft.js` + `lucide-react` + `soundtouchjs` + `@sentry/react`, the main chunk is ~810 KB minified (~230 KB gzip). Editor route is already code-split. Next win: code-split the analysis libs so they only load on Re-detect.

### Audio analysis on main thread
2–6s blocking work during upload. UI shows status text but can feel sluggish on slower phones. Move to a Web Worker eventually.

### Don't run "Music Production Schema with RLS and Storage Policies" saved query in Supabase
That saved query in the SQL editor's PRIVATE section is the original `schema.sql` content from before any migrations. Running it will redefine `resolve_share` with the wrong signature. Source of truth is the `supabase/*.sql` files in this repo.

### Terms / Privacy are placeholder drafts
Tailored to Stagehand specifically but **not lawyer-reviewed**. Before any meaningful public launch the Limitation of Liability ($50 cap), Indemnification, Governing Law jurisdiction (currently blank), and DMCA agent designation should be reviewed and filled in by either a real lawyer (~$500–$1500 one-time) or via Termly / Iubenda ($5–25 / mo auto-generated).

---

## Things that need a decision

### Stems strategy
The Stems tab in the editor is stubbed. Three paths:
1. **Moises.ai API** — ~$0.10–$0.20 per track, production-quality, no infra. Recommended for v1.
2. **Self-host Demucs** in a Python worker (Render / Modal / Railway + GPU) — full control, you eat the compute cost.
3. **Browser-side ONNX** — works but 1–5 min of phone-melting compute per track. Not viable for mobile.

### Domain
`stagehand.app` is taken (theater stage-management tool). Keep the name "Stagehand", pick a different TLD. Candidates: `stagehand.fm` (clearest "music" signal), `stagehand.studio`, `stagehand.io`, or `getstagehand.com` as fallback. When the domain points at the Netlify site: update Supabase Site URL + Redirect URLs, update `CONTACT_EMAIL` and `INSTAGRAM_URL` references, fill in Governing Law jurisdiction in Terms.

### Infrastructure sustainability (before viral scale)
Currently on free tiers everywhere. The four things to do before opening signups beyond the friend cohort:
1. **Supabase Pro** ($25 / mo) — daily backups + PITR, 100 GB storage, 250 GB egress. No email rate-limit when SMTP is wired.
2. **Resend SMTP** wired into Supabase auth — replaces the built-in 3-email / hour limit. Free tier covers 3k emails / month.
3. **Storage / bandwidth alerts** on Supabase + Netlify at 70% of plan limits.
4. **Cloudflare R2 for audio** (eventual) — $0 egress vs Supabase's $0.09 / GB. Becomes economically important once audio storage clears ~500 GB or egress overages start.

Estimated monthly cost at "real validation" scale (~500 users, ~100 DAU): ~$30–50. At "going somewhere" scale (~5k users, ~1k DAU) with R2 migration: ~$125.

---

## Immediate next steps

In rough order of leverage:

1. **Run the three pending migrations** in Supabase SQL Editor — `migration_admin.sql`, `migration_share_members.sql`, and `migration_audio_bucket_size.sql` (don't forget to also bump the project-level file size limit in Supabase Dashboard → Storage → Settings). Then insert your user_id into the `admins` table.
2. **Wire Resend SMTP** into Supabase Authentication → SMTP Settings. Cuts the 3-emails / hour cliff. ~30 min, no app code.
3. **Wire Sentry DSN** — sign up, create a React project, paste DSN into Netlify env vars, redeploy. ~30 min.
4. **Upgrade Supabase to Pro** ($25 / mo) — unlocks PITR + daily backups, removes the storage cliff. Cheapest insurance against data loss.
5. **In-app feedback widget** — small "Report a bug" sheet with a textarea + auto-attached user ID + URL + recent console errors. Friends won't write emails; they'll tap a button.
6. **Invite-gated signup** — flip public signup off; require an invite code. Lets the cohort grow under control.
7. **Mobile QA pass on live build** — sign up flow → upload → background-upload chip → share project → open in private tab → confirm auto-join + notification + toast fires. Catches iOS Safari quirks.
8. **Verify OG unfurls** on live — paste a `/listen/<slug>` into iMessage / Slack / opengraph.xyz; confirm image + title.
9. **Real avatar stack on "Who has access"** — pull from `list_share_members`, render the first 3 avatars + "+N more" overflow.
10. **Decide stems strategy** (Moises.ai recommended).
11. **Storage cleanup on delete** — Postgres trigger or scheduled function to sweep orphaned audio / artwork.
12. **Move `soundtouchjs` to an AudioWorklet** for off-main-thread pitch-shifting.
13. **Move audio analysis (BPM / key) to a Web Worker** for smoother upload UX on slow phones.
14. **Code-split `web-audio-beat-detector` + `fft.js`** so the analysis libs only load on Re-detect.
15. **USPTO trademark filing** for "Stagehand" + the 3-bar mark in Class 9 + Class 42. ~$250–$350 / class via TEAS Plus DIY.
16. **Lawyer review of Terms / Privacy** or switch to Termly / Iubenda. Fill in Governing Law jurisdiction.
17. **Buy and point a custom domain** once one is picked. Update Supabase + env vars accordingly.

---

## How to run locally

```bash
cd ~/Desktop/stagehand
npm install
cp .env.example .env   # then fill in VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY
npm run dev
```

Visit the URL Vite prints (usually `http://localhost:5173`). To test share links locally, ensure `http://localhost:5173/**` is in Supabase → Authentication → Redirect URLs.

## How to deploy

```bash
git add <files>
git commit -m "<message>"
git push    # Netlify auto-rebuilds in ~1–2 min
```
