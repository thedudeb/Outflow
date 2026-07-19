/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        mono: ['"IBM Plex Mono"', '"SFMono-Regular"', "Consolas", '"Liberation Mono"', "monospace"],
        sans: ['"Inter"', "system-ui", "-apple-system", "BlinkMacSystemFont", '"Segoe UI"', "sans-serif"],
      },
    },
  },
  plugins: [],
};
