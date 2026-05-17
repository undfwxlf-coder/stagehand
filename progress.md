# Stagehand — Progress

A private workspace for music artists to track albums, store unreleased music, share with collaborators, listen anywhere, and edit a track's playback (speed/pitch/EQ/FX) before deciding it's ready. Public web app, mobile-first, deployed on Netlify.

- **Live**: https://stagehand1.netlify.app *(currently returning 404 — see "Netlify deploys stuck" under tracked bugs)*
- **Repo**: https://github.com/undfwxlf-coder/stagehand (private)
- **Supabase project**: `ccsewcccfgqofvxsavne`

---

## What's built

### Core
- Email/password auth (Supabase) with email-confirmation flow; Supabase Site URL + Redirect URLs pointed at the Netlify domain so confirmation links resolve correctly
- Profile auto-created on signup, artist name carried through `raw_user_meta_data`
- Library: album grid, create / rename / delete albums, status pipeline (writing → recording → mixing → mastering → released)
- Cover art upload (public `artwork` bucket)
- Mobile-first layout — every page works on phone-sized viewports; iOS safe-area honored

### Header (AppShell)
- Logo on the left, `Library / Saved` nav in the middle, **search + notifications bell + avatar** on the right
- **HeaderSearch**: debounced (180ms) `ilike` across `albums.title` and `tracks.title`; grouped dropdown with album-artwork thumbs and parent-album subtitle on track rows; keyboard nav (↑↓/Enter/Esc), ⌘/Ctrl+K shortcut; mobile renders a search-icon button that opens a full-screen overlay so the header doesn't get cramped. RLS scopes results to the signed-in owner.
- **Notifications bell**: shows recent plays on owned tracks with an unread badge; rows link to `/track/:id`. History persists; `lastSeenAt` is stored in localStorage so the badge survives reload. Self-plays are filtered out.
- **Notification toasts**: slide in from the top-right whenever a new play arrives via Realtime; 5s auto-dismiss; tap to jump to the track.
- Page-fade transition keyed on `location.pathname` (180ms) so every route change feels smooth.

### Profile
- `/profile` route gated by `RequireAuth`, lives inside `AppShell`
- Circular avatar (tap to upload to `artwork` bucket under `${user.id}/avatar/...`, reuses existing public-read RLS), initial-letter fallback when no avatar
- Inline artist-name editor (pencil → input → save/cancel, Enter/Esc keyboard shortcuts)
- Joined date + email row
- **Settings list**, grouped:
  - **Account**: Email · Purchases (stubbed, "Soon" pill)
  - **Support**: Tell a friend · Send feedback (mailto template) · Contact us · Stagehand on Instagram
  - **Legal**: Terms of Service · Privacy Policy ("Soon" pills until URLs are filled in)
  - Sign out is in its own destructive group at the bottom
- Saving the name dual-writes `profiles.artist_name` AND `auth.user_metadata.artist_name`, so existing `user.user_metadata.artist_name` reads (PlayerBar / AlbumPage / TrackPage) stay correct
- Tiny zustand `useProfileStore` so uploads on `/profile` update the header avatar instantly; cleared on sign-out

### Tracks
- Album page with track list
- Drag-to-reorder via `@dnd-kit/sortable` (desktop only, persists positions)
- Inline rename (pencil on hover, double-click, or Enter/Esc keyboard)
- Per-track status (idea → demo → tracking → mixing → mastering → released)
- BPM + key fields, editable inline
- Allow-download toggle (lives in the details sheet)
- **Album rename + delete**: inline pencil-edit on the album title plus a `…` overflow menu with Rename and Delete album. Delete shows a confirm; cascades through DB (`tracks` → `versions` → `share_links`). Library cache stays in sync.
- **Track delete**: destructive row at the bottom of the track details sheet; same cascade behavior.
- **+ Add track popover**: the inline "Add a track…" form was replaced with a single **+ Add track** button that opens a popover with two options — **From audio file** (file picker, multi-select, runs through the background-upload pipeline with BPM/key detection) and **Empty track (add audio later)** (creates a row titled "Untitled" for adding audio later). A footer tip points at the drag-drop gesture too.

