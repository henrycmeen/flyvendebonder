/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        paper: "var(--paper)",
        earth: {
          950: "var(--earth-950)",
          900: "var(--earth-900)",
          800: "var(--earth-800)",
          700: "var(--earth-700)",
          600: "var(--earth-600)",
          500: "var(--earth-500)",
          50: "#fff8ef",
        },
      },
      fontFamily: {
        display: ["Geist", "Avenir Next", "Trebuchet MS", "Gill Sans", "sans-serif"],
      },
    },
  },
  plugins: [],
}
