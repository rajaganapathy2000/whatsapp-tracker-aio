/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: 'class', // Enables the dark mode toggle we built
  theme: {
    extend: {
      colors: {
        // Custom iOS-style grays if needed
      }
    },
  },
  plugins: [],
}