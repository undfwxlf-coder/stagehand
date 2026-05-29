/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Base — deep warm near-black in the Molten Bark family.
        ink: "#17110E",
        // Solid surfaces — warm browns (kept for back-compat across pages)
        panel: "#241A15",
        panel2: "#31231B",
        // Hairline border — translucent cream so it lifts the glass surfaces
        edge: "rgba(240,237,223,0.10)",
        // Muted text — warm taupe
        muted: "#A99E8F",
        // Crimson Alloy — primary accent
        accent: "#BB0A21",
        // Molten Bark — warm-brown secondary surface / button
        bark: "#502D24",
        // Thunder Ash — neutral warm-gray chips / dividers / early states
        ash: "#484541",
        // Liquid-glass tokens — warm-tinted translucency over the dark base
        glass: {
          DEFAULT: "rgba(240,237,223,0.04)",
          raised: "rgba(240,237,223,0.07)",
          strong: "rgba(240,237,223,0.10)",
        },
        hairline: {
          DEFAULT: "rgba(240,237,223,0.10)",
          strong: "rgba(240,237,223,0.16)",
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
        glow: "0 0 60px -10px rgba(187,10,33,0.40)",
      },
      backdropBlur: {
        xs: "2px",
      },
    },
  },
  plugins: [],
};