### Track Details Sheet
- `⋯` button on every track row in AlbumPage opens a bottom sheet (slides up on mobile, centered modal on desktop) — replaces the old "open ShareModal directly" entry point
- Header: artwork + title + `artist · album · BPM · key`
- **Track sharing** card: status dot (Anyone with link / Invite only / Sharing disabled / Not shared) + Copy link (when shared) or Share (when not)
- Action list: **Replace audio** (routes to `/track/:id?action=upload` which auto-clicks the file picker) · Insights · Notes · Allow/Disable downloads · Add to queue · Export audio · **Delete track** (destructive)
- Sub-views within the sheet: tapping Insights swaps to InsightsPanel inline; tapping Notes shows an inline textarea with save-on-blur. Back arrow returns to main view; Esc closes (or steps back from sub-view to main first)
- **Manage sharing…** at the bottom opens the original ShareModal (z-[60], above the sheet) for full link control

### Album Details Sheet
- The **Share album** button on AlbumPage opens an AlbumDetailsSheet (same bottom-sheet-on-mobile / centered-modal-on-desktop pattern as TrackDetailsSheet) — replaces the old "open AlbumShareModal directly" entry point and absorbs the separate `…` overflow menu (Rename / Delete)
- Header: album cover + title + `artist · status · N tracks`
- **Album sharing** card: status dot (Anyone with link / Invite only / Sharing disabled / Not shared) + Copy link (when shared) or Share (when not)
- Action list: **Change cover** (closes the sheet and triggers the cover file picker), **Rename album** (closes the sheet and enters inline-edit mode on the title), **Delete album** (destructive — confirm dialog, then cascades through DB and removes from the library store)
- **Manage sharing…** at the bottom opens the original `AlbumShareModal` for full link control. The inline-pencil rename next to the title is untouched, so quick rename without going through the sheet still works.

### Track Page (stripped down)
- `/track/<id>` shows: back link · title + **Edit button** · tempo/key strip + Re-detect · Versions (upload, play, make-current, share, download, delete per version)
- DownloadToggle and Insights/Notes tabs live in the sheet
- The Edit button navigates to the full-screen editor at `/edit/:trackId`

### Track Editor
- Route: `/edit/:trackId`, lives **outside** `AppShell` (full-screen, Cancel/Save chrome)
- Loaded as a **code-split `React.lazy` chunk** so the main bundle isn't paying for `soundtouchjs`
- Header: Cancel · centered title + album subtitle · Save
- Info pills: key · BPM · Settings
- Static peaks-based waveform with an accent-color playhead bar
- Transport: Restart · Play/Pause · Reset all
- **Three tabs**:
  - **Adjust** — Speed (0.5x–2.0x) and Pitch (-12 to +12 semitones), **independent** via `soundtouchjs` `PitchShifter`. Tap a slider's value label to reset that slider.
  - **EQ** — 4-band parametric EQ rendered as a **draggable graph**: each band is a circle that you drag horizontally for frequency and vertically for gain (-12 to +12 dB). Smooth Catmull-Rom curve through the handles, dashed 0 dB baseline, per-band labels under each dot that track horizontally with the dragged frequency. Bypass toggle in the section header. Below the graph: Delay (amount, time, feedback) and Reverb (amount) as sliders.
  - **Stems** — "Coming soon" placeholder (pending ML decision)
- **Save persistence** via `tracks.editor_settings` JSONB column; settings hydrate into the engine on load so reopening a track restores the user's adjustments. Saving the default state writes `null` to keep rows clean.
- Audio chain: `PitchShifter` → 4-band biquad EQ → splits into dry / delay (with feedback loop) / convolution reverb → master gain → destination. Reverb impulse is synthesized at construction so we don't ship an IR file.

