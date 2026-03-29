import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eef7ff",
          100: "#dbeeff",
          200: "#bedfff",
          300: "#8dc8ff",
          400: "#53a9ff",
          500: "#268cff",
          600: "#0b6fe0",
          700: "#0d59b3",
          800: "#124b93",
          900: "#163f77",
        },
      },
      boxShadow: {
        halo: "0 20px 60px rgba(20, 94, 255, 0.18)",
      },
      backgroundImage: {
        "hero-grid":
          "radial-gradient(circle at top right, rgba(37,99,235,0.16), transparent 30%), linear-gradient(135deg, rgba(255,255,255,0.95), rgba(219,234,254,0.92))",
      },
    },
  },
  plugins: [],
} satisfies Config;
