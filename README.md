# Stagehand

A private workspace for music artists to track albums, store unreleased music, and listen anywhere. SPA built with Vite + React + TypeScript, backed by Supabase, deployable to Netlify.

## What it does

- Sign up / sign in (email + password)
- Create albums and add tracks
- Pipeline status per album and per track (idea → demo → tracking → mixing → mastering → released)
- Upload audio versions (WAV/MP3/AIFF/FLAC/M4A) — waveform peaks are computed in the browser before upload, so the player shows a real waveform instantly
- Pick a "current" version per track, keep older versions around for reference
- Persistent bottom player bar (audio keeps playing as you navigate)
- Per-track notes
- Private storage — RLS policies make sure each user only sees their own audio

## Local setup

1. **Install dependencies**

   ```
   npm install
   ```

2. **Create a Supabase project** at https://supabase.com (free tier works).

3. **Run the schema.** In the Supabase dashboard → SQL editor, paste the entire contents of `supabase/schema.sql` and run it. This creates the tables, RLS policies, and the private `audio` + public `artwork` storage buckets.

4. **Add credentials.** Copy `.env.example` to `.env` and fill in:

   ```
   VITE_SUPABASE_URL=https://<your-project>.supabase.co
   VITE_SUPABASE_ANON_KEY=<your-anon-public-key>
   ```

   Find both in Supabase → Project Settings → API.

5. **Run the dev server**

   ```
   npm run dev
   ```

   Open http://localhost:5173.

## Deploying to Netlify

1. Push this repo to GitHub.
2. Netlify → Add new site → Import from Git.
3. Build settings are picked up from `netlify.toml` (build: `npm run build`, publish: `dist`).
4. In **Site settings → Environment variables**, add:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
5. Trigger a deploy.

In Supabase → Authentication → URL Configuration, add your Netlify URL to "Site URL" and "Redirect URLs" so email confirmation links work.

## Project layout

```
src/
  App.tsx              router + auth gate
  components/
    AppShell.tsx       header + persistent layout
    PlayerBar.tsx      bottom player (wavesurfer.js)
  lib/
    supabase.ts        supabase client
    auth.tsx           AuthProvider + useAuth hook
    player.ts          zustand store for the player
    audio.ts           waveform peak extraction + signed URLs
    database.types.ts  shared TS types
  pages/
    AuthPage.tsx       sign in / sign up
    LibraryPage.tsx    album grid
    AlbumPage.tsx      track list, statuses
    TrackPage.tsx      versions, notes, upload
    RecentPage.tsx     placeholder
supabase/
  schema.sql           run in Supabase SQL editor
```

## Notes

- Audio files are stored privately in the `audio` bucket. The player uses time-limited signed URLs (1 hour) so unreleased music can't leak via shared links.
- Waveform peaks are computed client-side via the Web Audio API and stored as JSON, so the player loads waveforms instantly without re-decoding.
- For artwork upload (currently unbuilt), use the public `artwork` bucket — see `supabase/schema.sql`.