### Versions and uploads
- Upload WAV/MP3/AIFF/FLAC/M4A
- Waveform peaks pre-computed in browser via Web Audio API
- Per-version actions on TrackPage: play, make current, share (per-version ShareModal), download, delete
- **Background uploads** (`useUploadStore`): the upload pipeline lives in a zustand store so the work survives navigation. A floating chip (bottom-right, above the player bar) shows per-job phase (decoding → analyzing → uploading → saving), errors, and a clickable track-title link. Completed jobs auto-dismiss after 12s; a `beforeunload` prompt fires while jobs are active. A **Reload to view** button appears at the bottom of the chip whenever a job is done — for surfaces that don't auto-merge (e.g. drag-dropped new tracks where the version field stays null on AlbumPage), one click refreshes the page.
- **Per-track and album-aggregate percentages**: the upload step uses a raw `XMLHttpRequest` against `${SUPABASE_URL}/storage/v1/object/audio/<path>` (not the supabase-js `.upload()` helper) so we can read `xhr.upload.onprogress` and emit byte-level percentages. Each job carries a `progress` field (0..1) on a phase budget — decode/analyze 0–15%, upload 15–90%, save→done 90–100%. Progress emits are throttled (≥120ms or ≥5% jump). The chip renders per-job bars with live percent labels; when multiple jobs share an `albumId`, an aggregate row appears above the rows showing the album-level percentage weighted by file size. The collapsed-chip header shows the global "Uploading N files · X%" rollup.
- **Drag-and-drop import**: drop audio files anywhere on the album track-list panel to **create a new track per file** (title derived from filename via `inferTrackTitle`, which strips BPM/key/version tokens). Drop a file **on a specific track row** to add a new version to that track instead — the row gets an accent-tinted highlight and the album-level overlay yields to it. A native-DnD depth counter on both the panel and each row prevents the highlight from flickering when crossing child elements.

### Audio analysis (real, content-based)
- **BPM**: `web-audio-beat-detector`, run on 3 segments of the song, folded into 60–180 range, median-clustered to kill half-/double-time outliers
- **Key**: custom chromagram + Krumhansl-Schmuckler with energy-weighted frames and peakedness filter to ignore percussive frames
- **Re-detect button** on track page — fetches the current version, re-runs analysis, persists detected values
- Filename hints (`120 BPM Am.wav`) take priority over content detection

### Player (Now Playing-ready, gapless)
- Persistent bottom player bar with wavesurfer.js
- Volume + mute, persisted to localStorage
- Mobile: title + play controls + thin tap-to-seek progress bar; waveform hidden
- **Gapless auto-advance**: a single `WaveSurfer` instance is created lazily on the first track and reused for every subsequent track change — `ws.load(nextUrl)` instead of destroy + recreate. A hidden `<audio preload="auto">` points at `queue[idx + 1]` while the current track plays, warming the browser's HTTP cache so the next load is effectively instant. A `finishingRef` flag swallows the trailing `pause` that wavesurfer emits at natural end (which would otherwise flip `isPlaying` to false and skip the auto-play on the next track).
- **`navigator.mediaSession` wired**: title, artist, album, artwork (album cover when set, otherwise the high-res Stagehand mark at 192/512/1024) are pushed to iOS Control Center / Android lock screen on every track change. Action handlers for play/pause/next/prev/seekto are wired so the lock-screen buttons control playback. `setPositionState` reports duration+position so the system scrubber stays accurate.

### Sharing
- Per-track shares and per-album shares (polymorphic `share_links`)
- Album shares snapshot current versions of every track into a `payload` JSONB
- Visibility modes: **Anyone with link** / **Invite only** / **Disabled**
- Optional **Require sign-in** toggle for link-mode shares
- **Single-use link** checkbox (link-mode only) — burns after first opener; refreshing locks them out
- Expiry options: 24h / 7d / 30d / 1yr / **Never expires**
- Invite-only mode enforces by listener's email (case-insensitive); invite manager UI in modal
- Slugged URLs at `/listen/<slug>`
- Revoke kill-switch per link

