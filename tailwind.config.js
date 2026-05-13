/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        roast: {
          950: "#0a0604",
          900: "#150e0a",
          800: "#1f1610",
          700: "#2a1d14",
          600: "#3a281a",
          500: "#4a3322",
        },
        cream: {
          50: "#fbf3e2",
          100: "#f4e8d0",
          200: "#e8d4b0",
          300: "#d9be8c",
          400: "#c5a26a",
        },
        crema: {
          400: "#ffb976",
          500: "#ff9a3c",
          600: "#e0782a",
          700: "#a8541a",
        },
        rec: {
          400: "#ff7a5c",
          500: "#ff4d2e",
          600: "#cc2e15",
        },
        vu: {
          green: "#7fb069",
          amber: "#e8b04a",
          red: "#e85a3a",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        pixel: ['"VT323"', '"Departure Mono"', "ui-monospace", "monospace"],
        display: ['"Pixelify Sans"', "system-ui", "sans-serif"],
        seven: ['"DSEG7-Classic"', '"VT323"', "ui-monospace", "monospace"],
      },
      boxShadow: {
        pixel: "2px 2px 0 0 rgba(0,0,0,0.55)",
        "pixel-lg": "4px 4px 0 0 rgba(0,0,0,0.55)",
        "pixel-in": "inset 0 0 0 1px rgba(244,232,208,0.08)",
        "crema-glow":
          "0 0 24px rgba(255,154,60,0.42), 0 0 6px rgba(255,154,60,0.85)",
        "rec-glow":
          "0 0 32px rgba(255,77,46,0.55), 0 0 10px rgba(255,77,46,0.9)",
        bezel:
          "inset 0 1px 0 rgba(244,232,208,0.10), inset 0 -1px 0 rgba(0,0,0,0.55), 0 1px 0 rgba(0,0,0,0.6)",
      },
      animation: {
        "pulse-slow": "pulse 2.4s ease-in-out infinite",
        blink: "blink 1.2s steps(2, end) infinite",
        "rec-breath": "rec-breath 1.8s ease-in-out infinite",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
        "rec-breath": {
          "0%, 100%": { boxShadow: "0 0 24px rgba(255,77,46,0.45)" },
          "50%": { boxShadow: "0 0 44px rgba(255,77,46,0.85)" },
        },
      },
    },
  },
  plugins: [],
};
