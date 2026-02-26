/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        "fb-surface": {
          base: "var(--fb-surface-page)",
          ghost: "var(--fb-surface-ghost)",
          overlay: "var(--fb-surface-overlay)",
        },
        "fb-text": {
          primary: "var(--fb-text-primary)",
          secondary: "var(--fb-text-secondary)",
          muted: "var(--fb-text-muted)",
        },
        "fb-border": {
          subtle: "var(--fb-border-subtle)",
          strong: "var(--fb-border-strong)",
        },
        "fb-interactive": {
          default: "var(--fb-interactive-default)",
          hover: "var(--fb-interactive-hover)",
          active: "var(--fb-interactive-active)",
          disabled: "var(--fb-interactive-disabled)",
        },
        "fb-season": {
          solid: "var(--fb-season-solid)",
          spring: "var(--fb-map-season-spring)",
          summer: "var(--fb-map-season-summer)",
          autumn: "var(--fb-map-season-autumn)",
          winter: "var(--fb-map-season-winter)",
          mixed: "var(--fb-map-season-mixed)",
        },
        "fb-focus": "var(--fb-focus-ring)",
      },
      fontFamily: {
        display: ["Geist", "Avenir Next", "Trebuchet MS", "Gill Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
}
