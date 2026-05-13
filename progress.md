# Stagehand — Progress

A private workspace for music artists to track albums, store unreleased music, share with collaborators, and listen anywhere. Public web app, mobile-first, deployed on Netlify.

- **Live**: https://stagehand1.netlify.app
- **Repo**: https://github.com/undfwxlf-coder/stagehand (private)
- **Supabase project**: `ccsewcccfgqofvxsavne`

---

## What's built

### Core
- Email/password auth (Supabase) with email-confirmation flow; Supabase Site URL + Redirect URLs pointed at the Netlify domain so confirmation links resolve correctly
- Profile auto-created on signup, artist name carried through `raw_user_meta_data`
- Library: album grid, create albums, status pipeline (writing → recording → mixing → mastering → released)
- Cover art upload (public `artwork` bucket)
- Mobile-first layout — every page works on phone-sized viewports; iOS safe-area honored

### Profile (new)
- `/profile` route gated by `RequireAuth`, lives inside `AppShell`
- Circular avatar (tap to upload to `artwork` bucket under `${user.id}/avatar/...`, reuses existing public-read RLS), initial-letter fallback when no avatar
- Inline artist-name editor (pencil → input → save/cancel, Enter/Esc keyboard shortcuts)
- Joined date + email row + Sign out
- Header entry: round avatar button in the top-right of `AppShell` replaces the old email-text + sign-out cluster, links to `/profile`
- Saving the name writes both `profiles.artist_name` AND `auth.user_metadata.artist_name`, so existing `user.user_metadata.artist_name` reads (PlayerBar / AlbumPage / TrackPage) stay correct with no refactor
- Tiny zustand `useProfileStore` so uploads on `/profile` update the header avatar instantly; cleared on sign-out

### Tracks
- Album page with track list
- Drag-to-reorder via `@dnd-kit/sortable` (desktop only, persists positions)
- Inline rename (pencil on hover, double-click, or Enter/Esc keyboard)
- Per-track status (idea → demo → tracking → mixing → mastering → released)
- BPM + key fields, editable inline
- Allow-download toggle (moved into the new details sheet, no longer a separate strip)

### Track Details Sheet
- `⋯` button on every track row in AlbumPage opens a bottom sheet (slides up on mobile, centered modal on desktop) — replaces the old "open ShareModal directly" entry point
- Header: artwork + title + `artist · album · BPM · key`
- **Track sharing** card: status dot (Anyone with link / Invite only / Sharing disabled / Not shared) + Copy link (when shared) or Share (when not)
- Action list (six rows): Replace audio · Insights · Notes · Allow/Disable downloads · Add to queue · Export audio
- **Sub-views within the sheet**: tapping Insights swaps the sheet contents to InsightsPanel inline; tapping Notes shows an inline textarea with save-on-blur. Back arrow returns to main view; Esc closes (or steps back from sub-view to main first)
- **Manage sharing…** at the bottom opens the original ShareModal (which now sits at `z-[60]`, above the sheet) for full link control

### Track Page (stripped down)
- After the sheet refactor, `/track/<id>` now shows only: back link · title · **tempo/key strip + Re-detect** · **Versions** (upload, play, make-current, share, download, delete per version)
- DownloadToggle and Insights/Notes tabs removed — they live in the sheet now

### Versions
- Upload WAV/MP3/AIFF/FLAC/M4A
- Waveform peaks pre-computed in browser via Web Audio API
- Per-version actions on TrackPage: play, make current, share (per-version ShareModal), download, delete
- Per-version download button (owner side) added alongside Share/Delete

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
- `PlayerTrack` interface extended with optional `artistName` and `artworkUrl`; all 4 play() / setQueue() call sites (TrackPage, AlbumPage, SavedPage x2) populate them

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
- ShareModal close button now uses lucide `X`; z-index bumped to `z-[60]` so it sits above the track details sheet

### Share link previews / unfurls (new)
- Netlify Edge Function `netlify/edge-functions/share-preview.ts` (path config `/listen/*`)
- On every `/listen/<slug>` request: calls `context.next()` for the static `index.html`, hits the new `resolve_share_preview` RPC with the slug, then rewrites `<title>`, `og:title`, `og:description`, `og:image`, `twitter:image` (and drops the 1200×1200 dimension hints when using a non-default image)
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

