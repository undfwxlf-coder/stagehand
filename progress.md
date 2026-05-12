# Stagehand — Progress

A private workspace for music artists to track albums, store unreleased music, share with collaborators, and listen anywhere. Public web app, mobile-first, deployable to Netlify.

---

## What's built

### Core
- Email/password auth (Supabase) with email-confirmation flow
- Profile auto-created on signup, artist name carried through `raw_user_meta_data`
- Library: album grid, create/rename albums, status pipeline (writing → recording → mixing → mastering → released)
- Cover art upload (public `artwork` bucket)
- Mobile-first layout pass — every page works on phone-sized viewports; iOS safe-area honored

### Tracks
- Album page with track list
- Drag-to-reorder via `@dnd-kit/sortable` (desktop only, persists positions)
- Inline rename (pencil on hover, double-click, or Enter/Esc keyboard)
- Per-track status (idea → demo → tracking → mixing → mastering → released)
- BPM + key fields, editable inline
- Notes editor
- Allow-download toggle (per track)

### Versions
- Upload WAV/MP3/AIFF/FLAC/M4A — multi-format support
- Waveform peaks pre-computed in browser via Web Audio API
- Versions are first-class — pick a "current" version, keep history
- Smart label inference from filenames: `v3`, `rough mix`, `master`, etc.

### Audio analysis (real, content-based)
- **BPM**: `web-audio-beat-detector`, run on 3 segments of the song, folded into 60–180 range, median-clustered to kill half-/double-time outliers
- **Key**: custom chromagram + Krumhansl-Schmuckler with energy-weighted frames and peakedness filter to ignore percussive frames
- **Re-detect button** on track page — fetches the current version, re-runs analysis, persists detected values to DB and to local React state so they stay visible after detection (and across refreshes)
- Filename hints (`120 BPM Am.wav`) take priority over content detection
- Errors from the upload + re-detect paths now surface a real message via a `formatErr` helper (Supabase error objects no longer render as `[object Object]`)

### Player
- Persistent bottom player bar with wavesurfer.js
- Volume + mute, persisted to localStorage
- Mobile: title + play controls + thin tap-to-seek progress bar; waveform hidden
- Auto-advance through queues

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
- "Single-use" badge on existing-link rows; "Never expires" replaces the expiry date when applicable; status reads "Used" once burned

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

### Insights (per-track)
- Tab on TrackPage (replaces standalone Notes)
- Stat cards: Plays, Saves
- Listener feed: shows artist name for signed-in listeners, "Anonymous" for share-link listens without an account
- Saves feed: who saved + when

### Branding
- Mini 3-bar waveform logo (3 vertical bars, middle is accent orange)
- Inline SVG mark + wordmark component, used in header, auth page, listen page
- Favicon and OG meta in `index.html`
- Logo is clickable to home from every shell

---

## Stack and core architectural decisions

| Decision | Why |
|---|---|
| **Vite + React + TS + Tailwind v3** | Static SPA, deploys clean to Netlify, fast dev loop |
| **Supabase (auth + Postgres + Storage)** | Auth, DB, and S3-compatible storage in one; client talks directly via RLS |
| **Netlify hosting** | Static + SPA redirect rule in `netlify.toml`; no backend server needed |
| **Audio in private `audio` bucket, art in public `artwork` bucket** | Audio is sensitive (unreleased), art needs cheap public URLs |
| **Signed URLs (1 hr default), longer for share links** | Prevents URL leakage for streaming; share link's signed URL expires when the share does |
| **SECURITY DEFINER RPCs for public access** | `resolve_share`, `record_play`, `list_my_saves` — bypass RLS cleanly without creating cross-table recursion in policies |
| **No public-read RLS policies on share_links / tracks / versions** | Earlier attempt caused infinite recursion (`42P17`) between `share_links` and `share_invites`. The RPCs replaced them. |
| **Polymorphic share_links and saves (track XOR album)** | Single set of code paths for shares/saves; check constraint enforces exactly-one |
| **Browser-side audio analysis** | No backend audio worker; FFT + tempo detection in main thread. ~6s on a 4-min song. Worker is a future optimization. |
| **Filename hints > content detection** | If artist explicitly named the file with BPM/key, respect them |
| **Detection only auto-applies on empty fields; Re-detect overrides** | Don't clobber manual values silently; explicit Re-detect button overwrites BPM/key |
| **Single-use shares burn on first `resolve_share` call, not first play** | Simplest semantic: opening the page consumes it. Signed URL embedded in the response is still good for the URL's lifetime so the first listener's playback continues even after refresh would be blocked. |
| **`expires_at` nullable + `single_use` orthogonal to `visibility`** | Keeps the visibility enum stable. Single-use only matters for `link` visibility; the create RPC zeroes it for invite/disabled. |
| **Never-expires share signs the storage URL for 10 years** | Supabase signed URLs are JWTs with arbitrary TTLs; 10y avoids re-signing infrastructure. |
| **Mobile-first** | Captured in MEMORY: every feature must work on phones, some "extreme" features (drag-to-reorder) can be desktop-only as a documented trade-off |

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
- `record_play(track_id, slug?)` — validates share if slug given, inserts play row, increments counters
- `list_my_saves()` — returns mixed array of saved tracks and saved albums as JSON