### Share link previews / unfurls
- Netlify Edge Function `netlify/edge-functions/share-preview.ts` (path config `/listen/*`)
- On every `/listen/<slug>` request: calls `context.next()` for the static `index.html`, hits the `resolve_share_preview` RPC with the slug, then rewrites `<title>`, `og:title`, `og:description`, `og:image`, `twitter:image`
- Album share → album cover + `"<album> — <artist> · Stagehand"`
- Track share → parent album's cover + `"<track> — <artist> · Stagehand"`
- Revoked / expired / disabled / consumed / missing cover → `/logo-4096.png` + `"Stagehand"`
- Backed by `resolve_share_preview` RPC (SECURITY DEFINER) — read-only, never consumes single-use links, never returns audio URLs

### Listen page (recipient view)
- Resolves via `resolve_share` SECURITY DEFINER RPC — single round trip with rich status codes (`expired`, `revoked`, `disabled`, `consumed`, `requires_signin`, `not_invited`, `not_found`, `ok`)
- Dispatches between single-track view and album-track-list view
- Footer copy adapts to single-use / never-expires / dated-expiry
- Save button for signed-in listeners — saves to their library
- Download button for tracks where the owner allowed it

### Saves
- Polymorphic `saves` table (track_id XOR album_id)
- Saved page shows two sections: Saved albums (grid) and Saved tracks (list)
- Playback uses the original artist's share link's signed URL; server-side withholds the URL if the share is revoked/expired/disabled/consumed
- Per-row Download button on Saved tracks when the owner enabled `allow_download`

### Insights (per-track)
- Hosted inside the track details sheet (sub-view)
- Stat cards: Plays, Saves
- Listener feed: shows artist name for signed-in listeners, "Anonymous" for share-link listens without an account
- Saves feed: who saved + when

### Library cache
- `useLibraryStore` (zustand) holds the album list with a stale-while-revalidate `load()` — first visit fetches and stores; every subsequent visit reads cached albums **immediately** (no skeleton flash) then quietly refreshes in the background. Same pattern as `useProfileStore`. Cleared on sign-out.

### Error display
- Centralized `formatErr(e: unknown): string` in `src/lib/errors.ts`. Pulls human text out of Supabase's plain-object errors (`{ message, details, hint, code }`) and falls back to JSON-stringify so even an unknown shape surfaces *something* rather than the legendary "[object Object]". Used at every catch site that renders an error to the UI.

### Branding & icons
- 3-bar SVG mark — single source in `public/favicon.svg` and `src/components/Logo.tsx`
- High-res PNG rasters generated and committed: `logo-{192,512,1024,2048,4096}.png`, `apple-touch-icon.png` (180), `og-image.png` (1200). Regen via `npm run gen:icons` (uses `@resvg/resvg-js`)
- `public/manifest.webmanifest` declares icons for PWA install
- All UI buttons use `lucide-react` icons. Play icons get `fill="currentColor"` + 1px x-nudge so they look like Apple-style triangles. Heart toggles `fill` between currentColor / none for saved/unsaved state.

---

## Stack and core architectural decisions

