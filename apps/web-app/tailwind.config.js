/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        background: "hsl(var(--background))", foreground: "hsl(var(--foreground))",
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        popover: { DEFAULT: "hsl(var(--popover))", foreground: "hsl(var(--popover-foreground))" },
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        border: "hsl(var(--border))", input: "hsl(var(--input))", ring: "hsl(var(--ring))",
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