### Branding & icons
- 3-bar SVG mark (left tall white, center tall accent-orange, right short white) — single source in `public/favicon.svg` and `src/components/Logo.tsx`
- **High-res PNG rasters generated and committed**: `logo-{192,512,1024,2048,4096}.png`, `apple-touch-icon.png` (180), `og-image.png` (1200) — output from `scripts/generate-icons.mjs` using `@resvg/resvg-js`; regen via `npm run gen:icons`
- `public/manifest.webmanifest` declares icons for PWA install
- `index.html` carries: PNG favicons, apple-touch-icon, OG/Twitter image, manifest link, web-app title, theme color
- **Full emoji sweep**: all UI buttons (play, pause, skip, share, download, delete, save, music placeholder, lock, sparkle/redetect) replaced with `lucide-react` icons. Play icons get `fill="currentColor"` + 1px x-nudge so they look like Apple-style triangles. Heart toggles `fill` between currentColor / none for saved/unsaved state.

---

## Stack and core architectural decisions

| Decision | Why |
|---|---|
| **Vite + React + TS + Tailwind v3** | Static SPA, deploys clean to Netlify, fast dev loop |
| **Supabase (auth + Postgres + Storage)** | Auth, DB, and S3-compatible storage in one; client talks directly via RLS |
| **Netlify hosting** | Static + SPA redirect rule in `netlify.toml`; auto-deploys from GitHub `main`. Edge Functions added for OG rewrite — still no traditional backend server. |
| **Audio in private `audio` bucket, art in public `artwork` bucket** | Audio is sensitive (unreleased), art needs cheap public URLs. Avatars piggyback on `artwork` under `${user.id}/avatar/...` — same owner-write RLS, no new bucket. |
| **Signed URLs (1 hr default), longer for share links** | Prevents URL leakage for streaming; share link's signed URL expires when the share does |
| **SECURITY DEFINER RPCs for public access** | `resolve_share`, `resolve_share_preview`, `record_play`, `list_my_saves` — bypass RLS cleanly without creating cross-table recursion in policies |
| **No public-read RLS policies on share_links / tracks / versions** | Earlier attempt caused infinite recursion (`42P17`) between `share_links` and `share_invites`. The RPCs replaced them. |
| **Polymorphic share_links and saves (track XOR album)** | Single set of code paths for shares/saves; check constraint enforces exactly-one |
| **Browser-side audio analysis** | No backend audio worker; FFT + tempo detection in main thread. ~6s on a 4-min song. Worker is a future optimization. |
| **Filename hints > content detection** | If artist explicitly named the file with BPM/key, respect them |
| **Detection only auto-applies on empty fields; Re-detect overrides** | Don't clobber manual values silently; explicit Re-detect button overwrites BPM/key |
| **Single-use shares burn on first `resolve_share` call, not first play** | Simplest semantic: opening the page consumes it. Signed URL embedded in the response is still good for the URL's lifetime so the first listener's playback continues even after refresh would be blocked. |
| **`expires_at` nullable + `single_use` orthogonal to `visibility`** | Keeps the visibility enum stable. Single-use only matters for `link` visibility; the create RPC zeroes it for invite/disabled. |
| **Never-expires share signs the storage URL for 10 years** | Supabase signed URLs are JWTs with arbitrary TTLs; 10y avoids re-signing infrastructure. |
| **Mobile-first** | Every feature must work on phones; some "extreme" features (drag-to-reorder) can be desktop-only as a documented trade-off |
| **MediaSession lives in PlayerBar, not pages** | The bar is the single source of truth for active audio; setting MediaMetadata there means every entry point (TrackPage, AlbumPage, SavedPage) gets correct lock-screen UI for free, with no per-page wiring. |
| **High-res raster icons generated from a generous-viewBox SVG at build-script time** | iOS Now Playing rasterizes whatever artwork URL you give it. A 32×32 favicon (or hostile cross-origin URL) yields a blurry image. Pre-rendered 1024+ PNGs hosted on the Netlify domain solve it without runtime cost. `@resvg/resvg-js` is pure JS (no native binary), works on any Node. |
| **Track details sheet replaces ShareModal-as-primary-entry-point** | Old UX: click Share on a version row → modal listing all existing share links. Felt cluttered for the common case (one primary link). New UX: a context-menu bottom sheet exposes sharing as a single status+CopyLink card, with "Manage sharing…" deferred for advanced cases. |
| **Sheet uses an in-component view stack (`main` ↔ `insights` ↔ `notes`)** | Instead of routing to separate URLs, the sheet swaps its own contents. Keeps state colocated, avoids URL pollution, and matches iOS context-menu conventions. |
| **TrackPage stripped to version management only** | After the sheet absorbed insights/notes/allow-download, TrackPage's mission collapsed to "manage versions and verify tempo/key" — much cleaner page. |
| **`lucide-react` for icons** | Tree-shaken (only imported icons hit the bundle), Apple-leaning stroke style, stable API. Replaced all unicode-emoji icons app-wide. |
| **ShareModal at `z-[60]`** | Above the track details sheet's `z-50`. Lets "Manage sharing…" open in front of the sheet without the sheet having to unmount first. |
| **Profile name dual-written to `profiles` + `user_metadata`** | Existing code reads artist name from `user.user_metadata.artist_name` in 4+ places. Migrating those to a profiles fetch is busy work for no user-visible win; the duplicate write is one extra `supabase.auth.updateUser` call on save and keeps everything in sync. |
| **Profile state in a zustand store, not React context** | Same shape as `usePlayer`. AppShell wraps ProfilePage, so without a shared store the header avatar wouldn't update until reload after an upload. A 30-line zustand store was cheaper than threading props or adding a context. |
| **OG previews via Netlify Edge Function, not client-side meta tags** | The SPA serves the same static `index.html` for every URL. OG scrapers don't run JS, so client-side React can never change what Slack/Twitter sees. An edge function is the only place to inject per-share metadata without a real backend. |
| **`resolve_share_preview` is separate from `resolve_share`** | Preview RPC must not consume single-use shares (scrapers can't be allowed to burn a link before the human opens it) and must not return audio URLs / signed URLs (scrapers are public). Different security profile = different function. |
| **Edge function always rewrites for `/listen/*`, no bot detection** | Bot UA detection is unreliable and the cost of running the rewrite for real users is negligible (one extra Supabase round-trip on the edge). Always-rewrite is simpler and always correct. |

---

## Database schema (summary)

- `profiles` (id → auth.users, artist_name, avatar_url)
- `albums` (owner_id, title, artwork_url, status, target_release_date)
- `tracks` (album_id, title, position, status, notes, bpm, song_key, allow_download, play_count, current_version_id)
- `versions` (track_id, label, storage_path, duration_sec, peaks)
- `share_links` (polymorphic: track_id XOR album_id; slug, signed_url, payload jsonb, **expires_at nullable**, revoked, visibility, require_account, **single_use**, **consumed_at**, play_count)
- `share_invites` (share_link_id, email — unique on lower(email))
- `saves` (polymorphic: track_id XOR album_id; user_id, share_link_id)
- `plays` (track_id, user_id nullable for anonymous, share_slug, created_at)

### Key RPCs
- `handle_new_user()` — trigger on auth.users insert, creates profile with artist_name from signup metadata
- `resolve_share(slug)` — returns share + track/version OR share + album/tracks payload, with status codes; treats null `expires_at` as never; sets `consumed_at` on first call when `single_use` is true and rejects subsequent calls
- `resolve_share_preview(slug)` — read-only preview for the OG edge function. Returns `{ status, kind, title, artist_name, artwork_url }`. Returns `unavailable` (not the real reason) for revoked/expired/disabled/consumed so scrapers can't probe state. Does NOT consume single-use links. Does NOT return audio URLs.
- `record_play(track_id, slug?)` — validates share if slug given, inserts play row, increments counters
- `list_my_saves()` — returns mixed array of saved tracks and saved albums as JSON. **Does NOT include `allow_download` or version storage_path**; SavedPage fetches `allow_download` per-row via a follow-up `tracks` select.

### Migrations status
- ✅ `supabase/migration_share_optional_expiry_single_use.sql` — applied. Idempotent.
- ✅ `supabase/migration_share_preview.sql` — applied. Adds `resolve_share_preview`. Idempotent.

---

## Currently-tracked bugs / known limitations

### "Replace audio" action in the details sheet is stubbed
The sheet has an `onRequestReplaceAudio` prop hook but it isn't wired from `AlbumPage`. Tapping the row currently does nothing meaningful. Plan: route to `/track/<id>` with a flag (e.g. `?action=upload`) that auto-clicks the upload input on mount.

### Per-version Share button on TrackPage still opens raw ShareModal
The new sheet has a clean Share card, but TrackPage's per-version row still uses the original modal directly. Not a bug per se, but inconsistent UX. Could be unified once we decide whether per-version sharing is still a v1 feature.

### AlbumShareModal hasn't been redesigned to match
Track sharing got the new card-style UX inside the sheet. Album sharing still uses the old `AlbumShareModal` with link-list UI. Should get a parallel "Album details" sheet at some point, mirroring the track shape.

### Single-use link is consumed on first `resolve_share`, not first play
If the recipient opens the link in a preview pane (link previewers, iMessage, Slack unfurl), the link can be consumed before the human sees it. Mitigated for unfurls now that `resolve_share_preview` handles scraper traffic separately and never consumes, but a human pasting the link into a tab still consumes on resolve regardless of whether they play.

### OG preview cache invalidation
Slack / Twitter / Facebook etc. cache OG previews aggressively (days to weeks). If an artist changes an album cover, existing pasted links keep showing the old image until the platform re-scrapes or the user manually pokes the platform's debugger. Not fixable from our side — just how unfurls work.

### Build size
Bundle is ~730 KB raw / 209 KB gzipped after `web-audio-beat-detector` + `fft.js` + `lucide-react`. Vite warns. Functional but worth code-splitting the analysis libs.

### Audio analysis on main thread
2–6s blocking work during upload (decode + FFT + key + BPM). UI shows status text but can feel sluggish on slower phones. Move to a Web Worker eventually.

### Filename detection edge cases
Track filenames like `Cm-110.wav` or `Em — slow build.wav` might surface ambiguous matches. Acceptable for now since Re-detect overrides.

### `list_my_saves` RPC is unowned by the repo
The function exists on the live DB but its source is not in `supabase/*.sql`. If we ever rebuild a project from this repo, we have to recreate it from scratch (or pull `pg_get_functiondef`).

### Don't run "Music Production Schema with RLS and Storage Policies" saved query in Supabase
That saved query in the SQL editor's PRIVATE section is the original `schema.sql` content from before any migrations. Running it will redefine `resolve_share` with the wrong signature and conflict with the applied migrations. Source of truth is the `supabase/*.sql` files in this repo. Should be deleted or renamed to `schema-initial-DO-NOT-RUN` in the Supabase UI.

---

## Immediate next steps

1. **Confirm Netlify env-var scopes** — `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` need to be scoped to **Functions** (not just Builds) so the share-preview edge function can read them. Site config → Environment variables.
2. **Commit + push** the profile + edge-function work; Netlify auto-builds.
3. **Verify OG previews on live** — paste a `/listen/<slug>` into https://www.opengraph.xyz/ (also try Twitter card validator and Facebook debugger). Should show album cover for album shares, parent album cover for track shares, `/logo-4096.png` fallback otherwise.
4. **Verify profile flow on live** — sign in, tap avatar in header, upload an image, rename, confirm header avatar updates without reload.
5. **Wire "Replace audio"** in the details sheet — route to `/track/<id>?action=upload` and have TrackPage auto-trigger the upload input.
6. **Redesign album sharing** to mirror the track sharing card — either an "Album details" sheet or a slimmed AlbumShareModal.
7. **Album rename + delete** — still on the roadmap from the pre-deploy plan.
8. **Cancel-pending-upload** if user navigates away mid-upload.
9. **Move audio analysis to a Web Worker** to keep the UI smooth on slower phones.
10. **Code-split** `web-audio-beat-detector` + `fft.js` so the initial bundle doesn't carry them.
11. **Share to artist friend for real testing** — Netlify is live, migrations applied, Supabase redirect URLs configured. Hand them the URL.

---

## How to run locally

```bash
cd ~/Desktop/stagehand
npm install
npm run dev -- --host    # --host exposes on the LAN so iPhone Safari can hit http://<mac-ip>:5173
```

Note: the edge function only runs in Netlify's environment. Locally, `/listen/<slug>` will serve the unmodified `index.html` — OG previews are untestable from `npm run dev`. To test them, push to a branch and use Netlify's deploy preview URL, or run `netlify dev` (which simulates edge functions locally) if you have the Netlify CLI installed.

To regenerate the logo PNGs after changing the SVG:

```bash
npm run gen:icons
```

`.env` must contain matching `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the same Supabase project. Schema lives in `supabase/schema.sql` plus the focused migrations in `supabase/migration_*.sql`; run them in Supabase → SQL Editor, one tab at a time, in a fresh empty pane (don't paste into the old "Music Production Schema" saved query — see bug above).

To ship changes:

```bash
git add .
git commit -m "<message>"
git push    # Netlify auto-rebuilds in ~1–2 min
```
