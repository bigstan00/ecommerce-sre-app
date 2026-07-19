import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef4ff",
          100: "#d9e6ff",
          200: "#b3ccff",
          300: "#82abff",
          400: "#5585ff",
          500: "#2f5eff",
          600: "#1c3fe8",
          700: "#1730b5",
          800: "#152a8f",
          900: "#152873",
        },
      },
    },
  },
  plugins: [],
};

export default config;
