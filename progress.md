# Stagehand — Progress

A private workspace for music artists to track albums, store unreleased music, share with collaborators, listen anywhere, and edit a track's playback (speed/pitch/EQ/FX) before deciding it's ready. Public web app, mobile-first, deployed on Netlify.

- **Live**: https://stagehand1.netlify.app
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
  - **Support**: Tell a friend (uses Web Share API on mobile; falls back to clipboard with "Copied!" pill on desktop) · Send feedback (`mailto:` with prefilled subject `[Stagehand feedback]` and a "what's working / broken / wish existed" template) · Contact us · Stagehand on Instagram (inline SVG icon since lucide@1.14 has no `Instagram` export)
  - **Legal**: Terms of Service · Privacy Policy (both "Soon" pills until URLs are filled in)
  - Sign out is in its own destructive group at the bottom
- Saving the name writes both `profiles.artist_name` AND `auth.user_metadata.artist_name`, so existing `user.user_metadata.artist_name` reads (PlayerBar / AlbumPage / TrackPage) stay correct with no refactor
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

### Track Details Sheet
- `⋯` button on every track row in AlbumPage opens a bottom sheet (slides up on mobile, centered modal on desktop) — replaces the old "open ShareModal directly" entry point
- Header: artwork + title + `artist · album · BPM · key`
- **Track sharing** card: status dot (Anyone with link / Invite only / Sharing disabled / Not shared) + Copy link (when shared) or Share (when not)
- Action list: **Replace audio** (routes to `/track/:id?action=upload` which auto-clicks the file picker) · Insights · Notes · Allow/Disable downloads · Add to queue · Export audio · **Delete track** (destructive)
- **Sub-views within the sheet**: tapping Insights swaps the sheet contents to InsightsPanel inline; tapping Notes shows an inline textarea with save-on-blur. Back arrow returns to main view; Esc closes (or steps back from sub-view to main first)
- **Manage sharing…** at the bottom opens the original ShareModal (which sits at `z-[60]`, above the sheet) for full link control

### Track Page (stripped down)
- `/track/<id>` shows: back link · title + **Edit button** · tempo/key strip + Re-detect · Versions (upload, play, make-current, share, download, delete per version)
- DownloadToggle and Insights/Notes tabs live in the sheet
- The Edit button navigates to the full-screen editor at `/edit/:trackId`

### Track Editor (new)
- Route: `/edit/:trackId`, lives **outside** `AppShell` (full-screen, Cancel/Save chrome)
- Loaded as a **code-split `React.lazy` chunk** so the main bundle isn't paying for `soundtouchjs`
- Header: Cancel · centered title + album subtitle · Save
- Info pills: key · BPM · Settings
- Static peaks-based waveform with an accent-color playhead bar
- Transport: Restart · Play/Pause · Reset all
- **Three tabs**:
  - **Adjust** — Speed (0.5x–2.0x) and Pitch (-12 to +12 semitones), **independent** via `soundtouchjs` `PitchShifter`. Tap a slider's value label to reset that slider.
  - **EQ** — 4-band parametric EQ (Low shelf / Low mid / High mid / High shelf) rendered as a **draggable graph**: each band is a circle that you drag horizontally for frequency and vertically for gain (-12 to +12 dB). Smooth Catmull-Rom curve through the handles, dashed 0 dB baseline, per-band labels under each dot that track horizontally with the dragged frequency. Bypass toggle in the section header. Below the graph: Delay (amount, time, feedback) and Reverb (amount) as sliders.
  - **Stems** — "Coming soon" placeholder (pending ML decision; see "Things that need a decision" below)
- **Save persistence** via new `tracks.editor_settings` JSONB column; settings hydrate into the engine on load so reopening a track restores the user's adjustments. Saving the default state writes `null` to keep rows clean.
- Audio chain: `PitchShifter` → 4-band biquad EQ → splits into dry / delay (with feedback loop) / convolution reverb → master gain → destination. The reverb impulse is synthesized at construction so we don't ship an IR file.
- Container is responsive: a `ResizeObserver` sets the SVG viewBox to the panel's actual width with `preserveAspectRatio="none"` so the EQ graph spans the full bar on any breakpoint.

