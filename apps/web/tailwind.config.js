/** @type {import('tailwindcss').Config} */
// Clipper's palette: neutral greys (no blue tint) and ONE warm accent. Existing
// `slate-*` / `indigo-*` classes are remapped here, so the whole app follows.
const neutral = {
  50: '#fafafa', 100: '#f4f4f5', 200: '#e4e4e7', 300: '#d4d4d8', 400: '#a1a1aa',
  500: '#71717a', 600: '#52525b', 700: '#3a3a40', 800: '#26262b', 900: '#17171a', 950: '#0c0c0e',
}
const accent = {
  50: '#fff4ed', 100: '#ffe6d4', 200: '#ffc9a8', 300: '#ffa370', 400: '#ff7a3d',
  500: '#fb5a17', 600: '#e0460d', 700: '#b9360c', 800: '#932d12', 900: '#772712', 950: '#401007',
}
module.exports = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: { slate: neutral, indigo: accent, purple: accent, pink: accent, brand: accent },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        display: ['"Inter Tight"', 'Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
