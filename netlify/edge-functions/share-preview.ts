import type { Config, Context } from "https://edge.netlify.com";

const SUPABASE_URL =
  Deno.env.get("VITE_SUPABASE_URL") ?? Deno.env.get("SUPABASE_URL");
const SUPABASE_ANON =
  Deno.env.get("VITE_SUPABASE_ANON_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY");

const DEFAULT_IMAGE = "/logo-4096.png";
const DEFAULT_TITLE = "Stagehand";
const DEFAULT_DESC = "A private listen, hosted by Stagehand.";

function escapeAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

interface PreviewOk {
  status: "ok";
  kind: "track" | "album";
  title: string | null;
  artist_name: string | null;
  artwork_url: string | null;
}

type PreviewResult = PreviewOk | { status: string };

async function fetchPreview(slug: string): Promise<PreviewOk | null> {
  if (!SUPABASE_URL || !SUPABASE_ANON) return null;
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/resolve_share_preview`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: SUPABASE_ANON,
        Authorization: `Bearer ${SUPABASE_ANON}`,
      },
      body: JSON.stringify({ p_slug: slug }),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as PreviewResult;
    if (data && data.status === "ok") return data as PreviewOk;
    return null;
  } catch {
    return null;
  }
}

export default async function (request: Request, context: Context) {
  const url = new URL(request.url);
  const slug = url.pathname.replace(/^\/listen\//, "").replace(/\/$/, "");
  // Bail if pathname has extra segments (e.g. /listen/foo/bar) — only handle leaf shares.
  if (!slug || slug.includes("/")) return context.next();

  const response = await context.next();
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) return response;

  const preview = await fetchPreview(slug);

  let title = DEFAULT_TITLE;
  let description = DEFAULT_DESC;
  let image = DEFAULT_IMAGE;
  let customImage = false;

  if (preview) {
    const t = (preview.title || "").trim();
    const artist = (preview.artist_name || "").trim();
    const kindLabel = preview.kind === "album" ? "album" : "track";
    const fallbackTitle = preview.kind === "album" ? "Untitled album" : "Untitled track";
    title = `${t || fallbackTitle}${artist ? ` — ${artist}` : ""} · Stagehand`;
    description = artist
      ? `Listen to ${t || `this ${kindLabel}`} by ${artist} on Stagehand.`
      : `Listen to ${t || `this ${kindLabel}`} on Stagehand.`;
    if (preview.artwork_url) {
      image = preview.artwork_url;
      customImage = true;
    }
  }

  const html = await response.text();
  const eTitle = escapeAttr(title);
  const eDesc = escapeAttr(description);
  const eImg = escapeAttr(image);

  let rewritten = html
    .replace(/<title>[^<]*<\/title>/, `<title>${eTitle}</title>`)
    .replace(
      /<meta\s+name="description"\s+content="[^"]*"\s*\/?>/,
      `<meta name="description" content="${eDesc}" />`
    )
    .replace(
      /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:title" content="${eTitle}" />`
    )
    .replace(
      /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:description" content="${eDesc}" />`
    )
    .replace(
      /<meta\s+property="og:image"\s+content="[^"]*"\s*\/?>/,
      `<meta property="og:image" content="${eImg}" />`
    )
    .replace(
      /<meta\s+name="twitter:image"\s+content="[^"]*"\s*\/?>/,
      `<meta name="twitter:image" content="${eImg}" />`
    );

  // Album-artwork dimensions are unknown; drop the static 1200x1200 hints so
  // scrapers measure the actual file instead of trusting wrong values.
  if (customImage) {
    rewritten = rewritten
      .replace(/<meta\s+property="og:image:width"[^>]*>\s*/g, "")
      .replace(/<meta\s+property="og:image:height"[^>]*>\s*/g, "");
  }

  const headers = new Headers(response.headers);
  headers.delete("content-length");

  return new Response(rewritten, {
    status: response.status,
    headers,
  });
}

export const config: Config = { path: "/listen/*" };
