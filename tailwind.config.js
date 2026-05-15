/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: "#efe6d2",
          warm: "#ede2c9",
          deep: "#e4d6b6",
          paper: "#f7f0db",
        },
        ink: {
          DEFAULT: "#1a1814",
          soft: "#3a342a",
          muted: "#6e6555",
          faint: "#a39a87",
        },
        crimson: {
          DEFAULT: "#c8351e",
          deep: "#8a2010",
        },
        ochre: {
          DEFAULT: "#d4923a",
          deep: "#a86a1f",
        },
        ultramarine: "#2b3d8c",
        sap: "#5e8a3a",
        umber: "#6b4a26",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ['"JetBrains Mono"', "ui-monospace", "monospace"],
        hand: ['"Caveat"', '"Bradley Hand"', "cursive"],
        painted: ['"Fraunces"', '"Spectral"', "Georgia", "serif"],
      },
      animation: {
        blink: "blink 1.2s steps(2, end) infinite",
      },
      keyframes: {
        blink: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0" },
        },
      },
    },
  },
  plugins: [],
};