| Decision | Why |
|---|---|
| **Vite + React + TS + Tailwind v3** | Static SPA, deploys clean to Netlify, fast dev loop |
| **Supabase (auth + Postgres + Storage)** | Auth, DB, and S3-compatible storage in one; client talks directly via RLS |
| **Netlify hosting** | Static + SPA redirect rule in `netlify.toml`; auto-deploys from GitHub `main`. Edge Functions for OG rewrite — still no traditional backend server. |
| **Audio in private `audio` bucket, art in public `artwork` bucket** | Audio is sensitive (unreleased), art needs cheap public URLs. Avatars piggyback on `artwork` under `${user.id}/avatar/...` |
| **Signed URLs (1 hr default), longer for share links** | Prevents URL leakage for streaming; share link's signed URL expires when the share does |
| **SECURITY DEFINER RPCs for public access** | `resolve_share`, `resolve_share_preview`, `record_play`, `list_my_saves` — bypass RLS cleanly without creating cross-table recursion in policies |
| **Polymorphic share_links and saves (track XOR album)** | Single set of code paths for shares/saves; check constraint enforces exactly-one |
| **Browser-side audio analysis** | No backend audio worker; FFT + tempo detection in main thread. ~6s on a 4-min song. Worker is a future optimization. |
| **`soundtouchjs` for the track editor's speed/pitch** | Native `<audio>` `playbackRate` couples speed and pitch. soundtouchjs `PitchShifter` decouples both axes via Web Audio. Main-thread script-processor for now; worklet is the upgrade path. |
| **Synthetic reverb IR** | Generates a noise-burst exponential-decay impulse at construction. Sounds OK and saves shipping an IR file with the bundle. |
| **Editor route lives outside `AppShell` and is code-split** | Editor is a full-screen, modal-style experience and pulls in soundtouchjs — both reasons not to load it for users who never open it. |
| **Editor settings as a JSONB column (`tracks.editor_settings`)** | Single `update({ editor_settings: settings })` call. New tabs can grow the shape without migrations. Default-state save writes `null` to keep rows clean. |
| **Background upload pipeline lives in a zustand store, not a component** | Component unmounts on navigation; the work shouldn't. The store owns the job, exposes phase/progress reactively, and a global `<UploadIndicator />` mounted in AppShell renders it anywhere. |
| **Raw XHR for the audio upload step, not supabase-js `.upload()`** | We need `xhr.upload.onprogress` to drive byte-level percent. The supabase-js helper hides progress. We replicate the same Storage REST endpoint, auth, and headers and intercept progress events. RLS still applies. |
| **Gapless playback via one wavesurfer instance + preloaded `<audio>` for queue[idx+1]** | Destroying/recreating wavesurfer on every track change adds ~200ms of setup cost; fetching the next signed URL inline adds another ~200ms; reading the full file from network adds however much. A persistent instance avoids the setup cost. A hidden `<audio preload="auto">` warms the browser HTTP cache so the next `ws.load(url)` is effectively from disk. Result: track transitions feel like continuous playback. |
| **`finishingRef` flag in PlayerBar** | wavesurfer fires `finish` and then the underlying HTMLAudioElement fires `pause`. Without suppression, that pause sets `isPlaying = false` and the next track loads but doesn't auto-play. The flag swallows exactly one trailing pause, then resets 250ms later. |
| **PlayerTrack carries `storagePath` OR `audioUrl`, resolved lazily** | Queue items for owned tracks pass `storagePath`; the player signs on demand with an in-memory cache so preload + actual load don't double-sign. Saved share-link tracks pass a pre-signed `audioUrl` (the listener can't read the original storage path). Same player code path. |
| **Stems tab stubbed — ML strategy is a separate decision** | Stem separation is a real ML task. Current recommendation when we commit: **Moises.ai API** (~$0.10–0.20 per track). |
| **Supabase Realtime on `plays` for notifications** | Realtime respects RLS — owners can read plays on their tracks, so subscribing to `INSERT` on `plays` with no filter naturally scopes server-side to owned tracks. |
| **`useLibraryStore` (zustand) with stale-while-revalidate** | Removes the skeleton-grid flash on remount. Same pattern as `useProfileStore`. |
| **Page-fade transition keyed on `pathname`** | One `<div key={pathname} className="animate-[pagein_180ms_ease-out]">` around `<Outlet/>`. Pure CSS keyframe, no animation library. |
| **Detection only auto-applies on empty fields; Re-detect overrides** | Don't clobber manual values silently |
| **Single-use shares burn on first `resolve_share` call, not first play** | Simplest semantic: opening the page consumes it. |
| **Never-expires share signs the storage URL for 10 years** | Supabase signed URLs are JWTs with arbitrary TTLs; 10y avoids re-signing infrastructure. |
| **Mobile-first** | Every feature must work on phones; some "extreme" features (drag-to-reorder, EQ graph dragging at very small sizes) can be desktop-leaning as a documented trade-off |
| **MediaSession lives in PlayerBar, not pages** | The bar is the single source of truth for active audio; setting MediaMetadata there means every entry point gets correct lock-screen UI for free. |
| **Track details sheet replaces ShareModal-as-primary-entry-point** | Cleaner UX: a context-menu bottom sheet exposes sharing as a single status+CopyLink card, with "Manage sharing…" deferred for advanced cases. |
| **OG previews via Netlify Edge Function** | The SPA serves the same static `index.html` for every URL. OG scrapers don't run JS — an edge function is the only place to inject per-share metadata without a real backend. |
| **`resolve_share_preview` is separate from `resolve_share`** | Preview RPC must not consume single-use shares (scrapers can't burn a link before the human opens it) and must not return audio URLs. Different security profile = different function. |
| **Centralized `formatErr` for error display** | Supabase responses bubble up as plain objects, not Error instances. `String(e)` produces "[object Object]". `formatErr` pulls `.message`/`.details`/etc and falls back to JSON stringify. One module, used everywhere. |

---

## Database schema (summary)

- `profiles` (id → auth.users, artist_name, avatar_url)
- `albums` (owner_id, title, artwork_url, status, target_release_date) — `ON DELETE CASCADE` to tracks
- `tracks` (album_id, title, position, status, notes, bpm, song_key, allow_download, play_count, current_version_id, **editor_settings jsonb**)
- `versions` (track_id, label, storage_path, duration_sec, peaks)
- `share_links` (**polymorphic**: track_id nullable, album_id nullable, exactly-one via check; slug, signed_url nullable, payload jsonb, expires_at nullable, revoked, visibility, require_account, single_use, consumed_at, play_count)
- `share_invites` (share_link_id, email — unique on lower(email))
- `saves` (polymorphic: track_id XOR album_id; user_id, share_link_id)
- `plays` (track_id, user_id nullable for anonymous, share_slug, created_at) — **must be in the `supabase_realtime` publication** for notification toasts to fire

### Key RPCs
- `handle_new_user()` — trigger on auth.users insert, creates profile with artist_name from signup metadata
- `resolve_share(slug)` — returns share + track/version OR share + album/tracks payload, with status codes
- `resolve_share_preview(slug)` — read-only preview for the OG edge function
- `record_play(track_id, slug?)` — validates share if slug given, inserts play row, increments counters
- `list_my_saves()` — returns mixed array of saved tracks and saved albums as JSON

### Migrations status
- ✅ `supabase/migration_share_optional_expiry_single_use.sql` — applied. Adds nullable `expires_at`, `single_use`, `consumed_at`; redefines `resolve_share`. Idempotent.
- ✅ `supabase/migration_share_preview.sql` — applied. Adds `resolve_share_preview`. Idempotent.
- ✅ `supabase/migration_editor_settings.sql` — applied. Adds `tracks.editor_settings jsonb`. Idempotent.
- ⏳ `supabase/migration_audio_bucket_size.sql` — **needs to be run**. Raises the `audio` bucket's per-file limit to 1 GiB. **Also bump the project-level Global file size limit in Supabase Dashboard → Storage → Settings — the bucket cap can't exceed the project cap (50 MB on free tier; up to 50 GB on Pro).**
- ⏳ `supabase/migration_polymorphic_shares_saves.sql` — **needs to be run**. Adds polymorphic `share_links.album_id`, `visibility`, `require_account`, `payload`; relaxes track_id/version_id/signed_url to nullable; adds exactly-one check; creates `share_invites`, `saves`, `plays` tables with RLS; adds `record_play` and `list_my_saves` RPCs; adds plays to the realtime publication; **rewrites the `share_links` RLS policy** so album owners can also insert (the old policy only checked track ownership and rejected album-shares with 42501). Idempotent.

---

## Currently-tracked bugs / known limitations

### Netlify deploys stuck (current blocker)
`https://stagehand1.netlify.app/` is returning 404 across all recent commits. Locally the build is clean (`npm run build` succeeds) and GitHub has every commit. The site itself isn't being served by Netlify — likely an account-side issue (free-tier bandwidth cap hit, site paused, GitHub integration unlinked, etc.). Empty-commit pushes haven't triggered a rebuild. **Fix from the Netlify dashboard**: check the Deploys tab on `stagehand1`, confirm whether recent commits are showing as building/published/failed, manually trigger a deploy or restore the site from "Stopped" state if necessary. Verify Site settings → Build & deploy hasn't gone "Auto publishing off". Cannot be fixed from here without Netlify auth.

### Schema/repo gaps for polymorphic shares + saves + plays
The original polymorphic-shares migration (and `share_invites`, `saves`, `plays` tables, plus `record_play` and `list_my_saves` RPCs) was applied to the live DB at some point but never committed to the repo. A fresh Supabase project — or any project that ever lost those tables — hits `column share_links.album_id does not exist (42703)` on album share, then `new row violates row-level security policy ... (42501)` once the columns exist but the RLS policy still only handles track shares. **Resolved going forward** by `supabase/migration_polymorphic_shares_saves.sql`, which is now in the repo and needs to be run on any project missing the polymorphic layer.

### Storage isn't swept on album/track/version delete
DB cascades clean up `albums → tracks → versions → share_links` rows, but the audio files in the `audio` bucket and artwork in the `artwork` bucket stay as orphans. Doesn't break anything functionally — just consumes space. Server-side trigger or scheduled function is the fix.

### Editor seek is approximate
`soundtouchjs` `PitchShifter` doesn't support seeking. Our `seek(sec)` slices the underlying `AudioBuffer` at that point and recreates the shifter — works, but a tiny gap on big jumps and a fresh copy of the buffer is made each time.

### Editor pitch shifting runs on the main thread
`soundtouchjs` uses a `ScriptProcessorNode` internally (deprecated but functional). Fine on desktop and modern phones; can stutter on older Androids under heavy load. Worklet migration is the upgrade path.

### Editor reverb is a synthetic IR
Decent for v1 (noise burst, exponential decay) — not a real room impulse. Swap for a curated set of IRs later.

### Stems tab is stubbed
Decision deferred — see "Things that need a decision" below.

### Audio decode happens in the main thread before upload
`decodeAudio(file)` reads the whole file into an ArrayBuffer and decodes to a float32 AudioBuffer to compute peaks + BPM + key. A 500 MB WAV peaks at ~1 GB of RAM and can OOM mobile Safari. Decision is to keep this for the BPM/key auto-detection benefit; expect failures at the "Decoding audio…" step on very large files on phones. Web Worker / chunked decode is the eventual fix.

### Auto-advance "gapless" still has a tiny decoder-init latency
The persistent-wavesurfer + HTTP-cache-preload combo eliminates the multi-second fetch + decode gap, but there's still ~30–80ms of decoder-init time on most browsers at the first sample of each track. For sample-accurate gapless (zero perceptible click), you'd need Web Audio API scheduling — a much bigger change.

### Notification toasts depend on Realtime being enabled
The `plays` table must be in the `supabase_realtime` publication for the live toasts to fire. The polymorphic-shares migration adds it automatically; the bell's history (initial 20-row fetch) works either way.

### Per-version Share button on TrackPage still opens raw ShareModal
The new sheet has a clean Share card, but TrackPage's per-version row still uses the original modal directly. Not a bug per se, but inconsistent UX.

### Single-use link is consumed on first `resolve_share`, not first play
If the recipient opens the link in a preview pane (iMessage, Slack unfurl), the link can be consumed before the human sees it. Mitigated for unfurls now that `resolve_share_preview` handles scraper traffic separately and never consumes, but a human pasting the link into a tab still consumes on resolve.

### OG preview cache invalidation
Slack / Twitter / Facebook etc. cache OG previews aggressively. Changing album cover doesn't propagate until the platform re-scrapes. Not fixable from our side.

### Build size
With `web-audio-beat-detector` + `fft.js` + `lucide-react` + `soundtouchjs`, the main chunk is ~770 KB minified (~220 KB gzip). Editor route is code-split. Next win: code-split the analysis libs so they only load on Re-detect.

### Audio analysis on main thread
2–6s blocking work during upload (decode + FFT + key + BPM). UI shows status text but can feel sluggish on slower phones. Move to a Web Worker eventually.

### Don't run "Music Production Schema with RLS and Storage Policies" saved query in Supabase
That saved query in the SQL editor's PRIVATE section is the original `schema.sql` content from before any migrations. Running it will redefine `resolve_share` with the wrong signature and conflict with the applied migrations. Source of truth is the `supabase/*.sql` files in this repo.

---

## Things that need a decision

### Stems strategy
The Stems tab in the editor is stubbed. Three paths:
1. **Moises.ai API** — ~$0.10–$0.20 per track, production-quality separation, no infra. Recommended for v1.
2. **Self-host Demucs** in a Python worker (Render/Modal/Railway + GPU) — full control, you eat the compute cost.
3. **Browser-side ONNX** — works, but 1–5 min of phone-melting compute per track. Not viable for mobile.

### Domain
`stagehand.app` is taken (theater stage-management tool). Keep the name **Stagehand**, pick a different TLD. Candidates: `stagehand.fm` (clearest "music" signal), `stagehand.studio`, `stagehand.io`, or `getstagehand.com` as fallback.

### Netlify or move
Tracked separately because the Netlify deploys are currently stuck. If credits/account remain an issue, Vercel (comparable free tier) or Cloudflare Pages (much more generous, unlimited bandwidth) are equivalent landing zones for the SPA + edge function for OG rewrites. Decision deferred until we see whether the dashboard fix resolves it.

---

## Immediate next steps

1. **Unstick Netlify** — log in to the dashboard, check Deploys, retrigger or restore the site. If credits/account are the issue, decide whether to upgrade Netlify or migrate to Vercel / Cloudflare Pages.
2. **Run the two pending migrations** in Supabase SQL Editor:
   - `migration_audio_bucket_size.sql` — bucket cap to 1 GiB. Also bump project-level Global file size limit in Supabase Dashboard → Storage → Settings.
   - `migration_polymorphic_shares_saves.sql` — catches a project up on the polymorphic shares + saves + plays layer if it's missing.
3. **Mobile QA pass on the deployed build** — sign up → create album → upload (test the new background upload chip and percentages) → share album → open in private tab → confirm notification + toast fires. Catches iOS Safari quirks.
4. **Verify the OG unfurl flow on live** — paste a `/listen/<slug>` into iMessage / Slack / opengraph.xyz. Confirm image + title render.
5. **Decide Stems strategy** (Moises.ai recommended).
6. **Storage cleanup on delete** — Postgres trigger or scheduled function to sweep orphaned audio/artwork.
7. **Move `soundtouchjs` to an Audio Worklet** so pitch shifting runs off-main-thread.
8. **Move audio analysis (BPM/key) to a Web Worker** to keep the UI smooth during upload.
9. **Code-split `web-audio-beat-detector` + `fft.js`** so the analysis libs only load on Re-detect.
10. **Unify per-version Share on TrackPage** with the new sheet pattern, or drop per-version Share as a v1 feature.
11. **Buy and point a domain** once we pick one. Update Supabase Site URL / Redirect URLs and `INSTAGRAM_URL` / `CONTACT_EMAIL` accordingly.
12. **Hand the URL to a small artist friend group for real testing** once 1–4 are confirmed green.

---

## How to run locally

```bash
cd ~/Desktop/stagehand
npm install
npm run dev -- --host    # --host exposes on the LAN so iPhone Safari can hit http://<mac-ip>:5173
```

Note: the OG edge function only runs in Netlify's environment. Locally, `/listen/<slug>` will serve the unmodified `index.html` — OG previews are untestable from `npm run dev`. Push to a branch and use Netlify's deploy preview URL, or `netlify dev` if you have the Netlify CLI installed.

To regenerate the logo PNGs after changing the SVG:

```bash
npm run gen:icons
```

`.env` must contain matching `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the same Supabase project. Schema lives in `supabase/schema.sql` plus the focused migrations in `supabase/migration_*.sql`; run them in Supabase → SQL Editor, one tab at a time, in a fresh empty pane (don't paste into the old "Music Production Schema" saved query — see the bug note above).

To ship changes:

```bash
git add <files>
git commit -m "<message>"
git push    # Netlify auto-rebuilds in ~1–2 min — when Netlify is working
```