### Pending migrations to run on the live project (`ccsewcccfgqofvxsavne`)
- `supabase/migration_share_optional_expiry_single_use.sql` — adds nullable `expires_at`, `single_use`, `consumed_at`, and replaces `resolve_share`. Required before the new share UI is functional in production.
- BPM/key columns: if a fresh project is ever wired up, run `alter table tracks add column if not exists bpm numeric; alter table tracks add column if not exists song_key text; notify pgrst, 'reload schema';` (the live project already has them as of today).

---

## Currently-tracked bugs

### `.env` was pointing at the wrong Supabase project
- Resolved 2026-05-12: `VITE_SUPABASE_URL` updated to `https://ccsewcccfgqofvxsavne.supabase.co` to match the existing anon key. The other project (`effortless-muffin-240ab3`) is now unused.

### Build size
- Bundle is ~680 KB raw / 200 KB gzipped after adding `web-audio-beat-detector` + `fft.js`. Vite warns about this. Functional but worth code-splitting the analysis code at some point.

### Audio analysis on main thread
- 2–6s blocking work during upload (decode + FFT + key + BPM). UI shows status text but can feel sluggish on slower phones. Move to a Web Worker eventually.

### Filename detection edge cases
- Track filenames like `Cm-110.wav` or `Em — slow build.wav` might surface ambiguous matches. Acceptable for now since Re-detect overrides.

### Save row collisions
- Existing saves table had a composite PK on `(user_id, track_id)`. Migrated to a generated `id` PK with partial unique indexes. Any old DB rows are preserved but earlier conversations may have left a row missing its `id`; the migration `update saves set id = gen_random_uuid() where id is null` handles it.

### No git history in `~/Desktop/stagehand`
- The project is not a git repo. Progress and decisions only live in this file plus chat. `git init` + push is on the next-steps list before deploying.

### Single-use link is consumed on first page open, not first play
- Side effect: if the recipient opens the link in a preview pane (link previewers, iMessage, Slack unfurl), the link can be consumed before the human sees it. Acceptable trade-off for v1, but worth flagging if it bites real users.

---

## Immediate next steps

1. **Run the share migration** in Supabase SQL editor: paste `supabase/migration_share_optional_expiry_single_use.sql` and execute. Without this, the new "Never expires" and "Single-use" UI will fail when the row tries to write the new columns.
2. **Test the share flow end-to-end**: create a Never-expires + Single-use link, open it in incognito, confirm playback works, refresh and confirm the "single-use already opened" screen renders. Repeat for invite-only.
3. **`git init` the project + push to GitHub**, then connect Netlify for auto-deploys. Currently the only history of decisions is `progress.md`.
4. **Album rename + delete** (next in the agreed roadmap).
5. **Cancel-pending-upload** if user navigates away mid-upload.
6. **Production deploy to Netlify** so it can be shared with real artists.
7. **Move audio analysis to a Web Worker** to keep the UI smooth.
8. **Code-split** the analysis libs so the initial bundle doesn't carry them.

---

## How to run locally

```bash
cd ~/Desktop/stagehand
npm install
npm run dev -- --host    # --host exposes on the LAN so iPhone Safari can hit http://<mac-ip>:5173
```

`.env` must contain a matching `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from the same Supabase project. Schema lives in `supabase/schema.sql` plus the focused migrations in `supabase/migration_*.sql`; run them in Supabase → SQL Editor.
