/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Base — deeper, cooler black for a premium feel
        ink: "#07080b",
        // Solid surfaces (kept for back-compat across existing pages)
        panel: "#12141a",
        panel2: "#1a1d25",
        // Hairline border — translucent white so it lifts the glass surfaces
        edge: "rgba(255,255,255,0.08)",
        muted: "#8a8f9c",
        accent: "#ff6b3d",
        // Liquid-glass tokens — used via the .glass / .glass-raised utilities
        glass: {
          DEFAULT: "rgba(255,255,255,0.04)",
          raised: "rgba(255,255,255,0.07)",
          strong: "rgba(255,255,255,0.10)",
        },
        hairline: {
          DEFAULT: "rgba(255,255,255,0.08)",
          strong: "rgba(255,255,255,0.14)",
        },
      },
      fontFamily: {
        sans: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Text"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "-apple-system",
          "BlinkMacSystemFont",
          '"SF Pro Display"',
          "Inter",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
      },
      borderRadius: {
        "4xl": "2rem",
      },
      boxShadow: {
        glass: "0 10px 40px -10px rgba(0,0,0,0.6), inset 0 1px 0 0 rgba(255,255,255,0.06)",
        "glass-lg": "0 24px 60px -20px rgba(0,0,0,0.7), inset 0 1px 0 0 rgba(255,255,255,0.08)",
        glow: "0 0 60px -10px rgba(255,107,61,0.35)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
