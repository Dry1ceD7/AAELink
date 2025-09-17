/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        'aae-blue': '#2563eb',
        'aae-light-blue': '#dbeafe',
        'aae-dark-blue': '#1e40af',
      }
    },
  },
  plugins: [],
}
