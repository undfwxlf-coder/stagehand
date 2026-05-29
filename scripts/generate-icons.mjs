import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

// Source: a Stagehand mark at a generous viewBox. Rendered fresh here so the
// rasters are not constrained by the 32x32 favicon.
const markSvg = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <rect x="48" y="48" width="928" height="928" rx="208" fill="#241A15"/>
  <rect x="48" y="48" width="928" height="928" rx="208" fill="none" stroke="#3a2a22" stroke-width="2"/>
  <rect x="288" y="352" width="80" height="320" rx="40" fill="#F0EDDF"/>
  <rect x="472" y="208" width="80" height="608" rx="40" fill="#BB0A21"/>
  <rect x="656" y="432" width="80" height="160" rx="40" fill="#F0EDDF"/>
</svg>`;

const outDir = resolve(root, "public");
mkdirSync(outDir, { recursive: true });

const writeSize = (size, filename) => {
  const resvg = new Resvg(markSvg, {
    fitTo: { mode: "width", value: size },
    background: "transparent",
  });
  const png = resvg.render().asPng();
  const outPath = resolve(outDir, filename);
  writeFileSync(outPath, png);
  console.log(`  wrote ${filename}  (${size}x${size}, ${(png.length / 1024).toFixed(1)} KB)`);
};

console.log("Generating Stagehand mark PNGs into public/ …");
writeSize(192, "logo-192.png");
writeSize(512, "logo-512.png");
writeSize(1024, "logo-1024.png");
writeSize(2048, "logo-2048.png");
writeSize(4096, "logo-4096.png");
// apple-touch-icon convention — 180x180
writeSize(180, "apple-touch-icon.png");
// Single OG/social image
writeSize(1200, "og-image.png");
console.log("Done.");