### Versions
- Upload WAV/MP3/AIFF/FLAC/M4A
- Waveform peaks pre-computed in browser via Web Audio API
- Per-version actions on TrackPage: play, make current, share (per-version ShareModal), download, delete
- Per-version download button (owner side) alongside Share/Delete
- **Background uploads**: kicking off an upload from a track page hands the work to a `useUploadStore` zustand store. The user can navigate to other albums, edit, /saved, etc. while the upload continues. A floating chip (bottom-right, above the player bar) shows per-job phase (decoding → analyzing → uploading → saving), errors, and a clickable track-title link. Completed jobs auto-dismiss after 6s; a `beforeunload` prompt fires while jobs are active. When the user returns to a track whose upload completed elsewhere, the next mount's `versions` fetch already includes the new row; if they're already on the track page when it lands, a store subscription merges the new version into the local list in place.
- **Per-track and album-aggregate upload percentages**: the upload step uses a raw `XMLHttpRequest` against `${SUPABASE_URL}/storage/v1/object/audio/<path>` (not the supabase-js `.upload()` helper) so we can read `xhr.upload.onprogress` and emit byte-level percentages. Each job carries a `progress` field (0..1) that's mapped onto a phase budget — decode/analyze are fixed checkpoints at 5–15%, upload owns 15–90%, save→done finishes the bar. Progress emits are throttled (≥120ms or ≥5% jump) so a fast 500 MB upload doesn't re-render the indicator hundreds of times per second. The chip renders a per-job progress bar with a live percent label; when multiple jobs share an `albumId`, an aggregate row appears above the per-track rows showing the album-level percentage weighted by file size (so a 200 MB stem doesn't get drowned out by a 5 MB one). The collapsed-chip header also shows the global "Uploading N files · X%" rollup across all active jobs.
- **Drag-and-drop import**: drop audio files anywhere on the album track-list panel to **create a new track per file** (title derived from filename via `inferTrackTitle`, which strips BPM/key/version tokens). Drop a file **on a specific track row** to add a new version to that track instead — row gets an accent-tinted highlight and the album-level "drop to add tracks" overlay yields to it. Multi-file album drops insert tracks in parallel and enqueue one background upload per file; the existing upload store handles BPM/key detection per track. A native-DnD depth counter on both the panel and each row prevents the highlight from flickering when crossing child elements.

### Audio analysis (real, content-based)
- **BPM**: `web-audio-beat-detector`, run on 3 segments of the song, folded into 60–180 range, median-clustered to kill half-/double-time outliers
- **Key**: custom chromagram + Krumhansl-Schmuckler with energy-weighted frames and peakedness filter to ignore percussive frames
- **Re-detect button** on track page — fetches the current version, re-runs analysis, persists detected values
- Filename hints (`120 BPM Am.wav`) take priority over content detection
- `formatErr` helper surfaces real Supabase error messages instead of `[object Object]`

### Player (Now Playing-ready)
- Persistent bottom player bar with wavesurfer.js
- Volume + mute, persisted to localStorage
- Mobile: title + play controls + thin tap-to-seek progress bar; waveform hidden
- Auto-advance through queues
- **`navigator.mediaSession` wired**: title, artist, album, artwork (album cover when set, otherwise the high-res Stagehand mark at 192/512/1024) are pushed to iOS Control Center / Android lock screen on every track change
- Action handlers: play/pause/next/prev/seekto are all wired so the lock-screen buttons control playback
- `setPositionState` reports duration+position so the system scrubber stays accurate

### Sharing
- Per-track shares and per-album shares
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
- On every `/listen/<slug>` request: calls `context.next()` for the static `index.html`, hits the `resolve_share_preview` RPC with the slug, then rewrites `<title>`, `og:title`, `og:description`, `og:image`, `twitter:image` (and drops the 1200×1200 dimension hints when using a non-default image)
- **Album share** → album cover + `"<album> — <artist> · Stagehand"`
- **Track share** → parent album's cover + `"<track> — <artist> · Stagehand"`
- **Revoked / expired / disabled / consumed / missing cover** → `/logo-4096.png` + `"Stagehand"`
- Backed by `resolve_share_preview` RPC (SECURITY DEFINER) in `supabase/migration_share_preview.sql` — read-only, never consumes single-use links, never returns audio URLs

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
- Per-row Download button on Saved tracks when the owner enabled `allow_download` (fetched per-row from `tracks` table after `list_my_saves` resolves)

### Insights (per-track)
- Hosted inside the track details sheet (sub-view)
- Stat cards: Plays, Saves
- Listener feed: shows artist name for signed-in listeners, "Anonymous" for share-link listens without an account
- Saves feed: who saved + when

### Library cache (new)
- `useLibraryStore` (zustand) holds the album list with a stale-while-revalidate `load()` — first visit fetches and stores; every subsequent visit reads cached albums **immediately** (no skeleton flash) then quietly refreshes in the background. Same pattern as `useProfileStore`. Cleared on sign-out.
- Fixes the "back to Library shows skeleton then 1 album" flash that testers were catching.

### Branding & icons
- 3-bar SVG mark (left tall white, center tall accent-orange, right short white) — single source in `public/favicon.svg` and `src/components/Logo.tsx`
- **High-res PNG rasters generated and committed**: `logo-{192,512,1024,2048,4096}.png`, `apple-touch-icon.png` (180), `og-image.png` (1200) — output from `scripts/generate-icons.mjs` using `@resvg/resvg-js`; regen via `npm run gen:icons`
- `public/manifest.webmanifest` declares icons for PWA install
- `index.html` carries: PNG favicons, apple-touch-icon, OG/Twitter image, manifest link, web-app title, theme color
- **Full emoji sweep**: all UI buttons replaced with `lucide-react` icons. Play icons get `fill="currentColor"` + 1px x-nudge so they look like Apple-style triangles. Heart toggles `fill` between currentColor / none for saved/unsaved state.

---

## Stack and core architectural decisions

| Decision | Why |
|---|---|
| **Vite + React + TS + Tailwind v3** | Static SPA, deploys clean to Netlify, fast dev loop |
| **Supabase (auth + Postgres + Storage)** | Auth, DB, and S3-compatible storage in one; client talks directly via RLS |
| **Netlify hosting** | Static + SPA redirect rule in `netlify.toml`; auto-deploys from GitHub `main`. Edge Functions for OG rewrite — still no traditional backend server. |
| **Audio in private `audio` bucket, art in public `artwork` bucket** | Audio is sensitive (unreleased), art needs cheap public URLs. Avatars piggyback on `artwork` under `${user.id}/avatar/...` — same owner-write RLS, no new bucket. |
| **Signed URLs (1 hr default), longer for share links** | Prevents URL leakage for streaming; share link's signed URL expires when the share does |
| **SECURITY DEFINER RPCs for public access** | `resolve_share`, `resolve_share_preview`, `record_play`, `list_my_saves` — bypass RLS cleanly without creating cross-table recursion in policies |
| **Polymorphic share_links and saves (track XOR album)** | Single set of code paths for shares/saves; check constraint enforces exactly-one |
| **Browser-side audio analysis** | No backend audio worker; FFT + tempo detection in main thread. ~6s on a 4-min song. Worker is a future optimization. |
| **`soundtouchjs` for the track editor's speed/pitch** | Native `<audio>` `playbackRate` couples speed and pitch; `preservesPitch=true` decouples speed but pitch-shifting still needs a library. soundtouchjs ships a `PitchShifter` that handles both axes independently and integrates with Web Audio. Main-thread script-processor for now; worklet is the upgrade path. |
| **Synthetic reverb IR** | Generates a noise-burst exponential-decay impulse at construction. Sounds OK and saves shipping an IR file with the bundle. |
| **Editor route lives outside `AppShell` and is code-split** | Editor is a full-screen, modal-style experience and pulls in soundtouchjs — both reasons not to load it for users who never open it. |
| **Editor settings as a JSONB column (`tracks.editor_settings`)** | Single `update({ editor_settings: settings })` call. New tabs (Stems control state, etc.) can grow the shape without migrations. Default-state save writes `null` to keep rows clean. |
| **Stems tab stubbed — ML strategy is a separate decision** | Stem separation is a real ML task. Self-hosting Demucs is an MLOps project; browser-side ONNX is too slow on mobile. Current recommendation when we commit: **Moises.ai API** (~$0.10–0.20 per track, mature, no infra). |
| **Supabase Realtime on `plays` for notifications** | Realtime respects RLS — owners can read plays on their tracks, so subscribing to `INSERT` on `plays` with no filter naturally scopes server-side to owned tracks. Each new row is hydrated client-side (track title + listener name) with small in-memory caches. |
| **`useLibraryStore` (zustand) with stale-while-revalidate** | Was a real flash fix, not premature optimization. Reading from a memo'd store on remount + background refresh removes the skeleton-grid flash that testers were catching. Same pattern as `useProfileStore`. |
| **Page-fade transition keyed on `pathname`** | One `<div key={pathname} className="animate-[pagein_180ms_ease-out]">` around `<Outlet/>`. No animation library — pure CSS keyframe — and it covers every route change cleanly. |
| **Detection only auto-applies on empty fields; Re-detect overrides** | Don't clobber manual values silently; explicit Re-detect button overwrites BPM/key |
| **Single-use shares burn on first `resolve_share` call, not first play** | Simplest semantic: opening the page consumes it. Signed URL embedded in the response is still good for the URL's lifetime so the first listener's playback continues even after refresh would be blocked. |
| **`expires_at` nullable + `single_use` orthogonal to `visibility`** | Keeps the visibility enum stable. Single-use only matters for `link` visibility; the create RPC zeroes it for invite/disabled. |
| **Never-expires share signs the storage URL for 10 years** | Supabase signed URLs are JWTs with arbitrary TTLs; 10y avoids re-signing infrastructure. |
| **Mobile-first** | Every feature must work on phones; some "extreme" features (drag-to-reorder, EQ graph dragging at very small sizes) can be desktop-leaning as a documented trade-off |
| **MediaSession lives in PlayerBar, not pages** | The bar is the single source of truth for active audio; setting MediaMetadata there means every entry point gets correct lock-screen UI for free, with no per-page wiring. |
| **High-res raster icons generated from a generous-viewBox SVG at build-script time** | iOS Now Playing rasterizes whatever artwork URL you give it. A 32×32 favicon yields a blurry image. Pre-rendered 1024+ PNGs solve it without runtime cost. |
| **Track details sheet replaces ShareModal-as-primary-entry-point** | Cleaner UX: a context-menu bottom sheet exposes sharing as a single status+CopyLink card, with "Manage sharing…" deferred for advanced cases. Same pattern now hosts Delete track. |
| **Profile name dual-written to `profiles` + `user_metadata`** | Existing code reads artist name from `user.user_metadata.artist_name` in 4+ places. Duplicate write is one extra `supabase.auth.updateUser` call on save and keeps everything in sync. |
| **Profile state in a zustand store, not React context** | Same shape as `usePlayer`. AppShell wraps ProfilePage, so without a shared store the header avatar wouldn't update until reload after an upload. |
| **OG previews via Netlify Edge Function** | The SPA serves the same static `index.html` for every URL. OG scrapers don't run JS — so an edge function is the only place to inject per-share metadata without a real backend. |
| **`resolve_share_preview` is separate from `resolve_share`** | Preview RPC must not consume single-use shares (scrapers can't burn a link before the human opens it) and must not return audio URLs. Different security profile = different function. |

---

## Database schema (summary)

- `profiles` (id → auth.users, artist_name, avatar_url)
- `albums` (owner_id, title, artwork_url, status, target_release_date) — `ON DELETE CASCADE` to tracks
- `tracks` (album_id, title, position, status, notes, bpm, song_key, allow_download, play_count, current_version_id, **editor_settings jsonb**) — `ON DELETE CASCADE` to versions and share_links
- `versions` (track_id, label, storage_path, duration_sec, peaks)
- `share_links` (polymorphic: track_id XOR album_id; slug, signed_url, payload jsonb, **expires_at nullable**, revoked, visibility, require_account, **single_use**, **consumed_at**, play_count)
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
- ✅ `supabase/migration_share_optional_expiry_single_use.sql` — applied. Idempotent.
- ✅ `supabase/migration_share_preview.sql` — applied. Adds `resolve_share_preview`. Idempotent.
- ✅ `supabase/migration_editor_settings.sql` — applied. Adds `tracks.editor_settings jsonb`. Idempotent.
- ⏳ `supabase/migration_audio_bucket_size.sql` — **needs to be run**. Raises the `audio` bucket's per-file limit to 1 GiB so artists can upload hi-res WAV/AIFF masters. **Also bump the project-level Global file size limit in Supabase Dashboard → Storage → Settings — the bucket cap can't exceed the project cap (50 MB on free tier; up to 50 GB on Pro).**
- ⏳ `supabase/migration_polymorphic_shares_saves.sql` — **needs to be run** if a Supabase project doesn't already have polymorphic `share_links.album_id`, the `share_invites` / `saves` / `plays` tables, or the `record_play` / `list_my_saves` RPCs. These were applied to the original live DB but never committed to the repo (same gap the `list_my_saves` source-of-truth note already called out). Symptoms when missing: `column share_links.album_id does not exist (42703)` when creating an album share. Idempotent; safe to re-run.

---

## Currently-tracked bugs / known limitations

### Storage isn't swept on album/track delete
DB cascades clean up `albums → tracks → versions → share_links` rows, but the audio files in the `audio` bucket and artwork in the `artwork` bucket stay as orphans. Doesn't break anything functionally — just consumes space. Server-side trigger or background sweep is the fix.

### Editor seek is approximate
`soundtouchjs` `PitchShifter` doesn't support seeking. Our `seek(sec)` slices the underlying `AudioBuffer` at that point and recreates the shifter — works, but a tiny gap on big jumps and a fresh copy of the buffer is made each time.

### Editor pitch shifting runs on the main thread
`soundtouchjs` uses a `ScriptProcessorNode` internally (deprecated but functional). Fine on desktop and modern phones; can stutter on older Androids under heavy load. Worklet migration is the upgrade path.

### Editor reverb is a synthetic IR
Decent for v1 (noise burst, exponential decay) — not a real room impulse. Swap for a curated set of IRs (small/medium/large/plate) later.

### Stems tab is stubbed
Decision deferred — see "Things that need a decision" below.

### Notification toasts depend on Realtime being enabled
The `plays` table must be added to the `supabase_realtime` publication for the live toasts to fire. The bell's history (initial 20-row fetch) works either way. If toasts don't show:
```sql
alter publication supabase_realtime add table public.plays;
```

### Per-version Share button on TrackPage still opens raw ShareModal
The new sheet has a clean Share card, but TrackPage's per-version row still uses the original modal directly. Not a bug per se, but inconsistent UX.

### AlbumShareModal hasn't been redesigned to match
Track sharing got the new card-style UX inside the sheet. Album sharing still uses the old `AlbumShareModal` with link-list UI. Should get a parallel "Album details" sheet at some point.

### Single-use link is consumed on first `resolve_share`, not first play
If the recipient opens the link in a preview pane (iMessage, Slack unfurl), the link can be consumed before the human sees it. Mitigated for unfurls now that `resolve_share_preview` handles scraper traffic separately and never consumes, but a human pasting the link into a tab still consumes on resolve regardless of whether they play.

### OG preview cache invalidation
Slack / Twitter / Facebook etc. cache OG previews aggressively. If an artist changes an album cover, existing pasted links keep showing the old image until the platform re-scrapes. Not fixable from our side.

### Build size
With `web-audio-beat-detector` + `fft.js` + `lucide-react` + `soundtouchjs`, the main chunk is getting heavy. Editor route is now code-split (`React.lazy`), which is the biggest win. Next: code-split `web-audio-beat-detector` + `fft.js` so they only load when someone re-detects BPM/key.

### Audio analysis on main thread
2–6s blocking work during upload (decode + FFT + key + BPM). UI shows status text but can feel sluggish on slower phones. Move to a Web Worker eventually.

### Filename detection edge cases
Track filenames like `Cm-110.wav` or `Em — slow build.wav` might surface ambiguous matches. Acceptable for now since Re-detect overrides.

### `list_my_saves` RPC is unowned by the repo
The function exists on the live DB but its source is not in `supabase/*.sql`. If we ever rebuild from this repo, we have to recreate it.

### Don't run "Music Production Schema with RLS and Storage Policies" saved query in Supabase
That saved query in the SQL editor's PRIVATE section is the original `schema.sql` content from before any migrations. Running it will redefine `resolve_share` with the wrong signature and conflict with the applied migrations. Source of truth is the `supabase/*.sql` files in this repo.

---

## Things that need a decision

### Stems strategy
The Stems tab in the editor is stubbed. Three paths when we commit:
1. **Moises.ai API** — ~$0.10–$0.20 per track, production-quality separation, no infra. Recommended for v1.
2. **Self-host Demucs** in a Python worker (Render/Modal/Railway + GPU) — full control, you eat the compute cost. Recommended only if scale or unit economics demand it later.
3. **Browser-side ONNX** (Demucs.js, spleeter-web) — works, but 1–5 minutes of phone-melting compute per track. Not viable for mobile.

### Domain
`stagehand.app` is taken (theater stage-management tool). Decision: keep the name **Stagehand**, pick a different TLD to avoid confusion. Strongest candidates: `stagehand.fm` (clearest "music" signal), `stagehand.studio`, `stagehand.io`, or `getstagehand.com` as fallback.

---

## Immediate next steps

1. **Mobile QA pass on the deployed build** — sign up → create album → upload → share → open in private tab → confirm notification + toast fires. Catches iOS Safari quirks.
2. **Verify the OG unfurl flow on live** — paste a `/listen/<slug>` into iMessage / Slack / opengraph.xyz. Confirm image + title render.
3. **Decide Stems strategy** (Moises.ai recommended).
4. **Storage cleanup on delete** — Postgres trigger or scheduled function to sweep orphaned audio/artwork.
5. **Move `soundtouchjs` to an Audio Worklet** so pitch shifting runs off-main-thread.
6. **Move audio analysis (BPM/key) to a Web Worker** to keep the UI smooth during upload.
7. **Code-split `web-audio-beat-detector` + `fft.js`** so the analysis libs only load on Re-detect.
8. **Redesign album sharing** to mirror the track-sharing sheet (Album details sheet).
9. **Unify per-version Share on TrackPage** with the new sheet pattern, or drop per-version Share as a v1 feature.
10. **Album rename + delete: storage sweep** — currently leaves orphan files in storage even though rows cascade cleanly. Same problem as #4; tracking separately because it's the most visible orphan source.
11. **Buy and point a domain** once we pick one of `stagehand.fm` / `stagehand.studio` / `getstagehand.com`. Update Supabase Site URL / Redirect URLs and `INSTAGRAM_URL` / `CONTACT_EMAIL` accordingly.
12. **Hand the URL to a small artist friend group for real testing** once 1–3 above are confirmed green.

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
git push    # Netlify auto-rebuilds in ~1–2 min
```
