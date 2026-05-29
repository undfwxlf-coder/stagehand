// Full-bleed, heavily-blurred album-art backdrop. Each now-playing surface
// renders this behind its content so the whole screen takes on the cover's
// color (the immersive "ambient art" look). Falls back to the app's stock
// ambient gradient when there's no artwork.
//
// Purely decorative: pointer-events-none + aria-hidden. The caller owns
// positioning — pass e.g. "fixed inset-0" (viewport-pinned, survives scroll)
// or "absolute inset-0". Parent controls stacking via z-index.
export default function ArtBackdrop({
  artworkUrl,
  className = "fixed inset-0",
}: {
  artworkUrl?: string | null;
  className?: string;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none overflow-hidden ${className}`}
    >
      {artworkUrl ? (
        <>
          {/* The cover, blown up + blurred so it fills the frame with color. */}
          <img
            src={artworkUrl}
            alt=""
            className="absolute inset-0 w-full h-full object-cover scale-125 blur-[64px] opacity-60"
          />
          {/* Darkening + vignette so foreground text/controls stay legible. */}
          <div className="absolute inset-0 bg-gradient-to-b from-ink/40 via-ink/55 to-ink/85" />
          <div className="absolute inset-0 bg-ink/30" />
        </>
      ) : (
        // No artwork → stock ambient wash so the screen still feels alive.
        <div
          className="absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 90% 60% at 30% -10%, rgba(187,10,33,0.16), transparent 60%)," +
              "radial-gradient(ellipse 70% 60% at 80% 110%, rgba(80,45,36,0.22), transparent 60%)," +
              "#17110E",
          }}
        />
      )}
    </div>
  );
}
